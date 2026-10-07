#!/usr/bin/env node
// Genera el sitio estático en dist/. Uso: node build.js [--limit N] [--out dir]
const fs = require('fs');
const path = require('path');
const cfg = require('./site.config.js');
const Solar = require('./src/solar.js');
const { PROVINCES, loadMunicipalities, slugify, nearest } = require('./src/data.js');

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const LIMIT = +opt('--limit', 0);
const OUT = path.resolve(opt('--out', 'dist'));
const YEAR = new Date().getFullYear();
const VER = Date.now().toString(36);

// ---------- Datos ----------
const radFile = path.join(__dirname, 'data', 'radiation.json');
if (!fs.existsSync(radFile)) { console.error('Falta data/radiation.json. Ejecuta: node scripts/fetch-radiation.js'); process.exit(1); }
const RAD = JSON.parse(fs.readFileSync(radFile, 'utf8'));
if (RAD.meta.synthetic && process.env.CI) { console.error('Los datos de radiación son sintéticos: no se publican. Ejecuta scripts/fetch-radiation.js.'); process.exit(1); }
if (RAD.meta.synthetic) console.warn('⚠️  Usando datos de radiación SINTÉTICOS (solo para desarrollo).');

let munis = loadMunicipalities().filter(m => RAD.munis[m.id]);
if (LIMIT) {
  const keep = new Set(munis.slice(0, LIMIT).map(m => m.id));
  munis = munis.filter(m => keep.has(m.id) || m.provCode === '43');
}

// ---------- Utilidades ----------
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (x, d = 0) => Number(x).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const L = p => cfg.basePath + p;
const abs = p => cfg.siteUrl + cfg.basePath + p;
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const pages = [];
function write(rel, html) {
  const f = path.join(OUT, rel.endsWith('/') || rel === '' ? rel + 'index.html' : rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, html);
  if (!rel.endsWith('.html') && !rel.endsWith('.xml') && !rel.endsWith('.txt')) pages.push(rel);
}

// ---------- Cálculos por municipio ----------
const ORIENT = [
  ['Sur, 30°', 30, 180], ['Sureste o suroeste, 30°', 30, 135], ['Este u oeste, 30°', 30, 90], ['Cubierta plana, 15° al sur', 15, 180], ['Norte, 30°', 30, 0],
];
const PANEL_W = 440;
function municipioStats(m) {
  const rad = Solar.unpack(RAD.munis[m.id]);
  const ys = ORIENT.map(([, t, a]) => Solar.yieldPerKwp(m.lat, rad, t, a));
  const s30 = ys[0];
  const examples = [6, 8, 12].map(n => {
    const kwp = n * PANEL_W / 1000;
    const sim = { monthly: s30.monthly.map(x => x * kwp), annual: s30.annual * kwp, profiles: s30.profiles.map(p => ({ hours: p.hours, kw: p.kw.map(k => k * kwp) })) };
    const bal = Solar.energyBalance(sim, m.lon, { annual: 3500, profile: 'fuera' }, 0);
    const eco = Solar.economics(bal, Object.assign({}, Solar.DEFAULT_ECON, { kwp, battKwh: 0 }));
    return { n, kwp, prod: bal.prod, selfPct: bal.selfUse / bal.prod * 100, year1: eco.year1, payback: eco.payback, total: eco.total, net: eco.net };
  });
  return { rad, G: rad.G.reduce((a, b) => a + b, 0), yields: ys.map(y => y.annual), monthly: s30.monthly, examples };
}

console.time('cálculos');
const stats = new Map(munis.map(m => [m.id, municipioStats(m)]));
console.timeEnd('cálculos');
const allYields = munis.map(m => stats.get(m.id).yields[0]).sort((a, b) => a - b);
const percentile = y => Math.round(allYields.filter(v => v <= y).length / allYields.length * 100);
const byProv = {};
for (const m of munis) (byProv[m.provCode] = byProv[m.provCode] || []).push(m);

// ---------- Layout ----------
function layout({ rel, title, description, body, jsonld = [], extraHead = '', bodyClass = '', scripts = '' }) {
  const nav = [['simulador/', 'Simulador 3D'], ['provincias/', 'Municipios'], ['como-calculamos/', 'Cómo calculamos']];
  return `<!doctype html>
<html lang="es" data-base="${cfg.basePath}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${abs(rel)}">
<meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${abs(rel)}"><meta property="og:locale" content="es_ES"><meta property="og:site_name" content="${cfg.siteName}">
<meta name="theme-color" content="#f6f7f3">
${cfg.googleVerification ? `<meta name="google-site-verification" content="${esc(cfg.googleVerification)}">` : ''}
<link rel="icon" href="${L('assets/favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Figtree:wght@400;500;600&display=swap">
<link rel="stylesheet" href="${L('assets/style.css')}?v=${VER}">
${cfg.adsenseClient ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${esc(cfg.adsenseClient)}" crossorigin="anonymous"></script>` : ''}
${jsonld.map(j => `<script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
${extraHead}
</head>
<body class="${bodyClass}">
<a class="skip" href="#main">Saltar al contenido</a>
<header class="site-head"><div class="wrap">
<a class="brand" href="${L('')}">${logo()}<span>Tejado <b>al Sol</b></span></a>
<nav aria-label="Principal">${nav.map(([p, t]) => `<a href="${L(p)}"${rel.startsWith(p) ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
</div></header>
<main id="main">${body}</main>
<footer class="site-foot"><div class="wrap">
<div><p class="brand small">${logo()}<span>Tejado <b>al Sol</b></span></p><p>${esc(cfg.tagline)}. Cálculo independiente, sin vender placas ni pedir tus datos.</p></div>
<div><h3>Explorar</h3><ul><li><a href="${L('simulador/')}">Simulador 3D</a></li><li><a href="${L('provincias/')}">Municipios por provincia</a></li><li><a href="${L('ranking/')}">Municipios con más sol</a></li></ul></div>
<div><h3>Sitio</h3><ul><li><a href="${L('como-calculamos/')}">Cómo calculamos</a></li><li><a href="${L('aviso-legal/')}">Aviso legal</a></li><li><a href="${L('privacidad/')}">Privacidad</a></li></ul></div>
<p class="credits">Radiación solar: <a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en">PVGIS</a> © Unión Europea (JRC). Municipios: <a href="https://www.geonames.org/">GeoNames</a> (CC BY 4.0). Modelo 3D con <a href="https://threejs.org/">Three.js</a>. Los resultados son estimaciones orientativas; pide siempre un estudio a un instalador antes de contratar.</p>
</div></footer>
${scripts}
</body>
</html>`;
}
function logo() {
  return `<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true"><circle cx="23" cy="9" r="5" fill="#f2a71b"/><path d="M3 22 L14 11 L25 22 Z" fill="#9b4a35"/><path d="M7.5 20.5 L14 14 L18 18 L11.5 24.5 Z" fill="#1a345c"/><rect x="5" y="22" width="18" height="7" fill="#17222b"/></svg>`;
}
function crumbs(items) {
  return {
    html: `<nav class="crumbs wrap" aria-label="Migas de pan"><ol>${items.map(([p, t], i) => i === items.length - 1 ? `<li aria-current="page">${esc(t)}</li>` : `<li><a href="${L(p)}">${esc(t)}</a></li>`).join('')}</ol></nav>`,
    ld: { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([p, t], i) => ({ '@type': 'ListItem', position: i + 1, name: t, item: abs(p) })) },
  };
}
function faq(list) {
  return {
    html: `<section class="card faq"><h2>Preguntas frecuentes</h2>${list.map(f => `<details><summary>${esc(f.q)}</summary><p>${f.a}</p></details>`).join('')}</section>`,
    ld: { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: list.map(f => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a.replace(/<[^>]+>/g, '') } })) },
  };
}
function adSlot() {
  if (!cfg.adsenseClient) return '';
  return `<div class="ad"><ins class="adsbygoogle" style="display:block" data-ad-client="${esc(cfg.adsenseClient)}" data-ad-format="auto" data-full-width-responsive="true"></ins><script>(adsbygoogle=window.adsbygoogle||[]).push({});</script></div>`;
}
const searchBox = (ph = 'Busca tu municipio…') => `<form class="finder" role="search" onsubmit="return false"><label class="sr" for="find">Busca tu municipio</label><input id="find" type="search" placeholder="${ph}" autocomplete="off"><ul id="find-results" class="results" hidden></ul></form>`;
const siteScript = `<script src="${L('assets/site.js')}?v=${VER}" defer></script>`;

function monthlyChart(monthly, label) {
  const W = 640, H = 200, pad = 30, bw = (W - pad) / 12, max = Math.max(...monthly) * 1.12;
  const y = v => H - 22 - v / max * (H - 34);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">`;
  for (let i = 0; i <= 3; i++) { const v = max / 3 * i; s += `<line x1="${pad}" x2="${W}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="grid"/><text x="${pad - 5}" y="${(y(v) + 4).toFixed(1)}" class="ax" text-anchor="end">${fmt(v)}</text>`; }
  monthly.forEach((v, i) => {
    const x = pad + i * bw + bw * 0.2, w = bw * 0.6;
    s += `<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="3" class="bar"><title>${MONTHS[i]}: ${fmt(v)} kWh</title></rect><text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" class="ax" text-anchor="middle">${MONTHS[i]}</text>`;
  });
  return s + '</svg>';
}

// ---------- Página de municipio ----------
function municipioPage(m) {
  const st = stats.get(m.id);
  const [yS, ySE, yE, yFlat, yN] = st.yields;
  const ex = st.examples[1];
  const panelKwh = yS * PANEL_W / 1000;
  const pct = percentile(yS);
  const provList = byProv[m.provCode];
  const provAvg = provList.reduce((a, x) => a + stats.get(x.id).yields[0], 0) / provList.length;
  const near = nearest(m, munis, 8);
  const winter = st.monthly[11], summer = st.monthly[6];
  const needPanels = Math.ceil(3500 / panelKwh);
  const rel = m.path;
  const title = `Placas solares en ${m.name}: cuánto producen y en cuánto se amortizan (${YEAR})`;
  const description = `En ${m.name} (${m.prov}) cada kWp orientado al sur produce unos ${fmt(yS)} kWh al año. Una instalación de ${ex.n} paneles se amortiza en unos ${ex.payback ? fmt(ex.payback, 0) : 'más de 25'} años. Simula tu tejado en 3D.`;
  const cr = crumbs([['', 'Inicio'], ['provincias/', 'Provincias'], [`${m.provSlug}/`, m.prov], [rel, m.name]]);
  const fq = faq([
    { q: `¿Cuánto produce una placa solar en ${m.name}?`, a: `Un panel de ${PANEL_W} W orientado al sur con 30° de inclinación produce en ${m.name} unos <strong>${fmt(panelKwh)} kWh al año</strong>: de unos ${fmt(st.monthly[11] * PANEL_W / 1000)} kWh en diciembre a unos ${fmt(st.monthly[6] * PANEL_W / 1000)} kWh en julio.` },
    { q: `¿Cuántas placas solares necesito en ${m.name}?`, a: `Para una vivienda que consume 3.500 kWh al año harían falta unos ${needPanels} paneles de ${PANEL_W} W para igualar el consumo anual. Pero lo que más rentabiliza es lo que consumes en el momento en que produces, por eso suele compensar una instalación algo más pequeña, de 6 a 8 paneles, salvo que tengas batería o consumas mucho de día.` },
    { q: `¿En cuánto tiempo se amortizan las placas en ${m.name}?`, a: `Con ${ex.n} paneles (${fmt(ex.kwp, 2)} kWp) al sur, una inversión de unos ${fmt(ex.net)} €, un precio de la luz de ${fmt(Solar.DEFAULT_ECON.price, 2)} €/kWh y compensación de excedentes a ${fmt(Solar.DEFAULT_ECON.comp, 2)} €/kWh, la instalación se amortiza en <strong>unos ${ex.payback ? fmt(ex.payback, 1) : 'más de 25'} años</strong>. Con tu factura real puede variar bastante: pruébalo en el simulador.` },
    { q: `¿Merece la pena poner placas orientadas al este o al oeste en ${m.name}?`, a: `Sí, aunque rinden menos: en ${m.name} un tejado este u oeste a 30° produce un ${fmt(yE / yS * 100)} % de lo que produciría orientado al sur. Al norte, en cambio, la producción cae al ${fmt(yN / yS * 100)} % y normalmente no compensa.` },
    { q: `¿Cuánto producen las placas en invierno en ${m.name}?`, a: `En diciembre se produce aproximadamente un ${fmt(winter / summer * 100)} % de lo que se produce en julio. Por eso es normal tener excedentes en verano y comprar más energía a la red en invierno.` },
  ]);
  const body = `${cr.html}
<article class="wrap muni">
<header class="page-head">
<p class="kicker">${esc(m.prov)}</p>
<h1>Placas solares en ${esc(m.name)}</h1>
<p class="intro">Cuánta electricidad producirían unos paneles en tu tejado de ${esc(m.name)}, cuánto ahorrarías y en cuánto tiempo se pagan, calculado con la radiación solar real de este municipio.</p>
<a class="btn btn-primary" href="${L('simulador/')}?m=${m.id}">Simular mi tejado en 3D</a>
</header>
<section class="figures">
<div class="fig"><span class="k">Cada kWp al sur produce</span><span class="v">${fmt(yS)} <small>kWh/año</small></span></div>
<div class="fig"><span class="k">Un panel de ${PANEL_W} W</span><span class="v">${fmt(panelKwh)} <small>kWh/año</small></span></div>
<div class="fig"><span class="k">Radiación solar</span><span class="v">${fmt(st.G)} <small>kWh/m² al año</small></span></div>
<div class="fig"><span class="k">Más sol que el</span><span class="v">${pct} <small>% de los municipios</small></span></div>
</section>
<section class="card"><h2>Producción mes a mes en ${esc(m.name)}</h2>
<p class="muted">kWh que produce cada kWp instalado al sur con 30° de inclinación, ya descontadas las pérdidas del sistema.</p>
${monthlyChart(st.monthly.map(x => x), `Producción mensual por kWp en ${m.name}`)}</section>
${adSlot()}
<section class="card"><h2>Según la orientación de tu tejado</h2>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Orientación e inclinación</th><th>kWh por kWp al año</th><th>Respecto al sur</th></tr></thead><tbody>
${ORIENT.map(([n], i) => `<tr><td>${n}</td><td>${fmt(st.yields[i])}</td><td><div class="meter"><span style="width:${Math.min(100, st.yields[i] / yS * 100).toFixed(0)}%"></span></div>${fmt(st.yields[i] / yS * 100)} %</td></tr>`).join('')}
</tbody></table></div></section>
<section class="card"><h2>Tres instalaciones de ejemplo en ${esc(m.name)}</h2>
<p class="muted">Tejado al sur, vivienda que consume 3.500 kWh al año y no está en casa durante el día, sin batería. Precio de la luz ${fmt(Solar.DEFAULT_ECON.price, 2)} €/kWh, excedentes a ${fmt(Solar.DEFAULT_ECON.comp, 2)} €/kWh, instalación a ${fmt(Solar.DEFAULT_ECON.costKwp)} €/kWp.</p>
<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Paneles</th><th>Potencia</th><th>Producción</th><th>Autoconsumo</th><th>Ahorro año 1</th><th>Amortización</th><th>Beneficio a 25 años</th></tr></thead><tbody>
${st.examples.map(e => `<tr><td>${e.n}</td><td>${fmt(e.kwp, 2)} kWp</td><td>${fmt(e.prod)} kWh</td><td>${fmt(e.selfPct)} %</td><td>${fmt(e.year1)} €</td><td>${e.payback ? fmt(e.payback, 1) + ' años' : '+25 años'}</td><td>${fmt(e.total)} €</td></tr>`).join('')}
</tbody></table></div>
<p class="cta-line">¿Tu tejado no es así? <a href="${L('simulador/')}?m=${m.id}">Dibújalo en el simulador</a> con sus medidas, orientación, chimeneas y árboles cercanos.</p></section>
<section class="card"><h2>${esc(m.name)} frente a su entorno</h2>
<p>La media de la provincia de ${esc(m.prov)} es de ${fmt(provAvg)} kWh por kWp al año; ${esc(m.name)} está ${Math.abs(yS - provAvg) < 10 ? 'en la media' : yS > provAvg ? `un ${fmt((yS / provAvg - 1) * 100, 1)} % por encima` : `un ${fmt((1 - yS / provAvg) * 100, 1)} % por debajo`}.</p>
<ul class="links-grid">${near.map(({ x, km }) => `<li><a href="${L(x.path)}">${esc(x.name)}</a><span>${fmt(stats.get(x.id).yields[0])} kWh/kWp · ${fmt(km)} km</span></li>`).join('')}</ul></section>
${fq.html}
<p class="updated">Datos de radiación de PVGIS (Comisión Europea), media de muchos años, para las coordenadas del núcleo de ${esc(m.name)}. Estimación orientativa: el resultado real depende de tu tejado, del equipo y de la instalación.</p>
</article>`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebPage', name: title, description, url: abs(rel), inLanguage: 'es', about: { '@type': 'Place', name: m.name, geo: { '@type': 'GeoCoordinates', latitude: m.lat, longitude: m.lon } } }, cr.ld, fq.ld];
  return layout({ rel, title, description, body, jsonld: ld, scripts: siteScript });
}

// ---------- Simulador ----------
function simulatorPage() {
  const rel = 'simulador/';
  const title = 'Simulador de placas solares en 3D: dibuja tu tejado y calcula tu ahorro';
  const description = 'Simulador gratuito de placas solares: elige tu municipio, crea tu tejado en 3D con sus medidas y orientación, coloca los paneles, añade sombras y calcula producción, ahorro y amortización.';
  const n = (id, label, val, attrs = '', unit = '') => `<label class="field" for="${id}"><span>${label}</span><span class="in"><input id="${id}" type="number" value="${val}" ${attrs}>${unit ? `<i>${unit}</i>` : ''}</span></label>`;
  const body = `<div class="sim">
<section class="stage" aria-label="Tejado en 3D">
<div id="scene"></div>
<div class="stage-top"><span id="muni-name" class="where">Cargando…</span><a id="muni-link" class="mini" hidden>Datos del municipio</a><span id="panel-count" class="count"></span><button type="button" id="recenter" class="mini-btn" aria-label="Centrar la vista">Centrar</button><a href="#controles" class="mini-btn jump">Editar tejado ↓</a></div>
<div class="placing-banner">Toca el tejado donde está el elemento <button type="button" id="cancel-place">Cancelar</button></div>
<div class="stage-bar">
<label class="sr" for="view-month">Mes</label><select id="view-month"></select>
<label class="hour"><span class="sr">Hora</span><input id="view-hour" type="range" min="5" max="22" step="0.25" value="12"><output id="view-hour-label">12:00</output></label>
<button type="button" id="play" class="btn btn-small">Ver el día</button>
<label class="toggle"><input type="checkbox" id="heat" checked> Ver rendimiento</label>
<span id="sun-info" class="sun-info"></span>
</div>
<p class="hint">Arrastra para girar · Rueda o pellizco para acercar · Toca un hueco para poner o quitar un panel</p>
</section>

<aside class="controls" id="controles" aria-label="Datos de tu casa">
<details open><summary>1. Tu municipio</summary>
<div class="finder small"><label class="sr" for="muni-q">Municipio</label><input id="muni-q" type="search" placeholder="Escribe tu municipio…" autocomplete="off"><ul id="muni-results" class="results" hidden></ul></div>
</details>
<details open><summary>2. Tu tejado</summary>
<div id="roof-type" class="seg" role="group" aria-label="Tipo de tejado">
<button type="button" data-roof="gable"><svg viewBox="0 0 40 28"><path d="M4 16 L20 4 L36 16 V26 H4 Z"/></svg>Dos aguas</button>
<button type="button" data-roof="shed"><svg viewBox="0 0 40 28"><path d="M4 14 L36 4 V26 H4 Z"/></svg>Un agua</button>
<button type="button" data-roof="hip"><svg viewBox="0 0 40 28"><path d="M4 16 L13 6 H27 L36 16 V26 H4 Z"/></svg>Cuatro aguas</button>
<button type="button" data-roof="flat"><svg viewBox="0 0 40 28"><path d="M4 10 H36 V26 H4 Z"/></svg>Plana</button>
</div>
<div class="grid2">
${n('r-length', 'Largo', 10, 'min="4" max="40" step="0.5"', 'm')}
${n('r-width', 'Ancho', 8, 'min="4" max="30" step="0.5"', 'm')}
<div id="row-pitch">${n('r-pitch', 'Inclinación', 30, 'min="5" max="60" step="1"', '°')}</div>
<div id="row-flat-tilt" hidden>${n('flat-tilt', 'Inclinación de los paneles', 15, 'min="0" max="40" step="1"', '°')}</div>
${n('r-height', 'Altura del alero', 6, 'min="2.5" max="30" step="0.5"', 'm')}
</div>
<div class="az">
<svg viewBox="0 0 60 60" class="dial" aria-hidden="true"><circle cx="30" cy="30" r="27"/><text x="30" y="11">N</text><text x="51" y="34">E</text><text x="30" y="56">S</text><text x="9" y="34">O</text><g id="az-arrow"><path d="M30 30 L30 6" class="needle"/><circle cx="30" cy="30" r="3"/></g></svg>
<div><label for="r-az">Orientación: <b id="r-az-label">S</b></label>
<input id="r-az" type="range" min="0" max="359" step="1" value="180">
<div class="quick">${['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'].map((c, i) => `<button type="button" data-az="${i * 45}">${c}</button>`).join('')}</div>
<p id="az-help" class="help"></p></div>
</div>
</details>
<details open><summary>3. Paneles</summary>
<div class="grid2">
${n('p-wp', 'Potencia por panel', 440, 'min="250" max="700" step="5"', 'W')}
<label class="field" for="p-orient"><span>Colocación</span><select id="p-orient"><option value="portrait">Vertical</option><option value="landscape">Horizontal</option></select></label>
</div>
<div class="btns"><button type="button" id="optimize" class="btn btn-small btn-primary">Tamaño óptimo</button><button type="button" id="fill-best" class="btn btn-small">Mejores caras</button><button type="button" id="fill-all" class="btn btn-small">Llenar todo</button><button type="button" id="clear" class="btn btn-small">Vaciar</button></div>
<p id="opt-out" class="help">«Tamaño óptimo» elige cuántos paneles y en qué huecos dejan más beneficio con tu consumo y tus precios.</p>
</details>
<details open><summary>4. Sombras</summary>
<div class="btns"><button type="button" id="add-chimney" class="btn btn-small">+ Chimenea</button><button type="button" id="add-skylight" class="btn btn-small">+ Claraboya</button><button type="button" id="add-tree" class="btn btn-small">+ Árbol</button><button type="button" id="add-building" class="btn btn-small">+ Edificio</button></div>
<ul id="obst-list" class="obst"></ul>
</details>
<details><summary>5. Tu consumo y precios</summary>
<div class="grid2">
${n('c-annual', 'Consumo anual', 3500, 'min="500" max="30000" step="100"', 'kWh')}
<label class="field" for="c-profile"><span>Cuándo consumes</span><select id="c-profile"><option value="fuera">Fuera de casa de día</option><option value="casa">En casa de día / teletrabajo</option><option value="clima">Mucho aire acondicionado</option></select></label>
${n('e-price', 'Precio de la luz', 0.17, 'min="0.05" max="0.5" step="0.01"', '€/kWh')}
${n('e-comp', 'Pago por excedentes', 0.06, 'min="0" max="0.2" step="0.01"', '€/kWh')}
${n('e-cost', 'Coste instalación', 1250, 'min="500" max="3000" step="50"', '€/kWp')}
${n('e-growth', 'Subida anual de la luz', 2, 'min="-5" max="10" step="0.5"', '%')}
${n('e-batt', 'Batería', 0, 'min="0" max="30" step="0.5"', 'kWh')}
${n('e-battcost', 'Coste batería', 550, 'min="100" max="1500" step="10"', '€/kWh')}
${n('e-grants', 'Ayudas o deducciones', 0, 'min="0" step="100"', '€')}
${n('e-ibi', 'Bonificación IBI', 0, 'min="0" step="10"', '€/año')}
${n('e-ibiyears', 'Años de bonificación', 0, 'min="0" max="10" step="1"', 'años')}
</div>
<p class="help">Valores orientativos. Pon los de tu factura y tu presupuesto para afinar. El consumo anual sale en tu factura de la luz.</p>
</details>
</aside>

<section class="outputs" aria-label="Resultados">
<div id="kpis" class="kpis"></div>
<div class="card"><h2>Producción y consumo por mes</h2><div id="chart-monthly" class="chart"></div></div>
<div class="card"><h2>Por cara del tejado</h2><div id="faces-table" class="tbl-wrap"></div>
<p class="legend heat-legend"><span><i class="sw" style="background:#1a345c"></i>Rinde como un tejado ideal</span><span><i class="sw" style="background:#4678aa"></i>90 %</span><span><i class="sw" style="background:#e8aa28"></i>80 %</span><span><i class="sw" style="background:#be3c2d"></i>55 % o menos</span></p></div>
<div class="card"><h2>Ahorro acumulado</h2><div id="cash-chart" class="chart"></div><div id="econ-detail"></div></div>
<div class="share"><button type="button" id="share" class="btn btn-primary">Copiar enlace a mi simulación</button><span id="share-out"></span></div>
<p class="updated">Cálculo con la radiación media de PVGIS para tu municipio, sombras hora a hora sobre cada panel y tu perfil de consumo. Es una estimación orientativa: <a href="${L('como-calculamos/')}">así calculamos</a>.</p>
</section>
</div>`;
  const scripts = `<script type="importmap">{"imports":{"three":"${L('assets/three/three.module.js')}","three/addons/":"${L('assets/three/addons/')}"}}</script>
<script src="${L('assets/solar.js')}?v=${VER}"></script>
<script src="${L('assets/roof.js')}?v=${VER}"></script>
<script type="module" src="${L('assets/sim.js')}?v=${VER}"></script>`;
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Simulador de placas solares 3D', applicationCategory: 'UtilitiesApplication', operatingSystem: 'Web', offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' }, url: abs(rel), inLanguage: 'es' }];
  return layout({ rel, title, description, body, jsonld: ld, bodyClass: 'sim-page', scripts });
}

// ---------- Provincias, ranking, inicio ----------
function provincePage(code) {
  const list = byProv[code].slice().sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const prov = PROVINCES[code], slug = slugify(prov), rel = `${slug}/`;
  const ys = list.map(m => stats.get(m.id).yields[0]);
  const avg = ys.reduce((a, b) => a + b, 0) / ys.length;
  const best = list.slice().sort((a, b) => stats.get(b.id).yields[0] - stats.get(a.id).yields[0]);
  const cr = crumbs([['', 'Inicio'], ['provincias/', 'Provincias'], [rel, prov]]);
  const title = `Placas solares en la provincia de ${prov}: producción por municipio (${YEAR})`;
  const description = `Cuánto producen las placas solares en los ${list.length} municipios de ${prov}: de ${fmt(Math.min(...ys))} a ${fmt(Math.max(...ys))} kWh por kWp al año. Busca el tuyo y simula tu tejado.`;
  const body = `${cr.html}<article class="wrap">
<header class="page-head"><p class="kicker">Provincia</p><h1>Placas solares en ${esc(prov)}</h1>
<p class="intro">En ${esc(prov)} cada kWp orientado al sur produce de media ${fmt(avg)} kWh al año. Estos son los ${list.length} municipios que tenemos calculados.</p></header>
<section class="card"><h2>Los municipios con más sol de ${esc(prov)}</h2><ol class="rank">${best.slice(0, 10).map(m => `<li><a href="${L(m.path)}">${esc(m.name)}</a><span>${fmt(stats.get(m.id).yields[0])} kWh/kWp</span></li>`).join('')}</ol></section>
<section class="card"><h2>Todos los municipios</h2><ul class="chips">${list.map(m => `<li><a href="${L(m.path)}">${esc(m.name)}</a></li>`).join('')}</ul></section>
</article>`;
  return layout({ rel, title, description, body, jsonld: [cr.ld], scripts: siteScript });
}

function provincesIndex() {
  const rel = 'provincias/';
  const codes = Object.keys(byProv).sort((a, b) => PROVINCES[a].localeCompare(PROVINCES[b], 'es'));
  const body = `${crumbs([['', 'Inicio'], [rel, 'Provincias']]).html}<article class="wrap">
<header class="page-head"><h1>Placas solares por provincia</h1><p class="intro">Elige tu provincia o busca directamente tu municipio.</p>${searchBox()}</header>
<section class="card"><ul class="links-grid">${codes.map(c => { const ys = byProv[c].map(m => stats.get(m.id).yields[0]); return `<li><a href="${L(slugify(PROVINCES[c]) + '/')}">${esc(PROVINCES[c])}</a><span>${byProv[c].length} municipios · media ${fmt(ys.reduce((a, b) => a + b, 0) / ys.length)} kWh/kWp</span></li>`; }).join('')}</ul></section></article>`;
  return layout({ rel, title: 'Placas solares por provincia — Tejado al Sol', description: 'Producción de las placas solares en cada provincia y municipio de España, con la radiación solar real de PVGIS.', body, scripts: siteScript });
}

function rankingPage() {
  const rel = 'ranking/';
  const sorted = munis.slice().sort((a, b) => stats.get(b.id).yields[0] - stats.get(a.id).yields[0]);
  const big = sorted.filter(m => m.pop >= 50000);
  const row = (m, i) => `<tr><td>${i + 1}</td><td><a href="${L(m.path)}">${esc(m.name)}</a></td><td>${esc(m.prov)}</td><td>${fmt(stats.get(m.id).yields[0])}</td></tr>`;
  const body = `${crumbs([['', 'Inicio'], [rel, 'Ranking']]).html}<article class="wrap">
<header class="page-head"><h1>Los municipios de España con más sol para placas solares</h1><p class="intro">Ordenados por los kWh que produce cada kWp instalado al sur con 30° de inclinación.</p></header>
<section class="card"><h2>Ciudades de más de 50.000 habitantes</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Municipio</th><th>Provincia</th><th>kWh/kWp·año</th></tr></thead><tbody>${big.map(row).join('')}</tbody></table></div></section>
<section class="card"><h2>Los 50 municipios con más producción</h2><div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Municipio</th><th>Provincia</th><th>kWh/kWp·año</th></tr></thead><tbody>${sorted.slice(0, 50).map(row).join('')}</tbody></table></div></section>
</article>`;
  return layout({ rel, title: `Municipios con más sol de España para placas solares (${YEAR})`, description: 'Ranking de municipios y ciudades de España según la producción de las placas solares, calculado con datos de radiación de PVGIS.', body, scripts: siteScript });
}

function homePage() {
  const top = munis.slice().sort((a, b) => b.pop - a.pop).slice(0, 24);
  const body = `<section class="hero"><div class="wrap hero-grid">
<div><p class="kicker">Gratis · Sin registro · Con la radiación real de tu municipio</p>
<h1>Pon placas en tu tejado <em>antes</em> de ponerlas</h1>
<p class="intro">Dibuja tu tejado en 3D con sus medidas y su orientación, coloca los paneles donde quieras, añade la chimenea o el árbol del vecino y mira cuánto producirías, cuánto ahorrarías y cuándo lo recuperas.</p>
<div class="hero-ctas"><a class="btn btn-primary btn-big" href="${L('simulador/')}">Abrir el simulador 3D</a></div>
${searchBox('O busca tu municipio para ver sus datos…')}
</div>
<div class="hero-art" aria-hidden="true">${heroArt()}</div>
</div></section>
<div class="wrap">
<section class="steps">
<div><h3><span>1</span>Tu municipio</h3><p>Usamos la radiación solar media de muchos años en tus coordenadas, de PVGIS (Comisión Europea).</p></div>
<div><h3><span>2</span>Tu tejado</h3><p>Dos aguas, un agua, cuatro aguas o plano. Medidas, inclinación, orientación y obstáculos.</p></div>
<div><h3><span>3</span>Tus paneles</h3><p>Pones y quitas cada panel. El simulador calcula la sombra hora a hora sobre cada uno.</p></div>
<div><h3><span>4</span>Tu bolsillo</h3><p>Con tu consumo y tus precios: autoconsumo, excedentes, batería, ahorro y amortización a 25 años.</p></div>
</section>
${adSlot()}
<section class="card"><h2>Producción de las placas en tu ciudad</h2><ul class="chips">${top.map(m => `<li><a href="${L(m.path)}">${esc(m.name)}</a></li>`).join('')}<li><a class="more" href="${L('provincias/')}">Todos los municipios →</a></li></ul></section>
<section class="card"><h2>¿Dónde rinden más las placas solares?</h2><p>En España, cada kWp orientado al sur produce desde unos ${fmt(allYields[Math.floor(allYields.length * 0.02)])} kWh al año en las zonas más nubosas hasta más de ${fmt(allYields[Math.floor(allYields.length * 0.98)])} kWh en las más soleadas. <a href="${L('ranking/')}">Mira el ranking de municipios</a>.</p></section>
</div>`;
  return layout({ rel: '', title: 'Tejado al Sol — Simulador de placas solares en 3D para tu tejado', description: 'Simula placas solares sobre tu tejado en 3D: medidas, orientación, sombras, producción, ahorro y amortización con la radiación real de tu municipio. Gratis y sin registro.', body, bodyClass: 'home', scripts: siteScript, jsonld: [{ '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.siteName, url: abs(''), inLanguage: 'es' }] });
}
function heroArt() {
  // Ilustración: casa a dos aguas con paneles y trayectoria del Sol
  const panels = [];
  for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) panels.push(`<rect x="${168 + c * 44}" y="${170 - r * 40}" width="40" height="34" rx="2" class="pv"/>`);
  return `<svg viewBox="0 0 440 340"><path d="M40 120 Q220 -40 400 120" class="arc"/><circle cx="300" cy="62" r="20" class="sunc"/>
<path d="M90 300 V200 L180 120 L350 120 L390 200 V300 Z" class="wall"/><path d="M80 210 L180 112 L360 112 L400 210 Z" class="roofp"/>${panels.join('')}
<rect x="210" y="240" width="34" height="60" class="door"/><rect x="120" y="230" width="40" height="34" class="win"/><rect x="290" y="230" width="40" height="34" class="win"/><line x1="20" y1="300" x2="420" y2="300" class="groundl"/></svg>`;
}

function textPage(rel, title, description, inner) {
  return layout({ rel, title, description, body: `${crumbs([['', 'Inicio'], [rel, title.split(' —')[0]]]).html}<article class="wrap prose">${inner}</article>` });
}

// ---------- Build ----------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
write('', homePage());
write('simulador/', simulatorPage());
write('provincias/', provincesIndex());
write('ranking/', rankingPage());
for (const code of Object.keys(byProv)) write(`${slugify(PROVINCES[code])}/`, provincePage(code));
for (const m of munis) write(m.path, municipioPage(m));
write('como-calculamos/', textPage('como-calculamos/', 'Cómo calculamos — Tejado al Sol', 'Metodología del simulador: datos de PVGIS, posición del Sol, sombras, temperatura, pérdidas, autoconsumo y economía.', `
<h1>Cómo calculamos</h1>
<p class="intro">Queremos que entiendas de dónde sale cada número. Este es el método, paso a paso.</p>
<section class="card"><h2>1. La radiación de tu municipio</h2><p>Partimos de la radiación global horizontal media de cada mes, la parte difusa y la temperatura media, de <a href="https://joint-research-centre.ec.europa.eu/photovoltaic-geographical-information-system-pvgis_en">PVGIS</a>, el sistema de la Comisión Europea basado en datos de satélite de muchos años. Usamos las coordenadas del núcleo de cada municipio.</p></section>
<section class="card"><h2>2. Del cielo a tu panel</h2><p>Para un día representativo de cada mes recorremos el día en pasos de 10 minutos con la posición exacta del Sol. Repartimos la radiación del mes a lo largo del día y la proyectamos sobre el plano de cada panel con el modelo de Hay y Davies, que tiene en cuenta el sol directo, el cielo difuso y el reflejo del suelo. El total de cada mes coincide con el de PVGIS.</p></section>
<section class="card"><h2>3. Sombras</h2><p>Para cada panel comprobamos en cada paso si el Sol queda tapado por chimeneas, claraboyas, árboles o edificios, en cinco puntos del panel. Así un panel medio sombreado produce menos que uno al sol. No modelamos el relieve lejano (montañas), que puede quitar algo de sol al amanecer o al anochecer en valles.</p></section>
<section class="card"><h2>4. Temperatura y pérdidas</h2><p>Los paneles rinden menos cuando se calientan: calculamos la temperatura de célula y descontamos un 0,35 % por cada grado por encima de 25 °C. Además restamos un 14 % de pérdidas del sistema (inversor, cableado, suciedad), el mismo valor que usa PVGIS por defecto.</p></section>
<section class="card"><h2>5. Autoconsumo, batería y excedentes</h2><p>Repartimos tu consumo anual por meses y por horas según el perfil que elijas. Comparamos producción y consumo cada 10 minutos: lo que coincide es autoconsumo, lo que sobra va a la batería (si tienes) o a la red. Aplicamos la compensación simplificada de excedentes: cada mes, lo que te pagan por excedentes no puede superar lo que pagas por la energía que compras.</p></section>
<section class="card"><h2>6. Economía a 25 años</h2><p>Ahorro = autoconsumo × precio de la luz + compensación. Cada año restamos un 0,5 % de degradación de los paneles y aplicamos la subida de la luz que indiques. Incluimos el cambio del inversor hacia el año 13. La amortización es el año en que el ahorro acumulado iguala la inversión. Los precios por defecto son orientativos; cámbialos por los de tu factura y tu presupuesto.</p></section>
<section class="card"><h2>Límites</h2><p>Es una estimación, no un estudio técnico. La producción de un año concreto puede variar un ±5–10 % respecto a la media. Antes de contratar, pide presupuesto y estudio a instaladores certificados.</p></section>`));
write('aviso-legal/', textPage('aviso-legal/', 'Aviso legal — Tejado al Sol', 'Aviso legal de Tejado al Sol.', `<h1>Aviso legal</h1><section class="card prose"><p>Tejado al Sol ofrece estimaciones orientativas de producción y ahorro de instalaciones fotovoltaicas con fines informativos. No constituye asesoramiento técnico ni financiero.</p><p>Titular: <em>[pendiente de completar]</em>.${cfg.contactEmail ? ` Contacto: <a href="mailto:${esc(cfg.contactEmail)}">${esc(cfg.contactEmail)}</a>.` : ''}</p><p>Datos de radiación: PVGIS © Unión Europea. Datos de municipios: GeoNames, CC BY 4.0.</p></section>`));
write('privacidad/', textPage('privacidad/', 'Privacidad — Tejado al Sol', 'Política de privacidad de Tejado al Sol.', `<h1>Privacidad</h1><section class="card prose"><p>No pedimos registro ni datos personales. Todo el cálculo del simulador se hace en tu navegador: los datos de tu tejado y tu consumo no se envían a ningún servidor. Si copias el enlace de tu simulación, esos datos van dentro del propio enlace.</p>${cfg.adsenseClient ? '<p>Mostramos anuncios de Google AdSense, que puede usar cookies para personalizarlos.</p>' : ''}</section>`));
write('404.html', layout({ rel: '404.html', title: 'Página no encontrada — Tejado al Sol', description: 'Página no encontrada', body: `<article class="wrap prose"><h1>Aquí no da el sol</h1><p class="intro">Esta página no existe. Vuelve al <a href="${L('')}">inicio</a> o abre el <a href="${L('simulador/')}">simulador</a>.</p></article>` }));

// Recursos
const A = path.join(OUT, 'assets');
fs.mkdirSync(path.join(A, 'three', 'addons', 'controls'), { recursive: true });
fs.mkdirSync(path.join(A, 'rad'), { recursive: true });
for (const f of ['style.css', 'sim.js', 'site.js', 'favicon.svg']) fs.copyFileSync(path.join(__dirname, 'public', f), path.join(A, f));
for (const f of ['solar.js', 'roof.js']) fs.copyFileSync(path.join(__dirname, 'src', f), path.join(A, f));
const T = path.join(__dirname, 'node_modules', 'three');
fs.copyFileSync(path.join(T, 'build', 'three.module.js'), path.join(A, 'three', 'three.module.js'));
fs.copyFileSync(path.join(T, 'build', 'three.core.js'), path.join(A, 'three', 'three.core.js'));
fs.copyFileSync(path.join(T, 'examples', 'jsm', 'controls', 'OrbitControls.js'), path.join(A, 'three', 'addons', 'controls', 'OrbitControls.js'));
const index = munis.slice().sort((a, b) => b.pop - a.pop).map(m => [m.id, m.name, m.prov, m.provCode, m.lat, m.lon, m.path]);
fs.writeFileSync(path.join(A, 'munis.json'), JSON.stringify(index));
for (const code of Object.keys(byProv)) fs.writeFileSync(path.join(A, 'rad', code + '.json'), JSON.stringify(Object.fromEntries(byProv[code].map(m => [m.id, RAD.munis[m.id]]))));

write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(p => `<url><loc>${abs(p)}</loc></url>`).join('\n')}\n</urlset>\n`);
write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${abs('sitemap.xml')}\n`);
if (cfg.adsenseClient) write('ads.txt', `google.com, ${cfg.adsenseClient.replace('ca-', '')}, DIRECT, f08c47fec0942fa0\n`);
console.log(`Listo: ${pages.length} páginas en ${path.relative(process.cwd(), OUT) || '.'}/`);
