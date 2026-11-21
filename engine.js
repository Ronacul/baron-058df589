/* Game engine: the rules of a railroad dice-and-destinations game. No DOM, no network.
   One map = one data object (see data-eurobaron.js). The tables inside MAP.tracker use the same shape as the
   our stats tracker (cities, m = payoff matrix row by row, regions odd/even, cityTables), so game logs can feed it later.
   Rules as implemented (change them in MAP.cfg or in the functions below; assumptions are marked ASSUMED):
   - Destination: coloured die odd/even + two white dice (sum 2-12) pick a region, then a second roll picks the city in it.
     Rolling the region you are in lets you PICK any region, then the city roll is made in it.
   - Movement: 2 dice of dots a turn. Leftover dots on arrival are lost (ASSUMED). SUPER CHIEF: after an arrival you may collect, buy,
     roll a NEW destination and move with ONE extra die in the same turn (fees already paid this turn are not paid again).
   - At the win cash a player must DECLARE for home instead of rolling a destination. A declared runner who ends a move in the same city as a
     player who is not running home is CAUGHT (ASSUMED rule): pays the catcher cfg.catchFee, must roll and run a new destination, paid from the
     city where they declared.
   - Payoff on arrival = shortest track distance in dots from where the trip started, times MAP.unit.
   - Fees, once per turn: 1K to the bank if you used any public rail; 5K (10K once every rail is sold) to each owner whose rail you used; own rails free.
   - Rails can be bought at every arrival. Orient Express can be bought at every arrival (ASSUMED).
   - Win: reach the win cash at an arrival, then reach your home city.
   - Cash below zero: rails are sold to the bank at half price, cheapest first (ASSUMED). */
(function (root) {
  'use strict';

  function prep(M) {
    if (M._p) return M._p;
    const names = M.tracker.cities, idx = {};
    names.forEach((n, i) => { idx[n] = i; });
    const n = names.length, m = M.tracker.m.split(',').map(Number);
    const adj = {}; names.forEach(c => { adj[c] = []; });
    M.hops.forEach((h, i) => {
      h.id = i;
      h.dotpts = h.pts.filter(p => p[2]);
      adj[h.a].push({ to: h.b, hop: i, dots: h.nd });
      adj[h.b].push({ to: h.a, hop: i, dots: h.nd });
    });
    const rail = {}; M.rails.forEach(r => { rail[r.code] = r; r.cities = new Set(); r.routes.forEach(rt => rt.forEach(c => r.cities.add(c))); });
    const city = {}; M.cities.forEach(c => { city[c.n] = c; });
    const regionCities = {}; M.cities.forEach(c => { (regionCities[c.r] = regionCities[c.r] || []).push(c.n); });
    const railsAt = {}; M.rails.forEach(r => r.cities.forEach(c => { (railsAt[c] = railsAt[c] || []).push(r.code); }));
    /* crossings: where two tracks cross between cities, a player may change track. J[hopId][pip from hop.a] = [{hop, dd}] */
    const J = {}; M.hops.forEach(h => { J[h.id] = {}; });
    const segX = (a, b, c, d) => { const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (!den) return null; const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den; return (t >= 0 && t <= 1 && u >= 0 && u <= 1) ? [a[0] + t * r[0], a[1] + t * r[1]] : null; };
    const plen = h => { let L = 0; for (let i = 1; i < h.pts.length; i++) L += Math.hypot(h.pts[i][0] - h.pts[i - 1][0], h.pts[i][1] - h.pts[i - 1][1]); return L; };
    const bbox = h => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; h.pts.forEach(p => { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }); return [x0, y0, x1, y1]; };
    M.hops.forEach(h => { h._bb = bbox(h); h._sp = plen(h) / Math.max(1, h.nd); });
    const nearDot = (h, X) => { let bi = -1, bd = 1e9; h.dotpts.forEach((p, i) => { const d = Math.hypot(p[0] - X[0], p[1] - X[1]); if (d < bd) { bd = d; bi = i; } }); return { dd: bi + 1, d: bd }; };
    for (let i = 0; i < M.hops.length; i++) for (let j = i + 1; j < M.hops.length; j++) {
      const A = M.hops[i], Bh = M.hops[j];
      if (A._bb[2] < Bh._bb[0] || Bh._bb[2] < A._bb[0] || A._bb[3] < Bh._bb[1] || Bh._bb[3] < A._bb[1]) continue;
      for (let k = 1; k < A.pts.length; k++) for (let l = 1; l < Bh.pts.length; l++) {
        const X = segX(A.pts[k - 1], A.pts[k], Bh.pts[l - 1], Bh.pts[l]); if (!X) continue;
        const na = nearDot(A, X), nb = nearDot(Bh, X);
        if (na.dd < 1 || na.dd > A.nd - 1 || nb.dd < 1 || nb.dd > Bh.nd - 1 || na.d > A._sp * 0.8 || nb.d > Bh._sp * 0.8) continue;
        const la = (J[A.id][na.dd] = J[A.id][na.dd] || []), lb = (J[Bh.id][nb.dd] = J[Bh.id][nb.dd] || []);
        if (!la.some(q => q.hop === Bh.id && q.dd === nb.dd)) la.push({ hop: Bh.id, dd: nb.dd });
        if (!lb.some(q => q.hop === A.id && q.dd === na.dd)) lb.push({ hop: A.id, dd: na.dd });
      }
    }
    M._p = { names, idx, n, m, adj, rail, city, regionCities, railsAt, J };
    return M._p;
  }

  function Baron(M) {
    const P = prep(M), C = M.cfg; if (C.catchFee === undefined) C.catchFee = 50000;

    /* ---------- random numbers (seeded, state kept inside the game so saves replay) ---------- */
    function rnd(g) {
      g.rng = (g.rng + 0x6D2B79F5) >>> 0;
      let t = g.rng; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
    const d6 = g => 1 + Math.floor(rnd(g) * 6);

    /* ---------- small helpers ---------- */
    const units = (a, b) => P.m[P.idx[a] * P.n + P.idx[b]];
    const payoff = (a, b) => units(a, b) * M.unit;
    const cur = g => g.players[g.turn];
    const allSold = g => Object.keys(g.owner).length === M.rails.length;
    const regionOf = c => P.city[c].r;
    const money = v => (v < 0 ? '-' : '') + M.currency + (Math.abs(v) / M.unit).toLocaleString(undefined, { maximumFractionDigits: 1 }) + 'K';
    function ev(g, from, to, amt) { g.evn = (g.evn || 0) + 1; (g.ev = g.ev || []).push({ n: g.evn, from, to, amt }); if (g.ev.length > 80) g.ev.shift(); }
    function log(g, text, p) { g.log.push({ round: g.round, p: p === undefined ? -1 : p, t: text }); if (g.log.length > 600) g.log.shift(); }

    /* ---------- new game ---------- */
    function newGame(s) {
      const g = {
        v: 1, map: M.id, rng: (s.seed >>> 0) || ((Math.random() * 4294967296) >>> 0), seed: s.seed || 0,
        cfg: { start: s.start || C.start, win: s.win || C.win, superChief: s.superChief === undefined ? C.superChief : s.superChief },
        round: 1, turn: 0, phase: 'dest', stage: 'region', owner: {}, log: [], trips: [], dice: null, winner: null, turnPaid: {}, lastMove: null, moveNote: null,
        players: []
      };
      s.players.forEach((pl, i) => {
        g.players.push({
          id: i, name: pl.name || ('Player ' + (i + 1)), bot: !!pl.bot, home: null, loc: null, dest: null, origin: null, path: [], h: 0, dd: 0,
          cash: g.cfg.start, sc: false, goingHome: false, trips: 0, turns: 0, gross: 0, paid: 0, received: 0, sold: 0,
          f1: 0, f5: 0, f10: 0, r5: 0, r10: 0
        });
      });
      /* the game opens with two set-up rounds: everyone rolls for turn order, then (in that order) for a home city */
      g.phase = 'order'; g.turn = 0; g.first = 0; g.setup = { i: 0, round: 1, con: g.players.map((_, k) => k), rolls: [], last: null };
      log(g, 'Everyone rolls a die: the highest goes first (ties roll again). Play then follows the seating order.');
      return g;
    }
    /* who goes first: every player rolls one die, the highest wins; tied players roll again among themselves until one is left.
       The seating order never changes: play starts with the winner and goes round the table in seat order. */
    function rollOrder(g) {
      const s = g.setup; if (g.phase !== 'order' || !s) return null;
      const pi = s.con[s.i], p = g.players[pi], v = d6(g); s.rolls[pi] = { a: v, sum: v, round: s.round }; g.dice = { kind: 'order', rolls: [v], sum: v };
      log(g, p.name + ' rolled ' + v + (s.round > 1 ? ' (re-roll)' : '') + ' to go first.', p.id);
      s.i++;
      if (s.i < s.con.length) { g.turn = s.con[s.i]; return v; }
      const max = Math.max.apply(null, s.con.map(q => s.rolls[q].sum)), top = s.con.filter(q => s.rolls[q].sum === max);
      if (top.length > 1) { // a tie for the highest: only those players roll again
        log(g, top.map(q => g.players[q].name).join(' and ') + ' tied on ' + max + ' and roll again.');
        s.round++; s.con = top; s.i = 0; g.turn = top[0]; return v;
      }
      s.first = top[0]; g.first = top[0]; s.seq = g.players.map((_, k) => (top[0] + k) % g.players.length);
      log(g, g.players[top[0]].name + ' goes first, then play follows the seating order. Now each rolls for a home city, starting with ' + g.players[top[0]].name + '.', g.players[top[0]].id);
      g.phase = 'home'; s.i = 0; g.turn = s.seq[0]; return v;
    }
    function rollHomeStep(g) { // region roll then city roll, shown together
      const s = g.setup; if (g.phase !== 'home' || !s) return null;
      const p = g.players[s.seq[s.i]], r = tableRoll(g), region = M.tracker.regions[r.parity][r.sum], tab = M.tracker.cityTables[region];
      const d1 = { kind: 'region', ...r, region }; let city = region, d2 = null;
      if (tab) { const r2 = tableRoll(g); city = tab[r2.parity][r2.sum]; d2 = { kind: 'city', ...r2, region, city }; }
      p.home = p.loc = city; g.destRolls = d2 ? { region: d1, city: d2 } : { region: d1 }; g.dice = d2 || d1; s.last = p.name; g.lastHome = { name: p.name, id: p.id, region: d1, city: d2, home: city };
      log(g, p.name + ' rolled region ' + region + (tab ? ' then city ' + city : '') + ': home is ' + city + ', starting with ' + money(g.cfg.start) + '.', p.id);
      s.i++;
      if (s.i < g.players.length) { g.turn = s.seq[s.i]; return city; }
      g.turn = s.first; g.round = 1; startTurn(g); return city;
    }

    /* ---------- dice and tables ---------- */
    function tableRoll(g, manual) {
      if (manual) return { col: manual.parity === 'odd' ? 1 : 2, w1: 0, w2: 0, parity: manual.parity, sum: manual.sum, manual: true };
      const col = d6(g), w1 = d6(g), w2 = d6(g);
      return { col, w1, w2, parity: col % 2 ? 'odd' : 'even', sum: w1 + w2 };
    }
    function rollHome(g) {
      for (let k = 0; k < 20; k++) {
        const r = tableRoll(g), region = M.tracker.regions[r.parity][r.sum];
        const tab = M.tracker.cityTables[region]; if (!tab) return region;
        const r2 = tableRoll(g); return tab[r2.parity][r2.sum];
      }
    }
    function startTurn(g) {
      const p = cur(g); g.turnPaid = {}; g.bonus = false; g.dbl6 = false; g.bought = false; p.scNew = false; g.dice = null; g.destRolls = null; g.moveNote = null; g.lastMove = null; g.walk = null;
      if (p.goingHome && p.loc === p.home) { win(g, p); return; }
      if (p.dest) { g.phase = 'route'; } else beginDest(g);
    }
    function beginDest(g) { // roll a destination, or (at the win cash) declare for home instead
      const p = cur(g); g.phase = 'dest'; g.region = null; g.needPick = false; g.destRolls = null;
      g.stage = (p.cash >= g.cfg.win && !p.mustRun && !p.goingHome) ? 'declare' : 'region';
    }
    function skipDeclare(g) { if (g.phase !== 'dest' || g.stage !== 'declare') return false; g.stage = 'region'; log(g, cur(g).name + ' has ' + money(cur(g).cash) + ' but keeps playing: rolling a destination instead of declaring.', g.turn); return true; }
    function declareHome(g) {
      const p = cur(g); if (g.phase !== 'dest' || g.stage !== 'declare') return false;
      p.goingHome = true; p.declaredFrom = p.loc; log(g, p.name + ' has ' + money(p.cash) + ' and declares: heading home to ' + p.home + '! Anyone who crosses ' + p.name + ' (any pip or city) catches them (' + money(C.catchFee) + ').', p.id);
      if (p.loc === p.home) { win(g, p); return true; }
      setDest(g, p.home); return true;
    }
    /* crossing: a player who is not running home catches a declared runner by crossing the runner's spot (a pip or a city), (a runner crossing other players on their own turn is never caught).
       pts are the spots the mover passed over this move. Both runners (or neither) running home: nothing happens. */
    const ptAt = (hopId, from, dd) => { const h = M.hops[hopId]; if (dd <= 0) { const c = P.city[from]; return [c.x, c.y]; } if (dd >= h.nd) { const c = P.city[from === h.a ? h.b : h.a]; return [c.x, c.y]; } const q = h.dotpts[(from === h.a ? dd : h.nd - dd) - 1]; return [q[0], q[1]]; };
    function caught(g, r, c) {
      r.cash -= C.catchFee; c.cash += C.catchFee; r.paid += C.catchFee; c.received += C.catchFee; ev(g, r.id, c.id, C.catchFee);
      const mid = r.path.length && r.dd > 0 && r.h < r.path.length;
      r.goingHome = false; r.legacy = null; r.mustRun = true; r.payFrom = r.declaredFrom || r.loc; r.dest = null; r.origin = null; r.via = [];
      if (mid) { r.path = [r.path[r.h]]; r.h = 0; } else { r.path = []; r.h = 0; r.dd = 0; }
      log(g, c.name + ' catches ' + r.name + '! ' + r.name + ' pays ' + money(C.catchFee) + ', must roll a new destination (and reach it before declaring again), paid from ' + r.payFrom + '.', c.id);
      settle(g, r);
    }
    function checkCatch(g, mover, pts) {
      if (g.phase === 'over') return;
      const path = (pts || []).concat([tokenPos(g, mover)]), near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 5;
      g.players.forEach(o => {
        if (o.id === mover.id || !o.loc) return;
        if (!path.some(q => near(q, tokenPos(g, o)))) return;
        if (!mover.goingHome && o.goingHome) caught(g, o, mover); // only the mover can catch: a runner may cross anyone on their own turn
      });
    }
    /* Orient Express: after an arrival, collect, buy, then roll a new destination and move one die in the same turn */
    function canBonus(g) { const p = cur(g); return g.phase === 'buy' && ((p.sc && !p.scNew) || g.dbl6) && !g.bonus; }
    function startBonus(g) {
      if (!canBonus(g)) return false;
      g.bonus = true; log(g, cur(g).name + (cur(g).sc ? ' uses the Orient Express' : ' uses the double six') + ': a new destination and one more die this turn.', g.turn); beginDest(g); return true;
    }
    /* double six on the two movement dice gives the Orient Express bonus for that turn (once; the bonus die itself cannot chain) */
    function checkDouble6(g, rolls) {
      if (!g.bonus && rolls.length === 2 && rolls[0] === 6 && rolls[1] === 6) { g.dbl6 = true; log(g, cur(g).name + ' rolled DOUBLE SIX: if they arrive they get the Orient Express bonus (new destination + one die) this turn.', g.turn); }
    }
    function win(g, p) { g.winner = p.id; g.phase = 'over'; log(g, p.name + ' is home with ' + money(p.cash) + ' and wins on round ' + g.round + '!', p.id); }

    /* destination: step 1 = region roll */
    function rollRegion(g, manual) {
      const p = cur(g), r = tableRoll(g, manual); g.dice = { kind: 'region', ...r };
      const region = M.tracker.regions[r.parity][r.sum]; g.dice.region = region; g.destRolls = { region: g.dice };
      if (regionOf(p.loc) === region) { g.needPick = true; g.stage = 'pick'; log(g, p.name + ' rolled ' + region + ', where they already are: choose any region.', p.id); }
      else { g.region = region; g.stage = 'city'; log(g, p.name + ' rolled region ' + region + '.', p.id); }
      return g.dice;
    }
    function pickRegion(g, region) { g.region = region; g.needPick = false; g.stage = 'city'; log(g, cur(g).name + ' chose ' + region + '.', g.turn); }
    /* step 2 = city roll (a region without a table is a single city, like London on the UK board) */
    function rollCity(g, manual) {
      const p = cur(g), tab = M.tracker.cityTables[g.region];
      if (!tab) { setDest(g, g.region); return null; }
      for (let k = 0; k < 20; k++) {
        const r = tableRoll(g, k === 0 ? manual : null); const city = tab[r.parity][r.sum];
        g.dice = { kind: 'city', ...r, region: g.region, city }; g.destRolls = Object.assign(g.destRolls || {}, { city: g.dice });
        if (city !== p.loc) { setDest(g, city); return g.dice; }
      }
    }
    function setDest(g, city) {
      const p = cur(g); p.dest = city; p.origin = (!p.goingHome && p.payFrom) ? p.payFrom : p.loc; p.payFrom = null; p.h = 0; p.dd = 0; g.stage = 'region';
      p.via = []; g.routeMode = 'balanced'; p.path = pathFor(g, p, 'balanced'); g.phase = 'route';
      log(g, p.name + (p.goingHome ? ' heads home to ' : ' draws destination ') + city + ' (' + units(p.loc, city) + ' dots, pays ' + (p.goingHome ? 'the win' : money(payoff(p.origin, city))) + ').', p.id);
    }

    /* ---------- routing ---------- */
    const LAMBDA = { fast: 0, balanced: 0.4, cheap: 1.6 };
    function hopPenalty(g, pi, hop) {
      const rl = hop.rails; if (!rl.length) return 0;
      if (rl.some(r => g.owner[r] === pi)) return 0;
      if (rl.some(r => g.owner[r] === undefined)) return 1;
      return allSold(g) ? 10 : 5;
    }
    function route(g, pi, from, to, mode) {
      const lam = LAMBDA[mode] === undefined ? 0.4 : LAMBDA[mode];
      const dist = { [from]: 0 }, prev = {}, done = {};
      for (;;) {
        let u = null, bd = Infinity;
        for (const k in dist) if (!done[k] && dist[k] < bd) { bd = dist[k]; u = k; }
        if (u === null || u === to) break;
        done[u] = true;
        for (const e of P.adj[u]) {
          const hop = M.hops[e.hop], nd = bd + e.dots + lam * hopPenalty(g, pi, hop);
          if (dist[e.to] === undefined || nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = { from: u, hop: e.hop, dots: e.dots }; }
        }
      }
      const path = []; let c = to;
      while (c !== from) { const pv = prev[c]; if (!pv) return []; path.unshift({ hop: pv.hop, from: pv.from, to: c, dots: pv.dots }); c = pv.from; }
      return path;
    }
    /* the player may steer the route through waypoints (p.via); between waypoints the chosen mode finds the way */
    function pathFor(g, p, mode) {
      const first = p.dd > 0 ? p.path[p.h] : null, start = first ? first.to : p.loc;
      const chain = [start]; (p.via || []).forEach(c => { if (c !== chain[chain.length - 1] && c !== p.dest) chain.push(c); }); chain.push(p.dest);
      let path = []; for (let i = 0; i + 1 < chain.length; i++) path = path.concat(route(g, p.id, chain[i], chain[i + 1], mode));
      return first ? [first].concat(path) : path;
    }
    function setRoute(g, mode) {
      const p = cur(g); if (!p.dest) return;
      p.path = pathFor(g, p, mode || 'balanced'); p.h = 0;
    }
    function toggleVia(g, city) {
      const p = cur(g); if (!p.dest || city === p.dest || city === p.loc) return false;
      p.via = p.via || []; const i = p.via.indexOf(city); if (i >= 0) p.via.splice(i, 1); else p.via.push(city);
      setRoute(g, g.routeMode || 'balanced'); return true;
    }
    function clearVia(g) { const p = cur(g); p.via = []; setRoute(g, g.routeMode || 'balanced'); }
    function routeInfo(g, pi, mode) { // dots left, rails used and an estimate of what the next turn would cost
      const p = g.players[pi], path = mode ? pathFor(g, p, mode).filter((st, i) => !(p.dd > 0 && i === 0)) : p.path.slice(p.h);
      const left = path.reduce((s, st) => s + st.dots, 0) - (mode ? 0 : p.dd);
      const sc = 7, paid = {}; let est = 0, dots = sc; const rails = [];
      for (const st of path) {
        const hop = M.hops[st.hop]; hop.rails.forEach(r => { if (!rails.includes(r)) rails.push(r); });
        if (dots <= 0) break;
        const f = feeFor(g, pi, hop.rails, paid); if (f && !f.free) { paid[f.key] = 1; est += f.amount; }
        dots -= st.dots;
      }
      return { dots: left, rails, nextTurnFees: est };
    }

    /* ---------- fees ---------- */
    function feeFor(g, pi, rails, paid) {
      if (!rails.length) return { free: true };
      if (rails.some(r => g.owner[r] === pi)) return { free: true };
      const keyOf = r => (g.owner[r] === undefined ? 'PUB' : 'O' + g.owner[r]);
      const had = rails.find(r => paid[keyOf(r)]); if (had) return { free: true, rail: had };
      const q = g.players[pi], lg = q && q.legacy, lr = lg && lg.rails ? rails.find(r => lg.rails[r] !== undefined) : undefined;
      let pick = lr || rails.find(r => g.owner[r] === undefined);
      if (!pick) pick = rails.slice().sort((a, b) => P.rail[a].price - P.rail[b].price)[0];
      const o = g.owner[pick]; let amount = o === undefined ? C.feePublic : (allSold(g) ? C.feeAllSold : C.feePrivate), legacy = false;
      /* legacy prices: a player who was on, or at the end of, a track when it was bought keeps paying the old price until they reach their destination
         (the public 1K for that track; and 5K instead of 10K when that purchase sold the last rail) */
      if (lg && lg.rails && lg.rails[pick] !== undefined && o !== undefined) { amount = lg.rails[pick]; legacy = true; }
      else if (lg && lg.tier5 && o !== undefined && allSold(g)) { amount = C.feePrivate; legacy = true; }
      return { key: keyOf(pick), amount, payee: o === undefined ? -1 : o, rail: pick, legacy };
    }

    /* ---------- movement ---------- */
    function rollMove(g, manualSum) {
      const p = cur(g), n = g.bonus ? 1 : C.dice, rolls = [];
      let sum = 0; if (manualSum) { sum = manualSum; } else { for (let i = 0; i < n; i++) { const v = d6(g); rolls.push(v); sum += v; } }
      g.dice = { kind: 'move', rolls, sum, manual: !!manualSum }; checkDouble6(g, rolls);
      return move(g, sum);
    }
    function move(g, n) {
      const p = cur(g), notes = [], pts = [], trail = []; let rem = n, used = 0; if (!g.bonus) g.turnPaid = {}; p.turns++;
      while (rem > 0 && p.h < p.path.length) {
        const st = p.path[p.h], hop = M.hops[st.hop], take = Math.min(rem, st.dots - p.dd);
        const f = feeFor(g, p.id, hop.rails, g.turnPaid);
        if (f && !f.free) {
          g.turnPaid[f.key] = 1; p.cash -= f.amount; p.paid += f.amount; ev(g, p.id, f.payee, f.amount);
          if (f.payee < 0) { p.f1++; notes.push('paid ' + money(f.amount) + ' to the bank (public ' + f.rail + ')'); }
          else {
            const o = g.players[f.payee]; o.cash += f.amount; o.received += f.amount;
            if (allSold(g)) { p.f10++; o.r10++; } else { p.f5++; o.r5++; }
            notes.push('paid ' + money(f.amount) + ' to ' + o.name + ' (' + f.rail + (f.legacy ? ', legacy price' : '') + ')');
          }
        }
        for (let k = 1; k <= take; k++) pts.push(ptAt(st.hop, st.from, p.dd + k));
        trail.push({ hop: st.hop, from: st.from, to: st.to, start: p.dd, take });
        p.dd += take; rem -= take; used += take;
        if (p.dd >= st.dots) { p.h++; p.dd = 0; p.loc = st.to; }
      }
      const arrived = p.h >= p.path.length; g.trails = g.trails || {}; g.trails[p.id] = trail; g.lastMover = p.id;
      g.lastMove = { moved: used, rolled: n, notes, arrived };
      log(g, p.name + ' rolled ' + n + ' and moved ' + used + ' dot' + (used === 1 ? '' : 's') + (notes.length ? ': ' + notes.join('; ') : '; no fees') + '.', p.id);
      settle(g, p); if (!(arrived && p.goingHome && p.dest === p.home)) checkCatch(g, p, pts);
      if (arrived) arrive(g, p); else endTurn(g);
      return g.lastMove;
    }
    /* ---------- step-by-step movement: the player clicks each pip to follow, counting down the roll ---------- */
    function rollMoveStep(g, manualSum) {
      const p = cur(g), n = g.bonus ? 1 : C.dice, rolls = []; let sum = 0;
      if (manualSum) sum = manualSum; else for (let i = 0; i < n; i++) { const v = d6(g); rolls.push(v); sum += v; }
      g.dice = { kind: 'move', rolls, sum, manual: !!manualSum }; checkDouble6(g, rolls);
      const first = p.dd > 0 ? p.path[p.h] : null;
      g.walk = { n: sum, rem: sum, segs: [], at: first ? 'hop' : 'city', city: first ? null : p.loc, hop: first ? first.hop : null, from: first ? first.from : null, to: first ? first.to : null, dd: first ? p.dd : 0, done: false, arrived: false };
      g.walk.init = { at: g.walk.at, city: g.walk.city, hop: g.walk.hop, from: g.walk.from, to: g.walk.to, dd: g.walk.dd };
      g.phase = 'walk'; log(g, p.name + ' rolled ' + sum + (g.bonus ? ' on the Orient Express die' : '') + ': click the pips to move.', p.id);
      return g.walk;
    }
    /* every pip you can click: along the track you are on as far as the roll reaches, onto any track that crosses it, and (at a city) down every track.
       Where tracks leave a city so close together that their pips overlap, only the first pip of each track is offered (choose: true) so you pick the track first. */
    function optPos(o) {
      const hop = M.hops[o.hop]; if (o.dd >= hop.nd) { const c = P.city[o.to]; return [c.x, c.y]; }
      const pt = hop.dotpts[(o.from === hop.a ? o.dd : hop.nd - o.dd) - 1]; return [pt[0], pt[1]];
    }
    function stepOptions(g) {
      const w = g.walk; if (!w || w.done || w.rem <= 0) return [];
      const out = [];
      const along = (hopId, from, to, start, jstart) => { const hop = M.hops[hopId]; for (let d = start + 1; d <= Math.min(hop.nd, start + w.rem); d++) { const o = { hop: hopId, from, to, dd: d }; if (jstart !== undefined) o.jstart = jstart; out.push(o); } };
      if (w.at === 'hop') {
        along(w.hop, w.from, w.to, w.dd);
        const h = M.hops[w.hop], abs = w.from === h.a ? w.dd : h.nd - w.dd;
        ((P.J[w.hop] || {})[abs] || []).forEach(x => { // a crossing: carry on along the other track, either way
          const h2 = M.hops[x.hop];
          along(x.hop, h2.a, h2.b, x.dd, x.dd);
          along(x.hop, h2.b, h2.a, h2.nd - x.dd, h2.nd - x.dd);
        });
        return out;
      }
      P.adj[w.city].forEach(e => along(e.hop, w.city, e.to, 0));
      const firsts = out.filter(o => o.dd === 1);
      if (firsts.length > 1) {
        let close = false; for (let i = 0; i < firsts.length && !close; i++) for (let j = i + 1; j < firsts.length; j++) { const a = optPos(firsts[i]), b = optPos(firsts[j]); if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 34) { close = true; break; } }
        if (close) return firsts.map(o => Object.assign({ choose: true }, o));
      }
      return out;
    }
    function suggestedStep(g) { // the furthest option along the planned route
      const w = g.walk, p = cur(g), opts = stepOptions(g); if (!opts.length) return -1;
      let hopId;
      if (w.at === 'hop') hopId = w.hop; else { const r = route(g, p.id, w.city, p.dest, g.routeMode || 'balanced'); if (!r.length) return -1; hopId = r[0].hop; }
      let best = -1; opts.forEach((o, i) => { if (o.hop === hopId && o.jstart === undefined && (best < 0 || o.dd > opts[best].dd)) best = i; }); return best;
    }
    function stepOne(g, o) {
      const w = g.walk, hop = M.hops[o.hop], last = w.segs[w.segs.length - 1]; w.rem--;
      if (last && last.hop === o.hop && last.from === o.from && last.start + last.take === o.dd - 1) last.take++; else w.segs.push({ hop: o.hop, from: o.from, to: o.to, start: o.dd - 1, take: 1 });
      if (o.dd >= hop.nd) { w.at = 'city'; w.city = o.to; w.hop = null; w.from = null; w.to = null; w.dd = 0; } else { w.at = 'hop'; w.city = null; w.hop = o.hop; w.from = o.from; w.to = o.to; w.dd = o.dd; }
      if (w.at === 'city' && w.city === cur(g).dest) { w.arrived = true; w.done = true; } else if (w.rem === 0) w.done = true;
    }
    function stepWalk(g, i) { // click one pip: jumps every pip up to it along the same track (changing track first if it is a crossing)
      const w = g.walk, o = stepOptions(g)[i]; if (!o) return false;
      if (o.jstart !== undefined) { w.at = 'hop'; w.city = null; w.hop = o.hop; w.from = o.from; w.to = o.to; w.dd = o.jstart; }
      const from = w.at === 'hop' ? w.dd : 0;
      for (let d = from + 1; d <= o.dd; d++) stepOne(g, { hop: o.hop, from: o.from, to: o.to, dd: d });
      return true;
    }
    function undoWalk(g) { // take back the last pip
      const w = g.walk; if (!w || !w.segs.length) return false;
      const last = w.segs[w.segs.length - 1]; last.take--; if (last.take === 0) w.segs.pop();
      w.rem++; w.done = false; w.arrived = false;
      const e = w.segs[w.segs.length - 1];
      if (!e) { Object.assign(w, w.init); return true; }
      const hop = M.hops[e.hop], dd = e.start + e.take;
      if (dd >= hop.nd) { w.at = 'city'; w.city = e.to; w.hop = null; w.from = null; w.to = null; w.dd = 0; } else { w.at = 'hop'; w.city = null; w.hop = e.hop; w.from = e.from; w.to = e.to; w.dd = dd; }
      return true;
    }
    function autoWalk(g) {
      const w = g.walk; for (let k = 0; k < 40 && w && !w.done; k++) { const i = suggestedStep(g); if (!stepWalk(g, i < 0 ? 0 : i)) break; }
    }
    function walkFees(g) { // what the walk so far would cost: { notes, total }
      const w = g.walk, p = cur(g), paid = g.bonus ? Object.assign({}, g.turnPaid) : {}, notes = []; let total = 0;
      w.segs.forEach(seg => {
        const f = feeFor(g, p.id, M.hops[seg.hop].rails, paid);
        if (f && !f.free) { paid[f.key] = 1; total += f.amount; notes.push(f.payee < 0 ? 'bank ' + money(f.amount) : g.players[f.payee].name + ' ' + money(f.amount)); }
      });
      return { notes, total };
    }
    function commitWalk(g) {
      const w = g.walk, p = cur(g); if (!w || !w.done) return false;
      const notes = []; let used = 0; if (!g.bonus) g.turnPaid = {}; p.turns++;
      w.segs.forEach(seg => {
        const hop = M.hops[seg.hop], f = feeFor(g, p.id, hop.rails, g.turnPaid); used += seg.take;
        if (f && !f.free) {
          g.turnPaid[f.key] = 1; p.cash -= f.amount; p.paid += f.amount; ev(g, p.id, f.payee, f.amount);
          if (f.payee < 0) { p.f1++; notes.push('paid ' + money(f.amount) + ' to the bank (public ' + f.rail + ')'); }
          else { const o = g.players[f.payee]; o.cash += f.amount; o.received += f.amount; if (allSold(g)) { p.f10++; o.r10++; } else { p.f5++; o.r5++; } notes.push('paid ' + money(f.amount) + ' to ' + o.name + ' (' + f.rail + (f.legacy ? ', legacy price' : '') + ')'); }
        }
      });
      const arrived = w.arrived; g.trails = g.trails || {}; g.trails[p.id] = w.segs.map(q => ({ hop: q.hop, from: q.from, to: q.to, start: q.start, take: q.take })); g.lastMover = p.id;
      if (w.at === 'city') { p.loc = w.city; p.path = []; p.h = 0; p.dd = 0; }
      else { p.loc = w.from; p.path = [{ hop: w.hop, from: w.from, to: w.to, dots: M.hops[w.hop].nd }]; p.h = 0; p.dd = w.dd; }
      g.walk = null; g.phase = 'route';
      if (!arrived) { p.path = pathFor(g, p, g.routeMode || 'balanced'); p.h = 0; }
      g.lastMove = { moved: used, rolled: w.n, notes, arrived, segs: w.segs.map(s => Object.assign({}, s)) };
      log(g, p.name + ' moved ' + used + ' dot' + (used === 1 ? '' : 's') + ' of ' + w.n + (notes.length ? ': ' + notes.join('; ') : '; no fees') + '.', p.id);
      settle(g, p); if (!(arrived && p.goingHome && p.dest === p.home)) checkCatch(g, p, w.segs.reduce((a, s) => { for (let d = s.start + 1; d <= s.start + s.take; d++) a.push(ptAt(s.hop, s.from, d)); return a; }, []));
      if (arrived) arrive(g, p); else endTurn(g);
      return true;
    }
    function arrive(g, p) {
      p.loc = p.dest; const pay = payoff(p.origin, p.dest);
      if (p.goingHome && p.loc === p.home) { win(g, p); return; }
      g.arrival = { n: ((g.arrival && g.arrival.n) || 0) + 1, id: p.id, city: p.dest, pays: pay }; p.legacy = null;
      p.cash += pay; p.gross += pay; p.trips++; ev(g, -1, p.id, pay); g.trips.push({ p: p.id, from: p.origin, to: p.dest, pays: pay, round: g.round });
      log(g, p.name + ' arrives in ' + p.dest + ' from ' + p.origin + ' and collects ' + money(pay) + ' (cash ' + money(p.cash) + ').', p.id);
      p.dest = null; p.origin = null; p.path = []; p.h = 0; p.dd = 0; p.via = []; p.mustRun = false;
      if (p.cash >= g.cfg.win) log(g, p.name + ' has ' + money(p.cash) + ': next time, declare for home (' + p.home + ') to win.', p.id);
      g.phase = 'buy';
    }
    function settle(g, p) { // negative cash: sell rails to the bank at half price, cheapest first
      while (p.cash < 0) {
        const mine = M.rails.filter(r => g.owner[r.code] === p.id).sort((a, b) => a.price - b.price);
        if (!mine.length) break;
        const r = mine[0]; delete g.owner[r.code]; const v = Math.round(r.price * M.unit / 2); p.cash += v; p.sold++; ev(g, -1, p.id, v);
        log(g, p.name + ' is short of cash and sells ' + r.code + ' to the bank for ' + money(v) + '.', p.id);
      }
    }

    /* ---------- buying ---------- */
    function canBuy(g, pi, code) { const r = P.rail[code]; return g.phase === 'buy' && !g.bought && g.owner[code] === undefined && g.players[pi].cash >= r.price * M.unit; }
    function buyRail(g, pi, code) {
      if (!canBuy(g, pi, code)) return false;
      const p = g.players[pi], r = P.rail[code], allBefore = allSold(g); p.cash -= r.price * M.unit; g.owner[code] = pi; g.bought = true; ev(g, pi, -1, r.price * M.unit);
      const onTrack = q => (q.path.length && q.dd > 0 && q.h < q.path.length && M.hops[q.path[q.h].hop].rails.indexOf(code) >= 0) || (q.loc && r.cities.has && r.cities.has(q.loc)) || (q.loc && Array.isArray(r.cities) && r.cities.indexOf(q.loc) >= 0);
      const victims = [];
      g.players.forEach(q => {
        if (q.id === pi || !q.dest) return; // only players in the middle of a trip
        const on = onTrack(q);
        if (on) { q.legacy = q.legacy || { rails: {} }; q.legacy.rails[code] = C.feePublic; }
        if (!allBefore && allSold(g)) { q.legacy = q.legacy || { rails: {} }; q.legacy.tier5 = true; }
        const serves = r.cities.has ? r.cities.has(q.dest) : (r.cities || []).indexOf(q.dest) >= 0;
        if (serves && !on && q.dest !== q.loc) victims.push({ id: q.id, name: q.name, dest: q.dest });
      });
      if (victims.length) g.taunt = { n: ((g.taunt && g.taunt.n) || 0) + 1, buyer: p.name, buyerId: pi, rail: code, railName: r.name, victims };
      log(g, p.name + ' buys ' + r.code + ' (' + r.name + ') for ' + money(r.price * M.unit) + '.', pi);
      return true;
    }
    function canBuyChief(g, pi) { const p = g.players[pi]; return g.phase === 'buy' && !g.bought && !p.sc && g.cfg.superChief > 0 && p.cash >= g.cfg.superChief; }
    function buyChief(g, pi) {
      if (!canBuyChief(g, pi)) return false;
      const p = g.players[pi]; p.cash -= g.cfg.superChief; ev(g, pi, -1, g.cfg.superChief); p.sc = true; p.scNew = true; g.bought = true; log(g, p.name + ' buys the Orient Express for ' + money(g.cfg.superChief) + ' (its bonus starts next turn).', pi); return true;
    }
    function endTurn(g) {
      if (g.phase === 'over') return;
      g.turn = (g.turn + 1) % g.players.length; if (g.turn === (g.first || 0)) g.round++;
      startTurn(g);
    }

    /* ---------- the bot (same policy as the simulator sim.pl) ---------- */
    const SCORE_EXP = 0.6, THR = 0.7, BNW = 0.5;
    const railScore = r => ((r.traf || 0) + BNW * (r.imp || 0) / 10) / Math.pow(r.price * M.unit, SCORE_EXP);
    function botPickRegion(g, p) {
      let best = null, bs = -1;
      Object.keys(P.regionCities).forEach(reg => {
        if (reg === regionOf(p.loc)) return;
        const cs = P.regionCities[reg]; let cov = 0;
        cs.forEach(c => { if ((P.railsAt[c] || []).some(r => g.owner[r] === p.id)) cov++; });
        const sc = cov / cs.length + Math.random() * 0.05; if (sc > bs) { bs = sc; best = reg; }
      });
      return best;
    }
    function botBuy(g, p) {
      if (g.bought) return;
      if (!p.sc && g.cfg.superChief > 0 && p.cash >= g.cfg.superChief + 0.5 * C.meanPay) { buyChief(g, p.id); return; }
      for (let guard = 0; guard < 40; guard++) {
        if (p.cash >= g.cfg.win) return;
        const open = M.rails.filter(r => g.owner[r.code] === undefined); if (!open.length) return;
        const gmax = Math.max.apply(null, open.map(railScore));
        let best = null, bs = -1;
        open.forEach(r => { if (r.price * M.unit > p.cash - C.meanPay) return; const sc = railScore(r); if (sc < THR * gmax) return; if (sc > bs) { bs = sc; best = r; } });
        if (!best) return; buyRail(g, p.id, best.code); return;
      }
    }
    /* a runner declared for home and sits in a city: if the roll lands exactly on it, go there and collect the catch fee */
    function botChase(g, p) {
      if (p.goingHome) return false;
      const R = g.players.find(q => q.id !== p.id && q.goingHome && !(q.path.length && q.dd > 0) && q.loc !== p.loc); if (!R) return false;
      const w0 = units(p.loc, R.loc); if (p.dd > 0 || w0 > 12 || w0 < 1) return false;
      const w = rollMoveStep(g); if (w.n < w0) { autoWalk(g); commitWalk(g); return true; }
      for (let k = 0; k < 60 && !w.done && !(w.at === 'city' && w.city === R.loc); k++) {
        const opts = stepOptions(g); if (!opts.length) break;
        let hopId, to; if (w.at === 'hop') { hopId = w.hop; to = w.to; } else { const r = route(g, p.id, w.city, R.loc, 'fast'); if (!r.length) break; hopId = r[0].hop; to = r[0].to; }
        let bi = -1; opts.forEach((o, i) => { if (o.hop === hopId && o.to === to && o.jstart === undefined && (bi < 0 || o.dd > opts[bi].dd)) bi = i; });
        if (bi < 0 || !stepWalk(g, bi)) break;
      }
      if (!w.done) autoWalk(g);
      commitWalk(g); return true;
    }
    /* one bot action per call, so the page can show each step */
    function botAct(g) {
      const p = cur(g); if (!p.bot || g.phase === 'over') return null;
      if (g.phase === 'order') { rollOrder(g); return 'rolls for turn order'; }
      if (g.phase === 'home') { rollHomeStep(g); return 'rolls for a home city'; }
      if (g.phase === 'dest') {
        if (g.stage === 'declare') { if (units(p.loc, p.home) <= 16 || p.loc === p.home) { declareHome(g); return 'declares for home'; } skipDeclare(g); return 'keeps rolling destinations'; }
        if (g.stage === 'region') { rollRegion(g); return 'rolls the destination'; }
        if (g.stage === 'pick') { pickRegion(g, botPickRegion(g, p)); return 'chooses a region'; }
        if (g.stage === 'city') { rollCity(g); return 'rolls the city'; }
      }
      if (g.phase === 'route') { if (botChase(g, p)) return 'chases the runner'; rollMove(g); return 'moves'; }
      if (g.phase === 'buy') { botBuy(g, p); if (canBonus(g)) { startBonus(g); return 'uses the Orient Express'; } endTurn(g); return 'ends the turn'; }
      return null;
    }

    function stats(g) {
      return g.players.map(p => ({
        name: p.name, bot: p.bot, cash: p.cash, trips: p.trips, avg: p.trips ? p.gross / p.trips : 0, turns: p.turns, gross: p.gross, paid: p.paid, received: p.received,
        rails: M.rails.filter(r => g.owner[r.code] === p.id).map(r => r.code), sc: p.sc, f1: p.f1, f5: p.f5, f10: p.f10
      }));
    }
    function tokenPos(g, p) { // [x,y] on the map for a player
      if (!p.loc) return [M.view[0] + M.view[2] / 2, M.view[1] + M.view[3] / 2];
      if (g.walk && p.id === g.turn) { const w = g.walk; if (w.at === 'hop') { const hop = M.hops[w.hop], pt = hop.dotpts[(w.from === hop.a ? w.dd : hop.nd - w.dd) - 1]; if (pt) return [pt[0], pt[1]]; } else { const c = P.city[w.city]; return [c.x, c.y]; } }
      if (p.path.length && p.h < p.path.length && p.dd > 0) {
        const st = p.path[p.h], hop = M.hops[st.hop], k = st.from === hop.a ? p.dd : hop.nd - p.dd;
        const pt = hop.dotpts[k - 1]; if (pt) return [pt[0], pt[1]];
      }
      const c = P.city[p.loc]; return [c.x, c.y];
    }
    /* export in the tracker's shape: one row per trip */
    function exportLog(g) {
      return { map: M.id, name: M.name, rounds: g.round, winner: g.winner === null ? null : g.players[g.winner].name, cfg: g.cfg,
        players: stats(g), trips: g.trips.map(t => ({ player: g.players[t.p].name, from: t.from, to: t.to, pays: t.pays, round: t.round })), owners: g.owner };
    }

    return { M, P, newGame, rollRegion, pickRegion, rollCity, setDest, setRoute, toggleVia, clearVia, route, routeInfo, rollOrder, rollHomeStep, skipDeclare, declareHome, startBonus, canBonus, rollMove, rollMoveStep, stepOptions, stepWalk, undoWalk, autoWalk, commitWalk, walkFees, suggestedStep, optPos, move, buyRail, buyChief, canBuy, canBuyChief, endTurn, botAct, stats, tokenPos, exportLog,
      payoff, units, money, cur, allSold, regionOf, railScore, feeFor };
  }

  root.Baron = Baron;
})(typeof window !== 'undefined' ? window : globalThis);
