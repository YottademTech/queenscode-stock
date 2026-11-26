// Makes the installed app open fast, and open at all without a signal.
//
// Only this app's own files are kept: the page, its scripts and styles, the icons. Requests to the
// stock server and to Google Drive are never touched, so nothing here can hold back a save or show
// an old stock figure.
//
// - The page is fetched from the network first, so a new version shows the next time the app is
//   opened online. Without a signal, the last page kept is used.
// - Scripts and styles are named after their contents (index-AbC123.js), so a kept copy is never
//   out of date. Copies no page uses any more are removed.
const CACHE = 'stock-app';
const SHELL = ['./', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png', './favicon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(fromNetworkFirst(request));
  } else if (url.pathname.includes('/assets/')) {
    event.respondWith(fromCacheFirst(request));
  }
});

async function fromNetworkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put('./', response.clone());
      void forgetUnusedAssets(cache, await response.clone().text());
    }
    return response;
  } catch {
    return (await cache.match('./')) ?? Response.error();
  }
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

/**
 * Removes kept files that the current page no longer uses: the scripts and styles it names, and
 * the files those scripts name in turn (the logo, for one).
 */
async function forgetUnusedAssets(cache, page) {
  const named = (text) => new Set(text.match(/[\w.-]+-[\w-]{8}\.\w+/g) ?? []);
  const used = named(page);
  for (const file of [...used].filter((name) => name.endsWith('.js'))) {
    const script = await cache.match(new URL(`./assets/${file}`, self.registration.scope).href);
    if (script) for (const name of named(await script.text())) used.add(name);
  }
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.includes('/assets/') && !used.has(path.slice(path.lastIndexOf('/') + 1))) await cache.delete(request);
  }
}
