/**
 * Feedback: the difference between an app that responds and one that feels dead.
 *
 * Three channels, because no single one works everywhere:
 *   - Visual  — toasts and state changes. Works universally.
 *   - Audio   — short synthesised tones via Web Audio. No asset files needed.
 *   - Haptic  — navigator.vibrate.
 *
 * Honest limitation: **iOS Safari does not implement navigator.vibrate**, so
 * there is no haptic feedback on iPhone, including in an installed PWA. Nothing
 * here can change that — it is a platform restriction, not a gap in the code.
 * That is exactly why the audio and visual channels carry the real weight, and
 * why success/failure is never signalled by vibration alone.
 */

import { get } from './store.js';

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

let ctx = null;
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/** iOS suspends audio until a user gesture; call this from a real tap. */
export function unlockAudio() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}

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

/** Cue names map to meaning, not to pitch, so they stay consistent app-wide. */
export function cue(kind) {
  if (!get().settings.sounds) return;
  switch (kind) {
    case 'correct':  tone(660, 90); tone(880, 130, { delayMs: 85 }); break;
    case 'partial':  tone(560, 120); break;
    case 'wrong':    tone(300, 150, { type: 'triangle' }); break;
    case 'listening':tone(760, 70, { gain: 0.04 }); break;
    case 'done':     tone(660, 90); tone(880, 90, { delayMs: 90 }); tone(1100, 160, { delayMs: 180 }); break;
    default: break;
  }
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
