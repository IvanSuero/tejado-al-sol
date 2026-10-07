#!/usr/bin/env node
// SOLO PARA DESARROLLO LOCAL sin conexión a PVGIS: genera radiación aproximada (marcada como sintética).
// El build se niega a publicar con estos datos en GitHub Actions.
const fs = require('fs');
const path = require('path');
const { loadMunicipalities } = require('../src/data.js');

const OUT = path.join(__dirname, '..', 'data', 'radiation.json');
if (fs.existsSync(OUT) && !JSON.parse(fs.readFileSync(OUT, 'utf8')).meta.synthetic) {
  console.log('Ya hay datos reales de PVGIS; no se sobrescriben.'); process.exit(0);
}
const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const kt = [0.50, 0.53, 0.56, 0.57, 0.60, 0.65, 0.68, 0.66, 0.60, 0.55, 0.50, 0.48];
function h0(lat, n) { // extraterrestre diaria horizontal kWh/m²
  const r = Math.PI / 180, d = 23.45 * Math.sin(r * 360 * (284 + n) / 365), phi = lat * r, dr = d * r;
  const ws = Math.acos(Math.max(-1, Math.min(1, -Math.tan(phi) * Math.tan(dr))));
  return 24 / Math.PI * 1.367 * (1 + 0.033 * Math.cos(2 * Math.PI * n / 365)) * (Math.cos(phi) * Math.cos(dr) * Math.sin(ws) + ws * Math.sin(phi) * Math.sin(dr));
}
const munis = {};
for (const m of loadMunicipalities()) {
  const south = Math.max(0, (43.5 - m.lat) / 7); // más despejado hacia el sur
  const G = [], Kd = [], T = [];
  let n = 0;
  for (let i = 0; i < 12; i++) {
    const mid = n + 15; n += days[i];
    const k = Math.min(0.75, kt[i] + 0.05 * south);
    G.push(+(h0(m.lat, mid) * k * days[i]).toFixed(1));
    Kd.push(+(0.62 - 0.45 * k).toFixed(3));
    T.push(+(10 + 7 * south + 8 * Math.sin((i - 3) / 12 * 2 * Math.PI)).toFixed(1));
  }
  munis[m.id] = [...G, ...Kd, ...T];
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ meta: { source: 'SINTÉTICO (solo desarrollo)', synthetic: true }, munis }));
console.log('Datos sintéticos de desarrollo escritos para', Object.keys(munis).length, 'municipios.');
