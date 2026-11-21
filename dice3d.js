/* Jamb 3D dice: CSS cubes that tumble onto the number the server rolled, with a ticking sound as faces turn over, staggered
 * landings and a small bounce. No DOM knowledge of the game: the page hands it the dice values and says which ones to roll.
 *   Dice3D.sync(box, values, { anim:[bool x6], mode:'full'|'quick'|'off' })
 * The cubes are kept between calls (rebuilding them would cancel a tumble), so call sync() instead of rewriting the HTML.
 * Colours come from the CSS variables --die, --pip and --edge on the box, as the flat dice used. */
(function (root) {
  'use strict';
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  // cube rotation [x, y] that brings each face to the front
  const SHOW = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };
  const FACE = { 1: '', 6: 'rotateY(180deg)', 2: 'rotateY(90deg)', 5: 'rotateY(-90deg)', 3: 'rotateX(90deg)', 4: 'rotateX(-90deg)' };

  const CSS = `
.d3 .die{background:none;border:0;box-shadow:none;perspective:calc(var(--s,50px)*5);transform-style:flat;overflow:visible}
.d3 .die:disabled{opacity:1}
.d3 .cube{position:absolute;inset:0;margin:auto;width:var(--s,50px);height:var(--s,50px);transform-style:preserve-3d;will-change:transform}
.d3 .f{position:absolute;inset:0;border-radius:20%;backface-visibility:hidden;-webkit-backface-visibility:hidden;
  background:linear-gradient(135deg,rgba(255,255,255,.38),rgba(255,255,255,0) 45%,rgba(0,0,0,.16)),var(--die,#fff);
  box-shadow:inset 0 0 0 1px var(--edge,rgba(0,0,0,.22)),inset 0 -3px 6px rgba(0,0,0,.12)}
.d3 .f i{position:absolute;width:19%;height:19%;border-radius:50%;background:var(--pip,#25221c);transform:translate(-50%,-50%);
  box-shadow:inset 0 1px 2px rgba(0,0,0,.35)}
.d3 .die.blank .f i{opacity:0}
.d3 .die.dim .cube{opacity:.38}
.d3 .die.held .f{box-shadow:inset 0 0 0 3px var(--hold,#e9b949),inset 0 -3px 6px rgba(0,0,0,.12)}
.d3 .die.pick .f{box-shadow:inset 0 0 0 3px var(--ok,#2f7d4f),inset 0 -3px 6px rgba(0,0,0,.12)}
.d3 .die.air{animation:d3hop var(--hop,900ms) cubic-bezier(.3,0,.3,1) var(--dl,0ms)}
.d3 .die.land{animation:d3land .2s ease-out}
.d3 .die::before{content:"";position:absolute;left:14%;right:14%;bottom:-3px;height:8px;border-radius:50%;background:rgba(0,0,0,.22);filter:blur(3px);transition:opacity .2s}
.d3 .die.air::before{opacity:.35}
@keyframes d3hop{0%{transform:translateY(0) scale(1)}28%{transform:translateY(-16%) scale(1.14)}100%{transform:translateY(0) scale(1)}}
@keyframes d3land{0%{transform:translateY(0)}35%{transform:translateY(-5%)}70%{transform:translateY(0)}85%{transform:translateY(-1.5%)}100%{transform:translateY(0)}}
@media (prefers-reduced-motion:reduce){.d3 .die.air,.d3 .die.land{animation:none}}`;
  let cssDone = false;
  function injectCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.textContent = CSS; document.head.appendChild(s); }

  const cubeHtml = () => '<div class="cube">' + [1, 2, 3, 4, 5, 6].map(n =>
    `<div class="f" style="transform:${FACE[n]} translateZ(calc(var(--s,50px)/2))">` +
    PIPS[n].map(p => `<i style="left:${[24, 50, 76][p % 3]}%;top:${[24, 50, 76][Math.floor(p / 3)]}%"></i>`).join('') + '</div>').join('') + '</div>';

  // sound: the page can set Dice3D.audio = () => an AudioContext that is allowed to play (or null)
  let lastClick = 0;
  function click(strength) {
    const ctx = root.Dice3D.audio && root.Dice3D.audio(); if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime; if (now - lastClick < 0.022) return; lastClick = now;     // many dice at once should rattle, not buzz
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'square'; o.frequency.setValueAtTime(1500 + Math.random() * 700, now); o.frequency.exponentialRampToValueAtTime(600, now + 0.02);
    g.gain.setValueAtTime(0.045 * strength, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    o.connect(g); g.connect(ctx.destination); o.start(now); o.stop(now + 0.04);
  }
  function thud() {
    const ctx = root.Dice3D.audio && root.Dice3D.audio(); if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(190, now); o.frequency.exponentialRampToValueAtTime(70, now + 0.09);
    g.gain.setValueAtTime(0.16, now); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    o.connect(g); g.connect(ctx.destination); o.start(now); o.stop(now + 0.14);
  }

  function ensure(box, n) {
    injectCss(); box.classList.add('d3');
    while (box.children.length < n) {
      const b = document.createElement('button'); b.className = 'die blank'; b.type = 'button';
      b.innerHTML = cubeHtml(); b._st = { x: 0, y: 0, v: 0, timers: [] }; box.appendChild(b);
    }
  }
  function setSize(box) { const d = box.firstElementChild; if (d) box.style.setProperty('--s', Math.round(d.clientWidth * 0.84) + 'px'); }

  function place(el, v) {                                    // show value v at once, no movement
    const c = el.firstElementChild, st = el._st; st.timers.forEach(clearTimeout); st.timers = [];
    el.classList.remove('air', 'land'); el.classList.toggle('blank', !v);
    const [bx, by] = SHOW[v || 1];
    const fix = (cur, base) => base + 360 * Math.round((cur - base) / 360);
    st.x = fix(st.x, bx); st.y = fix(st.y, by); st.v = v; el.dataset.v = v || 0;
    if (c.getAnimations) c.getAnimations().forEach(a => a.cancel());
    c.style.transition = 'none'; c.style.transform = `rotateX(${st.x}deg) rotateY(${st.y}deg)`;
  }

  function tumble(el, v, i, mode, angst) {
    const c = el.firstElementChild, st = el._st; st.timers.forEach(clearTimeout); st.timers = [];
    const quick = mode === 'quick', [bx, by] = SHOW[v];
    const spins = quick ? 1 : 2 + (Math.random() * 2 | 0);
    const ahead = (cur, base, extra) => { let t = base + 360 * Math.ceil((cur - base) / 360); if (t < cur + 120) t += 360; return t + 360 * extra; };
    const sx = st.x, sy = st.y;
    const tx = ahead(st.x, bx, spins), ty = ahead(st.y, by, quick ? 0 : spins - 1 + (Math.random() * 2 | 0));
    // full: every die lands at its own time, so they finish in no particular order; the "angst" dice take far longer
    const sp = (root.Dice3D && root.Dice3D.speed) || 1; // 1 = the relaxed original, smaller = brisker
    const dur = (quick ? 520 : angst ? 1900 + Math.random() * 900 : 950 + Math.random() * 700) * sp, dl = (quick ? i * 28 : Math.random() * 130) * sp;
    el.classList.remove('blank', 'land', 'air'); void el.offsetWidth;
    el.style.setProperty('--hop', Math.round(dur * (quick ? 1 : 0.42)) + 'ms'); el.style.setProperty('--dl', dl + 'ms'); el.classList.add('air');
    const f = (x, y) => `rotateX(${x}deg) rotateY(${y}deg)`;
    let off1 = 1, off2 = 1;                                  // where the quick tumble ends and the slow roll-over begins/ends (fractions of dur)
    if (c.getAnimations) c.getAnimations().forEach(a => a.cancel());
    if (quick) {
      c.style.transition = `transform ${dur}ms cubic-bezier(.12,.72,.2,1) ${dl}ms`;
    } else {
      // tumble fast, slow right down a quarter-turn short, creep towards the edge, hang there, then tip over onto the number
      c.style.transition = 'none';
      const ax = Math.random() < 0.5, pre = ax ? [tx - 90, ty] : [tx, ty - 90], mid = ax ? [tx - 26, ty] : [tx, ty - 26];
      off1 = angst ? 0.42 : 0.6; off2 = angst ? 0.9 : 0.9;
      c.animate([
        { transform: f(sx, sy), offset: 0, easing: 'cubic-bezier(.12,.72,.2,1)' },
        { transform: f(pre[0], pre[1]), offset: off1, easing: angst ? 'cubic-bezier(.25,.05,.7,.95)' : 'cubic-bezier(.3,.1,.6,.9)' },
        { transform: f(mid[0], mid[1]), offset: off2, easing: 'cubic-bezier(.55,0,1,.65)' },
        { transform: f(tx, ty), offset: 1 }], { duration: dur, delay: dl, fill: 'backwards' });
    }
    c.style.transform = f(tx, ty);                           // the resting pose (a transition or the animation above gets it there)
    // a tick each time a face turns over, slowing down as the cube does; the roll-over gets a slow tick, then the thud
    const turns = Math.min(14, Math.round(Math.max(tx - sx, ty - sy) / 90)), span = dur * (quick ? 0.96 : off1);
    for (let k = 1; k <= turns; k++) st.timers.push(setTimeout(() => click(0.8 + 0.4 * (k / turns)), dl + span * (1 - Math.pow(1 - k / turns, 1 / 3))));
    if (!quick) {
      st.timers.push(setTimeout(() => click(1.3), dl + dur * (off1 + (off2 - off1) * 0.55)));
      st.timers.push(setTimeout(() => click(1.5), dl + dur * (off2 + 0.04)));
    }
    st.timers.push(setTimeout(() => {
      el.classList.remove('air'); void el.offsetWidth; el.classList.add('land'); thud();
      try { navigator.vibrate && navigator.vibrate(12); } catch (e) {}
    }, dl + dur));
    st.timers.push(setTimeout(() => el.classList.remove('land'), dl + dur + 260));
    st.x = tx; st.y = ty; st.v = v; el.dataset.v = v;
  }

  function sync(box, values, o) {
    o = o || {}; const mode = o.mode || 'full', anim = o.anim || [];
    ensure(box, values.length); setSize(box);
    const rolling = values.map((v, i) => i).filter(i => anim[i] && values[i]), slow = new Set();     // two dice (one if few roll) hang on much longer
    while (slow.size < Math.min(rolling.length > 3 ? 2 : 1, rolling.length)) slow.add(rolling[Math.random() * rolling.length | 0]);
    values.forEach((v, i) => {
      const el = box.children[i];
      if (v && (anim[i] || el._st.v !== v)) { if (anim[i] && mode !== 'off') tumble(el, v, i, mode, slow.has(i)); else place(el, v); }
      else if (!v && el._st.v) place(el, 0);
    });
  }
  root.Dice3D = { sync, audio: null, SHOW, resize: setSize, speed: 1 };
})(globalThis);
