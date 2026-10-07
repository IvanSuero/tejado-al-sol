// Buscador de municipios (inicio y páginas de contenido)
(function () {
  var q = document.getElementById('find'), res = document.getElementById('find-results');
  if (!q) return;
  var BASE = document.documentElement.dataset.base || '/', index = null, active = -1;
  function norm(s) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function load(cb) {
    if (index) return cb(index);
    fetch(BASE + 'assets/munis.json').then(function (r) { return r.json(); }).then(function (j) { index = j.map(function (r) { return { id: r[0], n: r[1], p: r[2], path: r[6], k: norm(r[1]) }; }); cb(index); });
  }
  q.addEventListener('focus', function () { load(function () {}); });
  q.addEventListener('input', function () {
    var v = norm(q.value.trim());
    if (v.length < 2) { res.hidden = true; return; }
    load(function (ix) {
      var pre = [], inc = [];
      for (var i = 0; i < ix.length && pre.length < 8; i++) { if (ix[i].k.indexOf(v) === 0) pre.push(ix[i]); else if (inc.length < 8 && ix[i].k.indexOf(v) > 0) inc.push(ix[i]); }
      var list = pre.concat(inc).slice(0, 8); active = -1;
      res.innerHTML = list.map(function (r) { return '<li><a href="' + BASE + r.path + '">' + esc(r.n) + ' <span>' + esc(r.p) + '</span></a></li>'; }).join('');
      res.hidden = !list.length;
    });
  });
  q.addEventListener('keydown', function (e) {
    var links = res.querySelectorAll('a');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!links.length) return;
      active = (active + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
      links.forEach(function (a, i) { a.classList.toggle('active', i === active); });
    } else if (e.key === 'Enter') { e.preventDefault(); var a = links[active >= 0 ? active : 0]; if (a) location.href = a.href; }
  });
  document.addEventListener('click', function (e) { if (e.target !== q && !res.contains(e.target)) res.hidden = true; });
})();
