// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Garden scenes: flowers, leaves and gardens, built on 1 shared flower toolkit.
(() => {
  const TAU = Math.PI * 2;

  // ---------- color ----------

  // A palette color at the OKLCH lightness L, with its chroma times cx.
  const tone = (hex, L, cx = 1) => adjust(hex, { L: L - toOklch(hex).L, Cx: cx });
  // The hue of a palette color at the OKLCH lightness L and chroma C.
  const hue = (hex, L, C) => adjust(hex, { L: L - toOklch(hex).L, Cx: 0, C });
  const shade = (hex, t) => mixHex(hex, '#000000', t);
  const tint = (hex, t) => mixHex(hex, '#ffffff', t);

  // ---------- random ----------

  const R = (r, a, b) => a + (b - a) * r();
  const pick = (r, list) => list[Math.floor(r() * list.length)];
  const jit = (r, a) => (r() - .5) * 2 * a;

  // ---------- vectors ----------

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = a => { const d = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / d, a[1] / d, a[2] / d]; };

  // ---------- layers ----------

  // Output pixels per logical unit of a context.
  const kOf = ctx => ctx.k || S;

  // A canvas at a lower resolution, for soft layers that get a blur.
  function soft(k = .6) {
    const s = Math.min(S, k), c = document.createElement('canvas');
    c.width = Math.ceil(W * s); c.height = Math.ceil(H * s);
    const x = c.getContext('2d');
    x.scale(s, s);
    x.k = s;
    return { c, x, s };
  }
  // Draws a soft layer over ctx with a blur of px logical units. band limits
  // the work to the rows from band[0] to band[1].
  function put(ctx, L, px = 0, alpha = 1, op = 'source-over', band = null) {
    let src = L.c;
    if (px > 0) {
      const d = document.createElement('canvas');
      d.width = L.c.width; d.height = L.c.height;
      const dx = d.getContext('2d');
      dx.filter = `blur(${(px * L.s).toFixed(2)}px)`;
      dx.drawImage(L.c, 0, 0);
      src = d;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (band) {
      const y0 = clamp(band[0], 0, H), y1 = clamp(band[1], 0, H), f = ctx.canvas.height / H;
      ctx.drawImage(src, 0, y0 * L.s, src.width, (y1 - y0) * L.s, 0, y0 * f, ctx.canvas.width, (y1 - y0) * f);
    } else ctx.drawImage(src, 0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  function shadowOn(ctx, col, blur, dx = 0, dy = 0) {
    const k = kOf(ctx);
    ctx.shadowColor = col; ctx.shadowBlur = blur * k; ctx.shadowOffsetX = dx * k; ctx.shadowOffsetY = dy * k;
  }
  function shadowOff(ctx) { ctx.shadowColor = 'rgba(0,0,0,0)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0; }

  // ---------- paths ----------

  // Points along a cubic Bezier curve.
  function bez(p0, p1, p2, p3, n = 24) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
    }
    return out;
  }
  function trace(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
  function line(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }
  // A band along the points, w0 wide at the start and w1 wide at the end.
  function ribbon(ctx, pts, w0, w1) {
    const n = pts.length, a = [], b = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[Math.min(n - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dy = q[1] - o[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = lerp(w0, w1, i / (n - 1)) / 2;
      a.push([p[0] - dy * w, p[1] + dx * w]); b.push([p[0] + dy * w, p[1] - dx * w]);
    }
    ctx.moveTo(a[0][0], a[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(a[i][0], a[i][1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(b[i][0], b[i][1]);
    ctx.closePath();
  }
  // Moves points sideways by d logical units, to the left of the direction of travel.
  function offset(pts, d) {
    return pts.map((p, i) => {
      const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)];
      let dx = q[0] - o[0], dy = q[1] - o[1];
      const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      return [p[0] + dy * d, p[1] - dx * d];
    });
  }

  // ---------- petal outlines ----------

  // Half width of a petal at s in [0, 1]. The petal is widest at belly. A
  // round value below 1 gives a blunt tip, above 1 a sharp tip.
  function profile(s, belly = .55, round = .7) {
    if (s <= 0 || s >= 1) return 0;
    return Math.sin(Math.PI * s ** (Math.log(.5) / Math.log(belly))) ** round;
  }
  // The outline of a flat petal with its base at the origin and its tip at len
  // on the x axis.
  function outline(len, wid, o = {}) {
    const { belly = .55, round = .7, n = 20, ruffle = 0, rf = 6, ph = 0, asym = 0, scallop = 0, sf = 7 } = o;
    const pts = [];
    for (let i = 0; i <= n; i++) { const s = 1 - (1 - i / n) ** 1.5; pts.push([s * len, -wid * profile(s, belly, round) * (1 + asym)]); }
    for (let i = n - 1; i > 0; i--) { const s = 1 - (1 - i / n) ** 1.5; pts.push([s * len, wid * profile(s, belly, round) * (1 - asym)]); }
    if (!ruffle && !scallop) return pts;
    const m = pts.length;
    return pts.map((p, i) => {
      const a = pts[(i - 1 + m) % m], b = pts[(i + 1) % m];
      let nx = b[1] - a[1], ny = a[0] - b[0];
      const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
      const u = i / m, env = smooth(clamp((p[0] / len - .2) / .6, 0, 1));
      let k = ruffle * (Math.sin(u * rf * TAU + ph) * .65 + Math.sin(u * rf * 2.37 * TAU + ph * 1.7) * .35);
      if (scallop) k += scallop * (Math.abs(Math.sin(u * sf * Math.PI + ph)) - .6);
      return [p[0] + nx * k * wid * env, p[1] + ny * k * wid * env];
    });
  }

  // ---------- 3D flowers ----------

  // A view of a flower. e is the elevation: 0 looks from the side, PI / 2 from
  // straight above. roll turns the picture. light is [right, down, toward the
  // viewer], in picture terms.
  function view(e, roll = 0, light = [-.4, -.7, .3]) {
    const se = Math.sin(e), ce = Math.cos(e), sr = Math.sin(roll), cr = Math.cos(roll);
    const [lx, ly, lz] = light;
    return {
      e, cam: [0, ce, se],
      light: unit([lx, ly * se + lz * ce, -ly * ce + lz * se]),
      sd: unit([-lx, -ly, 0]),
      p: (u, v, w) => { const Y = v * se - w * ce; return [u * cr - Y * sr, u * sr + Y * cr]; },
      depth: (u, v, w) => v * ce + w * se,
    };
  }
  // Bends a flat petal into flower space. The petal leaves the axis at angle th
  // and follows its spine, a function of s that returns [out, up] in units of
  // its length.
  function warp(pt) {
    const { th = 0, r0 = 0, len = 1, wid = .4, spine, cross = 0, wave = 0, wf = 3, wph = 0 } = pt;
    const c = Math.cos(th), s = Math.sin(th);
    const sp = spine || (q => [q, 0]);
    return (x, T) => {
      const q = x / len, a = sp(q), b = sp(Math.min(1, q + .01));
      let dr = b[0] - a[0], dh = b[1] - a[1];
      const dl = Math.hypot(dr, dh) || 1; dr /= dl; dh /= dl;
      if (q >= .99) { const z = sp(.98); dr = a[0] - z[0]; dh = a[1] - z[1]; const zl = Math.hypot(dr, dh) || 1; dr /= zl; dh /= zl; }
      const k = cross * T * T / wid + wave * len * q * q * Math.sin(T / wid * wf + wph + q * 2);
      const rad = r0 + a[0] * len - dh * k, w = a[1] * len + dr * k;
      return [rad * c - T * s, rad * s + T * c, w];
    };
  }
  // A small hash for repeatable texture inside 1 petal.
  const hash = (a, b) => { const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return x - Math.floor(x); };
  // Draws 1 petal of a blossom with a gradient from base to tip, light and
  // shade from its normal, pleats, veins, a sheen and a lit edge.
  function paintPetal(ctx, pt, f, proj, v, size, o) {
    const pts = outline(pt.len, pt.wid, pt).map(([a, b]) => proj(...f(a, b)));
    const path = new Path2D();
    if (pt.n && pt.n < 9) trace(path, pts); else smoothPath(path, pts, true);
    const m = pt.len * .5, e = pt.len * .03;
    const nrm = unit(cross3(sub(f(m + e, 0), f(m - e, 0)), sub(f(m, e), f(m, -e))));
    const facing = dot(nrm, v.cam), nv = facing >= 0 ? nrm : nrm.map(x => -x);
    const lit = dot(nv, v.light);
    const k = clamp(.55 + .55 * lit, 0, 1), glow = clamp(-lit * 1.3, 0, 1) * (pt.trans ?? o.trans ?? 0);
    const dark = o.dark || '#000000', amt = o.shadeAmt ?? .5;
    const stops = (facing >= 0 ? pt.c : (pt.cb || pt.c)).map(([at, hex]) => [at, mixHex(mixHex(hex, dark, (1 - k) * amt), o.glowCol || hex, glow * .6)]);
    const [bx, by] = proj(...f(0, 0));
    let [tx, ty] = proj(...f(pt.len, 0));
    if (Math.hypot(tx - bx, ty - by) < .5) tx += .5;
    if (o.shadow) shadowOn(ctx, o.shadow, size * (o.sblur ?? .06), v.sd[0] * size * (o.soff ?? .025), v.sd[1] * size * (o.soff ?? .025));
    ctx.fillStyle = linear(ctx, bx, by, tx, ty, stops);
    ctx.fill(path);
    shadowOff(ctx);
    const veins = pt.veins || 0, pleat = pt.pleat ?? o.pleat ?? 0;
    if (veins || o.sheen || pleat) {
      ctx.save();
      ctx.clip(path);
      if (pleat) {
        // Streaks that fan out from the base, like folds in silk.
        const g = ctx.createConicGradient(Math.atan2(ty - by, tx - bx) + Math.PI, bx, by), n = pt.pn || 90, sd = pt.ph || 1;
        for (let i = 0; i <= n; i++) {
          const q = i === n ? hash(0, sd) : hash(i, sd);
          g.addColorStop(i / n, q < .5 ? rgba(dark, pleat * (.5 - q) * 2) : rgba(o.pleatCol || '#ffffff', pleat * .5 * (q - .5) * 2));
        }
        ctx.fillStyle = g; ctx.fill(path);
      }
      if (o.sheen) {
        const [hx, hy] = proj(...f(pt.len * .62, 0));
        const rad = pt.len * size * .5;
        ctx.fillStyle = radial(ctx, hx, hy, 0, rad, [[0, rgba(o.sheenCol || '#ffffff', o.sheen * k)], [1, rgba(o.sheenCol || '#ffffff', 0)]]);
        ctx.fillRect(hx - rad, hy - rad, rad * 2, rad * 2);
      }
      if (veins) {
        const vp = new Path2D();
        for (let i = 0; i < veins; i++) {
          const tv = ((i + .5) / veins) * 2 - 1, q = [];
          for (let j = 0; j <= 10; j++) {
            const s = .04 + j / 10 * ((pt.veinEnd ?? .9) - .1 * Math.abs(tv));
            q.push(proj(...f(s * pt.len, tv * pt.wid * profile(Math.max(s, .3), pt.belly ?? .55, pt.round ?? .7) * .92)));
          }
          line(vp, q);
        }
        ctx.lineWidth = Math.max(.35, size * (pt.veinW ?? .006));
        ctx.strokeStyle = rgba(pt.veinCol || dark, (pt.veinA ?? .14) * (facing >= 0 ? 1 : .6));
        ctx.stroke(vp);
      }
      if (o.rim && !pt.noRim) {
        // A lit edge on the side that faces the light.
        const [cx, cy] = proj(...f(pt.len * .55, 0)), rad = pt.len * size * .7, lx = -v.sd[0], ly = -v.sd[1];
        const a = (o.rimA ?? .5) * (.4 + .6 * Math.max(k, glow));
        ctx.strokeStyle = linear(ctx, cx - lx * rad, cy - ly * rad, cx + lx * rad, cy + ly * rad, [[0, rgba(o.rim, 0)], [.5, rgba(o.rim, a * .2)], [1, rgba(o.rim, a)]]);
        ctx.lineWidth = Math.max(.7, size * (o.rimW ?? .012) * 2);
        ctx.stroke(path);
      }
      ctx.restore();
    } else if (o.rim && !pt.noRim) {
      ctx.lineWidth = Math.max(.4, size * (o.rimW ?? .012));
      ctx.strokeStyle = rgba(o.rim, (o.rimA ?? .5) * (.35 + .65 * k));
      ctx.stroke(path);
    }
  }
  // Draws petals and extra parts of 1 flower from back to front. extras are
  // objects with a depth d and a draw function that gets ctx, proj and size.
  function blossom(ctx, x, y, size, v, petals, extras = [], o = {}) {
    const proj = (u, w2, w) => { const [X, Y] = v.p(u, w2, w); return [x + X * size, y + Y * size]; };
    const items = petals.map(pt => {
      const f = warp(pt);
      return { d: v.depth(...f(pt.len * .55, 0)) + (pt.dz || 0), draw: () => paintPetal(ctx, pt, f, proj, v, size, o) };
    });
    for (const e of extras) items.push({ d: e.d, draw: () => e.draw(ctx, proj, size) });
    items.sort((a, b) => a.d - b.d).forEach(it => it.draw());
    return proj;
  }

  // ---------- leaves, stems and grass ----------

  // A leaf from the point x, y along angle a. c holds light, dark and vein colors. The
  // lower half is darker, as if the leaf folds along its midrib.
  function leaf2(ctx, x, y, a, len, wid, c, o = {}) {
    const { bend = 0, belly = .42, round = 1.15, serr = 0, teeth = 14, veins = 6, fold = .22, n = 22, shadow, rimA = .25, veinA = .35 } = o;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    const mid = s => bend * len * s * s;
    const top = [], bot = [];
    for (let i = 0; i <= n; i++) {
      const s = i / n, w = wid * profile(s, belly, round);
      const z = serr ? serr * wid * (1 - Math.abs(((s * teeth) % 1) * 2 - 1)) * smooth(clamp(s * 4, 0, 1)) * (1 - s * .5) : 0;
      top.push([s * len, mid(s) - w - z]); bot.push([s * len, mid(s) + w + z]);
    }
    const path = new Path2D();
    path.moveTo(0, 0);
    top.forEach(p => path.lineTo(p[0], p[1]));
    for (let i = n; i >= 0; i--) path.lineTo(bot[i][0], bot[i][1]);
    path.closePath();
    if (shadow) shadowOn(ctx, shadow, len * .08, len * .015, len * .03);
    ctx.fillStyle = linear(ctx, 0, 0, len, 0, [[0, c.dark], [.6, c.light], [1, c.tip || c.light]]);
    ctx.fill(path);
    shadowOff(ctx);
    ctx.save();
    ctx.clip(path);
    // The lower half sits in shade.
    const half = new Path2D();
    half.moveTo(0, 0);
    for (let i = 0; i <= n; i++) half.lineTo(i / n * len, mid(i / n));
    half.lineTo(len, wid * 3); half.lineTo(0, wid * 3); half.closePath();
    ctx.fillStyle = rgba(c.shade || '#000000', fold);
    ctx.fill(half);
    // Midrib and side veins.
    ctx.strokeStyle = rgba(c.vein, veinA);
    ctx.lineWidth = Math.max(.4, wid * .07);
    ctx.beginPath(); ctx.moveTo(0, 0);
    for (let i = 1; i <= 12; i++) ctx.lineTo(i / 12 * len * .96, mid(i / 12 * .96));
    ctx.stroke();
    ctx.lineWidth = Math.max(.3, wid * .035);
    ctx.beginPath();
    for (let i = 1; i <= veins; i++) {
      const s = i / (veins + 1) * .85, x0 = s * len, y0 = mid(s);
      for (const sd of [-1, 1]) {
        const x1 = x0 + len * .22, y1 = mid(Math.min(1, s + .22)) + sd * wid * profile(Math.min(.99, s + .22), belly, round) * .85;
        ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + len * .1, y0 + sd * wid * .35, x1, y1);
      }
    }
    ctx.stroke();
    ctx.restore();
    if (rimA) { ctx.lineWidth = Math.max(.4, wid * .04); ctx.strokeStyle = rgba(c.rim || c.light, rimA); ctx.stroke(path); }
    ctx.restore();
  }
  // A tapered stem along a curve, with a light edge.
  function stem(ctx, pts, w0, w1, col, hi, hiA = .45) {
    ctx.beginPath(); ribbon(ctx, pts, w0, w1);
    ctx.fillStyle = col; ctx.fill();
    if (hi) {
      ctx.beginPath(); ribbon(ctx, offset(pts, -w0 * .22), w0 * .28, w1 * .2);
      ctx.fillStyle = rgba(hi, hiA); ctx.fill();
    }
  }
  // A grass blade from the point x, y, h tall, leaning by lean.
  function blade(ctx, x, y, h, lean, w) {
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x - w / 2 + lean * .2, y - h * .6, x + lean, y - h);
    ctx.quadraticCurveTo(x + w / 2 + lean * .25, y - h * .55, x + w / 2, y);
    ctx.closePath();
  }

  // ---------- sky and light ----------

  function glow(ctx, x, y, r0, r1, col, a) {
    ctx.fillStyle = radial(ctx, x, y, r0, r1, [[0, rgba(col, a)], [.35, rgba(col, a * .35)], [1, rgba(col, 0)]]);
    ctx.fillRect(0, 0, W, H);
  }
  // A moon with a soft halo and faint seas.
  function moon(ctx, x, y, rad, col, halo, r) {
    glow(ctx, x, y, rad * .9, rad * 9, halo, .22);
    glow(ctx, x, y, rad * .9, rad * 2.6, halo, .3);
    ctx.fillStyle = radial(ctx, x - rad * .3, y - rad * .3, rad * .1, rad * 1.1, [[0, tint(col, .35)], [1, col]]);
    ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
    ctx.save();
    ctx.beginPath(); circle(ctx, x, y, rad); ctx.clip();
    for (let i = 0; i < 7; i++) {
      const a = r() * TAU, d = r() * rad * .6;
      ctx.fillStyle = rgba(shade(col, .4), .08 + r() * .08);
      ctx.beginPath(); ellipse(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, rad * R(r, .15, .35), rad * R(r, .12, .28), r() * 3); ctx.fill();
    }
    ctx.restore();
  }
  // Soft disks of light, as from a lens out of focus.
  function bokeh(ctx, x, y, rad, col, a) {
    ctx.fillStyle = radial(ctx, x, y, 0, rad, [[0, rgba(col, a * .7)], [.82, rgba(col, a)], [.94, rgba(col, a * .8)], [1, rgba(col, 0)]]);
    ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
  }
  // A glow: the draw function paints shapes on a small layer that is blurred
  // and added on top, once for each radius.
  function haloes(ctx, draw, radii = [40, 10], strength = [.6, .8], k = .4, band = null) {
    const L = soft(k);
    draw(L.x);
    radii.forEach((rad, i) => put(ctx, L, rad, strength[i], 'lighter', band));
  }
  function finish(ctx, P, r, vig, g = .04) {
    if (vig) vignette(ctx, P, vig);
    grain(ctx, Math.floor(r() * 1e9), g);
  }

  // ---------- garden/poppies ----------

  function poppyCenter(ctx, proj, size, C, r, lod) {
    const ring = lod > 1 ? 64 : lod > 0 ? 22 : 0, st = [];
    for (let i = 0; i < ring; i++) {
      const a = i / ring * TAU + jit(r, .05), r2 = .14 + r() * .09, h = .1 + r() * .08;
      st.push({ back: Math.sin(a) < 0, b: proj(Math.cos(a) * .06, Math.sin(a) * .06, .05), t: proj(Math.cos(a) * r2, Math.sin(a) * r2, h) });
    }
    const drawSt = back => {
      if (!ring) return;
      ctx.strokeStyle = C.stamen; ctx.lineWidth = Math.max(.35, size * .006);
      ctx.beginPath();
      st.filter(s => s.back === back).forEach(s => { ctx.moveTo(s.b[0], s.b[1]); ctx.lineTo(s.t[0], s.t[1]); });
      ctx.stroke();
      ctx.fillStyle = C.anther;
      ctx.beginPath();
      st.filter(s => s.back === back).forEach(s => circle(ctx, s.t[0], s.t[1], Math.max(.5, size * .014)));
      ctx.fill();
    };
    drawSt(true);
    const ringPts = (rad, h, wob) => Array.from({ length: 28 }, (_, i) => { const a = i / 28 * TAU, q = rad * (1 + wob * Math.cos(a * 9)); return proj(Math.cos(a) * q, Math.sin(a) * q, h); });
    const low = ringPts(.075, .04, 0), top = ringPts(.09, .17, .07);
    ctx.fillStyle = C.pod;
    ctx.beginPath(); trace(ctx, low); ctx.fill();
    ctx.beginPath(); poly(ctx, [low[0], top[0], top[14], low[14]]); ctx.fill();
    const [cx, cy] = proj(0, 0, .175);
    ctx.fillStyle = radial(ctx, cx, cy, 0, size * .1, [[0, C.podTop], [1, C.pod]]);
    ctx.beginPath(); trace(ctx, top); ctx.fill();
    ctx.strokeStyle = C.ray; ctx.lineWidth = Math.max(.4, size * .01);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; ctx.moveTo(cx, cy); const p = proj(Math.cos(a) * .085, Math.sin(a) * .085, .17); ctx.lineTo(p[0], p[1]); }
    ctx.stroke();
    drawSt(false);
  }
  // A poppy: 4 broad cupped petals around a seed head and a ring of stamens.
  function poppy(ctx, x, y, size, v, C, r, lod = 2, o = {}) {
    const petals = [], th0 = r() * TAU;
    for (let i = 0; i < 4; i++) {
      const outer = i % 2 === 0, th = th0 + i * TAU / 4 + jit(r, .18);
      const cup = (outer ? .32 : .55) + jit(r, .08), len = (outer ? 1 : .86) * R(r, .92, 1.06);
      petals.push({
        th, r0: .03, len, wid: outer ? .68 : .6, belly: .64, round: .42, n: lod > 1 ? 28 : lod > 0 ? 12 : 7,
        spine: s => [s - .1 * s * s, cup * s * s + .08 * s], cross: .12,
        ruffle: lod > 1 ? .07 : .03, rf: 3 + r() * 3, ph: r() * 9, wave: lod > 1 ? .05 : 0, wf: 5 + r() * 3, wph: r() * 6,
        c: C.inner, cb: C.outer, veins: lod > 1 ? 26 : 0, veinA: .1, veinW: .004, trans: C.trans,
      });
    }
    const extras = lod >= 0 ? [{ d: v.depth(0, 0, .15), draw: (c, proj, sz) => poppyCenter(c, proj, sz, C, r, lod) }] : [];
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }
  // A nodding poppy bud on a hooked stem.
  function poppyBud(ctx, x, y, size, a, C, r, open = 0) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(a);
    const L = size, Wd = size * .36;
    if (open > 0) {
      ctx.fillStyle = linear(ctx, 0, 0, 0, L, [[0, C.inner[2][1]], [1, C.inner[4][1]]]);
      ctx.beginPath(); ellipse(ctx, Wd * .35, L * .62, Wd * .55 * open + Wd * .2, L * .42, .15); ctx.fill();
    }
    ctx.fillStyle = linear(ctx, -Wd, 0, Wd, 0, [[0, C.budHi], [.45, C.bud], [1, C.budDark]]);
    ctx.beginPath(); ellipse(ctx, 0, L * .55, Wd, L * .5, 0); ctx.fill();
    ctx.strokeStyle = rgba(C.budDark, .7); ctx.lineWidth = Math.max(.4, size * .02);
    ctx.beginPath(); ctx.moveTo(0, L * .08); ctx.quadraticCurveTo(Wd * .25, L * .55, 0, L * 1.03); ctx.stroke();
    ctx.strokeStyle = rgba(C.hair, .5); ctx.lineWidth = Math.max(.3, size * .008);
    ctx.beginPath();
    for (let i = 0; i < 46; i++) {
      const t = r() * TAU, px = Math.cos(t) * Wd, py = L * .55 + Math.sin(t) * L * .5;
      ctx.moveTo(px, py); ctx.lineTo(px * (1.08 + r() * .08), L * .55 + (py - L * .55) * (1.06 + r() * .06));
    }
    ctx.stroke();
    ctx.restore();
  }

  // Grass blades along the bottom edge, darker at the root.
  function grassBed(ctx, r, x0, x1, count, hMin, hMax, cols, root, y = H + 4, wMin = 3, wMax = 7) {
    for (let i = 0; i < count; i++) {
      const x = R(r, x0, x1), h = R(r, hMin, hMax), c = pick(r, cols);
      ctx.fillStyle = linear(ctx, 0, y, 0, y - h, [[0, root], [.55, c], [1, tint(c, .08)]]);
      ctx.beginPath(); blade(ctx, x, y, h, jit(r, h * .4), R(r, wMin, wMax)); ctx.fill();
    }
  }

  scene('garden', 'poppies', (ctx, P, r) => {
    const night = P.night, hy = 650;
    const N = makeNoise(Math.floor(r() * 1e9));
    const leafG = P.green, sage = P.cyan;
    const C = poppyPalette(P);
    const skyTop = night ? shade(P.darker_background, .3) : mixHex(P.background, mixHex(tone(P.magenta, .9, .35), tone(P.yellow, .92, .4), .5), .5);
    const skyMid = night ? mixHex(P.background, P.selection, .3) : tint(P.background, .35);
    const skyLow = night ? mixHex(P.lighter_background, P.muted, .5) : mixHex(P.background, tone(P.yellow, .9, .6), .6);
    skyGradient(ctx, [[0, skyTop], [.4, skyMid], [hy / H, skyLow], [1, skyLow]]);

    // The moon or the sun, with a halo.
    const lx = night ? 1470 : 360, ly = night ? 205 : 190;
    if (night) {
      stars(ctx, r, 280, [0, 0, W, hy - 80], [P.foreground, P.bright_red, P.light_foreground], 1.7);
      moon(ctx, lx, ly, 46, tone(P.foreground, .93, .6), tint(P.foreground, .1), r);
    } else {
      glow(ctx, lx, ly, 0, 1100, tint(tone(P.yellow, .92, .6), .3), .55);
      glow(ctx, lx, ly, 0, 300, '#ffffff', .9);
      ctx.fillStyle = rgba('#ffffff', .95); ctx.beginPath(); circle(ctx, lx, ly, 44); ctx.fill();
    }
    // Long thin clouds.
    const cl = soft(.4);
    for (let i = 0; i < 16; i++) {
      const cx = R(r, -100, W + 100), cy = R(r, 110, hy - 140), w = R(r, 180, 460);
      const lit = night ? mixHex(P.muted, P.foreground, .35) : '#ffffff';
      cl.x.fillStyle = rgba(lit, night ? R(r, .05, .11) : R(r, .35, .6));
      cl.x.beginPath(); ellipse(cl.x, cx, cy, w, w * R(r, .05, .1), jit(r, .03)); cl.x.fill();
      if (!night) {
        cl.x.fillStyle = rgba(tone(P.magenta, .85, .3), .12);
        cl.x.beginPath(); ellipse(cl.x, cx + 10, cy + w * .05, w * .8, w * .04, 0); cl.x.fill();
      }
    }
    put(ctx, cl, 24);

    // Far hills and lines of trees, faded into the haze.
    const haze = skyLow;
    const hill1 = ridgePoints(N, hy + 2, 50, .0015, 3.1);
    fillRidge(ctx, hill1, mixHex(night ? shade(sage, .55) : tone(sage, .78, .5), haze, .6));
    const trees = soft(.6);
    trees.x.fillStyle = mixHex(night ? shade(leafG, .72) : tone(leafG, .58, .5), haze, .5);
    for (let i = 0; i < 90; i++) {
      const tx = i < 50 ? R(r, -40, 640) : R(r, 1150, 1530), s = R(r, 9, 28);
      trees.x.beginPath(); circle(trees.x, tx, hy - s * .6 + R(r, -2, 10), s); trees.x.fill();
    }
    put(ctx, trees, 2);
    const hill2 = ridgePoints(N, hy + 12, 20, .0024, 8.7);

    // The field, hazy at the horizon and deeper toward the viewer.
    const fieldNear = night ? shade(leafG, .8) : tone(leafG, .48, .75);
    const fieldFar = mixHex(night ? shade(leafG, .55) : tone(leafG, .72, .55), haze, .45);
    ctx.fillStyle = linear(ctx, 0, hy, 0, H, [[0, fieldFar], [.3, mixHex(fieldFar, fieldNear, .55)], [1, fieldNear]]);
    ctx.beginPath(); line(ctx, hill2); ctx.lineTo(W + 20, H); ctx.lineTo(-20, H); ctx.closePath(); ctx.fill();

    // Far poppies as dots on the ground plane, thick toward the horizon.
    const gy = z => hy + 10 + (H - hy - 10) / z;
    const far = soft(1.3);
    const patchAt = (x, z) => fbm(N, x / 300 * (1 + 3 / z), z * .3 + 40, 3);
    for (let i = 0; i < 24000; i++) {
      const z = lerp(4.5, 90, Math.sqrt(r())), y = gy(z), x = R(r, -30, W + 30), s = 26 / z;
      if (r() < .4) {
        far.x.fillStyle = rgba(pick(r, C.grass), .45);
        far.x.fillRect(x, y - s * 2.2, Math.max(.4, s * .2), s * 2.2);
        continue;
      }
      if (patchAt(x, z) < -.08 && r() < .75) continue;
      const top = y - s * R(r, 1.6, 2.6);
      far.x.fillStyle = pick(r, C.dots);
      far.x.beginPath(); ellipse(far.x, x, top, Math.max(.45, s), Math.max(.35, s * .62), 0); far.x.fill();
    }
    far.x.fillStyle = linear(far.x, 0, hy - 14, 0, hy + 70, [[0, rgba(haze, 0)], [.35, rgba(haze, night ? .45 : .6)], [1, rgba(haze, 0)]]);
    far.x.fillRect(0, hy - 14, W, 84);
    put(ctx, far, .7);

    // Nearer poppies on thin stems, larger toward the viewer.
    const v0 = night ? [.6, -.5, -.5] : [-.6, -.7, .3];
    const mids = [];
    for (let i = 0; i < 700; i++) {
      const z = lerp(.8, 5, Math.sqrt(r())), x = R(r, -20, W + 20);
      if (patchAt(x, z) < -.1 && r() < .65) continue;
      if (z < 1.6 && x > 700 && x < 1250 && r() < .5) continue;
      mids.push([x, gy(z) + R(r, 0, 6), z]);
    }
    mids.sort((a, b) => b[2] - a[2]);
    for (const [x, y, z] of mids) {
      const s = 26 / z, top = y - s * R(r, 1.7, 2.8);
      ctx.fillStyle = rgba(pick(r, C.grass), .85);
      for (let g = 0; g < 3; g++) { ctx.beginPath(); blade(ctx, x + jit(r, s * 1.5), y + 2, s * R(r, 1.5, 3), jit(r, s * 1.2), Math.max(.8, s * .25)); ctx.fill(); }
      stem(ctx, bez([x, y + 2], [x + jit(r, s * .4), lerp(y, top, .4)], [x + jit(r, s * .5), lerp(y, top, .7)], [x + jit(r, s * .2), top], 5), Math.max(.8, s * .18), Math.max(.6, s * .13), C.stem);
      if (s < 7) {
        ctx.fillStyle = pick(r, C.dots);
        ctx.beginPath(); ellipse(ctx, x, top - s * .2, s * .95, s * .6, jit(r, .3)); ctx.fill();
        ctx.fillStyle = rgba(C.dark, .5);
        ctx.beginPath(); ellipse(ctx, x, top - s * .45, s * .5, s * .18, 0); ctx.fill();
      } else {
        poppy(ctx, x, top, s, view(R(r, .4, .95), jit(r, .3), v0), C, r, s > 20 ? 1 : 0, { dark: C.dark, pleat: .14, rim: s > 20 ? C.rim : null, rimA: .4 });
      }
    }

    // Grass along the bottom edge.
    grassBed(ctx, r, -20, W + 20, 420, 50, 250, C.grass, C.root);

    // Hero poppies in the corners, with buds.
    const heroO = { dark: C.dark, shadow: rgba(C.dark, night ? .55 : .3), rim: C.rim, rimA: night ? .75 : .55, sheen: night ? .1 : .16, sheenCol: C.sheen, trans: C.trans, glowCol: C.glow, pleat: .22, pleatCol: C.sheen };
    const hero = (x, y, size, e, roll, stemX, bend) => {
      stem(ctx, bez([stemX, H + 10], [stemX + bend, lerp(H, y, .4)], [x - bend * .4, lerp(H, y, .75)], [x, y + size * .1], 22), size * .065, size * .05, C.stem, C.stemHi);
      poppy(ctx, x, y, size, view(e, roll, v0), C, r, 2, heroO);
    };
    const bud = (x, y, size, a, sx, open) => {
      stem(ctx, bez([sx, H + 10], [sx + 10, lerp(H, y, .5)], [x - 40 * Math.sign(a), y - size * .9], [x, y - size * .05], 22), size * .12, size * .09, C.stem, C.stemHi);
      poppyBud(ctx, x, y, size, a, C, r, open);
    };
    bud(84, 470, 56, .35, 120, 0);
    bud(1800, 500, 50, -.4, 1770, .6);
    bud(430, 655, 44, .5, 395, 0);
    hero(570, 835, 125, .6, .12, 600, -30);
    hero(250, 700, 175, .72, -.1, 225, 40);
    hero(1580, 720, 180, .66, .15, 1610, -40);
    hero(1350, 900, 112, .52, -.2, 1380, 25);
    hero(1830, 900, 150, .82, .1, 1860, -20);
    hero(60, 965, 130, .5, .3, 55, 10);
    grassBed(ctx, r, -20, 900, 90, 30, 140, C.grass, C.root);
    grassBed(ctx, r, 1100, W + 20, 90, 30, 140, C.grass, C.root);

    // A poppy close to the lens, out of focus.
    const near = soft(.5);
    stem(near.x, bez([1760, H + 40], [1780, 1060], [1820, 1010], [1890, 1000], 16), 24, 20, C.stem);
    poppy(near.x, 1890, 1000, 320, view(.55, .4, v0), C, r, 1, { dark: C.dark, rim: C.rim, rimA: .3, pleat: .15 });
    grassBed(near.x, r, -40, 300, 26, 120, 380, C.grass, C.root, H + 20, 10, 22);
    put(ctx, near, 16, .95);

    finish(ctx, P, r, night ? .45 : .12, night ? .045 : .035);
  });

  // ---------- shared plant parts ----------

  // A pinnate leaf: leaflets in pairs along a curved rachis, and 1 at the tip.
  function pinnate(ctx, x, y, a, len, pairs, lLen, lWid, c, o = {}) {
    const { bend = .15, droop = .5, shrink = .45, serr = 0, terminal = true, spread = .9, shadow, fold = .22, w = 1.6 } = o;
    const pts = bez([x, y], [x + Math.cos(a) * len * .35, y + Math.sin(a) * len * .35],
      [x + Math.cos(a + bend) * len * .7, y + Math.sin(a + bend) * len * .7], [x + Math.cos(a + bend * 1.6) * len, y + Math.sin(a + bend * 1.6) * len], 20);
    ctx.strokeStyle = c.vein; ctx.lineWidth = w;
    ctx.beginPath(); line(ctx, pts); ctx.stroke();
    for (let i = 0; i < pairs; i++) {
      const t = (i + 1) / (pairs + 1), p = pts[Math.round(t * 20)], q = pts[Math.min(20, Math.round(t * 20) + 1)];
      const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), sz = 1 - t * shrink;
      for (const sd of [-1, 1]) leaf2(ctx, p[0], p[1], ang + sd * spread + droop * .3, lLen * sz, lWid * sz, c, { bend: sd * .12, serr, fold, shadow, veins: 4 });
    }
    if (terminal) { const p = pts[20], q = pts[19]; leaf2(ctx, p[0], p[1], Math.atan2(p[1] - q[1], p[0] - q[0]), lLen * (1 - shrink * .8), lWid * (1 - shrink * .8), c, { serr, fold, shadow, veins: 4 }); }
  }
  // Leaf colors from a palette green.
  function leafCols(P, g, L = P.night ? .36 : .5, cx = .9) {
    return { light: tone(g, L + .1, cx), dark: tone(g, L - .1, cx), tip: tone(g, L + .14, cx * .9), vein: tone(g, L + .2, cx * .6), rim: tone(g, L + .3, cx * .5), shade: tone(g, L - .3, cx) };
  }

  // A disc under the inner petals of a full flower, so no gap shows at the heart.
  const coreOf = (col, rad, h) => ({ d: -99, draw: (c2, proj) => {
    c2.fillStyle = col;
    c2.beginPath(); trace(c2, Array.from({ length: 20 }, (_, i) => { const a = i / 20 * TAU; return proj(Math.cos(a) * rad, Math.sin(a) * rad, h); })); c2.fill();
  } });

  // ---------- garden/marigolds ----------

  // A double marigold: rings of small frilled petals that rise into a dome.
  function marigold(ctx, x, y, size, v, col, r, lod = 2, o = {}) {
    const K = lod > 1 ? 9 : lod > 0 ? 6 : 4, petals = [];
    for (let k = 0; k < K; k++) {
      const q = k / (K - 1), n = Math.round((lod > 1 ? 22 : lod > 0 ? 15 : 10) - q * (lod > 1 ? 10 : 5)), phi = lerp(-.25, 1.3, q);
      const h = .48 * Math.sin(q * Math.PI / 2), r0 = .3 * Math.cos(q * Math.PI / 2), len = lerp(.56, .26, q);
      const stops = [[0, mixHex(col.deep, col.mid, q * .3)], [.55, col.mid], [1, mixHex(col.tip, col.mid, q * .3)]];
      for (let i = 0; i < n; i++) {
        const th = (i + k * .5) / n * TAU + jit(r, .16), l = len * R(r, .85, 1.12), ph = phi + jit(r, .18);
        petals.push({
          th, r0, len: l, wid: l * .5, belly: .72, round: .4, n: lod > 1 ? 16 : lod > 0 ? 10 : 7,
          spine: sv => [sv * Math.cos(ph) - (q > .4 ? .22 : 0) * sv * sv, h / l + sv * Math.sin(ph) - (q < .4 ? .3 : 0) * sv * sv],
          cross: .1, scallop: lod > 0 ? .3 : 0, sf: 5 + Math.floor(r() * 4), ph: r() * 9, ruffle: lod > 0 ? .1 : 0, rf: 3,
          c: stops, cb: [[0, col.deep], [1, col.mid]], trans: .25, noRim: q > .45,
        });
      }
    }
    return blossom(ctx, x, y, size, v, petals, [coreOf(col.deep, .3, .3)], o);
  }

  scene('garden', 'marigolds', (ctx, P, r) => {
    const night = P.night;
    const gold = P.yellow, orange = P.orange, amber = P.blue, maroon = P.red;
    // Warm air, dark at night and sunlit by day.
    if (night) skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.5, P.background], [1, mixHex(P.background, P.lighter_background, .7)]]);
    else skyGradient(ctx, [[0, tint(P.background, .4)], [.55, P.background], [1, mixHex(P.background, tone(gold, .88, .7), .55)]]);
    glow(ctx, 960, 560, 0, 1000, night ? amber : tone(gold, .92, .9), night ? .22 : .4);

    // Lamps and sun spots out of focus.
    const bk = soft(.35);
    for (let i = 0; i < 46; i++) {
      const x = R(r, 0, W), y = R(r, 200, 860), rad = R(r, 10, 26) * (1 + 2.5 * r() ** 3);
      const c = pick(r, night ? [gold, amber, orange, P.bright_yellow] : [tone(gold, .9, .8), '#ffffff', tone(orange, .85, .7)]);
      bokeh(bk.x, x, y, rad, c, night ? R(r, .06, .26) : R(r, .1, .3));
    }
    put(ctx, bk, 2.5, 1, night ? 'lighter' : 'source-over');

    const vM = [-.4, -.7, .55];
    const C = (hex, L, c) => ({ deep: hue(hex, L - .16, c * 1.05), mid: hue(hex, L, c), tip: hue(hex, L + .07, c * .85) });
    const cols = night
      ? [C(gold, .8, .17), C(orange, .7, .17), C(amber, .75, .16), C(gold, .78, .17), C(orange, .67, .17), C(maroon, .42, .15)]
      : [C(gold, .84, .18), C(orange, .73, .18), C(amber, .78, .17), C(gold, .83, .18), C(orange, .71, .18), C(maroon, .45, .16)];
    const pickCol = () => r() < .1 ? cols[5] : cols[Math.floor(r() * 5)];
    const dark = tone(maroon, .22, .8);
    const headO = lod => ({ dark, shadeAmt: night ? .4 : .32, shadow: lod > 1 ? rgba(dark, night ? .6 : .3) : null, sblur: .07, pleat: lod > 0 ? .18 : .1, pleatCol: tone(gold, .95, .4), rim: lod > 1 ? tint(tone(gold, .92, .7), .3) : null, rimA: .5, rimW: .008 });

    // A garland: heads threaded on a sagging string, with strands that hang from it.
    const garland = (c2, x0, y0, x1, y1, sag, size, lod, drops = []) => {
      const at = t => [lerp(x0, x1, t), lerp(y0, y1, t) + sag * 4 * t * (1 - t)];
      c2.strokeStyle = tone(maroon, night ? .3 : .4, .6); c2.lineWidth = Math.max(1, size * .06);
      c2.beginPath(); line(c2, Array.from({ length: 41 }, (_, i) => at(i / 40))); c2.stroke();
      const lc = leafCols(P, P.green, night ? .4 : .5);
      for (const [t, count] of drops) {
        const [dx, dy] = at(t);
        c2.beginPath(); c2.moveTo(dx, dy); c2.lineTo(dx, dy + count * size * 1.3); c2.stroke();
        leaf2(c2, dx, dy + (count + .5) * size * 1.25, Math.PI / 2 + jit(r, .25), size * 1.7, size * .45, lc, { fold: .25 });
        for (let k = count; k >= 1; k--) marigold(c2, dx + jit(r, 2), dy + k * size * 1.25, size * .92, view(R(r, .2, .7), jit(r, .5), vM), pickCol(), r, lod, headO(lod));
      }
      let acc = 0, prev = at(0);
      const heads = [];
      for (let i = 1; i <= 900; i++) {
        const p = at(i / 900); acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]); prev = p;
        if (acc > size * 1.3) { acc = 0; heads.push(p); }
      }
      for (const [hx, hy2] of heads) {
        if (r() < .25) leaf2(c2, hx, hy2, Math.PI / 2 + jit(r, .9), size * 1.3, size * .38, lc, { fold: .25 });
        marigold(c2, hx + jit(r, size * .1), hy2 + jit(r, size * .1), size * R(r, .92, 1.08), view(R(r, .35, 1.05), jit(r, Math.PI), vM), pickCol(), r, lod, headO(lod));
      }
    };
    if (night) {
      // Warm light around the garlands, as from lamps behind them.
      const gl = soft(.3);
      gl.x.strokeStyle = rgba(amber, .9); gl.x.lineCap = 'round';
      [[-90, 20, W + 90, 50, 300, 90], [-80, 150, W + 80, 120, 240, 50]].forEach(([x0, y0, x1, y1, sag, w]) => {
        gl.x.lineWidth = w; gl.x.beginPath();
        line(gl.x, Array.from({ length: 41 }, (_, i) => { const t = i / 40; return [lerp(x0, x1, t), lerp(y0, y1, t) + sag * 4 * t * (1 - t)]; }));
        gl.x.stroke();
      });
      put(ctx, gl, 50, .35, 'lighter');
    }
    // A garland further back, out of focus.
    const back = soft(.5);
    garland(back.x, -80, 150, W + 80, 120, 240, 26, 0, [[.12, 4], [.3, 2], [.7, 2], [.9, 4]]);
    put(ctx, back, 4.5, night ? .85 : .9);
    garland(ctx, -90, 20, W + 90, 50, 300, 46, 1, [[.04, 6], [.16, 4], [.84, 4], [.96, 6]]);

    // Marigold plants in the bottom corners.
    const lc = leafCols(P, P.green, night ? .3 : .47);
    for (let i = 0; i < 16; i++) {
      const left = i % 2 === 0, x = left ? R(r, -80, 560) : R(r, 1360, W + 80);
      pinnate(ctx, x, H + 30, -Math.PI / 2 + (left ? 1 : -1) * R(r, .1, .9), R(r, 200, 380), 7, 64, 13, lc, { serr: .3, bend: (left ? 1 : -1) * .25, shadow: rgba(dark, night ? .5 : .2), w: 2 });
    }
    const plant = (x, y, size, e, roll, sx) => {
      stem(ctx, bez([sx, H + 20], [sx, lerp(H, y, .4)], [x, lerp(H, y, .7)], [x, y + size * .1], 16), size * .08, size * .06, lc.dark, lc.light);
      marigold(ctx, x, y, size, view(e, roll, vM), cols[Math.floor(r() * 5)], r, 2, headO(2));
    };
    plant(120, 800, 112, .95, .2, 150);
    plant(400, 920, 100, .75, -.2, 420);
    plant(250, 1040, 120, .6, .1, 240);
    plant(560, 1060, 80, .7, .3, 560);
    plant(1790, 790, 120, .9, -.1, 1770);
    plant(1540, 930, 104, .75, .25, 1520);
    plant(1860, 1030, 110, .6, 0, 1860);
    plant(1350, 1065, 82, .7, -.3, 1350);

    finish(ctx, P, r, night ? .5 : .14, night ? .045 : .035);
  });

  // ---------- garden/mimosa ----------

  // A mimosa head: a ball of fine stamens with pale tips, lit from the direction lx, ly.
  function pompom(ctx, x, y, rad, C, r, lx, ly) {
    ctx.fillStyle = radial(ctx, x + lx * rad * .25, y + ly * rad * .25, 0, rad * .95, [[0, C.mid], [.7, C.deep], [1, rgba(C.deep, 0)]]);
    ctx.beginPath(); circle(ctx, x, y, rad * .95); ctx.fill();
    const n = Math.round(clamp(rad * 7, 24, 150)), bins = [[], [], []];
    ctx.strokeStyle = C.fil; ctx.lineWidth = Math.max(.3, rad * .03);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, z = r() * 2 - 1, q = Math.sqrt(1 - z * z), d = rad * R(r, .8, 1.12);
      const ex = x + Math.cos(a) * q * d, ey = y + Math.sin(a) * q * d;
      ctx.moveTo(x + Math.cos(a) * q * d * .45, y + Math.sin(a) * q * d * .45); ctx.lineTo(ex, ey);
      const l = Math.cos(a) * q * lx + Math.sin(a) * q * ly + z * .4;
      bins[l > .25 ? 0 : l > -.3 ? 1 : 2].push([ex, ey]);
    }
    ctx.stroke();
    const dotR = Math.max(.45, rad * .075);
    [C.tipLit, C.tip, C.tipDark].forEach((c, i) => {
      ctx.fillStyle = c; ctx.beginPath();
      bins[i].forEach(([ex, ey]) => circle(ctx, ex, ey, dotR));
      ctx.fill();
    });
  }
  // A feathery leaf: curved pinnae in pairs along a rachis, each lined with
  // tiny leaflets.
  function feather(ctx, x, y, a, len, C, r, o = {}) {
    const { pinnae = 11, leaflets = 18, bend = .25, spread = 1, width = 1, droop = .5 } = o;
    const pts = bez([x, y], [x + Math.cos(a) * len * .35, y + Math.sin(a) * len * .35],
      [x + Math.cos(a + bend) * len * .7, y + Math.sin(a + bend) * len * .7], [x + Math.cos(a + bend * 1.5) * len, y + Math.sin(a + bend * 1.5) * len], 24);
    ctx.lineCap = 'round';
    ctx.strokeStyle = C.stalk; ctx.lineWidth = Math.max(.5, len * .01 * width);
    ctx.beginPath(); line(ctx, pts); ctx.stroke();
    const top = new Path2D(), under = new Path2D(), axis = new Path2D();
    for (let i = 0; i < pinnae; i++) {
      const t = .1 + i / pinnae * .88, k = Math.round(t * 24), p = pts[k], q = pts[Math.min(24, k + 1)], o2 = pts[Math.max(0, k - 1)];
      const da = Math.atan2(q[1] - o2[1], q[0] - o2[0]);
      for (const sd of [-1, 1]) {
        const pa = da + sd * spread + jit(r, .12), pl = len * .3 * (1 - .5 * t) * R(r, .9, 1.1);
        // The pinna bends down under its own weight.
        const cx = p[0] + Math.cos(pa) * pl * .5, cy = p[1] + Math.sin(pa) * pl * .5;
        const ex = p[0] + Math.cos(pa) * pl * .95, ey = p[1] + Math.sin(pa) * pl * .95 + pl * droop * .35;
        const at = u => [(1 - u) * (1 - u) * p[0] + 2 * u * (1 - u) * cx + u * u * ex, (1 - u) * (1 - u) * p[1] + 2 * u * (1 - u) * cy + u * u * ey];
        axis.moveTo(p[0], p[1]); axis.quadraticCurveTo(cx, cy, ex, ey);
        for (let j = 0; j < leaflets; j++) {
          const u = (j + .6) / (leaflets + .4), [bx, by] = at(u), [nx, ny] = at(Math.min(1, u + .02));
          const ta = Math.atan2(ny - by, nx - bx), ll = pl * .11 * (1 - u * .5);
          for (const s2 of [-1, 1]) {
            const la = ta + s2 * 1.05, path = s2 === sd ? under : top;
            path.moveTo(bx, by); path.lineTo(bx + Math.cos(la) * ll, by + Math.sin(la) * ll);
          }
        }
      }
    }
    ctx.lineWidth = Math.max(.3, len * .005 * width); ctx.strokeStyle = C.stalk; ctx.stroke(axis);
    ctx.lineWidth = Math.max(.5, len * .011 * width);
    ctx.strokeStyle = C.under; ctx.stroke(under);
    ctx.strokeStyle = C.top; ctx.stroke(top);
    ctx.lineCap = 'butt';
  }

  scene('garden', 'mimosa', (ctx, P, r) => {
    const night = P.night, yel = P.yellow, sil = P.green;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.6, P.background], [1, mixHex(P.background, P.lighter_background, .8)]]);
      glow(ctx, 1500, 260, 0, 900, mixHex(P.foreground, yel, .3), .12);
    } else {
      skyGradient(ctx, [[0, hue(P.cyan, .86, .035)], [.55, hue(P.cyan, .93, .02)], [1, tint(P.background, .3)]]);
      glow(ctx, 380, 160, 0, 1000, '#ffffff', .75);
    }
    const lx = night ? .6 : -.65, ly = night ? -.5 : -.6;
    const C = night
      ? { deep: hue(yel, .55, .12), mid: hue(yel, .7, .15), fil: rgba(hue(yel, .72, .14), .7), tip: hue(yel, .8, .16), tipLit: hue(yel, .9, .12), tipDark: hue(yel, .6, .13) }
      : { deep: hue(yel, .72, .16), mid: hue(yel, .82, .18), fil: rgba(hue(yel, .78, .16), .75), tip: hue(yel, .87, .18), tipLit: hue(yel, .95, .12), tipDark: hue(yel, .74, .17) };
    const FL = (L, c) => ({ stalk: hue(sil, L - .08, c * .8), top: hue(sil, L + .06, c), under: hue(sil, L - .06, c * 1.1) });
    const Fn = night ? FL(.5, .045) : FL(.66, .05);
    const bark = night ? mixHex(P.brown, P.muted, .4) : mixHex(tone(P.brown, .5, .6), P.muted, .4);

    // A branch with side shoots, leaves and clusters of flower heads.
    const branch = (c2, pts, w0, w1, rad, nClusters, leaves, lod) => {
      stem(c2, pts, w0, w1, bark, night ? tone(P.foreground, .5, .3) : tint(bark, .4), .3);
      const n = pts.length - 1;
      for (let i = 0; i < leaves; i++) {
        const k = Math.floor(R(r, .1, .98) * n), p = pts[k], q = pts[Math.min(n, k + 1)];
        const da = Math.atan2(q[1] - p[1], q[0] - p[0]) + (i % 2 ? 1 : -1) * R(r, .5, 1.1);
        feather(c2, p[0], p[1], da, R(r, 130, 230) * (rad / 13), Fn, r, { pinnae: lod ? 11 : 8, leaflets: lod ? 18 : 10, bend: jit(r, .4) });
      }
      for (let i = 0; i < nClusters; i++) {
        const k = Math.floor(R(r, .15, 1) * n), p = pts[k], q = pts[Math.min(n, k + 1)];
        const da = Math.atan2(q[1] - p[1], q[0] - p[0]) + (r() < .5 ? 1 : -1) * R(r, .3, .9);
        const L = R(r, 60, 150) * (rad / 12), ex = p[0] + Math.cos(da) * L, ey = p[1] + Math.sin(da) * L + L * .3;
        const sp = bez(p, [p[0] + Math.cos(da) * L * .4, p[1] + Math.sin(da) * L * .4], [ex, ey - L * .2], [ex, ey], 10);
        c2.strokeStyle = bark; c2.lineWidth = Math.max(.6, rad * .12);
        c2.beginPath(); line(c2, sp); c2.stroke();
        const heads = 8 + Math.floor(r() * 10);
        for (let j = 0; j < heads; j++) {
          const t = R(r, .2, 1), b = sp[Math.round(t * 10)], ha = da + jit(r, 1.8), hl = rad * R(r, 1, 2.4);
          const hx = b[0] + Math.cos(ha) * hl, hy = b[1] + Math.sin(ha) * hl;
          c2.lineWidth = Math.max(.4, rad * .06); c2.beginPath(); c2.moveTo(b[0], b[1]); c2.lineTo(hx, hy); c2.stroke();
          pompom(c2, hx, hy, rad * R(r, .8, 1.15), C, r, lx, ly);
        }
      }
    };
    const curve = (x0, y0, x1, y1, bend) => bez([x0, y0], [lerp(x0, x1, .3), lerp(y0, y1, .3) + bend], [lerp(x0, x1, .7), lerp(y0, y1, .7) + bend * .6], [x1, y1], 40);

    // Branches further back, out of focus.
    const far = soft(.5);
    branch(far.x, curve(W + 40, 120, 1180, 300, -40), 10, 3, 9, 8, 7, 0);
    branch(far.x, curve(-40, 620, 520, 470, 30), 9, 3, 9, 6, 6, 0);
    put(ctx, far, 4.5, night ? .7 : .75);
    if (night) haloes(ctx, x => { x.fillStyle = rgba(hue(yel, .7, .14), .5); [[300, 180], [900, 300], [1650, 640]].forEach(([gx, gy]) => { x.beginPath(); circle(x, gx, gy, 140); x.fill(); }); }, [120], [.18], .25);

    // The main branches.
    branch(ctx, curve(-60, 60, 980, 330, 120), 22, 5, 15, 18, 13, 1);
    branch(ctx, curve(-40, 300, 520, 200, -30), 12, 4, 14, 7, 5, 1);
    branch(ctx, curve(W + 60, 760, 1240, 420, 90), 20, 5, 16, 16, 12, 1);
    branch(ctx, curve(W + 60, 1000, 1500, 900, -60), 14, 4, 15, 8, 6, 1);

    // A cluster close to the lens.
    const near = soft(.5);
    branch(near.x, curve(-60, 1100, 360, 900, 20), 30, 10, 26, 5, 4, 0);
    put(ctx, near, 10, .95);

    finish(ctx, P, r, night ? .45 : .12, night ? .045 : .035);
  });

  // ---------- garden/irises ----------

  // A bearded iris: 3 upright standards, 3 falls with a beard, and 3 style arms.
  function iris(ctx, x, y, size, v, C, r, o = {}) {
    const petals = [], extras = [], th0 = jit(r, .3);
    for (let k = 0; k < 3; k++) {
      const ts = th0 - Math.PI / 2 + k * TAU / 3, tf = ts + Math.PI / 3;
      petals.push({
        th: ts, r0: .04, len: R(r, .95, 1.05), wid: .4, belly: .6, round: .5, n: 26,
        spine: s => [.5 * s - .6 * s * s, .95 * s], cross: .14, ruffle: .14, rf: 4 + r() * 2, ph: r() * 9, wave: .08, wf: 4, wph: r() * 6,
        c: C.std, cb: C.stdBack, veins: 14, veinA: .1, veinCol: C.vein, trans: .45,
      });
      const fall = {
        th: tf, r0: .05, len: R(r, 1, 1.1), wid: .46, belly: .62, round: .5, n: 26,
        spine: s => [1.05 * s - .1 * s * s, .36 * s - 1.05 * s * s], cross: -.1, ruffle: .1, rf: 4 + r() * 2, ph: r() * 9, wave: .06, wf: 4, wph: r() * 6,
        c: C.fall, cb: C.fallBack, veins: 16, veinA: .4, veinCol: C.vein, veinEnd: .42, veinW: .005, trans: .3,
      };
      petals.push(fall);
      const f = warp(fall), d = v.depth(...f(fall.len * .55, 0));
      // The beard: a strip of short hairs, pale at the throat and orange at the tip.
      extras.push({ d: d + .02, draw: (c2, proj, sz) => {
        for (let i = 0; i < 70; i++) {
          const q = R(r, .05, .46), T = jit(r, .045) * (1 - q), p = proj(...f(q * fall.len, T));
          c2.fillStyle = q < .14 ? C.beard[0] : q < .3 ? C.beard[1] : C.beard[2];
          c2.beginPath(); circle(c2, p[0], p[1] - sz * .01, sz * R(r, .012, .02)); c2.fill();
        }
      } });
      petals.push({
        th: tf, r0: .03, len: .5, wid: .11, belly: .7, round: .6, n: 14, dz: .25,
        spine: s => [.62 * s, .3 * s - .12 * s * s], cross: .05, scallop: .25, sf: 2, c: C.style, cb: C.style,
      });
    }
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }

  scene('garden', 'irises', (ctx, P, r) => {
    const night = P.night;
    const vio = P.blue, purple = P.magenta, indigo = P.green, pale = P.cyan, gold = P.yellow, org = P.orange;
    const sage = mixHex(gold, pale, .62);
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .3)], [.55, P.background], [1, mixHex(P.lighter_background, P.selection, .5)]]);
      stars(ctx, r, 200, [0, 0, W, 700], [P.foreground, P.bright_blue, P.bright_cyan], 1.6);
      moon(ctx, 1330, 190, 40, tone(P.foreground, .93, .5), tint(P.bright_blue, .2), r);
    } else {
      skyGradient(ctx, [[0, hue(vio, .9, .045)], [.5, tint(P.background, .3)], [1, mixHex(P.background, hue(gold, .93, .05), .5)]]);
      glow(ctx, 1330, 200, 0, 900, '#ffffff', .7);
    }
    const lightDir = night ? [.5, -.6, -.4] : [.5, -.7, .4];
    const C = night ? {
      std: [[0, hue(indigo, .4, .1)], [.4, hue(vio, .6, .13)], [1, hue(vio, .72, .11)]], stdBack: [[0, hue(indigo, .35, .08)], [1, hue(vio, .55, .11)]],
      fall: [[0, hue(pale, .82, .03)], [.3, hue(purple, .6, .1)], [.55, hue(purple, .42, .14)], [1, hue(purple, .5, .13)]], fallBack: [[0, hue(indigo, .42, .08)], [1, hue(purple, .5, .12)]],
      vein: hue(purple, .3, .12), style: [[0, hue(pale, .6, .05)], [1, hue(vio, .78, .07)]], beard: [hue(gold, .9, .08), hue(gold, .8, .15), hue(org, .72, .17)],
    } : {
      std: [[0, hue(indigo, .5, .12)], [.4, hue(vio, .66, .14)], [1, hue(vio, .78, .1)]], stdBack: [[0, hue(indigo, .45, .1)], [1, hue(vio, .62, .12)]],
      fall: [[0, hue(pale, .93, .02)], [.3, hue(purple, .66, .11)], [.55, hue(purple, .46, .16)], [1, hue(purple, .55, .15)]], fallBack: [[0, hue(indigo, .52, .09)], [1, hue(purple, .6, .13)]],
      vein: hue(purple, .35, .14), style: [[0, hue(pale, .7, .05)], [1, hue(vio, .86, .06)]], beard: [hue(gold, .95, .07), hue(gold, .84, .16), hue(org, .74, .18)],
    };
    const LL = night ? .36 : .56, Lc = { light: hue(sage, LL + .1, .055), dark: hue(sage, LL - .12, .05), tip: hue(sage, LL + .14, .05), vein: hue(sage, LL + .22, .04), rim: hue(sage, LL + .3, .03), shade: hue(sage, LL - .3, .05) };
    const fO = { dark: night ? shade(P.darker_background, .4) : hue(indigo, .25, .08), shadeAmt: night ? .5 : .3, shadow: rgba(night ? '#000000' : hue(indigo, .3, .1), night ? .5 : .25), rim: night ? hue(pale, .92, .04) : '#ffffff', rimA: .55, pleat: .14, pleatCol: night ? hue(pale, .9, .03) : '#ffffff', sheen: .1 };

    // Sword leaves in fans from the bottom edge.
    const fan = (c2, x, count, hMin, hMax, lean) => {
      for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + lean + jit(r, .32), len = R(r, hMin, hMax);
        leaf2(c2, x + jit(r, 30), H + 40, a, len, len * R(r, .028, .04), Lc, { belly: .18, round: 1.4, bend: jit(r, .06), veins: 0, fold: .3, rimA: .3, veinA: .3 });
      }
    };
    const flower = (c2, x, y, size, e, roll, sx, buds = 1) => {
      const sl = bez([sx, H + 20], [sx + (x - sx) * .3, lerp(H, y, .4)], [x, lerp(H, y, .75)], [x, y], 20);
      stem(c2, sl, size * .09, size * .07, Lc.dark, Lc.light, .35);
      leaf2(c2, x, y + size * .3, -Math.PI / 2 - .5, size * .55, size * .1, Lc, { belly: .3, round: 1.2, veins: 0 });
      for (let b = 0; b < buds; b++) {
        const by = lerp(y, H, .25 + b * .2), bx = sl[Math.round((1 - (.25 + b * .2)) * 20)][0], ang = -Math.PI / 2 + (b % 2 ? .45 : -.45);
        leaf2(c2, bx, by, ang, size * .6, size * .13, { light: C.std[1][1], dark: C.std[0][1], tip: C.std[2][1], vein: C.vein, shade: C.vein }, { belly: .5, round: 1.3, veins: 0 });
        leaf2(c2, bx, by + 4, ang + .12, size * .38, size * .1, Lc, { belly: .35, round: 1.3, veins: 0 });
      }
      iris(c2, x, y, size, view(e, roll, lightDir), C, r, fO);
    };
    // Irises further back, out of focus.
    const far = soft(.5);
    fan(far.x, 760, 10, 260, 420, .15);
    fan(far.x, 1180, 10, 260, 420, -.15);
    flower(far.x, 820, 620, 70, .35, .1, 800, 0);
    flower(far.x, 1110, 580, 64, .3, -.1, 1120, 0);
    put(ctx, far, 5, .8);

    fan(ctx, 120, 16, 450, 820, .12);
    fan(ctx, 420, 9, 300, 560, -.1);
    fan(ctx, 1820, 16, 450, 820, -.12);
    fan(ctx, 1500, 9, 300, 560, .1);
    flower(ctx, 270, 330, 175, .3, .05, 240, 2);
    flower(ctx, 590, 650, 120, .36, -.08, 540, 1);
    flower(ctx, 1650, 300, 185, .32, -.06, 1690, 2);
    flower(ctx, 1350, 610, 128, .4, .1, 1390, 1);
    fan(ctx, 40, 6, 300, 500, .25);
    fan(ctx, 1880, 6, 300, 500, -.25);

    // Mist over the ground, then leaves close to the lens.
    const mist = night ? mixHex(P.lighter_background, P.selection, .5) : tint(P.background, .4);
    ctx.fillStyle = linear(ctx, 0, 820, 0, H, [[0, rgba(mist, 0)], [1, rgba(mist, night ? .55 : .7)]]);
    ctx.fillRect(0, 820, W, H - 820);
    const near = soft(.5);
    fan(near.x, -40, 5, 500, 900, .35);
    fan(near.x, W + 40, 5, 500, 900, -.35);
    put(ctx, near, 9, .9);
    finish(ctx, P, r, night ? .45 : .12, night ? .045 : .035);
  });

  // ---------- garden/wisteria ----------

  // A hanging raceme: florets on a helix around a curved axis, open at the top
  // and closed buds at the tip.
  function raceme(ctx, x, y, len, sway, fs, C, r, lod = 1) {
    const axis = bez([x, y], [x + sway * .2, y + len * .35], [x + sway * .7, y + len * .7], [x + sway, y + len], 40);
    ctx.strokeStyle = C.axis; ctx.lineWidth = Math.max(.4, fs * .07);
    ctx.beginPath(); line(ctx, axis); ctx.stroke();
    const n = Math.round(len / fs * (lod ? 4.6 : 3)), items = [];
    for (let i = 0; i < n; i++) {
      const t = (i + r() * .5) / n, p = axis[Math.min(40, Math.round(t * 40))], th = i * 2.39996 + jit(r, .3);
      const rho = fs * 3.1 * (1 - t) ** .75 + fs * .4, z = Math.sin(th);
      items.push({ x: p[0] + Math.cos(th) * rho, y: p[1] + z * fs * .3, z, side: Math.cos(th), t, s: fs * (1.05 - .6 * t) * R(r, .85, 1.1) });
    }
    items.sort((a, b) => a.z - b.z);
    for (const it of items) {
      const k = .55 + .45 * (it.z * .5 + .5), bud = it.t > .62;
      const ang = Math.atan2(.6, it.side) * .5 + (it.side > 0 ? -.2 : .2), s = it.s;
      ctx.save(); ctx.translate(it.x, it.y); ctx.rotate(ang * (it.side > 0 ? 1 : -1) * .6);
      if (bud) {
        ctx.fillStyle = linear(ctx, 0, -s * .5, 0, s * .5, [[0, mixHex(C.bud, C.dark, (1 - k) * .6)], [1, mixHex(C.budTip, C.dark, (1 - k) * .5)]]);
        ctx.beginPath(); ellipse(ctx, 0, 0, s * .32, s * .5, 0); ctx.fill();
      } else {
        // Wings and keel below, then the banner petal with its pale eye.
        ctx.fillStyle = mixHex(C.wing, C.dark, (1 - k) * .7);
        ctx.beginPath(); ellipse(ctx, -s * .2, s * .32, s * .24, s * .36, .5); ellipse(ctx, s * .2, s * .32, s * .24, s * .36, -.5); ctx.fill();
        ctx.fillStyle = mixHex(C.wing, C.dark, (1 - k) * .85 + .1);
        ctx.beginPath(); ellipse(ctx, 0, s * .42, s * .13, s * .26, 0); ctx.fill();
        ctx.fillStyle = radial(ctx, 0, s * .08, s * .02, s * .72, [[0, mixHex(C.eye, C.dark, (1 - k) * .4)], [.3, mixHex(C.banner, C.dark, (1 - k) * .55)], [1, mixHex(C.edge, C.dark, (1 - k) * .5)]]);
        ctx.beginPath();
        ctx.moveTo(0, s * .16);
        ctx.bezierCurveTo(-s * .78, s * .12, -s * .72, -s * .62, -s * .13, -s * .5);
        ctx.quadraticCurveTo(0, -s * .36, s * .13, -s * .5);
        ctx.bezierCurveTo(s * .72, -s * .62, s * .78, s * .12, 0, s * .16);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  scene('garden', 'wisteria', (ctx, P, r) => {
    const night = P.night, lav = P.blue, mauve = P.magenta, peri = P.cyan, lilac = P.yellow, leafG = P.green;
    const N = makeNoise(Math.floor(r() * 1e9));
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.5, P.background], [1, mixHex(P.background, P.selection, .6)]]);
      glow(ctx, 980, 980, 0, 900, mauve, .12);
      glow(ctx, 300, 140, 0, 700, P.foreground, .08);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .4)], [.6, P.background], [1, mixHex(P.background, hue(leafG, .9, .05), .6)]]);
      glow(ctx, 900, 160, 0, 1000, '#ffffff', .7);
    }
    // The garden far behind: soft masses of foliage and a few lights.
    const bg = soft(.25);
    for (let i = 0; i < 26; i++) {
      const c = pick(r, night ? [shade(leafG, .65), shade(leafG, .75), shade(lav, .6)] : [hue(leafG, .8, .07), hue(leafG, .86, .05), hue(lav, .9, .04)]);
      bg.x.fillStyle = rgba(c, night ? .5 : .55);
      bg.x.beginPath(); ellipse(bg.x, R(r, -100, W + 100), R(r, 760, 1150), R(r, 120, 300), R(r, 80, 160), 0); bg.x.fill();
    }
    for (let i = 0; i < 14; i++) bokeh(bg.x, R(r, 0, W), R(r, 600, 1000), R(r, 16, 50), night ? tint(mauve, .2) : '#ffffff', night ? R(r, .08, .2) : R(r, .3, .6));
    put(ctx, bg, 18);
    ctx.fillStyle = linear(ctx, 0, 560, 0, H, [[0, rgba(night ? P.background : tint(P.background, .4), 0)], [.5, rgba(night ? P.background : tint(P.background, .4), .35)], [1, rgba(night ? P.background : tint(P.background, .4), 0)]]);
    ctx.fillRect(0, 560, W, H - 560);

    const C = (L, c) => ({
      axis: hue(lav, L - .3, c * .5), banner: hue(lav, L, c), edge: hue(lav, L + .1, c * .7), eye: hue(lilac, L + .14, .05),
      wing: hue(peri, L - .14, c * 1.1), bud: hue(lav, L - .04, c * .9), budTip: hue(peri, L + .08, c * .6), dark: night ? shade(P.darker_background, .3) : hue(lav, .35, .08),
    });
    const Cn = night ? C(.66, .1) : C(.74, .11), Cf = night ? C(.5, .07) : C(.82, .07);
    const Cd = night ? C(.58, .12) : C(.66, .13), Cp = night ? C(.72, .08) : C(.8, .09);
    const lc = leafCols(P, leafG, night ? .42 : .6, .9);
    const beamY = 60;
    const hang = (c2, x, len, fs, Cc, lod) => raceme(c2, x, beamY + R(r, 10, 40), len, jit(r, len * .12), fs, Cc, r, lod);

    // Racemes further back, small and pale.
    const far = soft(.5);
    for (let i = 0; i < 46; i++) {
      const x = R(r, -40, W + 40), edge = Math.abs(x - W / 2) / (W / 2);
      hang(far.x, x, R(r, 140, 300) * (.55 + edge * .7), 9, Cf, 0);
    }
    for (let i = 0; i < 10; i++) pinnate(far.x, R(r, 0, W), beamY + 20, Math.PI / 2 + jit(r, .5), R(r, 120, 200), 5, 40, 12, leafCols(P, leafG, night ? .32 : .72, .6), { droop: 1, spread: 1.1, fold: .15 });
    put(ctx, far, 3.5, .85);

    // The beam of the pergola, with the old twisted vine along it.
    const wood = night ? mixHex(P.brown, P.darker_background, .3) : tone(P.brown, .48, .5);
    // The front face of the beam, then its underside in shade.
    ctx.fillStyle = linear(ctx, 0, -10, 0, 74, [[0, tint(wood, night ? .12 : .28)], [.5, wood], [1, shade(wood, .25)]]);
    ctx.fillRect(-10, -10, W + 20, 84);
    ctx.fillStyle = linear(ctx, 0, 74, 0, 96, [[0, shade(wood, .55)], [1, shade(wood, .4)]]);
    ctx.fillRect(-10, 74, W + 20, 22);
    ctx.strokeStyle = rgba(shade(wood, .5), .3); ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i < 18; i++) { const y0 = R(r, -4, 70); ctx.moveTo(-10, y0); for (let x = 0; x <= W + 20; x += 40) ctx.lineTo(x, y0 + Math.sin(x * .004 + i) * 3 + fbm(N, x * .01, i, 2) * 3); }
    ctx.stroke();
    for (let k = 0; k < 2; k++) {
      const pts = Array.from({ length: 70 }, (_, i) => { const x = -20 + i / 69 * (W + 40); return [x, 92 + Math.sin(x * .006 + k * 2.2) * 16 + k * 8]; });
      stem(ctx, pts, 18 - k * 6, 13 - k * 4, shade(wood, .1), tint(wood, .3), .4);
    }

    // The main racemes, longest at the sides.
    const mids = [];
    for (let i = 0; i < 34; i++) {
      const x = R(r, -20, W + 20), edge = Math.abs(x - W / 2) / (W / 2);
      mids.push([x, R(r, 260, 480) * (.42 + edge * 1.15)]);
    }
    for (let i = 0; i < 16; i++) pinnate(ctx, R(r, 0, W), beamY + 40, Math.PI / 2 + jit(r, .6), R(r, 160, 280), 6, 56, 17, lc, { droop: 1, spread: 1.15, fold: .2, shadow: rgba('#000000', night ? .35 : .15) });
    mids.sort((a, b) => a[1] - b[1]);
    for (const [x, len] of mids) hang(ctx, x, len, 15, pick(r, [Cn, Cn, Cd, Cp]), 1);

    // Racemes close to the lens.
    const near = soft(.5);
    hang(near.x, 50, 900, 34, Cn, 1);
    hang(near.x, 1870, 780, 32, Cn, 1);
    put(ctx, near, 9, 1);
    finish(ctx, P, r, night ? .45 : .12, night ? .045 : .035);
  });

  // ---------- garden/bougainvillea ----------

  // 3 papery bracts around 3 tiny cream flowers.
  function bracts(ctx, x, y, size, v, C, r, o) {
    const petals = [], th0 = r() * TAU;
    for (let k = 0; k < 3; k++) {
      petals.push({
        th: th0 + k * TAU / 3 + jit(r, .2), r0: .02, len: R(r, .9, 1.1), wid: .55, belly: .45, round: .55, n: 16,
        spine: s => [s, .45 * s * s], cross: .15, ruffle: .05, rf: 3, ph: r() * 9,
        c: C.bract, cb: C.bractBack, veins: 7, veinA: .28, veinCol: C.vein, veinW: .012, trans: .6,
      });
    }
    const extras = [{ d: v.depth(0, 0, .3), draw: (c2, proj, sz) => {
      c2.fillStyle = C.flower;
      for (let k = 0; k < 3; k++) {
        const a = th0 + k * TAU / 3 + Math.PI / 3, p = proj(Math.cos(a) * .14, Math.sin(a) * .14, .32);
        c2.beginPath(); circle(c2, p[0], p[1], sz * .07); c2.fill();
      }
    } }];
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }

  scene('garden', 'bougainvillea', (ctx, P, r) => {
    const night = P.night, mag = P.blue, leafG = P.green, terra = P.yellow;
    // The whitewashed wall, lit by the sun or by a lamp at night.
    const wall = night ? mixHex(P.lighter_background, P.foreground, .16) : tint(P.background, .55);
    const wallDark = night ? P.background : mixHex(P.background, P.darker_background, .6);
    skyGradient(ctx, [[0, night ? mixHex(wall, wallDark, .5) : wall], [.7, wall], [.92, wallDark], [1, wallDark]]);
    const lampX = 1480, lampY = 330;
    if (night) {
      glow(ctx, lampX, lampY, 0, 1300, hue(terra, .75, .1), .5);
      glow(ctx, lampX, lampY, 0, 340, hue(terra, .9, .08), .5);
    } else {
      glow(ctx, 250, -100, 0, 1500, '#ffffff', .6);
      glow(ctx, 1700, 1200, 0, 1200, hue(terra, .85, .05), .25);
    }
    // Plaster: soft blotches and a few fine cracks.
    const tex = soft(.25);
    for (let i = 0; i < 700; i++) {
      tex.x.fillStyle = rgba(r() < .5 ? '#000000' : '#ffffff', night ? R(r, .015, .04) : R(r, .008, .025));
      tex.x.beginPath(); ellipse(tex.x, R(r, 0, W), R(r, 0, 1000), R(r, 10, 60), R(r, 3, 14), jit(r, .3)); tex.x.fill();
    }
    put(ctx, tex, 4);
    ctx.strokeStyle = rgba(shade(wall, .5), night ? .14 : .1); ctx.lineWidth = .9;
    for (let i = 0; i < 4; i++) {
      let x = R(r, 300, 1600), y = R(r, 200, 900);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 7; k++) { x += jit(r, 10); y += R(r, 4, 12); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    // The stone floor and the foot of the wall.
    ctx.fillStyle = linear(ctx, 0, 990, 0, H, [[0, shade(wallDark, night ? .3 : .12)], [.06, night ? mixHex(wallDark, terra, .15) : mixHex(wallDark, hue(terra, .8, .05), .5)], [1, night ? shade(wallDark, .3) : mixHex(wallDark, hue(terra, .7, .06), .5)]]);
    ctx.fillRect(0, 990, W, 90);

    const C = night ? {
      bract: [[0, hue(mag, .62, .12)], [.5, hue(mag, .52, .19)], [1, hue(mag, .6, .2)]], bractBack: [[0, hue(mag, .45, .12)], [1, hue(mag, .5, .17)]],
      vein: hue(mag, .35, .14), flower: hue(terra, .92, .04),
    } : {
      bract: [[0, hue(mag, .78, .1)], [.5, hue(mag, .6, .24)], [1, hue(mag, .66, .23)]], bractBack: [[0, hue(mag, .6, .14)], [1, hue(mag, .58, .2)]],
      vein: hue(mag, .45, .17), flower: hue(terra, .96, .03),
    };
    const lc = leafCols(P, leafG, night ? .38 : .5, .95);
    const lightV = night ? [.7, -.2, .3] : [-.6, -.7, .5];
    const shadowCol = night ? shade(P.darker_background, .3) : mixHex(wallDark, hue(mag, .35, .08), .4);
    const sdx = night ? -50 : 55, sdy = night ? 30 : 60;

    // Collect the cascades first, so their shadows can fall on the wall.
    const parts = [];
    const cascade = (x0, y0, x1, y1, bend, mass, count) => {
      const pts = bez([x0, y0], [x0 + bend, lerp(y0, y1, .2)], [x1 + bend * .4, lerp(y0, y1, .6)], [x1, y1], 30);
      parts.push({ t: 'stem', pts });
      for (let i = 0; i < count; i++) {
        const t = r() ** .8, p = pts[Math.round(t * 30)], spread = mass * (1 - t * .5);
        const x = p[0] + jit(r, spread), y = p[1] + jit(r, spread * .8);
        if (r() < .35) parts.push({ t: 'leaf', x, y, a: R(r, 0, TAU), len: R(r, 34, 60) });
        else parts.push({ t: 'bract', x, y, size: R(r, 22, 36) * (1 - t * .25), e: R(r, .6, 1.3), roll: jit(r, 1) });
      }
    };
    cascade(-60, -40, 260, 820, 340, 110, 210);
    cascade(-40, 120, 120, 1000, 160, 80, 120);
    cascade(200, -60, 760, 260, 160, 80, 110);
    cascade(W + 50, -50, 1680, 420, -200, 80, 110);
    // The pot and the bush in it.
    const potX = 1600, potY = 790;
    cascade(potX - 20, potY - 40, potX - 300, potY - 200, -40, 45, 30);
    cascade(potX + 20, potY - 40, potX + 280, potY - 260, 40, 45, 30);
    cascade(potX - 70, potY, potX - 230, potY + 170, -110, 40, 26);
    cascade(potX + 70, potY, potX + 210, potY + 150, 100, 40, 24);
    // A dense mound over the rim.
    for (let i = 0; i < 150; i++) {
      const a = r() * Math.PI, d = Math.sqrt(r()), x = potX + Math.cos(a) * d * 230, y = potY + 10 - Math.sin(a) * d * 230;
      if (r() < .32) parts.push({ t: 'leaf', x, y, a: R(r, 0, TAU), len: R(r, 34, 58) });
      else parts.push({ t: 'bract', x, y, size: R(r, 24, 34), e: R(r, .6, 1.3), roll: jit(r, 1) });
    }

    // Shadows on the wall.
    const sh = soft(.6);
    sh.x.fillStyle = shadowCol; sh.x.strokeStyle = shadowCol;
    for (const q of parts) {
      sh.x.beginPath();
      if (q.t === 'stem') { sh.x.lineWidth = 5; line(sh.x, q.pts.map(([x, y]) => [x + sdx, y + sdy])); sh.x.stroke(); continue; }
      if (q.t === 'leaf') leaf(sh.x, q.x + sdx, q.y + sdy, q.len, q.len * .3, q.a);
      else for (let k = 0; k < 3; k++) { const a = q.roll * 3 + k * TAU / 3; ellipse(sh.x, q.x + sdx + Math.cos(a) * q.size * .5, q.y + sdy + Math.sin(a) * q.size * .45, q.size * .55, q.size * .36, a); }
      sh.x.fill();
    }
    sh.x.beginPath(); poly(sh.x, [[potX - 150 + sdx * .3, potY], [potX + 150 + sdx * 1.5, potY + sdy * .5], [potX + 100 + sdx * 1.6, 1000], [potX - 100, 1000]]); sh.x.fill();
    put(ctx, sh, night ? 12 : 2.5, night ? .4 : .22);

    // The terracotta pot.
    const pw = 150, top = potY, bot = 1035;
    const potBody = night ? hue(terra, .48, .08) : hue(terra, .62, .1);
    ctx.fillStyle = rgba('#000000', night ? .45 : .2);
    ctx.beginPath(); ellipse(ctx, potX + 20, bot + 4, pw * 1.1, 18, 0); ctx.fill();
    ctx.fillStyle = linear(ctx, potX - pw, 0, potX + pw, 0, night ? [[0, shade(potBody, .45)], [.65, potBody], [1, tint(potBody, .15)]] : [[0, tint(potBody, .25)], [.35, potBody], [1, shade(potBody, .4)]]);
    ctx.beginPath(); ctx.moveTo(potX - pw * .95, top + 40); ctx.lineTo(potX + pw * .95, top + 40); ctx.lineTo(potX + pw * .68, bot); ctx.lineTo(potX - pw * .68, bot); ctx.closePath(); ctx.fill();
    ctx.fillStyle = linear(ctx, potX - pw, 0, potX + pw, 0, night ? [[0, shade(potBody, .35)], [.65, tint(potBody, .08)], [1, tint(potBody, .2)]] : [[0, tint(potBody, .35)], [.35, tint(potBody, .1)], [1, shade(potBody, .35)]]);
    ctx.fillRect(potX - pw * 1.05, top, pw * 2.1, 46);
    ctx.fillStyle = rgba('#000000', .18); ctx.fillRect(potX - pw * .95, top + 46, pw * 1.9, 8);
    ctx.fillStyle = shade(potBody, .55);
    ctx.beginPath(); ellipse(ctx, potX, top + 2, pw * 1.02, 10, 0); ctx.fill();

    // Stems, leaves and bracts.
    for (const q of parts) if (q.t === 'stem') stem(ctx, q.pts, 7, 3, night ? hue(terra, .32, .05) : hue(terra, .45, .06), null);
    const bO = { dark: night ? shade(P.darker_background, .3) : hue(mag, .3, .1), shadeAmt: night ? .5 : .3, shadow: rgba(shadowCol, .5), sblur: .1, soff: .03, pleat: .12, rim: night ? hue(terra, .9, .05) : '#ffffff', rimA: .4, rimW: .015, sheen: night ? 0 : .12 };
    for (const q of parts) {
      if (q.t === 'leaf') leaf2(ctx, q.x, q.y, q.a, q.len, q.len * .32, lc, { belly: .35, round: .9, fold: .25, veins: 4 });
      else if (q.t === 'bract') bracts(ctx, q.x, q.y, q.size, view(q.e, q.roll, lightV), C, r, bO);
    }
    finish(ctx, P, r, night ? .5 : .1, night ? .045 : .035);
  });

  // ---------- garden/peonies ----------

  // A full peony: broad guard petals outside, then rings of cupped, crumpled
  // petals that close into a ball at the center.
  function peony(ctx, x, y, size, v, C, r, o = {}, stamens = 0) {
    const K = 8, petals = [], th0 = r() * TAU;
    for (let k = 0; k < K; k++) {
      const q = k / (K - 1), n = k === 0 ? 7 : Math.round(lerp(10, 7, q));
      const phi = lerp(.12, 1.35, q ** .8), len = lerp(1, .42, q), r0 = .03 + .12 * (1 - q), h0 = .14 * q;
      const curl = lerp(-.12, .55, q), stops = C.ring(q);
      for (let i = 0; i < n; i++) {
        const th = th0 + (i + k * .37) / n * TAU + jit(r, .2), l = len * R(r, .88, 1.1), ph = phi + jit(r, .14);
        petals.push({
          th, r0, len: l, wid: l * lerp(.62, .5, q), belly: .66, round: .42, n: 22,
          spine: sv => [sv * Math.cos(ph) - curl * sv * sv, h0 / l + sv * Math.sin(ph) + (q < .2 ? -.12 : .05) * sv * sv],
          cross: lerp(.1, .22, q), ruffle: lerp(.08, .16, q), rf: 3 + r() * 3, ph: r() * 9, scallop: q > .3 ? .06 : 0, sf: 4 + Math.floor(r() * 3),
          wave: lerp(.05, .1, q), wf: 4 + r() * 3, wph: r() * 6, c: stops, cb: C.back, veins: q < .3 ? 12 : 0, veinA: .08, veinCol: C.vein, trans: .5,
        });
      }
    }
    const extras = [coreOf(C.ring(1)[0][1], .25, .12)];
    if (stamens) extras.push({ d: v.depth(0, 0, .3), draw: (c2, proj, sz) => {
      for (let i = 0; i < stamens; i++) {
        const a = r() * TAU, d = R(r, .05, .2), p = proj(Math.cos(a) * d, Math.sin(a) * d, .32 + r() * .06);
        c2.fillStyle = r() < .5 ? C.gold : C.goldDark;
        c2.beginPath(); circle(c2, p[0], p[1], sz * R(r, .012, .022)); c2.fill();
      }
    } });
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }
  // A peony bud: a ball of folded petals held by green sepals.
  function peonyBud(ctx, x, y, rad, C, lc, a) {
    const bx = x + Math.cos(a) * rad * .85, by = y + Math.sin(a) * rad * .85;
    stem(ctx, bez([bx + Math.cos(a) * rad * 4, by + Math.sin(a) * rad * 4], [bx + Math.cos(a) * rad * 2, by + Math.sin(a) * rad * 2.5], [bx, by + rad], [bx, by], 12), rad * .2, rad * .16, lc.dark, lc.light);
    ctx.fillStyle = radial(ctx, x - rad * .35, y - rad * .4, rad * .1, rad * 1.1, [[0, C.budHi], [.6, C.bud], [1, C.budDark]]);
    ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
    ctx.strokeStyle = rgba(C.budDark, .45); ctx.lineWidth = Math.max(.5, rad * .035);
    ctx.beginPath(); ctx.moveTo(x - rad * .1, y - rad * .95); ctx.quadraticCurveTo(x + rad * .55, y - rad * .1, x + rad * .05, y + rad * .95);
    ctx.moveTo(x - rad * .6, y - rad * .7); ctx.quadraticCurveTo(x - rad * .1, y, x - rad * .55, y + rad * .75); ctx.stroke();
    for (let k = 0; k < 3; k++) leaf2(ctx, bx, by, a + Math.PI + (k - 1) * 1.05, rad * 1.05, rad * .42, lc, { belly: .4, round: .8, veins: 2, fold: .3, bend: (k - 1) * .3 });
  }

  scene('garden', 'peonies', (ctx, P, r) => {
    const night = P.night, pink = P.blue, mauve = P.magenta, blush = P.cyan, leafG = P.green, gold = P.yellow;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.5, P.background], [1, mixHex(P.background, P.selection, .5)]]);
      glow(ctx, 900, 420, 0, 900, pink, .1);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .5)], [.6, P.background], [1, mixHex(P.background, hue(leafG, .9, .04), .5)]]);
      glow(ctx, 1000, 300, 0, 1100, '#ffffff', .7);
    }
    const ringCol = (L, c) => q => [[0, hue(mauve, L - .06 - q * .2, c * 1.1)], [.45, hue(pink, L - .03 - q * .08, c)], [1, hue(blush, L + .06 - q * .04, c * .75)]];
    const C = night ? {
      ring: ringCol(.7, .15), back: [[0, hue(pink, .6, .12)], [1, hue(pink, .66, .13)]], vein: hue(mauve, .4, .12),
      gold: hue(gold, .82, .14), goldDark: hue(gold, .66, .13), bud: hue(pink, .55, .13), budHi: hue(blush, .75, .08), budDark: hue(mauve, .35, .1),
    } : {
      ring: ringCol(.85, .12), back: [[0, hue(pink, .76, .1)], [1, hue(pink, .8, .1)]], vein: hue(mauve, .55, .1),
      gold: hue(gold, .86, .15), goldDark: hue(gold, .72, .14), bud: hue(pink, .7, .14), budHi: hue(blush, .88, .07), budDark: hue(mauve, .48, .12),
    };
    const lc = leafCols(P, leafG, night ? .36 : .5, .95);
    const lightV = night ? [-.4, -.7, .3] : [-.5, -.7, .5];
    const pO = { dark: night ? shade(P.darker_background, .2) : hue(mauve, .35, .1), shadeAmt: night ? .55 : .35, shadow: rgba(night ? '#000000' : hue(mauve, .4, .1), night ? .5 : .25), sblur: .05, soff: .02, pleat: .07, pleatCol: night ? hue(blush, .9, .04) : '#ffffff', rim: night ? hue(blush, .9, .05) : '#ffffff', rimA: .45, rimW: .006, sheen: night ? .06 : .12, glowCol: hue(blush, .85, .08) };
    // A peony leaf: 3 to 5 long lobes from 1 point.
    const pLeaf = (c2, x, y, a, len) => {
      const ex = x + Math.cos(a) * len * .45, ey = y + Math.sin(a) * len * .45;
      stem(c2, [[x, y], [ex, ey]], len * .03, len * .02, lc.dark, lc.light);
      for (let k = 0; k < 3; k++) leaf2(c2, ex, ey, a + (k - 1) * .5 + jit(r, .1), len * (k === 1 ? 1 : .8) * R(r, .9, 1.05), len * .13, lc, { belly: .42, round: 1.25, bend: (k - 1) * .15 + jit(r, .08), veins: 6, fold: .26, shadow: rgba('#000000', night ? .35 : .12) });
    };

    // Blooms further back, out of focus.
    const far = soft(.4);
    for (let i = 0; i < 9; i++) pLeaf(far.x, R(r, 600, 1400), R(r, 500, 1100), R(r, 0, TAU), R(r, 140, 220));
    peony(far.x, 980, 980, 170, view(.8, .2, lightV), C, r, { dark: pO.dark, shadeAmt: .45 });
    peony(far.x, 760, 140, 140, view(.9, -.3, lightV), C, r, { dark: pO.dark, shadeAmt: .45 });
    put(ctx, far, 9, .7);

    // Leaves, buds and the big blooms.
    [[60, 1000, -.9], [520, 1080, -1.9], [200, 560, -1.2], [1500, 1080, -1.4], [1880, 760, -2.6], [1350, 380, -2.2], [1880, 420, -2.9], [430, 1000, -.3]].forEach(([x, y, a]) => pLeaf(ctx, x, y, a, R(r, 220, 320)));
    peonyBud(ctx, 660, 640, 62, C, lc, 1.9);
    peonyBud(ctx, 1250, 130, 52, C, lc, 2.4);
    peonyBud(ctx, 1230, 900, 46, C, lc, 1.2);
    peony(ctx, 1640, 250, 300, view(.95, .25, lightV), C, r, pO, 0);
    peony(ctx, 1560, 980, 230, view(.75, -.2, lightV), C, r, pO, 26);
    peony(ctx, 330, 790, 390, view(.9, -.15, lightV), C, r, pO, 0);
    finish(ctx, P, r, night ? .5 : .1, night ? .045 : .035);
  });

  // ---------- small florets on domes ----------

  // A flower outline with n round lobes, radius 1, for florets seen face on.
  function lobed(n, depth = .35) {
    const p = new Path2D();
    for (let i = 0; i <= n * 8; i++) {
      const a = i / (n * 8) * TAU, q = 1 - depth * (1 - Math.abs(Math.cos(a * n / 2)) ** .6);
      const x = Math.cos(a - Math.PI / 2) * q, y = Math.sin(a - Math.PI / 2) * q;
      if (i) p.lineTo(x, y); else p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }
  // Florets over a ball in a view v. The florets gather in bumps, and each
  // one faces along its own normal, so florets at the rim look thin. The paint
  // function draws 1 floret from an object with x, y, ang, face, lit and depth.
  function ball(ctx, x, y, rad, v, r, o, paint) {
    const { bumps = 30, per = 14, spread = .3, bump = .14, low = -1, flat = 1 } = o, items = [];
    // Bump centers sit evenly on the sphere, on a golden angle spiral.
    const total = Math.round(bumps * 2.2), rot = r() * TAU;
    for (let j = 0; j < total; j++) {
      const z = 1 - 2 * (j + .5) / total, q = Math.sqrt(1 - z * z), th = j * 2.39996 + rot;
      const c = unit([Math.cos(th) * q + jit(r, .08), Math.sin(th) * q + jit(r, .08), z + jit(r, .08)]);
      if (c[2] < low || dot(c, v.cam) < -.25) continue;
      for (let i = 0; i < per; i++) {
        const d = unit([c[0] + jit(r, spread), c[1] + jit(r, spread), c[2] + jit(r, spread)]);
        const off = Math.hypot(d[0] - c[0], d[1] - c[1], d[2] - c[2]) / (spread * 1.2);
        const h = rad * (1 + bump * (1 - clamp(off, 0, 1) ** 2));
        const n = unit([d[0] + (d[0] - c[0]) * 1.4, d[1] + (d[1] - c[1]) * 1.4, d[2] + (d[2] - c[2]) * 1.4]);
        const face = dot(n, v.cam);
        if (face < .02 || d[2] < low) continue;
        const [X, Y] = v.p(d[0] * h, d[1] * h, d[2] * h * flat), [nx, ny] = v.p(n[0], n[1], n[2] * flat);
        items.push({ x: x + X, y: y + Y, ang: Math.atan2(ny, nx), face, lit: dot(n, v.light), depth: v.depth(d[0] * h, d[1] * h, d[2] * h * flat) });
      }
    }
    items.sort((a2, b2) => a2.depth - b2.depth);
    for (const f of items) paint(ctx, f);
    return items.length;
  }

  // ---------- garden/heliotrope ----------

  scene('garden', 'heliotrope', (ctx, P, r) => {
    const night = P.night, vio = P.blue, bv = P.green, pale = P.cyan, purple = P.red;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.55, P.background], [1, mixHex(P.background, P.selection, .55)]]);
      glow(ctx, 980, 380, 0, 900, vio, .12);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .5)], [.6, P.background], [1, mixHex(P.background, P.lighter_background, .8)]]);
      glow(ctx, 900, 300, 0, 1100, '#ffffff', .7);
    }
    const lightV = night ? [-.4, -.7, .4] : [-.5, -.7, .5];
    const ramp = night ? [hue(purple, .3, .1), hue(vio, .42, .13), hue(vio, .54, .15), hue(bv, .66, .13), hue(pale, .8, .08)]
      : [hue(purple, .42, .13), hue(vio, .52, .16), hue(vio, .62, .15), hue(bv, .72, .12), hue(pale, .86, .06)];
    const eye = night ? hue(pale, .9, .03) : '#ffffff';
    const flower5 = lobed(5, .42);
    const paint = (c2, f, s) => {
      const k = clamp(f.lit * .55 + .5, 0, 1) * (.55 + .45 * f.face), col = ramp[Math.min(4, Math.floor(k * 4.99))];
      c2.save();
      c2.translate(f.x, f.y); c2.rotate(f.ang); c2.scale(s * Math.max(.2, f.face), s);
      c2.fillStyle = rgba(ramp[0], .7); c2.beginPath(); circle(c2, .12, .12, 1.05); c2.fill();
      c2.fillStyle = col; c2.fill(flower5);
      c2.fillStyle = rgba(ramp[0], .5); c2.beginPath(); circle(c2, 0, 0, .28); c2.fill();
      if (k > .4) { c2.fillStyle = rgba(eye, .4 + k * .5); c2.beginPath(); circle(c2, 0, 0, .14); c2.fill(); }
      c2.restore();
    };
    const lc = { light: night ? hue(vio, .38, .06) : hue(vio, .56, .09), dark: night ? hue(purple, .22, .06) : hue(purple, .38, .1), tip: night ? hue(vio, .42, .06) : hue(vio, .6, .08), vein: night ? hue(pale, .55, .05) : hue(pale, .78, .05), shade: hue(purple, .12, .06) };
    const hLeaf = (c2, x, y, a, len) => leaf2(c2, x, y, a, len, len * .3, lc, { belly: .42, round: 1.05, bend: jit(r, .15), veins: 9, veinA: .55, fold: .3, rimA: .2, shadow: rgba('#000000', night ? .45 : .18) });
    // A cluster: a lumpy dome of florets over a ring of leaves.
    const cluster = (c2, x, y, rad, s, lod = 1) => {
      for (let i = 0; i < 6; i++) {
        const a = Math.PI * (.05 + i / 5 * .9) + jit(r, .25);
        hLeaf(c2, x + Math.cos(a) * rad * R(r, .3, .6), y + rad * R(r, .05, .3), a + jit(r, .35), rad * R(r, .95, 1.6));
      }
      const v = view(.62 + jit(r, .1), jit(r, .2), lightV);
      c2.fillStyle = radial(c2, x, y - rad * .2, rad * .2, rad * .95, [[0, rgba(ramp[0], 1)], [.7, rgba(ramp[0], .85)], [1, rgba(ramp[0], 0)]]);
      c2.beginPath(); ellipse(c2, x, y - rad * .2, rad * .95, rad * .7, 0); c2.fill();
      const bumps = Math.round(lerp(24, 80, lod)), per = Math.round((rad / s) ** 2 * 2.7 / bumps) + 3;
      ball(c2, x, y, rad, v, r, { bumps, per, spread: .32, bump: .16, low: -.25, flat: .8 }, (cc, f) => paint(cc, f, s * R(r, .85, 1.15)));
    };
    // Clusters further back, out of focus.
    const far = soft(.4);
    cluster(far.x, 820, 920, 150, 12, 0);
    cluster(far.x, 1150, 250, 110, 10, 0);
    cluster(far.x, 560, 110, 100, 10, 0);
    put(ctx, far, 7, .75);
    cluster(ctx, 1730, 150, 190, 15);
    cluster(ctx, 140, 330, 200, 15);
    cluster(ctx, 1430, 1000, 210, 16);
    cluster(ctx, 1700, 690, 270, 17);
    cluster(ctx, 330, 860, 280, 17);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/nightshade ----------

  // A nightshade flower: 5 narrow petals swept back around a yellow cone.
  function nightshade(ctx, x, y, size, v, C, r, o) {
    const petals = [], th0 = r() * TAU;
    for (let k = 0; k < 5; k++) {
      petals.push({
        th: th0 + k * TAU / 5 + jit(r, .1), r0: .04, len: R(r, .9, 1.05), wid: .2, belly: .4, round: 1.15, n: 14,
        spine: s => [s - .1 * s * s, .15 * s - .7 * s * s], cross: .05, c: C.petal, cb: C.petalBack, veins: 3, veinA: .25, veinCol: C.vein, trans: .4,
      });
    }
    const extras = [{ d: v.depth(0, 0, .4), draw: (c2, proj, sz) => {
      // Green spots at the petal bases.
      c2.fillStyle = C.spot;
      for (let k = 0; k < 5; k++) for (const sd of [-1, 1]) {
        const a = th0 + k * TAU / 5 + sd * .13, p = proj(Math.cos(a) * .15, Math.sin(a) * .15, .01);
        c2.beginPath(); circle(c2, p[0], p[1], sz * .035); c2.fill();
      }
      // The cone of fused anthers.
      const base = Array.from({ length: 12 }, (_, i) => { const a = i / 12 * TAU; return proj(Math.cos(a) * .12, Math.sin(a) * .12, .02); });
      const tip = proj(0, 0, .62), mid = proj(0, 0, .2);
      let left = base[0], right = base[0];
      const ax = tip[0] - mid[0], ay = tip[1] - mid[1], al = Math.hypot(ax, ay) || 1;
      for (const b of base) { const sd = (b[0] - mid[0]) * ay / al - (b[1] - mid[1]) * ax / al; if (sd < (left[0] - mid[0]) * ay / al - (left[1] - mid[1]) * ax / al) left = b; if (sd > (right[0] - mid[0]) * ay / al - (right[1] - mid[1]) * ax / al) right = b; }
      c2.fillStyle = linear(c2, left[0], left[1], right[0], right[1], [[0, C.coneLit], [.5, C.cone], [1, C.coneDark]]);
      c2.beginPath(); trace(c2, base); c2.fill();
      c2.beginPath(); poly(c2, [left, tip, right, mid]); c2.fill();
      c2.strokeStyle = rgba(C.coneDark, .6); c2.lineWidth = Math.max(.3, sz * .012);
      c2.beginPath(); c2.moveTo(mid[0], mid[1]); c2.lineTo(tip[0], tip[1]); c2.stroke();
      c2.fillStyle = C.coneTip; c2.beginPath(); circle(c2, tip[0], tip[1], sz * .03); c2.fill();
    } }];
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }
  // A glossy berry with a highlight.
  function berry(ctx, x, y, rad, col, hi, dark, lx = -.4, ly = -.5) {
    ctx.fillStyle = radial(ctx, x + lx * rad * .45, y + ly * rad * .45, rad * .05, rad * 1.15, [[0, tint(col, .25)], [.45, col], [1, dark]]);
    ctx.beginPath(); ellipse(ctx, x, y, rad * .92, rad, 0); ctx.fill();
    ctx.fillStyle = rgba(hi, .85);
    ctx.beginPath(); ellipse(ctx, x + lx * rad * .45, y + ly * rad * .45, rad * .2, rad * .14, -.6); ctx.fill();
  }

  scene('garden', 'nightshade', (ctx, P, r) => {
    const night = P.night, vio = P.blue, purple = P.magenta, lav = P.cyan, yg = P.green, yel = P.yellow, red = P.red, org = P.orange;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.55, P.background], [1, mixHex(P.background, P.selection, .5)]]);
      glow(ctx, 1250, 300, 0, 950, vio, .14);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .5)], [.6, P.background], [1, mixHex(P.background, hue(yg, .9, .05), .45)]]);
      glow(ctx, 1200, 260, 0, 1100, '#ffffff', .7);
    }
    const lightV = night ? [.4, -.7, .3] : [-.5, -.7, .5];
    const C = night ? {
      petal: [[0, hue(purple, .4, .14)], [.5, hue(vio, .56, .17)], [1, hue(vio, .66, .14)]], petalBack: [[0, hue(purple, .32, .12)], [1, hue(vio, .48, .14)]],
      vein: hue(purple, .3, .14), spot: hue(yg, .7, .1), cone: hue(yel, .78, .15), coneLit: hue(yel, .9, .12), coneDark: hue(yel, .55, .12), coneTip: hue(yg, .5, .1),
    } : {
      petal: [[0, hue(purple, .5, .16)], [.5, hue(vio, .62, .18)], [1, hue(vio, .72, .14)]], petalBack: [[0, hue(purple, .42, .14)], [1, hue(vio, .56, .16)]],
      vein: hue(purple, .4, .16), spot: hue(yg, .78, .12), cone: hue(yel, .84, .17), coneLit: hue(yel, .94, .12), coneDark: hue(yel, .62, .14), coneTip: hue(yg, .55, .12),
    };
    const fO = { dark: night ? shade(P.darker_background, .3) : hue(purple, .3, .1), shadeAmt: night ? .5 : .3, shadow: rgba(night ? '#000000' : hue(purple, .3, .1), night ? .5 : .22), sblur: .08, rim: night ? hue(lav, .9, .05) : '#ffffff', rimA: .5, rimW: .012, pleat: .1 };
    const lc = leafCols(P, mixHex(yg, vio, .25), night ? .36 : .5, .9);
    const vineCol = night ? hue(purple, .32, .06) : hue(purple, .45, .07), vineHi = night ? hue(lav, .6, .05) : hue(lav, .8, .04);
    const berryCols = night ? [[hue(red, .55, .19), hue(red, .25, .12)], [hue(org, .66, .17), hue(org, .3, .12)], [hue(yg, .6, .14), hue(yg, .3, .1)]]
      : [[hue(red, .58, .2), hue(red, .32, .14)], [hue(org, .7, .17), hue(org, .38, .13)], [hue(yg, .7, .15), hue(yg, .4, .12)]];
    const hi = night ? hue(lav, .95, .03) : '#ffffff';

    // A cyme of flowers or berries hanging from the point x, y.
    const cyme = (c2, x, y, size, kind, n) => {
      const ex = x + jit(r, size * .5), ey = y + size * R(r, 1.2, 2);
      c2.strokeStyle = vineCol; c2.lineWidth = Math.max(.5, size * .05);
      c2.beginPath(); c2.moveTo(x, y); c2.quadraticCurveTo(x + jit(r, size * .4), lerp(y, ey, .5), ex, ey); c2.stroke();
      const items = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + jit(r, 1.5), d = size * R(r, .6, 1.6);
        items.push([ex + Math.cos(a) * d, ey + Math.sin(a) * d * .8, a]);
      }
      items.sort((p, q) => p[1] - q[1]);
      for (const [fx, fy] of items) {
        c2.lineWidth = Math.max(.4, size * .035);
        c2.beginPath(); c2.moveTo(ex, ey); c2.lineTo(fx, fy); c2.stroke();
      }
      for (const [fx, fy, a] of items) {
        if (kind === 'berry') {
          const [col, dk] = pick(r, berryCols);
          berry(c2, fx, fy, size * R(r, .32, .42), col, hi, dk, lightV[0], lightV[1]);
        } else if (r() < .2) {
          c2.fillStyle = linear(c2, fx, fy - size * .3, fx, fy + size * .3, [[0, C.petal[2][1]], [1, C.petal[0][1]]]);
          c2.beginPath(); ellipse(c2, fx, fy, size * .18, size * .3, a - Math.PI / 2); c2.fill();
        } else nightshade(c2, fx, fy, size * R(r, .75, .95), view(R(r, .35, 1.2), jit(r, .8), lightV), C, r, fO);
      }
    };
    // A twining vine with leaves, flowers and berries.
    const vine = (c2, pts, w, size, lod) => {
      const wav = pts.map(([x, y], i) => [x + Math.sin(i * .9) * 6, y + Math.cos(i * .7) * 6]);
      stem(c2, wav, w, w * .4, vineCol, vineHi, .3);
      const n = wav.length - 1;
      let sd = 1;
      for (let i = 1; i < n; i += 1 + Math.floor(r() * 3)) {
        const p = wav[i], q = wav[i + 1], da = Math.atan2(q[1] - p[1], q[0] - p[0]);
        sd = -sd;
        const len = size * R(r, 1.8, 3.1);
        leaf2(c2, p[0], p[1], da + sd * R(r, .5, 1.3), len, len * R(r, .3, .38), lc, { belly: .32, round: 1, bend: sd * R(r, 0, .2), veins: 5, fold: .25, shadow: rgba('#000000', night ? .4 : .15) });
      }
      // Tendrils that curl at the end.
      c2.strokeStyle = vineCol; c2.lineWidth = Math.max(.5, w * .2);
      for (let i = 2; i < n; i += 5) {
        const p = wav[i]; let a = R(r, 0, TAU), x = p[0], y = p[1], step = size * .12;
        c2.beginPath(); c2.moveTo(x, y);
        for (let k = 0; k < 26; k++) { a += .1 + k * .018; x += Math.cos(a) * step; y += Math.sin(a) * step; step *= .95; c2.lineTo(x, y); }
        c2.stroke();
      }
      for (let i = 3; i < n; i += 2 + Math.floor(r() * 3)) {
        const p = wav[i];
        cyme(c2, p[0], p[1], size, r() < .38 ? 'berry' : 'flower', lod ? 4 + Math.floor(r() * 5) : 4);
      }
    };
    const path = (pts, n = 30) => { const out = []; for (let i = 0; i < pts.length - 1; i++) out.push(...bez(pts[i], [lerp(pts[i][0], pts[i + 1][0], .33), pts[i][1] + 40], [lerp(pts[i][0], pts[i + 1][0], .66), pts[i + 1][1] - 40], pts[i + 1], n).slice(i ? 1 : 0)); return out; };
    // A vine further back, out of focus.
    const far = soft(.45);
    vine(far.x, path([[640, -40], [860, 150], [1240, 80], [1460, -40]], 9), 7, 32, 0);
    vine(far.x, path([[900, H + 40], [1100, 960], [1300, H + 40]], 8), 7, 30, 0);
    put(ctx, far, 6, .7);
    vine(ctx, path([[-60, 140], [240, 80], [520, 230], [820, 120]], 10), 12, 52, 1);
    vine(ctx, path([[W + 60, 260], [1720, 400], [1580, 680], [1720, 960], [1660, H + 60]], 8), 12, 54, 1);
    vine(ctx, path([[-60, 720], [200, 860], [420, 990], [560, H + 60]], 8), 12, 50, 1);
    const near = soft(.45);
    vine(near.x, path([[W + 80, -40], [1720, 140], [1500, 40]], 7), 20, 84, 0);
    put(ctx, near, 11, .9);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/hydrangea ----------

  // 4 rounded sepals around a small eye, radius 1.
  const sepals4 = (() => {
    const p = new Path2D();
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + Math.PI / 4, c = Math.cos(a), s = Math.sin(a);
      const at = (u, v) => [c * u - s * v, s * u + c * v];
      const p0 = at(.08, 0), p1 = at(.45, -.62), p2 = at(1.05, -.42), p3 = at(1.02, 0), p4 = at(1.05, .42), p5 = at(.45, .62);
      p.moveTo(...p0); p.bezierCurveTo(...p1, ...p2, ...p3); p.bezierCurveTo(...p4, ...p5, ...p0); p.closePath();
    }
    return p;
  })();

  scene('garden', 'hydrangea', (ctx, P, r) => {
    const night = P.night, N = makeNoise(Math.floor(r() * 1e9));
    const ramp = [P.cyan, P.green, P.blue, P.magenta, P.yellow, P.red];
    const at = t => { t = clamp(t, 0, .999) * (ramp.length - 1); const i = Math.floor(t); return mixHex(ramp[i], ramp[i + 1], t - i); };
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.55, P.background], [1, mixHex(P.background, P.selection, .55)]]);
      glow(ctx, 960, 420, 0, 900, P.blue, .12);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .5)], [.6, P.background], [1, mixHex(P.background, P.lighter_background, .9)]]);
      glow(ctx, 1000, 260, 0, 1100, '#ffffff', .75);
    }
    const bk = soft(.3);
    for (let i = 0; i < 26; i++) bokeh(bk.x, R(r, 400, 1500), R(r, 150, 950), R(r, 30, 110), at(r()), night ? R(r, .06, .16) : R(r, .1, .22));
    put(ctx, bk, 8);
    const lightV = night ? [-.4, -.7, .4] : [-.5, -.7, .5];
    const teal = P.cyan;
    const lc = { light: hue(teal, night ? .42 : .62, .06), dark: hue(teal, night ? .24 : .46, .06), tip: hue(teal, night ? .46 : .66, .05), vein: hue(teal, night ? .6 : .8, .04), shade: hue(teal, night ? .1 : .3, .05) };
    const hLeaf = (c2, x, y, a, len) => leaf2(c2, x, y, a, len, len * .36, lc, { belly: .45, round: .95, bend: jit(r, .15), serr: .05, teeth: 20, veins: 7, veinA: .45, fold: .28, shadow: rgba('#000000', night ? .45 : .18) });
    // A mophead: a ball of 4-sepal florets that shifts in color across the head.
    const head = (c2, x, y, rad, t0, s, lod = 1) => {
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (.05 + i / 4 * .9) + jit(r, .3);
        hLeaf(c2, x + Math.cos(a) * rad * .6, y + Math.sin(a) * rad * .5, a + jit(r, .3), rad * R(r, 1, 1.4));
      }
      const v = view(.35 + jit(r, .1), jit(r, .3), lightV), base = at(t0);
      c2.fillStyle = radial(c2, x, y, rad * .1, rad * 1.1, [[0, hue(base, night ? .44 : .7, .09)], [.7, hue(base, night ? .3 : .58, .09)], [.94, hue(base, night ? .26 : .54, .09)], [1, rgba(hue(base, night ? .26 : .54, .09), 0)]]);
      c2.beginPath(); circle(c2, x, y, rad * 1.1); c2.fill();
      const bumps = Math.round(lerp(30, 100, lod)), per = Math.round((rad / s) ** 2 * 4.2 / bumps) + 2;
      ball(c2, x, y, rad, v, r, { bumps, per, spread: .26, bump: .1 }, (cc, f) => {
        const k = clamp(f.lit * .55 + .5, 0, 1) * (.6 + .4 * f.face);
        const tt = t0 + fbm(N, f.x / 260, f.y / 260, 2) * .5;
        const col = at(tt), L = night ? lerp(.36, .76, k) : lerp(.5, .9, k), C = night ? .13 : .12;
        const sz = s * R(r, .85, 1.15);
        cc.save();
        cc.translate(f.x, f.y); cc.rotate(f.ang); cc.scale(sz * Math.max(.2, f.face), sz); cc.rotate(r() * TAU);
        cc.fillStyle = radial(cc, 0, 0, 0, 1.05, [[0, hue(col, Math.min(.95, L + .12), C * .5)], [.4, hue(col, L, C)], [1, hue(col, L - .08, C * 1.1)]]);
        cc.fill(sepals4);
        if (lod) { cc.strokeStyle = rgba(hue(col, L - .25, C), .35); cc.lineWidth = .05; cc.stroke(sepals4); }
        cc.fillStyle = hue(col, L - .2, C * 1.2); cc.beginPath(); circle(cc, 0, 0, .1); cc.fill();
        cc.restore();
      });
    };
    const far = soft(.4);
    head(far.x, 880, 980, 150, .45, 20, 0);
    head(far.x, 640, 120, 120, .2, 18, 0);
    head(far.x, 1180, 160, 110, .75, 18, 0);
    put(ctx, far, 7, .75);
    head(ctx, 1520, 120, 200, .15, 26);
    head(ctx, 130, 300, 210, .62, 26);
    head(ctx, 1290, 1010, 190, .85, 26);
    head(ctx, 1690, 640, 290, .35, 30);
    head(ctx, 330, 850, 300, .9, 30);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/eucalyptus ----------

  // A round leaf, tilted away by tilt, with a powdery bloom and a faint rim.
  function roundLeaf(ctx, x, y, rad, ang, tilt, C, o = {}) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang); ctx.scale(1, tilt);
    if (o.shadow) shadowOn(ctx, o.shadow, rad * .25, rad * (o.sdx ?? .06), rad * .12);
    const path = new Path2D();
    path.moveTo(0, -rad * .02);
    path.bezierCurveTo(rad * .65, -rad * .06, rad * 1.02, rad * .35, rad * .98, rad * .95);
    path.bezierCurveTo(rad * .94, rad * 1.6, rad * .3, rad * 2, -rad * .02, rad * 2);
    path.bezierCurveTo(-rad * .4, rad * 2, -rad * 1, rad * 1.55, -rad * .98, rad * .95);
    path.bezierCurveTo(-rad * 1, rad * .35, -rad * .62, -rad * .06, 0, -rad * .02);
    ctx.fillStyle = radial(ctx, -rad * .3, rad * .7, rad * .1, rad * 1.5, [[0, C.hi], [.55, C.mid], [1, C.edge]]);
    ctx.fill(path);
    shadowOff(ctx);
    ctx.save();
    ctx.clip(path);
    ctx.strokeStyle = rgba(C.vein, .45); ctx.lineWidth = Math.max(.4, rad * .035);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(rad * .05, rad, 0, rad * 1.9); ctx.stroke();
    ctx.lineWidth = Math.max(.3, rad * .018);
    ctx.beginPath();
    for (let i = 1; i < 5; i++) for (const sd of [-1, 1]) { const y0 = rad * i * .38; ctx.moveTo(0, y0); ctx.quadraticCurveTo(sd * rad * .45, y0 + rad * .1, sd * rad * .78, y0 + rad * .45); }
    ctx.stroke();
    ctx.strokeStyle = rgba(C.rim, .5); ctx.lineWidth = Math.max(.5, rad * .08);
    ctx.stroke(path);
    ctx.restore();
    ctx.restore();
  }
  // A gum nut: a small woody cup with 4 valves in its top.
  function gumNut(ctx, x, y, s, ang, C) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = linear(ctx, -s * .5, 0, s * .5, 0, [[0, C.nutHi], [.5, C.nut], [1, C.nutDark]]);
    ctx.beginPath(); ctx.moveTo(-s * .5, -s * .1); ctx.quadraticCurveTo(-s * .45, s * .55, 0, s * .7); ctx.quadraticCurveTo(s * .45, s * .55, s * .5, -s * .1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.nutTop;
    ctx.beginPath(); ellipse(ctx, 0, -s * .1, s * .5, s * .2, 0); ctx.fill();
    ctx.fillStyle = C.nutDark;
    ctx.beginPath(); ellipse(ctx, 0, -s * .1, s * .3, s * .11, 0); ctx.fill();
    ctx.strokeStyle = C.nutTop; ctx.lineWidth = Math.max(.4, s * .05);
    ctx.beginPath(); ctx.moveTo(-s * .3, -s * .1); ctx.lineTo(s * .3, -s * .1); ctx.moveTo(0, -s * .21); ctx.lineTo(0, s * .01); ctx.stroke();
    ctx.restore();
  }

  scene('garden', 'eucalyptus', (ctx, P, r) => {
    const night = P.night, silver = P.cyan, teal = P.blue, sage = P.green, rose = P.magenta, nutRed = P.red, tan = P.orange;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .2)], [.5, P.background], [1, mixHex(P.background, P.lighter_background, .8)]]);
      glow(ctx, 1500, 150, 0, 1150, silver, .12);
    } else {
      skyGradient(ctx, [[0, tint(P.background, .6)], [.6, P.background], [1, mixHex(P.background, P.dark_background, .8)]]);
      glow(ctx, 420, 110, 0, 1200, '#ffffff', .75);
    }
    // A few soft lights near the edges, out of focus.
    const bk = soft(.3);
    for (let i = 0; i < 10; i++) bokeh(bk.x, r() < .5 ? R(r, 0, 480) : R(r, 1440, W), R(r, 100, 1000), R(r, 30, 100), pick(r, [silver, sage, teal]), night ? R(r, .04, .1) : R(r, .03, .07));
    put(ctx, bk, 8);
    const LC = (L, c, base) => ({ hi: hue(silver, L + .14, c * .5), mid: hue(base, L, c), edge: hue(sage, L - .12, c * 1.1), vein: hue(silver, L + .22, c * .4), rim: hue(rose, L + .04, .06) });
    const Cs = night ? [LC(.52, .05, teal), LC(.56, .045, silver), LC(.48, .055, sage), LC(.5, .05, teal)] : [LC(.7, .055, teal), LC(.74, .045, silver), LC(.66, .06, sage), LC(.68, .05, teal)];
    const haze = night ? P.background : tint(P.background, .4);
    const Cf = Cs.map(c => ({ hi: mixHex(c.hi, haze, .45), mid: mixHex(c.mid, haze, .45), edge: mixHex(c.edge, haze, .45), vein: mixHex(c.vein, haze, .45), rim: mixHex(c.rim, haze, .45) }));
    const Cn = { nut: hue(nutRed, night ? .42 : .52, .07), nutHi: hue(tan, night ? .6 : .72, .06), nutDark: hue(nutRed, night ? .24 : .32, .06), nutTop: hue(tan, night ? .5 : .62, .05) };
    const stemCol = night ? hue(nutRed, .36, .06) : hue(nutRed, .48, .07), stemHi = night ? hue(rose, .6, .04) : hue(rose, .74, .04);
    const sh = rgba(night ? '#000000' : hue(teal, .3, .05), night ? .5 : .2), sdx = night ? -.08 : .08;
    // A sprig: round leaves in pairs along a curved stem. The pairs turn in
    // turn: 1 pair lies flat to the viewer, the next points toward and away.
    const sprig = (c2, pts, w, rad0, rad1, nutAt = [], o2 = {}) => {
      const n = pts.length - 1, back = [], front = [], cols = o2.cols || Cs, shadow = o2.flat ? null : sh;
      // Side shoots grow first, so the main stem lies over them.
      for (const [t, sd, len] of o2.shoots || []) {
        const i = Math.round(t * n), p = pts[i], q = pts[Math.min(n, i + 1)], da = Math.atan2(q[1] - p[1], q[0] - p[0]), a = da + sd * 1;
        const e = [p[0] + Math.cos(a) * len, p[1] + Math.sin(a) * len];
        const sub = bez(p, [p[0] + Math.cos(a - sd * .3) * len * .4, p[1] + Math.sin(a - sd * .3) * len * .4], [e[0] - Math.cos(a + sd * .4) * len * .3, e[1] - Math.sin(a + sd * .4) * len * .3], e, 12);
        sprig(c2, sub, w * .45, lerp(rad0, rad1, t) * .62, rad1 * .5, [], { ...o2, shoots: [] });
      }
      let k = 0;
      for (let i = 2; i < n; i += 2, k++) {
        const t = i / n, p = pts[i], q = pts[Math.min(n, i + 1)], da = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const rad = lerp(rad0, rad1, t) * R(r, .9, 1.06);
        if (k % 2 === 0) {
          for (const sd of [-1, 1]) front.push([p[0], p[1], da + sd * (Math.PI / 2 - .3 + jit(r, .2)) - Math.PI / 2, rad, R(r, .8, 1)]);
        } else {
          back.push([p[0], p[1], da - Math.PI / 2 + jit(r, .3) - Math.PI / 2, rad * .95, R(r, .3, .45)]);
          front.push([p[0], p[1], da + Math.PI / 2 + jit(r, .3) - Math.PI / 2, rad * .95, R(r, .38, .55)]);
        }
      }
      // A small pair of leaves closes the tip.
      const tp = pts[n], tq = pts[n - 1], ta = Math.atan2(tp[1] - tq[1], tp[0] - tq[0]);
      for (const sd of [-1, 1]) front.push([tp[0], tp[1], ta + sd * .55 - Math.PI / 2, rad1 * .62, R(r, .75, .95)]);
      for (const [x, y, a, rr, tl] of back) roundLeaf(c2, x, y, rr, a, tl, pick(r, cols), { shadow, sdx });
      stem(c2, pts, w, w * .4, stemCol, stemHi, .35);
      for (const [x, y, a, rr, tl] of front) roundLeaf(c2, x, y, rr, a, tl, pick(r, cols), { shadow, sdx });
      // Clusters of gum nuts on short stalks.
      for (const t of nutAt) {
        const i = Math.round(t * n), p = pts[i], q = pts[Math.min(n, i + 1)], da = Math.atan2(q[1] - p[1], q[0] - p[0]);
        const side = o2.nutSide ?? 1, s2 = o2.nut ?? 28, pa = da + side * (Math.PI / 2 - .2), reach = s2 * 3.4;
        const ex = p[0] + Math.cos(pa) * reach, ey = p[1] + Math.sin(pa) * reach;
        c2.strokeStyle = stemCol; c2.lineCap = 'round';
        c2.lineWidth = Math.max(.6, s2 * .16); c2.beginPath(); c2.moveTo(p[0], p[1]); c2.lineTo(ex, ey); c2.stroke();
        const m = 4 + Math.floor(r() * 3), nuts = [];
        for (let j = 0; j < m; j++) { const a = pa + (j / (m - 1) - .5) * 2.6 + jit(r, .15), l = s2 * R(r, 1, 1.45); nuts.push([ex + Math.cos(a) * l, ey + Math.sin(a) * l, a]); }
        c2.lineWidth = Math.max(.5, s2 * .1);
        for (const [nx, ny] of nuts) { c2.beginPath(); c2.moveTo(ex, ey); c2.lineTo(nx, ny); c2.stroke(); }
        nuts.sort((p2, q2) => p2[1] - q2[1]);
        for (const [nx, ny, a] of nuts) gumNut(c2, nx, ny, s2 * R(r, .85, 1.05), a - Math.PI / 2 + Math.PI, Cn);
        c2.lineCap = 'butt';
      }
    };
    const curve = (p0, p1, p2, p3, n = 26) => bez(p0, p1, p2, p3, n);
    // 2 sprigs far behind, soft and pale.
    const far = soft(.4);
    sprig(far.x, curve([1260, -50], [1250, 80], [1180, 180], [1080, 250], 16), 6, 40, 30, [], { flat: 1, cols: Cf });
    sprig(far.x, curve([700, H + 50], [720, 960], [800, 880], [860, 830], 14), 6, 40, 30, [], { flat: 1, cols: Cf });
    put(ctx, far, 6, .7);
    // 3 large sprigs that sweep in from the corners.
    sprig(ctx, curve([-100, -80], [240, 30], [560, 150], [820, 390], 28), 15, 110, 50, [.3, .62], { nutSide: 1, nut: 36, shoots: [[.22, -1, 380], [.48, 1, 330]] });
    sprig(ctx, curve([-100, H + 60], [130, 960], [320, 860], [470, 740], 22), 12, 88, 44, [.45], { nutSide: -1, nut: 32, shoots: [[.32, 1, 300]] });
    sprig(ctx, curve([W + 100, H + 80], [1680, 900], [1400, 770], [1160, 690], 28), 15, 112, 50, [.42], { nutSide: -1, nut: 36, shoots: [[.2, 1, 380], [.46, -1, 330]] });
    // A sprig close to the lens, out of focus.
    const near = soft(.45);
    sprig(near.x, curve([W + 90, -90], [1840, 60], [1720, 140], [1560, 210], 12), 22, 140, 110, [], { flat: 1 });
    put(ctx, near, 12, .9);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/bracken ----------

  // A bracken frond: an upright stipe, then a curved rachis with pairs of
  // pinnae, each lined with lobed pinnules. squash below 1 lays the blade
  // flat, as bracken holds it. The cols function gives the colors at each point
  // t along the frond.
  function frond(ctx, x, y, ang, len, cols, r, o = {}) {
    const { bend = .5, pairs = 13, lobes = 12, w = 1, droop = .3, squash = 1, stipe = 0, lean = 0, shade: sh = '#000000' } = o;
    let x0 = x, y0 = y;
    if (stipe) {
      const sx = x + lean, sy = y - stipe;
      ctx.strokeStyle = cols(0).stalk; ctx.lineWidth = Math.max(.7, len * .012 * w);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * .2, lerp(y, sy, .6), sx, sy); ctx.stroke();
      x0 = sx; y0 = sy;
    }
    const end = ang + bend;
    const pts = bez([x0, y0], [x0 + Math.cos(ang) * len * .4, y0 + Math.sin(ang) * len * .4],
      [x0 + Math.cos(lerp(ang, end, .6)) * len * .75, y0 + Math.sin(lerp(ang, end, .6)) * len * .75], [x0 + Math.cos(end) * len, y0 + Math.sin(end) * len], 40);
    ctx.strokeStyle = cols(0).stalk; ctx.lineWidth = Math.max(.6, len * .008 * w);
    ctx.beginPath(); line(ctx, pts); ctx.stroke();
    for (let i = 0; i < pairs; i++) {
      const t = .04 + i / pairs * .92, k = Math.round(t * 40), p = pts[k], q = pts[Math.min(40, k + 1)], o2 = pts[Math.max(0, k - 1)];
      const da = Math.atan2(q[1] - o2[1], q[0] - o2[0]), pl = len * .44 * (1 - t) ** .8 * R(r, .88, 1.08);
      const c = cols(t);
      for (const sd of [-1, 1]) {
        const pa = da + sd * R(r, .95, 1.2);
        const dx = Math.cos(pa), dy = Math.sin(pa) * squash;
        const ex = p[0] + dx * pl, ey = p[1] + dy * pl + pl * droop;
        const cx = p[0] + dx * pl * .5, cy = p[1] + dy * pl * .5 + pl * droop * .1;
        const at = u => [(1 - u) * (1 - u) * p[0] + 2 * u * (1 - u) * cx + u * u * ex, (1 - u) * (1 - u) * p[1] + 2 * u * (1 - u) * cy + u * u * ey];
        const n = Math.max(3, Math.round(lobes * (pl / (len * .44)) ** .5)), top = new Path2D(), bot = new Path2D();
        for (let j = 0; j < n; j++) {
          const u = (j + .5) / n, [bx, by] = at(u), [nx, ny] = at(Math.min(1, u + .03));
          const ta = Math.atan2(ny - by, nx - bx), ll = pl * .25 * (1 - u * .72) + 1.2, lw = Math.min(ll * .3, pl / n * .62);
          for (const s2 of [-1, 1]) {
            const la = ta + s2 * 1.2, path = s2 === sd ? bot : top;
            const ux = Math.cos(la), uy = Math.sin(la) * (.4 + .6 * squash);
            const tx = bx + ux * ll, ty = by + uy * ll, px = -uy * lw, py = ux * lw;
            path.moveTo(bx, by);
            path.quadraticCurveTo(bx + ux * ll * .5 + px, by + uy * ll * .5 + py, tx, ty);
            path.quadraticCurveTo(bx + ux * ll * .5 - px, by + uy * ll * .5 - py, bx, by);
          }
        }
        ctx.fillStyle = sd < 0 ? c.top : c.bot; ctx.fill(top);
        ctx.fillStyle = sd < 0 ? c.mid : c.bot; ctx.fill(bot);
        ctx.strokeStyle = rgba(sh, .22); ctx.lineWidth = Math.max(.4, len * .0035 * w);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.quadraticCurveTo(cx, cy, ex, ey); ctx.stroke();
      }
    }
  }

  scene('garden', 'bracken', (ctx, P, r) => {
    const night = P.night, rust = P.red, gold = P.yellow, tan = P.blue, olive = P.green, org = P.orange;
    const N = makeNoise(Math.floor(r() * 1e9));
    const skyTop = night ? shade(P.darker_background, .25) : mixHex(tint(P.background, .4), hue(tan, .9, .03), .3);
    const skyLow = night ? mixHex(P.lighter_background, P.muted, .4) : mixHex(P.background, hue(gold, .9, .08), .55);
    skyGradient(ctx, [[0, skyTop], [.42, night ? P.background : tint(P.background, .2)], [.62, skyLow], [1, skyLow]]);
    const sunX = night ? 1380 : 1240, sunY = night ? 220 : 400;
    if (night) {
      stars(ctx, r, 150, [0, 0, W, 480], [P.foreground, P.bright_yellow], 1.5);
      moon(ctx, sunX, sunY, 36, tone(P.foreground, .92, .5), tint(P.bright_yellow, .2), r);
    } else {
      glow(ctx, sunX, sunY, 0, 1300, hue(gold, .92, .1), .55);
      glow(ctx, sunX, sunY, 0, 300, '#ffffff', .9);
    }
    const hazeC = skyLow;
    const ramp = night ? [hue(rust, .42, .1), hue(org, .5, .1), hue(gold, .6, .09), hue(tan, .5, .08), hue(olive, .46, .06)]
      : [hue(rust, .52, .13), hue(org, .62, .13), hue(gold, .76, .12), hue(tan, .64, .11), hue(olive, .58, .08)];
    const colAt = (t, mist) => { t = clamp(t, 0, .999) * (ramp.length - 1); const i = Math.floor(t); const c = mixHex(ramp[i], ramp[i + 1], t - i); return mist ? mixHex(c, hazeC, mist) : c; };
    const cols = (c0, c1, mist) => t => {
      const c = colAt(lerp(c0, c1, t), mist);
      return { top: tint(c, night ? .06 : .14), mid: c, bot: shade(c, night ? .32 : .18), stalk: shade(c, .45) };
    };
    const shd = night ? '#000000' : hue(rust, .3, .08);
    // 1 frond with its blade held flat, pointing left or right.
    const one = (c2, x, y, len, mist, o2 = {}) => {
      const dir = o2.dir || (r() < .5 ? -1 : 1), c0 = r(), c1 = clamp(c0 + jit(r, .35), 0, 1);
      const a = dir < 0 ? Math.PI + R(r, .1, .4) : -R(r, .1, .4);
      frond(c2, x, y, a, len, cols(c0, c1, mist), r, { bend: dir * R(r, .35, .7), squash: o2.squash ?? R(r, .55, .8), stipe: len * (o2.stipe ?? R(r, .1, .3)), lean: jit(r, len * .08), pairs: len > 300 ? 16 : len > 120 ? 12 : 8, lobes: len > 300 ? 16 : len > 120 ? 11 : 6, droop: .12, shade: shd });
    };
    // Moor hills in the mist, with a fringe of small fronds along each ridge.
    const hills = soft(.4);
    [[640, 150, .0011, 2, .74, 50], [740, 120, .0015, 5, .6, 70]].forEach(([b2, a2, f, sh, m, fl]) => {
      const pts = ridgePoints(N, b2, a2, f, sh);
      fillRidge(hills.x, pts, mixHex(night ? shade(olive, .6) : hue(rust, .56, .07), hazeC, m));
      // Patches of rust and gold where bracken covers the slope.
      hills.x.save();
      hills.x.beginPath(); hills.x.moveTo(pts[0][0], H + 10); pts.forEach(p2 => hills.x.lineTo(p2[0], p2[1])); hills.x.lineTo(pts[pts.length - 1][0], H + 10); hills.x.clip();
      for (let i = 0; i < 160; i++) {
        const x = R(r, -50, W + 50), y = b2 - a2 * .2 + R(r, -a2 * .6, 260);
        hills.x.fillStyle = rgba(colAt(r(), m * .9), R(r, .25, .5));
        hills.x.beginPath(); ellipse(hills.x, x, y, R(r, 30, 110), R(r, 8, 22), 0); hills.x.fill();
      }
      hills.x.restore();
      for (let i = 0; i < pts.length; i += 5) { const [x, y] = pts[i]; if (r() < .6) one(hills.x, x + jit(r, 20), y + R(r, 10, 40), fl * R(r, .8, 1.5), m * .8, { stipe: .1 }); }
    });
    put(ctx, hills, 4.5);
    // Layers of fronds: soft and misty behind, sharp in front.
    const big = (c2, x, y, a, len, c0, c1, mist, o2 = {}) => frond(c2, x, y, a, len, cols(c0, c1, mist), r, { bend: o2.bend ?? .5, squash: o2.squash ?? .85, droop: o2.droop ?? .12, pairs: o2.pairs ?? 16, lobes: o2.lobes ?? 15, w: o2.w ?? 1.4, shade: shd });
    const l1 = soft(.4);
    for (let i = 0; i < 12; i++) { const x = lerp(200, 1720, i / 11) + jit(r, 60), left = x < W / 2; big(l1.x, x, H + 140, -Math.PI / 2 + (left ? .5 : -.5) + jit(r, .3), R(r, 340, 460), r(), r(), .45, { bend: (left ? 1 : -1) * R(r, .5, .9), pairs: 11, lobes: 9, squash: .6 }); }
    put(ctx, l1, 6, .9);
    const l2 = soft(.6);
    for (let i = 0; i < 8; i++) { const x = lerp(80, 1840, i / 7) + jit(r, 60), left = x < W / 2; big(l2.x, x, H + 120, -Math.PI / 2 + (left ? .6 : -.6) + jit(r, .25), R(r, 420, 560), r(), r(), .2, { bend: (left ? 1 : -1) * R(r, .5, .8), pairs: 13, lobes: 11, squash: .7 }); }
    put(ctx, l2, 2.4);
    // Big fronds that reach in from the corners.
    big(ctx, -60, H + 40, -.95, 880, .1, .45, 0, { bend: .75 });
    big(ctx, -40, 520, -.18, 620, .3, .7, 0, { bend: .55, squash: .7 });
    big(ctx, W + 60, H + 40, -Math.PI + .95, 860, .55, .2, 0, { bend: -.75 });
    big(ctx, W + 40, 360, Math.PI + .2, 560, .7, .35, 0, { bend: -.55, squash: .7 });
    if (!night) {
      // The low sun shines through the fronds.
      const sh = soft(.3);
      sh.x.fillStyle = radial(sh.x, sunX, sunY + 160, 0, 1000, [[0, rgba(hue(gold, .9, .12), .6)], [1, rgba(hue(gold, .9, .12), 0)]]);
      sh.x.fillRect(0, 0, W, H);
      put(ctx, sh, 0, .6, 'soft-light');
    }
    const near = soft(.4);
    big(near.x, 260, H + 120, -1.3, 700, .2, .5, 0, { bend: .6, pairs: 11, lobes: 9, w: 2 });
    put(ctx, near, 10, .75);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/moonlit-garden ----------

  // A rose: broad outer petals with rolled tips around a tight spiral heart.
  function rose(ctx, x, y, size, v, C, r, o) {
    const K = 6, petals = [], th0 = r() * TAU;
    for (let k = 0; k < K; k++) {
      const q = k / (K - 1), n = k < 2 ? 5 : Math.round(lerp(5, 3, q));
      const phi = lerp(.25, 1.45, q ** .7), len = lerp(1, .38, q), r0 = .02 + .06 * (1 - q), h0 = .12 * q, curl = lerp(-.25, .7, q);
      for (let i = 0; i < n; i++) {
        const th = th0 + (i + k * .5) / n * TAU + jit(r, .15), l = len * R(r, .9, 1.08), ph = phi + jit(r, .1);
        petals.push({
          th, r0, len: l, wid: l * .62, belly: .62, round: .45, n: 20,
          spine: sv => [sv * Math.cos(ph) - curl * sv * sv, h0 / l + sv * Math.sin(ph) + (q < .3 ? -.25 : .1) * sv * sv],
          cross: lerp(.12, .35, q), ruffle: .05, rf: 3, ph: r() * 9, c: C.ring(q), cb: C.back, veins: 0, trans: .5,
        });
      }
    }
    return blossom(ctx, x, y, size, v, petals, [coreOf(C.ring(1)[0][1], .2, .1)], o);
  }
  // A moonflower: 5 wide petals joined into a pale trumpet.
  function moonflower(ctx, x, y, size, v, C, r, o) {
    const petals = [], th0 = r() * TAU;
    for (let k = 0; k < 5; k++) {
      petals.push({
        th: th0 + k * TAU / 5, r0: .03, len: 1, wid: .72, belly: .7, round: .38, n: 20,
        spine: s => [s, .55 * s * s + .1 * s], cross: .1, ruffle: .05, rf: 2, ph: r() * 9, scallop: .1, sf: 2,
        c: C.trumpet, cb: C.trumpetBack, veins: 1, veinA: .3, veinCol: C.star, veinW: .02, trans: .6,
      });
    }
    const extras = [{ d: v.depth(0, 0, .2), draw: (c2, proj, sz) => {
      const [cx, cy] = proj(0, 0, .02);
      c2.fillStyle = radial(c2, cx, cy, 0, sz * .3, [[0, C.throat], [1, rgba(C.throat, 0)]]);
      c2.beginPath(); circle(c2, cx, cy, sz * .3); c2.fill();
    } }];
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }
  // A primrose: 5 notched petals around a gold eye.
  function primrose(ctx, x, y, size, v, C, r, o) {
    const petals = [], th0 = r() * TAU;
    for (let k = 0; k < 5; k++) {
      petals.push({ th: th0 + k * TAU / 5, r0: .03, len: 1, wid: .55, belly: .68, round: .45, n: 18, spine: s => [s, .12 * s * s], cross: .05, scallop: .25, sf: 2, ph: 0, c: C.prim, cb: C.prim, trans: .4 });
    }
    const extras = [{ d: v.depth(0, 0, .1), draw: (c2, proj, sz) => {
      const [cx, cy] = proj(0, 0, .02);
      c2.fillStyle = C.eye; c2.beginPath(); circle(c2, cx, cy, sz * .16); c2.fill();
    } }];
    return blossom(ctx, x, y, size, v, petals, extras, o);
  }

  // A delphinium floret: 5 rounded petals around a dark eye.
  function floret5(ctx, x, y, size, v, C, r, o) {
    const petals = [], th0 = r() * TAU;
    for (let k = 0; k < 5; k++) {
      petals.push({ th: th0 + k * TAU / 5, r0: .05, len: 1, wid: .62, belly: .62, round: .45, n: 10, spine: s => [s, .2 * s * s], cross: .06, c: C.petal, cb: C.back, trans: .4 });
    }
    const eye = { d: v.depth(0, 0, .3), draw: (c2, proj, sz) => {
      const [cx, cy] = proj(0, 0, .05);
      c2.fillStyle = C.eye; c2.beginPath(); circle(c2, cx, cy, sz * .22); c2.fill();
      c2.fillStyle = C.eyeHi; c2.beginPath(); circle(c2, cx - sz * .05, cy - sz * .06, sz * .08); c2.fill();
    } };
    return blossom(ctx, x, y, size, v, petals, [eye], o);
  }

  scene('garden', 'moonlit-garden', (ctx, P, r) => {
    const night = P.night, roseC = P.red, leafG = P.green, prim = P.yellow, moonC = P.blue, phlox = P.magenta, aqua = P.cyan;
    const N = makeNoise(Math.floor(r() * 1e9));
    // The ground in perspective: distance d and side offset X show at
    // x = 960 + X / d and y = yh + A / d.
    const yh = 500, A = 580, dH = 6.4, hy = yh + A / dH;
    const gx = (X, d) => 960 + X / d, gy = d => yh + A / d, dAt = y => A / Math.max(1, y - yh);
    const pathX = d => 170 * Math.sin(d * .7 + .4), HW = 230;
    // A screen row y, picked so that points spread evenly over the ground.
    const rowY = (y0, y1) => yh + Math.sqrt(lerp((y0 - yh) ** 2, (y1 - yh) ** 2, r()));
    const sunX = 1440, sunY = 165;
    if (night) {
      skyGradient(ctx, [[0, shade(P.darker_background, .1)], [.3, mixHex(P.background, moonC, .06)], [yh / H, mixHex(P.lighter_background, moonC, .18)], [1, P.background]]);
      stars(ctx, r, 300, [0, 0, W, yh - 80], [P.foreground, P.bright_blue, P.bright_cyan], 1.6);
      moon(ctx, sunX, sunY, 54, tone(P.foreground, .95, .4), tint(P.bright_blue, .3), r);
    } else {
      skyGradient(ctx, [[0, hue(aqua, .86, .045)], [.38, tint(P.background, .35)], [yh / H, mixHex(P.background, hue(prim, .93, .05), .45)], [1, P.background]]);
      glow(ctx, sunX, sunY, 0, 1100, '#ffffff', .8);
      glow(ctx, sunX, sunY, 0, 280, hue(prim, .95, .06), .5);
    }
    const hazeC = night ? mixHex(P.lighter_background, moonC, .18) : mixHex(P.background, hue(prim, .93, .05), .45);
    const litC = night ? mixHex(moonC, P.foreground, .5) : '#ffffff';

    // Trees behind the hedge: a canopy of crowns with clumps of leaves, lit
    // from the side of the moon or the sun, and a few slim cypresses.
    const trees = soft(.45);
    const treeC = night ? mixHex(shade(leafG, .8), moonC, .1) : hue(leafG, .56, .06);
    [[.6, 30, 250, 360, 50, 110], [.34, 30, 330, 420, 40, 90]].forEach(([m, count, t0, t1, s0, s1]) => {
      const base = mixHex(treeC, hazeC, m), crowns = [];
      for (let i = 0; i < count; i++) { const x = R(r, -80, W + 80), s2 = R(r, s0, s1); crowns.push([x, R(r, t0, t1) + s2, s2]); }
      trees.x.fillStyle = base;
      trees.x.beginPath(); crowns.forEach(([x, y, s2]) => circle(trees.x, x, y, s2)); trees.x.rect(-20, t1 + 20, W + 40, hy - t1); trees.x.fill();
      const lit = new Path2D(), dark = new Path2D();
      for (const [x, y, s2] of crowns) for (let k = 0; k < 16; k++) {
        const a = -Math.PI / 2 + jit(r, 1.6), d2 = s2 * R(r, .45, .95);
        circle(Math.sin(a) < -.2 && Math.cos(a) > -.5 ? lit : dark, x + Math.cos(a) * d2, y + Math.sin(a) * d2, s2 * R(r, .12, .26));
      }
      trees.x.fillStyle = shade(base, night ? .22 : .08); trees.x.fill(dark);
      trees.x.fillStyle = mixHex(base, litC, night ? .07 : .22); trees.x.fill(lit);
    });
    for (const [x, h2] of [[230, 330], [296, 270], [1660, 350], [1730, 280]]) {
      const base = mixHex(treeC, hazeC, .26);
      trees.x.fillStyle = linear(trees.x, x - 34, 0, x + 34, 0, [[0, shade(base, .25)], [.6, base], [1, mixHex(base, litC, .26)]]);
      trees.x.beginPath(); trees.x.moveTo(x, hy - h2 - 40); trees.x.quadraticCurveTo(x + 44, hy - h2 * .55, x + 30, hy); trees.x.lineTo(x - 30, hy); trees.x.quadraticCurveTo(x - 44, hy - h2 * .55, x, hy - h2 - 40); trees.x.fill();
    }
    put(ctx, trees, 1.8);

    // The lawn, with mowing stripes that meet at the far end of the view.
    const lawn = night ? shade(leafG, .8) : hue(leafG, .58, .1), lawnFar = night ? mixHex(shade(leafG, .72), moonC, .1) : hue(leafG, .7, .08);
    ctx.fillStyle = linear(ctx, 0, hy - 40, 0, H, [[0, mixHex(lawnFar, hazeC, .3)], [.15, lawnFar], [1, lawn]]);
    ctx.fillRect(0, hy - 40, W, H - hy + 40);
    for (let k = -14; k <= 14; k += 2) {
      const X0 = k * 190, X1 = X0 + 190;
      ctx.fillStyle = rgba(night ? moonC : '#ffffff', night ? .025 : .06);
      ctx.beginPath(); poly(ctx, [[gx(X0, dH), hy], [gx(X1, dH), hy], [gx(X1, .85), gy(.85)], [gx(X0, .85), gy(.85)]]); ctx.fill();
    }

    // The clipped hedge: a leafy face, lit along the top, with an opening for the path.
    const hTop = yh - A * .32 / dH, topAt = x => hTop + fbm(N, x * .012, 7.3, 3) * 9;
    const gapL = gx(pathX(dH) - HW * 1.12, dH), gapR = gx(pathX(dH) + HW * 1.12, dH);
    const hedgeC = night ? mixHex(shade(leafG, .7), moonC, .07) : hue(leafG, .44, .1);
    const tones = [shade(hedgeC, night ? .55 : .45), shade(hedgeC, .25), hedgeC, mixHex(hedgeC, litC, .12), mixHex(hedgeC, litC, .24), mixHex(hedgeC, litC, .38)];
    for (const [x0, x1] of [[-20, gapL], [gapR, W + 20]]) {
      ctx.fillStyle = linear(ctx, 0, hTop - 8, 0, hy, [[0, tones[3]], [.3, tones[2]], [1, tones[0]]]);
      ctx.beginPath(); ctx.moveTo(x0, hy + 2);
      for (let x = x0; x < x1; x += 6) ctx.lineTo(x, topAt(x));
      ctx.lineTo(x1, topAt(x1)); ctx.lineTo(x1, hy + 2); ctx.closePath(); ctx.fill();
    }
    // Through the opening: the lawn goes on to the trees.
    ctx.fillStyle = mixHex(lawnFar, hazeC, .45); ctx.fillRect(gapL, yh + 30, gapR - gapL, hy - yh - 28);
    ctx.fillStyle = tones[0];
    ctx.fillRect(gapL - 5, topAt(gapL) + 3, 5, hy - topAt(gapL) - 1); ctx.fillRect(gapR, topAt(gapR) + 3, 5, hy - topAt(gapR) - 1);
    const leafBins = tones.map(() => new Path2D());
    for (let i = 0; i < 11000; i++) {
      const x = R(r, -20, W + 20);
      if (x > gapL - 1 && x < gapR + 1) continue;
      const top = topAt(x), y = R(r, top - 5, hy), t = (y - top) / (hy - top), side = clamp((x - 300) / 1500, 0, 1);
      // Clumps of leaves catch the light on their upper side.
      const clump = fbm(N, x * .05, y * .07, 2);
      const k = clamp(Math.floor((1 - t) * 2.6 + side * 1.2 + clump * 2.4 + jit(r, 1)), 0, 5);
      ellipse(leafBins[k], x, y, R(r, 2.4, 5), R(r, 1.1, 2.3), r() * Math.PI);
    }
    leafBins.forEach((p2, k) => { ctx.fillStyle = tones[k]; ctx.fill(p2); });
    ctx.fillStyle = linear(ctx, 0, hy, 0, hy + 22, [[0, rgba('#000000', night ? .45 : .2)], [1, rgba('#000000', 0)]]);
    ctx.fillRect(0, hy, W, 22);

    // The path: gravel, then flat stones in rows.
    const edgeAt = (y, sd) => { const d = dAt(y); return gx(pathX(d) + sd * HW, d); };
    const pathPoly = [];
    for (let i = 0; i <= 60; i++) { const y = lerp(hy + 1, H + 40, (i / 60) ** 1.6); pathPoly.push([edgeAt(y, -1), y]); }
    for (let i = 60; i >= 0; i--) { const y = lerp(hy + 1, H + 40, (i / 60) ** 1.6); pathPoly.push([edgeAt(y, 1), y]); }
    const gravel = night ? mixHex(P.muted, moonC, .22) : hue(prim, .8, .025);
    const stoneC = night ? mixHex(P.muted, moonC, .32) : hue(prim, .74, .02), stoneLit = night ? mixHex(stoneC, P.foreground, .35) : hue(prim, .9, .015);
    ctx.save();
    ctx.beginPath(); trace(ctx, pathPoly); ctx.clip();
    ctx.fillStyle = linear(ctx, 0, hy, 0, H, [[0, mixHex(gravel, hazeC, .45)], [1, shade(gravel, night ? .25 : .1)]]);
    ctx.fillRect(0, hy, W, H - hy + 40);
    const gLight = new Path2D(), gDark = new Path2D();
    for (let i = 0; i < 5000; i++) {
      const y = rowY(hy + 2, H + 10), d = dAt(y), X = pathX(d) + jit(r, HW), s2 = 2.4 / d * R(r, .5, 1.4);
      ellipse(r() < .5 ? gLight : gDark, gx(X, d), y, s2, s2 * .6, 0);
    }
    ctx.fillStyle = rgba(stoneLit, .45); ctx.fill(gLight);
    ctx.fillStyle = rgba(night ? '#000000' : shade(gravel, .45), .3); ctx.fill(gDark);
    const stones = [];
    for (let d = .92; d < dH - .3;) {
      const dep = R(r, .26, .34);
      let X = -HW + R(r, 8, 20);
      while (X < HW - 60) {
        const X1 = Math.min(HW - R(r, 8, 18), X + R(r, 120, 220));
        stones.push([X, X1, d, d + dep]);
        X = X1 + R(r, 12, 22);
      }
      d += dep + R(r, .05, .08);
    }
    stones.sort((p2, q2) => q2[2] - p2[2]);
    for (const [X0, X1, d0, d1] of stones) {
      const cx = (X0 + X1) / 2, cd = (d0 + d1) / 2, rx = (X1 - X0) / 2, rd = (d1 - d0) / 2, pts = [];
      for (let k = 0; k < 18; k++) {
        const a = k / 18 * TAU, c = Math.cos(a), s2 = Math.sin(a), f = 1 + jit(r, .05);
        const X = cx + Math.sign(c) * Math.abs(c) ** .4 * rx * f, D = cd + Math.sign(s2) * Math.abs(s2) ** .4 * rd * f;
        pts.push([gx(pathX(D) + X, D), gy(D)]);
      }
      const path = new Path2D();
      smoothPath(path, pts, true);
      const fade = clamp((cd - 1) / (dH - 1), 0, 1) * .55, yT = gy(d1), yB = gy(d0);
      ctx.save(); ctx.translate(0, 2.2 / cd);
      ctx.fillStyle = rgba(night ? '#000000' : shade(gravel, .55), .4); ctx.fill(path);
      ctx.restore();
      ctx.fillStyle = linear(ctx, 0, yT, 0, yB, [[0, mixHex(stoneLit, hazeC, fade)], [.35, mixHex(stoneC, hazeC, fade)], [1, mixHex(shade(stoneC, night ? .3 : .14), hazeC, fade)]]);
      ctx.fill(path);
      if (cd < 2.6) {
        ctx.save(); ctx.clip(path);
        const sp = new Path2D(), sp2 = new Path2D();
        for (let k = 0; k < 40; k++) { const X = R(r, X0, X1), D = R(r, d0, d1); ellipse(k % 2 ? sp : sp2, gx(pathX(D) + X, D), gy(D), R(r, 1, 3.2) / cd, R(r, .6, 1.6) / cd, r() * 3); }
        ctx.fillStyle = rgba(stoneLit, .35); ctx.fill(sp);
        ctx.fillStyle = rgba(shade(stoneC, .4), .25); ctx.fill(sp2);
        ctx.restore();
      }
    }
    ctx.restore();

    const lightV = night ? [.5, -.6, -.2] : [.5, -.7, .4];
    const lc = leafCols(P, leafG, night ? .32 : .5, .9);
    // Grass along the edges of the path.
    for (let i = 0; i < 420; i++) {
      const y = rowY(hy + 4, H + 20), d = dAt(y), sd = r() < .5 ? -1 : 1, x = edgeAt(y, sd) + jit(r, 10 / d), h2 = R(r, 14, 30) / d;
      ctx.fillStyle = pick(r, [lc.dark, lc.light, lawn]);
      ctx.beginPath(); blade(ctx, x, y + 2, h2, jit(r, h2 * .4), Math.max(.8, 3 / d)); ctx.fill();
    }

    // Border plants on both sides: a mound of foliage, then flowers in drifts.
    const kinds = [roseC, prim, moonC, phlox, roseC, phlox, moonC];
    const kindAt = (X, d) => kinds[Math.floor(clamp(fbm(N, X / 420, d * .55, 2) * .9 + .5, 0, .999) * kinds.length)];
    const bed = soft(.9);
    const foliage = night ? mixHex(shade(leafG, .66), moonC, .05) : hue(leafG, .46, .1);
    for (const sd of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 40; i++) { const y = lerp(hy + 3, H + 40, (i / 40) ** 1.5), d = dAt(y); pts.push([gx(pathX(d) + sd * (HW + 14), d), y - 34 / d - fbm(N, d * 2, sd * 3, 2) * 14 / d]); }
      for (let i = 40; i >= 0; i--) { const y = lerp(hy + 3, H + 40, (i / 40) ** 1.5), d = dAt(y); pts.push([gx(pathX(d) + sd * 3200, d), y - 90 / d]); }
      bed.x.fillStyle = linear(bed.x, 0, hy, 0, H, [[0, mixHex(foliage, hazeC, .35)], [1, foliage]]);
      bed.x.beginPath(); trace(bed.x, pts); bed.x.fill();
    }
    // Low shrubs give the borders volume.
    const shrubs = [];
    for (let i = 0; i < 34; i++) { const d = R(r, 2.2, 6), sd = r() < .5 ? -1 : 1, X = sd * (HW + R(r, 500, 2600)); shrubs.push([gx(pathX(d) + X, d), gy(d), d, X]); }
    shrubs.sort((p2, q2) => p2[1] - q2[1]);
    for (const [x, y, d, X] of shrubs) {
      const s2 = R(r, 70, 130) / d, c = kindAt(X, d), top = mixHex(foliage, litC, night ? .1 : .3);
      bed.x.fillStyle = rgba('#000000', night ? .3 : .12);
      bed.x.beginPath(); ellipse(bed.x, x + s2 * .2, y, s2 * 1.4, s2 * .3, 0); bed.x.fill();
      bed.x.fillStyle = radial(bed.x, x + s2 * .3, y - s2 * 1.1, s2 * .1, s2 * 1.6, [[0, top], [.6, foliage], [1, shade(foliage, .2)]]);
      bed.x.beginPath(); ellipse(bed.x, x, y - s2 * .6, s2 * 1.3, s2 * .75, 0); bed.x.fill();
      for (let k = 0; k < 40; k++) {
        const a = r() * TAU, q = Math.sqrt(r());
        bed.x.fillStyle = hue(c, (night ? .58 : .7) + jit(r, .06), .13);
        bed.x.beginPath(); circle(bed.x, x + Math.cos(a) * q * s2 * 1.2, y - s2 * .7 + Math.sin(a) * q * s2 * .6, R(r, 2, 3.6) / d); bed.x.fill();
      }
    }
    // Foliage texture and far flowers, as small marks that shrink with distance.
    const fol = [new Path2D(), new Path2D()], blooms = new Map();
    for (let i = 0; i < 16000; i++) {
      const y = rowY(hy + 4, H - 120), d = dAt(y), sd = r() < .5 ? -1 : 1, X = sd * (HW + R(r, 20, 3000));
      const x = gx(pathX(d) + X, d), lift = R(r, 4, 70) / d;
      if (x < -20 || x > W + 20) continue;
      // Flowers grow in clumps, with foliage between them.
      if (r() < .4 || fbm(N, X / 260, d * 1.4 + 9, 2) < -.06) { ellipse(fol[r() < .5 ? 0 : 1], x, y - lift, 5 / d, 2.4 / d, r() * 3); continue; }
      const c = kindAt(X, d), key = c + (r() < .5 ? 'a' : 'b');
      if (!blooms.has(key)) blooms.set(key, new Path2D());
      circle(blooms.get(key), x, y - lift - 8 / d, R(r, 2.4, 4.2) / d);
    }
    bed.x.fillStyle = shade(foliage, .3); bed.x.fill(fol[0]);
    bed.x.fillStyle = mixHex(foliage, litC, .15); bed.x.fill(fol[1]);
    for (const [key, p2] of blooms) { bed.x.fillStyle = hue(key.slice(0, 7), (night ? .58 : .7) + (key.endsWith('a') ? .06 : -.04), .14); bed.x.fill(p2); }
    put(ctx, bed, .5, 1, 'source-over', [hy - 140, H]);
    if (night) put(ctx, bed, 12, .3, 'lighter', [hy - 140, H]);

    const C = {
      ring: q => night ? [[0, hue(roseC, .38, .14)], [.5, hue(roseC, .55 - q * .1, .16)], [1, hue(roseC, .65 - q * .08, .13)]] : [[0, hue(roseC, .48, .16)], [.5, hue(roseC, .62 - q * .1, .17)], [1, hue(roseC, .72 - q * .06, .13)]],
      back: night ? [[0, hue(roseC, .36, .12)], [1, hue(roseC, .5, .14)]] : [[0, hue(roseC, .5, .14)], [1, hue(roseC, .62, .15)]],
      trumpet: night ? [[0, hue(moonC, .78, .05)], [.5, hue(moonC, .9, .03)], [1, tint(P.foreground, .6)]] : [[0, hue(moonC, .86, .05)], [.5, '#ffffff'], [1, '#ffffff']],
      trumpetBack: night ? [[0, hue(moonC, .6, .06)], [1, hue(moonC, .8, .04)]] : [[0, hue(moonC, .76, .06)], [1, hue(moonC, .92, .03)]],
      star: hue(moonC, night ? .75 : .8, .08), throat: hue(prim, night ? .82 : .86, .1),
      prim: night ? [[0, hue(prim, .62, .12)], [.4, hue(prim, .76, .12)], [1, hue(prim, .86, .09)]] : [[0, hue(prim, .74, .15)], [.4, hue(prim, .86, .15)], [1, hue(prim, .93, .1)]],
      eye: hue(P.orange, night ? .62 : .7, .15),
    };
    const delC = col => ({
      petal: night ? [[0, hue(col, .45, .12)], [.5, hue(col, .58, .14)], [1, hue(col, .68, .12)]] : [[0, hue(col, .55, .14)], [.5, hue(col, .66, .16)], [1, hue(col, .76, .12)]],
      back: night ? [[0, hue(col, .4, .1)], [1, hue(col, .52, .12)]] : [[0, hue(col, .5, .12)], [1, hue(col, .62, .14)]],
      eye: hue(col, night ? .22 : .3, .08), eyeHi: hue(prim, night ? .8 : .88, .06),
    });
    const fO = { dark: night ? shade(P.darker_background, .2) : hue(leafG, .3, .05), shadeAmt: night ? .45 : .3, shadow: rgba('#000000', night ? .5 : .2), sblur: .06, rim: night ? hue(moonC, .9, .06) : '#ffffff', rimA: .5, rimW: .01, pleat: .1, sheen: night ? .05 : .1 };
    const smallO = { dark: fO.dark, shadeAmt: fO.shadeAmt, pleat: .08, rim: fO.rim, rimA: .35, rimW: .015 };
    const flower5 = lobed(5, .3);
    // Nearer border plants: small flowers drawn with the petal engine.
    const near1 = [];
    for (let i = 0; i < 230; i++) {
      const y = rowY(gy(2.6), gy(1.3)), d = dAt(y), sd = r() < .5 ? -1 : 1, X = sd * (HW + R(r, 40, 900));
      const x = gx(pathX(d) + X, d);
      if (x < 40 || x > W - 40) continue;
      near1.push([x, y, d, X]);
    }
    near1.sort((p2, q2) => p2[1] - q2[1]);
    for (const [x, y, d, X] of near1) {
      const c = kindAt(X, d), s2 = 30 / d, top = y - s2 * R(r, 1.6, 2.6);
      stem(ctx, [[x, y], [x + jit(r, 3), lerp(y, top, .5)], [x, top]], Math.max(.8, s2 * .1), Math.max(.6, s2 * .06), lc.dark, null);
      ctx.beginPath(); leaf(ctx, x, lerp(y, top, .4), s2 * .9, s2 * .22, -Math.PI / 2 + (r() < .5 ? -.9 : .9)); ctx.fillStyle = lc.dark; ctx.fill();
      const v = view(R(r, .7, 1.2), jit(r, .4), lightV);
      if (c === roseC || c === prim) primrose(ctx, x, top, s2 * .5, v, c === prim ? C : { ...C, prim: C.ring(.3), eye: hue(prim, .8, .12) }, r, smallO);
      else floret5(ctx, x, top, s2 * .45, v, delC(c), r, smallO);
    }

    // Tall delphinium spikes of 3D florets, larger at the foot.
    const delph = (c2, x, y0, h, fs, col) => {
      stem(c2, bez([x, y0], [x + 8, y0 - h * .4], [x - 6, y0 - h * .75], [x + 2, y0 - h], 12), fs * .22, fs * .1, lc.dark, lc.light);
      const n = Math.round(h / fs * 1.5), items = [], Cd = delC(col);
      for (let i = 0; i < n; i++) {
        const t = i / n, th = i * 2.4 + jit(r, .2), rad = fs * (1.15 - t * .75);
        items.push({ x: x + Math.cos(th) * rad, y: y0 - h * (.18 + t * .82) + Math.sin(th) * fs * .15, z: Math.sin(th), t, th });
      }
      items.sort((p2, q2) => p2.z - q2.z);
      for (const it of items) {
        const s2 = fs * (1 - it.t * .55);
        if (it.t > .84) {
          c2.fillStyle = linear(c2, it.x, it.y - s2 * .4, it.x, it.y + s2 * .4, [[0, Cd.petal[2][1]], [1, Cd.petal[0][1]]]);
          c2.beginPath(); ellipse(c2, it.x, it.y, s2 * .26, s2 * .4, Math.cos(it.th) * .4); c2.fill();
        } else floret5(c2, it.x, it.y, s2 * .62, view(R(r, .55, 1.1), Math.cos(it.th) * .9, lightV), Cd, r, { ...smallO, shadow: rgba('#000000', night ? .35 : .15), sblur: .1 });
      }
    };
    // A cluster of phlox florets.
    const phloxHead = (c2, x, y, rad, s) => {
      const v = view(.5, jit(r, .2), lightV);
      c2.fillStyle = radial(c2, x - rad * .2, y - rad * .3, rad * .1, rad, [[0, hue(phlox, night ? .5 : .66, .12)], [.8, hue(phlox, night ? .38 : .54, .12)], [1, rgba(hue(phlox, .4, .1), 0)]]);
      c2.beginPath(); ellipse(c2, x, y - rad * .05, rad * .95, rad * .85, 0); c2.fill();
      ball(c2, x, y, rad, v, r, { bumps: 70, per: Math.round((rad / s) ** 2 * 7 / 70) + 2, spread: .25, bump: .1, low: -.4 }, (cc, f) => {
        const k = clamp(f.lit * .5 + .5, 0, 1);
        cc.save(); cc.translate(f.x, f.y); cc.rotate(f.ang); cc.scale(s * Math.max(.25, f.face), s);
        cc.fillStyle = hue(phlox, night ? lerp(.42, .7, k) : lerp(.55, .8, k), .14); cc.fill(flower5);
        cc.fillStyle = hue(phlox, night ? .35 : .45, .14); cc.beginPath(); circle(cc, 0, 0, .2); cc.fill();
        cc.restore();
      });
    };
    const roseLeaf = (x, y, a, len) => pinnate(ctx, x, y, a, len, 2, len * .38, len * .17, lc, { serr: .22, bend: jit(r, .3), spread: .8, fold: .25, shadow: rgba('#000000', night ? .4 : .15) });
    const stemTo = (x, y) => stem(ctx, bez([x + 20, H + 20], [x + 10, lerp(H, y, .5)], [x, y + 60], [x, y], 12), 8, 6, lc.dark, lc.light);
    for (let i = 0; i < 18; i++) { const x = i < 9 ? R(r, -40, 640) : R(r, 1280, W + 40); leaf2(ctx, x, H + 20, -Math.PI / 2 + jit(r, .9), R(r, 150, 270), R(r, 26, 42), lc, { belly: .4, round: 1.1, veins: 5, fold: .25 }); }
    delph(ctx, 110, H + 20, 660, 30, moonC);
    delph(ctx, 250, H + 20, 520, 26, phlox);
    delph(ctx, 1700, H + 20, 680, 30, phlox);
    delph(ctx, 1840, H + 20, 560, 26, moonC);
    phloxHead(ctx, 1480, 890, 120, 16);
    phloxHead(ctx, 440, 930, 100, 15);
    [[300, 860, -2.4, 150], [520, 980, -1.1, 130], [1580, 1000, -2.2, 140], [1760, 900, -.8, 150], [90, 1000, -1.6, 150]].forEach(([x, y, a, len]) => roseLeaf(x, y, a, len));
    [[310, 880, 80], [150, 990, 92], [600, 1020, 64], [1330, 1010, 66], [1650, 940, 86], [1830, 1020, 80]].forEach(([x, y, s2]) => { stemTo(x, y); rose(ctx, x, y, s2, view(R(r, .7, 1.1), jit(r, .3), lightV), C, r, fO); });
    const moons = [[60, 780, 100], [1790, 780, 98], [760, 1060, 72]];
    moons.forEach(([x, y, s2]) => { stemTo(x, y); moonflower(ctx, x, y, s2, view(R(r, .8, 1.2), jit(r, .3), lightV), C, r, { ...fO, glowCol: '#ffffff' }); });
    const prims = [[680, 1050, 36], [880, 1072, 30], [1200, 1060, 34], [1420, 1068, 32], [240, 1062, 34]];
    prims.forEach(([x, y, s2]) => primrose(ctx, x, y, s2, view(R(r, .9, 1.3), jit(r, .5), lightV), C, r, fO));
    if (night) {
      // The pale flowers glow softly, and fireflies drift over the beds.
      haloes(ctx, x => {
        x.fillStyle = rgba(hue(moonC, .85, .06), .5);
        moons.forEach(([fx, fy, s2]) => { x.beginPath(); circle(x, fx, fy, s2 * .8); x.fill(); });
        x.fillStyle = rgba(hue(prim, .85, .1), .4);
        prims.forEach(([fx, fy, s2]) => { x.beginPath(); circle(x, fx, fy, s2); x.fill(); });
      }, [30], [.45], .4, [620, H]);
      const flies = [];
      for (let i = 0; i < 70; i++) { const fx = R(r, 0, W), fy = R(r, 560, 1000); if (Math.abs(fx - 960) < 220 && r() < .7) continue; flies.push([fx, fy, R(r, 1.6, 3.2)]); }
      haloes(ctx, x => { x.fillStyle = hue(prim, .88, .14); flies.forEach(([fx, fy, fr]) => { x.beginPath(); circle(x, fx, fy, fr * 2.2); x.fill(); }); }, [14, 4], [.9, .8], .5, [500, 1060]);
      ctx.fillStyle = tint(hue(prim, .9, .12), .4);
      flies.forEach(([fx, fy, fr]) => { ctx.beginPath(); circle(ctx, fx, fy, fr * .7); ctx.fill(); });
    }
    // Leaves and a rose close to the lens.
    const near = soft(.45);
    for (let i = 0; i < 10; i++) leaf2(near.x, i < 5 ? R(r, -80, 120) : R(r, 1800, W + 80), H + 40, -Math.PI / 2 + jit(r, .7), R(r, 260, 380), R(r, 50, 70), lc, { belly: .4, round: 1.1, veins: 0 });
    rose(near.x, 1890, 1050, 150, view(.9, .3, lightV), C, r, { dark: fO.dark });
    put(ctx, near, 9, .9);
    finish(ctx, P, r, night ? .5 : .12, night ? .045 : .035);
  });

  // ---------- garden/rose-petals ----------

  scene('garden', 'rose-petals', (ctx, P, r) => {
    const night = P.night, roseC = P.red, mauve = P.blue, peach = P.yellow, coral = P.orange, aqua = P.cyan, lilac = P.magenta;
    const N = makeNoise(Math.floor(r() * 1e9));
    const sq = .62;
    // Still water: a soft gradient with slow swells of light.
    if (night) skyGradient(ctx, [[0, shade(P.darker_background, .1)], [.5, P.background], [1, mixHex(P.background, P.lighter_background, .6)]]);
    else skyGradient(ctx, [[0, mixHex(tint(P.background, .4), hue(aqua, .9, .03), .5)], [.55, tint(P.background, .3)], [1, mixHex(P.background, hue(lilac, .9, .04), .45)]]);
    const sw = document.createElement('canvas'), cw = 192, chh = 108;
    sw.width = cw; sw.height = chh;
    const sx = sw.getContext('2d'), img = sx.createImageData(cw, chh), lc = rgb(night ? mixHex(P.foreground, mauve, .3) : '#ffffff');
    for (let j = 0; j < chh; j++) for (let i = 0; i < cw; i++) {
      const v = fbm(N, i / 34, j / 34 / sq, 4), k = (j * cw + i) * 4;
      img.data[k] = lc[0]; img.data[k + 1] = lc[1]; img.data[k + 2] = lc[2];
      img.data[k + 3] = clamp((v * .5 + .5) ** 2.2 * (night ? 60 : 150), 0, 255);
    }
    sx.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.filter = blurPx(6); ctx.drawImage(sw, -40, -40, W + 80, H + 80); ctx.restore();
    // The moon or the sky, mirrored in the water.
    const mx = 1380;
    if (night) {
      const ref = soft(.5);
      ref.x.save();
      ref.x.translate(mx, 440); ref.x.scale(1, 6);
      ref.x.fillStyle = radial(ref.x, 0, 0, 0, 90, [[0, rgba(tint(P.foreground, .3), .3)], [.5, rgba(tint(P.foreground, .3), .1)], [1, rgba(tint(P.foreground, .3), 0)]]);
      ref.x.fillRect(-90, -90, 180, 180);
      ref.x.restore();
      ref.x.fillStyle = rgba(tint(P.foreground, .3), .7);
      for (let i = 0; i < 60; i++) { const y = R(r, 40, 1040), w = R(r, 10, 60) * (1 - Math.abs(y - 420) / 1000); ref.x.beginPath(); ellipse(ref.x, mx + jit(r, 24 + y * .04), y, w / 2, R(r, 1.5, 3), 0); ref.x.fill(); }
      put(ctx, ref, 6, .45, 'lighter');
      glow(ctx, mx, 380, 0, 700, mixHex(P.foreground, mauve, .3), .12);
    } else glow(ctx, mx, 300, 0, 900, '#ffffff', .6);

    // Ripples: rings of light and shade on the surface.
    const ripple = (c2, x, y, r0, rings, a) => {
      for (let i = 0; i < rings; i++) {
        const rad = r0 * (1 + i * .7 + i * i * .12), fade = a * (1 - i / rings) ** 1.5;
        c2.lineWidth = Math.max(.8, r0 * .035);
        c2.strokeStyle = rgba(night ? tint(P.foreground, .2) : '#ffffff', fade * (night ? .35 : .8));
        c2.beginPath(); ellipse(c2, x, y - 1.5, rad, rad * sq, 0); c2.stroke();
        c2.strokeStyle = rgba(night ? '#000000' : hue(mauve, .5, .06), fade * (night ? .4 : .25));
        c2.beginPath(); ellipse(c2, x, y + 1.5, rad, rad * sq, 0); c2.stroke();
      }
    };
    const C = night
      ? { base: hue(peach, .74, .05), body: hue(roseC, .64, .1), edge: hue(roseC, .72, .08), back: hue(roseC, .52, .1), dark: shade(P.darker_background, .2) }
      : { base: hue(peach, .93, .04), body: hue(roseC, .82, .08), edge: hue(roseC, .86, .07), back: hue(roseC, .72, .1), dark: hue(mauve, .45, .08) };
    const tints = [[roseC, 0], [coral, .08], [mauve, .04], [roseC, .03], [lilac, .02]];
    const lightV = night ? [.6, -.6, .3] : [-.5, -.7, .6];
    // 1 petal: cupped, with its sides curling up, and a soft shadow on the water.
    const petal1 = (c2, x, y, size, a, o = {}) => {
      const [hc, dl] = pick(r, tints), cup = R(r, .3, .7), cr = R(r, .25, .55);
      const st = [[0, mixHex(C.base, hue(hc, .9, .03), .3)], [.35, mixHex(C.body, hue(hc, night ? .64 : .82, .09), .5)], [1, hue(hc, (night ? .72 : .86) + dl, .08)]];
      const pt = { th: a, r0: 0, len: 1, wid: R(r, .55, .68), belly: .68, round: .4, n: 24, spine: q => [q - .12 * q * q * q, cup * q * q], cross: cr, ruffle: .05, rf: 2.5, ph: r() * 9, scallop: .12, sf: 2,
        wave: .06, wf: 3, wph: r() * 6, c: st, cb: [[0, C.back], [1, mixHex(C.back, C.edge, .5)]], veins: 15, veinA: .06, veinW: .003, veinCol: C.dark };
      const v = view(Math.PI / 2 - .55, 0, lightV);
      blossom(c2, x, y, size, v, [pt], [], { dark: C.dark, shadeAmt: night ? .45 : .25, shadow: o.flat ? null : rgba(night ? '#000000' : hue(mauve, .35, .08), night ? .55 : .28), sblur: .14, soff: .09, pleat: .035, pleatCol: night ? P.foreground : '#ffffff', rim: night ? tint(P.foreground, .4) : '#ffffff', rimA: .6, rimW: .012, sheen: night ? .1 : .22 });
    };
    // Petals under the surface, soft and tinted by the water.
    const deep = soft(.4);
    for (let i = 0; i < 16; i++) petal1(deep.x, R(r, 0, W), R(r, 0, H), R(r, 50, 90), r() * TAU, { flat: 1 });
    put(ctx, deep, 6, night ? .35 : .4);
    ctx.fillStyle = rgba(night ? P.background : tint(P.background, .3), .25); ctx.fillRect(0, 0, W, H);

    // Floating petals, gathered toward the corners, with rings around a few.
    const spots = [];
    const drift = (cx, cy, rx, ry, n, sMin, sMax) => { for (let i = 0; i < n; i++) { const a = r() * TAU, d = Math.sqrt(r()); spots.push([cx + Math.cos(a) * d * rx, cy + Math.sin(a) * d * ry, R(r, sMin, sMax)]); } };
    drift(230, 170, 380, 230, 14, 85, 150);
    drift(1700, 910, 420, 250, 16, 85, 150);
    drift(1660, 130, 260, 150, 5, 70, 110);
    drift(250, 940, 260, 150, 5, 70, 110);
    drift(960, 560, 700, 380, 6, 60, 95);
    spots.sort((p2, q2) => p2[1] - q2[1]);
    for (const [x, y, s2] of spots) if (r() < .25) ripple(ctx, x, y, s2 * R(r, .7, .9), 3, R(r, .2, .35));
    ripple(ctx, 760, 420, 40, 4, .3);
    ripple(ctx, 1180, 700, 26, 3, .22);
    for (const [x, y, s2] of spots) petal1(ctx, x, y, s2, r() * TAU);
    // Small drops of water on the petals.
    ctx.fillStyle = rgba('#ffffff', night ? .5 : .85);
    for (let i = 0; i < 26; i++) { const [x, y, s2] = pick(r, spots); ctx.beginPath(); circle(ctx, x + jit(r, s2 * .4), y + jit(r, s2 * .3), R(r, 1.2, 2.6)); ctx.fill(); }
    finish(ctx, P, r, night ? .45 : .1, night ? .04 : .03);
  });

  function poppyPalette(P) {
    const n = P.night, red = P.red, leafG = P.green;
    return {
      inner: n
        ? [[0, tone(red, .14, .5)], [.17, tone(red, .2, .7)], [.32, tone(red, .44, 1.05)], [.75, tone(red, .54, 1.1)], [1, tone(red, .6, 1)]]
        : [[0, tone(red, .2, .5)], [.17, tone(red, .28, .8)], [.32, tone(red, .54, 1.15)], [.75, tone(red, .6, 1.15)], [1, tone(red, .68, 1.05)]],
      outer: n
        ? [[0, tone(leafG, .3, .6)], [.25, tone(red, .38, .9)], [1, tone(red, .5, 1)]]
        : [[0, tone(leafG, .45, .6)], [.25, tone(red, .5, 1)], [1, tone(red, .62, 1.05)]],
      dark: n ? shade(P.darker_background, .5) : tone(red, .22, .6),
      rim: n ? tone(P.foreground, .9, .5) : tint(tone(red, .8, .6), .3),
      sheen: n ? P.foreground : '#ffffff',
      glow: n ? tone(red, .7, 1) : tone(P.yellow, .82, 1),
      trans: n ? .55 : .45,
      stamen: tone(red, .14, .4), anther: n ? tone(P.magenta, .25, .5) : tone(P.magenta, .2, .5),
      pod: tone(P.cyan, n ? .38 : .5, .7), podTop: tone(P.cyan, n ? .5 : .62, .5), ray: tone(P.magenta, .18, .6),
      stem: n ? tone(leafG, .32, .8) : tone(leafG, .46, .9), stemHi: n ? tone(leafG, .6, .6) : tone(leafG, .72, .7),
      bud: n ? tone(leafG, .36, .8) : tone(leafG, .52, .9), budHi: n ? tone(leafG, .52, .6) : tone(leafG, .7, .7), budDark: n ? tone(leafG, .2, .6) : tone(leafG, .32, .8),
      hair: n ? tone(P.foreground, .7, .3) : '#ffffff',
      dots: n ? [tone(red, .42, 1.05), tone(red, .5, 1.1), tone(red, .36, 1)] : [tone(red, .55, 1.15), tone(red, .62, 1.1), tone(red, .5, 1.1)],
      grass: n ? [tone(leafG, .3, .7), tone(leafG, .36, .7), tone(P.cyan, .34, .6), tone(leafG, .42, .6)] : [tone(leafG, .5, .85), tone(leafG, .58, .8), tone(P.cyan, .62, .7), tone(leafG, .66, .7)],
      root: n ? tone(leafG, .14, .6) : tone(leafG, .3, .8),
    };
  }
})();
