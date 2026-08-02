// Service Worker — NOTAM Lens PWA (fichiers et clé de cache restés "notam-filter-*" :
// renommer casserait les URL GitHub Pages déjà en circulation)
// v3 : "réseau d'abord" pour l'app (les MAJ s'affichent au prochain lancement),
//       "cache d'abord" pour les icônes, les appels API toujours en réseau,
//       et les PLANS (layouts/*.json) mis en cache à l'usage -> consultables
//       en vol, sans connexion.
// La clé de cache reste v5 À DESSEIN. Un service worker se réinstalle dès que
// ses OCTETS changent, quelle que soit cette clé : la renommer n'apporte donc
// aucun rafraîchissement, elle ne fait qu'une chose — `activate` supprime tous
// les caches dont le nom diffère, c'est-à-dire les plans (layouts/*.json) et
// les frontières FIR que les pilotes ont téléchargés pour consulter EN VOL.
// Ne la changer que si on veut délibérément purger les appareils.
const CACHE = "notam-filter-v5";
const ASSETS = [
  "./notam-filter.html", "./index.html", "./manifest.json",
  // "./legal.html" retiré tant que la page n'est pas publiée : elle porte
  // encore « Document non finalisé » et des champs vides. addAll() est
  // atomique — un seul 404 et TOUT le pré-cache échoue silencieusement.
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

  // 1) Appels API (proxy NOTAM) : toujours le réseau, jamais de cache.
  if (url.includes("/api/notams/")) {
    e.respondWith(fetch(e.request));
    return;
  }

  // 2) Pages HTML / navigation : réseau d'abord -> les mises à jour apparaissent
  //    dès qu'on est en ligne ; repli sur le cache si hors-ligne.
  //    fetch(url, {cache:"no-store"}) plutôt que fetch(e.request) : sinon, en
  //    mode "navigate", le navigateur peut servir sa propre copie HTTP en
  //    cache (Cache-Control: max-age=600 côté GitHub Pages) sans même
  //    toucher le réseau — une réouverture d'app dans les 10 minutes suivant
  //    un déploiement resterait alors bloquée sur l'ancienne version.
  const isHTML = e.request.mode === "navigate" || url.endsWith(".html") || url.endsWith("/");
  if (isHTML) {
    e.respondWith(
      fetch(url, { cache: "no-store" }).then(r => {
        const copy = r.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return r;
      }).catch(() => caches.match(e.request).then(r => r || caches.match("./notam-filter.html")))
    );
    return;
  }

  // 3) Plans de plateforme (layouts/*.json) et frontières/fermetures FIR
  //    (fir/*.json) : réseau d'abord ET mise en cache. Consultable EN VOL,
  //    sans connexion — tout en se rafraîchissant dès qu'on est en ligne.
  if (url.includes("/layouts/") || url.includes("/fir/")) {
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

  // 4) manifest.json : il porte l'identité de l'app (nom sous l'icône, écran
  //    de démarrage, nom repris par le wrapper store). En cache d'abord il
  //    restait figé jusqu'au prochain changement de CACHE — un renommage de
  //    l'app n'atteignait jamais les appareils déjà installés. Réseau d'abord
  //    donc, et avec {cache:"no-store"} pour la même raison qu'en règle 2 :
  //    sans lui, le navigateur sert sa propre copie HTTP et le renommage
  //    reste invisible même avec le réseau.
  if (url.endsWith("/manifest.json")) {
    e.respondWith(
      fetch(url, { cache: "no-store" }).then(r => {
        if (r && r.ok) {
          const copy = r.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return r;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  // 5) Autres ressources (icônes) : cache d'abord, réseau en repli.
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
