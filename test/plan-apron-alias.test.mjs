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

/** buildSurfaces() + l'indexation + les vocabulaires + refsFromNotam(), tels qu'ils tournent. */
async function chargerPlan() {
  const src = [
    decoupe(/\/\* refsFromNotam v2[\s\S]*?partial,hit:!!hit\};\n {6}\}/, "refsFromNotam()"),
    decoupe(/function buildSurfaces\(layout\) \{[\s\S]*?\n {4}\}/, "buildSurfaces()"),
    "function plan(features) {",
    "  const SURF = buildSurfaces({ f: features });",
    decoupe(/const INDEX = new Map\(\);[\s\S]*?\n {6}\}\n/, "l'indexation de planBuild()"),
    decoupe(/const APRONS = new Set\(\)[\s\S]*?\n {6}\}/, "les vocabulaires d'aires de planBuild()"),
    "  return { INDEX, APRONS, APRONS_SHORT };",
    "}",
    "export { plan, refsFromNotam };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const apr = r => ({ t: "apr", r, g: [[50.2, 12.9], [50.2, 12.91], [50.21, 12.91], [50.2, 12.9]] });

const lit = (p, texte, refsFromNotam) =>
  refsFromNotam(texte, new Set(), p.APRONS, p.APRONS_SHORT).apron;

/** Le trajet complet : le NOTAM nomme, l'index doit rendre la surface. */
function trouve(p, texte, refsFromNotam) {
  const out = new Set();
  for (const r of lit(p, texte, refsFromNotam)) for (const s of p.INDEX.get("apr:" + r) || []) out.add(s.r);
  return [...out].sort();
}

/** Ce que le bandeau « missing from this layout » listerait (cf. MISS dans planBuild). */
function manquantes(p, texte, refsFromNotam) {
  return lit(p, texte, refsFromNotam)
    .filter(r => !p.INDEX.get("apr:" + r)).map(r => "APRON " + r).sort();
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
    ["APRON 2", "APRON 2 CLSD"],        // numéro nu : le filet exige une lettre (294 aires)
    ["Apron Vendée", "APRON VENDEE CLSD"],  // nom en toutes lettres, accentué chez OSM
    ["APRON NORTH", "APRON NORTH CLSD"],    // mot que le filet ne peut pas produire (124 aires)
    ["APRON ALPHA", "APRON ALPHA CLSD"],    // l'aire s'appelle ALPHA, pas « A »
    ["2", "APRON 2 CLSD"],              // nom NU réduit à un numéro (531 aires)
    ["APRON 2 NORTH", "APRON 2 NORTH CLSD"], // dépouillé en deux mots
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

test("le nom au long l'emporte sur la traduction OTAN", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // Sinon « APRON ALPHA » sortirait « A », introuvable, et le plan déclarerait
  // une aire A manquante du fond de carte — le faux MISS qu'on vient de tuer.
  const p = plan([apr("APRON ALPHA")]);
  assert.deepEqual(lit(p, "APRON ALPHA CLSD", refsFromNotam), ["ALPHA"]);
  assert.deepEqual(manquantes(p, "APRON ALPHA CLSD", refsFromNotam), []);
  // là où l'aire n'a PAS de nom en toutes lettres, la branche OTAN reste utile
  const q = plan([apr("APRON A")]);
  assert.deepEqual(trouve(q, "APRON ALPHA CLSD", refsFromNotam), ["APRON A"]);
});

test("le vocabulaire dépouillé ne s'ouvre pas derrière le générique « AREA »", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // Le mot-clé du NOTAM REMPLACE le préfixe retiré du nom OSM. « AREA » n'a
  // rien à remplacer : « MOVEMENT AREA NORTH OF TWY A » n'est pas une
  // fermeture de l'aire nord, et « WORK AREA 2 » pas une fermeture de l'aire 2.
  const p = plan([apr("APRON NORTH"), apr("APRON 2")]);
  assert.deepEqual(lit(p, "MOVEMENT AREA NORTH CLSD", refsFromNotam), []);
  assert.deepEqual(lit(p, "WORK AREA 2 WIP", refsFromNotam), []);
  // le nom ENTIER, lui, reste lisible derrière AREA : c'est le cas LFBO
  // « PUSH BACK AREA 'ROMEO' CLSD » qui a motivé cette branche.
  const q = plan([apr("ROMEO")]);
  assert.deepEqual(trouve(q, "PUSH BACK AREA 'ROMEO' CLSD", refsFromNotam), ["ROMEO"]);
});

test("le mot qui suit départage un nom d'aire d'une position ou d'un horaire", async () => {
  const { plan, refsFromNotam } = await chargerPlan();
  // Ces deux terrains ONT bien l'aire citée : seul le mot suivant dit que le
  // NOTAM parle d'autre chose. Sans ce filtre, on peindrait une aire ouverte.
  const p = plan([apr("APRON NORTH"), apr("APRON 24")]);
  assert.deepEqual(lit(p, "APRON NORTH OF TWY A CLSD", refsFromNotam), []);
  assert.deepEqual(lit(p, "APN 24 HR AVBL", refsFromNotam), []);
  // et la tournure normale continue de passer
  assert.deepEqual(lit(p, "APRON NORTH CLSD", refsFromNotam), ["NORTH"]);
  // le filet vaut pour les DEUX vocabulaires : ici l'aire s'appelle « NORTH »
  // tout court, elle passe donc par le nom entier et non par le dépouillé.
  // 13 fausses fermetures sur 8 terrains réels (EGAA, EKBI, EKCH, LBSF).
  const q = plan([apr("NORTH"), apr("EAST")]);
  assert.deepEqual(lit(q, "APRON NORTH OF TWY A CLSD", refsFromNotam), []);
  assert.deepEqual(lit(q, "APRON EAST OF STAND 12 NOT AVBL", refsFromNotam), []);
  assert.deepEqual(lit(q, "APRON NORTH CLSD", refsFromNotam), ["NORTH"]);
});

test("un nom nu qui n'est pas un numéro n'entre pas au vocabulaire dépouillé", async () => {
  const { plan } = await chargerPlan();
  // « 2 » y entre (aucune autre voie ne peut le produire), « A » non : la
  // branche OTAN/indicatif le rend déjà, et l'ajouter n'ouvrirait que du bruit.
  const p = plan([apr("2"), apr("A"), apr("CARGO")]);
  assert.deepEqual([...p.APRONS_SHORT].sort(), ["2"]);
});
