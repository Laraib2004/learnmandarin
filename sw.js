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
 *   - Navigations: network-first with a cache fallback, so a fresh deploy is
 *     picked up promptly but a dead connection still opens the app.
 *
 * Bump CACHE when shipping changed assets — the old cache is dropped on activate.
 */

const CACHE = 'shuoba-v8';

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
  './icons/apple-touch-icon.png',
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

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin

  // Navigations: try the network so updates land, fall back to the shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        })
        .catch(async () => (await caches.match(request)) || (await caches.match('./index.html'))),
    );
    return;
  }

  // Everything else: cache-first, refreshing the entry in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
