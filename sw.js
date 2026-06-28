// Service Worker — NOTAM Filter PWA
const CACHE = "notam-filter-v1";
const ASSETS = ["./notam-filter.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  // Les appels API (proxy FAA) passent toujours par le réseau
  if (e.request.url.includes("/api/notams/")) {
    e.respondWith(fetch(e.request));
    return;
  }
  // Les assets de l'app : cache en priorité, réseau en fallback
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
