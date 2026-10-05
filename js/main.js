/** App entry: hash router, nav state, view lifecycle, PWA install + offline. */

import { loadCorpus, dueCards } from './deck.js';
import { initVoices } from './tts.js';
import { load } from './store.js';
import { unlockAudio, toast } from './feedback.js';
import { startReminderLoop } from './reminder.js';
import { showVoiceHelp } from './voicehelp.js';

import dashboard from './views/dashboard.js';
import tones from './views/tones.js';
import review from './views/review.js';
import speak from './views/speak.js';
import drill from './views/drill.js';
import dialogue from './views/dialogue.js';
import script from './views/script.js';
import learn from './views/learn.js';
import library from './views/library.js';
import settings from './views/settings.js';

// '' is the guided path: a beginner who lands on a menu does not start.
const routes = { '': learn, learn, home: dashboard, tones, script, review, speak, drill, dialogue, library, settings };

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
  applyNavVisibility();

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
    if (location.protocol === 'file:') {
      d.innerHTML =
        '<b>Could not load the course data.</b><br>' +
        'If you opened this file directly, browsers block loading JSON from <code>file://</code>. ' +
        'Run a local server instead — <code>npm start</code> or <code>python -m http.server 8080</code> — ' +
        'then open <code>http://localhost:8080</code>.';
    } else {
      // Offline before the course was ever saved on this device — the one case
      // offline support cannot cover. Say exactly that, not something technical.
      d.innerHTML =
        '<b>The course is not saved on this device yet.</b><br>' +
        'Open the app once with an internet connection and leave it open for a few seconds. ' +
        'After that it works without internet. On iPhone, do this from the Home Screen icon ' +
        'if you use one — it keeps its own copy, separate from Safari.';
    }
    main.append(d);
    return;
  }
  initVoices();       // warm the voice list in the background
  // A 🔊 tap with no Mandarin voice installed would otherwise be pure silence.
  window.addEventListener('tts:novoice', () => showVoiceHelp(main));
  registerServiceWorker();
  setupInstall();
  primeAudioOnFirstTap();
  startReminderLoop((msg) => toast(msg, 'info', 6000));
  // Losing signal mid-lesson should not feel like the app broke.
  window.addEventListener('offline', () =>
    toast('You are offline. Lessons, review and audio keep working; only speech scoring needs internet.', 'info', 5000));
  window.addEventListener('online', () => toast('Back online.', 'info', 2000));
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
    // Ask the browser not to evict the offline copy. Safari otherwise clears
    // site data after ~7 days without a visit, and "it worked offline last
    // month" is not a promise worth making. A refusal changes nothing.
    navigator.storage?.persist?.().catch(() => {});
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

/**
 * Progressive disclosure.
 *
 * A complete beginner sees ONE tab. Everything else is noise that makes the
 * app look like a menu to get lost in — which was the actual complaint. Tabs
 * unlock as the lessons that justify them are finished, so what is on screen
 * is always something the learner can already use.
 */
function applyNavVisibility() {
  let done = 0;
  let cards = 0;
  try {
    const st = load();
    done = (st.lessons?.done || []).length;
    cards = Object.values(st.cards || {}).filter((c) => c.reps > 0).length;
  } catch { /* first run */ }

  for (const a of document.querySelectorAll('.tabbar a[data-needs]')) {
    const need = a.dataset.needs;
    const ok =
      need === 'cards' ? cards > 0 :
      need === 'always' ? true :
      done >= Number(need);
    a.hidden = !ok;
  }
}

function applyTheme() {
  const saved = localStorage.getItem('learnchinese.theme');
  if (saved) document.documentElement.dataset.theme = saved;
}

boot();
