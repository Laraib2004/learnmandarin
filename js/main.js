/** App entry: hash router, nav state, view lifecycle. */

import { loadCorpus, dueCards } from './deck.js';
import { initVoices } from './tts.js';
import { load } from './store.js';

import dashboard from './views/dashboard.js';
import tones from './views/tones.js';
import review from './views/review.js';
import speak from './views/speak.js';
import library from './views/library.js';
import settings from './views/settings.js';

const routes = { '': dashboard, tones, review, speak, library, settings };

const main = document.getElementById('main');
let cleanup = null;

function currentRoute() {
  return (location.hash.replace(/^#\/?/, '').split('/')[0] || '').toLowerCase();
}

async function render() {
  const name = currentRoute();
  const view = routes[name] || dashboard;

  if (typeof cleanup === 'function') cleanup();
  cleanup = null;

  for (const a of document.querySelectorAll('.nav a')) {
    a.toggleAttribute('aria-current', a.dataset.route === name);
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
  }

  main.replaceChildren();
  try {
    cleanup = await view(main, { navigate });
  } catch (err) {
    console.error(err);
    main.replaceChildren();
    const p = document.createElement('div');
    p.className = 'notice warn';
    p.textContent = `Something broke rendering this page: ${err.message}`;
    main.append(p);
  }
  main.focus({ preventScroll: true });
  window.scrollTo({ top: 0 });
  refreshBadge();
}

export function navigate(path) {
  location.hash = path.startsWith('#') ? path : `#/${path}`;
}

export function refreshBadge() {
  const badge = document.getElementById('due-badge');
  if (!badge) return;
  let n = 0;
  try { n = dueCards().length; } catch { n = 0; }
  badge.textContent = String(n);
  badge.hidden = n === 0;
}

async function boot() {
  load();
  applyTheme();
  try {
    await loadCorpus();
  } catch (err) {
    main.replaceChildren();
    const d = document.createElement('div');
    d.className = 'notice warn';
    d.innerHTML =
      '<b>Could not load the course data.</b><br>' +
      'If you opened this file directly, browsers block loading JSON from <code>file://</code>. ' +
      'Run a local server instead — <code>npm start</code> or <code>python -m http.server 8080</code> — ' +
      'then open <code>http://localhost:8080</code>.';
    main.append(d);
    return;
  }
  initVoices(); // warm the voice list in the background
  window.addEventListener('hashchange', render);
  await render();
}

function applyTheme() {
  const saved = localStorage.getItem('learnchinese.theme');
  if (saved) document.documentElement.dataset.theme = saved;
}

boot();
