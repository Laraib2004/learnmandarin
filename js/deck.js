/**
 * Deck logic — decides what you study next.
 *
 * Two rules that matter pedagogically:
 *  1. Due reviews always come before new material. Letting new cards jump the
 *     queue is how people end up with 400 overdue cards and quit.
 *  2. New sentences are introduced in course order and rate-limited per day,
 *     so the review load stays flat instead of compounding into a cliff.
 */

import { get, update } from './store.js';
import { newCard } from './fsrs.js';

let corpus = null;

export async function loadCorpus() {
  if (corpus) return corpus;
  const [sentences, tones] = await Promise.all([
    fetch('data/sentences.json').then((r) => r.json()),
    fetch('data/tones.json').then((r) => r.json()),
  ]);
  corpus = { ...sentences, tones };
  corpus.byId = Object.fromEntries(corpus.sentences.map((s) => [s.id, s]));
  return corpus;
}

export const getCorpus = () => corpus;

/** The FSRS card for a sentence, creating it lazily on first sight. */
export function cardFor(id) {
  const s = get();
  if (!s.cards[id]) {
    update((st) => { st.cards[id] = newCard(id); });
  }
  return get().cards[id];
}

/** Sentences already introduced (have a card with at least one rep). */
export function studied() {
  const { cards } = get();
  return corpus.sentences.filter((s) => cards[s.id]?.reps > 0);
}

/** Cards that are due right now, soonest first. */
export function dueCards(now = Date.now()) {
  const { cards } = get();
  return corpus.sentences
    .filter((s) => cards[s.id]?.reps > 0 && cards[s.id].due <= now)
    .sort((a, b) => cards[a.id].due - cards[b.id].due);
}

/** Next sentences never studied, in course order. */
export function newSentences(limit = Infinity) {
  const { cards } = get();
  return corpus.sentences.filter((s) => !cards[s.id]?.reps).slice(0, limit);
}

/** How many new cards today's budget still allows. */
export function newBudgetLeft() {
  const s = get();
  const key = new Date().toISOString().slice(0, 10);
  const todayLocal = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const doneToday = s.daily[todayLocal]?.new ?? s.daily[key]?.new ?? 0;
  return Math.max(0, (s.settings.newPerDay ?? 8) - doneToday);
}

/**
 * Build the study queue: all due reviews, then new sentences up to the budget.
 * @returns {{queue: object[], due: number, fresh: number}}
 */
export function buildQueue() {
  const due = dueCards();
  const fresh = newSentences(newBudgetLeft());
  return { queue: [...due, ...fresh], due: due.length, fresh: fresh.length };
}

/** Sentences worth drilling out loud: ones you have already met. */
export function speakableSentences() {
  const seen = studied();
  return seen.length ? seen : corpus.sentences.slice(0, 5);
}

/** Aggregate progress numbers for the dashboard. */
export function stats() {
  const s = get();
  const cards = Object.values(s.cards).filter((c) => c.reps > 0);
  const mature = cards.filter((c) => c.stability >= 21).length;
  const words = new Set();
  for (const sen of studied()) for (const w of sen.words) words.add(w.h);
  const speechAttempts = Object.values(s.speech);
  const spoken = speechAttempts.filter((x) => (x.best ?? 0) >= 80).length;
  return {
    known: cards.length,
    total: corpus.sentences.length,
    mature,
    words: words.size,
    due: dueCards().length,
    spoken,
    toneAccuracy: toneAccuracy(),
    streak: streak(),
  };
}

function toneAccuracy() {
  const t = Object.values(get().tones);
  const seen = t.reduce((a, x) => a + x.seen, 0);
  const correct = t.reduce((a, x) => a + x.correct, 0);
  return seen ? Math.round((correct / seen) * 100) : null;
}

/** Consecutive days with any study activity, counting back from today. */
function streak() {
  const { daily } = get();
  let n = 0;
  const d = new Date();
  for (;;) {
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const day = daily[k];
    const active = day && (day.new || day.reviews || day.speak);
    if (!active) {
      // Today not yet studied should not break a streak earned yesterday.
      if (n === 0 && k === todayStr()) { d.setDate(d.getDate() - 1); continue; }
      break;
    }
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Which of the 6 units the learner has unlocked, and how far into each. */
export function unitProgress() {
  const { cards } = get();
  return corpus.units.map((u) => {
    const all = corpus.sentences.filter((s) => s.unit === u.id);
    const done = all.filter((s) => cards[s.id]?.reps > 0).length;
    return { ...u, total: all.length, done, pct: Math.round((done / all.length) * 100) };
  });
}
