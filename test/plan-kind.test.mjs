// ============================================================
//  Non-régression de planKind() — la couleur peinte sur le plan d'aérodrome
//  (rouge « closed », ambre « restricted », vert « reopened »).
//
//  Bug réel corrigé le 2026-08-04 (LFPO A5113/26) : « RWY 06/24 PROHIBITED
//  FOR ACFT A388 AND B748 » peignait la piste en ROUGE PLEIN alors qu'elle
//  reste ouverte à tout le reste de la flotte — aucun mot de RESTRICT_TEXT
//  n'y figurait (« FOR ACFT » n'est pas « ACFT TYPE »), le texte tombait
//  donc sur le PROHIBITED nu, lu comme une fermeture totale. Corrigé par
//  RESTRICT_ACFT_RE, partagé par planKind() (couleur du plan) et severity()
//  (rang dans la liste) via hasRestrictCond().
//
//  Le correctif a été vérifié une fois par un harnais ad-hoc à 18 cas, jamais
//  committé : sans trace permanente, une future modification de RESTRICT_TEXT
//  ou de planKind() pourrait réintroduire exactement ce bug sans que rien ne
//  le détecte avant que ça n'atteigne la carte. Ce fichier fixe ça.
//
//  Comme classify.test.mjs et plan-rwy-index.test.mjs : on DÉCOUPE le code
//  réellement déployé dans notam-filter.html, repéré par marqueur textuel et
//  jamais par numéro de ligne — un test qui recopierait la logique ne
//  prouverait rien.
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

/** planKind() et tout ce dont elle dépend, extraits tels qu'ils tournent. */
async function chargerPlanKind() {
  const motifs = {
    CRITICAL_TEXT: /const CRITICAL_TEXT = (\[[\s\S]*?\]);/,
    CNL_TEXT: /const CNL_TEXT = (\[[^\]]*\]);/,
    RESUME_TEXT: /const RESUME_TEXT = (\[[^\]]*\]);/,
    RESUME_OK_RE: /const RESUME_OK_RE = (\/.*\/);/,
    RESTRICT_TEXT: /const RESTRICT_TEXT = (\[[\s\S]*?\]);/,
    RESTRICT_ACFT_RE: /const RESTRICT_ACFT_RE = (\/.*\/);/,
    WITHDRAWN_RE: /const WITHDRAWN_RE = (\/.*\/g);/,
    WITHDRAWN_DATA_RE: /const WITHDRAWN_DATA_RE = (\/.*\/g);/,
  };
  const consts = Object.entries(motifs).map(([nom, re]) => {
    const m = re.exec(html);
    assert.ok(m, `${nom} introuvable dans notam-filter.html`);
    return `const ${nom} = ${m[1]};`;
  });
  const fns = ["isResumption", "hasRestrictCond", "hasClosureWord", "planKind"].map(nom => {
    const re = new RegExp(`function ${nom}\\([^)]*\\) \\{[\\s\\S]*?\\n {4}\\}`);
    const m = re.exec(html);
    assert.ok(m, `function ${nom}() introuvable dans notam-filter.html`);
    return m[0];
  });
  const src = [...consts, ...fns, "export { planKind };"].join("\n");
  return import("data:text/javascript;base64," + Buffer.from(src).toString("base64"));
}

const n = e => ({ e });

test("les cas réels documentés en commentaire donnent la couleur attendue", async () => {
  const { planKind } = await chargerPlanKind();
  const CAS = [
    // texte NOTAM (n.e)                                                    → couleur attendue
    ["RWY 06/24 PROHIBITED FOR ACFT A388 AND B748 REF AD2.24 GMC 02 AND GMC 04.", "restricted"], // LFPO A5113/26 : régression corrigée
    ["RWY 02/20 RESTRICTION DUE TO OBSTACLE : LDG RWY 20 PROHIBITED FOR ACFT WHICH WINGSPAN EXCEEDS 36M", "restricted"], // LFPO A4935/26
    ["LDG RWY 20 PROHIBITED DUE TO OBST", "closed"], // LFPO A4641/26 : PROHIBITED nu, aucune condition
    ["CLOSURE OF TAXIWAYS W3 W4 W5 DUE TO WORKS", "closed"], // LFBO A4912/26 : "CLOSURE" sans CLSD/CLOSED littéral
    ["RWY 05/23 PROHIBITED FOR ALL ACFT", "closed"], // "ALL" n'est pas un désignateur OACI -> pas de condition, fermeture totale
    ["TWY W3 CLSD. ACFT A388 CTC TWR", "closed"], // un mot de fermeture explicite garde toujours la priorité sur une mention de type
    ["RWY 06/24 RESUMED NORMAL OPR", "reopened"], // levée de restriction, pas une fermeture
    ["TWY M23 - NOTAM CNL", "reopened"], // NOTAM retiré
    ["RWY 26L TWY DIRECTION SIGN MISSING", "restricted"], // ni fermeture ni condition reconnue -> ambre "à vérifier", jamais rouge
    ["RWY 23 AND 29 TDZ VALUES WITHDRAWN : REF AIP AD 2 LFBD.12.", "restricted"], // LFBD A1354/26 : ce sont les VALEURS de l'AIP qui sont retirées, pas la piste
  ];
  const ecarts = [];
  for (const [texte, attendu] of CAS) {
    const obtenu = planKind(n(texte));
    if (obtenu !== attendu) ecarts.push(`« ${texte} » → ${obtenu}, attendu ${attendu}`);
  }
  assert.deepEqual(ecarts, []);
});

test("« WITHDRAWN » ferme une surface, pas une donnée publiée", async () => {
  const { planKind } = await chargerPlanKind();
  // Ce qui est retiré du service ferme : la surface elle-même.
  assert.equal(planKind(n("RWY 05/23 WITHDRAWN")), "closed");
  assert.equal(planKind(n("TWY B WITHDRAWN UNTIL FURTHER NOTICE")), "closed");
  // Ce qui est retiré de la PUBLICATION ne ferme rien : la piste reste ouverte.
  assert.equal(planKind(n("RWY 23 AND 29 TDZ VALUES WITHDRAWN")), "restricted");
  assert.equal(planKind(n("DECLARED DISTANCES WITHDRAWN, REF AIP AD 2")), "restricted");
  assert.equal(planKind(n("RWY 09 TORA VALUES ARE WITHDRAWN")), "restricted");
  // Un texte qui mélange les deux reste une fermeture : on compte les
  // occurrences, une donnée retirée n'absout pas une surface retirée.
  assert.equal(planKind(n("TWY B WITHDRAWN. RWY 23 TDZ VALUES WITHDRAWN")), "closed");
  // Et un mot de fermeture classique garde évidemment la priorité.
  assert.equal(planKind(n("RWY 23 CLSD, TDZ VALUES WITHDRAWN")), "closed");
});

test("le désignateur d'appareil ne se reconnaît qu'après le mot ACFT", async () => {
  const { planKind } = await chargerPlanKind();
  // "AD2.24", "GMC 02" et "RWY 06" sont truffés de jetons lettres+chiffres :
  // les reconnaître comme des types d'appareil ferait passer de vraies
  // fermetures totales pour des restrictions partielles.
  assert.equal(
    planKind(n("RWY 06 CLSD REF AD2.24 GMC 02")),
    "closed",
    "un jeton lettres+chiffres hors du mot ACFT n'est pas un type d'appareil"
  );
});
