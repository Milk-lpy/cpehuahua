// Bump this whenever the deployed app shell changes so an installed iPhone
// PWA cannot keep serving an older JavaScript bundle indefinitely.
const CACHE_NAME = "cpehuahua-shell-v6";
const BASE_PATH = new URL("./", self.location).pathname;
const API_PATH = BASE_PATH === "/" ? "/api/" : `${BASE_PATH}api/`;
const APP_SHELL = [BASE_PATH, `${BASE_PATH}index.html`, `${BASE_PATH}manifest.webmanifest`];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (
    event.request.method !== "GET"
    || requestUrl.origin !== self.location.origin
    // Never cache a Bridge response if a deployment happens to share origin.
    || requestUrl.pathname.startsWith(API_PATH)
  ) {
    return;
  }

  // Prefer the newest hosted shell when the phone is online, while retaining
  // the cached shell as the offline fallback for an H168-only connection.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(`${BASE_PATH}index.html`, copy));
        }
        return response;
      }).catch(() => caches.match(`${BASE_PATH}index.html`)),
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response.ok) return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      });
    }).catch(() => caches.match(`${BASE_PATH}index.html`)),
  );
});
