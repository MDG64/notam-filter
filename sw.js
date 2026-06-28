// Service Worker — NOTAM Filter PWA
// v2 : "réseau d'abord" pour l'app (les MAJ s'affichent au prochain lancement),
//       "cache d'abord" pour les icônes, et les appels API toujours en réseau.
const CACHE = "notam-filter-v2";
const ASSETS = [
  "./notam-filter.html", "./index.html", "./manifest.json",
  "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(() => {}));
  self.skipWaiting();                       // active la nouvelle version sans attendre
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))  // purge anciens caches
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", e => {
  const url = e.request.url;

  // 1) Appels API (proxy FAA) : toujours le réseau, jamais de cache.
  if (url.includes("/api/notams/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2) Pages HTML / navigation : réseau d'abord -> les mises à jour apparaissent
  //    dès qu'on est en ligne ; repli sur le cache si hors-ligne.
  const isHTML = e.request.mode === "navigate" || url.endsWith(".html") || url.endsWith("/");
  if (isHTML) {
    e.respondWith(
      fetch(e.request).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./notam-filter.html")))
    );
    return;
  }

  // 3) Autres ressources (icônes, manifest) : cache d'abord, réseau en repli.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
