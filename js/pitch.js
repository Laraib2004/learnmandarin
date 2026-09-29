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
 * So we generate the contour directly with an oscillator. A pure tone that
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

export function unlock() {
  const a = audio();
  if (a && a.state === 'suspended') a.resume().catch(() => {});
}

export const isSupported = () => Boolean(window.AudioContext || window.webkitAudioContext);

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
 * Play a tone as a pure pitch glide.
 * @param {number} tone 1..5
 * @param {object} opts { rate: speed multiplier, gain }
 */
export function playTone(tone, opts = {}) {
  const a = audio();
  if (!a) return Promise.resolve();
  unlock();

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
