/*
 * Tejado al Sol — motor de cálculo fotovoltaico y económico.
 * Mismo código en Node (páginas por municipio) y en el navegador (simulador).
 *
 * Modelo:
 *  - Radiación global horizontal mensual, fracción difusa y temperatura de PVGIS (medias de muchos años).
 *  - Para cada mes, un día representativo recorrido en pasos de 10 min. El perfil horario se reparte con forma
 *    sin(altura)^1,15 y se escala para que el total del mes coincida exactamente con PVGIS.
 *  - Transposición al plano del panel con el modelo de Hay-Davies, albedo 0,2, pérdidas por ángulo de incidencia,
 *    temperatura de célula (NOCT 45 °C, −0,35 %/°C) y pérdidas del sistema (14 % por defecto, como PVGIS).
 *  - Sombras: función por panel que devuelve la fracción soleada para cada posición del Sol.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Solar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const R = Math.PI / 180;
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const REP_DAY = [17, 47, 75, 105, 135, 162, 198, 228, 258, 288, 318, 344]; // días medios de Klein
  const STEP_MIN = 10;
  const DT = STEP_MIN / 60;

  // ---------- Geometría solar ----------
  function declination(n) { const g = 2 * Math.PI * (n - 1) / 365; return 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g); }
  function eqTime(n) { const g = 2 * Math.PI * (n - 1) / 365; return 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g)); } // minutos
  // Vector del Sol (E, N, U) a partir de la hora solar (h)
  function sunVector(lat, n, solarHour) {
    const d = declination(n), w = (solarHour - 12) * 15 * R, p = lat * R;
    return [-Math.cos(d) * Math.sin(w), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.cos(w) * Math.sin(p), Math.sin(d) * Math.sin(p) + Math.cos(d) * Math.cos(w) * Math.cos(p)];
  }
  // Huso horario civil en España: Canarias UTC+0, resto UTC+1; horario de verano de abril a octubre (día 15)
  function utcOffset(lon, month) { const base = lon < -13 ? 0 : 1; return base + (month >= 4 && month <= 10 ? 1 : 0); }
  function solarToClock(solarHour, lon, month) { const n = REP_DAY[month - 1]; return solarHour - lon / 15 - eqTime(n) / 60 + utcOffset(lon, month); }
  function clockToSolar(clockHour, lon, month) { const n = REP_DAY[month - 1]; return clockHour + lon / 15 + eqTime(n) / 60 - utcOffset(lon, month); }

  // Normal (E, N, U) de un plano con inclinación tilt (°) mirando a azimut az (° desde el norte, sentido horario)
  function planeNormal(tilt, az) { const t = tilt * R, a = az * R; return [Math.sin(t) * Math.sin(a), Math.sin(t) * Math.cos(a), Math.cos(t)]; }

  // Pasos del día representativo de cada mes (precalculados por latitud)
  const stepCache = {};
  function daySteps(lat, m) {
    const k = lat.toFixed(2) + ':' + m;
    if (stepCache[k]) return stepCache[k];
    const n = REP_DAY[m];
    const I0 = 1.361 * (1 + 0.033 * Math.cos(2 * Math.PI * n / 365));
    const steps = [];
    let shapeSum = 0;
    for (let h = STEP_MIN / 120; h < 24; h += DT) {
      const s = sunVector(lat, n, h);
      if (s[2] <= 0.005) continue;
      const shape = Math.pow(s[2], 1.15);
      shapeSum += shape * DT;
      steps.push({ h, s, shape });
    }
    return (stepCache[k] = { steps, shapeSum, I0 });
  }

  // Irradiancias horizontales (kW/m²) en cada paso para un mes
  function monthIrradiance(lat, rad, m) {
    const { steps, shapeSum, I0 } = daySteps(lat, m);
    const Gd = rad.G[m] / DAYS[m]; // kWh/m²·día
    const kd = Math.min(0.95, Math.max(0.1, rad.Kd[m]));
    return steps.map(st => {
      const g = Gd * st.shape / shapeSum;
      const D = kd * g, Bh = g - D, dni = Bh / st.s[2];
      return { h: st.h, s: st.s, g, D, dni, Ai: Math.min(1, dni / I0) };
    });
  }

  const DEFAULT_PANEL = { gamma: -0.0035, noct: 45, albedo: 0.2 };

  // Potencia (kW por kWp) de un panel en un paso, dada la fracción soleada
  function stepPower(ir, normal, tilt, Ta, sunFrac, opt) {
    const cosT = normal[0] * ir.s[0] + normal[1] * ir.s[1] + normal[2] * ir.s[2];
    const cb = Math.cos(tilt * R);
    let beam = 0, circ = 0;
    if (cosT > 0) {
      const iam = Math.max(0, 1 - 0.05 * (1 / Math.max(cosT, 0.05) - 1));
      beam = ir.dni * cosT * iam * sunFrac;
      circ = ir.D * ir.Ai * Math.min(5, cosT / ir.s[2]) * sunFrac;
    }
    const iso = ir.D * (1 - ir.Ai) * (1 + cb) / 2;
    const grd = opt.albedo * ir.g * (1 - cb) / 2;
    const poa = beam + circ + iso + grd; // kW/m²
    const Tc = Ta + poa * 1000 * (opt.noct - 20) / 800;
    return poa * (1 + opt.gamma * (Tc - 25));
  }

  /**
   * Simula un conjunto de paneles.
   * arr: [{ normal:[E,N,U], tilt, kw, shade?: (sunENU) => fracción soleada 0..1 }]
   * Devuelve producción mensual, por panel y perfiles diarios (kW por paso) para el autoconsumo.
   */
  function simulate(lat, rad, arr, opts) {
    opts = Object.assign({ lossPct: 14 }, DEFAULT_PANEL, opts || {});
    const sys = 1 - opts.lossPct / 100;
    const monthly = new Array(12).fill(0);
    const perPanel = arr.map(() => 0);
    const profiles = [];
    for (let m = 0; m < 12; m++) {
      const irr = monthIrradiance(lat, rad, m);
      const Ta = rad.T[m] + 3; // las horas de sol son más cálidas que la media diaria
      const prof = new Array(irr.length).fill(0);
      for (let p = 0; p < arr.length; p++) {
        const pn = arr[p];
        let day = 0;
        for (let i = 0; i < irr.length; i++) {
          const frac = pn.shade ? pn.shade(irr[i].s) : 1;
          const kw = stepPower(irr[i], pn.normal, pn.tilt, Ta, frac, opts) * pn.kw * sys;
          prof[i] += kw;
          day += kw * DT;
        }
        perPanel[p] += day * DAYS[m];
        monthly[m] += day * DAYS[m];
      }
      profiles.push({ hours: irr.map(x => x.h), kw: prof });
    }
    return { monthly, annual: monthly.reduce((a, b) => a + b, 0), perPanel, profiles };
  }

  /** Producción específica (kWh/kWp·año) de un plano sin sombras. */
  function yieldPerKwp(lat, rad, tilt, az, opts) {
    return simulate(lat, rad, [{ normal: planeNormal(tilt, az), tilt, kw: 1 }], opts);
  }

  // ---------- Consumo ----------
  const HOURLY = {
    fuera: [0.6, 0.5, 0.45, 0.45, 0.45, 0.5, 0.7, 1.0, 1.1, 0.8, 0.7, 0.7, 0.8, 1.0, 1.1, 0.9, 0.8, 1.0, 1.3, 1.6, 1.8, 1.7, 1.4, 0.9],
    casa: [0.6, 0.5, 0.45, 0.45, 0.45, 0.5, 0.7, 1.0, 1.2, 1.2, 1.2, 1.3, 1.5, 1.5, 1.4, 1.2, 1.1, 1.1, 1.3, 1.5, 1.6, 1.5, 1.2, 0.8],
    clima: [0.6, 0.5, 0.45, 0.45, 0.45, 0.5, 0.7, 1.0, 1.1, 1.1, 1.2, 1.4, 1.7, 1.9, 1.9, 1.8, 1.6, 1.4, 1.4, 1.6, 1.7, 1.6, 1.2, 0.8],
  };
  const MONTHLY = {
    fuera: [1.15, 1.05, 1.0, 0.9, 0.85, 0.9, 1.0, 1.0, 0.9, 0.9, 1.05, 1.2],
    casa: [1.15, 1.05, 1.0, 0.9, 0.85, 0.9, 1.0, 1.0, 0.9, 0.9, 1.05, 1.2],
    clima: [1.2, 1.1, 0.95, 0.8, 0.8, 1.05, 1.35, 1.35, 1.0, 0.85, 1.0, 1.25],
  };
  function hourlyShare(profile) { const h = HOURLY[profile] || HOURLY.fuera, s = h.reduce((a, b) => a + b, 0); return h.map(x => x / s); }
  function monthlyKwh(annual, profile) { const f = MONTHLY[profile] || MONTHLY.fuera, s = f.reduce((a, b) => a + b, 0); return f.map(x => annual * x / s); }

  /**
   * Balance energético mes a mes: autoconsumo directo, batería, excedentes y compras a la red.
   * sim: resultado de simulate(); cons: { annual kWh, profile }; battery kWh útiles (0 = sin batería)
   */
  function energyBalance(sim, lon, cons, batteryKwh) {
    const share = hourlyShare(cons.profile);
    const monthCons = monthlyKwh(cons.annual, cons.profile);
    const months = [];
    for (let m = 0; m < 12; m++) {
      const pr = sim.profiles[m];
      const dayCons = monthCons[m] / DAYS[m];
      // Consumo por paso de 10 min del día (en hora civil)
      const steps = 24 * 60 / STEP_MIN;
      const consStep = new Array(steps).fill(0).map((_, i) => dayCons * share[Math.floor(i * STEP_MIN / 60)] / (60 / STEP_MIN));
      const prodStep = new Array(steps).fill(0);
      pr.hours.forEach((h, i) => {
        let clock = solarToClock(h, lon, m + 1);
        clock = ((clock % 24) + 24) % 24;
        prodStep[Math.min(steps - 1, Math.floor(clock * 60 / STEP_MIN))] += pr.kw[i] * DT;
      });
      let soc = 0, direct = 0, fromBatt = 0, surplus = 0, grid = 0;
      const cap = batteryKwh || 0, eff = 0.95;
      for (let pass = 0; pass < 2; pass++) { // dos pasadas: la segunda empieza con la carga que quedó de la noche
        direct = 0; fromBatt = 0; surplus = 0; grid = 0;
        for (let i = 0; i < steps; i++) {
          const p = prodStep[i], c = consStep[i];
          const d = Math.min(p, c);
          direct += d;
          let extra = p - d, need = c - d;
          if (cap && extra > 0) { const room = (cap - soc) / eff; const ch = Math.min(extra, room); soc += ch * eff; extra -= ch; }
          if (cap && need > 0 && soc > 0) { const dis = Math.min(need, soc * eff); soc -= dis / eff; need -= dis; fromBatt += dis; }
          surplus += extra; grid += need;
        }
      }
      const k = DAYS[m];
      months.push({
        prod: sim.monthly[m], cons: monthCons[m], direct: direct * k, battery: fromBatt * k,
        selfUse: (direct + fromBatt) * k, surplus: surplus * k, grid: grid * k,
      });
    }
    const sum = key => months.reduce((a, x) => a + x[key], 0);
    return { months, prod: sum('prod'), cons: sum('cons'), selfUse: sum('selfUse'), surplus: sum('surplus'), grid: sum('grid'), battery: sum('battery') };
  }

  /**
   * Economía a 25 años.
   * e: { price €/kWh, comp €/kWh, costKwp €, battCostKwh €, battKwh, kwp, grants €, ibiYear €, ibiYears,
   *      priceGrowth %, degradation %, inverterYear, inverterCostKwp €, years }
   */
  function economics(balance, e) {
    const years = e.years || 25;
    const capex = e.kwp * e.costKwp + (e.battKwh || 0) * (e.battCostKwh || 0);
    const net = capex - (e.grants || 0);
    // Año 1: ahorro = autoconsumo × precio + compensación (con el tope mensual de la compensación simplificada)
    let comp1 = 0, saveSelf1 = 0, uncompensated = 0;
    for (const m of balance.months) {
      const gridCost = m.grid * e.price;
      const c = Math.min(m.surplus * e.comp, gridCost);
      comp1 += c;
      if (m.surplus * e.comp > gridCost && e.comp > 0) uncompensated += (m.surplus * e.comp - gridCost) / e.comp;
      saveSelf1 += m.selfUse * e.price;
    }
    const year1 = saveSelf1 + comp1;
    const cash = [];
    let cum = -net, payback = null;
    for (let y = 1; y <= years; y++) {
      const deg = Math.pow(1 - (e.degradation ?? 0.5) / 100, y - 1);
      const pg = Math.pow(1 + (e.priceGrowth ?? 2) / 100, y - 1);
      let s = year1 * deg * pg;
      if (e.ibiYear && y <= (e.ibiYears || 0)) s += e.ibiYear;
      if (e.inverterYear && y === e.inverterYear) s -= e.kwp * (e.inverterCostKwp || 0);
      const prev = cum;
      cum += s;
      if (payback === null && cum >= 0) payback = y - 1 + (-prev) / (cum - prev);
      cash.push({ y, saving: s, cum });
    }
    return {
      capex, net, year1, selfSaving: saveSelf1, compensation: comp1, uncompensatedKwh: uncompensated,
      payback, total: cum, cash, billBefore: balance.cons * e.price,
    };
  }

  const DEFAULT_ECON = { price: 0.17, comp: 0.06, costKwp: 1250, battCostKwh: 550, priceGrowth: 2, degradation: 0.5, inverterYear: 13, inverterCostKwp: 150, years: 25 };

  return {
    DAYS, REP_DAY, STEP_MIN, planeNormal, sunVector, solarToClock, clockToSolar, utcOffset,
    simulate, yieldPerKwp, energyBalance, economics, monthlyKwh, hourlyShare, DEFAULT_ECON,
    unpack: arr => ({ G: arr.slice(0, 12), Kd: arr.slice(12, 24), T: arr.slice(24, 36) }),
  };
});
