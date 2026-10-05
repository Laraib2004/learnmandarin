/**
 * Feedback: the difference between an app that responds and one that feels dead.
 *
 * Three channels, because no single one works everywhere:
 *   - Visual  — toasts and state changes. Works universally.
 *   - Audio   — short synthesised tones, rendered in memory. No asset files.
 *   - Haptic  — navigator.vibrate.
 *
 * Honest limitation: **iOS Safari does not implement navigator.vibrate**, so
 * there is no haptic feedback on iPhone, including in an installed PWA. Nothing
 * here can change that — it is a platform restriction, not a gap in the code.
 * That is exactly why the audio and visual channels carry the real weight, and
 * why success/failure is never signalled by vibration alone.
 */

import { get } from './store.js';
import { preferPlaybackSession, encodeWav } from './pitch.js';

/* ---------------- haptics ---------------- */

export const hapticsSupported = () => typeof navigator !== 'undefined' && 'vibrate' in navigator;

const PATTERNS = {
  tap: 8,
  select: 12,
  success: [14, 40, 22],
  warn: [18, 60, 18],
  error: [32, 50, 32],
};

export function haptic(kind = 'tap') {
  if (!get().settings.haptics) return false;
  if (!hapticsSupported()) return false;
  try {
    return navigator.vibrate(PATTERNS[kind] ?? PATTERNS.tap);
  } catch {
    return false;
  }
}

/* ---------------- audio cues ---------------- */

/*
 * Cues are rendered to a WAV once and played through an <audio> element, for
 * the same reason the tone contours are (see pitch.js): on iPhone Web Audio is
 * muted by the ring/silent switch and interrupted by speech, so "correct" and
 * "wrong" were silent exactly where audio is the main feedback channel (there
 * are no haptics on iPhone). Cues get their own element so a chime never cuts
 * off a tone that is still playing. Web Audio is the fallback only.
 */

/** Each cue as notes: [Hz, ms, { type, gain, delayMs }]. Named by meaning, not pitch. */
export const CUES = {
  correct:   [[660, 90], [880, 130, { delayMs: 85 }]],
  partial:   [[560, 120]],
  wrong:     [[300, 150, { type: 'triangle' }]],
  listening: [[760, 70, { gain: 0.04 }]],
  done:      [[660, 90], [880, 90, { delayMs: 90 }], [1100, 160, { delayMs: 180 }]],
};

const RATE = 22050;

/**
 * Mix a cue's notes into one buffer of 16-bit samples. Pure. Mirrors the old
 * Web Audio envelope: 12ms attack, then an exponential fall to near silence
 * by the note's end, so nothing clicks.
 */
export function renderCue(kind) {
  const notes = CUES[kind] || [];
  const endMs = Math.max(0, ...notes.map(([, ms, o = {}]) => (o.delayMs || 0) + ms)) + 20;
  const mix = new Float32Array(Math.round((endMs / 1000) * RATE));
  for (const [freq, ms, { type = 'sine', gain = 0.06, delayMs = 0 } = {}] of notes) {
    const start = Math.round((delayMs / 1000) * RATE);
    const n = Math.round((ms / 1000) * RATE);
    const dur = ms / 1000;
    for (let i = 0; i < n && start + i < mix.length; i++) {
      const t = i / RATE;
      const ph = 2 * Math.PI * freq * t;
      const wave = type === 'triangle' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
      const env = t < 0.012 ? t / 0.012 : Math.pow(0.0001 / gain, (t - 0.012) / Math.max(dur - 0.012, 0.001));
      mix[start + i] += gain * env * wave;
    }
  }
  const out = new Int16Array(mix.length);
  for (let i = 0; i < mix.length; i++) out[i] = Math.round(Math.max(-1, Math.min(1, mix[i])) * 32767);
  return out;
}

let el = null;
let elUnlocked = false;
const urls = new Map();

function player() {
  if (el) return el;
  if (typeof Audio === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return null;
  el = new Audio();
  el.preload = 'auto';
  return el;
}

function cueUrl(kind) {
  if (!urls.has(kind)) {
    const samples = kind === 'silence' ? new Int16Array(Math.round(RATE * 0.05)) : renderCue(kind);
    urls.set(kind, URL.createObjectURL(new Blob([encodeWav(samples, RATE)], { type: 'audio/wav' })));
  }
  return urls.get(kind);
}

let ctx = null;
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/**
 * iOS only lets audio start inside a tap; call this from a real one. A media
 * element is unlocked by playing it once there, so later cues (fired after an
 * answer is scored, outside the tap) are allowed.
 */
export function unlockAudio() {
  const p = player();
  if (p && !elUnlocked) {
    const silent = cueUrl('silence');
    p.src = silent;
    const played = p.play();
    elUnlocked = true;
    played?.then?.(() => { if (p.src === silent) p.pause(); })
      .catch((err) => { if (err?.name !== 'AbortError') elUnlocked = false; });
  }
  const a = audio();
  preferPlaybackSession();
  // Not just 'suspended': Safari reports 'interrupted' after speech has played.
  if (a && a.state !== 'running') a.resume().catch(() => {});
}

/** Fallback: the same notes scheduled live on Web Audio. */
function tone(freq, durationMs, { type = 'sine', gain = 0.06, delayMs = 0 } = {}) {
  const a = audio();
  if (!a) return;
  const t0 = a.currentTime + delayMs / 1000;
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  // Short attack/release: a raw square edge clicks unpleasantly.
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durationMs / 1000);
  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + durationMs / 1000 + 0.02);
}

const playWebAudio = (kind) => (CUES[kind] || []).forEach(([f, ms, o]) => tone(f, ms, o));

export function cue(kind) {
  if (!get().settings.sounds || !CUES[kind]) return;
  const p = player();
  if (!p) return playWebAudio(kind);
  p.pause();
  p.src = cueUrl(kind);
  const playing = p.play();
  elUnlocked = true;
  // AbortError: a newer cue replaced this one — normal, and never a reason to
  // also play it through Web Audio (that doubled the sound for tones).
  playing?.catch?.((err) => { if (err?.name !== 'AbortError') playWebAudio(kind); });
}

/** One call for "tell the learner what just happened" across all channels. */
export function signal(kind, message) {
  const map = { correct: 'success', partial: 'warn', wrong: 'error', done: 'success' };
  cue(kind);
  haptic(map[kind] || 'tap');
  if (message) toast(message, kind);
}

/* ---------------- toasts ---------------- */

let host = null;

function toastHost() {
  if (host && document.body.contains(host)) return host;
  host = document.createElement('div');
  host.className = 'toast-host';
  host.setAttribute('role', 'status');
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

export function toast(message, kind = 'info', ms = 2600) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  toastHost().append(el);
  // Force a frame so the entry transition actually runs.
  requestAnimationFrame(() => el.classList.add('in'));
  setTimeout(() => {
    el.classList.remove('in');
    setTimeout(() => el.remove(), 260);
  }, ms);
  return el;
}
