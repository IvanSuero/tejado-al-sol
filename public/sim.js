// Tejado al Sol — simulador 3D. Usa Three.js (módulo), Roof y Solar (globales).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const Roof = window.Roof, Solar = window.Solar;
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const BASE = document.documentElement.dataset.base || '/';
const fmt = (x, d = 0) => (x == null || !isFinite(x)) ? '—' : x.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const eur = x => fmt(x) + ' €';
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
const compassName = az => COMPASS[Math.round(((az % 360) + 360) % 360 / 45) % 8];

// ---------------- Estado ----------------
const state = {
  muni: null, rad: null,
  roof: { type: 'gable', length: 10, width: 8, pitch: 30, azimuth: 180, height: 6 },
  panel: { wp: 440, orient: 'portrait', flatTilt: 15 },
  selected: new Set(),
  obstacles: [],
  cons: { annual: 3500, profile: 'fuera' },
  econ: Object.assign({}, Solar.DEFAULT_ECON, { battKwh: 0, grants: 0, ibiYear: 0, ibiYears: 0 }),
  view: { month: 6, hour: 12, heat: true },
};
let slotsAll = [], facesAll = [], boxes = [], lastResult = null, panelYield = new Map(), bestYield = 1;

// ---------------- Escena ----------------
const host = $('#scene');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe8ee');
scene.fog = new THREE.Fog('#dfe8ee', 70, 160);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 500);
camera.position.set(14, 14, 22);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.minDistance = 6; controls.maxDistance = 80;
controls.target.set(0, 5, 0);

scene.add(new THREE.HemisphereLight('#ffffff', '#8a9a7a', 0.9));
const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -25, right: 25, top: 25, bottom: -25, near: 1, far: 120 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), new THREE.MeshBasicMaterial({ color: '#ffcf4a' }));
scene.add(sunBall);

// Suelo con rosa de los vientos
const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 64), new THREE.MeshStandardMaterial({ color: '#c9d4b8', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
function compassTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.translate(512, 512);
  g.strokeStyle = 'rgba(40,60,70,.35)'; g.lineWidth = 4;
  g.beginPath(); g.arc(0, 0, 470, 0, Math.PI * 2); g.stroke();
  for (let a = 0; a < 360; a += 15) {
    const r = a % 45 === 0 ? 420 : 445;
    g.beginPath(); g.moveTo(Math.sin(a * Math.PI / 180) * r, -Math.cos(a * Math.PI / 180) * r);
    g.lineTo(Math.sin(a * Math.PI / 180) * 470, -Math.cos(a * Math.PI / 180) * 470); g.stroke();
  }
  g.font = 'bold 64px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  [['N', 0, '#b8322a'], ['E', 90, '#33454f'], ['S', 180, '#33454f'], ['O', 270, '#33454f']].forEach(([t, a, col]) => {
    g.fillStyle = col; g.fillText(t, Math.sin(a * Math.PI / 180) * 375, -Math.cos(a * Math.PI / 180) * 375);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const rose = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ map: compassTexture(), transparent: true, depthWrite: false }));
rose.rotation.x = -Math.PI / 2; rose.position.y = 0.02; scene.add(rose);

const house = new THREE.Group(); scene.add(house);      // gira con la orientación

const M = {
  wall: new THREE.MeshStandardMaterial({ color: '#f1ede4', roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: '#9b4a35', roughness: 0.8, side: THREE.DoubleSide }),
  roofFlat: new THREE.MeshStandardMaterial({ color: '#b8b3a8', roughness: 0.9 }),
  slot: new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide }),
  slotHover: new THREE.MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }),
  frame: new THREE.MeshStandardMaterial({ color: '#c7ccd1', metalness: 0.6, roughness: 0.4 }),
  chimney: new THREE.MeshStandardMaterial({ color: '#8c5a46', roughness: 0.9 }),
  skylight: new THREE.MeshStandardMaterial({ color: '#9fc4d8', roughness: 0.2, metalness: 0.1 }),
  trunk: new THREE.MeshStandardMaterial({ color: '#6b4f36' }),
  leaves: new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 1 }),
  building: new THREE.MeshStandardMaterial({ color: '#cfc8bc', roughness: 1 }),
};
function cellTexture() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 192;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 192);
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 2;
  for (let x = 0; x <= 128; x += 21.3) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 192); g.stroke(); }
  for (let y = 0; y <= 192; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(128, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const CELLS = cellTexture();

function basis(U, V, N, pos) {
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(...U), new THREE.Vector3(...V), new THREE.Vector3(...N));
  m.setPosition(...pos);
  return m;
}
function clearGroup(g) { while (g.children.length) { const o = g.children.pop(); o.traverse?.(x => x.geometry && x.geometry.dispose()); } }

const roofGroup = new THREE.Group(), slotGroup = new THREE.Group(), panelGroup = new THREE.Group(), obstGroup = new THREE.Group();
house.add(roofGroup, slotGroup, panelGroup, obstGroup);

function buildHouse() {
  clearGroup(roofGroup);
  const r = state.roof, L = r.length, W = r.width, H = r.height;
  const WH = H + (r.type === 'flat' ? 0.35 : 0);
  const walls = new THREE.Mesh(new THREE.BoxGeometry(L, WH, W), M.wall);
  walls.position.y = WH / 2; walls.castShadow = walls.receiveShadow = true; roofGroup.add(walls);
  // Puerta y ventanas en la fachada principal para que se lea cuál es
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.1), new THREE.MeshStandardMaterial({ color: '#5b4636' }));
  door.position.set(0, 1.05, W / 2 + 0.01); roofGroup.add(door);
  for (const x of [-L / 4, L / 4]) for (const y of H > 4.5 ? [1.5, 4.2] : [1.5]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.1), new THREE.MeshStandardMaterial({ color: '#4d6f86', roughness: 0.3 }));
    win.position.set(x, y, W / 2 + 0.01); roofGroup.add(win);
  }
  facesAll = Roof.faces(r);
  for (const f of facesAll) {
    const shape = new THREE.Shape(f.poly.map(([u, w]) => new THREE.Vector2(u, w)));
    const geo = new THREE.ShapeGeometry(shape);
    geo.applyMatrix4(basis(f.U, f.V, f.N, f.O));
    const mesh = new THREE.Mesh(geo, r.type === 'flat' ? M.roofFlat : M.roof);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.face = f.id;
    roofGroup.add(mesh);
  }
  // Cerramientos: hastiales (dos aguas) y laterales (un agua)
  const t = Math.tan(r.pitch * Math.PI / 180);
  const tri = pts => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: '#f1ede4', side: THREE.DoubleSide })); m.castShadow = true; roofGroup.add(m); };
  if (r.type === 'gable') {
    for (const x of [-L / 2, L / 2]) tri([[x, H, W / 2], [x, H, -W / 2], [x, H + W / 2 * t, 0]]);
  } else if (r.type === 'shed') {
    for (const x of [-L / 2, L / 2]) tri([[x, H, W / 2], [x, H, -W / 2], [x, H + W * t, -W / 2]]);
    tri([[-L / 2, H, -W / 2], [L / 2, H, -W / 2], [L / 2, H + W * t, -W / 2], [-L / 2, H, -W / 2], [L / 2, H + W * t, -W / 2], [-L / 2, H + W * t, -W / 2]]);
  }
  house.rotation.y = Math.PI - r.azimuth * Math.PI / 180;
}

function buildObstacles() {
  clearGroup(obstGroup);
  boxes = Roof.obstacleBoxes(state.roof, state.obstacles, state.roof.azimuth);
  for (const b of boxes) {
    const o = b.o, sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
    const cx = (b.min[0] + b.max[0]) / 2, cy = (b.min[1] + b.max[1]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    if (o.kind === 'tree') {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, o.height * 0.4, 8), M.trunk);
      trunk.position.set(cx, o.height * 0.2, cz); trunk.castShadow = true; obstGroup.add(trunk);
      const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), M.leaves);
      crown.scale.set(sx / 2, sy / 2, sz / 2); crown.position.set(cx, cy, cz); crown.castShadow = true; obstGroup.add(crown);
    } else {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), o.kind === 'chimney' ? M.chimney : o.kind === 'skylight' ? M.skylight : M.building);
      mesh.position.set(cx, cy, cz); mesh.castShadow = mesh.receiveShadow = true; obstGroup.add(mesh);
    }
  }
}

function buildSlots() {
  clearGroup(slotGroup);
  slotsAll = [];
  for (const f of facesAll) slotsAll.push(...Roof.slots(state.roof, f, state.panel, boxes));
  const keys = new Set(slotsAll.map(s => s.key));
  for (const k of [...state.selected]) if (!keys.has(k)) state.selected.delete(k);
  for (const s of slotsAll) {
    const geo = new THREE.PlaneGeometry(s.pw - 0.04, s.ph - 0.04);
    geo.applyMatrix4(basis(s.U, s.V, s.N, [s.center[0] + s.N[0] * 0.01, s.center[1] + s.N[1] * 0.01, s.center[2] + s.N[2] * 0.01]));
    const m = new THREE.Mesh(geo, M.slot);
    m.userData.slot = s.key;
    m.visible = !state.selected.has(s.key);
    slotGroup.add(m);
  }
}

function heatColor(rel) {
  // 0,55 → rojo, 0,8 → ámbar, 1 → azul panel normal
  const stops = [[0.55, [190, 60, 45]], [0.8, [232, 170, 40]], [0.93, [70, 120, 170]], [1.0, [26, 52, 92]]];
  rel = Math.max(stops[0][0], Math.min(1, rel));
  for (let i = 1; i < stops.length; i++) if (rel <= stops[i][0]) {
    const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (rel - a) / (b - a);
    return new THREE.Color(...ca.map((c, k) => (c + (cb[k] - c) * t) / 255));
  }
  return new THREE.Color('#1a345c');
}

function buildPanels() {
  clearGroup(panelGroup);
  const byKey = new Map(slotsAll.map(s => [s.key, s]));
  for (const k of state.selected) {
    const s = byKey.get(k); if (!s) continue;
    const g = new THREE.BoxGeometry(s.pw, s.ph, 0.04);
    g.applyMatrix4(basis(s.U, s.V, s.N, s.center));
    let color = new THREE.Color('#1a345c');
    if (state.view.heat && panelYield.has(k)) color = heatColor(panelYield.get(k) / bestYield);
    const mat = new THREE.MeshStandardMaterial({ color, map: CELLS, roughness: 0.35, metalness: 0.2 });
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData.slot = k;
    panelGroup.add(mesh);
  }
  slotGroup.children.forEach(m => { m.visible = !state.selected.has(m.userData.slot); });
}

// Encuadre: mira la fachada principal desde delante y a la derecha, más lejos en pantallas estrechas
function fitCamera() {
  const r = state.roof, aspect = camera.aspect || 1.5;
  const size = Math.max(r.length, r.width, r.height * 1.4);
  const d = size * (aspect < 1 ? 3.1 : 2.35);
  const local = new THREE.Vector3(0.55, 0.62, 1).normalize().multiplyScalar(d);
  const p = local.applyAxisAngle(new THREE.Vector3(0, 1, 0), house.rotation.y);
  camera.position.set(p.x, p.y + r.height * 0.3, p.z);
  controls.target.set(0, r.height * (aspect < 1 ? 0.75 : 0.55), 0);
  controls.update();
}

// ---------------- Sol en la escena ----------------
function updateSun() {
  if (!state.muni) return;
  const m = state.view.month, solarH = Solar.clockToSolar(state.view.hour, state.muni.lon, m);
  const s = Solar.sunVector(state.muni.lat, Solar.REP_DAY[m - 1], solarH);
  const dir = new THREE.Vector3(s[0], s[2], -s[1]); // E, U, −N → x, y, z del mundo
  const up = s[2] > 0;
  sun.position.copy(dir.clone().multiplyScalar(50));
  sun.intensity = up ? 0.6 + 2.0 * Math.min(1, s[2] * 2) : 0;
  sunBall.position.copy(dir.clone().multiplyScalar(45));
  sunBall.visible = up;
  scene.background.set(up ? '#dfe8ee' : '#2a3346');
  scene.fog.color.set(up ? '#dfe8ee' : '#2a3346');
  const alt = Math.asin(Math.max(-1, Math.min(1, s[2]))) * 180 / Math.PI;
  const az = (Math.atan2(s[0], s[1]) * 180 / Math.PI + 360) % 360;
  $('#sun-info').textContent = up ? `Sol a ${fmt(alt)}° de altura, hacia el ${compassName(az)}` : 'El Sol está bajo el horizonte';
}

// ---------------- Cálculo ----------------
let calcTimer = null;
function scheduleCalc() { clearTimeout(calcTimer); calcTimer = setTimeout(calculate, 120); }

function calculate() {
  if (!state.rad || !state.muni) return;
  const byKey = new Map(slotsAll.map(s => [s.key, s]));
  const chosen = [...state.selected].map(k => byKey.get(k)).filter(Boolean);
  const kw = state.panel.wp / 1000;
  const arr = chosen.map(s => {
    const n = Roof.toENU(s.N, state.roof.azimuth);
    return { normal: n, tilt: Math.acos(Math.max(-1, Math.min(1, n[2]))) * 180 / Math.PI, kw, shade: Roof.shadeFn(s, boxes, state.roof.azimuth) };
  });
  const best = Solar.yieldPerKwp(state.muni.lat, state.rad, 35, 180).annual;
  bestYield = best;
  const sim = Solar.simulate(state.muni.lat, state.rad, arr);
  panelYield = new Map(chosen.map((s, i) => [s.key, sim.perPanel[i] / kw]));
  const kwp = chosen.length * kw;
  const bal = Solar.energyBalance(sim, state.muni.lon, state.cons, state.econ.battKwh * 0.9);
  const eco = Solar.economics(bal, Object.assign({}, state.econ, { kwp }));
  lastResult = { sim, bal, eco, kwp, n: chosen.length, chosen, best };
  buildPanels();
  renderResults();
  saveHash();
}

// ---------------- Resultados ----------------
function renderResults() {
  const r = lastResult; if (!r) return;
  const { bal, eco, kwp, n } = r;
  const spec = kwp ? r.sim.annual / kwp : 0;
  $('#panel-count').textContent = `${n} paneles · ${fmt(kwp, 2)} kWp`;
  if (!n) {
    $('#kpis').innerHTML = `<p class="empty">Toca los huecos blancos del tejado para colocar paneles, o pulsa <b>Llenar las mejores caras</b>.</p>`;
    $('#chart-monthly').innerHTML = ''; $('#faces-table').innerHTML = ''; $('#cash-chart').innerHTML = ''; $('#econ-detail').innerHTML = '';
    return;
  }
  const selfPct = bal.prod ? bal.selfUse / bal.prod * 100 : 0;
  const coverPct = bal.cons ? bal.selfUse / bal.cons * 100 : 0;
  $('#kpis').innerHTML = [
    ['Producción', `${fmt(bal.prod)} kWh/año`, `${fmt(spec)} kWh por kWp · ${fmt(spec / r.best * 100)} % de lo ideal aquí`],
    ['Ahorro el primer año', eur(eco.year1), `${fmt(eco.year1 / 12)} € al mes de media`],
    ['Amortización', eco.payback ? `${fmt(eco.payback, 1)} años` : 'más de 25 años', `Inversión ${eur(eco.net)}`],
    ['Beneficio en 25 años', eur(eco.total), 'Descontada la inversión'],
    ['Autoconsumo', `${fmt(selfPct)} %`, `de lo que produces lo usas en casa${state.econ.battKwh ? ' (con batería)' : ''}`],
    ['Cubre tu consumo', `${fmt(coverPct)} %`, `${fmt(bal.selfUse)} de ${fmt(bal.cons)} kWh`],
  ].map(([k, v, s]) => `<div class="kpi"><span class="k">${k}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('');

  // Gráfico mensual: producción (autoconsumo + excedente) frente a consumo
  const W = 640, H = 220, pad = 34, bw = (W - pad) / 12;
  const max = Math.max(...bal.months.map(m => Math.max(m.prod, m.cons))) * 1.1;
  const y = v => H - 24 - v / max * (H - 40);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Producción y consumo por mes">`;
  for (let i = 0; i <= 4; i++) { const v = max / 4 * i; svg += `<line x1="${pad}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${pad - 6}" y="${y(v) + 4}" class="ax" text-anchor="end">${fmt(v)}</text>`; }
  bal.months.forEach((m, i) => {
    const x = pad + i * bw + bw * 0.18, w = bw * 0.64;
    svg += `<rect x="${x}" y="${y(m.selfUse)}" width="${w}" height="${y(0) - y(m.selfUse)}" class="b-self"><title>${MONTHS[i]}: ${fmt(m.selfUse)} kWh autoconsumidos</title></rect>`;
    svg += `<rect x="${x}" y="${y(m.prod)}" width="${w}" height="${Math.max(0, y(m.selfUse) - y(m.prod))}" class="b-sur"><title>${MONTHS[i]}: ${fmt(m.prod - m.selfUse)} kWh de excedente</title></rect>`;
    svg += `<text x="${x + w / 2}" y="${H - 6}" class="ax" text-anchor="middle">${MONTHS[i]}</text>`;
  });
  svg += `<polyline points="${bal.months.map((m, i) => `${pad + i * bw + bw / 2},${y(m.cons)}`).join(' ')}" class="l-cons"/>`;
  bal.months.forEach((m, i) => { svg += `<circle cx="${pad + i * bw + bw / 2}" cy="${y(m.cons)}" r="3.5" class="d-cons"><title>${MONTHS[i]}: consumo ${fmt(m.cons)} kWh</title></circle>`; });
  svg += `</svg>`;
  $('#chart-monthly').innerHTML = svg + `<p class="legend"><span><i class="sw sw-self"></i>Autoconsumo</span><span><i class="sw sw-sur"></i>Excedente a la red</span><span><i class="sw sw-cons"></i>Tu consumo</span><span class="unit">kWh/mes</span></p>`;

  // Tabla por cara
  const byFace = {};
  r.chosen.forEach((s, i) => { const f = byFace[s.face] = byFace[s.face] || { n: 0, kwh: 0 }; f.n++; f.kwh += r.sim.perPanel[i]; });
  const fname = id => (facesAll.find(f => f.id === id) || {}).name || id;
  const faceAz = id => { const f = facesAll.find(x => x.id === id); if (!f) return ''; const s = r.chosen.find(x => x.face === id); const n = Roof.toENU(s ? s.N : f.N, state.roof.azimuth); return Math.hypot(n[0], n[1]) < 0.05 ? 'horizontal' : compassName((Math.atan2(n[0], n[1]) * 180 / Math.PI + 360) % 360); };
  $('#faces-table').innerHTML = `<table class="tbl"><thead><tr><th>Cara</th><th>Mira al</th><th>Paneles</th><th>kWh/año</th><th>kWh por kWp</th></tr></thead><tbody>${Object.entries(byFace).map(([id, f]) => `<tr><td>${fname(id)}</td><td>${faceAz(id)}</td><td>${f.n}</td><td>${fmt(f.kwh)}</td><td>${fmt(f.kwh / (f.n * state.panel.wp / 1000))}</td></tr>`).join('')}</tbody></table>`;

  // Flujo de caja acumulado
  const CW = 640, CH = 180, cp = 44;
  const vals = eco.cash.map(c => c.cum);
  const lo = Math.min(-eco.net, ...vals), hi = Math.max(0, ...vals);
  const cy = v => 12 + (hi - v) / (hi - lo || 1) * (CH - 36);
  const cx = yv => cp + (yv / eco.cash.length) * (CW - cp - 34);
  let cs = `<svg viewBox="0 0 ${CW} ${CH}" role="img" aria-label="Ahorro acumulado menos inversión">`;
  cs += `<line x1="${cp}" x2="${CW - 10}" y1="${cy(0)}" y2="${cy(0)}" class="zero"/>`;
  cs += `<text x="${cp - 6}" y="${cy(hi) + 4}" class="ax" text-anchor="end">${fmt(hi / 1000, 0)}k</text><text x="${cp - 6}" y="${cy(lo) + 4}" class="ax" text-anchor="end">${fmt(lo / 1000, 0)}k</text><text x="${cp - 6}" y="${cy(0) + 4}" class="ax" text-anchor="end">0</text>`;
  const pts = [[0, -eco.net], ...eco.cash.map(c => [c.y, c.cum])];
  cs += `<polyline points="${pts.map(([a, b]) => `${cx(a)},${cy(b)}`).join(' ')}" class="l-cash"/>`;
  [5, 10, 15, 20, 25].forEach(yv => { cs += `<text x="${cx(yv)}" y="${CH - 4}" class="ax" text-anchor="middle">año ${yv}</text>`; });
  if (eco.payback) cs += `<circle cx="${cx(eco.payback)}" cy="${cy(0)}" r="5" class="d-pay"/><text x="${cx(eco.payback) + 8}" y="${cy(0) - 8}" class="ax strong">amortizada</text>`;
  cs += `</svg>`;
  $('#cash-chart').innerHTML = cs;

  const notes = [];
  if (eco.uncompensatedKwh > 50) notes.push(`Unos ${fmt(eco.uncompensatedKwh)} kWh de excedente al año no se compensan, porque la compensación no puede superar lo que pagas por la energía. Con menos paneles o una batería aprovecharías mejor la instalación.`);
  if (spec / r.best < 0.8) notes.push('Parte de los paneles rinde bastante menos que en un tejado ideal (orientación, inclinación o sombras). Activa «Ver rendimiento» para ver cuáles.');
  $('#econ-detail').innerHTML = `<dl class="dl">
<div><dt>Factura de energía sin placas</dt><dd>${eur(eco.billBefore)}/año</dd></div>
<div><dt>Ahorro por autoconsumo</dt><dd>${eur(eco.selfSaving)}/año</dd></div>
<div><dt>Compensación de excedentes</dt><dd>${eur(eco.compensation)}/año</dd></div>
<div><dt>Energía que sigues comprando</dt><dd>${fmt(bal.grid)} kWh/año</dd></div>
<div><dt>Inversión</dt><dd>${eur(eco.capex)}${state.econ.grants ? ` − ${eur(state.econ.grants)} de ayudas` : ''}</dd></div>
</dl>${notes.map(n => `<p class="note">${n}</p>`).join('')}`;
}

// ---------------- Selección de paneles ----------------
function fillBest(all) {
  state.selected.clear();
  const ref = Solar.yieldPerKwp(state.muni ? state.muni.lat : 40, state.rad || dummyRad(), 35, 180).annual;
  for (const f of facesAll) {
    const fs = slotsAll.filter(s => s.face === f.id); if (!fs.length) continue;
    const n = Roof.toENU(fs[0].N, state.roof.azimuth);
    const y = Solar.yieldPerKwp(state.muni ? state.muni.lat : 40, state.rad || dummyRad(), Math.acos(n[2]) * 180 / Math.PI, (Math.atan2(n[0], n[1]) * 180 / Math.PI + 360) % 360).annual;
    if (all || y / ref >= 0.8) fs.forEach(s => state.selected.add(s.key));
  }
  buildPanels(); scheduleCalc();
}
// Tamaño óptimo: prueba de 2 paneles hasta el máximo (los mejores huecos primero) y elige el que más beneficio deja
// a 25 años; si uno más pequeño se queda a menos de un 3 %, se queda con el pequeño (se amortiza antes).
function optimize() {
  if (!state.rad || !state.muni || !slotsAll.length) return;
  const kw = state.panel.wp / 1000;
  const mk = s => { const n = Roof.toENU(s.N, state.roof.azimuth); return { normal: n, tilt: Math.acos(Math.max(-1, Math.min(1, n[2]))) * 180 / Math.PI, kw, shade: Roof.shadeFn(s, boxes, state.roof.azimuth) }; };
  const all = slotsAll.map(mk);
  const simAll = Solar.simulate(state.muni.lat, state.rad, all);
  const order = slotsAll.map((s, i) => ({ s, y: simAll.perPanel[i], a: all[i] })).filter(o => o.y > 0).sort((a, b) => b.y - a.y);
  const maxN = Math.min(order.length, 40);
  let best = null;
  const results = [];
  for (let n = 2; n <= maxN; n++) {
    const sim = Solar.simulate(state.muni.lat, state.rad, order.slice(0, n).map(o => o.a));
    const bal = Solar.energyBalance(sim, state.muni.lon, state.cons, state.econ.battKwh * 0.9);
    const eco = Solar.economics(bal, Object.assign({}, state.econ, { kwp: n * kw }));
    results.push({ n, total: eco.total });
    if (!best || eco.total > best.total) best = { n, total: eco.total };
  }
  if (!best) return;
  const pick = results.find(r => r.total >= best.total * 0.97) || best;
  state.selected = new Set(order.slice(0, pick.n).map(o => o.s.key));
  buildPanels(); scheduleCalc();
  const out = $('#opt-out'); if (out) out.textContent = `Con tu consumo, lo más rentable son unos ${pick.n} paneles.`;
}
function dummyRad() { return { G: [70, 90, 140, 165, 200, 215, 225, 195, 150, 110, 75, 62], Kd: new Array(12).fill(0.35), T: new Array(12).fill(15) }; }

// Interacción con el ratón / dedo: tocar hueco o panel
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let downAt = null, placing = null, hovered = null;
function pick(ev, objs) {
  const rect = renderer.domElement.getBoundingClientRect();
  ptr.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  return ray.intersectObjects(objs, false)[0];
}
renderer.domElement.addEventListener('pointerdown', e => { downAt = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const hit = pick(e, placing ? roofGroup.children.filter(m => m.userData.face) : slotGroup.children.filter(m => m.visible));
  const obj = hit && !placing ? hit.object : null;
  if (hovered && hovered !== obj) hovered.material = M.slot;
  if (obj) obj.material = M.slotHover;
  hovered = obj;
  renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
});
renderer.domElement.addEventListener('pointerup', e => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  if (placing) {
    const hit = pick(e, roofGroup.children.filter(m => m.userData.face));
    if (hit) {
      const p = house.worldToLocal(hit.point.clone());
      state.obstacles.push(Object.assign({ x: +p.x.toFixed(2), z: +p.z.toFixed(2) }, placing));
      placing = null; document.body.classList.remove('placing');
      rebuild(); renderObstacleList();
    }
    return;
  }
  const hit = pick(e, [...slotGroup.children.filter(m => m.visible), ...panelGroup.children]);
  if (!hit) return;
  const k = hit.object.userData.slot;
  if (state.selected.has(k)) state.selected.delete(k); else state.selected.add(k);
  buildPanels(); scheduleCalc();
});

// ---------------- Obstáculos ----------------
const OB_LABEL = { chimney: 'Chimenea', skylight: 'Claraboya', tree: 'Árbol', building: 'Edificio vecino' };
function renderObstacleList() {
  const list = $('#obst-list');
  if (!state.obstacles.length) { list.innerHTML = '<li class="muted">Sin obstáculos. Añade chimeneas, árboles o edificios cercanos para ver sus sombras.</li>'; return; }
  list.innerHTML = state.obstacles.map((o, i) => {
    const onRoof = o.kind === 'chimney' || o.kind === 'skylight';
    return `<li><b>${OB_LABEL[o.kind]}</b>
${onRoof ? '' : `<label>Dirección <select data-i="${i}" data-k="az">${COMPASS.map((c, j) => `<option value="${j * 45}"${Math.round(o.az / 45) % 8 === j ? ' selected' : ''}>${c}</option>`).join('')}</select></label>
<label>Distancia <input type="number" min="3" max="60" step="1" value="${o.dist}" data-i="${i}" data-k="dist"> m</label>`}
${o.kind === 'skylight' ? '' : `<label>Altura <input type="number" min="0.3" max="40" step="0.1" value="${o.height}" data-i="${i}" data-k="height"> m</label>`}
<label>Ancho <input type="number" min="0.2" max="30" step="0.1" value="${o.size}" data-i="${i}" data-k="size"> m</label>
<button type="button" class="x" data-del="${i}" aria-label="Quitar">Quitar</button></li>`;
  }).join('');
}
$('#obst-list').addEventListener('input', e => {
  const t = e.target; if (!t.dataset.k) return;
  const v = parseFloat(t.value); if (!isFinite(v)) return;
  state.obstacles[+t.dataset.i][t.dataset.k] = v; rebuild();
});
$('#obst-list').addEventListener('click', e => { const d = e.target.dataset.del; if (d != null) { state.obstacles.splice(+d, 1); renderObstacleList(); rebuild(); } });
$('#add-chimney').addEventListener('click', () => { placing = { kind: 'chimney', height: 1.2, size: 0.6 }; document.body.classList.add('placing'); });
$('#add-skylight').addEventListener('click', () => { placing = { kind: 'skylight', height: 0.15, size: 1 }; document.body.classList.add('placing'); });
$('#add-tree').addEventListener('click', () => { state.obstacles.push({ kind: 'tree', az: 225, dist: 9, height: 8, size: 5 }); renderObstacleList(); rebuild(); });
$('#add-building').addEventListener('click', () => { state.obstacles.push({ kind: 'building', az: 180, dist: 14, height: 12, size: 12 }); renderObstacleList(); rebuild(); });
$('#cancel-place').addEventListener('click', () => { placing = null; document.body.classList.remove('placing'); });

// ---------------- Controles ----------------
function rebuild() { buildHouse(); buildObstacles(); buildSlots(); buildPanels(); updateSun(); scheduleCalc(); }

function bindNum(id, obj, key, after) {
  const el = $(id); if (!el) return;
  el.value = obj[key];
  el.addEventListener('input', () => { const v = parseFloat(el.value); if (isFinite(v)) { obj[key] = v; (after || scheduleCalc)(); } });
}
function syncInputs() {
  $$('#roof-type button').forEach(b => b.setAttribute('aria-pressed', b.dataset.roof === state.roof.type));
  for (const [id, o, k] of [['#r-length', state.roof, 'length'], ['#r-width', state.roof, 'width'], ['#r-pitch', state.roof, 'pitch'], ['#r-height', state.roof, 'height'], ['#r-az', state.roof, 'azimuth'],
    ['#p-wp', state.panel, 'wp'], ['#flat-tilt', state.panel, 'flatTilt'], ['#c-annual', state.cons, 'annual'], ['#e-price', state.econ, 'price'], ['#e-comp', state.econ, 'comp'],
    ['#e-cost', state.econ, 'costKwp'], ['#e-batt', state.econ, 'battKwh'], ['#e-battcost', state.econ, 'battCostKwh'], ['#e-grants', state.econ, 'grants'], ['#e-ibi', state.econ, 'ibiYear'],
    ['#e-ibiyears', state.econ, 'ibiYears'], ['#e-growth', state.econ, 'priceGrowth']]) { const el = $(id); if (el) el.value = o[k]; }
  $('#p-orient').value = state.panel.orient; $('#c-profile').value = state.cons.profile;
  $('#heat').checked = state.view.heat;
  updateAzLabel(); updateRoofUi();
}
function updateAzLabel() {
  const a = state.roof.azimuth;
  $('#r-az-label').textContent = `${compassName(a)} (${Math.round(a)}°)`;
  $('#az-arrow').setAttribute('transform', `rotate(${a} 30 30)`);
}
function updateRoofUi() {
  const t = state.roof.type;
  $('#row-pitch').hidden = t === 'flat';
  $('#row-flat-tilt').hidden = t !== 'flat';
  $('#az-help').textContent = t === 'flat' ? 'Hacia dónde miran los paneles (y la fachada principal).' : t === 'shed' ? 'Hacia dónde cae el agua del tejado.' : 'Hacia dónde mira la fachada principal (el faldón delantero).';
}
$('#roof-type').addEventListener('click', e => {
  const b = e.target.closest('button[data-roof]'); if (!b) return;
  state.roof.type = b.dataset.roof; state.selected.clear(); syncInputs(); rebuild(); fitCamera(); setTimeout(optimize, 0);
});
const geoChange = () => { rebuild(); };
bindNum('#r-length', state.roof, 'length', geoChange);
bindNum('#r-width', state.roof, 'width', geoChange);
bindNum('#r-pitch', state.roof, 'pitch', geoChange);
bindNum('#r-height', state.roof, 'height', geoChange);
bindNum('#r-az', state.roof, 'azimuth', () => { updateAzLabel(); rebuild(); });
bindNum('#flat-tilt', state.panel, 'flatTilt', geoChange);
bindNum('#p-wp', state.panel, 'wp');
$('#p-orient').addEventListener('change', e => { state.panel.orient = e.target.value; state.selected.clear(); rebuild(); setTimeout(optimize, 0); });
bindNum('#c-annual', state.cons, 'annual');
$('#c-profile').addEventListener('change', e => { state.cons.profile = e.target.value; scheduleCalc(); });
for (const [id, k] of [['#e-price', 'price'], ['#e-comp', 'comp'], ['#e-cost', 'costKwp'], ['#e-batt', 'battKwh'], ['#e-battcost', 'battCostKwh'], ['#e-grants', 'grants'], ['#e-ibi', 'ibiYear'], ['#e-ibiyears', 'ibiYears'], ['#e-growth', 'priceGrowth']]) bindNum(id, state.econ, k);
$('#fill-best').addEventListener('click', () => fillBest(false));
$('#optimize').addEventListener('click', optimize);
$('#recenter').addEventListener('click', fitCamera);
$('#fill-all').addEventListener('click', () => fillBest(true));
$('#clear').addEventListener('click', () => { state.selected.clear(); buildPanels(); scheduleCalc(); });
$('#heat').addEventListener('change', e => { state.view.heat = e.target.checked; buildPanels(); });
$$('[data-az]').forEach(b => b.addEventListener('click', () => { state.roof.azimuth = +b.dataset.az; $('#r-az').value = state.roof.azimuth; updateAzLabel(); rebuild(); }));

// Sol: mes y hora
const monthSel = $('#view-month');
monthSel.innerHTML = MONTHS.map((m, i) => `<option value="${i + 1}">${['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'][i]}</option>`).join('');
monthSel.value = state.view.month;
monthSel.addEventListener('change', () => { state.view.month = +monthSel.value; updateSun(); });
const hourIn = $('#view-hour');
function setHour(h) { state.view.hour = h; hourIn.value = h; const hh = Math.floor(h), mm = Math.round((h - hh) * 60); $('#view-hour-label').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`; updateSun(); }
hourIn.addEventListener('input', () => setHour(+hourIn.value));
let playing = null;
$('#play').addEventListener('click', () => {
  if (playing) { cancelAnimationFrame(playing); playing = null; $('#play').textContent = 'Ver el día'; return; }
  $('#play').textContent = 'Parar';
  let h = 6; const step = () => { h += 0.04; if (h > 22) h = 6; setHour(+h.toFixed(2)); playing = requestAnimationFrame(step); };
  playing = requestAnimationFrame(step);
});

// ---------------- Municipio ----------------
let index = null;
async function loadIndex() { if (!index) index = await (await fetch(BASE + 'assets/munis.json')).json(); return index; }
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
async function selectMuni(id) {
  const ix = await loadIndex();
  const row = ix.find(r => r[0] === id); if (!row) return false;
  const [mid, name, prov, provCode, lat, lon, path] = row;
  const radFile = await (await fetch(`${BASE}assets/rad/${provCode}.json`)).json();
  state.muni = { id: mid, name, prov, lat, lon, path };
  state.rad = Solar.unpack(radFile[mid]);
  $('#muni-name').textContent = `${name} (${prov})`;
  $('#muni-link').href = BASE + path; $('#muni-link').hidden = false;
  $('#muni-q').value = '';
  updateSun(); scheduleCalc();
  return true;
}
const q = $('#muni-q'), res = $('#muni-results');
q.addEventListener('input', async () => {
  const v = norm(q.value.trim());
  if (v.length < 2) { res.hidden = true; return; }
  const ix = await loadIndex();
  const pre = [], inc = [];
  for (const r of ix) { const k = norm(r[1]); if (k.startsWith(v)) pre.push(r); else if (inc.length < 8 && k.includes(v)) inc.push(r); if (pre.length >= 8) break; }
  const list = pre.concat(inc).slice(0, 8);
  res.innerHTML = list.map(r => `<li><button type="button" data-id="${r[0]}">${r[1]} <span>${r[2]}</span></button></li>`).join('');
  res.hidden = !list.length;
});
res.addEventListener('click', e => { const b = e.target.closest('button[data-id]'); if (b) { selectMuni(b.dataset.id); res.hidden = true; } });
q.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = res.querySelector('button'); if (b) { selectMuni(b.dataset.id); res.hidden = true; } } });

// ---------------- Compartir (estado en el enlace) ----------------
function encodeState() {
  const s = { m: state.muni && state.muni.id, r: state.roof, p: state.panel, s: [...state.selected], o: state.obstacles, c: state.cons, e: state.econ };
  return btoa(unescape(encodeURIComponent(JSON.stringify(s)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
let hashTimer = null;
function saveHash() { clearTimeout(hashTimer); hashTimer = setTimeout(() => { history.replaceState(null, '', '#' + encodeState()); }, 400); }
function loadHash() {
  const h = location.hash.slice(1); if (!h || h.length < 20) return null;
  try { return JSON.parse(decodeURIComponent(escape(atob(h.replace(/-/g, '+').replace(/_/g, '/'))))); } catch (e) { return null; }
}
$('#share').addEventListener('click', async () => {
  const url = location.href.split('#')[0] + '#' + encodeState();
  try { await navigator.clipboard.writeText(url); $('#share-out').textContent = 'Enlace copiado. Quien lo abra verá tu tejado tal cual.'; }
  catch (e) { $('#share-out').innerHTML = `<input readonly value="${url}" onclick="this.select()">`; }
});

// ---------------- Arranque ----------------
function resize() {
  const w = host.clientWidth, h = host.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
(function loop() { controls.update(); renderer.render(scene, camera); requestAnimationFrame(loop); })();

(async function boot() {
  const saved = loadHash();
  const params = new URLSearchParams(location.search);
  if (saved) {
    Object.assign(state.roof, saved.r || {}); Object.assign(state.panel, saved.p || {}); Object.assign(state.cons, saved.c || {}); Object.assign(state.econ, saved.e || {});
    state.obstacles = saved.o || []; state.selected = new Set(saved.s || []);
  }
  syncInputs(); renderObstacleList(); rebuild(); setHour(state.view.hour);
  const id = (saved && saved.m) || params.get('m') || document.documentElement.dataset.muni || '3117735';
  const ok = await selectMuni(id);
  if (!ok) await selectMuni('3117735');
  resize(); fitCamera();
  if (!saved) optimize(); else { buildPanels(); scheduleCalc(); }
  document.body.classList.add('ready');
})().catch(e => console.error('boot', e && e.stack || e));
