/**
 * FSRS-5 (Free Spaced Repetition Scheduler) — the scheduling core.
 *
 * Why not SM-2 (what Anki shipped for 20 years, and what most apps copy)?
 * SM-2 guesses an interval from a fixed formula. FSRS models each card with two
 * latent variables — stability (how long memory lasts) and difficulty — and
 * schedules the review for the exact day your recall probability decays to your
 * chosen retention target. Fewer reviews, better retention.
 *
 * Grades: 1 = Again, 2 = Hard, 3 = Good, 4 = Easy.
 *
 * Reference: Ye et al., "Optimizing Spaced Repetition Schedule by Capturing
 * Forgetting Dynamics" — default weights from the open-source FSRS project.
 */

// Default FSRS-5 weights, trained on ~1.7B reviews from the public dataset.
export const DEFAULT_W = [
  0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046,
  1.54575, 0.1192, 1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315,
  2.9898, 0.51655, 0.6621,
];

const DECAY = -0.5;
const FACTOR = 19 / 81; // = 0.9 ** (1 / DECAY) - 1

export const DAY_MS = 86400000;

const clampD = (d) => Math.min(Math.max(d, 1), 10);
const clampS = (s) => Math.min(Math.max(s, 0.01), 36500);

/** Probability you still recall a card, `elapsedDays` after its last review. */
export function retrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + (FACTOR * elapsedDays) / stability, DECAY);
}

/** Days until recall probability decays to `requestRetention` (default 0.90). */
export function intervalFor(stability, requestRetention = 0.9) {
  const days = (stability / FACTOR) * (Math.pow(requestRetention, 1 / DECAY) - 1);
  return Math.max(1, Math.round(days));
}

/** A brand-new card, never studied. */
export function newCard(id) {
  return {
    id,
    stability: 0,
    difficulty: 0,
    due: Date.now(),
    lastReview: null,
    reps: 0,
    lapses: 0,
    state: 'new', // new | learning | review | relearning
  };
}

const initialStability = (w, g) => clampS(w[g - 1]);
const initialDifficulty = (w, g) => clampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);

/** Difficulty update with FSRS-5 linear damping toward the easy anchor. */
function nextDifficulty(w, d, g) {
  const delta = -w[6] * (g - 3);
  const damped = d + (delta * (10 - d)) / 9; // damping: harder cards move less
  const anchor = initialDifficulty(w, 4);
  return clampD(w[7] * anchor + (1 - w[7]) * damped); // mean reversion
}

/** Stability after a successful recall — grows more when recall was unlikely. */
function stabilityOnRecall(w, d, s, r, g) {
  const hardPenalty = g === 2 ? w[15] : 1;
  const easyBonus = g === 4 ? w[16] : 1;
  const growth =
    1 +
    Math.exp(w[8]) *
      (11 - d) *
      Math.pow(s, -w[9]) *
      (Math.exp(w[10] * (1 - r)) - 1) *
      hardPenalty *
      easyBonus;
  return clampS(s * growth);
}

/** Stability after a lapse. Never allowed to exceed the pre-lapse stability. */
function stabilityOnForget(w, d, s, r) {
  const next =
    w[11] *
    Math.pow(d, -w[12]) *
    (Math.pow(s + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - r));
  return clampS(Math.min(next, s));
}

/** Same-day re-review: memory consolidates but far less than a spaced one. */
function stabilityShortTerm(w, s, g) {
  return clampS(s * Math.exp(w[17] * (g - 3 + w[18])));
}

/**
 * Apply a grade to a card and return the updated card.
 * Pure: does not mutate `card`.
 *
 * @param {object} card    card produced by newCard() or a previous review
 * @param {number} grade   1..4
 * @param {object} opts    { now, requestRetention, w }
 */
export function review(card, grade, opts = {}) {
  const w = opts.w || DEFAULT_W;
  const now = opts.now ?? Date.now();
  const retention = opts.requestRetention ?? 0.9;
  const g = Math.min(Math.max(Math.round(grade), 1), 4);

  const next = { ...card, reps: card.reps + 1, lastReview: now };

  if (card.state === 'new' || card.stability === 0) {
    next.stability = initialStability(w, g);
    next.difficulty = initialDifficulty(w, g);
    next.state = g === 1 ? 'learning' : 'review';
  } else {
    const elapsedDays = card.lastReview ? (now - card.lastReview) / DAY_MS : 0;
    const r = retrievability(elapsedDays, card.stability);
    next.difficulty = nextDifficulty(w, card.difficulty, g);

    if (elapsedDays < 1) {
      // Reviewed again the same day — short-term consolidation only.
      next.stability = stabilityShortTerm(w, card.stability, g);
      next.state = g === 1 ? 'relearning' : card.state;
      if (g === 1) next.lapses = card.lapses + 1;
    } else if (g === 1) {
      next.stability = stabilityOnForget(w, card.difficulty, card.stability, r);
      next.lapses = card.lapses + 1;
      next.state = 'relearning';
    } else {
      next.stability = stabilityOnRecall(w, card.difficulty, card.stability, r, g);
      next.state = 'review';
    }
  }

  // "Again" and "Hard" on a young card come back within the session, not in days.
  if (g === 1) {
    next.due = now + 60000; // 1 minute
  } else if (next.state === 'learning' || next.state === 'relearning') {
    next.due = now + 600000; // 10 minutes
  } else {
    next.due = now + intervalFor(next.stability, retention) * DAY_MS;
  }

  return next;
}

/** Preview the interval each grade would produce, for the answer buttons. */
export function previewIntervals(card, opts = {}) {
  const out = {};
  for (const g of [1, 2, 3, 4]) {
    const c = review(card, g, opts);
    out[g] = c.due - (opts.now ?? Date.now());
  }
  return out;
}

/** Human-readable interval, e.g. "10m", "3d", "2.1mo". */
export function formatInterval(ms) {
  const m = ms / 60000;
  if (m < 60) return `${Math.max(1, Math.round(m))}m`;
  const h = m / 60;
  if (h < 24) return `${Math.round(h)}h`;
  const d = h / 24;
  if (d < 30) return `${Math.round(d)}d`;
  const mo = d / 30.44;
  if (mo < 12) return `${mo.toFixed(1)}mo`;
  return `${(d / 365.25).toFixed(1)}y`;
}
