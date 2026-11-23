// The service worker (M3-03, D-151): the app works offline once it has loaded. The build fills in the cache name, one
// per build (a hash of its files' names and contents), and the list of every file it wrote (`vite.config.ts`), so
// installing caches the whole app. Pages come from the network first, so a new build is seen as soon as there is one;
// the hashed files never change, so they come from the cache first. Once this build takes over it deletes the app's
// older builds, and only those: other caches (the card art, M3-08) have names of their own.

const APP = "open-mtg-arena-app-";
const CACHE = "__CACHE_NAME__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // `reload`: straight from the server, past the browser's HTTP cache, so an old page can't join the new files.
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => names.filter((name) => name.startsWith(APP) && name !== CACHE))
      .then((old) => Promise.all(old.map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    // Offline, any page is the app's one page, cached under the base it's served from (the manifest's start_url): "/",
    // or "/open-mtg-arena/" on GitHub Pages, the service worker's own folder.
    event.respondWith(
      fetch(request).catch(() => caches.match(new URL("./", self.location).href, { ignoreVary: true })),
    );
    return;
  }
  // `ignoreVary`: module scripts are requested with an Origin header the install's requests didn't send, and a server
  // that answers "Vary: Origin" would otherwise make every cached script miss.
  event.respondWith(caches.match(request, { ignoreVary: true }).then((cached) => cached ?? fetch(request)));
});
