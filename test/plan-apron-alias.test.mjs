// ============================================================
//  Non-régression du rapprochement NOTAM ↔ nom d'AIRE.
//
//  Même maladie que plan-twy-alias.test.mjs, autre famille de surfaces : OSM
//  écrit souvent le TYPE dans le nom de l'aire. LKCS nomme ses trois aires
//  « Apron W », « Apron M », « Apron E » ; le NOTAM dit « APRON E CLSD » et
//  refsFromNotam n'en tire que « E ». Sans clé dépouillée, l'aire est DESSINÉE
//  ET ÉTIQUETÉE sur le plan mais introuvable à l'index : elle part en MISS, et
//  le bandeau réimprime mot pour mot l'étiquette qu'on lit deux centimètres
//  plus haut — « APRON E · APRON W are named by a NOTAM but are missing from
//  this layout ». Il propose en prime de signaler un fond de carte qui est
//  juste, donc un signalement OSM pour rien.
//  Constaté à LKCS le 2026-08-04 sur B1901/26.
//
//  HERMÉTIQUE, comme les autres : aucun layout du dépôt. Les layouts sont
//  regénérés depuis OSM, où n'importe qui peut retaguer « Apron E » en
//  « ref=E » du jour au lendemain — un test câblé sur LKCS.json passerait au
//  vert sans que le code soit réparé. On DÉCOUPE le code réellement déployé
//  dans notam-filter.html, repéré par marqueur textuel et jamais par numéro de
//  ligne.
//
//  Lancer :  node --test "test/*.test.mjs"
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8").replace(/\r\n/g, "\n");

function decoupe(re, quoi) {
  const m = re.exec(html);
  assert.ok(m, quoi + " introuvable — le marqueur a changé de forme");
  return m[0];
}

/** buildSurfaces() + l'indexation + APRONS + refsFromNotam(), tels qu'ils tournent. */
async function chargerPlan() {
  const src = [
    decoupe(/\/\* refsFromNotam v2[\s\S]*?partial,hit:!!hit\};\n {6}\}/, "refsFromNotam()"),
    decoupe(/function buildSurfaces\(layout\) \{[\s\S]*?\n {4}\}/, "buildSurfaces()"),
    "function plan(features) {",
    "  const SURF = buildSurfaces({ f: features });",
    decoupe(/const INDEX = new Map\(\);[\s\S]*?\n {6}\}\n/, "l'indexation de planBuild()"),
    decoupe(/const APRONS = new Set\(\);[\s\S]*?\n {6}\}/, "le vocabulaire d'aires de planBuild()"),
    "  return { INDEX, APRONS };",
    "}",
    "export { plan, refsFromNotam };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const apr = r => ({ t: "apr", r, g: [[50.2, 12.9], [50.2, 12.91], [50.21, 12.91], [50.2, 12.9]] });

/** Le trajet complet : le NOTAM nomme, l'index doit rendre la surface. */
function trouve({ INDEX, APRONS }, texte, refsFromNotam) {
  const refs = refsFromNotam(texte, new Set(), APRONS);
  const out = new Set();
  for (const r of refs.apron) for (const s of INDEX.get("apr:" + r) || []) out.add(s.r);
  return [...out].sort();
}

/** Ce que le bandeau « missing from this layout » listerait (cf. MISS dans planBuild). */
function manquantes({ INDEX, APRONS }, texte, refsFromNotam) {
  return refsFromNotam(texte, new Set(), APRONS).apron
    .filter(r => !INDEX.get("apr:" + r)).map(r => "APRON " + r).sort();
}

test("une aire nommée au long est trouvée par le NOTAM qui l'abrège", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // nom OSM observé   → NOTAM qui doit le trouver
  const CAS = [
    ["Apron E", "APRON E CLSD"],        // casse mixte : layouts d'avant l'uppercase
    ["APRON W", "APRON W CLSD"],        // générateur actuel (LKCS)
    ["Apron A1", "APRON A1 CLSD"],      // indicatif alphanumérique
    ["Ramp C", "RAMP C CLSD"],          // vocabulaire US
    ["APN B", "APRON B CLSD"],          // préfixe abrégé côté OSM, au long côté NOTAM
  ];
  for (const [ref, notam] of CAS) {
    const p = plan([apr(ref)]);
    assert.deepEqual(trouve(p, notam, refsFromNotam), [ref],
      `« ${notam} » ne trouve pas l'aire taguée « ${ref} »`);
  }
});

test("LKCS B1901/26 : le bandeau ne déclare plus manquant ce qui est dessiné", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  const p = plan([apr("APRON W"), apr("APRON M"), apr("APRON E")]);
  const notam = "APRON E AND APRON W CLSD";
  assert.deepEqual(trouve(p, notam, refsFromNotam), ["APRON E", "APRON W"]);
  assert.deepEqual(manquantes(p, notam, refsFromNotam), []);
});

test("le nom au long reste une clé, et ce qui est dessiné ne change pas", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  const p = plan([apr("APRON E")]);
  // un NOTAM peut citer le nom mot pour mot — c'est le marquage réel au sol
  assert.deepEqual(trouve(p, "APRON APRON E CLSD", refsFromNotam), ["APRON E"]);
  // s.r n'est pas réécrit : c'est lui que planDraw() peint et étiquette
  assert.equal([...p.INDEX.get("apr:E")][0].r, "APRON E");
});

test("une aire réellement absente part toujours en MISS", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // Le garde-fou ne doit pas devenir muet : c'est sa raison d'être. Ici le
  // terrain n'a QUE l'aire W, et le NOTAM ferme aussi une aire E qui n'existe
  // nulle part dans le fond de carte — ça, il faut le dire.
  const p = plan([apr("APRON W")]);
  assert.deepEqual(manquantes(p, "APRON E CLSD", refsFromNotam), ["APRON E"]);
});

test("l'alias ne dépouille que le préfixe de type, et rien d'autre", async () => {
  const { plan } = await chargerPlan();
  // « APRON » seul n'a pas de reste à indexer : pas de clé vide.
  assert.deepEqual([...plan([apr("APRON")]).INDEX.keys()], ["apr:APRON"]);
  // un nom qui COMMENCE par les mêmes lettres n'est pas un préfixe.
  assert.ok(plan([apr("APRONNIER")]).INDEX.has("apr:APRONNIER"));
  assert.ok(!plan([apr("APRONNIER")]).INDEX.has("apr:NIER"));
});

test("les deux dépouillements se composent : accents PUIS préfixe", async () => {
  const { plan } = await chargerPlan();
  // OSM écrit les accents, le NOTAM est en ASCII majuscule. La clé dépouillée
  // doit passer par les DEUX moulinettes, sinon « Apron Vendée » n'est joignable
  // que sous son nom entier et accentué.
  const p = plan([apr("Apron Vendée")]);
  assert.ok(p.INDEX.has("apr:VENDEE"), "la clé doublement dépouillée manque");
});

/* ------------------------------------------------------------------
   DEUX TROUS CONNUS, en AMONT de l'index — refsFromNotam n'émet aucune
   ref, donc le NOTAM tombe en « could not be placed » sans même figurer
   au bandeau MISS. L'alias ci-dessus ne peut rien pour eux : il n'y a
   rien à rapprocher. Ils ne sont pas assertés ici pour ne pas figer un
   comportement qu'on veut voir changer.

   · « APRON 2 CLSD » : le filet /^[A-Z]{1,2}\d{0,2}$/ exige au moins une
     lettre, un numéro nu ne passe pas. L'ouvrir ferait lire « APN 24 HR
     AVBL » comme une aire 24.
   · « APRON VENDEE CLSD » : nameAt ne reconnaît que le nom ENTIER
     (« APRON VENDEE »), car APRONS ne stocke pas la forme dépouillée.
     L'y ajouter ferait lire « MOVEMENT AREA NORTH OF TWY A » comme une
     fermeture d'aire pour les terrains qui ont une « Apron North ».

   Les deux se règlent, mais chacun touche un garde-fou anti-glanage et
   mérite sa propre décision.
   ------------------------------------------------------------------ */
