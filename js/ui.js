/** Tiny DOM helpers. No framework: the whole app must stay forkable and buildless. */

import { get } from './store.js';
import { trapsIn } from './deck.js';

const ZH_CLASS = /(^|\s)zh(\s|$)/;

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  // Every hanzi element is marked as Chinese, centrally. Without it a screen
  // reader reads 你好 with an English voice (or skips it), and some browsers
  // pick a Japanese font, showing a beginner the wrong shape for 直 or 说.
  if (attrs && ZH_CLASS.test(attrs.class || '') && attrs.lang == null) el.setAttribute('lang', 'zh-CN');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Tone number 1-5 from a pinyin syllable's diacritic, for colour-coding. */
const TONE_MARKS = {
  1: 'āēīōūǖĀĒĪŌŪǕ',
  2: 'áéíóúǘÁÉÍÓÚǗ',
  3: 'ǎěǐǒǔǚǍĚǏǑǓǙ',
  4: 'àèìòùǜÀÈÌÒÙǛ',
};

export function toneOf(syllable) {
  for (const [num, chars] of Object.entries(TONE_MARKS)) {
    for (const ch of syllable) if (chars.includes(ch)) return Number(num);
  }
  return 5; // no diacritic = neutral tone
}

const toneNumbersOn = () => {
  try { return Boolean(get().settings.toneNumbers); } catch { return false; }
};

/**
 * Render pinyin with each syllable coloured by its tone.
 *
 * Colour alone fails colour-blind learners — tone 1 is red and tone 3 green,
 * the most common confusion there is — so the "tone numbers" setting adds a
 * superscript digit that carries the same information without colour.
 */
export function pinyinEl(pinyin, cls = 'pinyin') {
  const wrap = h('div', { class: cls, lang: 'zh-Latn-pinyin' });
  const numbers = toneNumbersOn();
  for (const part of String(pinyin).split(/(\s+)/)) {
    if (!part.trim()) { wrap.append(part); continue; }
    const t = toneOf(part);
    wrap.append(h('span', { class: `t${t}` }, part,
      numbers && t < 5 ? h('sup', { class: 'tnum', 'aria-hidden': 'true' }, String(t)) : null));
  }
  return wrap;
}

/* ---------------- tone sandhi ---------------- */

const T3_TO_T2 = { 'ǎ': 'á', 'ě': 'é', 'ǐ': 'í', 'ǒ': 'ó', 'ǔ': 'ú', 'ǚ': 'ǘ' };

/**
 * The two regular tone changes, applied to space-separated pinyin:
 * 3+3 → 2+3 (nǐ hǎo is said ní hǎo), and 不 bù → bú before a 4th tone.
 * A learner who reads the written tones aloud gets both wrong, every time.
 *
 * Deliberately limited: syllables written together inside one word (kěyǐ) and
 * 一's changes need real segmentation, so corpus sentences carry an explicit
 * `spoken` field instead. Punctuation ends a run — sandhi does not cross a pause.
 */
export function autoSandhi(pinyin) {
  const parts = String(pinyin || '').split(/(\s+)/);
  const sylls = parts.map((p, i) => ({ p, i })).filter((x) => x.p.trim());
  const out = [...parts];
  for (let k = 0; k < sylls.length - 1; k++) {
    const cur = sylls[k].p;
    const next = sylls[k + 1].p;
    if (/[，。？！,.?!;:；：]$/.test(cur)) continue;
    if (toneOf(cur) === 3 && toneOf(next) === 3) {
      out[sylls[k].i] = cur.replace(/[ǎěǐǒǔǚ]/, (m) => T3_TO_T2[m]);
    } else if (/^bù$/i.test(cur) && toneOf(next) === 4) {
      out[sylls[k].i] = cur.replace('ù', 'ú');
    }
  }
  return out.join('');
}

/** "Said as ní hǎo" — only when speech differs from spelling, else null. */
export function spokenNote(written, spoken) {
  if (!spoken || spoken.trim() === String(written || '').trim()) return null;
  return h('div', { class: 'said-as', title: 'The tones change when these syllables meet' },
    h('span', { class: 'muted small' }, 'Said as'),
    pinyinEl(spoken, 'pinyin said'));
}

/** Reminders of the pinyin spelling traps a word contains, as small notes. */
export function trapNotes(pinyin) {
  const traps = trapsIn(pinyin);
  if (!traps.length) return null;
  return h('div', { class: 'trap-notes' },
    ...traps.map((t) =>
      h('div', { class: 'trap-chip' }, h('b', {}, 'Spelling trap: '), t.hint)));
}

export const TONE_LEGEND = () =>
  h('div', { class: 'tone-key muted' },
    h('span', { class: 't1' }, '— 1st'),
    h('span', { class: 't2' }, '╱ 2nd'),
    h('span', { class: 't3' }, '╲╱ 3rd'),
    h('span', { class: 't4' }, '╲ 4th'),
    h('span', { class: 't5' }, '· neutral'));

export const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const sample = (arr, n) => shuffle(arr).slice(0, n);

/** Keyboard shortcuts scoped to the current view; returns a cleanup function. */
export function keys(map) {
  const handler = (e) => {
    if (e.target.matches('input, textarea, select')) return;
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(e); }
  };
  document.addEventListener('keydown', handler);
  return () => document.removeEventListener('keydown', handler);
}
