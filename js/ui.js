/** Tiny DOM helpers. No framework: the whole app must stay forkable and buildless. */

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
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

/** Render pinyin with each syllable coloured by its tone. */
export function pinyinEl(pinyin, cls = 'pinyin') {
  const wrap = h('div', { class: cls });
  for (const part of String(pinyin).split(/(\s+)/)) {
    if (!part.trim()) { wrap.append(part); continue; }
    wrap.append(h('span', { class: `t${toneOf(part)}` }, part));
  }
  return wrap;
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
