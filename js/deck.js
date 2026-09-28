/**
 * Deck logic — decides what you study next.
 *
 * Two rules that matter pedagogically:
 *  1. Due reviews always come before new material. Letting new cards jump the
 *     queue is how people end up with 400 overdue cards and quit.
 *  2. New sentences are introduced in course order and rate-limited per day,
 *     so the review load stays flat instead of compounding into a cliff.
 *
 * The corpus is split per stage (data/corpus/st*.json) and listed in
 * data/course.json, so content can grow without touching any code.
 */

import { get, update } from './store.js';
import { newCard } from './fsrs.js';

let corpus = null;

export async function loadCorpus() {
  if (corpus) return corpus;

  const course = await fetch('data/course.json').then((r) => r.json());
  const [stageFiles, tones, patterns, dialogues] = await Promise.all([
    Promise.all(course.stages.map((s) => fetch(s.file).then((r) => r.json()))),
    fetch('data/tones.json').then((r) => r.json()),
    fetch('data/patterns.json').then((r) => r.json()),
    fetch('data/dialogues.json').then((r) => r.json()),
  ]);

  const units = stageFiles.flatMap((f) => f.units);
  const sentences = stageFiles.flatMap((f) => f.sentences);

  corpus = {
    meta: course.meta,
    stages: course.stages,
    units,
    sentences,
    tones,
    patterns: patterns.patterns,
    patternsMeta: patterns.meta,
    dialogues: dialogues.dialogues,
    dialoguesMeta: dialogues.meta,
    byId: Object.fromEntries(sentences.map((s) => [s.id, s])),
    unitById: Object.fromEntries(units.map((u) => [u.id, u])),
    stageById: Object.fromEntries(course.stages.map((s) => [s.id, s])),
  };
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

export const todayStr = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** How many new cards today's budget still allows. */
export function newBudgetLeft() {
  const s = get();
  const done = s.daily[todayStr()]?.new ?? 0;
  return Math.max(0, (s.settings.newPerDay ?? 8) - done);
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

/**
 * Patterns unlocked for drilling. A pattern opens once you have studied any
 * sentence from its stage — drilling a frame you have never heard in context
 * is just translation homework.
 */
export function availablePatterns() {
  const reached = new Set(studied().map((s) => corpus.unitById[s.unit]?.stage));
  if (!reached.size) reached.add('st1');
  const open = corpus.patterns.filter((p) => reached.has(p.stage));
  return open.length ? open : corpus.patterns.filter((p) => p.stage === 'st1');
}

/**
 * Dialogues unlocked for the learner. Same gate as patterns: a conversation
 * built on a stage you have not reached is a wall, not practice. Stage 1 is
 * always open so a brand-new learner has something to try immediately.
 */
export function availableDialogues() {
  const reached = new Set(studied().map((s) => corpus.unitById[s.unit]?.stage));
  reached.add('st1');
  const open = corpus.dialogues.filter((d) => reached.has(d.stage));
  return open.length ? open : corpus.dialogues.filter((d) => d.stage === 'st1');
}

/**
 * Compose one concrete sentence from a pattern frame and a slot filler.
 * replaceAll, not replace: a frame may carry the placeholder more than once
 * (e.g. "Do you have {X}? / Is there {X}?"), and a single replace would leave
 * a raw {X} sitting in the learner's prompt.
 */
export function fillPattern(pattern, slot) {
  return {
    patternId: pattern.id,
    hanzi: pattern.zh.replaceAll('{X}', slot.h),
    pinyin: pattern.pinyin.replaceAll('{X}', slot.p),
    en: pattern.en.replaceAll('{X}', slot.e),
    slot,
    note: pattern.note,
    name: pattern.name,
  };
}

/** Aggregate progress numbers for the dashboard. */
export function stats() {
  const s = get();
  const cards = Object.values(s.cards).filter((c) => c.reps > 0);
  const mature = cards.filter((c) => c.stability >= 21).length;
  const words = new Set();
  for (const sen of studied()) for (const w of sen.words) words.add(w.h);
  const spoken = Object.values(s.speech).filter((x) => (x.best ?? 0) >= 80).length;
  const drills = Object.values(s.drills || {});
  const convos = Object.values(s.dialogues || {});
  return {
    known: cards.length,
    total: corpus.sentences.length,
    mature,
    words: words.size,
    due: dueCards().length,
    spoken,
    drilled: drills.filter((d) => (d.best ?? 0) >= 80).length,
    drillAttempts: drills.reduce((a, d) => a + (d.attempts || 0), 0),
    conversations: convos.reduce((a, d) => a + (d.runs || 0), 0),
    toneAccuracy: toneAccuracy(),
    streak: streak(),
    stage: currentStage(),
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
    const k = todayStr(d);
    const day = daily[k];
    const active = day && (day.new || day.reviews || day.speak || day.drill);
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

/** Progress through every unit, grouped by stage. */
export function unitProgress() {
  const { cards } = get();
  return corpus.units.map((u) => {
    const all = corpus.sentences.filter((s) => s.unit === u.id);
    const done = all.filter((s) => cards[s.id]?.reps > 0).length;
    return { ...u, total: all.length, done, pct: Math.round((done / all.length) * 100) };
  });
}

/** Progress through each of the five stages. */
export function stageProgress() {
  const units = unitProgress();
  return corpus.stages.map((st) => {
    const mine = units.filter((u) => u.stage === st.id);
    const total = mine.reduce((a, u) => a + u.total, 0);
    const done = mine.reduce((a, u) => a + u.done, 0);
    return { ...st, units: mine, total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  });
}

/** The stage the learner is currently working in — first one not yet finished. */
export function currentStage() {
  const stages = stageProgress();
  return stages.find((s) => s.done < s.total) || stages[stages.length - 1];
}
