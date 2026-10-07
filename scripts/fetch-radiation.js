#!/usr/bin/env node
/*
 * Descarga de PVGIS (Comisión Europea, JRC) la radiación media mensual de cada municipio:
 *   G  = irradiación global horizontal mensual (kWh/m²)
 *   Kd = fracción difusa (difusa / global)
 *   T  = temperatura media a 2 m (°C)
 * Promedia todos los años disponibles. Reanudable: solo pide lo que falta.
 * Uso: node scripts/fetch-radiation.js [--limit N]
 */
const fs = require('fs');
const path = require('path');
const { loadMunicipalities, haversine } = require('../src/data.js');

const OUT = path.join(__dirname, '..', 'data', 'radiation.json');
const ENDPOINTS = ['https://re.jrc.ec.europa.eu/api/v5_3/MRcalc', 'https://re.jrc.ec.europa.eu/api/v5_2/MRcalc'];
const CONCURRENCY = 6;
const args = process.argv.slice(2);
const LIMIT = +(args[args.indexOf('--limit') + 1] || 0) || 0;

const sleep = ms => new Promise(r => setTimeout(r, ms));

function pick(rec, re) { const k = Object.keys(rec).find(k => re.test(k)); return k ? rec[k] : undefined; }

function parse(json) {
  const rows = json && json.outputs && json.outputs.monthly;
  if (!Array.isArray(rows) || !rows.length) throw new Error('respuesta sin datos mensuales');
  const acc = Array.from({ length: 12 }, () => ({ g: 0, kd: 0, t: 0, n: 0, nt: 0, nk: 0 }));
  for (const r of rows) {
    const m = +r.month - 1;
    const g = pick(r, /^H\(h\)_m$/) ?? pick(r, /^H\(h\)/);
    const kd = pick(r, /^Kd$/);
    const t = pick(r, /^T2m/);
    if (g == null || !(m >= 0 && m < 12)) continue;
    acc[m].g += +g; acc[m].n++;
    if (kd != null) { acc[m].kd += +kd; acc[m].nk++; }
    if (t != null) { acc[m].t += +t; acc[m].nt++; }
  }
  if (acc.some(a => !a.n)) throw new Error('faltan meses');
  return {
    G: acc.map(a => +(a.g / a.n).toFixed(1)),
    Kd: acc.map(a => +(a.nk ? a.kd / a.nk : 0.35).toFixed(3)),
    T: acc.map(a => +(a.nt ? a.t / a.nt : 15).toFixed(1)),
  };
}

async function query(lat, lon) {
  let lastErr;
  for (const ep of ENDPOINTS) {
    const url = `${ep}?lat=${lat}&lon=${lon}&horirrad=1&d2g=1&avtemp=1&outputformat=json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(url, { headers: { 'User-Agent': 'tejado-al-sol (datos de radiacion por municipio)' } });
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) { lastErr = new Error('HTTP ' + res.status); await sleep(1500 * (attempt + 1)); continue; }
        if (!res.ok) { lastErr = new Error(`HTTP ${res.status}: ${text.slice(0, 160)}`); break; }
        return parse(JSON.parse(text));
      } catch (e) { lastErr = e; await sleep(800 * (attempt + 1)); }
    }
  }
  throw lastErr;
}

// Municipios costeros: si el punto cae en el mar, probamos ligeros desplazamientos hacia tierra
async function queryNear(lat, lon) {
  try { return await query(lat, lon); } catch (e) {
    const offs = [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02], [0.03, 0.03], [-0.03, -0.03], [0.03, -0.03], [-0.03, 0.03], [0.06, 0], [-0.06, 0], [0, 0.06], [0, -0.06]];
    for (const [a, b] of offs) {
      try { return await query(+(lat + a).toFixed(4), +(lon + b).toFixed(4)); } catch (_) { /* siguiente */ }
    }
    throw e;
  }
}

(async () => {
  const munis = loadMunicipalities();
  let data = { meta: { source: 'PVGIS (JRC, Comisión Europea) — medias mensuales de todos los años disponibles', synthetic: false }, munis: {} };
  if (fs.existsSync(OUT)) {
    const prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    if (!prev.meta || !prev.meta.synthetic) data = prev;
  }
  let todo = munis.filter(m => !data.munis[m.id]);
  if (LIMIT) todo = todo.slice(0, LIMIT);
  console.log(`PVGIS: ${todo.length} municipios por descargar (${Object.keys(data.munis).length} ya guardados)`);
  const failed = [];
  let done = 0;
  const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(data)); };
  const queue = todo.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) {
      const m = queue.shift();
      try {
        const r = await queryNear(m.lat, m.lon);
        data.munis[m.id] = [...r.G, ...r.Kd, ...r.T];
      } catch (e) { failed.push(m); if (failed.length <= 10) console.warn(`  sin datos: ${m.name} (${m.prov}): ${e.message}`); }
      if (++done % 100 === 0) { console.log(`  ${done}/${todo.length}`); save(); }
      await sleep(120);
    }
  }));
  // Los que fallen (islotes, errores puntuales) toman los datos del municipio con datos más cercano
  for (const m of failed) {
    const near = munis.filter(x => data.munis[x.id]).map(x => ({ x, d: haversine(m, x) })).sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 25) { data.munis[m.id] = data.munis[near.x.id].slice(); console.log(`  ${m.name}: usa datos de ${near.x.name} (${near.d.toFixed(1)} km)`); }
  }
  data.meta.updated = new Date().toISOString().slice(0, 10);
  save();
  const have = munis.filter(m => data.munis[m.id]).length;
  console.log(`Listo: ${have}/${munis.length} municipios con datos.`);
  if (have < munis.length * 0.95) { console.error('Demasiados municipios sin datos; revisa la conexión con PVGIS.'); process.exit(1); }
})();
