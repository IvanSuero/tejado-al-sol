/*
 * Tejado al Sol — geometría del tejado, huecos para paneles y sombras.
 * Sistema local de la casa: x a lo largo del largo, z hacia la fachada principal (+z), y hacia arriba.
 * La fachada principal (+z) mira al azimut `azimuth` (0 = norte, 90 = este, 180 = sur).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Roof = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const R = Math.PI / 180;
  const v = (x, y, z) => [x, y, z];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };

  const PANEL = { w: 1.134, h: 1.722, gap: 0.02, standoff: 0.12, margin: 0.3 };

  /**
   * Caras del tejado. Cada cara: { id, name, O, U, V, N, poly:[[u,v]...], tiltDeg, localAz }
   * roof: { type: 'gable'|'shed'|'hip'|'flat', length, width, pitch, height }
   */
  function faces(roof) {
    const L = roof.length, W = roof.width, H = roof.height, p = roof.pitch * R;
    const s = Math.sin(p), c = Math.cos(p);
    const out = [];
    const face = (id, name, O, U, V, poly) => out.push({ id, name, O, U, V, N: norm(cross(U, V)), poly });
    if (roof.type === 'flat') {
      face('f', 'Cubierta plana', v(-L / 2, H + 0.36, W / 2), v(1, 0, 0), v(0, 0, -1), [[0, 0], [L, 0], [L, W], [0, W]]);
    } else if (roof.type === 'shed') {
      const run = W / c;
      face('f', 'Faldón', v(-L / 2, H, W / 2), v(1, 0, 0), v(0, s, -c), [[0, 0], [L, 0], [L, run], [0, run]]);
    } else if (roof.type === 'gable') {
      const run = (W / 2) / c;
      face('f', 'Faldón delantero', v(-L / 2, H, W / 2), v(1, 0, 0), v(0, s, -c), [[0, 0], [L, 0], [L, run], [0, run]]);
      face('b', 'Faldón trasero', v(L / 2, H, -W / 2), v(-1, 0, 0), v(0, s, c), [[0, 0], [L, 0], [L, run], [0, run]]);
    } else { // hip: cuatro aguas con la misma pendiente
      const r = Math.min(L, W) / 2, run = r / c;
      face('f', 'Faldón delantero', v(-L / 2, H, W / 2), v(1, 0, 0), v(0, s, -c), trap(L, r, run));
      face('b', 'Faldón trasero', v(L / 2, H, -W / 2), v(-1, 0, 0), v(0, s, c), trap(L, r, run));
      face('r', 'Faldón derecho', v(L / 2, H, W / 2), v(0, 0, -1), v(-c, s, 0), trap(W, r, run));
      face('l', 'Faldón izquierdo', v(-L / 2, H, -W / 2), v(0, 0, 1), v(c, s, 0), trap(W, r, run));
    }
    return out;
  }
  function trap(base, r, run) {
    const a = Math.min(r, base / 2), b = Math.max(base - r, base / 2);
    return a >= b - 1e-6 ? [[0, 0], [base, 0], [base / 2, run]] : [[0, 0], [base, 0], [b, run], [a, run]];
  }

  function pointOnFace(f, u, w) { return add(add(f.O, mul(f.U, u)), mul(f.V, w)); }

  function inPoly(pt, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Altura (y local) de la cubierta en un punto (x, z) de la planta
  function roofHeightAt(roof, x, z) {
    const L = roof.length, W = roof.width, H = roof.height, t = Math.tan(roof.pitch * R);
    if (roof.type === 'flat') return H + 0.36;
    if (roof.type === 'shed') return H + (W / 2 - z) * t;
    if (roof.type === 'gable') return H + (W / 2 - Math.abs(z)) * t;
    const dx = L / 2 - Math.abs(x), dz = W / 2 - Math.abs(z);
    return H + Math.max(0, Math.min(dx, dz)) * t;
  }

  /** Cajas (AABB en coordenadas locales) de chimeneas y elementos del entorno. */
  function obstacleBoxes(roof, obstacles, azimuth) {
    const boxes = [];
    const th = Math.PI - azimuth * R;
    for (const o of obstacles || []) {
      if (o.kind === 'chimney' || o.kind === 'skylight') {
        const y0 = roofHeightAt(roof, o.x, o.z);
        const half = o.size / 2;
        const ylo = Math.min(roofHeightAt(roof, o.x - half, o.z - half), roofHeightAt(roof, o.x + half, o.z + half), y0) - 0.05;
        boxes.push({ o, min: [o.x - half, ylo, o.z - half], max: [o.x + half, y0 + (o.kind === 'skylight' ? 0.15 : o.height), o.z + half] });
      } else {
        // Árbol o edificio en el entorno: dirección absoluta (azimut) y distancia desde el centro de la casa
        const a = o.az * R;
        const world = [Math.sin(a) * o.dist, 0, -Math.cos(a) * o.dist]; // x = este, z = sur
        const lx = world[0] * Math.cos(th) - world[2] * Math.sin(th);
        const lz = world[0] * Math.sin(th) + world[2] * Math.cos(th);
        const half = o.size / 2;
        const ylo = o.kind === 'tree' ? o.height * 0.3 : 0;
        boxes.push({ o, min: [lx - half, ylo, lz - half], max: [lx + half, o.height, lz + half], center: [lx, lz] });
      }
    }
    return boxes;
  }

  function rayHitsBox(p, d, b) {
    let t0 = 1e-4, t1 = 1e9;
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (p[i] < b.min[i] || p[i] > b.max[i]) return false; continue; }
      let ta = (b.min[i] - p[i]) / d[i], tb = (b.max[i] - p[i]) / d[i];
      if (ta > tb) { const x = ta; ta = tb; tb = x; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) return false;
    }
    return true;
  }

  /**
   * Huecos posibles para paneles en una cara.
   * Devuelve [{ key, face, u, w, center, U, V, N, pw, ph }] (en coordenadas locales)
   */
  function slots(roof, f, panelOpts, boxes) {
    const portrait = panelOpts.orient !== 'landscape';
    const pw = portrait ? PANEL.w : PANEL.h, ph = portrait ? PANEL.h : PANEL.w;
    const m = PANEL.margin, gap = PANEL.gap;
    const out = [];
    const maxU = Math.max(...f.poly.map(q => q[0])), maxV = Math.max(...f.poly.map(q => q[1]));
    let U = f.U, V = f.V, N = f.N, rowPitch = ph + gap, tiltOff = 0;
    if (roof.type === 'flat') {
      // Paneles inclinados sobre soportes mirando a la fachada principal, filas separadas para no darse sombra
      const t = (panelOpts.flatTilt ?? 15) * R;
      V = [0, Math.sin(t), -Math.cos(t)];
      N = norm(cross(U, V));
      rowPitch = ph * Math.cos(t) + ph * Math.sin(t) / Math.tan(22 * R) + gap;
      tiltOff = ph * Math.cos(t);
    }
    const nu = Math.floor((maxU - 2 * m + gap) / (pw + gap));
    const used = nu * (pw + gap) - gap;
    const u0 = (maxU - used) / 2;
    const depth = roof.type === 'flat' ? tiltOff : ph;
    const nv = Math.floor((maxV - 2 * m - depth) / rowPitch) + 1;
    for (let j = 0; j < Math.max(0, nv); j++) {
      for (let i = 0; i < nu; i++) {
        const u = u0 + i * (pw + gap), w = m + j * rowPitch;
        const ok = [[u, w], [u + pw, w], [u + pw, w + depth], [u, w + depth]]
          .every(([a, b]) => inPoly([a, b], f.poly) && inPolyMargin([a, b], f.poly, m));
        if (!ok) continue;
        let center;
        if (roof.type === 'flat') {
          const base = pointOnFace(f, u + pw / 2, w);
          center = add(add(base, mul(V, ph / 2)), [0, 0.15, 0]);
        } else {
          center = add(pointOnFace(f, u + pw / 2, w + ph / 2), mul(f.N, PANEL.standoff));
        }
        // Huecos que chocan con chimeneas/claraboyas (con 30 cm de holgura) no se ofrecen
        const ex = pw / 2 * Math.abs(U[0]) + ph / 2 * Math.abs(V[0]), ez = pw / 2 * Math.abs(U[2]) + ph / 2 * Math.abs(V[2]);
        const blocked = (boxes || []).some(b => (b.o.kind === 'chimney' || b.o.kind === 'skylight') &&
          center[0] + ex > b.min[0] - 0.3 && center[0] - ex < b.max[0] + 0.3 &&
          center[2] + ez > b.min[2] - 0.3 && center[2] - ez < b.max[2] + 0.3);
        if (blocked) continue;
        out.push({ key: `${f.id}:${i}:${j}`, face: f.id, i, j, u, w, center, U, V, N, pw, ph });
      }
    }
    return out;
  }

  // Distancia mínima a los lados del polígono ≥ margen
  function inPolyMargin(pt, poly, m) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[j], [x2, y2] = poly[i];
      const dx = x2 - x1, dy = y2 - y1, len2 = dx * dx + dy * dy;
      let t = ((pt[0] - x1) * dx + (pt[1] - y1) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(pt[0] - (x1 + t * dx), pt[1] - (y1 + t * dy)) < m - 1e-6) return false;
    }
    return true;
  }

  // En qué cara cae un punto de la planta
  function faceOfPoint(roof, x, z) {
    if (roof.type === 'flat' || roof.type === 'shed') return 'f';
    if (roof.type === 'gable') return z >= 0 ? 'f' : 'b';
    const dx = roof.length / 2 - Math.abs(x), dz = roof.width / 2 - Math.abs(z);
    if (dz <= dx) return z >= 0 ? 'f' : 'b';
    return x >= 0 ? 'r' : 'l';
  }

  /** Normal local → (E, N, U) según la orientación de la casa. */
  function toENU(n, azimuth) {
    const th = Math.PI - azimuth * R;
    const wx = n[0] * Math.cos(th) + n[2] * Math.sin(th), wz = -n[0] * Math.sin(th) + n[2] * Math.cos(th);
    return [wx, -wz, n[1]];
  }
  /** Vector del Sol (E, N, U) → coordenadas locales de la casa. */
  function sunToLocal(s, azimuth) {
    const th = Math.PI - azimuth * R;
    const wx = s[0], wz = -s[1];
    return [wx * Math.cos(th) - wz * Math.sin(th), s[2], wx * Math.sin(th) + wz * Math.cos(th)];
  }

  /** Función de sombra de un panel: fracción soleada (0..1) con 5 puntos de muestra. */
  function shadeFn(slot, boxes, azimuth) {
    if (!boxes.length) return null;
    const pts = [[0, 0], [-0.35, -0.35], [0.35, -0.35], [0.35, 0.35], [-0.35, 0.35]]
      .map(([a, b]) => add(add(slot.center, mul(slot.U, a * slot.pw)), mul(slot.V, b * slot.ph)));
    const cache = new Map();
    return s => {
      const k = s[0].toFixed(3) + s[1].toFixed(3) + s[2].toFixed(3);
      if (cache.has(k)) return cache.get(k);
      const d = sunToLocal(s, azimuth);
      let lit = 0;
      for (const p of pts) if (!boxes.some(b => rayHitsBox(p, d, b))) lit++;
      const f = lit / pts.length;
      cache.set(k, f);
      return f;
    };
  }

  return { PANEL, faces, slots, toENU, sunToLocal, obstacleBoxes, shadeFn, roofHeightAt, faceOfPoint, pointOnFace, inPoly };
});
