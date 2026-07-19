// Service Worker — NOTAM Filter PWA
// v3 : "réseau d'abord" pour l'app (les MAJ s'affichent au prochain lancement),
//       "cache d'abord" pour les icônes, les appels API toujours en réseau,
//       et les PLANS (layouts/*.json) mis en cache à l'usage -> consultables
//       en vol, sans connexion.
const CACHE = "notam-filter-v3";
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

  // 3) Plans de plateforme (layouts/*.json) : réseau d'abord ET mise en cache.
  //    Un terrain consulté une fois reste consultable EN VOL, sans connexion —
  //    tout en se rafraîchissant dès qu'on est en ligne (les layouts sont
  //    régénérés depuis OSM, il ne faut donc pas figer une version périmée).
  if (url.includes("/layouts/")) {
    e.respondWith(
      fetch(e.request).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))    // hors ligne : la copie gardée
    );
    return;
  }

  // 4) Autres ressources (icônes, manifest) : cache d'abord, réseau en repli.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
