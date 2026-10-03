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
  const [stageFiles, tones, patterns, dialogues, pinyin, characters, lessons] = await Promise.all([
    Promise.all(course.stages.map((s) => fetch(s.file).then((r) => r.json()))),
    fetch('data/tones.json').then((r) => r.json()),
    fetch('data/patterns.json').then((r) => r.json()),
    fetch('data/dialogues.json').then((r) => r.json()),
    fetch('data/pinyin.json').then((r) => r.json()),
    fetch('data/characters.json').then((r) => r.json()),
    fetch('data/lessons.json').then((r) => r.json()),
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
    pinyin,
    characters,
    lessons,
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

/* ---------------- the guided path ---------------- */

const stripPunct = (t) => String(t || '').replace(/[\s，。？！、；：,.?!;:]/g, '');

/**
 * Seed review cards from a lesson the learner just finished.
 *
 * Without this the path and the scheduler are two disconnected apps: you would
 * finish eighteen lessons and still have an empty Review queue. Any sentence
 * the lesson actually taught — via a `speak` target or a `word` glyph — becomes
 * a live FSRS card, so the words start coming back on schedule immediately.
 *
 * Matching is by stripped hanzi, because lesson text carries punctuation the
 * corpus entry may not.
 */
export function seedFromLesson(lesson) {
  if (!lesson || !corpus) return [];
  const wanted = new Set();
  for (const st of lesson.steps || []) {
    for (const key of ['target', 'speak', 'hanzi', 'big']) {
      if (st[key]) wanted.add(stripPunct(st[key]));
    }
  }
  const seeded = [];
  for (const sen of corpus.sentences) {
    if (!wanted.has(stripPunct(sen.hanzi))) continue;
    const existing = get().cards[sen.id];
    if (existing?.reps > 0) continue;
    // Grade 3 ("Good"): the learner has just been taught and drilled it, so
    // treating it as brand new would waste a review.
    update((st) => { st.cards[sen.id] = { ...newCard(sen.id), reps: 1, state: 'review', stability: 1.5, difficulty: 5.2, lastReview: Date.now(), due: Date.now() + 86400000 }; });
    seeded.push(sen.id);
  }
  return seeded;
}

export function lessonProgress() {
  const p = get().lessons || { done: [], current: null, step: 0 };
  const all = corpus?.lessons?.lessons || [];
  return { done: p.done.length, total: all.length, current: p.current, step: p.step, all };
}

/* ---------------- pinyin spelling traps ---------------- */

const plain = (p) => String(p || '').toLowerCase().normalize('NFD')
  .replace(/ü/g, 'ü').replace(/[̀-ͯ]/g, '');

/**
 * Which of the spelling traps (data/pinyin.json → traps) a word falls into.
 * They are taught once in L05–L08; this keeps pointing them out on every word
 * afterwards, because a rule seen once is a rule forgotten by Thursday.
 *
 * Works on whole tokens rather than segmented syllables, so each check is
 * written to be safe at a syllable boundary (shíhou, kèqi). Aspiration (b/d/g)
 * is left out on purpose: it is in almost every word, so flagging it would
 * drown out the traps that matter.
 * @returns {{id: string, hint: string}[]}
 */
const TRAP_CHECKS = [
  ['qxj', /q/, 'q is "ch", as in "cheap" — never "kw"'],
  ['qxj', /x/, 'x is "sh", as in "sheep" — never "ks" or "z"'],
  ['cz', /c(?!h)/, 'c is "ts", as in "cats" — never "k" or "s"'],
  ['cz', /z(?!h)/, 'z is "ds", as in "kids" — not an English z'],
  ['buzz-i', /(zh|ch|sh|[rzcs])i(?![aeiouüng])/, 'i after zh ch sh r z c s is a buzz, not "ee"'],
  ['u-umlaut', /[jqxy]u/, 'u after j q x y is really ü — lips rounded, tongue forward'],
  ['hidden-vowels', /iu|ui|(?<![jqxy])un/, 'iu, ui and un hide a vowel: iu ≈ "yoh", ui ≈ "way", un ≈ "wun"'],
  ['e-alone', /(?:^|[^aeiouü])(?:zh|ch|sh|[bpmfdtnlgkhzcsr])?e(?![inrgio])/, 'e on its own is "uh", not "ay"'],
  ['ian', /[iy]an(?!g)/, '-ian and yan are said "yen", not "yahn"'],
];

export function trapsIn(pinyin) {
  const found = [];
  for (const token of plain(pinyin).split(/[^a-zü]+/).filter(Boolean)) {
    for (const [id, re, hint] of TRAP_CHECKS) {
      if (re.test(token) && !found.some((f) => f.hint === hint)) found.push({ id, hint });
    }
  }
  return found;
}

/* ---------------- character track (separate SRS from sentences) ---------------- */

/**
 * Find a glyph in the character data: a full character first, then a building
 * block by either its full form (人) or its squeezed side form (亻).
 * @returns {{kind: 'char'|'component', entry: object}|null}
 */
export function lookupGlyph(g) {
  const data = corpus?.characters;
  if (!data || !g) return null;
  const ch = data.characters.find((c) => c.c === g);
  if (ch) return { kind: 'char', entry: ch };
  const comp = data.components.find((c) => c.c === g || c.alt === g);
  return comp ? { kind: 'component', entry: comp } : null;
}

/**
 * Characters a lesson taught (its `char` steps) go onto the Script track's
 * schedule, due tomorrow, exactly as seedFromLesson() does for sentences.
 */
export function seedCharsFromLesson(lesson) {
  if (!lesson || !corpus) return [];
  const seeded = [];
  for (const st of lesson.steps || []) {
    if (st.type !== 'char' || lookupGlyph(st.c)?.kind !== 'char') continue;
    if (get().charCards?.[st.c]?.reps > 0 || seeded.includes(st.c)) continue;
    update((s) => {
      s.charCards = s.charCards || {};
      s.charCards[st.c] = { ...newCard(st.c), reps: 1, state: 'review', stability: 1.5, difficulty: 5.2, lastReview: Date.now(), due: Date.now() + 86400000 };
    });
    seeded.push(st.c);
  }
  return seeded;
}

/** The FSRS card for a single character, created lazily. */
export function charCardFor(ch) {
  const s = get();
  if (!s.charCards) update((st) => { st.charCards = st.charCards || {}; });
  if (!get().charCards[ch]) update((st) => { st.charCards[ch] = newCard(ch); });
  return get().charCards[ch];
}

export function dueCharCards(now = Date.now()) {
  const cards = get().charCards || {};
  return corpus.characters.characters
    .filter((c) => cards[c.c]?.reps > 0 && cards[c.c].due <= now)
    .sort((a, b) => cards[a.c].due - cards[b.c].due);
}

/** Next unseen characters, in corpus-frequency order, capped by the daily budget. */
export function newCharacters(limit = 5) {
  const cards = get().charCards || {};
  const doneToday = get().daily[todayStr()]?.chars ?? 0;
  const budget = Math.max(0, limit - doneToday);
  return corpus.characters.characters.filter((c) => !cards[c.c]?.reps).slice(0, budget);
}

export function charStats() {
  const cards = Object.values(get().charCards || {}).filter((c) => c.reps > 0);
  return {
    known: cards.length,
    total: corpus.characters.characters.length,
    mature: cards.filter((c) => c.stability >= 21).length,
    due: dueCharCards().length,
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
    chars: charStats(),
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
