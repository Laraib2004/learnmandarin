/**
 * Local-first persistence. Everything a learner does stays in their browser.
 *
 * No accounts, no server, no tracking. That is what makes the site free to run
 * forever and free of any reason to harvest anyone. Export/import gives people
 * real ownership of their progress and a way to move between devices.
 */

const KEY = 'learnchinese.v1';

const defaultState = () => ({
  version: 1,
  createdAt: Date.now(),
  settings: {
    requestRetention: 0.9,
    newPerDay: 8,
    maxReviewsPerDay: 120,
    showHanzi: true,       // characters are an optional track
    speechRate: 0.85,      // native speech is fast; learners need it slower
    voiceURI: null,
    haptics: true,         // no-op on iOS: Safari does not implement navigator.vibrate
    sounds: true,          // synthesised cues; the main feedback channel on iPhone
  },
  cards: {},               // sentenceId -> FSRS card
  tones: {},               // toneDrillKey -> { seen, correct }
  speech: {},              // sentenceId -> { attempts, best }
  drills: {},              // patternId  -> { attempts, best, fast }
  dialogues: {},           // dialogueId -> { runs, best, turns }
  log: [],                 // { t, id, grade } review history
  daily: {},               // 'YYYY-MM-DD' -> { new, reviews, speak, drill }
});

let state = null;

export function load() {
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    state = raw ? { ...defaultState(), ...JSON.parse(raw) } : defaultState();
  } catch {
    state = defaultState();
  }
  return state;
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save progress:', e);
    }
  }, 150);
}

export function get() {
  return load();
}

export function update(fn) {
  const s = load();
  fn(s);
  save();
  return s;
}

export const todayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function bumpDaily(field, n = 1) {
  return update((s) => {
    const k = todayKey();
    s.daily[k] = s.daily[k] || { new: 0, reviews: 0, speak: 0, drill: 0 };
    s.daily[k][field] = (s.daily[k][field] || 0) + n;
  });
}

export function exportJSON() {
  return JSON.stringify(load(), null, 2);
}

export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !('cards' in parsed)) {
    throw new Error('That does not look like a LearnChinese backup file.');
  }
  state = { ...defaultState(), ...parsed };
  save();
  return state;
}

export function reset() {
  state = defaultState();
  save();
  return state;
}
