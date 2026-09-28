/**
 * Renders every view against a minimal DOM shim so runtime errors in the boot
 * path and view code surface in CI instead of in a learner's browser.
 * Not a browser: it checks that the code runs and produces the expected nodes.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ---------------- minimal DOM ---------------- */
class Node2 {
  constructor(tag = '') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.dataset = {};
    this.classList = new Set();
    this.listeners = {};
    this.style = {};
    this._text = '';
  }
  get className() { return [...this.classList].join(' '); }
  set className(v) { this.classList = new Set(String(v).split(/\s+/).filter(Boolean)); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent ?? '').join(''); }
  set innerHTML(v) { this._text = String(v).replace(/<[^>]*>/g, ''); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.setAttribute(k, ''); else this.removeAttribute(k); }
  set hidden(v) { this.attrs.hidden = v ? '' : undefined; }
  get hidden() { return this.attrs.hidden === ''; }
  append(...kids) { for (const k of kids) this.children.push(typeof k === 'object' ? k : textNode(k)); }
  replaceChildren(...kids) { this.children = []; this.append(...kids.filter(Boolean)); }
  replaceWith() { /* no-op for the shim */ }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); }
  removeEventListener() {}
  focus() {}
  click() { (this.listeners.click || []).forEach((f) => f({ target: this, currentTarget: this, preventDefault() {} })); }
  matches() { return false; }
  get all() { return this.children.flatMap((c) => [c, ...(c.all || [])]); }
  querySelectorAll(sel) {
    const cls = sel.replace(/^\./, '');
    return this.all.filter((n) => n.classList?.has(cls) || n.attrs?.[sel.replace(/[[\]]/g, '')] !== undefined);
  }
  querySelector(sel) {
    if (sel.startsWith('#')) return this.all.find((n) => n.attrs.id === sel.slice(1)) || null;
    if (sel.startsWith('[')) { const k = sel.slice(1, -1).split('=')[0]; return this.all.find((n) => n.dataset[k.replace('data-', '')] !== undefined || n.attrs[k] !== undefined) || null; }
    return this.querySelectorAll(sel)[0] || null;
  }
}
globalThis.Node = Node2;
const textNode = (s) => { const n = new Node2('#text'); n._text = String(s); return n; };

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const docEl = new Node2('html');
const byId = { main: new Node2('main'), nav: new Node2('nav'), 'due-badge': new Node2('span') };
globalThis.document = {
  documentElement: docEl,
  createElement: (t) => new Node2(t),
  createTextNode: textNode,
  getElementById: (id) => byId[id] ?? null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  scrollTo: () => {}, location: { hash: '' },
  SpeechRecognition: null, webkitSpeechRecognition: null,
};
globalThis.location = window.location;
globalThis.navigator = { mediaDevices: null };
globalThis.alert = () => {}; globalThis.confirm = () => false;
globalThis.fetch = async (p) => {
  const txt = await readFile(join(ROOT, p), 'utf8');
  return { json: async () => JSON.parse(txt), ok: true };
};
// No speechSynthesis: exercises the graceful-degradation paths on purpose.

/* ---------------- run ---------------- */
let fails = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (extra ? '  ' + extra : ''));
  if (!cond) fails++;
};

const { loadCorpus, buildQueue, cardFor, stats, stageProgress, availablePatterns, fillPattern } =
  await import('../js/deck.js');
const corpus = await loadCorpus();
ok('corpus loads all stages', corpus.sentences.length === 250 && corpus.units.length === 25 && corpus.stages.length === 5,
   `${corpus.sentences.length} sentences / ${corpus.units.length} units / ${corpus.stages.length} stages`);
ok('patterns load', corpus.patterns.length === 32, `${corpus.patterns.length} patterns`);
ok('every unit belongs to a known stage',
   corpus.units.every((u) => corpus.stageById[u.stage]));
ok('every sentence belongs to a known unit',
   corpus.sentences.every((s) => corpus.unitById[s.unit]));

// Patterns must compose into real sentences with no leftover placeholder.
const composed = corpus.patterns.flatMap((p) => p.slots.map((sl) => fillPattern(p, sl)));
ok('patterns compose cleanly', composed.every((c) => !c.hanzi.includes('{X}') && !c.pinyin.includes('{X}') && !c.en.includes('{X}')),
   `${composed.length} generatable sentences`);
ok('composed hanzi contains no latin filler',
   composed.every((c) => !/[a-z]{3,}/i.test(c.hanzi.replace('Wi-Fi',''))));

console.log('\nViews render');
const views = {
  dashboard: (await import('../js/views/dashboard.js')).default,
  tones: (await import('../js/views/tones.js')).default,
  review: (await import('../js/views/review.js')).default,
  speak: (await import('../js/views/speak.js')).default,
  drill: (await import('../js/views/drill.js')).default,
  library: (await import('../js/views/library.js')).default,
  settings: (await import('../js/views/settings.js')).default,
};
for (const [name, view] of Object.entries(views)) {
  const root = new Node2('div');
  try {
    const cleanup = await view(root, { navigate: () => {} });
    await new Promise((r) => setTimeout(r, 30)); // async views (settings) paint after returning
    const text = root.textContent;
    ok(`${name} renders`, root.children.length > 0 && text.length > 20, `${text.length} chars`);
    if (typeof cleanup === 'function') cleanup();
  } catch (err) {
    ok(`${name} renders`, false, err.stack.split('\n').slice(0, 2).join(' | '));
  }
}

console.log('\nStudy flow');
const { review: gradeCard } = await import('../js/fsrs.js');
const { get, update, bumpDaily } = await import('../js/store.js');
let q = buildQueue();
ok('fresh learner gets a queue', q.queue.length === 8 && q.due === 0, `${q.queue.length} cards (daily new limit)`);
ok('queue starts at stage 1', q.queue[0].id === 's001');

const stagesBefore = stageProgress();
ok('stage progress spans A1..C1', stagesBefore.map((s) => s.level).join(',') === 'A1,A2,B1,B2,C1');
ok('stage totals sum to the corpus', stagesBefore.reduce((a, s) => a + s.total, 0) === 250);
ok('only stage-1 patterns unlocked at the start',
   availablePatterns().every((p) => p.stage === 'st1'), `${availablePatterns().length} open`);

// Learn all 8 of today's new cards.
for (const s of q.queue) {
  const c = cardFor(s.id);
  update((st) => { st.cards[s.id] = gradeCard(c, 3); });
  bumpDaily('new');
}
ok('budget is spent after 8 new', buildQueue().queue.length === 0, 'queue empty for today');
const st = stats();
ok('stats track known sentences', st.known === 8, `known=${st.known} words=${st.words}`);
ok('words counted across sentences', st.words > 10, `${st.words} unique words met`);

// Re-render the dashboard now that there is progress — different branch.
const root2 = new Node2('div');
await views.dashboard(root2, { navigate: () => {} });
ok('dashboard re-renders with progress', root2.textContent.includes('Today'));

// Review view with an empty queue must show the caught-up state.
const root3 = new Node2('div');
await views.review(root3, { navigate: () => {} });
ok('review shows caught-up state', root3.textContent.includes('Nothing due'));

const stAfter = stageProgress();
ok('progress lands in stage 1', stAfter[0].done === 8 && stAfter[1].done === 0, `A1 ${stAfter[0].done}/${stAfter[0].total}`);
ok('current stage is A1', stats().stage.level === 'A1');

// Drill view renders and the picker lists unlocked patterns.
const rootD = new Node2('div');
const offD = await views.drill(rootD, { navigate: () => {} });
ok('drill view renders patterns', rootD.textContent.includes('Pattern drills') && rootD.textContent.length > 200,
   `${rootD.textContent.length} chars`);
if (offD) offD();

// Speak view should now draw from studied sentences.
const root4 = new Node2('div');
const off = await views.speak(root4, { navigate: () => {} });
ok('speak warns when recognition is unavailable', root4.textContent.includes('Chrome, Edge, or Safari'));
if (off) off();

console.log(fails ? `\n${fails} FAILING\n` : '\nAll view tests passed.\n');
process.exit(fails ? 1 : 0);
