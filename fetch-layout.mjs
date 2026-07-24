#!/usr/bin/env node
/* ============================================================
   fetch-layout.mjs — extrait la plateforme (taxiways, pistes,
   aprons, postes) depuis OpenStreetMap via l'API Overpass.

   Usage :
     node fetch-layout.mjs LFBO LFPG EGLL
     node fetch-layout.mjs            (liste par défaut)

   Sortie : ./layouts/<ICAO>.json
   Données © OpenStreetMap contributors — ODbL.
   Node >= 18 requis (fetch natif).
   ============================================================ */

import fs from "node:fs";
import path from "node:path";

// Miroirs Overpass, essayés dans l'ordre. Si le premier boude, on bascule.
const MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
let mirror = 0;

// La politique d'usage OSM impose de s'identifier : sans User-Agent explicite,
// overpass-api.de répond HTTP 406. Mets ton contact réel ici.
const UA = "NOTAM-Lens/1.0 (+ocurus.dev@gmail.com)";

const OUT_DIR  = "layouts";
const PAUSE_MS = 4000;          // fair-use Overpass : on ne bourrine pas
const RETRIES  = 3;

const DEFAULT = ["LFBO","LFPG","EGLL","EDDF","LSGG","GMMN","FAOR","HECA"];

// rayon de capture par défaut ; certains hubs débordent
const RADIUS = { EDDF:5500, EGLL:5000, LFPG:6500, FAOR:5000, default:4000 };

const AEROWAY = "taxiway|runway|apron|parking_position|holding_position|taxilane";

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function overpass(query, label){
  for(let attempt=1; attempt<=RETRIES; attempt++){
    const url = MIRRORS[mirror];
    try{
      const r = await fetch(url, {
        method:"POST",
        headers:{
          "Content-Type":"application/x-www-form-urlencoded",
          "User-Agent": UA,          // sans ça : HTTP 406
          "Accept": "application/json",
        },
        body:"data="+encodeURIComponent(query),
      });
      if(r.status===429 || r.status===504){
        if(mirror < MIRRORS.length-1){
          mirror++;
          console.log(`   ↪ ${label}: HTTP ${r.status} sur ${new URL(url).host} → bascule sur ${new URL(MIRRORS[mirror]).host}`);
          continue;
        }
        const wait = 8000*attempt;
        console.log(`   ⏳ ${label}: HTTP ${r.status}, retry dans ${wait/1000}s`);
        await sleep(wait); continue;
      }
      if(!r.ok){
        const body = (await r.text().catch(()=>"")).slice(0,300).replace(/\s+/g," ");
        // 4xx = le serveur nous refuse -> on tente le miroir suivant
        if(r.status>=400 && r.status<500 && mirror < MIRRORS.length-1){
          mirror++;
          console.log(`   ↪ ${label}: HTTP ${r.status} sur ${new URL(url).host} → bascule sur ${new URL(MIRRORS[mirror]).host}`);
          continue;
        }
        throw new Error(`HTTP ${r.status} — ${body || "(corps vide)"}`);
      }
      return await r.json();
    }catch(e){
      if(attempt===RETRIES) throw e;
      console.log(`   ⏳ ${label}: ${e.message}, tentative ${attempt+1}/${RETRIES}`);
      await sleep(5000*attempt);
    }
  }
  throw new Error("épuisé après "+RETRIES+" tentatives");
}

/* 1) localiser l'aérodrome : on cherche le tag icao, puis le tag ref */
async function findAerodrome(icao){
  const q = `[out:json][timeout:60];
nwr["aeroway"="aerodrome"]["icao"="${icao}"];
out center tags;`;
  let j = await overpass(q, icao+" (recherche)");
  if(!j.elements?.length){
    const q2 = `[out:json][timeout:60];
nwr["aeroway"="aerodrome"]["ref"="${icao}"];
out center tags;`;
    j = await overpass(q2, icao+" (recherche ref)");
  }
  const el = j.elements?.[0];
  if(!el) return null;
  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if(lat==null || lon==null) return null;
  return { lat, lon, name: el.tags?.name || "" };
}

/* 2) récupérer les surfaces autour du point */
async function fetchSurfaces(icao, lat, lon){
  const rad = RADIUS[icao] || RADIUS.default;
  const q = `[out:json][timeout:120];
(
  way(around:${rad},${lat},${lon})["aeroway"~"^(${AEROWAY})$"];
  node(around:${rad},${lat},${lon})["aeroway"~"^(parking_position|holding_position)$"];
);
out geom;`;
  return overpass(q, icao+" (surfaces)");
}

/* mapping OSM -> type interne */
const TYPE = {
  taxiway:"twy", taxilane:"twy", runway:"rwy", apron:"apr",
  parking_position:"std", holding_position:"hold",
};

function build(icao, ad, data){
  const feats = [];
  for(const el of data.elements||[]){
    const aw = el.tags?.aeroway;
    const t = TYPE[aw];
    if(!t) continue;
    // ref = nom court (D3, 14L/32R) ; name en repli (Apron Alpha)
    const ref = el.tags.ref || el.tags.name || null;
    let g = null;
    if(el.type==="way" && el.geometry){
      g = el.geometry.map(p => [ +p.lat.toFixed(6), +p.lon.toFixed(6) ]);
    } else if(el.type==="node"){
      g = [[ +el.lat.toFixed(6), +el.lon.toFixed(6) ]];
    }
    if(!g || !g.length) continue;
    const f = { t, g };
    if(ref) f.r = String(ref).toUpperCase();
    if(el.tags.width) f.w = el.tags.width;
    feats.push(f);
  }
  return {
    icao,
    name: ad.name,
    arp: [ +ad.lat.toFixed(6), +ad.lon.toFixed(6) ],
    src: "OpenStreetMap contributors, ODbL",
    at: new Date().toISOString().slice(0,10),
    f: feats,
  };
}

function stats(o){
  const c = {};
  o.f.forEach(x => c[x.t] = (c[x.t]||0)+1);
  const withRef = o.f.filter(x => x.r).length;
  return { ...c, total:o.f.length, refs:withRef };
}

async function main(){
  const list = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;
  fs.mkdirSync(OUT_DIR, { recursive:true });
  const report = [];

  for(const icao of list.map(s => s.toUpperCase())){
    process.stdout.write(`→ ${icao} … `);
    try{
      const ad = await findAerodrome(icao);
      if(!ad){ console.log("✗ aérodrome introuvable dans OSM (tag icao absent)"); 
               report.push({icao, err:"introuvable"}); await sleep(PAUSE_MS); continue; }
      await sleep(PAUSE_MS);
      const data = await fetchSurfaces(icao, ad.lat, ad.lon);
      const obj  = build(icao, ad, data);
      const file = path.join(OUT_DIR, icao+".json");
      fs.writeFileSync(file, JSON.stringify(obj));
      const s = stats(obj);
      const kb = (fs.statSync(file).size/1024).toFixed(1);
      console.log(`✔ ${s.total} objets (${s.refs} nommés) · ${kb} Ko`);
      console.log(`   twy:${s.twy||0} rwy:${s.rwy||0} apr:${s.apr||0} std:${s.std||0} hold:${s.hold||0}`);
      report.push({icao, ...s, kb:+kb});
    }catch(e){
      console.log("✗ "+e.message);
      report.push({icao, err:e.message});
    }
    await sleep(PAUSE_MS);
  }

  console.log("\n──────── RÉCAPITULATIF ────────");
  console.table(report);
  fs.writeFileSync(path.join(OUT_DIR,"_report.json"), JSON.stringify(report,null,1));
  console.log(`\nFichiers dans ./${OUT_DIR}/`);
}

main().catch(e => { console.error("ERREUR:", e); process.exit(1); });
