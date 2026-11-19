/* Baron playtest page: draws the map and runs the engine for people and bots. */
(function () {
  'use strict';
  const M = window.BARON_MAPS.EU, B = Baron(M), P = B.P, NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#d7263d', '#1b6ec2', '#2e9e4f', '#e08e0b', '#7b3fb0', '#0f9aa6'];
  const SAVE = 'baron.eu.save.v1', PREF = 'baron.eu.prefs.v2';
  const $ = id => document.getElementById(id);
  const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const FACE = ['', '⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
  let g = null, prefs = { speed: 650, follow: false, manual: false, tags: true, homes: true, step: true }, botTimer = null, paused = false, routeMode = 'balanced', hi = null, flashId = -1, animHide = -1, anim = null, tip = null, lastKey = '', introUntil = 0;
  try { Object.assign(prefs, JSON.parse(localStorage.getItem(PREF) || '{}')); } catch (e) { /* no storage */ }
  const savePrefs = () => { try { localStorage.setItem(PREF, JSON.stringify(prefs)); } catch (e) { /* ignore */ } };

  /* ---------- map ---------- */
  const svg = $('map'), vbFull = { x: M.view[0], y: M.view[1], w: M.view[2], h: M.view[3] };
  let vb = Object.assign({}, vbFull);
  const layers = {};
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function smooth(pts) {
    if (pts.length < 2) return '';
    let d = 'M' + pts[0][0].toFixed(1) + ',' + pts[0][1].toFixed(1);
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i > 0 ? i - 1 : i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2 <= pts.length - 1 ? i + 2 : i + 1];
      d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ',' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ',' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    }
    return d;
  }
  function buildMap() {
    svg.innerHTML = '';
    ['land', 'names', 'halo', 'rails', 'route', 'dots', 'tags', 'hit', 'cities', 'steps', 'tokens', 'anim'].forEach(n => { layers[n] = el('g', { id: 'L-' + n }, svg); });
    const gray = el('g', { fill: '#ece6d6', stroke: '#b5ae9a', 'stroke-width': 0.6 }, layers.land);
    M.land.filter(l => l.r < 0).forEach(l => el('path', { d: l.d }, gray));
    M.regions.forEach((rg, i) => {
      const mine = M.land.filter(l => l.r === i);
      const o = el('g', { fill: 'none', stroke: rg.line, 'stroke-width': 7, 'stroke-linejoin': 'round', opacity: 0.85 }, layers.land);
      const f = el('g', { fill: rg.tint, stroke: rg.tint, 'stroke-width': 1 }, layers.land);
      mine.forEach(l => { el('path', { d: l.d }, o); el('path', { d: l.d }, f); });
      const cs = M.cities.filter(c => c.r === rg.name); let sx = 0, sy = 0; cs.forEach(c => { sx += c.x; sy += c.y; });
      const t = el('text', { x: sx / cs.length, y: sy / cs.length - 70, 'text-anchor': 'middle', 'font-size': 22, 'font-weight': 800, 'letter-spacing': 4, fill: rg.line, opacity: 0.5 }, layers.names); t.textContent = rg.name.toUpperCase();
    });
    M.hops.forEach(h => {
      const cnt = h.rails.length;
      h.rails.forEach((code, k) => {
        const r = P.rail[code], off = (k - (cnt - 1) / 2) * 7.5, pts = h.pts.map(p => [p[0] + h.nx * off, p[1] + h.ny * off]), d = smooth(pts);
        const halo = el('path', { d, fill: 'none', stroke: 'none', 'stroke-linecap': 'round', 'data-rail': code }, layers.halo); halo.classList.add('halo');
        const g1 = el('g', { 'data-rail': code }, layers.rails); g1.classList.add('railg');
        el('path', { d, fill: 'none', stroke: '#fff', 'stroke-width': r.w + 2.6, opacity: 0.8, 'stroke-linejoin': 'round' }, g1);
        const ln = el('path', { d, fill: 'none', stroke: r.color, 'stroke-width': r.w, 'stroke-linejoin': 'round' }, g1);
        if (r.dash) ln.setAttribute('stroke-dasharray', r.dash);
        el('title', {}, ln).textContent = code + ' - ' + r.name;
        el('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': 16, 'stroke-linecap': 'round', 'pointer-events': 'stroke', 'data-hit': code, style: 'cursor:pointer' }, layers.hit);
      });
      h.pts.forEach(p => { if (p[2]) { el('circle', { cx: p[0], cy: p[1], r: 3.8, fill: '#111', stroke: '#fff', 'stroke-width': 1.3 }, layers.dots); } });
    });
    (M.tags || []).forEach(t => {
      const r = P.rail[t.code], w = 10 + 8.4 * t.code.length, tg = el('g', { 'data-hit': t.code, style: 'cursor:pointer' }, layers.tags);
      el('rect', { x: t.x - w / 2, y: t.y - 9, width: w, height: 18, rx: 4, fill: '#fff', stroke: r.color, 'stroke-width': r.premium ? 2.6 : 1.8 }, tg);
      const tx = el('text', { x: t.x, y: t.y + 4.6, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: r.premium ? r.color : '#222', 'font-family': 'sans-serif' }, tg); tx.textContent = t.code;
    });
    layers.tags.style.display = prefs.tags === false ? 'none' : '';
    M.cities.forEach(c => {
      const one =(P.railsAt[c.n] || []).length === 1;
      const gg = el('g', { 'data-city': c.n }, layers.cities);
      el('rect', { x: c.x - c.s / 2, y: c.y - c.s / 2, width: c.s, height: c.s, fill: one ? '#d22' : '#111', stroke: '#fff', 'stroke-width': 1.4 }, gg);
      const t = el('text', { x: c.lx, y: c.ly, 'text-anchor': c.la, 'font-size': 15, 'font-weight': 700, fill: '#111', stroke: '#fff', 'stroke-width': 3.5, 'paint-order': 'stroke', 'font-family': 'sans-serif' }, gg); t.textContent = c.n;
      el('title', {}, gg).textContent = c.n + ' (' + c.r + ') - rails: ' + (P.railsAt[c.n] || []).join(', ');
    });
    applyView();
  }
  function applyView() { svg.setAttribute('viewBox', [vb.x, vb.y, vb.w, vb.h].join(' ')); }
  function zoomAt(f, cx, cy) {
    const nw = Math.min(vbFull.w * 1.1, Math.max(300, vb.w * f)), k = nw / vb.w, nh = vb.h * k;
    vb.x = cx - (cx - vb.x) * k; vb.y = cy - (cy - vb.y) * k; vb.w = nw; vb.h = nh; applyView();
  }
  function svgPoint(ev) { const r = svg.getBoundingClientRect(); return [vb.x + (ev.clientX - r.left) / r.width * vb.w, vb.y + (ev.clientY - r.top) / r.height * vb.h]; }
  function focus(pos, w) {
    const nw = w || vbFull.w * 0.5, nh = nw * vb.h / vb.w; vb.w = nw; vb.h = nh; vb.x = pos[0] - nw / 2; vb.y = pos[1] - nh / 2; applyView();
  }
  let animId = 0;
  function cancelView() { animId++; }
  function viewAround(pos, w) { const h = w * vbFull.h / vbFull.w; return { x: pos[0] - w / 2, y: pos[1] - h / 2, w, h }; }
  function animateView(to, ms, done) {
    const id = ++animId, from = Object.assign({}, vb), t0 = performance.now();
    (function step(now) {
      if (id !== animId) return;
      const t = Math.min(1, (now - t0) / ms), e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      ['x', 'y', 'w', 'h'].forEach(k => { vb[k] = from[k] + (to[k] - from[k]) * e; }); applyView();
      if (t < 1) requestAnimationFrame(step); else if (done) done();
    })(t0);
  }
  (function pan() {
    const ptrs = new Map(); let last = null, pd = 0, sx = null, moved = false, multi = false;
    svg.addEventListener('wheel', e => { e.preventDefault(); const p = svgPoint(e); zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p[0], p[1]); }, { passive: false });
    svg.addEventListener('pointerdown', e => { svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]); last = [e.clientX, e.clientY]; if (ptrs.size === 1) { sx = [e.clientX, e.clientY]; moved = false; multi = false; } else multi = true; cancelView(); if (ptrs.size === 2) { const a = [...ptrs.values()]; pd = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); } });
    svg.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (sx && Math.hypot(e.clientX - sx[0], e.clientY - sx[1]) > 5) moved = true;
      const r = svg.getBoundingClientRect();
      if (ptrs.size === 2) { const a = [...ptrs.values()], nd = Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]); if (pd) { const p = svgPoint({ clientX: (a[0][0] + a[1][0]) / 2, clientY: (a[0][1] + a[1][1]) / 2 }); zoomAt(pd / nd, p[0], p[1]); } pd = nd; return; }
      vb.x -= (e.clientX - last[0]) / r.width * vb.w; vb.y -= (e.clientY - last[1]) / r.height * vb.h; last = [e.clientX, e.clientY]; applyView();
    });
    const up = e => { if (e.type === 'pointerup' && !moved && !multi && ptrs.size === 1) handleMapClick(document.elementFromPoint(e.clientX, e.clientY)); ptrs.delete(e.pointerId); pd = 0; last = ptrs.size ? [...ptrs.values()][0] : null; };
    svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
  })();

  /* ---------- dynamic map layers ---------- */
  function updateMap() {
    document.querySelectorAll('#L-halo .halo').forEach(h => {
      const code = h.getAttribute('data-rail'), o = g ? g.owner[code] : undefined;
      if (o === undefined) { h.setAttribute('stroke', 'none'); } else { h.setAttribute('stroke', COLORS[o % COLORS.length]); h.setAttribute('stroke-width', P.rail[code].w + 9); h.setAttribute('opacity', 0.75); }
    });
    document.querySelectorAll('#L-rails .railg').forEach(x => x.classList.toggle('flash', x.getAttribute('data-rail') === hi));
    layers.route.innerHTML = ''; layers.tokens.innerHTML = ''; layers.steps.innerHTML = '';
    if (!g) return;
    const p = B.cur(g);
    if (p.dest && p.path.length && animHide < 0) {
      const segs = []; p.path.slice(p.h).forEach(st => { const h = M.hops[st.hop], pts = h.pts.map(q => [q[0], q[1]]); if (st.from !== h.a) pts.reverse(); segs.push(pts); });
      const d = segs.map(s => smooth(s)).join(' ');
      el('path', { d, fill: 'none', stroke: '#ffd400', 'stroke-width': 13, opacity: 0.55, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layers.route);
      (p.via || []).forEach(v => { const vc = P.city[v]; el('circle', { cx: vc.x, cy: vc.y, r: 15, fill: 'none', stroke: '#111', 'stroke-width': 4, 'stroke-dasharray': '5 3' }, layers.route); });
    }
    drawWalk();
    const seen = {};
    g.players.forEach(pl => {
      if (!pl.loc) return; // still rolling for a home city
      const col = COLORS[pl.id % COLORS.length];
      if (pl.id !== animHide) {
        const pos = B.tokenPos(g, pl), key = pos.join(','), n = seen[key] = (seen[key] || 0) + 1, dx = (n - 1) * 13 - 6;
        const tg = el('g', { transform: 'translate(' + (pos[0] + dx) + ',' + (pos[1] - 22) + ')' }, layers.tokens);
        if (flashId === pl.id) { const ring = el('circle', { r: 12, fill: 'none', stroke: col, 'stroke-width': 6 }, tg); ring.classList.add('ring'); }
        el('circle', { r: 12, fill: col, stroke: pl.id === g.turn ? '#000' : '#fff', 'stroke-width': pl.id === g.turn ? 3.5 : 2 }, tg);
        const t = el('text', { 'text-anchor': 'middle', y: 5, 'font-size': 14, 'font-weight': 800, fill: '#fff' }, tg); t.textContent = (pl.name[0] || '?').toUpperCase();
      }
      if (pl.dest) { // everyone's destination stays visible: a ring and the player's letter
        const dc = P.city[pl.dest], dn = (seen['d' + pl.dest] = (seen['d' + pl.dest] || 0) + 1);
        el('circle', { cx: dc.x, cy: dc.y, r: 16 + dn * 9, fill: 'none', stroke: '#fff', 'stroke-width': 11, opacity: 0.85 }, layers.route);
        el('circle', { cx: dc.x, cy: dc.y, r: 16 + dn * 9, fill: 'none', stroke: col, 'stroke-width': 7 }, layers.route);
        if (pl.origin && pl.origin !== pl.dest) { // where this trip started: a dashed thick ring
          const oc = P.city[pl.origin], on = (seen['o' + pl.origin] = (seen['o' + pl.origin] || 0) + 1);
          el('circle', { cx: oc.x, cy: oc.y, r: 14 + on * 8, fill: 'none', stroke: '#fff', 'stroke-width': 10, opacity: 0.8 }, layers.route);
          el('circle', { cx: oc.x, cy: oc.y, r: 14 + on * 8, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-dasharray': '9 5' }, layers.route);
        }
        const bg = el('g', { transform: 'translate(' + (dc.x + 24 + (dn - 1) * 16) + ',' + (dc.y + 28) + ')' }, layers.route);
        el('circle', { r: 8, fill: col, stroke: '#fff', 'stroke-width': 1.5 }, bg); const bt = el('text', { 'text-anchor': 'middle', y: 4, 'font-size': 11, 'font-weight': 800, fill: '#fff' }, bg); bt.textContent = (pl.name[0] || '?').toUpperCase();
      }
      if (prefs.homes !== false) { // home city: a triangle in the player's colour
        const hm = P.city[pl.home], hn = (seen['h' + pl.home] = (seen['h' + pl.home] || 0) + 1), ox = (hn - 1) * 19, top = hm.y + hm.s / 2 + 1;
        el('polygon', { points: [hm.x + ox, top, hm.x + ox - 9, top + 15, hm.x + ox + 9, top + 15].join(' '), fill: col, stroke: '#fff', 'stroke-width': 2 }, layers.route);
      }
    });
  }

  function posAt(seg, dd) {
    const hop = M.hops[seg.hop];
    if (dd <= 0) { const c = P.city[seg.from]; return [c.x, c.y]; }
    if (dd >= hop.nd) { const c = P.city[seg.to]; return [c.x, c.y]; }
    const pt = hop.dotpts[(seg.from === hop.a ? dd : hop.nd - dd) - 1]; return [pt[0], pt[1]];
  }
  function drawWalk() { // the pips walked so far (trail) and the pips you can click next
    if (!g || g.phase !== 'walk' || !g.walk) return;
    const p = B.cur(g), col = COLORS[p.id % COLORS.length], w = g.walk;
    w.segs.forEach(seg => { const pts = []; for (let d = seg.start; d <= seg.start + seg.take; d++) pts.push(posAt(seg, d).join(',')); el('polyline', { points: pts.join(' '), fill: 'none', stroke: col, 'stroke-width': 10, opacity: 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layers.steps); });
    const opts = B.stepOptions(g), sug = B.suggestedStep(g);
    const sugHop = sug >= 0 ? opts[sug].hop : -1, placed = opts.filter(q => q.choose).map((q, k) => { const pp = B.optPos(q); return [pp[0], pp[1], 24, opts.indexOf(q)]; }), cur0 = g.walk.at === 'hop' ? g.walk.hop : -1;
    opts.forEach((o, i) => { // every reachable pip is clickable; the furthest on each track pulses
      const pos = B.optPos(o), tcol = P.rail[M.hops[o.hop].rails[0]] ? P.rail[M.hops[o.hop].rails[0]].color : col;
      if (o.choose) { // overlapping tracks: a labelled button for each, fanned out around the city
        const cc = P.city[g.walk.city], base = Math.atan2(pos[1] - cc.y, pos[0] - cc.x), far2 = B.optPos(M.hops[o.hop].nd > 2 ? { hop: o.hop, from: o.from, to: o.to, dd: 3 } : o), ang0 = Math.atan2(far2[1] - cc.y, far2[0] - cc.x);
        const label = o.to, w = 12 + 7.6 * label.length;
        let ang = isNaN(ang0) ? base : ang0, tries = 0, ax, ay;
        const dist0 = Math.hypot(pos[0] - cc.x, pos[1] - cc.y);
        do { const rad = dist0 + 36 + Math.floor(tries / 8) * 26; ax = cc.x + Math.cos(ang) * rad; ay = cc.y + Math.sin(ang) * rad; ang += 0.45; tries++; } while (placed.some(q => q[3] !== i && Math.abs(q[0] - ax) < (q[2] + w) / 2 + 6 && Math.abs(q[1] - ay) < 32) && tries < 40);
        placed.push([ax, ay, w, -1]);
        const pc = el('circle', { cx: pos[0], cy: pos[1], r: 9, fill: o.hop === sugHop ? '#ffd400' : '#fff', stroke: tcol, 'stroke-width': 3.5, 'data-pip': i, style: 'cursor:pointer' }, layers.steps);
        const gg = el('g', { 'data-pip': i, style: 'cursor:pointer' }, layers.steps);
        el('line', { x1: cc.x, y1: cc.y, x2: ax, y2: ay, stroke: tcol, 'stroke-width': 3, 'stroke-dasharray': '4 3' }, gg);
        el('rect', { x: ax - w / 2, y: ay - 13, width: w, height: 26, rx: 7, fill: o.hop === sugHop ? '#ffd400' : '#fff', stroke: tcol, 'stroke-width': 4, 'data-pip': i }, gg);
        const tx = el('text', { x: ax, y: ay + 5, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: '#111', 'data-pip': i }, gg); tx.textContent = label; return;
      }
      const far = !opts.some(q => q.hop === o.hop && q.from === o.from && q.dd > o.dd), alt = o.jstart !== undefined || (g.walk.at === 'city' && opts.filter(q => q.dd === 1).length > 1);
      const c = el('circle', { cx: pos[0], cy: pos[1], r: far ? 13 : 9, fill: o.hop === sugHop && o.jstart === undefined ? '#ffd400' : '#fff', stroke: alt ? tcol : col, 'stroke-width': far ? 4 : 3, 'data-pip': i, style: 'cursor:pointer' }, layers.steps); if (far) c.classList.add('pip');
      if (o.jstart !== undefined) c.setAttribute('stroke-dasharray', '4 2');
    });
    if (cur0 >= 0) { // crossings you can change tracks at, marked on the track you are on
      const h = M.hops[cur0], abs = g.walk.from === h.a ? g.walk.dd : h.nd - g.walk.dd;
      if (((B.P.J[cur0] || {})[abs] || []).length) { const pos = B.tokenPos(g, p); el('circle', { cx: pos[0], cy: pos[1], r: 19, fill: 'none', stroke: '#111', 'stroke-width': 3, 'stroke-dasharray': '3 3' }, layers.steps); }
    }
  }
  /* ---------- side panels ---------- */
  const money = B.money;
  function dieHtml(v, red) { return '<span class="die' + (red ? ' red' : '') + '">' + FACE[v] + '</span>'; }
  function rollLine(d, label) {
    const dice = d.manual ? '' : dieHtml(d.col, true) + dieHtml(d.w1) + dieHtml(d.w2);
    return '<div>' + label + ' ' + dice + ' <span class="sum">' + d.parity + ' column, white ' + d.sum + ' &rarr; <b>' + esc(d.kind === 'city' ? d.city : d.region) + '</b></span></div>';
  }
  function setupHtml() {
    const s = g.setup; if (!s) return '';
    if (g.phase === 'order') return '<div><b>Turn order</b> <span class="muted">(highest roll goes first)</span></div>' + s.rolls.map((r, i) => r ? '<div>' + esc(g.players[i].name) + ' ' + dieHtml(r.a) + dieHtml(r.b) + ' = <b>' + r.sum + '</b></div>' : '').join('');
    const dr = g.destRolls;
    return '<div><b>Order of play:</b> ' + g.players.map((p, i) => (i + 1) + '. ' + esc(p.name) + (p.home ? ' (' + esc(p.home) + ')' : '')).join(' &middot; ') + '</div>' +
      (dr && s.last ? '<div style="margin-top:4px"><b>' + esc(s.last) + '</b> rolled a home city:</div>' + (dr.region ? rollLine(dr.region, '<b>1.</b> Region') : '') + (dr.city ? rollLine(dr.city, '<b>2.</b> City') : '') : '');
  }
  function diceHtml() {
    if (g && (g.phase === 'order' || g.phase === 'home')) return setupHtml();
    const d = g && g.dice, dr = g && g.destRolls;
    if (dr && (dr.region || dr.city) && (!d || d.kind !== 'move')) return (dr.region ? rollLine(dr.region, '<b>1.</b> Region') : '') + (dr.city ? rollLine(dr.city, '<b>2.</b> City') : '');
    if (!d) return '<div class="muted">Dice appear here.</div>';
    if (d.kind === 'move') return (d.manual ? '<b>' + d.sum + '</b>' : d.rolls.map(v => dieHtml(v)).join('')) + ' <span class="sum">= ' + d.sum + ' dots' + (g.dbl6 ? ' &mdash; <b>DOUBLE SIX!</b>' : '') + '</span>';
    const dice = d.manual ? '' : dieHtml(d.col, true) + dieHtml(d.w1) + dieHtml(d.w2);
    return dice + ' <span class="sum">' + d.parity + ' column, white ' + d.sum + ' &rarr; <b>' + esc(d.kind === 'city' ? d.city : d.region) + '</b></span>';
  }
  function playersHtml() {
    return g.players.map(p => {
      const rails = M.rails.filter(r => g.owner[r.code] === p.id);
      const left = p.dest ? p.path.slice(p.h).reduce((s, st) => s + st.dots, 0) - p.dd : 0;
      return '<div class="pl' + (p.id === g.turn && g.phase !== 'over' ? ' on' : '') + '" style="border-left-color:' + COLORS[p.id % COLORS.length] + '">' +
        '<div class="pl1"><b>' + esc(p.name) + '</b>' + (p.bot ? ' <span class="tag">bot</span>' : '') + (p.sc ? ' <span class="tag sc" title="Super Chief: after an arrival, a new destination and one extra die the same turn">SC</span>' : '') + (p.goingHome ? ' <span class="tag home">going home</span>' : '') +
        '<span class="cash' + (p.cash < 0 ? ' neg' : '') + '">' + money(p.cash) + '</span></div>' +
        '<div class="pl2">' + (p.home ? 'Home ' + esc(p.home) + ' &middot; at ' + esc(p.loc) : 'waiting for a home city') + (p.dest ? ' &rarr; <b>' + esc(p.dest) + '</b> (' + left + ' dots)' : '') + '</div>' +
        '<div class="pl3">' + (rails.length ? rails.map(r => '<span class="rc" style="border-color:' + r.color + '">' + r.code + '</span>').join('') : '<span class="muted">no rails</span>') + ' <span class="muted">trips ' + p.trips + '</span></div></div>';
    }).join('');
  }
  function routeBox(p) {
    const modes = [['fast', 'Fastest'], ['balanced', 'Balanced'], ['cheap', 'Fewest fees']];
    const infos = modes.map(m => ({ m, i: B.routeInfo(g, p.id, m[0]) }));
    const cur = B.routeInfo(g, p.id);
    return '<div class="routebox"><div class="muted"><b>Pick your path:</b> click cities on the map to steer the route through them (click again to remove).' + ((p.via || []).length ? '</div><div>' + p.via.map(c => '<span class="rc via" data-act="rmvia" data-c="' + esc(c) + '">via ' + esc(c) + ' &#10005;</span>').join(' ') + ' <button class="b" data-act="clearvia">Clear</button></div><div class="muted">' : '') + ' Route (yellow on the map). Fees are charged once a turn: ' + money(M.cfg.feePublic) + ' for public rails, ' + money(M.cfg.feePrivate) + ' per owner (' + money(M.cfg.feeAllSold) + ' once all rails are sold).</div>' +
      infos.map(x => '<label class="rm"><input type="radio" name="rm" value="' + x.m[0] + '"' + (x.m[0] === routeMode ? ' checked' : '') + '> ' + x.m[1] + ' <span class="muted">' + x.i.dots + ' dots, next turn fees about ' + money(x.i.nextTurnFees) + '</span></label>').join('') +
      '<div class="muted">Chosen route: ' + cur.dots + ' dots on ' + (cur.rails.length ? cur.rails.map(r => '<span class="rc" style="border-color:' + P.rail[r].color + '">' + r + (g.owner[r] === undefined ? '' : ' (' + esc(g.players[g.owner[r]].name) + ')') + '</span>').join(' ') : 'free track') + '</div></div>';
  }
  function manualForm(kind) {
    return '<div class="manual"><span class="muted">Dice by hand:</span> <select id="mpar"><option value="odd">odd</option><option value="even">even</option></select> colour die &middot; white sum <select id="msum">' +
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => '<option>' + n + '</option>').join('') + '</select> <button class="b" data-act="mdest" data-k="' + kind + '">Use</button></div>';
  }
  function trackLabel(o) { const h = M.hops[o.hop], rs = h.rails.map(r => r + (g.owner[r] === undefined ? '' : ' (' + g.players[g.owner[r]].name + ')')).join(' + ') || 'free track'; return esc(o.to) + ' &middot; ' + rs; }
  function chooseHtml() { // tracks leaving a city on top of each other: pick one here as well as on the map
    const opts = B.stepOptions(g); if (!opts.some(o => o.choose)) return '';
    return '<div class="muted"><b>Which track?</b></div><div class="chips">' + opts.map((o, i) => o.choose ? '<button class="b chip" style="border-color:' + P.rail[M.hops[o.hop].rails[0]].color + '" data-act="pipbtn" data-i="' + i + '">&rarr; ' + trackLabel(o) + '</button>' : '').join('') + '</div>';
  }
  function actionsHtml() {
    const p = B.cur(g); let h = '';
    if (g.phase === 'over') {
      const s = B.stats(g);
      return '<div class="win"><b>' + esc(g.players[g.winner].name) + ' wins</b> on round ' + g.round + '.</div><table class="st"><tr><th>Player</th><th>Cash</th><th>Trips</th><th>Avg trip</th><th>Fees paid</th><th>Fees got</th><th>Rails</th></tr>' +
        s.map(x => '<tr><td>' + esc(x.name) + '</td><td>' + money(x.cash) + '</td><td>' + x.trips + '</td><td>' + money(x.avg) + '</td><td>' + money(x.paid) + '</td><td>' + money(x.received) + '</td><td>' + x.rails.length + '</td></tr>').join('') +
        '</table><div class="row"><button class="b" data-act="export">Export game log (JSON)</button> <button class="b pri" data-act="new">New game</button></div>';
    }
    h += '<div class="who"><span class="dot" style="background:' + COLORS[p.id % COLORS.length] + '"></span><b>' + esc(p.name) + '</b>' + (p.bot ? ' (bot)' : '') + ' &mdash; round ' + g.round + '</div>';
    if (p.bot) return h + '<div class="muted">' + (paused ? 'Paused.' : 'Bot is playing&hellip;') + '</div><div class="row"><button class="b" data-act="pause">' + (paused ? 'Resume bots' : 'Pause bots') + '</button> <button class="b" data-act="skip">Skip to the next human</button></div>';
    if (g.phase === 'order') h += '<button class="b pri big" data-act="rollorder">&#127922; Roll for turn order (' + esc(p.name) + ')</button>';
    else if (g.phase === 'home') h += '<div>Roll for your home city (region, then city).</div><button class="b pri big" data-act="rollhome">&#127922; Roll for home city (' + esc(p.name) + ')</button>';
    else if (g.phase === 'dest') {
      if (g.stage === 'declare') h += '<div class="win">You have ' + money(p.cash) + '. You may <b>declare for home</b> (' + esc(p.home) + ') or keep rolling destinations if it looks risky. Anyone who ends a move in the same city as you catches you: you pay them ' + money(M.cfg.catchFee) + ' and must run a new destination.</div><button class="b pri big" data-act="declare">&#127968; Declare: head for ' + esc(p.home) + '</button><button class="b big" data-act="rolldest">&#127922; Not yet: roll a destination instead</button>';
      if (g.stage === 'region') h += '<button class="b pri big" data-act="rollregion">&#127922; Roll 1 of 2: destination region</button>' + (prefs.manual ? manualForm('region') : '');
      if (g.stage === 'pick') h += '<div>You rolled your own region. Choose any region:</div><div class="chips">' + M.regions.filter(r => r.name !== B.regionOf(p.loc)).map(r => '<button class="b chip" style="border-color:' + r.line + '" data-act="pick" data-r="' + esc(r.name) + '">' + esc(r.name) + '</button>').join('') + '</div>';
      if (g.stage === 'city') h += '<button class="b pri big" data-act="rollcity">&#127922; Roll 2 of 2: city in ' + esc(g.region) + (P.regionCities[g.region] && P.regionCities[g.region].length === 1 ? ' (only one city)' : '') + '</button>' + (prefs.manual ? manualForm('city') : '');
    } else if (g.phase === 'route') {
      const left = p.path.slice(p.h).reduce((s, st) => s + st.dots, 0) - p.dd;
      h += '<div>Destination <b>' + esc(p.dest) + '</b> &middot; ' + left + ' dots left &middot; pays ' + money(B.payoff(p.origin, p.dest)) + '</div>' + routeBox(p) +
        '<button class="b pri big" data-act="rollmove">&#127922; Roll to move (' + (g.bonus ? '1 die, Super Chief' : '2 dice') + ')</button>' + (prefs.manual ? '<div class="manual"><span class="muted">Dots by hand:</span> <input id="mdots" type="number" min="1" max="18" value="7"> <button class="b" data-act="mmove">Use</button></div>' : '');
    } else if (g.phase === 'walk' && g.walk) {
      const w = g.walk, fe = B.walkFees(g);
      h += '<div class="walk"><span class="rem">' + w.rem + '</span> of ' + w.n + ' dots left. Tap any pip along a track to jump straight to it (the big pulsing one is the furthest you can go); yellow is your planned route.' + (w.arrived ? ' <b>You are in ' + esc(p.dest) + '!</b>' : '') + '</div>' +
        '<div class="muted">Fees so far: ' + (fe.notes.length ? esc(fe.notes.join(', ')) : 'none') + '</div>' + chooseHtml() +
        '<div class="row"><button class="b" data-act="undo"' + (w.segs.length ? '' : ' disabled') + '>Undo a pip</button> <button class="b" data-act="autowalk"' + (w.done ? ' disabled' : '') + '>Fill the rest along the route</button></div>' +
        '<button class="b pri big" data-act="finish"' + (w.done ? '' : ' disabled') + '>Finish move</button>';
    } else if (g.phase === 'buy') {
      h += '<div class="arr">' + esc(g.log[g.log.length - 1] ? '' : '') + 'Arrived. ' + (g.bought ? 'You have made your one purchase this turn.' : 'You may make one purchase this turn: a rail from the list below' + (g.cfg.superChief > 0 && !p.sc ? ' or the Super Chief' : '') + '.') + (p.scNew ? ' The Super Chief bonus starts next turn.' : '') + '</div>' +
        '<div class="row">' + (B.canBuyChief(g, p.id) ? '<button class="b" data-act="chief">Buy Super Chief ' + money(g.cfg.superChief) + '</button> ' : '') + (B.canBonus(g) ? '<button class="b pri big" data-act="bonus">&#127922; ' + (p.sc ? 'Super Chief' : 'Double six') + ': roll a new destination + one die</button>' : '') + '<button class="b' + (B.canBonus(g) ? '' : ' pri') + ' big" data-act="end">End turn</button></div>';
    }
    return h;
  }
  /* rails grouped like the printed map: the cross-region ones first, then the left side (British, France, Iberia, Italy), then the right (Scandinavia, Germanic, Alpine, Balkans) */
  const GROUP_ORDER = ['British Isles', 'France-Benelux', 'Iberia', 'Italy', 'Scandinavia-Baltic', 'Germanic Core', 'Alpine-Danube-Poland', 'Balkans & Anatolia'];
  const groupOf = r => (r.premium ? 'Cross-region' : r.home);
  function railsHtml() {
    const hide = prefs.hideSold && g, groups = ['Cross-region'].concat(GROUP_ORDER), shut = prefs.shut || {};
    return groups.map(name => {
      const all = M.rails.filter(r => groupOf(r) === name).sort((a, b) => b.price - a.price), rows = all.filter(r => !(hide && g.owner[r.code] !== undefined));
      const sold = g ? all.filter(r => g.owner[r.code] !== undefined).length : 0, rg = M.regions.find(x => x.name === name);
      if (!all.length || (hide && !rows.length)) return '';
      return '<details class="rgroup" data-grp="' + esc(name) + '"' + (shut[name] ? '' : ' open') + '><summary' + (rg ? ' style="border-left:6px solid ' + rg.line + '"' : ' style="border-left:6px solid #222"') + '>' + esc(name) + ' <span class="muted">' + (all.length - sold) + ' of ' + all.length + ' for sale</span></summary>' + railTable(rows) + '</details>';
    }).join('');
  }
  function railTable(rows) {
    const p = g ? B.cur(g) : null;
    return '<table class="rt"><tr><th></th><th>Rail</th><th>Price</th><th>Owner</th></tr>' + rows.map(r => {
      const o = g ? g.owner[r.code] : undefined, can = g && !p.bot && B.canBuy(g, p.id, r.code);
      const sw = '<svg width="38" height="10"><line x1="2" y1="5" x2="36" y2="5" stroke="' + r.color + '" stroke-width="' + Math.min(r.w, 5) + '"' + (r.dash ? ' stroke-dasharray="' + r.dash + '"' : '') + '/></svg>';
      return '<tr data-rail="' + r.code + '" class="' + (r.premium ? 'prem' : '') + '"><td>' + sw + '</td><td><b>' + r.code + '</b> <span class="muted">' + esc(r.name) + '</span></td><td>' + money(r.price * M.unit) + '</td><td>' +
        (o !== undefined ? '<span class="own" style="background:' + COLORS[o % COLORS.length] + '">' + esc(g.players[o].name) + '</span>' : (can ? '<button class="b buy" data-act="buy" data-r="' + r.code + '">Buy</button>' : '<span class="muted">public</span>')) + '</td></tr>';
    }).join('') + '</table>';
  }
  function logHtml() {
    return g.log.slice(-60).reverse().map(l => '<div class="lg"' + (l.p >= 0 ? ' style="border-left-color:' + COLORS[l.p % COLORS.length] + '"' : '') + '><span class="muted">R' + l.round + '</span> ' + esc(l.t) + '</div>').join('');
  }
  function showTip(t) { tip = t; renderTip(); updateMap(); }
  function closeTip() { tip = null; hi = null; renderTip(); updateMap(); }
  function selectRail(code) { hi = code; showTip({ type: 'rail', code }); }
  function ownerName(code) { const o = g.owner[code]; return o === undefined ? null : g.players[o]; }
  function feeText(code) { const o = ownerName(code); return o ? 'owned by <b style="color:' + COLORS[o.id % COLORS.length] + '">' + esc(o.name) + '</b> &middot; fee ' + money(B.allSold(g) ? M.cfg.feeAllSold : M.cfg.feePrivate) : '<b>public</b> &middot; fee ' + money(M.cfg.feePublic) + ' to the bank'; }
  function renderTip() {
    const box = $('tip'); if (!box) return; if (!tip || !g) { box.hidden = true; box.innerHTML = ''; return; }
    const p = B.cur(g); let h = '';
    if (tip.type === 'rail') {
      const r = P.rail[tip.code], can = !p.bot && B.canBuy(g, p.id, r.code);
      h = '<div class="tt"><span class="rc" style="border-color:' + r.color + '">' + r.code + '</span> <b>' + esc(r.name) + '</b><button class="x" data-act="closetip">&times;</button></div>' +
        '<div>Price ' + money(r.price * M.unit) + ' &middot; ' + feeText(r.code) + '</div><div class="muted">Serves ' + [...r.cities].map(esc).join(', ') + '</div>' +
        (can ? '<button class="b buy big2" data-act="buy" data-r="' + r.code + '">Buy ' + r.code + ' for ' + money(r.price * M.unit) + '</button>' : '');
    } else {
      const c = P.city[tip.name], rs = P.railsAt[tip.name] || [];
      h = '<div class="tt"><b>' + esc(c.n) + '</b> <span class="muted">' + esc(c.r) + '</span><button class="x" data-act="closetip">&times;</button></div><div>' + rs.map(code => '<span class="rc" style="border-color:' + P.rail[code].color + '" data-sel="' + code + '">' + code + (ownerName(code) ? ' (' + esc(ownerName(code).name) + ')' : '') + '</span>').join(' ') + '</div>';
    }
    box.innerHTML = h; box.hidden = false;
  }
  function handleMapClick(t) {
    if (!t || !g || !t.closest || anim) return;
    const pip = t.closest('[data-pip]');
    if (pip && g.phase === 'walk') { B.stepWalk(g, +pip.getAttribute('data-pip')); render(); return; }
    const h = t.closest('[data-hit]'); if (h) { selectRail(h.getAttribute('data-hit')); return; }
    const c = t.closest('[data-city]');
    if (c) {
      const name = c.getAttribute('data-city'), p = B.cur(g);
      if (g.phase === 'route' && !p.bot && p.dest && name !== p.dest && name !== p.loc) { B.toggleVia(g, name); closeTip(); render(); return; }
      showTip({ type: 'city', name }); return;
    }
    closeTip();
  }
  function render() {
    if (!g) return;
    const pb = $('pipbox'); if (g.phase === 'walk' && g.walk) { pb.hidden = false; pb.innerHTML = '<b>' + g.walk.rem + '</b><span>pip' + (g.walk.rem === 1 ? '' : 's') + ' left of ' + g.walk.n + (g.bonus ? ' (Super Chief die)' : '') + '</span>'; } else pb.hidden = true;
    $('round').textContent = 'Round ' + g.round;
    $('cash').innerHTML = g.players.map(p => '<div class="cc' + (p.id === g.turn && g.phase !== 'over' ? ' on' : '') + '" style="border-color:' + COLORS[p.id % COLORS.length] + '"><b>' + esc(p.name) + '</b><span class="' + (p.cash < 0 ? 'neg' : '') + '">' + money(p.cash) + '</span></div>').join('');
    $('players').innerHTML = playersHtml(); $('actions').innerHTML = actionsHtml(); $('dicebox').innerHTML = diceHtml(); $('rails').innerHTML = railsHtml(); $('log').innerHTML = logHtml(); renderTip();
    updateMap(); autosave();
  }
  function autosave() { try { if (g.phase === 'over') localStorage.removeItem(SAVE); else localStorage.setItem(SAVE, JSON.stringify(g)); } catch (e) { /* storage full or blocked */ } }

  /* ---------- turn flow ---------- */
  let flashTimer = 0;
  function afterAction() {
    render();
    if (g.phase !== 'over') { const key = g.round + ':' + g.turn; if (key !== lastKey) { lastKey = key; turnIntro(); } }
    scheduleBot();
  }
  /* start of a turn: show the whole map, flash the player's train, then glide in on it */
  function turnIntro() {
    const pl = B.cur(g), pos = B.tokenPos(g, pl), slow = prefs.speed > 300 || !pl.bot;
    flashId = pl.id; updateMap(); clearTimeout(flashTimer); flashTimer = setTimeout(() => { flashId = -1; updateMap(); }, 2800);
    if (!prefs.follow) return;
    if (!slow) { focus(pos, vbFull.w * 0.45); return; }
    introUntil = performance.now() + 1700;
    animateView(vbFull, 450, () => setTimeout(() => animateView(viewAround(pos, vbFull.w * 0.45), 650), 600));
  }
  function scheduleBot() {
    clearTimeout(botTimer); if (!g || g.phase === 'over' || paused) return;
    const p = B.cur(g); if (!p.bot) return;
    botTimer = setTimeout(() => { const q = B.cur(g); if (g.phase === 'route' && q.bot) botMoveAnim(q); else { B.botAct(g); afterAction(); } }, prefs.speed + Math.max(0, introUntil - performance.now()));
  }
  /* a bot's move: zoom to the whole map, ring where it starts, then walk it pip by pip while the roll counts down */
  function botMoveAnim(p) {
    const snap = { id: p.id, name: p.name, path: p.path.slice(), h: p.h, dd: p.dd, loc: p.loc, dest: p.dest }, col = COLORS[p.id % COLORS.length];
    B.botAct(g); const mv = g.lastMove, rolls = g.dice && g.dice.rolls ? g.dice.rolls : [];
    if (!mv || !mv.moved) { afterAction(); return; }
    const start = snap.dd > 0 ? posAt(snap.path[snap.h], snap.dd) : (c => [c.x, c.y])(P.city[snap.loc]), pts = [];
    let h = snap.h, dd = snap.dd, rem = mv.moved;
    if (mv.segs) { mv.segs.forEach(s => { for (let d = s.start + 1; d <= s.start + s.take; d++) pts.push(posAt(s, d)); }); rem = 0; }
    while (rem > 0 && h < snap.path.length) { const st = snap.path[h], take = Math.min(rem, st.dots - dd); for (let k = 1; k <= take; k++) pts.push(posAt(st, dd + k)); dd += take; rem -= take; if (dd >= st.dots) { h++; dd = 0; } }
    const dice = rolls.map(v => FACE[v]).join(' '), fast = prefs.speed <= 120, stepMs = fast ? 70 : prefs.speed >= 1300 ? 500 : 320, holdMs = fast ? 250 : 1200;
    anim = { id: p.id }; animHide = p.id; clearTimeout(flashTimer); flashId = -1; closeTip();
    const pb = $('pipbox'); pb.hidden = false; updateMap();
    const draw = (i) => {
      layers.anim.innerHTML = '';
      if (snap.dest && mv.arrived) { const dc = P.city[snap.dest]; el('circle', { cx: dc.x, cy: dc.y, r: 24, fill: 'none', stroke: '#fff', 'stroke-width': 11 }, layers.anim); el('circle', { cx: dc.x, cy: dc.y, r: 24, fill: 'none', stroke: col, 'stroke-width': 7 }, layers.anim); }
      const sr = el('circle', { cx: start[0], cy: start[1], r: 22, fill: 'none', stroke: col, 'stroke-width': 6, 'stroke-dasharray': '9 5' }, layers.anim); if (i === 0) sr.classList.add('ring');
      const trail = [start].concat(pts.slice(0, i)); if (trail.length > 1) el('polyline', { points: trail.map(q => q.join(',')).join(' '), fill: 'none', stroke: col, 'stroke-width': 10, opacity: 0.85, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, layers.anim);
      pts.slice(0, i).forEach(q => el('circle', { cx: q[0], cy: q[1], r: 4, fill: '#fff', stroke: col, 'stroke-width': 2 }, layers.anim));
      const pos = i ? pts[i - 1] : start, tg = el('g', { transform: 'translate(' + pos[0] + ',' + (pos[1] - 22) + ')' }, layers.anim);
      el('circle', { r: 14, fill: col, stroke: '#000', 'stroke-width': 3.5 }, tg); const tx = el('text', { 'text-anchor': 'middle', y: 5, 'font-size': 15, 'font-weight': 800, fill: '#fff' }, tg); tx.textContent = (snap.name[0] || '?').toUpperCase();
      const left = mv.rolled - i; pb.innerHTML = '<span>' + esc(snap.name) + ' rolled ' + dice + ' = ' + mv.rolled + (g.dbl6 && !g.bonus ? ' DOUBLE SIX' : '') + '</span><b>' + left + '</b><span>pip' + (left === 1 ? '' : 's') + ' left' + (i === pts.length && left > 0 ? ' (lost on arrival)' : '') + '</span>';
    };
    const finish = () => { anim = null; animHide = -1; layers.anim.innerHTML = ''; afterAction(); };
    draw(0);
    let i = 0; const tick = () => { if (i >= pts.length) { setTimeout(finish, fast ? 150 : 800); return; } i++; draw(i); setTimeout(tick, stepMs); };
    setTimeout(tick, holdMs);
  }
  function act(a, el) {
    if (!g || anim) return; const p = B.cur(g);
    if (a === 'rollorder') { B.rollOrder(g); }
    else if (a === 'rollhome') { B.rollHomeStep(g); }
    else if (a === 'rollregion') { B.rollRegion(g); }
    else if (a === 'pick') { B.pickRegion(g, el.dataset.r); }
    else if (a === 'rolldest') { B.skipDeclare(g); }
    else if (a === 'declare') { B.declareHome(g); routeMode = 'balanced'; }
    else if (a === 'bonus') { B.startBonus(g); }
    else if (a === 'pipbtn') { B.stepWalk(g, +el.dataset.i); }
    else if (a === 'rollcity') { B.rollCity(g); routeMode = 'balanced'; }
    else if (a === 'rollmove') { if (prefs.step) B.rollMoveStep(g); else B.rollMove(g); }
    else if (a === 'undo') { B.undoWalk(g); }
    else if (a === 'autowalk') { B.autoWalk(g); }
    else if (a === 'finish') { B.commitWalk(g); }
    else if (a === 'mdest') { const m = { parity: $('mpar').value, sum: +$('msum').value }; if (el.dataset.k === 'region') B.rollRegion(g, m); else { B.rollCity(g, m); routeMode = 'balanced'; } }
    else if (a === 'mmove') { const n = Math.max(1, Math.min(18, +$('mdots').value || 7)); if (prefs.step) B.rollMoveStep(g, n); else B.rollMove(g, n); }
    else if (a === 'buy') { B.buyRail(g, p.id, el.dataset.r); }
    else if (a === 'chief') { B.buyChief(g, p.id); }
    else if (a === 'end') { B.endTurn(g); }
    else if (a === 'closetip') { closeTip(); return; }
    else if (a === 'rmvia') { B.toggleVia(g, el.dataset.c); }
    else if (a === 'clearvia') { B.clearVia(g); }
    else if (a === 'pause') { paused = !paused; }
    else if (a === 'skip') { for (let i = 0; i < 400 && g.phase !== 'over' && B.cur(g).bot; i++) B.botAct(g); }
    else if (a === 'export') { download('baron-eurobaron-game.json', JSON.stringify(B.exportLog(g), null, 1)); return; }
    else if (a === 'new') { openSetup(); return; }
    afterAction(a === 'end' || a === 'skip');
  }
  function download(name, text) { const b = new Blob([text], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 1000); }

  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (b) { act(b.dataset.act, b); return; }
    const sel = e.target.closest('[data-sel]'); if (sel) { selectRail(sel.dataset.sel); return; }
    const row = e.target.closest('#rails tr[data-rail]'); if (row) { selectRail(row.dataset.rail); }
  });
  document.addEventListener('change', e => {
    if (e.target.name === 'rm' && g) { routeMode = e.target.value; g.routeMode = routeMode; B.setRoute(g, routeMode); render(); }
    if (e.target.id === 'hm') { prefs.homes = e.target.checked; savePrefs(); updateMap(); }
    if (e.target.id === 'stp') { prefs.step = e.target.checked; savePrefs(); }
    if (e.target.id === 'tg') { prefs.tags = e.target.checked; layers.tags.style.display = prefs.tags ? '' : 'none'; savePrefs(); }
    if (e.target.id === 'spd') { prefs.speed = +e.target.value; savePrefs(); }
    if (e.target.id === 'fol') { prefs.follow = e.target.checked; savePrefs(); }
    if (e.target.id === 'man') { prefs.manual = e.target.checked; savePrefs(); render(); }
  });
  $('zin').onclick = () => zoomAt(1 / 1.3, vb.x + vb.w / 2, vb.y + vb.h / 2);
  $('zout').onclick = () => zoomAt(1.3, vb.x + vb.w / 2, vb.y + vb.h / 2);
  $('zall').onclick = () => { vb = Object.assign({}, vbFull); applyView(); };
  $('znow').onclick = () => { if (g) focus(B.tokenPos(g, B.cur(g)), vbFull.w * 0.45); };

  /* ---------- setup, rules, save ---------- */
  const NAMES = ['Anna', 'Bo', 'Cy', 'Dee', 'Eli', 'Fay'];
  function openSetup() {
    const d = $('dlg'), saved = (() => { try { return localStorage.getItem(SAVE); } catch (e) { return null; } })();
    d.innerHTML = '<h2>New game</h2><div class="presets"><button class="b" data-pre="1">You vs 1 bot</button><button class="b" data-pre="2">You vs 2 bots</button><button class="b" data-pre="3">3 people, one device</button><button class="b" data-pre="4">Watch 3 bots</button></div>' +
      '<div id="prow"></div><div class="grid"><label>Players <select id="np">' + [2, 3, 4, 5, 6].map(n => '<option' + (n === 3 ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></label>' +
      '<label>Start cash ($K) <input id="cs" type="number" value="' + M.cfg.start / 1000 + '"></label><label>Win cash ($K) <input id="cw" type="number" value="' + M.cfg.win / 1000 + '"></label>' +
      '<label>Super Chief ($K, 0 = none) <input id="cc" type="number" value="' + M.cfg.superChief / 1000 + '"></label><label>Seed (blank = random) <input id="sd" type="text" placeholder="e.g. 42"></label></div>' +
      '<div class="row"><button class="b pri" id="go">Start</button> <button class="b" id="cancel">Cancel</button>' + (saved ? ' <button class="b" id="resume">Resume saved game</button>' : '') + ' <label class="ld">Load game file <input type="file" id="lf" accept=".json"></label></div>';
    const rows = () => { const n = +$('np').value, pr = $('prow'); const old = [...pr.querySelectorAll('.pr')].map(r => [r.querySelector('input').value, r.querySelector('select').value]); pr.innerHTML = ''; for (let i = 0; i < n; i++) { const o = old[i] || [NAMES[i], i === 0 ? 'human' : 'bot']; pr.insertAdjacentHTML('beforeend', '<div class="pr"><span class="dot" style="background:' + COLORS[i] + '"></span><input value="' + esc(o[0]) + '"> <select><option value="human"' + (o[1] === 'human' ? ' selected' : '') + '>person</option><option value="bot"' + (o[1] === 'bot' ? ' selected' : '') + '>bot</option></select></div>'); } };
    rows(); $('np').onchange = rows;
    d.querySelectorAll('[data-pre]').forEach(b => b.onclick = () => { const k = +b.dataset.pre; $('np').value = k === 1 ? 2 : (k === 2 ? 3 : 3); rows(); const sel = $('prow').querySelectorAll('select'); sel.forEach((s, i) => { s.value = k === 1 ? (i === 0 ? 'human' : 'bot') : k === 2 ? (i === 0 ? 'human' : 'bot') : k === 3 ? 'human' : 'bot'; }); });
    $('cancel').onclick = () => d.close();
    $('go').onclick = () => {
      const pl = [...$('prow').querySelectorAll('.pr')].map(r => ({ name: r.querySelector('input').value.trim() || 'Player', bot: r.querySelector('select').value === 'bot' }));
      const sd = $('sd').value.trim(), seed = sd ? (isNaN(+sd) ? [...sd].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) : +sd) : 0;
      g = B.newGame({ players: pl, start: +$('cs').value * 1000, win: +$('cw').value * 1000, superChief: +$('cc').value * 1000, seed }); paused = false; routeMode = 'balanced'; d.close(); afterAction();
    };
    if ($('resume')) $('resume').onclick = () => { try { g = JSON.parse(saved); d.close(); afterAction(); } catch (e) { alert('Could not read the saved game.'); } };
    $('lf').onchange = ev => { const f = ev.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { try { const o = JSON.parse(r.result); if (o.rng === undefined) throw 0; g = o; d.close(); afterAction(); } catch (e) { alert('That file is not a saved game.'); } }; r.readAsText(f); };
    d.showModal();
  }
  function openRules() {
    const c = M.cfg, d = $('dlg');
    d.innerHTML = '<h2>How this playtest works</h2><ul class="rules"><li><b>Goal:</b> collect ' + money(c.win) + ' (editable) at an arrival, then get back to your home city first.</li>' +
      '<li><b>Destination:</b> coloured die odd/even + two white dice pick a region, then a second roll picks the city. Roll your own region and you may choose any region.</li>' +
      '<li><b>Moving:</b> roll 2 dice of dots a turn. Dots left over at arrival are lost. Tap pips to pick your own path; where two tracks cross you may change tracks (you pay the fee of any track you ride).</li>' +
      '<li><b>Super Chief (' + money(c.superChief) + '):</b> after an arrival you collect, buy, roll a new destination and move one more die the same turn. Fees already paid that turn are not paid again.</li>' +
      '<li><b>Double six:</b> rolling two sixes on the movement dice gives you the Super Chief bonus for that turn (the bonus die cannot chain).</li>' +
      '<li><b>Start of a game:</b> everyone rolls for turn order, then in that order for a home city; then play begins with a destination roll in that order.</li>' +
      '<li><b>One purchase</b> per turn: a rail or the Super Chief. A Super Chief you buy starts working next turn.</li>' +
      '<li><b>Declare:</b> at ' + money(c.win) + ' you may declare for home instead of rolling a destination (or keep rolling if it looks risky). If another player who is not running home ends a move in the same city as you, you are caught: you pay them ' + money(c.catchFee) + ' and must run a new destination (paid from where you declared).</li>' +
      '<li><b>Payoff:</b> $1K per dot of the shortest track route from where your trip started.</li>' +
      '<li><b>Fees, once a turn:</b> ' + money(c.feePublic) + ' to the bank if you use any public rail; ' + money(c.feePrivate) + ' to each owner whose rails you use (' + money(c.feeAllSold) + ' once every rail is sold). Your own rails are free.</li>' +
      '<li><b>Buying:</b> after each arrival you may buy rails (and the Super Chief). Owned rails glow in the owner&rsquo;s colour.</li>' +
      '<li><b>Short of cash:</b> rails are sold back to the bank at half price, cheapest first.</li>' +
      '<li><b>Red squares</b> are zapper cities: only one rail serves them.</li>' +
      '<li><b>Assumed, not from a rule book:</b> leftover dots lost on arrival, Super Chief buyable at any arrival and its extra die only after an arrival, what counts as a catch (same city at the end of a move), forced-sale rule, bot behaviour. Tell me what to change.</li>' +
      '<li><b>Dice by hand:</b> tick the box in the toolbar to type in your physical dice instead.</li><li><b>Export</b> at the end saves every trip as JSON for the tracker.</li></ul><div class="row"><button class="b pri" id="ok">Close</button></div>';
    $('ok').onclick = () => d.close(); d.showModal();
  }
  $('gear').onclick = () => $('set').showModal();
  $('setok').onclick = () => $('set').close();
  $('bnew').onclick = () => { $('set').close(); openSetup(); }; $('brules').onclick = () => { $('set').close(); openRules(); };
  $('hsold').checked = !!prefs.hideSold;
  $('hsold').onchange = e => { prefs.hideSold = e.target.checked; savePrefs(); if (g) $('rails').innerHTML = railsHtml(); };
  document.addEventListener('toggle', e => { const d = e.target; if (d.dataset && d.dataset.grp) { prefs.shut = prefs.shut || {}; prefs.shut[d.dataset.grp] = !d.open; savePrefs(); } }, true);
  $('bsave').onclick = () => { if (g) download('baron-save.json', JSON.stringify(g)); };
  $('hm').checked = prefs.homes !== false; $('stp').checked = prefs.step !== false; $('tg').checked = prefs.tags !== false; $('spd').value = String(prefs.speed); $('fol').checked = prefs.follow; $('man').checked = prefs.manual;

  buildMap(); updateMap();
  window.baronDebug = { B, get g() { return g; }, set g(v) { g = v; }, render, afterAction, handleMapClick, selectRail, closeTip, turnIntro };
  let saved = null; try { saved = localStorage.getItem(SAVE); } catch (e) { /* none */ }
  if (saved) { try { g = JSON.parse(saved); afterAction(); } catch (e) { openSetup(); } } else { openSetup(); }
})();
