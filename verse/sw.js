// Offline support: the whole app, including the bundled Bible, is cached on first visit.
const VERSION = 'versebeam-v1';
const SHELL = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'js/app.js', 'js/books.js', 'js/importers.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
const DATA = ['data/kjv.json', 'data/strongs.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll([...SHELL, ...DATA])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('versebeam-') && k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    const isData = DATA.some((path) => request.url.endsWith(path));
    if (cached && isData) return cached;
    // App files: answer from the cache at once, and refresh the copy in the background when online.
    const refresh = fetch(request).then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    });
    if (cached) { refresh.catch(() => {}); return cached; }
    return refresh;
  })());
});
