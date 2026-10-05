/**
 * Synthesised tone contours.
 *
 * WHY THIS EXISTS: a tone is a pitch contour, nothing more. Teaching it by
 * playing a recorded syllable depends entirely on the learner having a decent
 * Mandarin voice installed — and many people have none at all, in which case
 * the browser falls back to an English voice and all four tones sound
 * identical. That is not a hypothetical: it is the single most common reason a
 * beginner concludes "I can't hear tones".
 *
 * So we generate the contour directly as a synthesised glide. A pure tone that
 * glides exactly the way tone 2 glides is an unambiguous reference: it cannot
 * be mangled by a missing voice, it needs no network, and it works forever
 * offline. Speech is layered on top when a real voice exists — but the contour
 * is the ground truth the learner can always fall back to.
 *
 * Pitch levels use Chao tone numerals (1 = lowest, 5 = highest), the standard
 * notation: tone 1 is 55, tone 2 is 35, tone 3 is 214, tone 4 is 51.
 */

let ctx = null;
function audio() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  return ctx;
}

/*
 * HOW THE SOUND IS PLAYED — read this before touching it.
 *
 * The contour is rendered to a short WAV in memory and played through an
 * ordinary <audio> element, not through Web Audio. On iPhone the two follow
 * different rules, and Web Audio loses on both counts:
 *   - Web Audio is muted by the ring/silent switch. Media elements and speech
 *     are not — so the learner heard 你好 but every tone was silent.
 *   - Speech synthesis takes over the audio session and leaves a Web Audio
 *     context 'interrupted'.
 * A media element behaves exactly like the voice does, everywhere. Web Audio
 * remains only as a fallback where <audio> or Blob URLs do not exist.
 *
 * iOS lets an element play outside a tap only after it has played inside one,
 * so unlock() plays a few milliseconds of silence on the first real tap.
 */
const SAMPLE_RATE = 22050;
let el = null;
let elUnlocked = false;
const urls = new Map();            // `${tone}@${rate}` -> blob URL, rendered once

function player() {
  if (el) return el;
  if (typeof Audio === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL || typeof Blob === 'undefined') return null;
  el = new Audio();
  el.preload = 'auto';
  return el;
}

function wavUrl(key, render) {
  if (!urls.has(key)) urls.set(key, URL.createObjectURL(new Blob([render()], { type: 'audio/wav' })));
  return urls.get(key);
}

const silenceUrl = () => wavUrl('silence', () => encodeWav(new Int16Array(Math.round(SAMPLE_RATE * 0.05))));

/**
 * Call from inside a real tap.
 *
 * Deliberately does NOT create a Web Audio context when <audio> is available.
 * On iPhone, a page with a live AudioContext is classed as "ambient" sound, and
 * the silent switch then mutes the whole page — the <audio> tones included.
 * That is what kept tones silent in silent mode after they moved to <audio>.
 */
export function unlock() {
  preferPlaybackSession();
  const p = player();
  if (!p) return wakeContext();
  if (!elUnlocked) {
    const silent = silenceUrl();
    p.src = silent;
    const played = p.play();
    elUnlocked = true;
    // Only pause the silence — never a tone that started in the meantime.
    played?.then?.(() => { if (p.src === silent) p.pause(); })
      // Interrupted by a real tone is fine; only a refusal means still locked.
      .catch((err) => { if (err?.name !== 'AbortError') elUnlocked = false; });
  }
  return Promise.resolve();
}

/** Web Audio fallback only. 'interrupted', not just 'suspended': Safari's state after speech. */
function wakeContext() {
  const a = audio();
  if (!a) return Promise.resolve();
  return a.state === 'running' ? Promise.resolve() : a.resume().catch(() => {});
}

export function preferPlaybackSession() {
  try {
    const s = globalThis.navigator?.audioSession;
    if (s && s.type !== 'playback') s.type = 'playback';
  } catch { /* not supported — nothing to do */ }
}

export const isSupported = () =>
  Boolean(player() || window.AudioContext || window.webkitAudioContext);

/** Chao level 1..5 -> Hz. Roughly one octave across the speaking range. */
const hz = (level) => 150 * Math.pow(2, (level - 1) / 4);

/** The four tones plus neutral, as pitch-level sequences over time. */
export const CONTOURS = {
  1: { levels: [5, 5], ms: 700, label: 'high and flat', arrow: '→' },
  2: { levels: [3, 5], ms: 700, label: 'rising', arrow: '↗' },
  3: { levels: [2, 1, 4], ms: 900, label: 'dips low, then rises', arrow: '↘↗' },
  4: { levels: [5, 1], ms: 500, label: 'falling sharply', arrow: '↘' },
  5: { levels: [3, 3], ms: 250, label: 'short and light', arrow: '·' },
};

/**
 * Render a contour to 16-bit samples. Pure: no DOM, no audio device, so it is
 * testable, and it is the same glide the Web Audio fallback schedules —
 * levels evenly spaced, exponential (perceptual) interpolation, triangle wave,
 * 40ms attack and 60ms release so it never clicks.
 */
export function renderTone(tone, { rate = 1, gain = 0.32 } = {}) {
  const c = CONTOURS[tone] || CONTOURS[1];
  const dur = (c.ms / 1000) / rate;
  const n = Math.round(dur * SAMPLE_RATE);
  const out = new Int16Array(n);
  const segs = c.levels.length - 1 || 1;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SAMPLE_RATE;
    const u = Math.min(t / dur, 1) * segs;
    const k = Math.min(Math.floor(u), segs - 1);
    const f0 = hz(c.levels[k]);
    const f1 = hz(c.levels[Math.min(k + 1, c.levels.length - 1)]);
    const f = f0 * Math.pow(f1 / f0, u - k);
    phase += (2 * Math.PI * f) / SAMPLE_RATE;
    const tri = (2 / Math.PI) * Math.asin(Math.sin(phase));
    const env = Math.min(1, t / 0.04, (dur - t) / 0.06);
    out[i] = Math.round(Math.max(0, env) * gain * tri * 32767);
  }
  return out;
}

/** Wrap 16-bit mono samples in a minimal RIFF/WAVE header. */
export function encodeWav(samples, sampleRate = SAMPLE_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i], true);
  return bytes;
}

/**
 * Play a tone as a pure pitch glide.
 * @param {number} tone 1..5
 * @param {object} opts { rate: speed multiplier, gain }
 */
export function playTone(tone, opts = {}) {
  const rate = opts.rate || 1;
  const c = CONTOURS[tone] || CONTOURS[1];
  const durMs = c.ms / rate;
  preferPlaybackSession();
  const p = player();
  if (!p) return playToneWebAudio(tone, opts);

  // Must reach play() synchronously: iOS only honours it inside the tap.
  p.pause();
  p.src = wavUrl(`${tone}@${rate}`, () => encodeWav(renderTone(tone, { rate })));
  const playing = p.play();
  elUnlocked = true;
  return new Promise((resolve) => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    p.onended = done;
    setTimeout(done, durMs + 250);         // never let a sequence hang on a lost event
    playing?.catch?.((err) => {
      // AbortError only means a newer tone (or a pause) replaced this one —
      // falling back then would play two sounds at once. Fall back only when
      // media playback itself is refused or unsupported.
      if (err?.name === 'AbortError') return done();
      playToneWebAudio(tone, opts).then(done);
    });
  });
}

/** Fallback for browsers without <audio>/Blob URLs. Same glide, scheduled live. */
async function playToneWebAudio(tone, opts = {}) {
  const a = audio();
  if (!a) return;
  // Schedule only once the context is actually running: notes scheduled on a
  // stalled clock either never sound or fire all at once when it wakes.
  await wakeContext();

  const c = CONTOURS[tone] || CONTOURS[1];
  const dur = (c.ms / 1000) / (opts.rate || 1);
  const t0 = a.currentTime + 0.02;

  const osc = a.createOscillator();
  const g = a.createGain();
  // A triangle wave reads as "voice-like" without the harshness of a saw.
  osc.type = 'triangle';

  // Glide through each level in turn, evenly spaced across the duration.
  const step = dur / (c.levels.length - 1 || 1);
  osc.frequency.setValueAtTime(hz(c.levels[0]), t0);
  c.levels.forEach((lv, i) => {
    if (i === 0) return;
    // Exponential ramps match how pitch is actually perceived (log scale).
    osc.frequency.exponentialRampToValueAtTime(hz(lv), t0 + step * i);
  });

  const peak = opts.gain ?? 0.16;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.04);
  g.gain.setValueAtTime(peak, t0 + dur - 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  osc.connect(g).connect(a.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);

  return new Promise((r) => setTimeout(r, (dur + 0.1) * 1000));
}

/** Play several tones in sequence, e.g. to contrast 2 against 4. */
export async function playSequence(tones, gapMs = 320) {
  for (const t of tones) {
    await playTone(t);
    await new Promise((r) => setTimeout(r, gapMs));
  }
}

/**
 * An SVG of the contour, drawn from the same numbers that generate the sound,
 * so the picture and the audio can never disagree.
 */
export function contourSVG(tone, { w = 92, h = 52 } = {}) {
  const c = CONTOURS[tone] || CONTOURS[1];
  const pad = 7;
  const n = c.levels.length;
  const pts = c.levels.map((lv, i) => {
    const x = pad + (i / (n - 1 || 1)) * (w - pad * 2);
    // level 1 sits at the bottom, level 5 at the top
    const y = h - pad - ((lv - 1) / 4) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('aria-hidden', 'true');
  svg.style.overflow = 'visible';

  // Faint staff lines give the glide something to be high or low against.
  for (const lv of [1, 3, 5]) {
    const y = h - pad - ((lv - 1) / 4) * (h - pad * 2);
    const line = document.createElementNS(svgNS, 'line');
    line.setAttribute('x1', '0'); line.setAttribute('x2', String(w));
    line.setAttribute('y1', String(y)); line.setAttribute('y2', String(y));
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-opacity', lv === 3 ? '0.18' : '0.1');
    line.setAttribute('stroke-width', '1');
    svg.append(line);
  }

  const path = document.createElementNS(svgNS, 'polyline');
  path.setAttribute('points', pts.join(' '));
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '3.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);

  const dot = document.createElementNS(svgNS, 'circle');
  const [cx, cy] = pts[0].split(',');
  dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', 'currentColor');
  svg.append(dot);

  return svg;
}
