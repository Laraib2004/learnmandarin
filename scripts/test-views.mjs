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
const bodyEl = new Node2('body');
bodyEl.contains = (n) => bodyEl.all.includes(n);
globalThis.document = {
  body: bodyEl,
  documentElement: docEl,
  createElement: (t) => new Node2(t),
  createElementNS: (_ns, t) => new Node2(t),   // pitch.js draws contour SVGs
  createTextNode: textNode,
  getElementById: (id) => byId[id] ?? null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
};
globalThis.navigator = { mediaDevices: null, userAgent: 'node-test' };
globalThis.window = {
  addEventListener: () => {}, removeEventListener: () => {},
  scrollTo: () => {}, location: { hash: '' },
  SpeechRecognition: null, webkitSpeechRecognition: null,
  navigator: globalThis.navigator,
  matchMedia: () => ({ matches: false }),
};
globalThis.location = window.location;
globalThis.alert = () => {}; globalThis.confirm = () => false;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
// No AudioContext and no navigator.vibrate: feedback.js must degrade silently.
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
ok('dialogues load', corpus.dialogues.length === 10, `${corpus.dialogues.length} dialogues`);

// The bidirectional requirement: turns must alternate, and both directions
// must be represented, or a "conversation" is really a one-way drill.
let alternates = true, youTurns = 0, partnerTurns = 0;
for (const d of corpus.dialogues) {
  let prev = null;
  for (const t of d.turns) {
    if (t.who === prev) alternates = false;
    prev = t.who;
    if (t.who === 'you') youTurns++; else partnerTurns++;
    if (!t.hanzi || !t.pinyin || !t.en) alternates = false;
  }
}
ok('dialogue turns strictly alternate', alternates);
ok('both directions present (ZH->EN and EN->ZH)', youTurns > 0 && partnerTurns > 0,
   `${partnerTurns} comprehension / ${youTurns} production`);
ok('directions are balanced', Math.abs(youTurns - partnerTurns) <= 2,
   `diff ${Math.abs(youTurns - partnerTurns)}`);
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
  dialogue: (await import('../js/views/dialogue.js')).default,
  script: (await import('../js/views/script.js')).default,
  learn: (await import('../js/views/learn.js')).default,
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

console.log('\nFeedback degradation');
const fb = await import('../js/feedback.js');
ok('haptics reported unsupported without navigator.vibrate', fb.hapticsSupported() === false);
ok('haptic() returns false instead of throwing', fb.haptic('success') === false);
let threwFb = null;
try { fb.cue('correct'); fb.unlockAudio(); fb.signal('correct', 'hello'); }
catch (e) { threwFb = e; }
ok('cue/signal survive a missing AudioContext', threwFb === null, threwFb ? threwFb.message : '');

console.log('\nPWA assets');
const { readFile: rf, stat } = await import('node:fs/promises');
const manifest = JSON.parse(await rf(join(ROOT, 'manifest.webmanifest'), 'utf8'));
ok('manifest is standalone', manifest.display === 'standalone');
ok('manifest has start_url + scope', Boolean(manifest.start_url && manifest.scope));
ok('manifest declares a maskable icon',
   manifest.icons.some((i) => (i.purpose || '').includes('maskable')));
for (const i of manifest.icons) {
  const st2 = await stat(join(ROOT, i.src)).catch(() => null);
  ok(`icon exists: ${i.src}`, Boolean(st2 && st2.size > 500), st2 ? `${st2.size} bytes` : 'MISSING');
}
ok('apple-touch-icon exists', Boolean(await stat(join(ROOT, 'icons/apple-touch-icon.png')).catch(() => null)));

const html = await rf(join(ROOT, 'index.html'), 'utf8');
ok('viewport uses viewport-fit=cover (safe areas)', html.includes('viewport-fit=cover'));
ok('links the manifest', html.includes('manifest.webmanifest'));
ok('declares apple-mobile-web-app-capable', html.includes('apple-mobile-web-app-capable'));
ok('has apple-touch-icon link', html.includes('apple-touch-icon'));
ok('theme-color responds to colour scheme', (html.match(/name="theme-color"/g) || []).length >= 2);

const swSrc = await rf(join(ROOT, 'sw.js'), 'utf8');
const css = await rf(join(ROOT, 'css/app.css'), 'utf8');
// Every precached path must actually exist, or offline mode silently degrades.
const precache = [...swSrc.matchAll(/'(\.\/[^']+)'/g)].map((m) => m[1]).filter((p) => p !== './');
const missing = [];
for (const rel of precache) {
  if (!(await stat(join(ROOT, rel.slice(2))).catch(() => null))) missing.push(rel);
}
ok('every precached asset exists', missing.length === 0, missing.join(', ') || `${precache.length} files verified`);

// The reverse check: everything the app can load must be precached, or a new
// module (voicehelp.js was nearly one) silently breaks offline use.
{
  const { readdir } = await import('node:fs/promises');
  const shipped = [];
  for (const dir of ['js', 'js/views', 'data', 'data/corpus', 'css', 'icons']) {
    for (const f of await readdir(join(ROOT, dir), { withFileTypes: true })) {
      if (f.isFile() && /\.(js|json|css|png)$/.test(f.name)) shipped.push(`./${dir}/${f.name}`);
    }
  }
  const notCached = shipped.filter((f) => !precache.includes(f));
  ok('every shipped file is precached for offline use', notCached.length === 0,
     notCached.join(', ') || `${shipped.length} files`);
}

// Run the real sw.js against a fake offline world.
{
  const vm = await import('node:vm');
  const listeners = {};
  const store = new Map();             // url -> body
  const norm = (u) => new URL(u, 'https://x.test/app/').href;
  const strip = (u) => u.split('?')[0];
  const cacheApi = {
    async match(req, opts = {}) {
      const u = norm(typeof req === 'string' ? req : req.url);
      if (store.has(u)) return { body: store.get(u), ok: true };
      if (opts.ignoreSearch) for (const [k, v] of store) if (strip(k) === strip(u)) return { body: v, ok: true };
      return undefined;
    },
    async put(req, res) { store.set(norm(req.url || req), res.body); },
    async add(req) { store.set(norm(req.url || req), `cached:${new URL(norm(req.url || req)).pathname}`); },
  };
  let network = 'offline';               // 'offline' | 'hang' | 'online'
  const sandbox = {
    self: { addEventListener: (t, fn) => { listeners[t] = fn; }, location: { origin: 'https://x.test' },
            skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => cacheApi, keys: async () => [], delete: async () => true,
              match: (r, o) => cacheApi.match(r, o) },
    fetch: (req) => network === 'offline' ? Promise.reject(new TypeError('Failed to fetch'))
      : network === 'hang' ? new Promise(() => {})
      : Promise.resolve({ ok: true, type: 'basic', redirected: false, body: 'fresh', clone() { return this; } }),
    Request: class { constructor(url) { this.url = norm(url); } },
    Response: { error: () => ({ error: true }) },
    URL, setTimeout, clearTimeout, console: { warn() {} },
  };
  const swCode = (await rf(join(ROOT, 'sw.js'), 'utf8')).replace(/NAV_TIMEOUT_MS = \d+/, 'NAV_TIMEOUT_MS = 50');
  vm.runInNewContext(swCode, sandbox);
  await new Promise((done) => listeners.install({ waitUntil: (p) => p.then(done) }));

  const request = (path, mode = 'cors') => ({ url: norm(path), method: 'GET', mode });
  const respond = (req) => new Promise((resolve) => listeners.fetch({
    request: req, respondWith: (p) => Promise.resolve(p).then(resolve), waitUntil() {},
  }));

  network = 'offline';
  ok('offline: the home-screen start page opens from cache',
     (await respond(request('index.html', 'navigate')))?.body === 'cached:/app/index.html');
  ok('offline: the site root opens from cache',
     (await respond(request('', 'navigate')))?.body?.startsWith('cached:/app/'));
  ok('offline: a link with a query string still opens the app',
     (await respond(request('?ref=share', 'navigate')))?.body?.startsWith('cached:/app/'));
  ok('offline: course data loads from cache',
     (await respond(request('data/lessons.json')))?.body === 'cached:/app/data/lessons.json');
  network = 'hang';
  const t0 = Date.now();
  // Raced against a deadline so a regression fails the test instead of hanging the suite.
  const hung = await Promise.race([respond(request('index.html', 'navigate')),
    new Promise((r) => setTimeout(() => r(null), 2000))]);
  ok('a hanging connection falls back to the saved app instead of spinning',
     hung?.body === 'cached:/app/index.html' && Date.now() - t0 < 1000, `${Date.now() - t0}ms`);
  network = 'online';
  ok('online: navigations get the fresh page', (await respond(request('index.html', 'navigate')))?.body === 'fresh');
}

ok('css honours safe-area insets', css.includes('env(safe-area-inset-bottom'));
ok('css uses dvh not bare vh for full height', css.includes('100dvh') && !/min-height:\s*100vh/.test(css));
ok('inputs are >=16px so iOS will not zoom on focus', css.includes('font-size: 16px'));
ok('tab bar clears the home indicator', css.includes('padding-bottom: var(--sab)'));
ok('touch targets meet the 44px HIG minimum', css.includes('--tap: 44px'));
ok('reduced-motion is respected', css.includes('prefers-reduced-motion'));
ok('tap highlight suppressed for native feel', css.includes('-webkit-tap-highlight-color'));
ok('[hidden] beats our own display rules',
   /\[hidden\]\s*\{\s*display:\s*none\s*!important/.test(css),
   'without this, el.hidden silently does nothing on .tabbar a');

// Regressions caught by real-browser testing, cheap to re-check here.
const mainSrc = await rf(join(ROOT, 'js/main.js'), 'utf8');
ok('service worker registers even if load already fired',
   mainSrc.includes("document.readyState === 'complete'"),
   'registerServiceWorker must not rely on a window load listener alone');
ok('wide layout reorders nav above content',
   css.includes('.tabbar { order: 2; }') && css.includes('.main   { order: 3; }'),
   'sticky does not reorder the DOM; the bar is after <main> in source');


console.log('\nScript track (pinyin + characters)');
ok('pinyin data loads', corpus.pinyin.initials.length === 21 && corpus.pinyin.finals.length > 20,
   `${corpus.pinyin.initials.length} initials / ${corpus.pinyin.finals.length} finals`);
ok('pinyin traps documented', corpus.pinyin.traps.length >= 8, `${corpus.pinyin.traps.length} traps`);
ok('the q/x/j trap is covered', corpus.pinyin.traps.some((t) => t.id === 'qxj'));
ok('every sound has a playable example',
   [...corpus.pinyin.initials, ...corpus.pinyin.finals].every((x) => x.eg && x.eg.h && x.eg.p));
ok('discrimination pairs exist', corpus.pinyin.pairs.length >= 8, `${corpus.pinyin.pairs.length} pairs`);

const chars = corpus.characters.characters;
ok('characters load', chars.length >= 60, `${chars.length} characters`);
ok('components load', corpus.characters.components.length >= 35,
   `${corpus.characters.components.length} components`);
ok('stroke rules present', corpus.characters.strokeRules.length === 8);
ok('every character is a real CJK glyph and fully described',
   chars.every((c) => /^[\u4e00-\u9fff]$/.test(c.c) && c.p && c.e && c.story && c.strokes > 0));
ok('no duplicate characters', new Set(chars.map((c) => c.c)).size === chars.length);

// The pedagogical claim: these characters must actually cover the course text.
const freq = new Map();
for (const s of corpus.sentences) for (const ch of s.hanzi) {
  if (/[\u4e00-\u9fff]/.test(ch)) freq.set(ch, (freq.get(ch) || 0) + 1);
}
const totalTok = [...freq.values()].reduce((a, b) => a + b, 0);
const taught = new Set(chars.map((c) => c.c));
const covered = [...freq.entries()].filter(([ch]) => taught.has(ch)).reduce((a, [, n]) => a + n, 0);
const pct = Math.round((covered / totalTok) * 100);
ok('taught characters cover most of the course text', pct >= 50, `${pct}% of character tokens`);

console.log('\nSession resume');
const storeMod = await import('../js/store.js');
storeMod.clearSession();
ok('no session when nothing started', storeMod.getSession() === null);
storeMod.saveSession('dialogue', { id: 'd01', turn: 3, title: 'Meeting someone new' });
const sess = storeMod.getSession();
ok('session is recorded', sess?.view === 'dialogue' && sess.detail.turn === 3);
ok('session carries a human label', sess.detail.title === 'Meeting someone new');
// A stale session is noise, not help.
storeMod.update((st) => { st.session.at = Date.now() - 8 * 86400000; });
ok('week-old sessions are ignored', storeMod.getSession() === null);
storeMod.clearSession();
ok('clearSession wipes it', storeMod.getSession() === null);

console.log('\nDaily reminder');
const rem = await import('../js/reminder.js');
storeMod.update((st) => {
  st.settings.reminderOn = false;
  st.settings.reminderTime = '15:00';
  st.lastReminded = null;
  st.daily = {};
});
ok('no nudge while the reminder is off', rem.reminderDue(new Date(2026, 0, 1, 18, 0)) === false);
storeMod.update((st) => { st.settings.reminderOn = true; });
ok('no nudge before the chosen time', rem.reminderDue(new Date(2026, 0, 1, 9, 0)) === false);
ok('nudge once the time has passed', rem.reminderDue(new Date(2026, 0, 1, 15, 30)) === true);
storeMod.bumpDaily('reviews');
ok('no nudge if you already studied today', rem.reminderDue(new Date(2026, 0, 1, 18, 0)) === false);
storeMod.update((st) => { st.daily = {}; });
rem.markReminded();
ok('nudges only once per day', rem.reminderDue(new Date(2026, 0, 1, 18, 0)) === false);

// The layer that actually works: a real OS calendar alarm, no server involved.
const ics = rem.buildICS('15:00');
ok('ICS is a valid calendar', ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
ok('ICS repeats daily', ics.includes('RRULE:FREQ=DAILY'));
ok('ICS carries an alarm', ics.includes('BEGIN:VALARM') && ics.includes('ACTION:DISPLAY'));
ok('ICS uses floating local time (fires at 15:00 wherever you are)',
   /DTSTART:\d{8}T150000$/m.test(ics), ics.match(/DTSTART:[^\r\n]*/)?.[0]);
ok('ICS honours a custom time', /DTSTART:\d{8}T073000$/m.test(rem.buildICS('07:30')));
ok('ICS uses CRLF line endings as the spec requires', ics.includes('\r\n'));
storeMod.update((st) => { st.settings.reminderOn = false; st.lastReminded = null; });


const storeMod2 = await import('../js/store.js');
const deckModEarly = await import('../js/deck.js');
console.log('\nGuided path');
const L = corpus.lessons;
ok('lessons load', L.lessons.length === 22 && L.units.length === 4,
   `${L.lessons.length} lessons across ${L.units.length} units`);
ok('the path starts with pinyin', L.lessons[0].unit === 'A' && L.units[0].title.startsWith('Pinyin'));
ok('lesson ids are unique', new Set(L.lessons.map((l) => l.id)).size === L.lessons.length);
ok('every lesson has steps and a duration',
   L.lessons.every((l) => l.steps.length > 0 && l.minutes > 0));
ok('every unit ref is real',
   L.lessons.every((l) => L.units.some((u) => u.id === l.unit)));

// A quiz step with no correct answer, or two, silently breaks the lesson.
const quiz = L.lessons.flatMap((l) => l.steps.filter((s) => s.type === 'pick' || s.type === 'read'));
ok('every quiz has exactly one correct option',
   quiz.every((s) => s.options.filter((o) => o.correct).length === 1), `${quiz.length} quizzes`);
ok('every option explains itself', quiz.every((s) => s.options.every((o) => o.why)));
const toneQs = L.lessons.flatMap((l) => l.steps.filter((s) => s.type === 'pickTone'));
ok('tone questions have a valid answer', toneQs.every((s) => s.answer >= 1 && s.answer <= 4),
   `${toneQs.length} tone questions`);
ok('units are ordered pinyin -> words -> characters -> sentences',
   L.units.map((u) => u.id).join('') === 'ABDC');

// Character steps render from characters.json, so a typo is a blank card.
const charSteps = L.lessons.flatMap((l) => l.steps.filter((s) => s.type === 'char'));
ok('every character step names a known character or building block',
   charSteps.length > 0 && charSteps.every((s) => deckModEarly.lookupGlyph(s.c)),
   `${charSteps.length} character steps`);
ok('squeezed forms resolve to their building block',
   deckModEarly.lookupGlyph('亻')?.entry.c === '人' && deckModEarly.lookupGlyph('讠')?.entry.c === '言');
ok('the character unit teaches before it tests',
   L.lessons.filter((l) => l.unit === 'D').every((l) => l.steps.findIndex((s) => s.type === 'char') <
     l.steps.findIndex((s) => s.type === 'pick')));

// The whole point: lessons must feed the scheduler, or Review stays empty.
const deckMod = await import('../js/deck.js');
storeMod2.update((st) => { st.cards = {}; });
let totalSeeded = 0;
for (const l of L.lessons) totalSeeded += deckMod.seedFromLesson(l).length;
ok('finishing the path seeds review cards', totalSeeded > 0,
   `${totalSeeded} sentences handed to the scheduler`);
ok('seeded cards are due later, not instantly',
   Object.values(storeMod2.get().cards).every((c) => c.due > Date.now()));
storeMod2.update((st) => { st.charCards = {}; });
let charsSeeded = 0;
for (const l of L.lessons) charsSeeded += deckMod.seedCharsFromLesson(l).length;
ok('character lessons feed the Script track, not the sentence queue',
   charsSeeded > 0 && Object.keys(storeMod2.get().charCards).every((c) => deckMod.lookupGlyph(c)?.kind === 'char'),
   `${charsSeeded} characters scheduled`);
storeMod2.update((st) => { st.charCards = {}; });
storeMod2.update((st) => { st.cards = {}; });

console.log('\nTone synthesis (works with no Mandarin voice installed)');
const pitchMod = await import('../js/pitch.js');
ok('all five tones have contours', [1, 2, 3, 4, 5].every((t) => pitchMod.CONTOURS[t]?.levels?.length >= 2));
ok('tone 1 is flat', new Set(pitchMod.CONTOURS[1].levels).size === 1);
ok('tone 2 rises', pitchMod.CONTOURS[2].levels.at(-1) > pitchMod.CONTOURS[2].levels[0]);
ok('tone 4 falls', pitchMod.CONTOURS[4].levels.at(-1) < pitchMod.CONTOURS[4].levels[0]);
ok('tone 3 dips to the bottom', Math.min(...pitchMod.CONTOURS[3].levels) === 1);
ok('contour SVG renders without a real DOM', Boolean(pitchMod.contourSVG(2)));
let pitchThrew = null;
try { await pitchMod.playTone(3); pitchMod.unlock(); } catch (e) { pitchThrew = e; }
ok('playTone degrades silently with no AudioContext', pitchThrew === null,
   pitchThrew ? pitchThrew.message : '');


// The iPhone failure: after speech plays, Safari leaves the tone context
// 'interrupted' (not 'suspended'), and every tone went silent.
{
  const events = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  class FakeCtx {
    constructor() { this.state = 'interrupted'; this.currentTime = 0; this.destination = {}; }
    resume() { events.push('resume'); this.state = 'running'; return Promise.resolve(); }
    createOscillator() {
      const ctx = this;
      return { frequency: param(), connect: (n) => n, start() { events.push('start:' + ctx.state); }, stop() {} };
    }
    createGain() { return { gain: param(), connect: (n) => n }; }
  }
  window.AudioContext = FakeCtx;
  const session = { type: 'auto' };
  const prevNav = globalThis.navigator;
  globalThis.navigator = { ...prevNav, audioSession: session };
  await pitchMod.playTone(2, { rate: 50 });
  globalThis.navigator = prevNav;
  delete window.AudioContext;
  ok('an interrupted tone context is resumed before playing', events[0] === 'resume' && events.includes('start:running'),
     events.join(' → '));
  ok('tones ask for a playback audio session (not muted by the silent switch)', session.type === 'playback');
}

console.log('\nAccessibility');
const uiMod = await import('../js/ui.js');
ok('hanzi elements are marked lang=zh-CN', uiMod.h('div', { class: 'zh zh-lg' }, '你好').getAttribute('lang') === 'zh-CN');
ok('non-Chinese elements are left alone', uiMod.h('div', { class: 'zhuyin-free' }).getAttribute('lang') === null);
ok('pinyin is marked as romanised Chinese', uiMod.pinyinEl('nǐ hǎo').getAttribute('lang') === 'zh-Latn-pinyin');
storeMod2.update((st) => { st.settings.toneNumbers = true; });
const numbered = uiMod.pinyinEl('nǐ hǎo ma');
ok('tone numbers mark tone without colour', numbered.all.filter((n) => n.tagName === 'SUP').map((n) => n.textContent).join('') === '33',
   numbered.textContent);
storeMod2.update((st) => { st.settings.toneNumbers = false; });
ok('tone numbers are off by default', uiMod.pinyinEl('nǐ').all.every((n) => n.tagName !== 'SUP'));
ok('"said as" appears only when sandhi changes something',
   uiMod.spokenNote('nǐ hǎo', 'ní hǎo') !== null && uiMod.spokenNote('xièxie', 'xièxie') === null);
const learnView = (await import('../js/views/learn.js')).default;
const learnCleanup = learnView(new Node2('main'), { navigate: () => {} });
ok('the path registers keyboard shortcuts and cleans them up', typeof learnCleanup === 'function');
learnCleanup?.();

console.log('\nSpeech with no Mandarin voice');
// The failure a real learner hit: no Chinese voice, so every play button was
// silent with no explanation. speak() must settle and announce, never hang.
const ttsMod = await import('../js/tts.js');
const initSettled = await Promise.race([ttsMod.initVoices().then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]);
ok('initVoices always settles, even with no voices at all', initSettled);
let announced = null;
const prevDispatch = window.dispatchEvent;
window.dispatchEvent = (e) => { announced = e?.detail?.reason ?? 'event'; return true; };
globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, init) { this.type = type; this.detail = init?.detail; } };
const spoke = await Promise.race([ttsMod.speak('你好').then(() => true), new Promise((r) => setTimeout(() => r(false), 2000))]);
window.dispatchEvent = prevDispatch;
ok('speak() resolves when it cannot speak', spoke);
ok('speak() announces the missing voice so the app can explain', announced !== null, String(announced));

console.log(fails ? `\n${fails} FAILING\n` : '\nAll view tests passed.\n');
process.exit(fails ? 1 : 0);
