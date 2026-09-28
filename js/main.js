/** App entry: hash router, nav state, view lifecycle, PWA install + offline. */

import { loadCorpus, dueCards } from './deck.js';
import { initVoices } from './tts.js';
import { load } from './store.js';
import { unlockAudio, toast } from './feedback.js';

import dashboard from './views/dashboard.js';
import tones from './views/tones.js';
import review from './views/review.js';
import speak from './views/speak.js';
import drill from './views/drill.js';
import dialogue from './views/dialogue.js';
import library from './views/library.js';
import settings from './views/settings.js';

const routes = { '': dashboard, tones, review, speak, drill, dialogue, library, settings };

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

  // Both the tab bar and the header icon buttons carry data-route.
  for (const a of document.querySelectorAll('[data-route]')) {
    if (a.dataset.route === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
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
  badge.textContent = n > 99 ? '99+' : String(n);
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
  initVoices();       // warm the voice list in the background
  registerServiceWorker();
  setupInstall();
  primeAudioOnFirstTap();
  window.addEventListener('hashchange', render);
  await render();
}

/**
 * Offline support. Registered only over http(s) — a file:// page has no service
 * worker, and the app already explains that case.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (!location.protocol.startsWith('http')) return;

  const go = () => {
    navigator.serviceWorker.register('sw.js').catch((err) => {
      console.warn('Service worker registration failed:', err);
    });
  };

  // This runs after `await loadCorpus()`, so the window `load` event has
  // usually fired already. Listening for it unconditionally means the callback
  // never runs and offline support silently never activates — check first.
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
}

/**
 * Install button.
 *
 * Chrome/Edge/Android fire `beforeinstallprompt`, so we can offer a real
 * one-tap install. **iOS Safari does not** — there is no API to trigger
 * installation there, so on iPhone the button explains the
 * Share -> Add to Home Screen route rather than pretending to do it.
 */
function setupInstall() {
  const btn = document.getElementById('install');
  if (!btn) return;

  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return; // already installed, nothing to offer

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  let deferred = null;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });

  if (isIOS) {
    btn.hidden = false;
    btn.addEventListener('click', () => {
      toast('Tap Share, then "Add to Home Screen"', 'info', 4200);
    });
    return;
  }

  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
    if (outcome === 'accepted') toast('Installed - open it from your home screen', 'correct');
  });

  window.addEventListener('appinstalled', () => { btn.hidden = true; });
}

/** Browsers block audio until a user gesture; take the first one we get. */
function primeAudioOnFirstTap() {
  const once = () => {
    unlockAudio();
    document.removeEventListener('pointerdown', once);
    document.removeEventListener('keydown', once);
  };
  document.addEventListener('pointerdown', once, { once: true });
  document.addEventListener('keydown', once, { once: true });
}

function applyTheme() {
  const saved = localStorage.getItem('learnchinese.theme');
  if (saved) document.documentElement.dataset.theme = saved;
}

boot();
