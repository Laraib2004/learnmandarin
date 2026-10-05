/**
 * Service worker — offline support.
 *
 * This is not a nice-to-have for a study app: people review on the metro, on
 * planes, and in places with no signal. Since the whole course is static JSON
 * and the audio comes from the OS speech engine, the app can work fully offline
 * once cached. Nothing here talks to a network service.
 *
 * Strategy:
 *   - App shell + course data: precached on install, served cache-first.
 *   - Navigations: network-first so a fresh deploy is picked up promptly — but
 *     with a short timeout. A dead connection fails fast; a *weak* one (the
 *     metro, a captive portal) can hang for a minute, and "network-first with
 *     no timeout" is exactly how an offline-capable app looks broken offline.
 *
 * Cache lookups ignore `Vary` and, for navigations and fallbacks, the query
 * string. GitHub Pages sends `Vary: Accept-Encoding` on everything, and Safari
 * has refused to match cached entries because of it; a `?v=` cache-buster or a
 * share link with a query must still open the saved app.
 *
 * Bump CACHE when shipping changed assets — the old cache is dropped on activate.
 */

const CACHE = 'shuoba-v10';
const NAV_TIMEOUT_MS = 3000;

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/main.js',
  './js/ui.js',
  './js/store.js',
  './js/deck.js',
  './js/fsrs.js',
  './js/tts.js',
  './js/asr.js',
  './js/feedback.js',
  './js/reminder.js',
  './js/pitch.js',
  './js/voicehelp.js',
  './js/views/dashboard.js',
  './js/views/tones.js',
  './js/views/review.js',
  './js/views/speak.js',
  './js/views/drill.js',
  './js/views/dialogue.js',
  './js/views/script.js',
  './js/views/learn.js',
  './js/views/library.js',
  './js/views/settings.js',
  './data/course.json',
  './data/tones.json',
  './data/patterns.json',
  './data/dialogues.json',
  './data/pinyin.json',
  './data/characters.json',
  './data/lessons.json',
  './data/corpus/st1.json',
  './data/corpus/st2.json',
  './data/corpus/st3.json',
  './data/corpus/st4.json',
  './data/corpus/st5.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // addAll fails the whole install if any single file 404s; add individually
      // so one renamed asset cannot brick offline support entirely.
      await Promise.all(
        PRECACHE.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch((err) => {
            console.warn('[sw] could not precache', url, err);
          }),
        ),
      );
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

/** Only a plain, successful, same-origin response is worth keeping offline. */
const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected;

function store(request, res) {
  if (!cacheable(res)) return;
  const copy = res.clone();
  caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
}

/** The saved app page, however it was asked for. */
async function savedShell(request) {
  return (await caches.match(request, { ignoreVary: true, ignoreSearch: true }))
    || (await caches.match('./index.html', { ignoreVary: true, ignoreSearch: true }))
    || (await caches.match('./', { ignoreVary: true, ignoreSearch: true }));
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // Navigations: try the network briefly so updates land, else the saved shell.
  if (request.mode === 'navigate') {
    const network = fetch(request);
    // Even if we give up waiting, a late response still refreshes the cache.
    event.waitUntil(network.then((res) => store(request, res)).catch(() => {}));
    event.respondWith(
      withTimeout(network, NAV_TIMEOUT_MS)
        .then((res) => (res.ok ? res : savedShell(request).then((s) => s || res)))
        .catch(async () => (await savedShell(request)) || Response.error()),
    );
    return;
  }

  // Everything else: cache-first, refreshing the entry in the background.
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then((cached) => {
      const network = fetch(request)
        .then((res) => { store(request, res); return res; })
        .catch(async () => cached
          || (await caches.match(request, { ignoreVary: true, ignoreSearch: true }))
          || Response.error());
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    }),
  );
});
