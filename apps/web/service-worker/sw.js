// The service worker (M3-03): the app works offline once it has loaded. The build fills in the cache name, one per
// build, and the list of every file it wrote (`vite.config.ts`, `serviceWorker`), so installing caches the whole app.
// Pages come from the network first, so a new build is seen as soon as there is one; the hashed files never change,
// so they come from the cache first. Old builds' caches are deleted once this one takes over.

const CACHE = "__CACHE_NAME__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("/index.html", { ignoreVary: true })));
    return;
  }
  // `ignoreVary`: module scripts are requested with an Origin header the install's requests didn't send, and a server
  // that answers "Vary: Origin" would otherwise make every cached script miss.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request)));
});
