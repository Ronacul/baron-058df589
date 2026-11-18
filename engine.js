/* Baron engine: the rules of a Rail Baron style game. No DOM, no network.
   One map = one data object (see data-eurobaron.js). The tables inside MAP.tracker use the same shape as the
   Rail Baron tracker (cities, m = payoff matrix row by row, regions odd/even, cityTables), so game logs can feed it later.
   Rules as implemented (change them in MAP.cfg or in the functions below; assumptions are marked ASSUMED):
   - Destination: coloured die odd/even + two white dice (sum 2-12) pick a region, then a second roll picks the city in it.
     Rolling the region you are in lets you PICK any region, then the city roll is made in it.
   - Movement: 2 dice of dots a turn (3 with Super Chief). Leftover dots on arrival are lost (ASSUMED).
   - Payoff on arrival = shortest track distance in dots from where the trip started, times MAP.unit.
   - Fees, once per turn: 1K to the bank if you used any public rail; 5K (10K once every rail is sold) to each owner whose rail you used; own rails free.
   - Rails can be bought at every arrival. Super Chief can be bought at every arrival (ASSUMED).
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
    M._p = { names, idx, n, m, adj, rail, city, regionCities, railsAt };
    return M._p;
  }

  function Baron(M) {
    const P = prep(M), C = M.cfg;

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
        const home = rollHome(g);
        g.players.push({
          id: i, name: pl.name || ('Player ' + (i + 1)), bot: !!pl.bot, home, loc: home, dest: null, origin: null, path: [], h: 0, dd: 0,
          cash: g.cfg.start, sc: false, goingHome: false, trips: 0, turns: 0, gross: 0, paid: 0, received: 0, sold: 0,
          f1: 0, f5: 0, f10: 0, r5: 0, r10: 0
        });
        log(g, (pl.name || 'Player ' + (i + 1)) + ' starts in ' + home + ' with ' + money(g.cfg.start) + '.', i);
      });
      startTurn(g);
      return g;
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
      const p = cur(g); g.turnPaid = {}; g.dice = null; g.moveNote = null; g.lastMove = null; g.walk = null;
      if (p.goingHome && p.loc === p.home) { win(g, p); return; }
      if (p.dest) { g.phase = 'route'; }
      else if (p.goingHome) { setDest(g, p.home); }
      else { g.phase = 'dest'; g.stage = 'region'; g.region = null; g.needPick = false; }
    }
    function win(g, p) { g.winner = p.id; g.phase = 'over'; log(g, p.name + ' is home with ' + money(p.cash) + ' and wins on round ' + g.round + '!', p.id); }

    /* destination: step 1 = region roll */
    function rollRegion(g, manual) {
      const p = cur(g), r = tableRoll(g, manual); g.dice = { kind: 'region', ...r };
      const region = M.tracker.regions[r.parity][r.sum]; g.dice.region = region;
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
        g.dice = { kind: 'city', ...r, region: g.region, city };
        if (city !== p.loc) { setDest(g, city); return g.dice; }
      }
    }
    function setDest(g, city) {
      const p = cur(g); p.dest = city; p.origin = p.loc; p.h = 0; p.dd = 0; g.stage = 'region';
      p.via = []; g.routeMode = 'balanced'; p.path = pathFor(g, p, 'balanced'); g.phase = 'route';
      log(g, p.name + (p.goingHome ? ' heads home to ' : ' draws destination ') + city + ' (' + units(p.loc, city) + ' dots, pays ' + money(payoff(p.loc, city)) + ').', p.id);
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
      const sc = p.sc ? 10 : 7, paid = {}; let est = 0, dots = sc; const rails = [];
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
      let pick = rails.find(r => g.owner[r] === undefined);
      if (!pick) pick = rails.slice().sort((a, b) => P.rail[a].price - P.rail[b].price)[0];
      const o = g.owner[pick];
      return { key: keyOf(pick), amount: o === undefined ? C.feePublic : (allSold(g) ? C.feeAllSold : C.feePrivate), payee: o === undefined ? -1 : o, rail: pick };
    }

    /* ---------- movement ---------- */
    function rollMove(g, manualSum) {
      const p = cur(g), n = p.sc ? C.superChiefDice : C.dice, rolls = [];
      let sum = 0; if (manualSum) { sum = manualSum; } else { for (let i = 0; i < n; i++) { const v = d6(g); rolls.push(v); sum += v; } }
      g.dice = { kind: 'move', rolls, sum, manual: !!manualSum };
      return move(g, sum);
    }
    function move(g, n) {
      const p = cur(g), notes = []; let rem = n, used = 0; g.turnPaid = {}; p.turns++;
      while (rem > 0 && p.h < p.path.length) {
        const st = p.path[p.h], hop = M.hops[st.hop], take = Math.min(rem, st.dots - p.dd);
        const f = feeFor(g, p.id, hop.rails, g.turnPaid);
        if (f && !f.free) {
          g.turnPaid[f.key] = 1; p.cash -= f.amount; p.paid += f.amount;
          if (f.payee < 0) { p.f1++; notes.push('paid ' + money(f.amount) + ' to the bank (public ' + f.rail + ')'); }
          else {
            const o = g.players[f.payee]; o.cash += f.amount; o.received += f.amount;
            if (allSold(g)) { p.f10++; o.r10++; } else { p.f5++; o.r5++; }
            notes.push('paid ' + money(f.amount) + ' to ' + o.name + ' (' + f.rail + ')');
          }
        }
        p.dd += take; rem -= take; used += take;
        if (p.dd >= st.dots) { p.h++; p.dd = 0; p.loc = st.to; }
      }
      const arrived = p.h >= p.path.length;
      g.lastMove = { moved: used, rolled: n, notes, arrived };
      log(g, p.name + ' rolled ' + n + ' and moved ' + used + ' dot' + (used === 1 ? '' : 's') + (notes.length ? ': ' + notes.join('; ') : '; no fees') + '.', p.id);
      settle(g, p);
      if (arrived) arrive(g, p); else endTurn(g);
      return g.lastMove;
    }
    /* ---------- step-by-step movement: the player clicks each pip to follow, counting down the roll ---------- */
    function rollMoveStep(g, manualSum) {
      const p = cur(g), n = p.sc ? C.superChiefDice : C.dice, rolls = []; let sum = 0;
      if (manualSum) sum = manualSum; else for (let i = 0; i < n; i++) { const v = d6(g); rolls.push(v); sum += v; }
      g.dice = { kind: 'move', rolls, sum, manual: !!manualSum };
      const first = p.dd > 0 ? p.path[p.h] : null;
      g.walk = { n: sum, rem: sum, segs: [], at: first ? 'hop' : 'city', city: first ? null : p.loc, hop: first ? first.hop : null, from: first ? first.from : null, to: first ? first.to : null, dd: first ? p.dd : 0, done: false, arrived: false };
      g.phase = 'walk'; log(g, p.name + ' rolled ' + sum + ': click the pips to move.', p.id);
      return g.walk;
    }
    function stepOptions(g) {
      const w = g.walk; if (!w || w.done || w.rem <= 0) return [];
      if (w.at === 'hop') return [{ hop: w.hop, from: w.from, to: w.to, dd: w.dd + 1 }];
      return P.adj[w.city].map(e => ({ hop: e.hop, from: w.city, to: e.to, dd: 1 }));
    }
    function optPos(o) {
      const hop = M.hops[o.hop]; if (o.dd >= hop.nd) { const c = P.city[o.to]; return [c.x, c.y]; }
      const pt = hop.dotpts[(o.from === hop.a ? o.dd : hop.nd - o.dd) - 1]; return [pt[0], pt[1]];
    }
    function suggestedStep(g) { // index of the option on the planned route
      const w = g.walk, p = cur(g), opts = stepOptions(g); if (!opts.length) return -1; if (w.at === 'hop') return 0;
      const r = route(g, p.id, w.city, p.dest, g.routeMode || 'balanced'); if (!r.length) return -1;
      return opts.findIndex(o => o.hop === r[0].hop);
    }
    function stepWalk(g, i) {
      const w = g.walk, o = stepOptions(g)[i]; if (!o) return false;
      const hop = M.hops[o.hop], last = w.segs[w.segs.length - 1]; w.rem--;
      if (last && last.hop === o.hop && last.from === o.from && last.start + last.take === o.dd - 1) last.take++; else w.segs.push({ hop: o.hop, from: o.from, to: o.to, start: o.dd - 1, take: 1 });
      if (o.dd >= hop.nd) { w.at = 'city'; w.city = o.to; w.hop = null; w.from = null; w.to = null; w.dd = 0; } else { w.at = 'hop'; w.city = null; w.hop = o.hop; w.from = o.from; w.to = o.to; w.dd = o.dd; }
      if (w.at === 'city' && w.city === cur(g).dest) { w.arrived = true; w.done = true; } else if (w.rem === 0) w.done = true;
      return true;
    }
    function undoWalk(g) {
      const w = g.walk; if (!w || !w.segs.length) return false;
      const last = w.segs[w.segs.length - 1], dd = last.start + last.take - 1;
      last.take--; if (last.take === 0) w.segs.pop();
      w.rem++; w.done = false; w.arrived = false;
      if (dd === 0) { w.at = 'city'; w.city = last.from; w.hop = null; w.from = null; w.to = null; w.dd = 0; } else { w.at = 'hop'; w.city = null; w.hop = last.hop; w.from = last.from; w.to = last.to; w.dd = dd; }
      return true;
    }
    function autoWalk(g) {
      const w = g.walk; for (let k = 0; k < 40 && w && !w.done; k++) { const i = suggestedStep(g); if (!stepWalk(g, i < 0 ? 0 : i)) break; }
    }
    function walkFees(g) { // what the walk so far would cost: { notes, total }
      const w = g.walk, p = cur(g), paid = {}, notes = []; let total = 0;
      w.segs.forEach(seg => {
        const f = feeFor(g, p.id, M.hops[seg.hop].rails, paid);
        if (f && !f.free) { paid[f.key] = 1; total += f.amount; notes.push(f.payee < 0 ? 'bank ' + money(f.amount) : g.players[f.payee].name + ' ' + money(f.amount)); }
      });
      return { notes, total };
    }
    function commitWalk(g) {
      const w = g.walk, p = cur(g); if (!w || !w.done) return false;
      const notes = []; let used = 0; g.turnPaid = {}; p.turns++;
      w.segs.forEach(seg => {
        const hop = M.hops[seg.hop], f = feeFor(g, p.id, hop.rails, g.turnPaid); used += seg.take;
        if (f && !f.free) {
          g.turnPaid[f.key] = 1; p.cash -= f.amount; p.paid += f.amount;
          if (f.payee < 0) { p.f1++; notes.push('paid ' + money(f.amount) + ' to the bank (public ' + f.rail + ')'); }
          else { const o = g.players[f.payee]; o.cash += f.amount; o.received += f.amount; if (allSold(g)) { p.f10++; o.r10++; } else { p.f5++; o.r5++; } notes.push('paid ' + money(f.amount) + ' to ' + o.name + ' (' + f.rail + ')'); }
        }
      });
      const arrived = w.arrived;
      if (w.at === 'city') { p.loc = w.city; p.path = []; p.h = 0; p.dd = 0; }
      else { p.loc = w.from; p.path = [{ hop: w.hop, from: w.from, to: w.to, dots: M.hops[w.hop].nd }]; p.h = 0; p.dd = w.dd; }
      g.walk = null; g.phase = 'route';
      if (!arrived) { p.path = pathFor(g, p, g.routeMode || 'balanced'); p.h = 0; }
      g.lastMove = { moved: used, rolled: w.n, notes, arrived };
      log(g, p.name + ' moved ' + used + ' dot' + (used === 1 ? '' : 's') + ' of ' + w.n + (notes.length ? ': ' + notes.join('; ') : '; no fees') + '.', p.id);
      settle(g, p);
      if (arrived) arrive(g, p); else endTurn(g);
      return true;
    }
    function arrive(g, p) {
      p.loc = p.dest; const pay = payoff(p.origin, p.dest);
      if (p.goingHome && p.loc === p.home) { win(g, p); return; }
      p.cash += pay; p.gross += pay; p.trips++; g.trips.push({ p: p.id, from: p.origin, to: p.dest, pays: pay, round: g.round });
      log(g, p.name + ' arrives in ' + p.dest + ' from ' + p.origin + ' and collects ' + money(pay) + ' (cash ' + money(p.cash) + ').', p.id);
      p.dest = null; p.origin = null; p.path = []; p.h = 0; p.dd = 0; p.via = [];
      if (p.cash >= g.cfg.win) { p.goingHome = true; log(g, p.name + ' has ' + money(p.cash) + ': head for home (' + p.home + ') to win.', p.id); }
      g.phase = 'buy';
    }
    function settle(g, p) { // negative cash: sell rails to the bank at half price, cheapest first
      while (p.cash < 0) {
        const mine = M.rails.filter(r => g.owner[r.code] === p.id).sort((a, b) => a.price - b.price);
        if (!mine.length) break;
        const r = mine[0]; delete g.owner[r.code]; const v = Math.round(r.price * M.unit / 2); p.cash += v; p.sold++;
        log(g, p.name + ' is short of cash and sells ' + r.code + ' to the bank for ' + money(v) + '.', p.id);
      }
    }

    /* ---------- buying ---------- */
    function canBuy(g, pi, code) { const r = P.rail[code]; return g.phase === 'buy' && g.owner[code] === undefined && g.players[pi].cash >= r.price * M.unit; }
    function buyRail(g, pi, code) {
      if (!canBuy(g, pi, code)) return false;
      const p = g.players[pi], r = P.rail[code]; p.cash -= r.price * M.unit; g.owner[code] = pi;
      log(g, p.name + ' buys ' + r.code + ' (' + r.name + ') for ' + money(r.price * M.unit) + '.', pi);
      return true;
    }
    function canBuyChief(g, pi) { const p = g.players[pi]; return g.phase === 'buy' && !p.sc && g.cfg.superChief > 0 && p.cash >= g.cfg.superChief; }
    function buyChief(g, pi) {
      if (!canBuyChief(g, pi)) return false;
      const p = g.players[pi]; p.cash -= g.cfg.superChief; p.sc = true; log(g, p.name + ' buys the Super Chief for ' + money(g.cfg.superChief) + ' (3 dice a turn).', pi); return true;
    }
    function endTurn(g) {
      if (g.phase === 'over') return;
      g.turn = (g.turn + 1) % g.players.length; if (g.turn === 0) g.round++;
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
      if (!p.sc && g.cfg.superChief > 0 && p.cash >= g.cfg.superChief + 0.5 * C.meanPay) buyChief(g, p.id);
      for (let guard = 0; guard < 40; guard++) {
        if (p.cash >= g.cfg.win) return;
        const open = M.rails.filter(r => g.owner[r.code] === undefined); if (!open.length) return;
        const gmax = Math.max.apply(null, open.map(railScore));
        let best = null, bs = -1;
        open.forEach(r => { if (r.price * M.unit > p.cash - C.meanPay) return; const sc = railScore(r); if (sc < THR * gmax) return; if (sc > bs) { bs = sc; best = r; } });
        if (!best) return; buyRail(g, p.id, best.code);
      }
    }
    /* one bot action per call, so the page can show each step */
    function botAct(g) {
      const p = cur(g); if (!p.bot || g.phase === 'over') return null;
      if (g.phase === 'dest') {
        if (g.stage === 'region') { rollRegion(g); return 'rolls the destination'; }
        if (g.stage === 'pick') { pickRegion(g, botPickRegion(g, p)); return 'chooses a region'; }
        if (g.stage === 'city') { rollCity(g); return 'rolls the city'; }
      }
      if (g.phase === 'route') { rollMove(g); return 'moves'; }
      if (g.phase === 'buy') { botBuy(g, p); endTurn(g); return 'ends the turn'; }
      return null;
    }

    function stats(g) {
      return g.players.map(p => ({
        name: p.name, bot: p.bot, cash: p.cash, trips: p.trips, avg: p.trips ? p.gross / p.trips : 0, turns: p.turns, gross: p.gross, paid: p.paid, received: p.received,
        rails: M.rails.filter(r => g.owner[r.code] === p.id).map(r => r.code), sc: p.sc, f1: p.f1, f5: p.f5, f10: p.f10
      }));
    }
    function tokenPos(g, p) { // [x,y] on the map for a player
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

    return { M, P, newGame, rollRegion, pickRegion, rollCity, setDest, setRoute, toggleVia, clearVia, route, routeInfo, rollMove, rollMoveStep, stepOptions, stepWalk, undoWalk, autoWalk, commitWalk, walkFees, suggestedStep, optPos, move, buyRail, buyChief, canBuy, canBuyChief, endTurn, botAct, stats, tokenPos, exportLog,
      payoff, units, money, cur, allSold, regionOf, railScore, feeFor };
  }

  root.Baron = Baron;
})(typeof window !== 'undefined' ? window : globalThis);
