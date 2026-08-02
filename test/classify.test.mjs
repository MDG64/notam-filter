// ============================================================
//  Non-régression de classifyNotam() contre la revue humaine du 2026-07-28.
//
//  Le classificateur vit dans le <script> de notam-filter.html, qui ne
//  s'exécute pas hors navigateur (DOM, service worker, fetch). Plutôt que
//  d'extraire le code dans un module — ce qui obligerait à charger un fichier
//  de plus dans une app volontairement mono-fichier — le test DÉCOUPE la
//  section de classification et l'évalue seule. Les bornes sont repérées par
//  marqueur textuel, jamais par numéro de ligne : le fichier bouge à chaque
//  modification.
//
//  Lancer :  node --test test/
// ============================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(HERE, "..", "notam-filter.html"), "utf8");

async function chargerClassificateur() {
  const L = html.split("\n");
  const debut = L.findIndex(l => l.includes("const SUBJECT_CATEGORIES = {"));
  const fin = L.findIndex(l => l.includes("return { categories: [...cats], severity: severity(q, e), source };"));
  assert.ok(debut >= 0 && fin > debut, "marqueurs de la section de classification introuvables");
  // CNL_TEXT et RESTRICT_TEXT sont déclarés bien plus bas dans le fichier
  // (severity() les utilise par remontée de portée) : on les rapatrie.
  const src = [
    L.slice(debut, fin + 2).join("\n"),
    "const CNL_TEXT = " + /const CNL_TEXT = (\[[^\]]*\]);/.exec(html)[1] + ";",
    "const RESTRICT_TEXT = " + /const RESTRICT_TEXT = (\[[\s\S]*?\]);/.exec(html)[1] + ";",
    "export { classifyNotam };",
  ].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

/** Rejoue l'extraction Q-code / item E) que fait parseNotam() sur le brut. */
function champs(brut) {
  const t = brut.replace(/\r/g, "");
  return {
    q: (/Q\)\s*[A-Z]{4}\/(Q[A-Z]{4})/.exec(t) || [])[1] || null,
    e: (/\bE\)([\s\S]*?)(?=\n\s*[A-Z]\)\s|$)/.exec(t) || [])[1] || "",
  };
}

const { cas } = JSON.parse(readFileSync(join(HERE, "verdicts-aerodrome-2026-07-28.json"), "utf8"));

test("les 9 NOTAM de terrain relus sont classés conformément à la revue", async () => {
  const { classifyNotam } = await chargerClassificateur();
  const ecarts = [];
  for (const c of cas) {
    const { q, e } = champs(c.texte);
    const obtenu = classifyNotam(q, e).categories.slice().sort().join("+");
    // Le verdict « null » de la revue = le NOTAM reste dans « Unclassified ».
    const attendu = [].concat(c.attendu).sort().join("+").replace("null", "non_classe");
    if (obtenu !== attendu) ecarts.push(`${c.sujet} (${c.hash.slice(0, 8)}) attendu=${attendu} obtenu=${obtenu}`);
  }
  assert.deepEqual(ecarts, []);
});

test("le point d'attente est au sol, l'attente en vol reste en approche", async () => {
  const { classifyNotam } = await chargerClassificateur();
  // Cas réel B2380/26 : sortait Ground + Arrival, le mot « HOLDING » suffisant
  // à le ranger aussi en approche. Un point d'attente est une position au sol.
  assert.deepEqual(classifyNotam("QMRXX", "HOLDING POINT E NOT AVBL, USE E1.").categories.sort(),
    ["sol"]);
  assert.deepEqual(classifyNotam("QMXLC", "TWY B HOLDING POSITION MARKINGS U/S").categories.sort(),
    ["sol"]);
  // L'attente EN VOL reste bien de l'approche, par le Q-code (QPH…) comme par
  // le texte quand le Q-code ne dit rien.
  assert.ok(classifyNotam("QPHCS", "HOLDING PROCEDURE RWY 32L REVISED").categories.includes("approche"));
  assert.ok(classifyNotam("QXXXX", "HOLDING PATTERN OVER TOU NDB NOT AVBL").categories.includes("approche"));
});

test("une annulation qui recopie son en-tête n'est jamais soumise au LLM", () => {
  // Ces NOTAMC ONT un item E) — il recopie l'en-tête, mot pour mot. Le filtre
  // `n.e` de proposeUnclassified() les laissait donc passer : 5 appels LLM sur
  // les 9 propositions de terrain de la revue, pour des textes sans la moindre
  // information opérationnelle.
  const re = new RegExp(/const CANCEL_ECHO_RE = (\/.*\/);/.exec(html)[1].slice(1, -1));
  const annulations = cas.filter(c => re.test(champs(c.texte).e));
  assert.equal(annulations.length, 5);
  // Tous ont bien été tranchés « null » par la revue : les écarter ne perd rien.
  assert.ok(annulations.every(c => [].concat(c.attendu).join("") === "null"));
  // Et le garde-fou doit rester branché sur la liste des envois.
  assert.ok(html.includes("!CANCEL_ECHO_RE.test(n.e)"),
    "le garde-fou de proposeUnclassified() a disparu");
  // Aucun NOTAM porteur de texte réel ne doit tomber dans le filtre.
  for (const c of cas.filter(x => !annulations.includes(x))) {
    assert.ok(!re.test(champs(c.texte).e), `${c.sujet} filtré à tort`);
  }
});
