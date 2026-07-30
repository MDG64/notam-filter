// ============================================================
//  Non-régression de l'indexation des pistes du plan (planBuild()).
//
//  Le NOTAM dit toujours « RWY 04R/22L » ; OSM, lui, écrit la même piste de
//  cinq façons : « 04R/22L », « 04R-22L », « 04R;22L », « 4R/22L », voire
//  « 4R » seul. Si l'index ne réconcilie pas les deux, la piste fermée reste
//  GRISE — l'erreur la plus grave que ce plan puisse faire. Elle a touché
//  119 pistes sur 81 terrains, dont les quatre pistes de KMCO.
//
//  Le test est HERMÉTIQUE : il ne s'appuie sur aucun layout du dépôt. Les
//  layouts sont regénérés depuis OSM, où n'importe qui peut corriger une ref
//  du jour au lendemain — un test câblé sur KMCO.json passerait au vert le
//  jour où le bug disparaît en amont, sans que le code soit réparé. On fournit
//  donc nos propres surfaces, une par graphie observée.
//
//  Comme classify.test.mjs : on DÉCOUPE le code réellement déployé dans
//  notam-filter.html, repéré par marqueur textuel et jamais par numéro de
//  ligne. Un test qui recopierait la logique ne prouverait rien.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8").replace(/\r\n/g, "\n");

/** buildSurfaces() + le bloc d'indexation de planBuild(), tels qu'ils tournent. */
async function chargerIndexeur() {
  const surfaces = /function buildSurfaces\(layout\) \{[\s\S]*?\n {4}\}/.exec(html);
  const index = /const INDEX = new Map\(\);[\s\S]*?\n {6}\}\n/.exec(html);
  assert.ok(surfaces, "buildSurfaces() introuvable");
  assert.ok(index, "le bloc d'indexation de planBuild() introuvable");
  const src = [
    surfaces[0],
    "function indexer(features) {",
    "  const SURF = buildSurfaces({ f: features });",
    index[0],
    "  return INDEX;",
    "}",
    "export { indexer };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

/** Le filet à pistes de refsFromNotam(), extrait lui aussi du fichier. */
function refsPiste(texte) {
  const motif = /let m; const rw=(\/.*?\/g);/.exec(html);
  assert.ok(motif, "le motif RWY de refsFromNotam() a changé de forme");
  const re = new RegExp(motif[1].slice(1, -2), "g");
  const out = new Set();
  let m;
  while ((m = re.exec(" " + texte.toUpperCase() + " "))) { out.add(m[1]); if (m[2]) out.add(m[2]); }
  return [...out];
}

const piste = r => ({ t: "rwy", r, g: [[43.6, 1.36], [43.62, 1.38]] });

test("toutes les graphies OSM d'une paire de QFU mènent à la piste", async () => {
  const { indexer } = await chargerIndexeur();
  // ref OSM observée              → NOTAM qui doit la trouver
  const CAS = [
    ["14L/32R", "RWY 14L/32R CLSD"],   // forme canonique
    ["18L-36R", "RWY 18L/36R CLSD"],   // tiret (KMCO, KBWI, KJAX)
    ["08;26", "RWY 08/26 CLSD"],       // point-virgule (KTUL, KPWA, KFSM)
    ["6-24", "RWY 06/24 CLSD"],        // tiret ET zéro de tête absent (KABE)
    ["4R/22L", "RWY 04R/22L CLSD"],    // zéro de tête absent (KBOS)
    ["4R", "RWY 04R CLSD"],            // QFU seul, zéro absent (KMDW)
    ["24L-6R", "RWY 06R/24L CLSD"],    // paire inversée (KCLE)
  ];
  const manques = [];
  for (const [ref, notam] of CAS) {
    const INDEX = indexer([piste(ref)]);
    const touche = refsPiste(notam).flatMap(r => INDEX.get("rwy:" + r) || []);
    if (!touche.length) manques.push(`« ${ref} » reste muette pour « ${notam} »`);
  }
  assert.deepEqual(manques, []);
});

test("les fausses pistes d'OSM ne créent aucune clé de QFU", async () => {
  const { indexer } = await chargerIndexeur();
  // Hydrobases, planeur, ULM, cap vrai militaire, texte libre : aucun NOTAM ne
  // les cite sous cette forme. Les indexer ne ferait que des clés mortes — et
  // « 164/344 » indexé tel quel n'atteindrait jamais un « RWY 16/34 ».
  const FAUX = ["X/X", "NE/SW", "WNW/ESE", "08W/26W", "11G/29G", "18U/36U", "164/344", "DIRT RUNWAY"];
  const canonique = /^rwy:\d{2}[LRC]?$/;
  for (const ref of FAUX) {
    const clés = [...indexer([piste(ref)]).keys()].filter(k => canonique.test(k));
    assert.deepEqual(clés, [], `« ${ref} » ne devrait produire aucun QFU, or : ${clés.join(", ")}`);
  }
});

test("la ref brute reste une clé, et seules les pistes sont découpées", async () => {
  const { indexer } = await chargerIndexeur();
  // La ref telle qu'OSM l'écrit doit survivre : c'est la clé générique de
  // toutes les surfaces, pas seulement des pistes.
  assert.ok(indexer([piste("18L-36R")]).has("rwy:18L-36R"), "la ref brute a disparu de l'index");
  // Le découpage est réservé aux pistes : un taxiway « N-S » ou « A-1 » doit
  // rester entier, sinon on inventerait des taxiways « N », « S », « A », « 1 »
  // qui happeraient les fermetures d'autres bretelles.
  for (const r of ["N-S", "A-1", "B;2"]) {
    const clés = [...indexer([{ t: "twy", r, g: [[43.6, 1.36], [43.61, 1.37]] }]).keys()];
    assert.deepEqual(clés, ["twy:" + r], `le taxiway « ${r} » a été découpé`);
  }
});
