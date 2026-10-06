// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Material scenes: metal, texture, interior and circuit.
(() => {
  const TAU = Math.PI * 2;

  // ---------- shared helpers ----------

  const ss = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const seedOf = r => (r() * 4294967296) >>> 0;
  // A repeatable hash of 2 integers, from 0 up to 1.
  const hash2 = (i, j, s = 0) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s, 2246822519); h = Math.imul(h ^ h >>> 13, 1274126177); return ((h ^ h >>> 16) >>> 0) / 4294967296; };

  // A small canvas filled per pixel. The callback gets the column, the row and
  // an out array for r, g, b and a.
  function bake(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data, o = [0, 0, 0, 255];
    for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k += 4) {
      o[3] = 255; fn(i, j, o);
      d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3];
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  // Draws a canvas over a logical rectangle with smooth scaling.
  function put(ctx, c, x = 0, y = 0, w = W, h = H, alpha = 1, op = 'source-over') {
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.drawImage(c, x, y, w, h);
    ctx.restore();
  }
  // Gradient noise that repeats every `period` units on both axes.
  function loopNoise(seed, period) {
    const r = rng(seed), g = new Float32Array(period * period * 2);
    for (let i = 0; i < period * period; i++) { const a = r() * TAU; g[i * 2] = Math.cos(a); g[i * 2 + 1] = Math.sin(a); }
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const m = v => ((v % period) + period) % period;
    const dot = (ix, iy, x, y) => { const k = (m(iy) * period + m(ix)) * 2; return g[k] * (x - ix) + g[k + 1] * (y - iy); };
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), sx = fade(x - x0), sy = fade(y - y0);
      return lerp(lerp(dot(x0, y0, x, y), dot(x0 + 1, y0, x, y), sx), lerp(dot(x0, y0 + 1, x, y), dot(x0 + 1, y0 + 1, x, y), sx), sy) * 1.414;
    };
  }
  // A repeating pattern of logical size t, baked at output resolution so fine
  // detail stays sharp. The callback gets u and v from 0 up to 1, and an out array.
  function tile(ctx, t, fn) {
    const n = Math.max(16, Math.round(t * S));
    const c = bake(n, n, (i, j, o) => fn(i / n, j / n, o));
    const p = ctx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scale(t / n));
    return p;
  }
  // Fills the frame with a pattern at an alpha and a blend mode.
  function wash(ctx, fill, alpha = 1, op = 'source-over', rect = [0, 0, W, H]) {
    ctx.save();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.fillStyle = fill; ctx.fillRect(...rect);
    ctx.restore();
  }

  // Contour lines of a field at a level, by marching squares. f holds
  // w + 1 by h + 1 samples, row by row. It returns polylines in grid units.
  // A field with low values on its border gives only closed lines.
  function contours(f, w, h, level) {
    const W1 = w + 1, pt = new Map(), next = new Map();
    const val = (i, j) => f[j * W1 + i];
    const point = id => {
      let p = pt.get(id);
      if (p) return p;
      const base = id >> 1, i = base % W1, j = (base - i) / W1;
      if (id & 1) { const a = val(i, j), b = val(i, j + 1); p = [i, j + (level - a) / (b - a)]; }
      else { const a = val(i, j), b = val(i + 1, j); p = [i + (level - a) / (b - a), j]; }
      pt.set(id, p);
      return p;
    };
    const link = (a, b) => {
      if (!next.has(a)) next.set(a, []);
      if (!next.has(b)) next.set(b, []);
      next.get(a).push(b); next.get(b).push(a);
    };
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const code = (val(i, j) >= level) | (val(i + 1, j) >= level) << 1 | (val(i + 1, j + 1) >= level) << 2 | (val(i, j + 1) >= level) << 3;
      if (code === 0 || code === 15) continue;
      const top = (j * W1 + i) * 2, bottom = ((j + 1) * W1 + i) * 2, left = top + 1, right = (j * W1 + i + 1) * 2 + 1;
      if (code === 1 || code === 14) link(left, top);
      else if (code === 2 || code === 13) link(top, right);
      else if (code === 3 || code === 12) link(left, right);
      else if (code === 4 || code === 11) link(right, bottom);
      else if (code === 6 || code === 9) link(top, bottom);
      else if (code === 7 || code === 8) link(left, bottom);
      else {
        const mid = (val(i, j) + val(i + 1, j) + val(i + 1, j + 1) + val(i, j + 1)) / 4 >= level;
        if ((code === 5) === mid) { link(left, bottom); link(top, right); } else { link(left, top); link(right, bottom); }
      }
    }
    const seen = new Set(), lines = [];
    const walk = start => {
      const line = [point(start)];
      seen.add(start);
      let prev = -1, cur = start;
      for (;;) {
        let nx = -1;
        for (const k of next.get(cur)) if (k !== prev && !seen.has(k)) { nx = k; break; }
        if (nx < 0) break;
        line.push(point(nx)); seen.add(nx); prev = cur; cur = nx;
      }
      return line;
    };
    for (const [id, nb] of next) if (nb.length === 1 && !seen.has(id)) lines.push(walk(id));
    for (const id of next.keys()) if (!seen.has(id)) lines.push(walk(id));
    return lines;
  }
  // Samples a function of x and y on a grid over a logical rectangle, for contours.
  function field(w, h, rect, fn) {
    const [x0, y0, x1, y1] = rect, f = new Float32Array((w + 1) * (h + 1));
    for (let j = 0; j <= h; j++) for (let i = 0; i <= w; i++) f[j * (w + 1) + i] = fn(x0 + (x1 - x0) * i / w, y0 + (y1 - y0) * j / h, i, j);
    return f;
  }
  // Adds contour lines to the current path, mapped from grid units to a logical rectangle.
  function tracePath(ctx, lines, w, h, rect, minLen = 3) {
    const [x0, y0, x1, y1] = rect, sx = (x1 - x0) / w, sy = (y1 - y0) / h;
    for (const l of lines) {
      if (l.length < minLen) continue;
      ctx.moveTo(x0 + l[0][0] * sx, y0 + l[0][1] * sy);
      for (let k = 1; k < l.length; k++) ctx.lineTo(x0 + l[k][0] * sx, y0 + l[k][1] * sy);
      const e = l[l.length - 1];
      if (Math.abs(e[0] - l[0][0]) + Math.abs(e[1] - l[0][1]) < 2.5) ctx.closePath();
    }
  }

  // ---------- metal/patina ----------

  // Building silhouettes along a base line: flat tops, gables, chimneys and
  // now and then a small dome or a spire.
  function skyline(ctx, r, x0, x1, base, hMin, hMax, fill, lights) {
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.moveTo(x0, H + 10);
    const wins = [];
    for (let x = x0; x < x1;) {
      const w = 50 + r() * 110, h = lerp(hMin, hMax, r()), top = base - h, kind = r();
      ctx.lineTo(x, top);
      if (kind < .4) { ctx.lineTo(x + w * .5, top - w * .32); ctx.lineTo(x + w, top); }
      else if (kind < .55) { ctx.lineTo(x + w * .2, top); ctx.lineTo(x + w * .2, top - 22); ctx.lineTo(x + w * .3, top - 22); ctx.lineTo(x + w * .3, top); ctx.lineTo(x + w, top); }
      else if (kind < .63) { ctx.lineTo(x + w * .25, top); ctx.arc(x + w * .5, top, w * .25, Math.PI, 0); ctx.lineTo(x + w, top); }
      else if (kind < .68) { ctx.lineTo(x + w * .42, top); ctx.lineTo(x + w * .5, top - h * .9); ctx.lineTo(x + w * .58, top); ctx.lineTo(x + w, top); }
      else ctx.lineTo(x + w, top);
      if (lights) for (let q = 0; q < h * w / 900; q++) if (r() < .35) wins.push([x + 6 + r() * (w - 12), top + 8 + r() * (h - 8)]);
      x += w;
    }
    ctx.lineTo(x1 + 200, H + 10); ctx.closePath(); ctx.fill();
    return wins;
  }

  // A large copper dome with standing seams, seen from a nearby roof. The
  // dome is shaded per pixel as a sphere, then the seams are drawn sharp.
  scene('metal', 'patina', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r)), nC = makeNoise(seedOf(r)), nD = makeNoise(seedOf(r)), nE = makeNoise(seedOf(r));

    // The dome: center, radius, and the camera looking down by angle d.
    const R = 1060, cx = 1390, cy = 1300, d = .2, cd = Math.cos(d), sd = Math.sin(d);
    const NP = 40, dLon = TAU / NP, lon0 = dLon * .37;
    const tone = Array.from({ length: 64 }, () => r());
    const V = [0, sd, cd];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const sph = (lat, lon) => [Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat) * Math.cos(lon)];
    const toScreen = p => [cx + R * p[0], cy - R * (p[1] * cd - p[2] * sd), p[1] * sd + p[2] * cd];
    const panel = lon => { const q = (lon - lon0) / dLon, k = Math.floor(q); return [k, q - k, tone[((k % 64) + 64) % 64]]; };
    const COURSE = .2;

    // The patina amount at a point of the dome.
    const mask = (lon, lat, lod = 1) => {
      const u = lon * R, w = (Math.PI / 2 - lat) * R;
      const [, fu, t] = panel(lon);
      const dSeam = Math.min(fu, 1 - fu) * dLon * R * Math.cos(lat);
      const bloom = fbm(nA, u / 300, w / 420, 4);
      const gate = fbm(nB, u / 120, w / 700, 3);
      const run = (1 - Math.abs(nC(u / 18, w / 1000))) ** 6 * ss(-.2, .25, gate);
      const fine = fbm(nD, u / 7, w / 7, 2) * lod;
      return bloom * .95 + run * .7 + Math.exp(-dSeam / 12) * .26 + fine * .26 + (t - .5) * .34 - .1;
    };

    // Lights. Night: a warm floodlight from below and the moon on the left. Day: the sun on the left.
    const key = norm(night ? [-.75, .45, .45] : [-.8, .5, .38]);
    const flood = norm([.2, -.5, .84]);
    const cu = C(night ? withL(P.red, .42) : withL(P.red, .5));
    const cuLite = C(night ? withL(P.orange, .82) : withL(P.orange, .92));
    const cuDark = C(night ? withL(P.brown, .15) : withL(P.brown, .26));
    const pat = C(night ? adjust(P.blue, { L: -.03 }) : adjust(withL(P.blue, .7), { Cx: .75 }));
    const patPale = C(night ? withL(P.cyan, .76) : adjust(withL(P.cyan, .9), { Cx: .6 }));
    const patGreen = C(night ? withL(P.green, .56) : adjust(withL(P.green, .74), { Cx: .7 }));
    const warm = C(night ? withL(P.yellow, .84) : withL(P.yellow, .9));
    const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

    // The dome, shaded per pixel.
    const bx0 = Math.max(0, cx - R - 4), by0 = Math.max(0, cy - R - 4), DS = .72;
    const BW = Math.round((W - bx0) * DS), BH = Math.round((H - by0) * DS);
    const dome = bake(BW, BH, (i, j, o) => {
      const x = bx0 + (i + .5) / DS, y = by0 + (j + .5) / DS;
      let a = (x - cx) / R, b = (cy - y) / R, q = a * a + b * b;
      if (q > .9995) { const k = Math.sqrt(.9995 / q); a *= k; b *= k; q = .9995; }
      const c = Math.sqrt(1 - q);
      const p = [a, b * cd + c * sd, -b * sd + c * cd];
      const lat = Math.asin(clamp(p[1], -1, 1)), lon = Math.atan2(p[0], p[2]);
      const lod = ss(.04, .3, c);
      const [, fu, t] = panel(lon);
      // Each panel bulges a little between its seams.
      const tl = [Math.cos(lon), 0, -Math.sin(lon)], tilt = (fu - .5) * .3;
      const n = norm([p[0] - tl[0] * tilt, p[1], p[2] - tl[2] * tilt]);
      const nv = dot(n, V), rv = [2 * nv * n[0] - V[0], 2 * nv * n[1] - V[1], 2 * nv * n[2] - V[2]];
      const m = mask(lon, lat, lod);
      const pa = ss(-.02, .14, m), rim = ss(-.24, -.02, m) * (1 - pa);
      const diff = Math.max(0, dot(n, key));
      const fl = night ? Math.max(0, dot(n, flood)) ** 1.5 * ss(1.25, .15, lat) : 0;
      // Copper mirrors a bright sky above the horizon and the dark town below it.
      const roll = nE(lon * R / 2.6, lat * R / 200) * .5 * lod + nE(lon * R / 30, lat * R / 500) * .5;
      const env = night ? ss(-.3, .6, rv[1]) * .25 + .04 : ss(-.15, .45, rv[1]) * .85 + .05;
      const spec = Math.max(0, dot(rv, key)) ** 14;
      let col = mixC(cuDark, cu, clamp(env * 1.1 + diff * .3 + roll * .2 + (t - .5) * .2, 0, 1));
      col = mixC(col, cuLite, clamp(env * .35 + spec * (night ? .5 : .8) + fl * .5 + roll * .08, 0, 1));
      col = mixC(col, WHITE, clamp(spec * (night ? .25 : .5), 0, 1));
      col = mixC(col, warm, fl * .3);
      col = mixC(col, cuDark, rim * .8);
      // Patina: matte and powdery, chalky where it is thick.
      const thick = ss(.1, .7, m + fbm(nD, lon * R / 45, lat * R / 60, 2) * .25);
      let pc = mixC(pat, patGreen, clamp(.45 + nA(lon * R / 110, lat * R / 150) * .9, 0, 1));
      pc = mixC(pc, patPale, thick * .75);
      const light = night ? .2 + diff * .55 + fl * .75 : .42 + diff * .72;
      pc = mixC(BLACK, pc, clamp(light, 0, 1));
      if (light > 1) pc = mixC(pc, WHITE, (light - 1) * .45);
      if (night) pc = mixC(pc, warm, fl * .2);
      pc = mixC(pc, night ? BLACK : WHITE, (hash2(i, j, 3) - .5) * .12 * lod);
      col = mixC(col, pc, pa);
      // The limb turns toward the sky color.
      col = mixC(col, night ? C(mixHex(P.background, P.blue, .35)) : C(mixHex(P.background, '#ffffff', .25)), (1 - c) ** 5 * .55);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
    });

    // The sky.
    const mx = 340, my = 160;
    if (night) {
      skyGradient(ctx, [[0, P.darker_background], [.55, mixHex(P.background, P.blue, .1)], [1, mixHex(P.background, P.blue, .26)]]);
      ctx.fillStyle = radial(ctx, mx, my, 0, 820, [[0, rgba(P.bright_cyan, .26)], [.2, rgba(P.cyan, .09)], [1, rgba(P.cyan, 0)]]);
      ctx.fillRect(0, 0, W, H);
      stars(ctx, r, 160, [0, 0, W, 760], [P.bright_foreground, P.bright_cyan], 1.5);
      ctx.fillStyle = radial(ctx, mx, my, 0, 30, [[0, P.bright_foreground], [.85, mixHex(P.bright_foreground, P.bright_cyan, .3)], [1, rgba(P.bright_cyan, 0)]]);
      ctx.beginPath(); circle(ctx, mx, my, 30); ctx.fill();
      // A warm town glow low on the horizon.
      ctx.fillStyle = linear(ctx, 0, 700, 0, H, [[0, rgba(P.orange, 0)], [1, rgba(P.orange, .12)]]);
      ctx.fillRect(0, 700, W, H);
    } else {
      skyGradient(ctx, [[0, adjust(withL(P.blue, .8), { Cx: .55 })], [.62, mixHex(P.background, P.cyan, .08)], [1, mixHex(P.background, '#ffffff', .6)]]);
      ctx.fillStyle = radial(ctx, mx, my, 0, 1000, [[0, rgba('#ffffff', .9)], [.22, rgba('#ffffff', .35)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.save(); ctx.filter = blurPx(14);
      for (let i = 0; i < 5; i++) {
        const x = lerp(-60, 860, r()), y = lerp(330, 600, r()), w = 160 + r() * 200;
        ctx.fillStyle = rgba('#ffffff', .5 + r() * .3);
        ctx.beginPath();
        for (let q = 0; q < 7; q++) circle(ctx, x + (q / 6 - .5) * w, y - Math.sin(q / 6 * Math.PI) * w * .1 - r() * 12, w * (.1 + r() * .08));
        ctx.rect(x - w * .55, y - 4, w * 1.1, 20);
        ctx.fill();
      }
      ctx.restore();
    }

    // The town in the haze at the lower left.
    {
      const far = night ? mixHex(P.background, P.blue, .2) : mixHex(P.background, P.blue, .14);
      const mid = night ? mixHex(P.background, P.blue, .1) : mixHex(P.background, P.blue, .24);
      const near = night ? P.darker_background : mixHex(P.background, P.blue, .36);
      skyline(ctx, r, -40, 980, 900, 30, 110, far, false);
      const w1 = skyline(ctx, r, -40, 980, 975, 25, 95, mid, night);
      const w2 = skyline(ctx, r, -40, 980, 1050, 20, 80, near, night);
      if (night) [...w1, ...w2].forEach(([x, y]) => { ctx.fillStyle = rgba(P.yellow, .25 + r() * .55); ctx.fillRect(x, y, 3, 4); });
      ctx.fillStyle = linear(ctx, 0, 820, 0, H, [[0, rgba(night ? P.background : '#ffffff', 0)], [.5, rgba(night ? mixHex(P.background, P.blue, .2) : '#ffffff', night ? .12 : .2)], [1, rgba(night ? P.background : '#ffffff', 0)]]);
      ctx.fillRect(0, 820, W, H);
    }

    // The dome with a sharp outline.
    ctx.save();
    ctx.beginPath(); circle(ctx, cx, cy, R); ctx.clip();
    put(ctx, dome, bx0, by0, W - bx0, H - by0);
    ctx.restore();

    // The cross seams of each course, in steps like brickwork.
    const STEPS = 64, latTop = 1.45;
    ctx.lineCap = 'round';
    for (let k = 0; k < NP; k++) {
      const lonA = lon0 + k * dLon;
      for (let lat = (k & 1) * COURSE * .5 + COURSE * .5; lat < latTop - .1; lat += COURSE) {
        const pts = [];
        for (let q = 0; q <= 8; q++) { const p = sph(lat, lonA + dLon * (.03 + q / 8 * .94)); const sp = toScreen(p); if (sp[2] > .03) pts.push(sp); }
        if (pts.length < 2) continue;
        const lit = Math.max(0, dot(sph(lat, lonA + dLon / 2), key));
        ctx.lineWidth = 2.4; ctx.strokeStyle = `rgba(0,0,0,${night ? .3 : .16})`;
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] + 1.4) : ctx.moveTo(p[0], p[1] + 1.4)); ctx.stroke();
        ctx.lineWidth = 1; ctx.strokeStyle = rgba('#ffffff', (night ? .12 : .3) + lit * (night ? .2 : .35));
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1] - .6) : ctx.moveTo(p[0], p[1] - .6)); ctx.stroke();
      }
    }

    // The standing seams, drawn as short pieces that follow the patina and the light.
    const litCu = C(night ? withL(P.orange, .74) : withL(P.orange, .86)), litPat = C(night ? withL(P.cyan, .8) : withL(P.cyan, .93));
    const darkCu = C(withL(P.brown, night ? .13 : .26)), darkPat = C(night ? withL(P.blue, .26) : withL(P.blue, .5));
    const hex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    for (let k = 0; k < NP; k++) {
      const lon = lon0 + k * dLon;
      const at = (lat, off) => toScreen(sph(lat, lon + off / (R * Math.max(.06, Math.cos(lat)))));
      // The seam colors at each step, so each piece blends into the next.
      const tones = [];
      for (let q = 0; q <= STEPS; q++) {
        const la = latTop * q / STEPS, nrm = sph(la, lon), lit = Math.max(0, dot(nrm, key));
        const fl = night ? Math.max(0, dot(nrm, flood)) * ss(1.25, .15, la) : 0;
        const pa = .25 + .75 * ss(-.02, .14, (mask(lon - .004, la, 0) + mask(lon + .004, la, 0)) / 2);
        const shade = night ? .3 + lit * .7 + fl * .5 : .55 + lit * .55;
        tones.push({ lit, face: hex(mixC(BLACK, mixC(litCu, litPat, pa), clamp(shade, 0, 1))), dark: hex(mixC(darkCu, darkPat, pa)), crest: clamp((night ? .08 + lit * .45 + fl * .25 : .2 + lit * .75), 0, .9) });
      }
      for (let q = 0; q < STEPS; q++) {
        const la = latTop * q / STEPS, lb = latTop * (q + 1) / STEPS;
        if (toScreen(sph(la, lon))[2] < .02 && toScreen(sph(lb, lon))[2] < .02) continue;
        const A = tones[q], Bt = tones[q + 1], pa0 = at(la, 0), pb0 = at(lb, 0);
        const grad = (c0, c1) => linear(ctx, pa0[0], pa0[1], pb0[0], pb0[1], [[0, c0], [1, c1]]);
        const band = (o1, o2, fill) => {
          ctx.fillStyle = fill;
          ctx.beginPath(); poly(ctx, [at(la, o1), at(la, o2), at(lb, o2), at(lb, o1)]); ctx.fill();
        };
        const lit = (A.lit + Bt.lit) / 2;
        for (let z = 0; z < 5; z++) band(5 + z * 3.5, 8.6 + z * 3.5, `rgba(0,0,0,${(night ? .2 : .12) * (1 - z / 5) ** 1.4 * (.4 + lit)})`);
        band(-5, -.2, grad(A.face, Bt.face));
        band(.2, 5, grad(A.dark, Bt.dark));
        band(-1.4, .4, grad(rgba('#ffffff', A.crest), rgba('#ffffff', Bt.crest)));
      }
    }

    // The lantern on top of the dome.
    {
      const [ax, ay] = toScreen([0, 1, 0]);
      const lw = 58, lh = 120, ry = lw * sd;
      const metal = night ? withL(P.blue, .32) : withL(P.blue, .6);
      const metalLit = night ? withL(P.cyan, .62) : withL(P.cyan, .86);
      const body = (x0, x1) => linear(ctx, x0, 0, x1, 0, [[0, metalLit], [.4, metal], [1, mixHex(metal, '#000000', .5)]]);
      // A shadow ring where it meets the dome.
      ctx.fillStyle = rgba('#000000', night ? .45 : .22);
      ctx.beginPath(); ellipse(ctx, ax + 6, ay + 2, lw + 22, ry + 8); ctx.fill();
      ctx.fillStyle = body(ax - lw, ax + lw);
      ctx.beginPath(); ctx.rect(ax - lw, ay - lh, lw * 2, lh); ctx.ellipse(ax, ay, lw, ry, 0, 0, Math.PI); ctx.fill();
      for (let q = -2; q <= 2; q++) {
        const ox = ax + Math.sin(q * .55) * lw * .95, ow = 9 * Math.cos(q * .55);
        ctx.fillStyle = night ? withL(P.yellow, .8) : mixHex(metal, '#000000', .6);
        ctx.beginPath(); ctx.rect(ox - ow, ay - lh + 34, ow * 2, 62); ctx.arc(ox, ay - lh + 34, ow, Math.PI, 0); ctx.fill();
      }
      if (night) bloom(ctx, x => { x.fillStyle = withL(P.yellow, .8); x.fillRect(ax - 52, ay - lh + 24, 104, 72); }, [46, 12], [.55, .4]);
      ctx.fillStyle = body(ax - lw - 10, ax + lw + 10);
      ctx.fillRect(ax - lw - 10, ay - lh - 6, lw * 2 + 20, 10);
      ctx.beginPath(); ctx.ellipse(ax, ay - lh - 6, lw + 4, 46, 0, Math.PI, 0); ctx.fill();
      ctx.fillStyle = body(ax - 14, ax + 14);
      ctx.beginPath(); circle(ctx, ax, ay - lh - 64, 11); ctx.fill();
      ctx.beginPath(); poly(ctx, [[ax - 3.5, ay - lh - 72], [ax, ay - lh - 150], [ax + 3.5, ay - lh - 72]]); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', night ? .35 : .6);
      ctx.fillRect(ax - lw - 10, ay - lh - 6, lw * 2 + 20, 1.6);
    }

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });

  // ---------- metal/rust ----------

  // Draws closed contour lines as raised flakes: a shadow, a fill, then a lit
  // edge at the upper left and a dark edge at the lower right.
  function flakes(ctx, lines, gw, gh, rect, fill, night, opts = {}) {
    const path = () => { ctx.beginPath(); tracePath(ctx, lines, gw, gh, rect); };
    const lift = opts.lift || 1;
    ctx.save();
    ctx.translate(2.2 * lift, 3 * lift); path(); ctx.fillStyle = rgba('#000000', (night ? .55 : .28) * (opts.shadow || 1)); ctx.fill('evenodd');
    ctx.translate(1.6 * lift, 2 * lift); path(); ctx.fillStyle = rgba('#000000', (night ? .25 : .12) * (opts.shadow || 1)); ctx.fill('evenodd');
    ctx.restore();
    ctx.save();
    path(); ctx.clip('evenodd');
    ctx.fillStyle = fill; ctx.fillRect(0, 0, W, H);
    if (opts.inside) opts.inside();
    ctx.lineWidth = 1.6;
    ctx.translate(1.3, 1.3); path(); ctx.strokeStyle = rgba('#ffffff', (night ? .3 : .7) * (opts.edge || 1)); ctx.stroke();
    ctx.translate(-2.4, -2.4); path(); ctx.strokeStyle = rgba('#000000', (night ? .45 : .2) * (opts.edge || 1)); ctx.stroke();
    ctx.restore();
  }

  // A rusted steel plate: a lap seam at the top, a riveted strap at the
  // right, old paint that flakes off, pits, and rust that bleeds from rivets.
  scene('metal', 'rust', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r)), nC = makeNoise(seedOf(r)), nD = makeNoise(seedOf(r)), nE = makeNoise(seedOf(r));
    const SEAM = 244, SX0 = 1484, SX1 = 1684, RY = 186, RS = 118, RX0 = 60, CS = 128;
    const plateOf = (x, y) => x >= SX0 && x < SX1 ? 2 : y < SEAM ? 0 : 1;
    const OFF = [[0, 0], [1113, 339], [-651, 1617]];
    const PAINT = night ? [-.12, -.18, -.1] : [-.04, -.1, .02];

    // The rivets: a row along the seam and 2 staggered rows on the strap.
    const rivets = [];
    for (let x = RX0; x < W; x += RS) if (x < SX0 - 36 || x > SX1 + 36) rivets.push([x, RY]);
    for (let y = 64; y < H + 60; y += CS) { rivets.push([SX0 + 48, y]); rivets.push([SX1 - 48, y + CS / 2]); }
    const nearRivet = (x, y) => {
      let d = 1e9;
      const rx = Math.round((x - RX0) / RS) * RS + RX0;
      if (rx < SX0 - 36 || rx > SX1 + 36) d = Math.hypot(x - rx, y - RY);
      const ya = Math.round((y - 64) / CS) * CS + 64, yb2 = Math.round((y - 64 - CS / 2) / CS) * CS + 64 + CS / 2;
      return Math.min(d, Math.hypot(x - SX0 - 48, y - ya), Math.hypot(x - SX1 + 48, y - yb2));
    };
    const edgeDist = (x, y) => Math.min(Math.abs(y - SEAM) + (x >= SX0 && x < SX1 ? 60 : 0), Math.abs(x - SX0), Math.abs(x - SX1));
    const local = (x, y) => { const o = OFF[plateOf(x, y)]; return [x + o[0], y + o[1]]; };
    // Paint stays where this field is above 0.
    const paintF = (x, y) => {
      const [X, Y] = local(x, y);
      const calm = Math.exp(-(((x - 760) / 640) ** 2) - (((y - 660) / 330) ** 2)) * (night ? .12 : .3);
      return fbm(nB, X / 330, Y / 290, 5) + fbm(nD, X / 34, Y / 34, 2) * .2 + PAINT[plateOf(x, y)] + calm
        - Math.exp(-nearRivet(x, y) / 30) * .6 - Math.exp(-edgeDist(x, y) / 26) * .4;
    };
    // How much rust has grown, from bare steel at 0 to a thick crust at 1.
    const rustF = (x, y) => {
      const [X, Y] = local(x, y);
      return ss(-.55, .2, fbm(nA, X / 360, Y / 300, 4) + Math.exp(-nearRivet(x, y) / 40) * .4 + Math.exp(-edgeDist(x, y) / 50) * .3);
    };

    // Colors, all from the rust hues of the palette.
    const rustDeep = C(night ? withL(P.brown, .22) : withL(P.brown, .4));
    const steel = mixC(C(night ? withL(P.muted, .3) : withL(P.muted, .56)), rustDeep, night ? .35 : .55);
    const rust = C(night ? withL(P.blue, .44) : withL(P.blue, .58));
    const rustHot = C(night ? withL(P.orange, .6) : withL(P.orange, .7));
    const ochre = C(night ? withL(P.yellow, .66) : withL(P.yellow, .8));

    // The bare rusted steel, with a relief from the rust crust.
    const BW = 1280, BH = 720, hf = new Float32Array(BW * BH), base = new Float32Array(BW * BH * 3);
    for (let j = 0, k = 0; j < BH; j++) for (let i = 0; i < BW; i++, k++) {
      const x = (i + .5) * W / BW, y = (j + .5) * H / BH, [X, Y] = local(x, y);
      const ra = rustF(x, y);
      const crust = fbm(nC, X / 22, Y / 22, 4), fleck = nE(X / 6, Y / 6);
      const pf = paintF(x, y), halo = ss(-.16, 0, pf);
      hf[k] = (crust * 3 + fleck * .8) * (.3 + ra) + halo * 1.5;
      let c = mixC(steel, rustDeep, ss(0, .45, ra));
      c = mixC(c, rust, ss(.25, .85, ra + crust * .35));
      c = mixC(c, rustHot, clamp(ss(.1, .7, crust + ra * .3) * ra * .55 + halo * .6, 0, 1));
      c = mixC(c, ochre, ss(.45, .95, fleck + crust * .3) * ra * .45);
      c = mixC(c, rustDeep, halo * ss(.6, 1, halo) * .5);
      base[k * 3] = c[0]; base[k * 3 + 1] = c[1]; base[k * 3 + 2] = c[2];
    }
    const plate = bake(BW, BH, (i, j, o) => {
      const k = j * BW + i, i1 = Math.min(BW - 1, i + 1), j1 = Math.min(BH - 1, j + 1);
      const dx = hf[j * BW + i1] - hf[k], dy = hf[j1 * BW + i] - hf[k];
      const lit = clamp(1 - (dx + dy) * (night ? .22 : .16), .55, 1.45);
      for (let q = 0; q < 3; q++) o[q] = lit > 1 ? base[k * 3 + q] + (255 - base[k * 3 + q]) * (lit - 1) * .5 : base[k * 3 + q] * lit;
    });
    put(ctx, plate);

    // A fine powder of rust grains at output resolution.
    const ln = loopNoise(seedOf(r), 64);
    const powder = tile(ctx, 240, (u, v, o) => {
      const g = fbm(ln, u * 64, v * 64, 2), q = clamp(128 + g * 300, 0, 255);
      o[0] = o[1] = o[2] = q;
    });
    wash(ctx, powder, night ? .5 : .35, 'overlay');

    const GW = 960, GH = 540, rect = [-10, -10, W + 10, H + 10];
    const edge0 = (i, j) => i === 0 || j === 0 || i === GW || j === GH;

    // Scales of rust that lift off the bare steel.
    const scales = contours(field(GW, GH, rect, (x, y, i, j) => {
      if (edge0(i, j)) return -1;
      const [X, Y] = local(x, y);
      return fbm(nC, X / 48 + 9, Y / 40, 4) * 1.2 + rustF(x, y) * .45 + ss(-.3, -.05, paintF(x, y)) * .25 - .66 - Math.max(0, paintF(x, y) + .06) * 4;
    }), GW, GH, 0);
    flakes(ctx, scales, GW, GH, rect, rgba(mixHex(night ? withL(P.blue, .46) : withL(P.blue, .6), night ? withL(P.orange, .55) : withL(P.orange, .66), .3), .55), night, {
      lift: .6, shadow: .8, edge: .7,
      inside: () => wash(ctx, powder, night ? .55 : .4, 'overlay'),
    });

    // The paint that is left, as sharp flakes with lifted edges.
    const paint = night ? withL(P.cyan, .62) : mixHex(P.background, withL(P.yellow, .9), .25);
    const stain = bake(960, 540, (i, j, o) => {
      const x = i * 2, y = j * 2, [X, Y] = local(x, y), v = fbm(nE, X / 120, Y / 120, 4), e = paintF(x, y);
      const c = mixC(C(paint), rust, clamp(ss(.25, -.05, e) * .5 + ss(.15, .7, v) * .2, 0, 1));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 255;
    });
    const plines = contours(field(GW, GH, rect, (x, y, i, j) => edge0(i, j) ? -1 : paintF(x, y)), GW, GH, 0);
    // Old paint crazes into a net of cracks: the edges between Voronoi cells.
    // The net repeats on a tile, baked once at output resolution.
    const cz = 26, NC = 16, TT = cz * NC, cs = seedOf(r) & 1023;
    const wrap = v => ((v % NC) + NC) % NC;
    const tn = Math.max(16, Math.round(TT * S)), pxu = TT / tn;
    const [cr, cg, cb] = rgb(night ? '#000000' : withL(P.brown, .45)), ca = night ? 90 : 64;
    const tc = bake(tn, tn, (i, j, o) => {
      const x = (i + .5) * pxu, y = (j + .5) * pxu, ci = Math.floor(x / cz), cj = Math.floor(y / cz);
      let f1 = 1e9, f2 = 1e9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const a = ci + di, b = cj + dj, px = (a + .15 + hash2(wrap(a), wrap(b), cs) * .7) * cz, py = (b + .15 + hash2(wrap(a), wrap(b), cs + 1) * .7) * cz;
        const d = (x - px) * (x - px) + (y - py) * (y - py);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
      }
      const v = Math.sqrt(f2) - Math.sqrt(f1);
      o[0] = cr; o[1] = cg; o[2] = cb; o[3] = ca * (1 - ss(.7, .7 + pxu * 2.4, v));
    });
    const craze = ctx.createPattern(tc, 'repeat');
    craze.setTransform(new DOMMatrix().scale(pxu));
    // Some areas crack more than others.
    const crazeMask = bake(240, 135, (i, j, o) => { o[0] = o[1] = o[2] = 0; o[3] = 40 + 215 * ss(-.3, .3, fbm(nC, i / 26 + 3, j / 26, 3)); });
    flakes(ctx, plines, GW, GH, rect, paint, night, {
      inside: () => {
        put(ctx, stain, 0, 0, W, H, .85); wash(ctx, powder, night ? .18 : .14, 'overlay');
        const [lc, lx] = layer();
        lx.fillStyle = craze; lx.fillRect(0, 0, W, H);
        put(lx, crazeMask, 0, 0, W, H, 1, 'destination-in');
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(lc, 0, 0); ctx.restore();
      },
    });

    // Pits in the bare steel.
    const pr = rng(seedOf(r));
    for (let q = 0; q < 2600; q++) {
      const x = pr() * W, y = pr() * H;
      if (paintF(x, y) > -.04 || nA(x / 150 + 40, y / 150) < -.05 + pr() * .4) continue;
      const rad = 1.4 + pr() ** 2.5 * 7;
      ctx.fillStyle = rgba(night ? P.darker_background : withL(P.brown, .3), .45 + pr() * .3);
      ctx.beginPath(); ellipse(ctx, x, y, rad, rad * (.75 + pr() * .3), pr() * 3); ctx.fill();
      ctx.fillStyle = rgba('#000000', .35);
      ctx.beginPath(); ellipse(ctx, x - rad * .2, y - rad * .2, rad * .7, rad * .6); ctx.fill();
      ctx.strokeStyle = rgba(night ? withL(P.orange, .72) : '#ffffff', night ? .35 : .5); ctx.lineWidth = .9;
      ctx.beginPath(); ctx.arc(x, y, rad, -.2, 1.9); ctx.stroke();
    }

    // The seams: a shadow under each raised edge.
    const shade = (x, y, w, h, dx, dy) => {
      ctx.fillStyle = linear(ctx, x, y, x + dx, y + dy, [[0, rgba('#000000', night ? .6 : .32)], [1, rgba('#000000', 0)]]);
      ctx.fillRect(x, y, w, h);
    };
    shade(0, SEAM, SX0, 20, 0, 20);
    shade(SX1, SEAM, W - SX1, 20, 0, 20);
    shade(SX1, 0, 24, H, 24, 0);

    // Rust that bleeds down from the rivets and the seam: bundles of thin
    // drips on their own layer, softened a little.
    {
      const [lc, lx] = layer();
      const drip = (x, y, len, wid, a) => {
        for (let q = 0, n = 2 + Math.floor(pr() * 4); q < n; q++) {
          const x0 = x + (pr() - .5) * wid * 2, l = len * (.35 + pr() * .65), w0 = .8 + pr() * 2.6, sway = (pr() - .5) * 8;
          lx.fillStyle = linear(lx, 0, y, 0, y + l, [[0, rgba(mixHex(P.blue, P.brown, .45), a)], [.5, rgba(mixHex(P.blue, P.brown, .2), a * .6)], [1, rgba(P.blue, 0)]]);
          lx.beginPath(); lx.moveTo(x0 - w0, y);
          lx.bezierCurveTo(x0 - w0, y + l * .5, x0 + sway - w0 * .3, y + l * .8, x0 + sway, y + l);
          lx.bezierCurveTo(x0 + sway + w0 * .3, y + l * .8, x0 + w0, y + l * .5, x0 + w0, y);
          lx.fill();
        }
        lx.fillStyle = linear(lx, 0, y, 0, y + len * .5, [[0, rgba(P.blue, a * .35)], [1, rgba(P.blue, 0)]]);
        lx.beginPath(); lx.moveTo(x - wid, y); lx.quadraticCurveTo(x, y + len * .6, x + wid, y); lx.fill();
      };
      const a0 = night ? .6 : .5;
      for (const [x, y] of rivets) if (pr() < .85) drip(x, y + 14, 90 + pr() ** 1.5 * 320, 8 + pr() * 6, a0 * (.6 + pr() * .4));
      for (let q = 0; q < 24; q++) { const x = pr() * W; if (x > SX0 - 10 && x < SX1 + 10) continue; drip(x, SEAM + 3, 60 + pr() ** 2 * 420, 4 + pr() * 10, a0 * (.4 + pr() * .5)); }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(1.4); ctx.globalCompositeOperation = night ? 'source-over' : 'multiply'; ctx.drawImage(lc, 0, 0); ctx.restore();
    }

    // The rivets: a halo of rust, a shadow, a crevice and a domed head.
    for (const [x, y] of rivets) {
      if (y > H + 40) continue;
      const R0 = 21;
      ctx.fillStyle = radial(ctx, x, y, R0, R0 + 26, [[0, rgba(night ? withL(P.orange, .55) : withL(P.orange, .62), .5)], [1, rgba(P.orange, 0)]]);
      ctx.beginPath(); circle(ctx, x, y, R0 + 26); ctx.fill();
      ctx.fillStyle = radial(ctx, x + 5, y + 6, R0 * .6, R0 + 12, [[0, rgba('#000000', night ? .65 : .38)], [1, rgba('#000000', 0)]]);
      ctx.beginPath(); circle(ctx, x + 5, y + 6, R0 + 12); ctx.fill();
      ctx.fillStyle = rgba(withL(P.brown, night ? .14 : .26), .9);
      ctx.beginPath(); circle(ctx, x, y, R0 + 2.2); ctx.fill();
      ctx.fillStyle = radial(ctx, x - 7, y - 8, 1, R0 * 1.25, [[0, night ? withL(P.yellow, .8) : withL(P.yellow, .9)], [.22, night ? withL(P.orange, .6) : withL(P.orange, .72)], [.65, night ? withL(P.blue, .38) : withL(P.blue, .52)], [1, withL(P.brown, night ? .16 : .28)]]);
      ctx.beginPath(); circle(ctx, x, y, R0); ctx.fill();
      ctx.save(); ctx.beginPath(); circle(ctx, x, y, R0); ctx.clip();
      wash(ctx, powder, night ? .6 : .45, 'overlay', [x - R0, y - R0, R0 * 2, R0 * 2]);
      for (let q = 0; q < 5; q++) {
        const a = pr() * TAU, d = pr() * R0 * .8, rr = .6 + pr() * 1.6;
        ctx.fillStyle = rgba(withL(P.brown, .18), .5);
        ctx.beginPath(); circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, rr); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = rgba('#ffffff', night ? .35 : .55);
      ctx.beginPath(); ellipse(ctx, x - 7, y - 8, 5, 3, -.7); ctx.fill();
      ctx.strokeStyle = rgba(night ? withL(P.yellow, .75) : '#ffffff', night ? .2 : .35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, R0 - .8, Math.PI * .95, Math.PI * 1.6); ctx.stroke();
    }

    // The lit corners of the raised edges.
    ctx.fillStyle = rgba(night ? withL(P.yellow, .8) : '#ffffff', night ? .4 : .7);
    ctx.fillRect(0, SEAM - 2.4, SX0, 1.6); ctx.fillRect(SX1, SEAM - 2.4, W - SX1, 1.6);
    ctx.fillRect(SX0, 0, 1.8, H);
    ctx.fillStyle = rgba('#000000', night ? .6 : .3);
    ctx.fillRect(SX1 - 2.2, 0, 2.2, H);

    // A low warm light from the upper left at night, a soft daylight by day.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = radial(ctx, 260, -120, 200, 2300, night
      ? [[0, '#ffffff'], [.45, mixHex('#ffffff', P.orange, .25)], [1, mixHex(P.darker_background, P.brown, .2)]]
      : [[0, '#ffffff'], [1, mixHex('#ffffff', P.darker_background, .9)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 200, 0, 0, 900, [[0, rgba(P.orange, .16)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });

  // ---------- metal/brass ----------

  // Polished brass parts standing on smoked glass: 2 meshed gears, a
  // porthole, a gauge and a ball, mirrored in the glass. Turned faces get a
  // conic sheen, edges get a bevel lit from the upper left.
  scene('metal', 'brass', (ctx, P, r) => {
    const night = P.night;
    const B = night
      ? { spec: mixHex(P.bright_yellow, '#ffffff', .4), hi: P.bright_yellow, mid: P.yellow, base: P.accent, lo: mixHex(P.brown, P.accent, .3), deep: mixHex(P.brown, '#000000', .45) }
      : { spec: '#ffffff', hi: withL(P.yellow, .93), mid: withL(P.yellow, .82), base: withL(P.accent, .68), lo: withL(P.brown, .48), deep: withL(P.brown, .34) };
    const FLOOR = 800;
    const [oc, X] = layer();

    // A conic sheen for a turned face, with 2 bright lobes.
    const turned = (x, y, a = -.6) => {
      const g = X.createConicGradient(a, x, y);
      [[0, B.spec], [.05, B.hi], [.13, B.base], [.22, B.lo], [.32, B.base], [.42, B.mid], [.5, B.hi], [.56, B.mid], [.66, B.base], [.76, B.lo], [.88, B.base], [.96, B.hi], [1, B.spec]]
        .forEach(([o, c]) => g.addColorStop(o, c));
      return g;
    };
    const bevel = (x, y, rad) => linear(X, x - rad * .7, y - rad * .7, x + rad * .7, y + rad * .7, [[0, B.spec], [.35, B.hi], [.6, B.lo], [1, B.deep]]);
    const rings = (x, y, r0, r1, step = 2.2) => {
      X.lineWidth = .6;
      for (let rad = r0, q = 0; rad < r1; rad += step, q++) {
        X.strokeStyle = q % 2 ? rgba('#ffffff', .05) : rgba('#000000', .07);
        X.beginPath(); circle(X, x, y, rad); X.stroke();
      }
    };
    // A soft light falloff over a part, light at the upper left.
    const shadeOver = (x, y, rad) => {
      X.fillStyle = radial(X, x - rad * .5, y - rad * .5, rad * .1, rad * 1.8, [[0, rgba('#ffffff', night ? .1 : .16)], [.5, rgba('#000000', 0)], [1, rgba('#000000', night ? .45 : .25)]]);
      X.beginPath(); circle(X, x, y, rad * 2); X.fill();
    };

    // ----- paths -----
    const gearPath = (c, x, y, R, teeth, depth, rot) => {
      const pitch = TAU / teeth, root = R - depth;
      c.moveTo(x + Math.cos(rot) * root, y + Math.sin(rot) * root);
      for (let i = 0; i < teeth; i++) {
        const a = rot + i * pitch;
        c.arc(x, y, root, a, a + pitch * .38);
        c.lineTo(x + Math.cos(a + pitch * .5) * R, y + Math.sin(a + pitch * .5) * R);
        c.arc(x, y, R, a + pitch * .5, a + pitch * .78);
        c.lineTo(x + Math.cos(a + pitch * .9) * root, y + Math.sin(a + pitch * .9) * root);
        c.arc(x, y, root, a + pitch * .9, a + pitch);
      }
      c.closePath();
    };
    // A window between radii r0 and r1, from angle a0 to a1, with round corners of radius k.
    const slot = (c, x, y, r0, r1, a0, a1, k = 14) => {
      const d1 = Math.asin(k / (r1 - k)), d0 = Math.asin(k / (r0 + k));
      const at = (a, dist) => [x + Math.cos(a) * dist, y + Math.sin(a) * dist];
      const p0 = at(a0, (r0 + k) * Math.cos(d0));
      c.moveTo(p0[0], p0[1]);
      const po = at(a0, (r1 - k) * Math.cos(d1)); c.lineTo(po[0], po[1]);
      let o = at(a0 + d1, r1 - k); c.arc(o[0], o[1], k, a0 - Math.PI / 2, a0 + d1);
      c.arc(x, y, r1, a0 + d1, a1 - d1);
      o = at(a1 - d1, r1 - k); c.arc(o[0], o[1], k, a1 - d1, a1 + Math.PI / 2);
      const pi = at(a1, (r0 + k) * Math.cos(d0)); c.lineTo(pi[0], pi[1]);
      o = at(a1 - d0, r0 + k); c.arc(o[0], o[1], k, a1 + Math.PI / 2, a1 - d0 + Math.PI);
      c.arc(x, y, r0, a1 - d0, a0 + d0, true);
      o = at(a0 + d0, r0 + k); c.arc(o[0], o[1], k, a0 + d0 + Math.PI, a0 + Math.PI * 1.5);
      c.closePath();
    };
    const hexPath = (c, x, y, rad, rot) => { c.moveTo(x + Math.cos(rot) * rad, y + Math.sin(rot) * rad); for (let i = 1; i <= 6; i++) c.lineTo(x + Math.cos(rot + i * TAU / 6) * rad, y + Math.sin(rot + i * TAU / 6) * rad); c.closePath(); };

    // ----- the parts, all standing on the floor line -----
    const G1 = { x: 236, R: 420, teeth: 44, depth: 28, rot: r() }; G1.y = FLOOR - G1.R;
    const G2 = { R: 172, teeth: 20, depth: 26, rot: r() }; G2.y = FLOOR - G2.R;
    G2.x = G1.x + Math.sqrt((G1.R + G2.R - 30) ** 2 - (G1.y - G2.y) ** 2);
    const PH = { x: 1500, R: 300 }; PH.y = FLOOR - PH.R;
    const GA = { x: 1790, R: 178 }; GA.y = FLOOR - GA.R;
    const BALL = { x: 1104, R: 74 }; BALL.y = FLOOR - BALL.R;

    const drawGear = (G, holes, hub) => {
      const { x, y, R, teeth, depth, rot } = G;
      const body = c => { gearPath(c, x, y, R, teeth, depth, rot); holes(c); };
      X.beginPath(); body(X);
      X.fillStyle = turned(x, y, -.7 + rot * .2); X.fill('evenodd');
      X.save(); X.beginPath(); body(X); X.clip('evenodd');
      rings(x, y, R * .25, R - depth, 2.4);
      shadeOver(x, y, R);
      X.restore();
      X.lineJoin = 'round';
      X.beginPath(); body(X); X.lineWidth = 3; X.strokeStyle = bevel(x, y, R); X.stroke();
      X.beginPath(); body(X); X.lineWidth = 1; X.strokeStyle = rgba('#000000', .35); X.stroke();
      X.lineWidth = 2.5; X.strokeStyle = rgba('#000000', night ? .4 : .2);
      X.beginPath(); circle(X, x + 1, y + 1.5, R - depth - 16); X.stroke();
      X.strokeStyle = rgba('#ffffff', night ? .2 : .45); X.lineWidth = 1.2;
      X.beginPath(); circle(X, x - .6, y - .8, R - depth - 16); X.stroke();
      // The hub, a raised boss with a bore.
      const [hr, bore] = hub;
      X.beginPath(); circle(X, x, y, hr); circle(X, x, y, bore);
      X.fillStyle = turned(x, y, .9); X.fill('evenodd');
      X.save(); X.beginPath(); circle(X, x, y, hr); X.clip(); rings(x, y, bore, hr, 1.8); X.restore();
      X.lineWidth = 3; X.strokeStyle = bevel(x, y, hr);
      X.beginPath(); circle(X, x, y, hr); X.stroke();
      X.strokeStyle = linear(X, x - bore, y - bore, x + bore, y + bore, [[0, B.deep], [1, B.hi]]);
      X.beginPath(); circle(X, x, y, bore); X.stroke();
    };
    const holes1 = c => {
      for (let i = 0; i < 6; i++) { const a = G1.rot + i * TAU / 6; slot(c, G1.x, G1.y, 140, 330, a + .15, a + TAU / 6 - .15, 22); }
      circle(c, G1.x, G1.y, 40);
    };
    const holes2 = c => {
      for (let i = 0; i < 5; i++) { const a = G2.rot + i * TAU / 5; circle(c, G2.x + Math.cos(a) * 90, G2.y + Math.sin(a) * 90, 30); }
      circle(c, G2.x, G2.y, 22);
    };

    const drawPorthole = () => {
      const { x, y, R } = PH, rg = R * .66;
      // The hinge on the left: an arm and a knuckle with a pin.
      const hx = x - R - 34, hy = y - 40;
      X.lineCap = 'round'; X.lineWidth = 74;
      X.strokeStyle = linear(X, hx - 40, hy - 40, hx + 80, hy + 60, [[0, B.hi], [.45, B.base], [1, B.lo]]);
      X.beginPath(); X.moveTo(x - R + 30, hy + 10); X.lineTo(hx, hy); X.stroke();
      X.lineWidth = 2; X.strokeStyle = rgba('#000000', .3);
      X.beginPath(); circle(X, hx, hy, 37); X.stroke();
      X.beginPath(); circle(X, hx, hy, 22); X.fillStyle = turned(hx, hy); X.fill();
      X.lineWidth = 1.5; X.strokeStyle = bevel(hx, hy, 22); X.stroke();
      X.beginPath(); circle(X, hx, hy, 7); X.fillStyle = B.deep; X.fill();
      // The heavy ring.
      X.beginPath(); circle(X, x, y, R); circle(X, x, y, rg);
      X.fillStyle = turned(x, y, -.9); X.fill('evenodd');
      X.save(); X.beginPath(); circle(X, x, y, R); circle(X, x, y, rg); X.clip('evenodd');
      rings(x, y, rg, R, 2.6);
      shadeOver(x, y, R);
      X.restore();
      X.lineWidth = 3.5; X.strokeStyle = bevel(x, y, R);
      X.beginPath(); circle(X, x, y, R - 1.5); X.stroke();
      X.strokeStyle = linear(X, x - rg, y - rg, x + rg, y + rg, [[0, B.deep], [.5, B.lo], [1, B.spec]]);
      X.beginPath(); circle(X, x, y, rg + 1.5); X.stroke();
      X.lineWidth = 2; X.strokeStyle = rgba('#000000', night ? .45 : .22);
      X.beginPath(); circle(X, x + 1, y + 1.5, R * .83); X.stroke();
      X.lineWidth = 1.2; X.strokeStyle = rgba('#ffffff', night ? .25 : .5);
      X.beginPath(); circle(X, x - .6, y - .8, R * .83); X.stroke();
      for (let i = 0; i < 10; i++) {
        const a = i * TAU / 10 + .3, bx = x + Math.cos(a) * R * .915, by = y + Math.sin(a) * R * .915;
        X.fillStyle = rgba('#000000', .4); X.beginPath(); hexPath(X, bx + 3, by + 4, 17, a); X.fill();
        X.beginPath(); hexPath(X, bx, by, 17, a);
        X.fillStyle = linear(X, bx - 17, by - 17, bx + 17, by + 17, [[0, B.spec], [.4, B.mid], [1, B.lo]]); X.fill();
        X.beginPath(); circle(X, bx, by, 10); X.fillStyle = turned(bx, by, a); X.fill();
      }
      // The glass: smoked, with the reflection of a window.
      X.save(); X.beginPath(); circle(X, x, y, rg); X.clip();
      X.fillStyle = night ? radial(X, x - rg * .3, y - rg * .3, 0, rg * 1.3, [[0, mixHex(P.lighter_background, P.accent, .14)], [1, P.darker_background]])
        : radial(X, x - rg * .3, y - rg * .3, 0, rg * 1.3, [[0, mixHex(P.background, '#ffffff', .6)], [1, mixHex(P.background, P.muted, .35)]]);
      X.fillRect(x - rg, y - rg, rg * 2, rg * 2);
      X.fillStyle = rgba('#000000', night ? .5 : .16);
      X.beginPath(); circle(X, x + 12, y + 16, rg); circle(X, x, y, rg + 40); X.fill('evenodd');
      X.translate(x, y); X.rotate(-.75);
      X.fillStyle = linear(X, -rg, 0, rg, 0, [[0, rgba('#ffffff', 0)], [.25, rgba('#ffffff', night ? .1 : .5)], [.42, rgba('#ffffff', night ? .02 : .1)], [.5, rgba('#ffffff', night ? .07 : .35)], [.62, rgba('#ffffff', 0)]]);
      X.fillRect(-rg, -rg, rg * 2, rg * 2);
      X.restore();
      X.lineWidth = 2; X.strokeStyle = rgba('#ffffff', night ? .35 : .7);
      X.beginPath(); X.arc(x, y, rg - 6, Math.PI * 1.05, Math.PI * 1.45); X.stroke();
    };

    const drawGauge = () => {
      const { x, y, R } = GA, rf = R * .8;
      X.beginPath(); circle(X, x, y, R); circle(X, x, y, rf);
      X.fillStyle = turned(x, y, -.4); X.fill('evenodd');
      X.save(); X.beginPath(); circle(X, x, y, R); circle(X, x, y, rf); X.clip('evenodd'); rings(x, y, rf, R, 2); X.restore();
      X.lineWidth = 3; X.strokeStyle = bevel(x, y, R); X.beginPath(); circle(X, x, y, R - 1.5); X.stroke();
      X.strokeStyle = linear(X, x - rf, y - rf, x + rf, y + rf, [[0, B.deep], [1, B.spec]]); X.beginPath(); circle(X, x, y, rf + 1.5); X.stroke();
      const face = night ? P.darker_background : mixHex(P.background, '#ffffff', .5);
      X.fillStyle = radial(X, x - rf * .3, y - rf * .4, 0, rf * 1.2, [[0, night ? mixHex(face, P.accent, .1) : face], [1, night ? face : mixHex(face, P.muted, .2)]]);
      X.beginPath(); circle(X, x, y, rf); X.fill();
      const tick = night ? B.mid : withL(P.brown, .38);
      for (let i = 0; i <= 50; i++) {
        const a = Math.PI * .75 + i / 50 * Math.PI * 1.5, big = i % 5 === 0;
        X.strokeStyle = tick; X.lineWidth = big ? 2.6 : 1.1;
        X.beginPath(); X.moveTo(x + Math.cos(a) * rf * (big ? .74 : .82), y + Math.sin(a) * rf * (big ? .74 : .82)); X.lineTo(x + Math.cos(a) * rf * .9, y + Math.sin(a) * rf * .9); X.stroke();
      }
      X.lineWidth = 1.2; X.beginPath(); X.arc(x, y, rf * .92, Math.PI * .75, Math.PI * 2.25); X.stroke();
      X.strokeStyle = night ? P.red : withL(P.red, .55); X.lineWidth = 5;
      X.beginPath(); X.arc(x, y, rf * .86, Math.PI * 1.95, Math.PI * 2.25); X.stroke();
      const na = Math.PI * .75 + .68 * Math.PI * 1.5;
      const needle = (dx, dy) => poly(X, [[x + dx + Math.cos(na) * rf * .84, y + dy + Math.sin(na) * rf * .84], [x + dx + Math.cos(na + 1.6) * 5, y + dy + Math.sin(na + 1.6) * 5], [x + dx - Math.cos(na) * 30, y + dy - Math.sin(na) * 30], [x + dx + Math.cos(na - 1.6) * 5, y + dy + Math.sin(na - 1.6) * 5]]);
      X.fillStyle = rgba('#000000', .35); X.beginPath(); needle(4, 6); X.fill();
      X.fillStyle = linear(X, x - 40, y - 40, x + 40, y + 40, [[0, B.spec], [1, B.base]]); X.beginPath(); needle(0, 0); X.fill();
      X.beginPath(); circle(X, x, y, 14); X.fillStyle = radial(X, x - 4, y - 5, 1, 16, [[0, B.spec], [.5, B.mid], [1, B.lo]]); X.fill();
      X.save(); X.beginPath(); circle(X, x, y, rf); X.clip();
      X.translate(x, y); X.rotate(-.8);
      X.fillStyle = linear(X, -rf, 0, rf, 0, [[0, rgba('#ffffff', 0)], [.2, rgba('#ffffff', night ? .12 : .4)], [.34, rgba('#ffffff', 0)]]);
      X.fillRect(-rf, -rf, rf * 2, rf * 2);
      X.restore();
    };

    // A polished ball: it mirrors the light backdrop above and the dark glass below.
    const drawBall = () => {
      const { x, y, R } = BALL;
      X.fillStyle = linear(X, 0, y - R, 0, y + R, [[0, B.hi], [.42, B.base], [.5, B.deep], [.62, B.lo], [1, B.mid]]);
      X.beginPath(); circle(X, x, y, R); X.fill();
      X.fillStyle = radial(X, x - R * .38, y - R * .42, 0, R * .5, [[0, rgba('#ffffff', .95)], [.3, rgba(B.spec, .5)], [1, rgba(B.spec, 0)]]);
      X.beginPath(); circle(X, x, y, R); X.fill();
      X.fillStyle = radial(X, x + R * .1, y + R * .1, R * .6, R, [[0, rgba('#000000', 0)], [1, rgba('#000000', .35)]]);
      X.beginPath(); circle(X, x, y, R); X.fill();
    };

    drawGear(G1, holes1, [92, 40]);
    drawGear(G2, holes2, [52, 22]);
    drawPorthole();
    drawGauge();
    drawBall();

    // ----- the backdrop and the smoked glass floor -----
    if (night) {
      skyGradient(ctx, [[0, P.darker_background], [.6, P.background], [FLOOR / H, mixHex(P.background, P.lighter_background, .7)], [FLOOR / H + .001, P.darker_background], [1, P.background]]);
      ctx.fillStyle = radial(ctx, 960, 520, 0, 1000, [[0, rgba(P.accent, .12)], [.5, rgba(P.accent, .04)], [1, rgba(P.accent, 0)]]);
      ctx.fillRect(0, 0, W, H);
    } else {
      skyGradient(ctx, [[0, mixHex(P.background, P.darker_background, .5)], [.5, P.background], [FLOOR / H, mixHex(P.background, '#ffffff', .7)], [FLOOR / H + .001, mixHex(P.background, P.darker_background, .35)], [1, mixHex(P.background, P.darker_background, .7)]]);
      ctx.fillStyle = radial(ctx, 960, 480, 0, 1000, [[0, rgba('#ffffff', .6)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, FLOOR);
    }

    // The reflection in the glass, fading with depth.
    {
      const [rc, rx] = layer();
      rx.save(); rx.setTransform(1, 0, 0, -1, 0, Math.round(FLOOR * 2 * S)); rx.drawImage(oc, 0, 0); rx.restore();
      rx.globalCompositeOperation = 'destination-in';
      rx.fillStyle = linear(rx, 0, FLOOR, 0, FLOOR + 300, [[0, `rgba(0,0,0,${night ? .45 : .32})`], [1, 'rgba(0,0,0,0)']]);
      rx.fillRect(0, FLOOR, W, H - FLOOR);
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(1.5); ctx.drawImage(rc, 0, 0); ctx.restore();
    }
    // Contact shadows where the parts touch the glass.
    [[G1.x, G1.R], [G2.x, G2.R], [PH.x, PH.R], [GA.x, GA.R], [BALL.x, BALL.R]].forEach(([x, rad]) => {
      ctx.fillStyle = radial(ctx, x, FLOOR, 0, rad * .5, [[0, rgba('#000000', night ? .7 : .3)], [1, rgba('#000000', 0)]]);
      ctx.beginPath(); ellipse(ctx, x, FLOOR, rad * .5, 9); ctx.fill();
    });
    // A soft glow on the backdrop behind each part.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = blurPx(30); ctx.globalAlpha = night ? .5 : .25;
    ctx.drawImage(oc, 0, 0);
    ctx.restore();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(oc, 0, 0); ctx.restore();
    // The edge of the glass catches the light.
    ctx.fillStyle = linear(ctx, 0, 0, W, 0, [[0, rgba(B.hi, 0)], [.5, rgba(B.hi, night ? .25 : .5)], [1, rgba(B.hi, 0)]]);
    ctx.fillRect(0, FLOOR - .5, W, 1.2);

    vignette(ctx, P, night ? .55 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });

  // ---------- metal/machined ----------

  // Fills the ring between a rounded rectangle and its inset copy, with one
  // flat tone per side, like a chamfer lit from the upper left.
  function chamfer(ctx, x, y, w, h, rad, k, tones) {
    const [top, left, right, bottom] = tones, cx = x + w / 2, cy = y + h / 2;
    const a = Math.atan2(h / 2, w / 2) / TAU, e = .004;
    const g = ctx.createConicGradient(0, cx, cy);
    [[0, right], [a - e, right], [a + e, bottom], [.5 - a - e, bottom], [.5 - a + e, left], [.5 + a - e, left], [.5 + a + e, top], [1 - a - e, top], [1 - a + e, right], [1, right]]
      .forEach(([o, c]) => g.addColorStop(clamp(o, 0, 1), c));
    ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); ctx.roundRect(x + k, y + k, w - 2 * k, h - 2 * k, Math.max(0, rad - k));
    ctx.fillStyle = g; ctx.fill('evenodd');
  }

  // Machined gunmetal: a brushed base plate, a raised plate with a dial knob,
  // a knurled rod, a milled pocket with a cyan bar graph, and cap screws.
  scene('metal', 'machined', (ctx, P, r) => {
    const night = P.night;
    const M = L => withL(P.muted, L);
    const m = night ? [M(.15), M(.22), M(.3), M(.38), M(.52), M(.72), M(.9)] : [M(.5), M(.62), M(.74), M(.8), M(.86), M(.93), '#ffffff'];
    const cyan = night ? P.accent : adjust(withL(P.accent, .64), { Cx: 1.7 }), cyanHi = night ? P.bright_blue : adjust(withL(P.accent, .8), { Cx: 1.4 });
    const shadow = (blur, dx, dy, a) => { ctx.shadowColor = rgba(night ? '#000000' : withL(P.muted, .3), a); ctx.shadowBlur = blur * S; ctx.shadowOffsetX = dx * S; ctx.shadowOffsetY = dy * S; };
    const noShadow = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = ctx.shadowOffsetY = 0; };
    const pr = rng(seedOf(r));

    // Long brushing streaks inside the current clip.
    const brush = (x0, y0, x1, y1, a = 1) => {
      ctx.lineWidth = .7;
      for (let y = y0; y < y1; y += .9 + pr() * 1.6) {
        ctx.strokeStyle = pr() < .5 ? rgba('#ffffff', (.015 + pr() * .05) * a) : rgba('#000000', (.02 + pr() * .07) * a);
        const xa = x0 + pr() * (x1 - x0) * .6 - 100, xb = xa + 200 + pr() * (x1 - x0);
        ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke();
      }
    };
    // A soft vertical band of light, as brushed metal spreads a highlight across its grain.
    const sheen = (x, y0, y1, w, a) => {
      ctx.fillStyle = linear(ctx, x - w, 0, x + w, 0, [[0, rgba('#ffffff', 0)], [.5, rgba('#ffffff', a)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(x - w, y0, w * 2, y1 - y0);
    };
    // A socket head cap screw in a counterbore.
    const screw = (x, y, rad) => {
      ctx.fillStyle = m[0]; ctx.beginPath(); circle(ctx, x, y, rad + 3.5); ctx.fill();
      shadow(6, 2, 3, .6);
      const g = ctx.createConicGradient(-.7, x, y);
      [[0, m[6]], [.12, m[3]], [.25, m[1]], [.4, m[3]], [.5, m[5]], [.62, m[3]], [.75, m[1]], [.9, m[3]], [1, m[6]]].forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g; ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
      noShadow();
      ctx.lineWidth = 1.2; ctx.strokeStyle = linear(ctx, x - rad, y - rad, x + rad, y + rad, [[0, m[6]], [1, m[0]]]);
      ctx.beginPath(); circle(ctx, x, y, rad - .6); ctx.stroke();
      const hr = rad * .45, a0 = pr();
      ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = a0 + i * TAU / 6; ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * hr, y + Math.sin(a) * hr); } ctx.closePath();
      ctx.fillStyle = linear(ctx, x - hr, y - hr, x + hr, y + hr, [[0, m[0]], [.6, '#000000'], [1, m[2]]]); ctx.fill();
    };

    // ----- the base plate -----
    ctx.fillStyle = linear(ctx, 0, 0, W, H, [[0, m[3]], [.5, m[2]], [1, m[1]]]); ctx.fillRect(0, 0, W, H);
    brush(0, 0, W, H, 1.2);
    sheen(820, 0, H, 380, night ? .06 : .22);
    sheen(300, 0, H, 160, night ? .035 : .12);

    // A V-groove across the plate.
    const GY = 560;
    ctx.fillStyle = linear(ctx, 0, GY - 5, 0, GY + 5, [[0, m[0]], [.45, m[1]], [.55, m[5]], [1, m[3]]]); ctx.fillRect(0, GY - 5, 1180, 10);

    // ----- the knurled rod at the top left, with 2 mounts -----
    {
      const y0 = 110, h = 74, x0 = -20, x1 = 1000, d = 11;
      shadow(18, 8, 14, .7);
      ctx.fillStyle = m[2]; ctx.fillRect(x0, y0, x1 - x0, h);
      noShadow();
      // Diamond facets: each one is 4 triangles, lit by the cylinder normal.
      const rows = Math.round(h / d);
      for (let j = 0; j < rows; j++) for (let i = 0, cx = x0 + (j % 2) * d / 2; cx < x1 + d; i++, cx += d) {
        const cy = y0 + (j + .5) * h / rows, nz = Math.sin((j + .5) / rows * Math.PI), ny = -Math.cos((j + .5) / rows * Math.PI);
        const L0 = (dn, dh) => clamp(.25 + nz * .45 - ny * .35 * dn + dh, 0, 1);
        const tone = t => m[clamp(Math.round(t * 6), 0, 6)];
        const hw = d * .55, hh = h / rows * .55;
        const tri = (pts, t) => { ctx.fillStyle = tone(t); ctx.beginPath(); poly(ctx, pts); ctx.fill(); };
        tri([[cx - hw, cy], [cx, cy - hh], [cx, cy]], L0(1, .2));
        tri([[cx, cy - hh], [cx + hw, cy], [cx, cy]], L0(1, 0));
        tri([[cx + hw, cy], [cx, cy + hh], [cx, cy]], L0(-1, -.15));
        tri([[cx, cy + hh], [cx - hw, cy], [cx, cy]], L0(-1, .05));
      }
      ctx.fillStyle = linear(ctx, 0, y0, 0, y0 + h, [[0, rgba('#000000', .45)], [.25, rgba('#ffffff', night ? .08 : .15)], [.4, rgba('#ffffff', 0)], [.8, rgba('#000000', .25)], [1, rgba('#000000', .55)]]);
      ctx.fillRect(x0, y0, x1 - x0, h);
      // Plain collars and round mounts with screws.
      [[150, 64], [860, 64]].forEach(([mx, mw]) => {
        ctx.fillStyle = linear(ctx, 0, y0 - 6, 0, y0 + h + 6, [[0, m[1]], [.3, m[6]], [.5, m[4]], [1, m[0]]]);
        ctx.fillRect(mx - mw / 2, y0 - 6, mw, h + 12);
        ctx.fillStyle = rgba('#000000', .4); ctx.fillRect(mx + mw / 2, y0 - 6, 3, h + 12);
      });
      [[150, y0 + h / 2], [860, y0 + h / 2]].forEach(([sx, sy]) => screw(sx, sy, 12));
      // A turned end cap with a chamfer.
      ctx.fillStyle = linear(ctx, 0, y0, 0, y0 + h, [[0, m[1]], [.25, m[6]], [.45, m[4]], [.8, m[1]], [1, m[0]]]);
      ctx.beginPath(); ctx.moveTo(x1, y0); ctx.lineTo(x1 + 22, y0 + 8); ctx.lineTo(x1 + 22, y0 + h - 8); ctx.lineTo(x1, y0 + h); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#000000', .35); ctx.fillRect(x1 - 1, y0, 2, h);
    }

    // ----- the raised plate on the right with a dial knob -----
    const PX = 1236, PY = 70, PWd = 760, PHt = 940;
    shadow(34, 14, 22, night ? .75 : .4);
    ctx.fillStyle = m[2]; ctx.beginPath(); ctx.roundRect(PX, PY, PWd, PHt, 26); ctx.fill();
    noShadow();
    ctx.save(); ctx.beginPath(); ctx.roundRect(PX, PY, PWd, PHt, 26); ctx.clip();
    ctx.fillStyle = linear(ctx, PX, PY, PX + PWd, PY + PHt, [[0, m[4]], [.6, m[2]], [1, m[1]]]); ctx.fillRect(PX, PY, PWd, PHt);
    brush(PX, PY, PX + PWd, PY + PHt, 1.3);
    sheen(PX + 250, PY, PY + PHt, 140, night ? .07 : .25);
    ctx.restore();
    chamfer(ctx, PX, PY, PWd, PHt, 26, 9, [m[6], m[4], m[1], m[0]]);
    [[PX + 40, PY + 40], [PX + 40, PY + PHt - 40], [PX + PWd - 40, PY + 40], [PX + PWd - 40, PY + PHt - 40]].forEach(([x, y]) => screw(x, y, 14));

    // The dial: ticks cut into the plate, then a knob with a grip edge.
    const KX = PX + 380, KY = PY + 400, KR = 172;
    for (let i = 0; i <= 40; i++) {
      const a = Math.PI * .75 + i / 40 * Math.PI * 1.5, big = i % 5 === 0, r0 = KR + 26, r1 = KR + (big ? 58 : 42);
      ctx.lineWidth = big ? 3.4 : 1.8;
      ctx.strokeStyle = m[0];
      ctx.beginPath(); ctx.moveTo(KX + Math.cos(a) * r0, KY + Math.sin(a) * r0); ctx.lineTo(KX + Math.cos(a) * r1, KY + Math.sin(a) * r1); ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = rgba('#ffffff', night ? .18 : .5);
      ctx.beginPath(); ctx.moveTo(KX + Math.cos(a) * r0 + 1.2, KY + Math.sin(a) * r0 + 1.6); ctx.lineTo(KX + Math.cos(a) * r1 + 1.2, KY + Math.sin(a) * r1 + 1.6); ctx.stroke();
    }
    shadow(30, 12, 20, night ? .8 : .45);
    ctx.beginPath();
    for (let i = 0; i <= 120; i++) { const a = i / 120 * TAU, rr = KR + (i % 2 ? -3 : 2); ctx.lineTo(KX + Math.cos(a) * rr, KY + Math.sin(a) * rr); }
    ctx.closePath(); ctx.fillStyle = m[1]; ctx.fill();
    noShadow();
    // The grip edge: fine flutes around the rim.
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * TAU, lit = (Math.cos(a + 2.4) + 1) / 2;
      ctx.strokeStyle = m[clamp(Math.round(1 + lit * 5), 0, 6)]; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(KX + Math.cos(a) * (KR - 16), KY + Math.sin(a) * (KR - 16)); ctx.lineTo(KX + Math.cos(a) * (KR + 1), KY + Math.sin(a) * (KR + 1)); ctx.stroke();
    }
    // The turned face with a chamfer and a dimple.
    const face = ctx.createConicGradient(-.75, KX, KY);
    [[0, m[6]], [.08, m[4]], [.22, m[1]], [.38, m[3]], [.5, m[5]], [.6, m[3]], [.74, m[1]], [.9, m[4]], [1, m[6]]].forEach(([o, c]) => face.addColorStop(o, c));
    ctx.fillStyle = face; ctx.beginPath(); circle(ctx, KX, KY, KR - 18); ctx.fill();
    ctx.lineWidth = .6;
    for (let rr = 20; rr < KR - 20; rr += 2) { ctx.strokeStyle = rgba(rr % 4 ? '#ffffff' : '#000000', .05); ctx.beginPath(); circle(ctx, KX, KY, rr); ctx.stroke(); }
    ctx.lineWidth = 5; ctx.strokeStyle = linear(ctx, KX - KR, KY - KR, KX + KR, KY + KR, [[0, m[6]], [.5, m[3]], [1, m[0]]]);
    ctx.beginPath(); circle(ctx, KX, KY, KR - 20); ctx.stroke();
    ctx.fillStyle = radial(ctx, KX + 6, KY + 8, 0, 40, [[0, m[0]], [1, rgba(m[2], 0)]]); ctx.beginPath(); circle(ctx, KX, KY, 40); ctx.fill();
    // The indicator: a cyan line and a small lit dot on the knob.
    const ia = Math.PI * .75 + .62 * Math.PI * 1.5;
    ctx.strokeStyle = cyan; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(KX + Math.cos(ia) * 70, KY + Math.sin(ia) * 70); ctx.lineTo(KX + Math.cos(ia) * (KR - 34), KY + Math.sin(ia) * (KR - 34)); ctx.stroke();
    ctx.lineCap = 'butt';

    // A row of 3 small status lights on the plate.
    const lights = [[PX + 220, PY + 790, true], [PX + 290, PY + 790, false], [PX + 360, PY + 790, false]];
    lights.forEach(([x, y, on]) => {
      ctx.fillStyle = m[0]; ctx.beginPath(); circle(ctx, x, y, 11); ctx.fill();
      ctx.fillStyle = on ? radial(ctx, x - 2, y - 2, 0, 8, [[0, '#ffffff'], [.35, cyanHi], [1, cyan]]) : radial(ctx, x - 2, y - 2, 0, 8, [[0, m[3]], [1, m[0]]]);
      ctx.beginPath(); circle(ctx, x, y, 7.5); ctx.fill();
    });

    // ----- the milled pocket at the lower left with the readout -----
    const QX = 110, QY = 690, QW = 820, QH = 290;
    ctx.save(); ctx.beginPath(); ctx.roundRect(QX, QY, QW, QH, 30); ctx.clip();
    ctx.fillStyle = linear(ctx, QX, QY, QX, QY + QH, [[0, m[1]], [1, m[2]]]); ctx.fillRect(QX, QY, QW, QH);
    // Fly cutter marks: wide arcs side by side.
    ctx.lineWidth = .8;
    for (let x = QX - 400; x < QX + QW + 200; x += 4.5) {
      ctx.strokeStyle = rgba(pr() < .5 ? '#ffffff' : '#000000', .025 + pr() * .03);
      ctx.beginPath(); ctx.arc(x, QY + QH / 2, 380, -.75, .75); ctx.stroke();
    }
    // The walls: shade at the top and left, light at the bottom and right.
    ctx.lineWidth = 26; ctx.strokeStyle = rgba('#000000', night ? .55 : .3);
    ctx.shadowColor = rgba('#000000', night ? .8 : .45); ctx.shadowBlur = 18 * S; ctx.shadowOffsetX = 8 * S; ctx.shadowOffsetY = 12 * S;
    ctx.beginPath(); ctx.roundRect(QX - 13, QY - 13, QW + 26, QH + 26, 40); ctx.stroke();
    noShadow();
    ctx.restore();
    chamfer(ctx, QX - 7, QY - 7, QW + 14, QH + 14, 36, 7, [m[0], m[1], m[4], m[6]]);
    [[QX + 52, QY + 58], [QX + 52, QY + QH - 58]].forEach(([x, y]) => screw(x, y, 15));

    // The readout window: a dark glass with a bar graph.
    const RX = QX + 130, RY = QY + 70, RW = 600, RH = 150;
    shadow(4, -2, -3, .5);
    ctx.fillStyle = night ? P.darker_background : mixHex(P.foreground, '#000000', .55);
    ctx.beginPath(); ctx.roundRect(RX, RY, RW, RH, 10); ctx.fill();
    noShadow();
    chamfer(ctx, RX - 5, RY - 5, RW + 10, RH + 10, 14, 5, [m[0], m[1], m[4], m[5]]);
    const bars = 24, bw = (RW - 60) / bars, seg = 9, sh = (RH - 40) / seg, nl = makeNoise(seedOf(r));
    const lit = [];
    for (let i = 0; i < bars; i++) {
      const v = clamp(.55 + nl(i * .23, 1.7) * .9 + Math.sin(i * .5) * .12, .12, 1), n = Math.round(v * seg);
      for (let k = 0; k < seg; k++) {
        const x = RX + 30 + i * bw + 2, y = RY + RH - 20 - (k + 1) * sh + 2, on = k < n;
        ctx.fillStyle = on ? (k === n - 1 ? cyanHi : cyan) : rgba(cyan, night ? .08 : .14);
        ctx.fillRect(x, y, bw - 5, sh - 4);
        if (on) lit.push([x, y, bw - 5, sh - 4]);
      }
    }
    // The glass catches a soft reflection.
    ctx.fillStyle = linear(ctx, RX, RY, RX + RW * .4, RY + RH, [[0, rgba('#ffffff', night ? .07 : .12)], [.5, rgba('#ffffff', 0)]]);
    ctx.fillRect(RX, RY, RW, RH);

    // The cyan light glows in the dark.
    bloom(ctx, x => {
      x.fillStyle = cyan;
      lit.forEach(([a, b, c, d]) => x.fillRect(a, b, c, d));
      x.beginPath(); circle(x, lights[0][0], lights[0][1], 8); x.fill();
      x.strokeStyle = cyan; x.lineWidth = 5;
      x.beginPath(); x.moveTo(KX + Math.cos(ia) * 70, KY + Math.sin(ia) * 70); x.lineTo(KX + Math.cos(ia) * (KR - 34), KY + Math.sin(ia) * (KR - 34)); x.stroke();
    }, [46, 10], night ? [.55, .6] : [.18, .2]);

    // A broad light from the upper left.
    ctx.fillStyle = radial(ctx, 300, -200, 100, 2200, [[0, rgba('#ffffff', night ? .06 : .14)], [.5, rgba('#ffffff', 0)], [1, rgba('#000000', night ? .35 : .08)]]);
    ctx.fillRect(0, 0, W, H);

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .045 : .035);
  });

  // ---------- metal/carbon-fiber ----------

  // A 2x2 twill of carbon tows under a glossy clear coat. 2 panels meet
  // along a curved joint with a thin lime pinstripe.
  scene('metal', 'carbon-fiber', (ctx, P, r) => {
    const night = P.night;
    const M = L => withL(P.muted, L);
    const ramp = night ? [M(.08), M(.14), M(.22), M(.32), M(.46), M(.62)] : [M(.64), M(.72), M(.79), M(.85), M(.91), M(.96)];
    const rampC = ramp.map(C);
    const lime = night ? P.accent : adjust(withL(P.accent, .62), { C: .1 }), limeHi = night ? P.bright_blue : adjust(withL(P.accent, .78), { C: .08 });
    const n1 = makeNoise(seedOf(r));
    const hex = c => '#' + c.map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
    const tone = t => { t = clamp(t, 0, 1) * 5; const i = Math.min(4, Math.floor(t)); return mixC(rampC[i], rampC[i + 1], t - i); };

    // The joint between the 2 panels: a gentle curve from left to right.
    const joint = x => 840 - x * .1 - Math.sin(x / W * Math.PI) * 70;

    // Brightness of the tows. th is the angle of the light across the fibers,
    // so horizontal and vertical tows trade places across the frame.
    const light = (x, y, horiz) => {
      const th = Math.atan2(y - 260, x - 520) * 1.15 + n1(x / 900, y / 900) * .5;
      const a = horiz ? Math.abs(Math.cos(th)) : Math.abs(Math.sin(th));
      const glow = Math.exp(-(((x - 600) / 900) ** 2) - (((y - 300) / 520) ** 2));
      return clamp((night ? .08 : .2) + a ** 2.2 * (night ? .38 + glow * .55 : .3 + glow * .35) + glow * .08, 0, 1);
    };

    ctx.fillStyle = ramp[0]; ctx.fillRect(0, 0, W, H);

    // The weave of one panel, clipped to its side of the joint.
    const weave = (cell, ox, oy, upper) => {
      ctx.save();
      ctx.beginPath();
      if (upper) { ctx.moveTo(0, -10); ctx.lineTo(W, -10); } else { ctx.moveTo(0, H + 10); ctx.lineTo(W, H + 10); }
      for (let x = W; x >= 0; x -= 20) ctx.lineTo(x, joint(x) + (upper ? -3 : 3));
      ctx.closePath(); ctx.clip();
      const gap = cell * .02, cols = Math.ceil(W / cell) + 3, rows = Math.ceil(H / cell) + 3;
      const fr = rng(seedOf(r));
      for (let j = -2; j < rows; j++) for (let i = -2; i < cols; i++) {
        const k = ((i + j) % 4 + 4) % 4;
        let x, y, w, h, horiz;
        if (k === 0) { horiz = true; x = ox + i * cell; y = oy + j * cell; w = cell * 2; h = cell; }
        else if (k === 2) { horiz = false; x = ox + i * cell; y = oy + j * cell; w = cell; h = cell * 2; }
        else continue;
        const cx = x + w / 2, cy = y + h / 2, b = light(cx, cy, horiz);
        const lo = hex(tone(b * .7)), mid = hex(tone(b)), hi = hex(tone(b * 1.18 + .03));
        // A tow is a flat bundle: a soft round shade across it.
        ctx.fillStyle = horiz ? linear(ctx, 0, y + gap, 0, y + h - gap, [[0, lo], [.3, mid], [.5, hi], [.7, mid], [1, lo]])
          : linear(ctx, x + gap, 0, x + w - gap, 0, [[0, lo], [.3, mid], [.5, hi], [.7, mid], [1, lo]]);
        ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
        // It dips at both ends, where it dives under the crossing tows.
        const e = night ? .5 : .16;
        ctx.fillStyle = horiz ? linear(ctx, x, 0, x + w, 0, [[0, rgba('#000000', e)], [.1, rgba('#000000', 0)], [.9, rgba('#000000', 0)], [1, rgba('#000000', e)]])
          : linear(ctx, 0, y, 0, y + h, [[0, rgba('#000000', e)], [.1, rgba('#000000', 0)], [.9, rgba('#000000', 0)], [1, rgba('#000000', e)]]);
        ctx.fillRect(x + gap, y + gap, w - gap * 2, h - gap * 2);
        // Fine filaments along the tow.
        ctx.lineWidth = .45;
        for (const [col, a] of [['#ffffff', night ? .1 : .3], ['#000000', night ? .22 : .1]]) {
          ctx.strokeStyle = rgba(col, a * (.5 + b));
          ctx.beginPath();
          for (let q = 0; q < 9; q++) {
            const t = gap + (q + fr()) / 9 * (cell - gap * 2), s0 = fr() * cell * .3, s1 = (horiz ? w : h) - fr() * cell * .3;
            if (horiz) { ctx.moveTo(x + s0, y + t); ctx.lineTo(x + s1, y + t); } else { ctx.moveTo(x + t, y + s0); ctx.lineTo(x + t, y + s1); }
          }
          ctx.stroke();
        }
      }
      ctx.restore();
    };
    weave(30, -6, -10, true);
    weave(30, 9, 4, false);

    // The clear coat: a soft box mirrored as a broad band, with a sharp core.
    ctx.save();
    ctx.translate(980, 300); ctx.rotate(-.32);
    ctx.fillStyle = linear(ctx, 0, -230, 0, 230, [[0, rgba('#ffffff', 0)], [.3, rgba('#ffffff', night ? .05 : .12)], [.46, rgba('#ffffff', night ? .1 : .22)], [.47, rgba('#ffffff', night ? .17 : .32)], [.6, rgba('#ffffff', night ? .14 : .26)], [.61, rgba('#ffffff', night ? .07 : .16)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); ctx.ellipse(0, 0, 1500, 230, 0, 0, TAU); ctx.fill();
    ctx.restore();
    // A second, thinner reflection low on the right.
    ctx.save();
    ctx.translate(1500, 980); ctx.rotate(-.18);
    ctx.fillStyle = linear(ctx, 0, -40, 0, 40, [[0, rgba('#ffffff', 0)], [.5, rgba('#ffffff', night ? .07 : .16)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); ctx.ellipse(0, 0, 700, 40, 0, 0, TAU); ctx.fill();
    ctx.restore();

    // The joint: a dark gap, a lit lip, and the lime pinstripe just below.
    const curve = (off, lw, style) => {
      ctx.strokeStyle = style; ctx.lineWidth = lw;
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 12) ctx.lineTo(x, joint(x) + off);
      ctx.stroke();
    };
    curve(0, 7, night ? ramp[0] : M(.45));
    curve(-3.5, 1.2, rgba('#ffffff', night ? .25 : .7));
    curve(4, 2, rgba('#000000', night ? .5 : .25));
    // The pinstripe sits in a smooth band of clear coat.
    curve(17, 20, night ? ramp[0] : M(.86));
    curve(17, night ? 4 : 7, lime);
    curve(night ? 16 : 15.2, 1.2, limeHi);
    bloom(ctx, x => {
      x.strokeStyle = lime; x.lineWidth = night ? 4 : 7;
      x.beginPath(); for (let px = -10; px <= W + 10; px += 12) x.lineTo(px, joint(px) + 17); x.stroke();
    }, [30, 8], night ? [.6, .7] : [.2, .25]);

    // Light falls off toward the lower right.
    ctx.fillStyle = radial(ctx, 600, 260, 200, 1900, [[0, rgba('#000000', 0)], [1, rgba(night ? '#000000' : P.darker_background, night ? .55 : .35)]]);
    ctx.fillRect(0, 0, W, H);

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .045 : .035);
  });

  // ---------- texture/driftwood ----------

  // A rounded pebble or glass shape: n points around x and y with a varied radius.
  function blobPts(r, x, y, rx, ry, rot, n = 9, jag = .22) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + (r() - .5) * .3, k = 1 + (r() - .5) * jag * 2;
      const px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
      pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
    return pts;
  }

  // A frosted piece of sea glass with a shadow, a colored caustic and glints.
  function seaGlass(ctx, r, x, y, size, col, night) {
    const pts = blobPts(r, x, y, size, size * (.6 + r() * .25), r() * TAU, 8, .18);
    const path = () => { ctx.beginPath(); smoothPath(ctx, pts, true); };
    ctx.save();
    ctx.shadowColor = rgba('#000000', night ? .55 : .3); ctx.shadowBlur = size * .35 * S; ctx.shadowOffsetX = size * .14 * S; ctx.shadowOffsetY = size * .2 * S;
    path(); ctx.fillStyle = withL(col, night ? .42 : .62); ctx.fill();
    ctx.restore();
    // Light through the glass pools on the ground beside its shadow.
    ctx.save(); ctx.globalCompositeOperation = night ? 'lighter' : 'screen';
    ctx.fillStyle = radial(ctx, x + size * .55, y + size * .7, 0, size * .9, [[0, rgba(withL(col, .8), night ? .25 : .45)], [1, rgba(col, 0)]]);
    ctx.beginPath(); ellipse(ctx, x + size * .55, y + size * .7, size * .9, size * .55, .3); ctx.fill();
    ctx.restore();
    ctx.save(); path(); ctx.clip();
    ctx.fillStyle = radial(ctx, x - size * .2, y - size * .25, size * .1, size * 1.2, [[0, mixHex(withL(col, night ? .78 : .9), '#ffffff', .25)], [.55, withL(col, night ? .62 : .78)], [1, withL(col, night ? .38 : .55)]]);
    ctx.fillRect(x - size * 2, y - size * 2, size * 4, size * 4);
    ctx.lineWidth = size * .22; ctx.strokeStyle = rgba(withL(col, night ? .35 : .5), .45); path(); ctx.stroke();
    // A frosted skin: fine speckles of light and shade.
    for (let q = 0; q < size * 10; q++) {
      const a = r() * TAU, d = Math.sqrt(r()) * size;
      ctx.fillStyle = rgba(r() < .6 ? '#ffffff' : '#000000', .03 + r() * .04);
      ctx.beginPath(); circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d * .8, .3 + r() * .5); ctx.fill();
    }
    // Light scatters inside the frosted glass.
    ctx.fillStyle = radial(ctx, x, y, 0, size * .8, [[0, rgba('#ffffff', night ? .16 : .28)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(x - size, y - size, size * 2, size * 2);
    ctx.translate(size * .05, size * .07); ctx.lineWidth = 2; ctx.strokeStyle = rgba('#ffffff', night ? .25 : .45); path(); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = radial(ctx, x - size * .3, y - size * .32, 0, size * .5, [[0, rgba('#ffffff', night ? .32 : .5)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); ellipse(ctx, x - size * .3, y - size * .32, size * .5, size * .3, -.5); ctx.fill();
  }

  // Bleached driftwood in close-up: grain lines that bend around knots,
  // weathered cracks, a corner of sand, and sea glass.
  scene('texture', 'driftwood', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r)), nC = makeNoise(seedOf(r));
    const knots = [[360, 540, 46, 250], [1440, 290, 62, 330], [1700, 830, 34, 190]].map(([x, y, h, w]) => ({ x: x + (r() - .5) * 60, y: y + (r() - .5) * 40, h, w }));
    // The grain coordinate: grain lines are its level lines.
    const g = (x, y) => {
      let v = y + x * .12 - 22 * fbm(nA, x / 760, y / 520, 3) - 7 * nB(x / 170, y / 110);
      for (const k of knots) { const hy = k.h / .82; v -= k.h * Math.exp(-(((x - k.x) / k.w) ** 2)) * Math.tanh((y - k.y) / hy); }
      return v;
    };
    // The plank edge at the lower left, with sand beyond it.
    const edge = [[-20, 770], [260, 836], [560, 948], [760, 1100]];
    const inSand = (x, y) => {
      const t = clamp(x / 760, 0, 1), ey = lerp(770, 1100, t * t * .55 + t * .45);
      return y > ey + nC(x / 60, 3) * 10;
    };

    const woodLo = C(night ? mixHex(P.muted, P.background, .6) : mixHex(P.muted, P.background, .5));
    const woodHi = C(night ? mixHex(P.muted, P.foreground, .12) : mixHex(P.background, '#ffffff', .4));
    const woodWarm = C(night ? mixHex(P.muted, P.yellow, .3) : mixHex(P.background, P.yellow, .3));
    const sand = C(night ? mixHex(P.background, P.muted, .45) : mixHex(P.background, P.yellow, .2));

    // The base: bleached patches, latewood bands and grain streaks.
    const base = bake(960, 540, (i, j, o) => {
      const x = i * 2 + 1, y = j * 2 + 1;
      if (inSand(x, y)) {
        const sp = (hash2(i, j, 9) - .5) * .25 + nC(x / 9, y / 9) * .1;
        const c = mixC(sand, sp > 0 ? [255, 255, 255] : [0, 0, 0], Math.abs(sp) * (night ? .5 : .4));
        o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; return;
      }
      const gv = g(x, y), gv2 = g(x, y + 2), bleach = ss(-.4, .5, fbm(nC, x / 520, y / 380, 3));
      // Corrugation: soft wood wore away between the hard grain.
      const hgt = v => Math.sin(v / 8.5) * .5 + Math.sin(v / 17 + 1.3) * .4 + nB(x / 380, v / 14) * .6;
      const slope = (hgt(gv2) - hgt(gv)) / Math.max(.3, gv2 - gv);
      const band = hgt(gv) * .3 + .5;
      const streak = nA(x / 90, gv / 2.2) * .5 + .5;
      let c = mixC(woodLo, woodHi, clamp(.32 + bleach * .45 + band * .14 + streak * .1, 0, 1));
      c = mixC(c, woodWarm, ss(.3, -.4, fbm(nB, x / 400 + 7, y / 300, 3)) * .5);
      c = slope > 0 ? mixC(c, [0, 0, 0], clamp(slope * (night ? 1.3 : .9), 0, .4)) : mixC(c, [255, 255, 255], clamp(-slope * (night ? .5 : .9), 0, .35));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    put(ctx, base);

    // The plank shape, for clipping the grain.
    const plank = c => { c.moveTo(-20, -20); c.lineTo(W + 20, -20); c.lineTo(W + 20, H + 20); c.lineTo(780, H + 20); for (let x = 760; x >= -20; x -= 8) { const t = clamp(x / 760, 0, 1); c.lineTo(x, lerp(770, 1100, t * t * .55 + t * .45) + nC(x / 60, 3) * 10); } c.closePath(); };

    // Finds the y near y0 where the grain coordinate equals c.
    const solve = (x, y0, c) => {
      let y = y0;
      for (let q = 0; q < 4; q++) { const f = g(x, y) - c, d = (g(x, y + .5) - g(x, y - .5)); y -= f / Math.max(.15, d); }
      return y;
    };
    const lines = [];
    const lr = rng(seedOf(r));
    for (let c = -320; c < H + 80;) {
      const pts = [];
      let y = c - (-20) * .12;
      for (let x = -20; x <= W + 20; x += 6) { y = solve(x, y, c); pts.push([x, y]); }
      lines.push({ c, pts, w: lr() });
      c += lr() < .14 ? 12 + lr() * 14 : 3 + lr() * 6;
    }

    ctx.save(); ctx.beginPath(); plank(ctx); ctx.clip();
    // Each grain line: a dark groove with a lit lower lip, broken where it is worn.
    for (const L of lines) {
      const strength = .35 + L.w * .65;
      const run = (off, lw, style) => {
        ctx.strokeStyle = style; ctx.lineWidth = lw;
        ctx.beginPath();
        let on = false;
        for (let k = 0; k < L.pts.length; k++) {
          const [x, y] = L.pts[k];
          const vis = nB(L.c * .05, x / 140) > -.35;
          if (vis && y > -10 && y < H + 10) { if (!on) ctx.moveTo(x, y + off); else ctx.lineTo(x, y + off); on = true; } else on = false;
        }
        ctx.stroke();
      };
      run(-.5, .8 + L.w * 1.4, rgba(night ? '#000000' : withL(P.brown, .32), (night ? .32 : .24) * strength));
      run(1.1, .8, rgba(night ? P.foreground : '#ffffff', (night ? .12 : .4) * strength));
    }
    // Fine fibers along the grain.
    ctx.lineWidth = .6;
    for (let q = 0; q < 3200; q++) {
      const L = lines[Math.floor(lr() * lines.length)], k = Math.floor(lr() * (L.pts.length - 4));
      const [x0, y0] = L.pts[k], [x1, y1] = L.pts[k + 2 + Math.floor(lr() * 2)], d = (lr() - .5) * 3;
      ctx.strokeStyle = lr() < .5 ? rgba('#ffffff', night ? .06 : .25) : rgba('#000000', night ? .12 : .08);
      ctx.beginPath(); ctx.moveTo(x0, y0 + d); ctx.lineTo(x1, y1 + d); ctx.stroke();
    }
    // Knots: an eye of dark rings where the grain parts, with a split core.
    for (const k of knots) {
      const rx = k.w * .3, ry = k.h * .78, dark = night ? '#000000' : withL(P.brown, .3);
      ctx.fillStyle = radial(ctx, k.x, k.y, 0, rx, [[0, rgba(dark, night ? .55 : .35)], [.7, rgba(dark, night ? .25 : .14)], [1, rgba(dark, 0)]]);
      ctx.beginPath(); ellipse(ctx, k.x, k.y, rx, ry); ctx.fill();
      for (let q = 7; q >= 1; q--) {
        ctx.strokeStyle = rgba(dark, .1 + (7 - q) * .055); ctx.lineWidth = 1.2 + (7 - q) * .25;
        ctx.beginPath(); ellipse(ctx, k.x + (7 - q) * .8, k.y, rx * q / 7, ry * q / 7, 0); ctx.stroke();
        ctx.strokeStyle = rgba(night ? P.foreground : '#ffffff', night ? .06 : .25); ctx.lineWidth = .8;
        ctx.beginPath(); ellipse(ctx, k.x + (7 - q) * .8, k.y + 1.6, rx * q / 7, ry * q / 7, 0); ctx.stroke();
      }
      ctx.fillStyle = rgba(night ? '#000000' : withL(P.brown, .2), .8);
      ctx.beginPath(); poly(ctx, [[k.x - rx * .55, k.y + 1], [k.x, k.y - 3], [k.x + rx * .5, k.y], [k.x, k.y + 3]]); ctx.fill();
    }
    // Long cracks along the grain.
    for (const [li, f0, f1, wmax] of [[.22, .05, .55, 12], [.48, .45, .95, 7], [.7, .1, .4, 5], [.86, .5, .9, 10]]) {
      const L = lines[Math.floor(li * lines.length)], a = Math.floor(f0 * L.pts.length), b = Math.floor(f1 * L.pts.length);
      const top = [], bot = [];
      for (let k = a; k <= b; k++) {
        const t = (k - a) / (b - a), w = wmax * Math.sin(t * Math.PI) ** .7 * (.7 + .3 * nC(k * .1, L.c));
        top.push([L.pts[k][0], L.pts[k][1] - w / 2]); bot.push([L.pts[k][0], L.pts[k][1] + w / 2]);
      }
      ctx.fillStyle = night ? P.darker_background : withL(P.brown, .28);
      ctx.beginPath(); poly(ctx, [...top, ...bot.reverse()]); ctx.fill();
      ctx.fillStyle = rgba(night ? '#000000' : withL(P.brown, .4), night ? .35 : .18);
      ctx.beginPath(); poly(ctx, [...top.map(([x, y]) => [x, y - 3]), ...top.slice().reverse()]); ctx.fill();
      ctx.strokeStyle = rgba(night ? P.foreground : '#ffffff', night ? .2 : .6); ctx.lineWidth = 1.1;
      ctx.beginPath(); bot.reverse().forEach(([x, y], i) => i ? ctx.lineTo(x, y + 1) : ctx.moveTo(x, y + 1)); ctx.stroke();
    }
    ctx.restore();

    // The rounded plank edge and its shadow on the sand.
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); plank(ctx); ctx.clip('evenodd');
    ctx.shadowColor = rgba('#000000', night ? .6 : .32); ctx.shadowBlur = 26 * S; ctx.shadowOffsetX = 14 * S; ctx.shadowOffsetY = 20 * S;
    ctx.beginPath(); plank(ctx); ctx.fillStyle = '#000000'; ctx.fill();
    ctx.restore();
    ctx.save(); ctx.beginPath(); plank(ctx); ctx.clip();
    ctx.lineJoin = 'round';
    for (let q = 0; q < 6; q++) {
      ctx.lineWidth = 60 - q * 9; ctx.strokeStyle = rgba(night ? '#000000' : withL(P.brown, .35), (night ? .1 : .06));
      ctx.beginPath(); plank(ctx); ctx.stroke();
    }
    ctx.lineWidth = 10; ctx.strokeStyle = rgba(night ? P.foreground : '#ffffff', night ? .1 : .4);
    ctx.translate(-9, -12); ctx.beginPath(); plank(ctx); ctx.stroke();
    ctx.restore();

    // Sea glass on the wood and in the sand.
    const glass = night ? [P.green, P.cyan, P.blue, P.bright_cyan, P.yellow] : [P.green, P.cyan, P.blue, P.bright_cyan, P.yellow];
    const gr = rng(seedOf(r));
    [[150, 965, 46, 0], [360, 1010, 34, 1], [1560, 610, 40, 2], [1690, 668, 28, 3], [700, 170, 34, 4], [1830, 1000, 36, 1]].forEach(([x, y, sz, ci]) => seaGlass(ctx, gr, x, y, sz, glass[ci], night));
    if (night) bloom(ctx, x => {
      [[150, 965, 46, 0], [360, 1010, 34, 1], [1560, 610, 40, 2], [1690, 668, 28, 3], [700, 170, 34, 4], [1830, 1000, 36, 1]].forEach(([px, py, sz, ci]) => {
        x.fillStyle = rgba(glass[ci], .5); x.beginPath(); circle(x, px, py, sz * .7); x.fill();
      });
    }, [40, 10], [.35, .25]);

    // Moonlight or sunlight from the upper left.
    ctx.fillStyle = radial(ctx, 380, 120, 100, 2000, night
      ? [[0, rgba(P.bright_cyan, .1)], [.45, rgba('#000000', 0)], [1, rgba('#000000', .5)]]
      : [[0, rgba('#ffffff', .22)], [.5, rgba('#ffffff', 0)], [1, rgba(P.darker_background, .3)]]);
    ctx.fillRect(0, 0, W, H);

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .04);
  });

  // ---------- texture/lichen ----------

  // Lichen on grey stone: orange and sage rosettes with lobed rims, and
  // granular yellow crust, gathered toward the edges of the frame.
  scene('texture', 'lichen', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r)), nC = makeNoise(seedOf(r));
    const stoneLo = C(night ? mixHex(P.muted, P.darker_background, .55) : mixHex(P.muted, P.background, .35));
    const stoneHi = C(night ? mixHex(P.muted, P.background, .15) : mixHex(P.background, '#ffffff', .3));
    const grainD = C(night ? P.darker_background : mixHex(P.muted, P.foreground, .45));
    const grainL = night ? C(mixHex(P.muted, P.foreground, .5)) : [255, 255, 255];

    // The stone: blotches, mineral grains and a soft relief.
    const BW = 1280, BH = 720, hf = new Float32Array(BW * BH), col = new Float32Array(BW * BH * 3);
    for (let j = 0, k = 0; j < BH; j++) for (let i = 0; i < BW; i++, k++) {
      const x = i * 1.5, y = j * 1.5;
      hf[k] = fbm(nA, x / 260, y / 260, 4) * 9 + fbm(nB, x / 40, y / 40, 3) * 2.2;
      let c = mixC(stoneLo, stoneHi, clamp(.5 + fbm(nC, x / 420, y / 340, 3) * .8, 0, 1));
      const gr = nB(x / 3.2 + 50, y / 3.2), gq = nC(x / 4.5, y / 4.5 + 30);
      if (gr > .42) c = mixC(c, grainD, clamp((gr - .42) * 3, 0, .7));
      if (gq > .45) c = mixC(c, grainL, clamp((gq - .45) * 2.4, 0, night ? .35 : .55));
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
    }
    const stone = bake(BW, BH, (i, j, o) => {
      const k = j * BW + i, dx = hf[j * BW + Math.min(BW - 1, i + 1)] - hf[k], dy = hf[Math.min(BH - 1, j + 1) * BW + i] - hf[k];
      const lit = clamp(1 - (dx + dy) * (night ? .3 : .22), .6, 1.4);
      for (let q = 0; q < 3; q++) o[q] = lit > 1 ? col[k * 3 + q] + (255 - col[k * 3 + q]) * (lit - 1) * .6 : col[k * 3 + q] * lit;
    });
    put(ctx, stone);
    const ln = loopNoise(seedOf(r), 48);
    wash(ctx, tile(ctx, 220, (u, v, o) => { const q = clamp(128 + fbm(ln, u * 48, v * 48, 2) * 260, 0, 255); o[0] = o[1] = o[2] = q; }), night ? .4 : .3, 'overlay');

    // A fissure in the stone, wider in places.
    const fr = rng(seedOf(r));
    {
      const top = [], bot = [];
      for (let t = 0; t <= 1.0001; t += .01) {
        const x = lerp(-20, W + 20, t), y = lerp(660, 380, t) + fbm(nA, t * 5, 7.7, 3) * 90, w = 1.5 + Math.max(0, nB(t * 9, 3.3)) * 7;
        top.push([x, y - w / 2]); bot.push([x, y + w / 2]);
      }
      ctx.fillStyle = night ? P.darker_background : mixHex(P.muted, P.foreground, .35);
      ctx.beginPath(); poly(ctx, [...top, ...bot.slice().reverse()]); ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', night ? .1 : .5); ctx.lineWidth = 1.3;
      ctx.beginPath(); bot.forEach(([x, y], i) => i ? ctx.lineTo(x, y + 1) : ctx.moveTo(x, y + 1)); ctx.stroke();
      ctx.strokeStyle = rgba('#000000', night ? .3 : .12); ctx.lineWidth = 4;
      ctx.beginPath(); top.forEach(([x, y], i) => i ? ctx.lineTo(x, y - 2) : ctx.moveTo(x, y - 2)); ctx.stroke();
    }

    // Lichen colors, lifted for the light day stone.
    const L = (hex, n, d) => withL(hex, night ? n : d);
    const ORANGE = { lo: L(P.red, .42, .5), mid: L(P.orange, .6, .68), hi: L(P.orange, .72, .8), apo: L(P.red, .5, .58), apoRim: L(P.orange, .72, .82) };
    const SAGE = { lo: L(P.green, .42, .55), mid: L(P.cyan, .62, .76), hi: L(P.cyan, .74, .86), apo: L(P.green, .38, .48), apoRim: L(P.cyan, .7, .82) };
    const OCHRE = { lo: L(P.accent, .45, .55), mid: L(P.yellow, .66, .76), hi: L(P.yellow, .76, .86), apo: L(P.orange, .5, .6), apoRim: L(P.yellow, .76, .86) };

    // Yellow crust: granules packed so tight that only thin dark cracks show.
    {
      const GW = 480, GH = 270, rect = [-10, -10, W + 10, H + 10];
      const where = (x, y) => Math.max(Math.exp(-(((x - 150) / 300) ** 2) - (((y - 990) / 200) ** 2)), Math.exp(-(((x - 1790) / 240) ** 2) - (((y - 140) / 210) ** 2)), Math.exp(-(((x - 1250) / 220) ** 2) - (((y - 1060) / 120) ** 2)) * .8);
      const fy = (x, y) => fbm(nC, x / 70, y / 70, 4) + where(x, y) * 1.05 - .74;
      const f = field(GW, GH, rect, (x, y, i, j) => (i === 0 || j === 0 || i === GW || j === GH) ? -1 : fy(x, y));
      const lines = contours(f, GW, GH, 0);
      flakes(ctx, lines, GW, GH, rect, night ? mixHex(OCHRE.lo, '#000000', .45) : withL(P.accent, .4), night, {
        lift: .5, shadow: .8, edge: .6,
        inside: () => {
          const gc = [OCHRE.lo, OCHRE.mid, OCHRE.hi];
          for (let y = 0; y < H; y += 5) for (let x = (y / 5 % 2) * 2.5; x < W; x += 5) {
            const px = x + (fr() - .5) * 2.4, py = y + (fr() - .5) * 2.4;
            if (fy(px, py) < -.04) continue;
            ctx.fillStyle = gc[Math.floor(fr() * 3)];
            ctx.beginPath(); ellipse(ctx, px, py, 2 + fr() * 1.3, 1.6 + fr() * 1.2, fr() * 3); ctx.fill();
          }
        },
      });
    }

    // Pale crust in rings, with dark fruiting dots.
    for (let q = 0; q < 16; q++) {
      const side = q % 4, x = [lerp(40, 700, fr()), lerp(1250, 1900, fr()), lerp(40, 600, fr()), lerp(1300, 1900, fr())][side], y = [lerp(40, 420, fr()), lerp(640, 1060, fr()), lerp(700, 1060, fr()), lerp(40, 380, fr())][side];
      const R = 14 + fr() * 34, pts = blobPts(fr, x, y, R, R * (.8 + fr() * .2), fr() * 3, 12, .12);
      const pale = night ? mixHex(P.muted, P.foreground, .45) : mixHex(P.background, '#ffffff', .6);
      ctx.beginPath(); smoothPath(ctx, pts, true);
      ctx.fillStyle = radial(ctx, x, y, 0, R, [[0, rgba(pale, .45)], [.7, rgba(pale, .6)], [1, rgba(pale, .8)]]); ctx.fill();
      ctx.strokeStyle = rgba(night ? '#000000' : mixHex(P.muted, P.foreground, .4), .35); ctx.lineWidth = 2.4; ctx.stroke();
      for (let k = 0; k < R * .35; k++) {
        const a = fr() * TAU, d = Math.sqrt(fr()) * R * .75, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d, ar = 1.4 + fr() * 2.4;
        ctx.fillStyle = rgba('#000000', .3); ctx.beginPath(); circle(ctx, px + .6, py + .8, ar); ctx.fill();
        ctx.fillStyle = pale; ctx.beginPath(); circle(ctx, px, py, ar); ctx.fill();
        ctx.fillStyle = night ? mixHex(P.yellow, P.muted, .5) : withL(P.yellow, .7); ctx.beginPath(); circle(ctx, px, py, ar * .65); ctx.fill();
      }
    }

    // The colonies: each one has an irregular, scalloped rim.
    const cols = [];
    const cluster = (cx, cy, sx, sy, count, rMin, rMax) => {
      for (let q = 0; q < count; q++) {
        const R = lerp(rMin, rMax, fr() ** 1.6), k = fr();
        cols.push({ x: cx + (fr() - .5) * sx, y: cy + (fr() - .5) * sy, R, K: k < .45 ? ORANGE : k < .8 ? SAGE : OCHRE, sage: k >= .45 && k < .8, ox: fr() * 50, oy: fr() * 50, nl: Math.max(7, Math.round(R / 7)), ph: fr() * TAU, el: .75 + fr() * .5, rot: fr() * Math.PI });
      }
    };
    // Small young colonies scattered around each cluster.
    const sprinkle = (cx, cy, sx, sy, count) => {
      for (let q = 0; q < count; q++) {
        const k = fr(), R = 4 + fr() ** 2 * 16;
        cols.push({ x: cx + (fr() - .5) * sx, y: cy + (fr() - .5) * sy, R, K: k < .55 ? ORANGE : k < .8 ? SAGE : OCHRE, sage: k >= .55 && k < .8, ox: fr() * 50, oy: fr() * 50, nl: 6, ph: fr() * TAU, el: .8 + fr() * .4, rot: fr() * Math.PI, small: true });
      }
    };
    cluster(230, 230, 480, 400, 10, 34, 130);
    cluster(1680, 860, 540, 400, 11, 34, 150);
    cluster(1560, 190, 420, 300, 6, 28, 96);
    cluster(330, 880, 520, 300, 6, 28, 104);
    cluster(980, 990, 320, 110, 3, 18, 44);
    cluster(960, 110, 380, 150, 3, 16, 40);
    sprinkle(260, 260, 760, 620, 34);
    sprinkle(1660, 840, 820, 600, 38);
    sprinkle(1560, 190, 640, 420, 18);
    sprinkle(330, 880, 760, 420, 20);
    sprinkle(960, 1000, 600, 160, 10);
    const rim = (c, th) => {
      const e = c.el, a = th - c.rot, sq = Math.sqrt((Math.cos(a) / e) ** 2 + (Math.sin(a) * e) ** 2);
      return c.R / sq * (1 + .32 * fbm(nA, Math.cos(th) * 1.2 + c.ox, Math.sin(th) * 1.2 + c.oy, 2)) * (1 - .09 * (1 - Math.abs(Math.cos(th * c.nl / 2 + c.ph))) ** 1.4);
    };
    const ln2 = loopNoise(seedOf(r), 32);
    const crust = tile(ctx, 160, (u, v, o) => { const q = clamp(128 + fbm(ln2, u * 32, v * 32, 3) * 330, 0, 255); o[0] = o[1] = o[2] = q; });
    // Each colony is drawn whole, so where 2 meet, one laps over the other.
    cols.sort((a, b) => b.R - a.R + (fr() - .5) * 60);
    for (const c of cols) {
      const n = Math.max(48, Math.round(c.R * 2.2)), rims = [];
      for (let k = 0; k < n; k++) { const th = k / n * TAU; rims.push(rim(c, th)); }
      const outline = (dx = 0, dy = 0) => { ctx.beginPath(); rims.forEach((R1, k) => { const th = k / n * TAU, x = c.x + dx + Math.cos(th) * R1, y = c.y + dy + Math.sin(th) * R1; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); };
      const lift = Math.min(1, .35 + c.R / 120), K = c.K;
      outline(2.4 * lift, 3.4 * lift); ctx.fillStyle = rgba('#000000', night ? .5 : .25); ctx.fill();
      outline(4 * lift, 5.4 * lift); ctx.fillStyle = rgba('#000000', night ? .2 : .1); ctx.fill();
      ctx.save(); outline(); ctx.clip();
      const Rm = c.R * 1.15;
      ctx.fillStyle = radial(ctx, c.x, c.y, 0, Rm, [[0, mixHex(K.lo, '#000000', .12)], [.45, K.lo], [.75, K.mid], [1, K.hi]]);
      ctx.fillRect(c.x - Rm * 1.5, c.y - Rm * 1.5, Rm * 3, Rm * 3);
      wash(ctx, crust, night ? .45 : .4, 'overlay', [c.x - Rm * 1.5, c.y - Rm * 1.5, Rm * 3, Rm * 3]);
      ctx.lineWidth = 1.5;
      ctx.save(); ctx.translate(1.2, 1.2); outline(); ctx.strokeStyle = rgba('#ffffff', night ? .14 : .32); ctx.stroke(); ctx.restore();
      ctx.save(); ctx.translate(-1.2, -1.2); outline(); ctx.strokeStyle = rgba('#000000', night ? .3 : .16); ctx.stroke(); ctx.restore();
      ctx.restore();
      if (c.small) continue;
      // Fine radial lines: the lobes are made of many narrow fingers.
      ctx.lineWidth = Math.max(.6, c.R / 110);
      for (let q = 0; q < c.nl * 5; q++) {
        const th = fr() * TAU, R1 = rim(c, th), a0 = .5 + fr() * .3, a1 = .86 + fr() * .1;
        ctx.strokeStyle = fr() < .5 ? rgba('#ffffff', night ? .06 : .18) : rgba(night ? '#000000' : K.lo, night ? .2 : .22);
        ctx.beginPath(); ctx.moveTo(c.x + Math.cos(th) * R1 * a0, c.y + Math.sin(th) * R1 * a0); ctx.lineTo(c.x + Math.cos(th) * R1 * a1, c.y + Math.sin(th) * R1 * a1); ctx.stroke();
      }
      for (let k = 0; k < c.nl; k++) {
        const th = (k * 2 + 1) * Math.PI / c.nl - c.ph * 2 / c.nl, cl = th + Math.PI / c.nl, R1 = rim(c, th), R2 = rim(c, cl);
        ctx.lineCap = 'round';
        ctx.strokeStyle = rgba('#ffffff', night ? .06 : .16); ctx.lineWidth = Math.max(1, c.R / 34);
        ctx.beginPath(); ctx.moveTo(c.x + Math.cos(th) * R1 * .74, c.y + Math.sin(th) * R1 * .74); ctx.lineTo(c.x + Math.cos(th) * R1 * .9, c.y + Math.sin(th) * R1 * .9); ctx.stroke();
        ctx.strokeStyle = rgba(night ? '#000000' : K.lo, .3); ctx.lineWidth = Math.max(.8, c.R / 70);
        ctx.beginPath(); ctx.moveTo(c.x + Math.cos(cl) * R2 * .8, c.y + Math.sin(cl) * R2 * .8); ctx.lineTo(c.x + Math.cos(cl) * R2 * .97, c.y + Math.sin(cl) * R2 * .97); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      // Fruiting discs on the orange and ochre colonies, grainy bits on the sage ones.
      const m = Math.round(c.R * c.R / (c.sage ? 60 : 30));
      for (let q = 0; q < m; q++) {
        const a = fr() * TAU, d = fr() ** .8 * .68, px = c.x + Math.cos(a) * d * rim(c, a), py = c.y + Math.sin(a) * d * rim(c, a);
        if (c.sage) {
          ctx.fillStyle = rgba('#000000', .25); ctx.beginPath(); circle(ctx, px + .6, py + .8, 1.5 + fr()); ctx.fill();
          ctx.fillStyle = fr() < .5 ? K.hi : K.mid; ctx.beginPath(); circle(ctx, px, py, 1 + fr() * 1.4); ctx.fill();
          continue;
        }
        const ar = (1.6 + fr() ** 2 * 4.6) * (1.15 - d * .6);
        ctx.fillStyle = rgba('#000000', .35); ctx.beginPath(); circle(ctx, px + 1, py + 1.4, ar); ctx.fill();
        ctx.fillStyle = K.apoRim; ctx.beginPath(); circle(ctx, px, py, ar); ctx.fill();
        ctx.fillStyle = K.apo; ctx.beginPath(); circle(ctx, px + ar * .1, py + ar * .12, ar * .66); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', night ? .2 : .4); ctx.beginPath(); circle(ctx, px - ar * .38, py - ar * .38, ar * .22); ctx.fill();
      }
    }

    // Light across the stone from the upper left.
    ctx.fillStyle = radial(ctx, 420, 160, 100, 2100, night
      ? [[0, rgba(P.foreground, .06)], [.45, rgba('#000000', 0)], [1, rgba('#000000', .5)]]
      : [[0, rgba('#ffffff', .2)], [.5, rgba('#ffffff', 0)], [1, rgba(P.darker_background, .3)]]);
    ctx.fillRect(0, 0, W, H);

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .04);
  });

  // ---------- texture/pebbles ----------

  // Smooth river pebbles on a warm grey ground: 2 cairns, loose stones in
  // front, and gravel that shrinks toward a misty horizon.
  scene('texture', 'pebbles', (ctx, P, r) => {
    const night = P.night;
    const HZ = 600, nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r));
    const tints = [P.red, P.green, P.yellow, P.blue, P.magenta, P.cyan, P.muted, P.muted, P.muted];
    // A pebble color: a soft tint of a palette color, never too strong.
    const stoneCol = (hex, k) => {
      const L = night ? .46 + k * .16 : .6 + k * .17;
      return adjust(withL(hex, L), { Cx: .55 });
    };

    // ----- the backdrop and the ground -----
    if (night) {
      skyGradient(ctx, [[0, P.darker_background], [.4, P.background], [HZ / H - .02, mixHex(P.lighter_background, P.orange, .12)], [HZ / H, mixHex(P.lighter_background, P.orange, .18)], [1, P.darker_background]]);
      ctx.fillStyle = radial(ctx, 900, HZ, 0, 1100, [[0, rgba(P.orange, .14)], [.5, rgba(P.yellow, .04)], [1, rgba(P.yellow, 0)]]); ctx.fillRect(0, 0, W, H);
    } else {
      skyGradient(ctx, [[0, mixHex(P.background, P.darker_background, .6)], [.42, P.background], [HZ / H, mixHex(P.background, '#ffffff', .55)], [1, mixHex(P.background, P.darker_background, .5)]]);
      ctx.fillStyle = radial(ctx, 620, 360, 0, 900, [[0, rgba('#ffffff', .5)], [1, rgba('#ffffff', 0)]]); ctx.fillRect(0, 0, W, H);
    }
    // The ground in perspective: sand that is finer far away.
    const gLo = C(night ? mixHex(P.background, P.muted, .35) : mixHex(P.background, P.muted, .3));
    const gHi = C(night ? mixHex(P.lighter_background, P.muted, .4) : mixHex(P.background, '#ffffff', .3));
    const GY0 = HZ - 2, ground = bake(1280, Math.round((H - GY0) * 1280 / W), (i, j, o) => {
      const x = (i + .5) * W / 1280, y = GY0 + (j + .5) * W / 1280, Z = 90000 / Math.max(4, y - HZ + 4), X = (x - 960) * Z / 900;
      const fine = ss(900, 300, Z);
      const n = fbm(nA, X / 160, Z / 160, 3) * .5 + fbm(nB, X / 14, Z / 14, 2) * .4 * fine + (hash2(i, j, 4) - .5) * .25 * fine;
      let c = mixC(gLo, gHi, clamp(.45 + n, 0, 1));
      const fog = ss(40, 300, y - HZ);
      c = mixC(night ? C(mixHex(P.lighter_background, P.orange, .14)) : C(mixHex(P.background, '#ffffff', .55)), c, fog);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    put(ctx, ground, 0, GY0, W, H - GY0);

    // ----- a single pebble -----
    const pr = rng(seedOf(r));
    const pebble = (x, y, rx, ry, hex, opts = {}) => {
      const rot = opts.rot || 0, k = opts.k ?? pr();
      const pts = blobPts(pr, x, y, rx, ry, rot, 14, .045);
      const path = () => { ctx.beginPath(); smoothPath(ctx, pts, true); };
      const base = stoneCol(hex, k);
      // Cast shadow on the ground or on the stone below.
      if (!opts.noShadow) {
        ctx.fillStyle = radial(ctx, x + rx * .25, y + ry * .95, 0, rx * 1.15, [[0, rgba('#000000', night ? .55 : .3)], [1, rgba('#000000', 0)]]);
        ctx.beginPath(); ellipse(ctx, x + rx * .25, y + ry * .95, rx * 1.15, Math.max(5, ry * .28)); ctx.fill();
      }
      path(); ctx.fillStyle = base; ctx.fill();
      ctx.save(); path(); ctx.clip();
      // Mottling and fine speckles.
      for (let q = 0; q < rx * ry / 60; q++) {
        const a = pr() * TAU, d = Math.sqrt(pr()), px = x + Math.cos(a) * d * rx, py = y + Math.sin(a) * d * ry;
        ctx.fillStyle = rgba(pr() < .5 ? '#ffffff' : '#000000', .05 + pr() * .1);
        ctx.beginPath(); circle(ctx, px, py, .6 + pr() ** 3 * 2.4); ctx.fill();
      }
      ctx.fillStyle = radial(ctx, x + rx * .3, y - ry * .2, 0, rx * .9, [[0, rgba(withL(hex, night ? .5 : .7), .35)], [1, rgba(hex, 0)]]);
      ctx.fillRect(x - rx, y - ry, rx * 2, ry * 2);
      // A quartz vein across some stones.
      if (opts.vein ?? pr() < .35) {
        const va = rot + (pr() - .5) * 1.6, vo = (pr() - .5) * ry, vw = 2 + pr() * 4;
        ctx.save(); ctx.translate(x, y + vo); ctx.rotate(va);
        ctx.strokeStyle = rgba(night ? P.foreground : '#ffffff', night ? .45 : .75); ctx.lineWidth = vw;
        ctx.beginPath(); ctx.moveTo(-rx * 1.2, 0); ctx.bezierCurveTo(-rx * .4, ry * .25, rx * .3, -ry * .2, rx * 1.2, ry * .1); ctx.stroke();
        ctx.lineWidth = vw * .3;
        ctx.beginPath(); ctx.moveTo(-rx * 1.2, vw * 2); ctx.bezierCurveTo(-rx * .4, ry * .25 + vw * 2, rx * .3, -ry * .2 + vw * 2, rx * 1.2, ry * .1 + vw * 2); ctx.stroke();
        ctx.restore();
      }
      // Form: an elliptical light at the upper left, a core shadow at the lower right.
      ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry / rx);
      ctx.fillStyle = radial(ctx, -rx * .34, -rx * .42, rx * .04, rx * 1.65, [[0, rgba('#ffffff', night ? .3 : .45)], [.32, rgba('#ffffff', .04)], [.62, rgba('#000000', night ? .22 : .12)], [.86, rgba('#000000', night ? .5 : .32)], [1, rgba('#000000', night ? .6 : .42)]]);
      ctx.fillRect(-rx * 1.3, -rx * 1.3, rx * 2.6, rx * 2.6);
      // Light bounced up from the ground along the lower edge.
      ctx.fillStyle = radial(ctx, rx * .1, rx * 1.25, rx * .6, rx * 1.05, [[0, rgba(night ? P.muted : '#ffffff', night ? .16 : .22)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(-rx * 1.3, -rx * 1.3, rx * 2.6, rx * 2.6);
      ctx.restore();
      // A soft satin sheen.
      ctx.fillStyle = radial(ctx, x - rx * .35, y - ry * .5, 0, rx * .35, [[0, rgba('#ffffff', night ? .28 : .5)], [1, rgba('#ffffff', 0)]]);
      ctx.beginPath(); ellipse(ctx, x - rx * .35, y - ry * .5, rx * .35, ry * .2, rot - .15); ctx.fill();
      return pts;
    };

    // ----- gravel that recedes to the horizon -----
    const gravel = [];
    const near = [[380, 930], [1540, 880], [200, 1060], [1300, 1070], [1800, 1000]];
    for (let q = 0; q < 300; q++) {
      let x, y;
      if (q < 200) { const [cx, cy] = near[q % near.length], a = pr() * TAU, d = pr() ** .7 * 300; x = cx + Math.cos(a) * d * 1.4; y = cy + Math.sin(a) * d * .35; }
      else { x = pr() * W; y = lerp(HZ + 8, H + 20, pr() ** 1.4); }
      if (y < HZ + 6) continue;
      const sc = (y - HZ + 10) / (H - HZ);
      gravel.push([x, y, (4 + pr() ** 2 * 20) * sc + 1.5, pr() < .75 ? P.muted : tints[Math.floor(pr() * 6)]]);
    }
    gravel.sort((a, b) => a[1] - b[1]).forEach(([x, y, rad, hex]) => {
      if (Math.abs(x - 960) < 300 && y < 920 && pr() < .75) return;
      pebble(x, y, rad, rad * (.42 + pr() * .22), adjust(hex, { Cx: .6 }), { vein: false, k: .15 + pr() * .6, rot: (pr() - .5) * .5 });
    });
    // Mist over the far ground.
    ctx.fillStyle = linear(ctx, 0, HZ - 30, 0, HZ + 160, [[0, rgba(night ? mixHex(P.lighter_background, P.orange, .16) : mixHex(P.background, '#ffffff', .55), .9)], [1, rgba(P.background, 0)]]);
    ctx.fillRect(0, HZ - 30, W, 190);

    // ----- the cairns, built from the bottom up -----
    const cairn = (x, base, stones) => {
      let cy = base - stones[0][1] / 2;
      stones.forEach(([w, h, hex, dx], i) => {
        const cx = x + dx;
        const pts = pebble(cx, cy, w / 2, h / 2, hex, { rot: (pr() - .5) * .1, noShadow: i > 0, k: .45 + pr() * .4 });
        if (i < stones.length - 1) {
          const [w2, h2] = stones[i + 1], top = cy - h / 2;
          // The stone above rests on this one: a soft contact shadow on its top.
          ctx.save(); ctx.beginPath(); smoothPath(ctx, pts, true); ctx.clip();
          ctx.fillStyle = radial(ctx, cx + 6, top + h * .12, 0, w2 * .52, [[0, rgba('#000000', night ? .6 : .38)], [1, rgba('#000000', 0)]]);
          ctx.beginPath(); ellipse(ctx, cx + 6, top + h * .12, w2 * .52, h * .2); ctx.fill();
          ctx.restore();
          cy = top - h2 / 2 + h2 * .22;
        }
      });
    };
    const pick = () => tints[Math.floor(pr() * tints.length)];
    cairn(380, 940, [[420, 190, pick(), 0], [350, 160, pick(), 14], [290, 140, pick(), -10], [230, 118, pick(), 12], [176, 98, pick(), -5], [128, 80, pick(), 8], [86, 60, pick(), 2]]);
    cairn(1540, 880, [[330, 150, pick(), 0], [260, 124, pick(), -12], [196, 100, pick(), 9], [136, 78, pick(), 0]]);

    // ----- loose stones in front -----
    [[120, 1040, 140, 70], [780, 1060, 110, 50], [1120, 1030, 90, 44], [1260, 1070, 150, 64], [1820, 990, 130, 66], [1000, 960, 60, 28], [640, 960, 54, 26]].forEach(([x, y, rx, ry]) => pebble(x, y, rx, ry, pick(), { rot: (pr() - .5) * .3 }));

    // Warm light from the upper left.
    ctx.fillStyle = radial(ctx, 380, 120, 50, 1900, night
      ? [[0, rgba(P.yellow, .08)], [.4, rgba('#000000', 0)], [1, rgba('#000000', .45)]]
      : [[0, rgba('#ffffff', .18)], [.5, rgba('#ffffff', 0)], [1, rgba(P.darker_background, .25)]]);
    ctx.fillRect(0, 0, W, H);

    vignette(ctx, P, night ? .4 : .1);
    grain(ctx, seedOf(r), night ? .045 : .035);
  });

  // ---------- texture/nacre ----------

  // Mother of pearl: layered swirls with an iridescent sheen. At night it is
  // dark like abalone shell, by day it is pearl white with pastel tints.
  scene('texture', 'nacre', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r)), n4 = makeNoise(seedOf(r));
    // The layer field: long diagonal bands, gently waved, that curl into 2
    // swirls near the corners.
    const swirls = [[330 + r() * 80, 250 + r() * 60, 430, 2.3], [1580 + r() * 80, 830 + r() * 60, 470, -2.5]];
    const phi = (x, y) => {
      for (const [cx, cy, R, k] of swirls) {
        const dx = x - cx, dy = y - cy, a = k * Math.exp(-(dx * dx + dy * dy) / (R * R)), c = Math.cos(a), s2 = Math.sin(a);
        x = cx + dx * c - dy * s2; y = cy + dx * s2 + dy * c;
      }
      return (x * .5 + y * .87) / 95 + fbm(n1, x / 900, y / 900, 3) * 3.4 + fbm(n2, x / 240, y / 240, 2) * .35;
    };
    // Where the nacre shows strongly: the corners and a sweep along the diagonal.
    const mask = (x, y) => {
      const u = x / W, v = y / H;
      const corner = Math.max(Math.exp(-((u / .42) ** 2) - ((v / .55) ** 2)), Math.exp(-(((1 - u) / .45) ** 2) - (((1 - v) / .6) ** 2)));
      const sweep = Math.exp(-(((v - (1 - u) * .9 - .05) / .22) ** 2)) * .55;
      return clamp(Math.max(corner, sweep) + n4(x / 500, y / 500) * .2, 0, 1);
    };
    // The iridescent cycle of pastel colors.
    const hues = night ? [mixHex(P.magenta, P.bright_magenta, .4), mixHex(P.blue, P.bright_blue, .4), mixHex(P.cyan, P.bright_cyan, .4), mixHex(P.green, P.bright_green, .4), mixHex(P.yellow, P.bright_yellow, .5), mixHex(P.red, P.bright_red, .5)]
      : [P.magenta, P.blue, P.cyan, P.green, P.yellow, P.red].map(h => adjust(withL(h, .82), { Cx: .85 }));
    const HC = hues.map(C);
    const iri = t => { t = ((t % 1) + 1) % 1 * HC.length; const i = Math.floor(t); return mixC(HC[i], HC[(i + 1) % HC.length], smooth(t - i)); };
    const navy = C(P.background), deep = C(night ? P.darker_background : mixHex(P.background, '#ffffff', .4));
    const pearl = C(night ? mixHex(P.background, P.blue, .35) : mixHex(P.background, '#ffffff', .65));
    const K = 1;

    const base = bake(960, 540, (i, j, o) => {
      const x = i * 2 + 1, y = j * 2 + 1, f = phi(x, y), m = mask(x, y);
      const band = f * K, fr = band - Math.floor(band);
      // A bright ridge in each band, with layers of varied strength.
      const amp = .35 + .65 * hash2(Math.floor(band), 0, 11);
      const ridge = Math.pow(Math.sin(fr * Math.PI), 2) * amp * (.8 + .2 * Math.sin(f * 1.7));
      const view = n4(x / 1100 + 3, y / 1100) * .6 + (x - y) / 3800;
      const col = iri(f * .07 + view);
      let c;
      // A sweep of stronger sheen, where the light catches the shell.
      const zone = Math.exp(-(((y / H - (1 - x / W) * .95 - .02) / .3) ** 2));
      if (night) {
        c = mixC(navy, mixC(deep, pearl, .5), .5 + n2(x / 300, y / 300) * .3);
        c = mixC(c, col, clamp(ridge * m * (1 + zone * .4) + m * .12, 0, 1));
        c = mixC(c, mixC(col, [255, 255, 255], .55), clamp(Math.pow(ridge, 5) * (m * .5 + zone * .45), 0, 1));
      } else {
        c = mixC(pearl, col, clamp(.32 + ridge * .7 * (.45 + m * .55), 0, 1));
        c = mixC(c, C(withL(P.blue, .74)), clamp((1 - ridge) * .32 * (.35 + m), 0, 1));
        c = mixC(c, [255, 255, 255], clamp(Math.pow(ridge, 5) * (.4 + zone * .3), 0, 1));
      }
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    put(ctx, base);

    // Fine growth lines along the layers, sharp at any size.
    const GW = 640, GH = 360, rect = [0, 0, W, H];
    const f = field(GW, GH, rect, (x, y) => phi(x, y));
    let lo = 1e9, hi = -1e9;
    for (const v of f) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const mk = field(GW / 8, GH / 8, rect, (x, y) => mask(x, y));
    const mAt = (gx, gy) => mk[Math.round(gy / 8) * (GW / 8 + 1) + Math.round(gx / 8)];
    ctx.lineJoin = 'round';
    const per = 4;
    for (let lv = Math.ceil(lo * per) / per, q = Math.ceil(lo * per); lv < hi; lv += 1 / per, q++) {
      const lines = contours(f, GW, GH, lv);
      const strong = ((q % per) + per) % per === 0;
      ctx.lineWidth = strong ? 1.6 : .7;
      for (const l of lines) {
        if (l.length < 4) continue;
        // Split each line by the mask, so the lines fade in the calm middle.
        const a = mAt(l[Math.floor(l.length / 2)][0], l[Math.floor(l.length / 2)][1]);
        const alpha = (strong ? .4 : .22) * (.3 + a * .7);
        ctx.strokeStyle = rgba(night ? P.bright_foreground : '#ffffff', night ? alpha * .8 : alpha * 1.6);
        ctx.beginPath();
        ctx.moveTo(l[0][0] * W / GW, l[0][1] * H / GH);
        for (let k = 1; k < l.length; k++) ctx.lineTo(l[k][0] * W / GW, l[k][1] * H / GH);
        ctx.stroke();
        if (strong) {
          ctx.strokeStyle = rgba(night ? '#000000' : withL(P.blue, .55), (night ? .35 : .18) * (.3 + a * .7));
          ctx.beginPath();
          ctx.moveTo(l[0][0] * W / GW, l[0][1] * H / GH + 2);
          for (let k = 1; k < l.length; k++) ctx.lineTo(l[k][0] * W / GW, l[k][1] * H / GH + 2);
          ctx.stroke();
        }
      }
    }

    // A soft sheen that moves across the shell.
    ctx.save();
    ctx.globalCompositeOperation = night ? 'screen' : 'soft-light';
    ctx.fillStyle = radial(ctx, 420, 260, 0, 900, [[0, rgba(night ? P.bright_blue : '#ffffff', night ? .14 : .5)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = radial(ctx, 1560, 860, 0, 800, [[0, rgba(night ? P.bright_magenta : '#ffffff', night ? .12 : .4)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    vignette(ctx, P, night ? .5 : .1);
    grain(ctx, seedOf(r), night ? .045 : .035);
  });

  // ---------- interior/reading-room ----------

  // A library reading room in one point perspective: long desks with green
  // banker's lamps, walls of books, a gallery with brass rails, and a tall
  // arched window at the far end.
  scene('interior', 'reading-room', (ctx, P, r) => {
    const night = P.night;
    const F = 1000, VX = 960, VY = 420, EYE = 1.6;
    const RW = 6.4, HC = 10, ZN = 1.6, ZF = 36, GX = 5.1, GY = 4.1;
    const pt = (X, Y, Z) => [VX + F * X / Z, VY + F * (EYE - Y) / Z];
    const quad = (pts, fill) => { ctx.beginPath(); poly(ctx, pts.map(p => pt(...p))); ctx.fillStyle = fill; ctx.fill(); };
    const pr = rng(seedOf(r));
    const D = (hex, k) => mixHex(hex, '#000000', k);

    // Palette of the room.
    const wood = night ? mixHex(P.brown, P.background, .45) : adjust(withL(P.orange, .64), { Cx: .55 });
    const woodDark = night ? mixHex(P.brown, P.darker_background, .7) : adjust(withL(P.brown, .48), { Cx: .6 });
    const woodLit = night ? mixHex(P.brown, P.orange, .35) : adjust(withL(P.orange, .78), { Cx: .45 });
    const wall = night ? mixHex(P.background, P.brown, .25) : mixHex(P.background, P.yellow, .08);
    const brass = night ? P.yellow : withL(P.yellow, .66), brassHi = night ? P.bright_yellow : withL(P.yellow, .86);
    const shade = night ? P.accent : withL(P.accent, .5), shadeHi = night ? P.bright_green : withL(P.green, .7);
    const glow = night ? P.bright_yellow : withL(P.yellow, .9);
    const bookTones = [P.red, P.green, P.brown, P.yellow, P.orange, P.magenta, P.cyan, P.accent, P.muted].map(h => night ? mixHex(h, P.background, .5) : adjust(withL(h, .58), { Cx: .65 }));

    // ----- the far wall and its arched window -----
    quad([[-RW, 0, ZF], [RW, 0, ZF], [RW, HC, ZF], [-RW, HC, ZF]], wall);
    {
      const [x0, y0] = pt(-2.2, 8.6, ZF), [x1, y1] = pt(2.2, 1.4, ZF), rw = (x1 - x0) / 2, cxw = (x0 + x1) / 2, ya = y0 + rw;
      const win = c => { c.beginPath(); c.moveTo(x0, y1); c.lineTo(x0, ya); c.arc(cxw, ya, rw, Math.PI, 0); c.lineTo(x1, y1); c.closePath(); };
      ctx.save(); win(ctx); ctx.clip();
      ctx.fillStyle = night ? linear(ctx, 0, y0, 0, y1, [[0, mixHex(P.darker_background, P.cyan, .12)], [1, mixHex(P.background, P.cyan, .3)]])
        : linear(ctx, 0, y0, 0, y1, [[0, mixHex(P.background, P.cyan, .25)], [1, '#ffffff']]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (night) { ctx.fillStyle = radial(ctx, cxw + rw * .4, y0 + rw * .9, 0, rw * .5, [[0, rgba(P.bright_foreground, .6)], [.15, rgba(P.bright_foreground, .25)], [1, rgba(P.bright_foreground, 0)]]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      ctx.strokeStyle = night ? D(wood, .3) : withL(P.brown, .4); ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let k = 1; k < 4; k++) { const x = lerp(x0, x1, k / 4); ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let k = 1; k < 8; k++) { const y = lerp(ya, y1, k / 8); ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
      for (let k = 1; k < 4; k++) { const a = Math.PI + k / 4 * Math.PI; ctx.moveTo(cxw, ya); ctx.lineTo(cxw + Math.cos(a) * rw, ya + Math.sin(a) * rw); }
      ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = night ? D(wood, .2) : withL(P.brown, .45); ctx.lineWidth = 4; win(ctx); ctx.stroke();
    }

    // ----- the walls of books -----
    // The shelves on 1 wall between heights y0 and y1. side is -1 for the left
    // wall and 1 for the right wall.
    const shelves = (side, xw, y0, y1, rows, z0, z1) => {
      const X = side * xw;
      // The back of the bookcase.
      quad([[X, y0, z0], [X, y0, z1], [X, y1, z1], [X, y1, z0]], night ? P.darker_background : D(woodDark, .2));
      const rh = (y1 - y0) / rows;
      for (let k = 0; k < rows; k++) {
        const ya = y0 + k * rh + .04, yb = ya + rh - .1;
        let z = z0 + .05;
        while (z < z1) {
          const t = .035 + pr() * .035, sc = F / z;
          if (t * sc * Math.abs(X) / z < .25) {
            // Too small to draw one by one: a band of mixed spines.
            quad([[X, ya, z], [X, ya, z1], [X, yb * .97, z1], [X, yb * .97, z]], night ? D(mixHex(P.brown, P.red, .3), .3) : mixHex(bookTones[2], bookTones[0], .4));
            break;
          }
          if (pr() < .04) { z += t * 2; continue; }
          const top = ya + (rh - .1) * (.72 + pr() * .26), tone = bookTones[Math.floor(pr() * bookTones.length)];
          quad([[X, ya, z], [X, ya, z + t], [X, top, z + t], [X, top, z]], tone);
          if (pr() < .35) quad([[X, top - .08, z], [X, top - .08, z + t], [X, top - .06, z + t], [X, top - .06, z]], brass);
          z += t + .003;
        }
        // The shelf board and the shadow under the board above.
        quad([[X, ya - .04, z0], [X, ya - .04, z1], [X, ya, z1], [X, ya, z0]], night ? woodDark : woodLit);
        quad([[X, yb + .02, z0], [X, yb + .02, z1], [X, yb + .1, z1], [X, yb + .1, z0]], rgba('#000000', night ? .55 : .3));
      }
      // Uprights between the bays.
      for (let z = z0; z <= z1; z += 1.2) {
        const p1 = pt(X, y0, z), p2 = pt(X, y1, z);
        const w = Math.max(.6, .07 * F / z);
        ctx.fillStyle = night ? woodDark : wood; ctx.fillRect(p1[0] - w / 2, p2[1], w, p1[1] - p2[1]);
      }
    };
    for (const side of [-1, 1]) {
      shelves(side, RW, GY + .35, HC - .9, 5, 5, ZF);
      shelves(side, RW, .15, GY - .1, 5, 2.2, ZF);
      // The gallery: its floor slab seen from below and its front.
      const X = side * GX;
      quad([[X, GY - .15, ZN], [X, GY - .15, ZF], [side * RW, GY - .15, ZF], [side * RW, GY - .15, ZN]], night ? D(woodDark, .3) : D(wood, .15));
      quad([[X, GY - .15, ZN], [X, GY - .15, ZF], [X, GY + .2, ZF], [X, GY + .2, ZN]], night ? woodDark : wood);
      // The brass railing: posts, a top rail and a lower rail.
      for (let z = 2; z < ZF; z += .5) {
        const a = pt(X, GY + .2, z), b = pt(X, GY + 1.1, z), w = Math.max(.4, .035 * F / z);
        ctx.fillStyle = brass; ctx.fillRect(a[0] - w / 2, b[1], w, a[1] - b[1]);
      }
      for (const [y, th] of [[GY + 1.1, .06], [GY + .45, .03]]) {
        quad([[X, y - th, ZN], [X, y - th, ZF], [X, y + th, ZF], [X, y + th, ZN]], brass);
        quad([[X, y + th * .2, ZN], [X, y + th * .2, ZF], [X, y + th, ZF], [X, y + th, ZN]], brassHi);
      }
      // The ladder rail along the lower shelves.
      quad([[side * (RW - .12), 2.55, 2.2], [side * (RW - .12), 2.55, ZF], [side * (RW - .12), 2.6, ZF], [side * (RW - .12), 2.6, 2.2]], brassHi);
    }
    // The bookcases on the far wall beside the window.
    for (const side of [-1, 1]) {
      const xa = side * 2.7, xb = side * RW;
      quad([[xa, 0, ZF], [xb, 0, ZF], [xb, HC - .9, ZF], [xa, HC - .9, ZF]], night ? D(mixHex(P.brown, P.red, .3), .35) : mixHex(bookTones[2], bookTones[0], .35));
      for (let y = .4; y < HC - 1; y += .8) quad([[xa, y, ZF], [xb, y, ZF], [xb, y + .05, ZF], [xa, y + .05, ZF]], night ? woodDark : woodLit);
    }

    // ----- the coffered ceiling -----
    quad([[-RW, HC, ZN], [RW, HC, ZN], [RW, HC, ZF], [-RW, HC, ZF]], night ? mixHex(P.darker_background, P.brown, .2) : mixHex(P.background, '#ffffff', .3));
    for (let z = 3; z < ZF; z += 3) {
      quad([[-RW, HC - .45, z], [RW, HC - .45, z], [RW, HC, z], [-RW, HC, z]], night ? D(woodDark, .2) : D(wall, .06));
      quad([[-RW, HC - .45, z], [RW, HC - .45, z], [RW, HC - .45, z + .35], [-RW, HC - .45, z + .35]], night ? woodDark : D(wall, .12));
    }
    for (const x of [-2.2, 2.2]) quad([[x - .2, HC - .45, ZN], [x + .2, HC - .45, ZN], [x + .2, HC - .45, ZF], [x - .2, HC - .45, ZF]], night ? woodDark : D(wall, .12));

    // ----- the floor: planks with a runner in the aisle -----
    quad([[-RW, 0, ZN], [RW, 0, ZN], [RW, 0, ZF], [-RW, 0, ZF]], night ? D(wood, .25) : mixHex(woodLit, P.background, .3));
    ctx.lineWidth = 1;
    for (let x = -RW; x <= RW; x += .2) {
      const a = pt(x, 0, ZN), b = pt(x, 0, ZF);
      ctx.strokeStyle = rgba('#000000', night ? .3 : .12); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const runner = night ? mixHex(D(P.accent, .7), P.background, .3) : mixHex(adjust(withL(P.accent, .6), { Cx: .55 }), P.background, .35);
    quad([[-.8, .002, ZN], [.8, .002, ZN], [.8, .002, ZF - 1], [-.8, .002, ZF - 1]], runner);
    for (const x of [-.7, .64]) quad([[x, .003, ZN], [x + .06, .003, ZN], [x + .06, .003, ZF - 1], [x, .003, ZF - 1]], night ? D(brass, .3) : mixHex(brass, runner, .3));

    // ----- desks, chairs and lamps, from far to near -----
    const lamps = [];
    const items = [];
    for (const side of [-1, 1]) for (let z = 4.2; z < ZF - 3; z += 2.6) items.push([side, z]);
    items.sort((a, b) => b[1] - a[1]);
    // The desks: a top on legs, open underneath.
    const DX0 = 2.3, DX1 = 4.6, DY = .78, DZ0 = 3.4, DZ1 = ZF - 2.6;
    for (const side of [-1, 1]) {
      const xa = side * DX0, xb = side * DX1;
      quad([[xa - side * .1, .004, DZ0], [xb, .004, DZ0], [xb, .004, DZ1], [xa - side * .1, .004, DZ1]], rgba('#000000', night ? .35 : .14));
      quad([[xa, DY - .08, DZ0], [xb, DY - .08, DZ0], [xb, DY - .08, DZ1], [xa, DY - .08, DZ1]], rgba('#000000', night ? .5 : .2));
      for (let z = DZ1; z >= DZ0; z -= 2.6) for (const x of [xb - side * .12, xa + side * .12]) {
        const a = pt(x, 0, z), b = pt(x, DY - .08, z), w = Math.max(.6, .08 * F / z);
        ctx.fillStyle = night ? woodDark : woodDark; ctx.fillRect(a[0] - w / 2, b[1], w, a[1] - b[1]);
      }
      quad([[xa, DY, DZ0], [xb, DY, DZ0], [xb, DY, DZ1], [xa, DY, DZ1]], night ? woodDark : wood);
      quad([[xa, DY - .08, DZ0], [xa, DY - .08, DZ1], [xa, DY, DZ1], [xa, DY, DZ0]], night ? D(woodDark, .25) : woodDark);
      quad([[xa, DY, DZ0], [xb, DY, DZ0], [xb, DY - .08, DZ0], [xa, DY - .08, DZ0]], night ? D(woodDark, .1) : woodDark);
      quad([[xa, DY + .001, DZ0], [xa, DY + .001, DZ1], [side * (DX0 + .03), DY + .001, DZ1], [side * (DX0 + .03), DY + .001, DZ0]], night ? rgba(P.orange, .3) : rgba('#ffffff', .35));
    }
    for (const [side, z] of items) {
      const lx = side * 3.45, sc = F / z;
      // A leather writing pad and an open book in front of the lamp.
      quad([[side * (DX0 + .12), DY + .002, z - .45], [side * (DX0 + .85), DY + .002, z - .45], [side * (DX0 + .85), DY + .002, z + .45], [side * (DX0 + .12), DY + .002, z + .45]], night ? D(P.accent, .55) : adjust(withL(P.accent, .5), { Cx: .7 }));
      if (pr() < .7) {
        const bx = side * (DX0 + .45), bz = z + (pr() - .5) * .3;
        quad([[bx - .17, DY + .01, bz - .13], [bx + .17, DY + .01, bz - .13], [bx + .17, DY + .01, bz + .13], [bx - .17, DY + .01, bz + .13]], night ? mixHex(P.foreground, P.background, .45) : mixHex(P.background, '#ffffff', .5));
      }
      // A chair on the aisle side: seat, legs, 2 posts, a top rail and spindles.
      const cx = side * (DX0 - .38), seat = .46, cz = z - .05, cw = night ? D(woodDark, .05) : woodDark;
      for (const [dx, dz] of [[-.2, -.18], [.2, -.18], [-.2, .2], [.2, .2]]) {
        const a = pt(cx + dx, 0, cz + dz), b = pt(cx + dx, seat, cz + dz), w = Math.max(.4, .035 * F / (cz + dz));
        ctx.fillStyle = cw; ctx.fillRect(a[0] - w / 2, b[1], w, a[1] - b[1]);
      }
      quad([[cx - .22, seat, cz + .22], [cx + .22, seat, cz + .22], [cx + .22, seat, cz - .2], [cx - .22, seat, cz - .2]], night ? woodDark : wood);
      quad([[cx - .22, seat - .04, cz - .2], [cx + .22, seat - .04, cz - .2], [cx + .22, seat, cz - .2], [cx - .22, seat, cz - .2]], cw);
      const bz = cz - .22;
      for (const dx of [-.2, .2]) {
        const a = pt(cx + dx, seat, bz), b = pt(cx + dx, 1.02, bz - .04), w = Math.max(.4, .04 * F / bz);
        ctx.fillStyle = cw; ctx.fillRect(a[0] - w / 2, b[1], w, a[1] - b[1]);
      }
      for (let k = -1; k <= 1; k++) {
        const a = pt(cx + k * .1, seat, bz), b = pt(cx + k * .1, .92, bz - .03);
        ctx.strokeStyle = cw; ctx.lineWidth = Math.max(.3, .015 * F / bz); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      quad([[cx - .23, .9, bz - .03], [cx + .23, .9, bz - .03], [cx + .23, 1.02, bz - .04], [cx - .23, 1.02, bz - .04]], night ? woodDark : wood);
      // A banker's lamp: a brass foot and stem, a green glass shade.
      const foot = pt(lx, DY, z);
      ctx.fillStyle = brass; ctx.beginPath(); ellipse(ctx, foot[0], foot[1], .12 * sc, .03 * sc); ctx.fill();
      const top = pt(lx, DY + .36, z);
      ctx.fillStyle = brass; ctx.fillRect(foot[0] - .012 * sc, top[1], .024 * sc, foot[1] - top[1]);
      const sw = .26 * sc, sh = .1 * sc;
      lamps.push([top[0], top[1] + sh * .2, sw, sh, z]);
      if (night) {
        ctx.save(); ctx.globalCompositeOperation = 'screen';
        const pool = pt(lx - side * .3, DY, z - .1);
        ctx.fillStyle = radial(ctx, pool[0], pool[1], 0, 1.1 * sc, [[0, rgba(glow, .6)], [.45, rgba(P.orange, .2)], [1, rgba(P.orange, 0)]]);
        ctx.beginPath(); ellipse(ctx, pool[0], pool[1], 1.1 * sc, .26 * sc); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = linear(ctx, 0, top[1] - sh, 0, top[1] + sh * .3, [[0, shadeHi], [.45, shade], [1, D(shade, .35)]]);
      ctx.beginPath(); ctx.ellipse(top[0], top[1], sw, sh, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', night ? .25 : .45);
      ctx.beginPath(); ctx.ellipse(top[0] - sw * .2, top[1] - sh * .62, sw * .45, sh * .14, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = night ? glow : mixHex(shade, '#ffffff', .4);
      ctx.beginPath(); ctx.ellipse(top[0], top[1], sw, sh * .22, 0, 0, Math.PI); ctx.fill();
      ctx.strokeStyle = brass; ctx.lineWidth = Math.max(.5, .012 * sc);
      ctx.beginPath(); ctx.ellipse(top[0], top[1], sw, sh * .22, 0, 0, TAU); ctx.stroke();
    }
    // Lamplight spills over the room at night.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      lamps.forEach(([lx, ly, sw]) => {
        ctx.fillStyle = radial(ctx, lx, ly + sw * .6, 0, sw * 9, [[0, rgba(P.orange, .1)], [1, rgba(P.orange, 0)]]);
        ctx.fillRect(lx - sw * 9, ly - sw * 9, sw * 18, sw * 18);
      });
      ctx.restore();
    }

    // ----- light -----
    if (night) {
      bloom(ctx, x => {
        lamps.forEach(([lx, ly, sw, sh]) => {
          x.fillStyle = rgba(P.bright_green, .55); x.beginPath(); x.ellipse(lx, ly - sh * .3, sw, sh * .9, 0, Math.PI, 0); x.fill();
          x.fillStyle = glow; x.beginPath(); x.ellipse(lx, ly + sh * .05, sw, sh * .3, 0, 0, TAU); x.fill();
        });
      }, [60, 16], [.6, .5]);
      ctx.fillStyle = radial(ctx, VX, VY, 0, 1300, [[0, rgba(P.orange, .08)], [1, rgba('#000000', .35)]]);
      ctx.fillRect(0, 0, W, H);
    } else {
      // A shaft of daylight from the window down the aisle.
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      const w0 = pt(-2.2, 8, ZF), w1 = pt(2.2, 8, ZF);
      ctx.fillStyle = linear(ctx, 0, VY - 200, 0, H, [[0, rgba('#ffffff', .4)], [1, rgba('#ffffff', 0)]]);
      ctx.beginPath(); ctx.moveTo(w0[0], w0[1]); ctx.lineTo(w1[0], w1[1]); ctx.lineTo(1500, H); ctx.lineTo(420, H); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle = radial(ctx, VX, VY, 0, 1300, [[0, rgba('#ffffff', .2)], [1, rgba(P.darker_background, .25)]]);
      ctx.fillRect(0, 0, W, H);
    }

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });

  // ---------- interior/adobe ----------

  // An adobe wall in strong sun: a parapet against the sky, vigas with long
  // shadows, a deep turquoise door and window, a ladder, chiles and a cactus.
  // At night the moon lights it, the window glows and a lantern burns.
  scene('interior', 'adobe', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r)), nB = makeNoise(seedOf(r));
    const pr = rng(seedOf(r));
    const TOP = 190, BASE = 968;
    // The sun or the moon is high at the upper left: shadows fall down and to the right.
    const SDX = .75, SDY = 1;

    const sky0 = night ? P.darker_background : adjust(withL(P.blue, .6), { Cx: 1.1 });
    const sky1 = night ? mixHex(P.background, P.blue, .32) : adjust(withL(P.blue, .82), { Cx: .6 });
    const plaster = night ? mixHex(mixHex(P.muted, P.blue, .2), P.background, .4) : mixHex(withL(P.orange, .8), P.background, .25);
    const plasterHi = night ? mixHex(mixHex(P.muted, P.blue, .12), P.foreground, .1) : mixHex(withL(P.orange, .88), '#ffffff', .25);
    const shadowTint = night ? mixHex(P.blue, '#000000', .55) : mixHex(withL(P.red, .55), P.blue, .25);
    const turq = night ? mixHex(P.accent, P.background, .25) : adjust(withL(P.accent, .6), { Cx: 1.2 });
    const turqDark = night ? mixHex(P.accent, '#000000', .6) : withL(P.accent, .42);
    const woodC = night ? mixHex(P.brown, P.background, .3) : adjust(withL(P.brown, .5), { Cx: .5 });
    const woodHi = night ? mixHex(P.brown, P.muted, .5) : adjust(withL(P.brown, .66), { Cx: .5 });
    const warm = night ? P.bright_yellow : withL(P.yellow, .85);

    // Multiplies a shadow onto the wall, so the plaster texture shows through.
    const shadowFill = (draw, a = 1) => {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = a;
      ctx.fillStyle = mixHex('#ffffff', shadowTint, night ? .55 : .62);
      ctx.beginPath(); draw(); ctx.fill(); ctx.restore();
    };

    // ----- the sky -----
    skyGradient(ctx, [[0, sky0], [1, sky1]], 0, TOP + 60);
    if (night) {
      stars(ctx, pr, 160, [0, 0, W, TOP], [P.bright_foreground, P.bright_cyan, P.bright_yellow], 1.6);
      ctx.fillStyle = P.bright_foreground; ctx.beginPath(); circle(ctx, 1660, 70, 22); ctx.fill();
      ctx.fillStyle = sky0; ctx.beginPath(); circle(ctx, 1672, 63, 20); ctx.fill();
    }

    // ----- the wall with an uneven parapet -----
    const parapet = [];
    for (let x = -20; x <= W + 20; x += 40) parapet.push([x, TOP + nA(x / 260, 2) * 12 + (x > 1040 && x < 1460 ? -46 : 0)]);
    const wallPath = c => { smoothPath(c, parapet); c.lineTo(W + 20, H + 20); c.lineTo(-20, H + 20); c.closePath(); };
    const tex = bake(960, 540, (i, j, o) => {
      const x = i * 2, y = j * 2;
      const h = fbm(nA, x / 140, y / 140, 4) * 1 + fbm(nB, x / 26, y / 26, 3) * .35 + nB(x / 9, y / 40) * .04;
      const h2 = fbm(nA, (x - 3) / 140, (y - 3) / 140, 4) * 1 + fbm(nB, (x - 3) / 26, (y - 3) / 26, 3) * .35 + nB((x - 3) / 9, (y - 3) / 40) * .04;
      const lit = clamp(.5 + (h - h2) * 2.2 + .25, 0, 1);
      let c = mixC(C(plaster), C(plasterHi), lit);
      c = mixC(c, C(night ? P.darker_background : withL(P.red, .62)), ss(.2, .7, fbm(nB, x / 300 + 4, y / 200, 3)) * .25);
      if (hash2(i, j, 2) > .985) c = mixC(c, [255, 255, 255], .25);
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    ctx.save(); ctx.beginPath(); wallPath(ctx); ctx.clip();
    put(ctx, tex);
    // The wall darkens a little toward its base and toward the right.
    ctx.fillStyle = linear(ctx, 0, TOP, W, H, [[0, rgba('#ffffff', night ? 0 : .12)], [1, rgba('#000000', night ? .3 : .08)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // A soft rounded lip along the parapet.
    ctx.save(); ctx.beginPath(); wallPath(ctx); ctx.clip();
    ctx.lineWidth = 14; ctx.strokeStyle = rgba('#ffffff', night ? .1 : .3);
    ctx.beginPath(); smoothPath(ctx, parapet.map(([x, y]) => [x, y + 5])); ctx.stroke();
    ctx.lineWidth = 10; ctx.strokeStyle = rgba('#000000', night ? .2 : .08);
    ctx.beginPath(); smoothPath(ctx, parapet.map(([x, y]) => [x, y + 20])); ctx.stroke();
    ctx.restore();

    // ----- vigas: round beam ends with long shadows -----
    const vigaY = TOP + 82, vigas = [];
    for (let x = 90; x < W; x += 172) if (x < 1000 || x > 1500) vigas.push([x + (pr() - .5) * 14, vigaY + (pr() - .5) * 8, 22 + pr() * 5]);
    const sl = Math.hypot(SDX, SDY), px = -SDY / sl, py = SDX / sl, sa = Math.atan2(SDY, SDX);
    vigas.forEach(([x, y, rad]) => shadowFill(() => {
      const L = 170, ex = x + L * SDX / sl, ey = y + L * SDY / sl;
      ctx.moveTo(x + px * rad, y + py * rad); ctx.lineTo(ex + px * rad, ey + py * rad);
      ctx.arc(ex, ey, rad, sa + Math.PI / 2, sa - Math.PI / 2, true);
      ctx.lineTo(x - px * rad, y - py * rad); ctx.closePath();
    }));
    // A wooden water spout through the parapet, with its shadow.
    const sp = [1236, TOP - 30];
    shadowFill(() => { ctx.moveTo(sp[0] - 20, sp[1] + 22); ctx.lineTo(sp[0] + 80, sp[1] + 22); ctx.lineTo(sp[0] + 80 + 60 * SDX, sp[1] + 22 + 60 * SDY); ctx.lineTo(sp[0] - 20 + 60 * SDX, sp[1] + 22 + 60 * SDY); ctx.closePath(); });
    ctx.fillStyle = woodC; ctx.fillRect(sp[0] - 20, sp[1], 100, 22);
    ctx.fillStyle = mixHex(woodC, '#000000', .45); ctx.fillRect(sp[0] - 20, sp[1] + 5, 100, 6);
    ctx.fillStyle = woodHi; ctx.fillRect(sp[0] - 20, sp[1], 100, 4);
    vigas.forEach(([x, y, rad]) => {
      ctx.fillStyle = radial(ctx, x - rad * .3, y - rad * .3, 1, rad * 1.1, [[0, woodHi], [1, woodC]]);
      ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
      ctx.strokeStyle = rgba('#000000', .3); ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) { ctx.beginPath(); circle(ctx, x + .5, y + .5, rad * k / 4); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rad * .8, y - rad * .4); ctx.stroke();
    });

    // ----- a recessed opening: the trim, then the inner shadow cast by the wall -----
    const recess = (x0, y0, x1, y1, depth, inner) => {
      ctx.fillStyle = turqDark; ctx.fillRect(x0 - 14, y0 - 14, x1 - x0 + 28, y1 - y0 + 28);
      ctx.fillStyle = turq; ctx.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 20);
      inner(x0, y0, x1, y1);
      // The wall casts its shadow into the opening, on the left and at the top.
      shadowFill(() => { ctx.moveTo(x0, y0); ctx.lineTo(x1, y0); ctx.lineTo(x1, y0 + depth * SDY); ctx.lineTo(x0 + depth * SDX, y0 + depth * SDY); ctx.lineTo(x0 + depth * SDX, y1); ctx.lineTo(x0, y1); ctx.closePath(); }, .95);
      // A soft rounded edge of plaster around the opening.
      ctx.strokeStyle = rgba('#ffffff', night ? .1 : .35); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x0 - 16, y1 + 14); ctx.lineTo(x0 - 16, y0 - 16); ctx.lineTo(x1 + 16, y0 - 16); ctx.stroke();
    };
    // The window, with a deep sill.
    const WX0 = 250, WY0 = 420, WX1 = 560, WY1 = 690;
    recess(WX0, WY0, WX1, WY1, 34, (x0, y0, x1, y1) => {
      ctx.fillStyle = night ? linear(ctx, 0, y0, 0, y1, [[0, mixHex(warm, P.orange, .3)], [1, mixHex(P.orange, P.red, .4)]]) : linear(ctx, x0, y0, x1, y1, [[0, mixHex(P.foreground, sky1, .25)], [1, P.foreground]]);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      if (!night) { ctx.fillStyle = linear(ctx, x0, y0, x1, y1, [[0, rgba(sky1, .5)], [.4, rgba(sky1, 0)]]); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); }
      ctx.fillStyle = turq;
      ctx.fillRect((x0 + x1) / 2 - 6, y0, 12, y1 - y0);
      for (const t of [1 / 3, 2 / 3]) ctx.fillRect(x0, lerp(y0, y1, t) - 5, x1 - x0, 10);
    });
    shadowFill(() => { ctx.moveTo(WX0 - 30, WY1 + 24); ctx.lineTo(WX1 + 30, WY1 + 24); ctx.lineTo(WX1 + 30 + 30 * SDX, WY1 + 24 + 30 * SDY); ctx.lineTo(WX0 - 30 + 30 * SDX, WY1 + 24 + 30 * SDY); ctx.closePath(); });
    ctx.fillStyle = plasterHi; ctx.beginPath(); ctx.roundRect(WX0 - 30, WY1 + 8, WX1 - WX0 + 60, 18, 8); ctx.fill();

    // The door under a heavy lintel.
    const DX0 = 1250, DY0 = 470, DX1 = 1520, DY1 = BASE;
    recess(DX0, DY0, DX1, DY1, 42, (x0, y0, x1, y1) => {
      ctx.fillStyle = turq; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.lineWidth = 2.2;
      for (let x = x0 + 34; x < x1; x += 34) { ctx.strokeStyle = turqDark; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke(); }
      // Raised panels and iron straps.
      ctx.strokeStyle = turqDark; ctx.lineWidth = 4;
      ctx.strokeRect(x0 + 30, y0 + 40, x1 - x0 - 60, 170); ctx.strokeRect(x0 + 30, y0 + 260, x1 - x0 - 60, 200);
      ctx.fillStyle = night ? '#000000' : mixHex(P.foreground, '#000000', .3);
      for (const y of [y0 + 60, y1 - 70]) ctx.fillRect(x0, y, 110, 10);
      ctx.beginPath(); circle(ctx, x1 - 40, (y0 + y1) / 2, 7); ctx.fill();
    });
    ctx.fillStyle = woodC; ctx.fillRect(DX0 - 60, DY0 - 64, DX1 - DX0 + 120, 46);
    ctx.fillStyle = woodHi; ctx.fillRect(DX0 - 60, DY0 - 64, DX1 - DX0 + 120, 7);
    shadowFill(() => { ctx.rect(DX0 - 60 + 14, DY0 - 18, DX1 - DX0 + 120, 12); });

    // ----- a string of red chiles beside the door -----
    {
      const x = DX1 + 76, y0 = DY0 - 6, y1 = DY0 + 310;
      const chiles = [];
      for (let y = y0; y < y1; y += 5) for (let k = 0; k < 2; k++) {
        const t = (y - y0) / (y1 - y0), spread = 1.35 * (1 - t * .35);
        chiles.push([y, (pr() * 2 - 1) * spread, 38 * (1 - t * .3) * (.8 + pr() * .3), pr()]);
      }
      const shape = (len) => { ctx.moveTo(2, -6.5); ctx.quadraticCurveTo(len * .55, -9, len, 0); ctx.quadraticCurveTo(len * .55, 8, 2, 6.5); ctx.closePath(); };
      shadowFill(() => chiles.forEach(([y, a, len]) => {
        const ang = Math.PI / 2 - a, ox = x + 22 + Math.cos(ang) * len * .5, oy = y + 30 + Math.sin(ang) * len * .5;
        ellipse(ctx, ox, oy, len * .5, 6.5, ang);
      }), .8);
      ctx.strokeStyle = woodC; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y0 - 34); ctx.lineTo(x, y0); ctx.stroke();
      for (const [y, a, len, v] of chiles) {
        ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2 - a);
        const lit = night ? mixHex(P.red, P.bright_red, .15 + v * .35) : withL(P.red, .5 + v * .14);
        ctx.fillStyle = linear(ctx, 0, -8, 0, 8, [[0, mixHex(lit, '#ffffff', .22)], [.4, lit], [1, mixHex(lit, '#000000', .45)]]);
        ctx.beginPath(); shape(len); ctx.fill();
        ctx.strokeStyle = rgba('#000000', .25); ctx.lineWidth = .8; ctx.stroke();
        ctx.restore();
      }
    }

    // ----- a ladder of poles leaning on the wall -----
    {
      const foot = [[700, BASE + 40], [820, BASE + 40]], tip = [[770, TOP - 70], [880, TOP - 70]];
      const rail = (a, b) => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); };
      // The shadow falls on the wall to the lower right.
      shadowFill(() => {
        for (const [a, b] of [[foot[0], tip[0]], [foot[1], tip[1]]]) {
          const off = 40;
          ctx.moveTo(a[0] + 2, a[1] - 40); ctx.lineTo(b[0] + off * SDX + 2, b[1] + off * SDY + 70); ctx.lineTo(b[0] + off * SDX + 14, b[1] + off * SDY + 70); ctx.lineTo(a[0] + 14, a[1] - 40); ctx.closePath();
        }
        for (let t = .1; t < .95; t += .085) {
          const ax = lerp(foot[0][0], tip[0][0], t) + 40 * SDX * t, ay = lerp(foot[0][1], tip[0][1], t) + 40 * SDY * t + 20, bx = lerp(foot[1][0], tip[1][0], t) + 40 * SDX * t;
          ctx.rect(ax, ay, bx - ax + 10, 9);
        }
      }, .85);
      ctx.lineCap = 'round';
      for (const [a, b] of [[foot[0], tip[0]], [foot[1], tip[1]]]) {
        ctx.strokeStyle = woodC; ctx.lineWidth = 13; rail(a, b); ctx.stroke();
        ctx.strokeStyle = woodHi; ctx.lineWidth = 4; rail([a[0] - 3, a[1]], [b[0] - 3, b[1]]); ctx.stroke();
      }
      for (let t = .1; t < .95; t += .085) {
        const ax = lerp(foot[0][0], tip[0][0], t), ay = lerp(foot[0][1], tip[0][1], t), bx = lerp(foot[1][0], tip[1][0], t);
        ctx.strokeStyle = woodC; ctx.lineWidth = 9; rail([ax - 6, ay], [bx + 6, ay]); ctx.stroke();
        ctx.strokeStyle = woodHi; ctx.lineWidth = 3; rail([ax - 6, ay - 2.5], [bx + 6, ay - 2.5]); ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }

    // ----- the ground -----
    const ground = night ? mixHex(P.background, P.muted, .35) : mixHex(withL(P.yellow, .82), P.background, .3);
    ctx.fillStyle = linear(ctx, 0, BASE, 0, H, [[0, ground], [1, mixHex(ground, night ? '#000000' : P.brown, .25)]]);
    ctx.beginPath(); ctx.moveTo(0, BASE + 4); for (let x = 0; x <= W; x += 40) ctx.lineTo(x, BASE + nB(x / 200, 5) * 5); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    shadowFill(() => { ctx.rect(0, BASE - 2, W, 16); }, .6);
    for (let q = 0; q < 900; q++) {
      const x = pr() * W, y = BASE + 6 + pr() * (H - BASE);
      ctx.fillStyle = rgba(pr() < .5 ? '#000000' : '#ffffff', .12 + pr() * .12);
      ctx.beginPath(); circle(ctx, x, y, .6 + pr() * 1.8); ctx.fill();
    }

    // ----- a prickly pear in the corner -----
    {
      const pads = [];
      const grow = (x, y, a, size, depth) => {
        pads.push([x, y, a, size]);
        if (depth > 0) for (let k = 0; k < 2 + (pr() < .5 ? 1 : 0); k++) {
          const na = a + (pr() - .5) * 1.4, d = size * 1.05;
          grow(x + Math.sin(na) * d, y - Math.cos(na) * d, na, size * (.72 + pr() * .15), depth - 1);
        }
      };
      grow(1740, BASE + 30, -.1, 118, 2);
      grow(1600, BASE + 44, -.55, 88, 1);
      pads.sort((a, b) => b[1] - a[1]);
      shadowFill(() => pads.forEach(([x, y, a, sz]) => ellipse(ctx, x + sz * .9, y + 40 - sz * .2, sz * .55, sz * .75, a + .5)), .9);
      const cg = night ? mixHex(P.green, P.background, .4) : adjust(withL(P.green, .56), { Cx: 1.1 });
      pads.forEach(([x, y, a, sz]) => {
        const cx = x + Math.sin(a) * sz * .5, cy = y - Math.cos(a) * sz * .5;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
        ctx.fillStyle = radial(ctx, -sz * .2, -sz * .25, 2, sz * .9, [[0, mixHex(cg, '#ffffff', .25)], [.6, cg], [1, mixHex(cg, '#000000', .4)]]);
        ctx.beginPath(); ellipse(ctx, 0, 0, sz * .36, sz * .56); ctx.fill();
        ctx.strokeStyle = rgba('#000000', .25); ctx.lineWidth = 1.5; ctx.stroke();
        // Areoles in a diagonal grid, each with a tuft of spines.
        for (let u = -2; u <= 2; u++) for (let v = -3; v <= 3; v++) {
          const ax = (u + (v % 2 ? .5 : 0)) * sz * .13, ay = v * sz * .14;
          if ((ax / (sz * .33)) ** 2 + (ay / (sz * .52)) ** 2 > 1) continue;
          ctx.fillStyle = rgba(night ? P.foreground : '#ffffff', .6); ctx.beginPath(); circle(ctx, ax, ay, 1.6); ctx.fill();
          ctx.strokeStyle = rgba(night ? P.foreground : '#ffffff', .5); ctx.lineWidth = .7;
          ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 4, ay - 5); ctx.moveTo(ax, ay); ctx.lineTo(ax + 5, ay - 3); ctx.stroke();
        }
        ctx.restore();
      });
      // A few flowers on the top pads.
      pads.slice(-4).forEach(([x, y, a, sz]) => {
        const fx = x + Math.sin(a) * sz * 1.05, fy = y - Math.cos(a) * sz * 1.05;
        ctx.fillStyle = night ? P.magenta : withL(P.magenta, .68);
        for (let k = 0; k < 6; k++) { ctx.beginPath(); petal(ctx, fx, fy, 14, 6, k / 6 * TAU - Math.PI / 2, .5); ctx.fill(); }
        ctx.fillStyle = night ? P.yellow : withL(P.yellow, .8); ctx.beginPath(); circle(ctx, fx, fy, 4); ctx.fill();
      });
    }

    // ----- light -----
    if (night) {
      // The lantern beside the door and the glow from the window. Away from them the wall falls into shade.
      const lx = DX0 - 80, ly = DY0 + 70;
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, (lx + WX1) / 2, ly + 60, 200, 1300, [[0, '#ffffff'], [1, mixHex('#ffffff', P.darker_background, .55)]]);
      ctx.beginPath(); wallPath(ctx); ctx.fill();
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, lx, ly, 0, 520, [[0, rgba(P.orange, .5)], [.3, rgba(P.orange, .16)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = radial(ctx, (WX0 + WX1) / 2, (WY0 + WY1) / 2, 0, 460, [[0, rgba(P.orange, .18)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = mixHex(P.brown, '#000000', .4); ctx.fillRect(lx - 3, ly - 60, 6, 26);
      ctx.fillStyle = warm; ctx.beginPath(); ctx.roundRect(lx - 14, ly - 34, 28, 44, 6); ctx.fill();
      ctx.strokeStyle = mixHex(P.brown, '#000000', .4); ctx.lineWidth = 3; ctx.strokeRect(lx - 14, ly - 34, 28, 44);
      bloom(ctx, x => { x.fillStyle = warm; x.beginPath(); circle(x, lx, ly - 12, 20); x.fill(); x.fillStyle = rgba(P.orange, .5); x.fillRect(WX0, WY0, WX1 - WX0, WY1 - WY0); }, [60, 14], [.45, .2]);
    } else {
      ctx.fillStyle = radial(ctx, 200, 0, 100, 1800, [[0, rgba('#ffffff', .16)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, H);
    }

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .04);
  });

  // ---------- interior/concrete ----------

  // Brutalist concrete in hard light: board formed walls, a pier with a slit
  // window, a stair flight up to a landing under a massive cantilever, and a
  // safety orange sign by the door.
  scene('interior', 'concrete', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r));
    const pr = rng(seedOf(r));
    // Light from the upper left. A thing d units in front of the wall casts its
    // shadow d * KX to the right and d * KY down.
    const KX = .82, KY = .7;
    const lit = night ? mixHex(P.muted, P.background, .35) : mixHex(P.background, P.muted, .22);
    const litHi = night ? mixHex(P.muted, P.foreground, .12) : mixHex(P.background, '#ffffff', .4);
    const shadeMul = night ? mixHex('#ffffff', P.darker_background, .72) : mixHex('#ffffff', mixHex(P.muted, P.blue, .06), .5);
    const sign = night ? P.accent : adjust(withL(P.accent, .7), { C: .09 });
    const steel = night ? P.darker_background : mixHex(P.foreground, P.muted, .3);

    const GROUND = 968;
    // The stair flight: 20 steps from the floor to the landing.
    const SX0 = 470, SY0 = GROUND, STEPS = 20, RUN = 44, RISE = 22.4, SD = 130;
    const LAND = SY0 - STEPS * RISE, SX1 = SX0 + STEPS * RUN;
    const stairPts = [[SX0, SY0]];
    for (let k = 0; k < STEPS; k++) { stairPts.push([SX0 + k * RUN, SY0 - (k + 1) * RISE]); stairPts.push([SX0 + (k + 1) * RUN, SY0 - (k + 1) * RISE]); }
    stairPts.push([W + 20, LAND], [W + 20, LAND + 86], [SX1 + 20, LAND + 86], [SX0 + 150, SY0]);
    const CANT = 236, CD = 330, PIER = 360, PD = 220;

    // A concrete surface: boards, seams, tie holes and pores, clipped to a path.
    const surface = (path, base, seed, x0, y0, x1, y1) => {
      ctx.save(); ctx.beginPath(); path(); ctx.clip();
      ctx.fillStyle = base; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      const bh = 24;
      for (let y = y0 - ((y0 % bh) + bh) % bh, k = 0; y < y1; y += bh, k++) {
        const t = hash2(k, seed, 1);
        ctx.fillStyle = t > .5 ? rgba('#ffffff', (t - .5) * (night ? .06 : .14)) : rgba('#000000', (.5 - t) * (night ? .12 : .1));
        ctx.fillRect(x0, y, x1 - x0, bh);
        ctx.fillStyle = rgba('#000000', night ? .2 : .1); ctx.fillRect(x0, y, x1 - x0, 1.2);
        ctx.fillStyle = rgba('#ffffff', night ? .05 : .22); ctx.fillRect(x0, y + 1.2, x1 - x0, .8);
      }
      // Grain of the boards, pressed into the concrete.
      ctx.lineWidth = .8;
      for (let q = 0; q < (x1 - x0) * (y1 - y0) / 900; q++) {
        const x = lerp(x0, x1, pr()), y = lerp(y0, y1, pr()), len = 40 + pr() * 160;
        ctx.strokeStyle = rgba(pr() < .5 ? '#000000' : '#ffffff', night ? .05 : .07);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.bezierCurveTo(x + len * .3, y + (pr() - .5) * 3, x + len * .7, y + (pr() - .5) * 3, x + len, y + (pr() - .5) * 2); ctx.stroke();
      }
      // Tie holes on a grid.
      for (let y = y0 + 60; y < y1 - 20; y += 120) for (let x = x0 + 70; x < x1 - 20; x += 150) {
        ctx.fillStyle = rgba('#000000', night ? .55 : .35); ctx.beginPath(); circle(ctx, x, y, 6); ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', night ? .1 : .5); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, 6.5, .2, 2.4); ctx.stroke();
      }
      // Small air pores.
      for (let q = 0; q < (x1 - x0) * (y1 - y0) / 1400; q++) {
        const x = lerp(x0, x1, pr()), y = lerp(y0, y1, pr()), rad = .6 + pr() ** 3 * 2.4;
        ctx.fillStyle = rgba('#000000', .3 + pr() * .3); ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
        ctx.fillStyle = rgba('#ffffff', night ? .08 : .3); ctx.beginPath(); circle(ctx, x + rad * .3, y + rad * .35, rad * .6); ctx.fill();
      }
      // Water stains that run down from the top, soft at the sides.
      for (let q = 0; q < (x1 - x0) / 160; q++) {
        const x = lerp(x0, x1, pr()), w = 10 + pr() * 40, len = 80 + pr() * 380, a = (night ? .12 : .07) * (.5 + pr() * .5);
        ctx.save(); ctx.translate(x, y0); ctx.scale(w / 100, len / 100);
        ctx.fillStyle = radial(ctx, 0, 0, 0, 100, [[0, rgba('#000000', a)], [1, rgba('#000000', 0)]]);
        ctx.beginPath(); ctx.rect(-100, 0, 200, 100); ctx.fill();
        ctx.restore();
      }
      ctx.restore();
    };
    const shadow = (path, a = 1) => {
      ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.globalAlpha = a;
      ctx.fillStyle = shadeMul; ctx.beginPath(); path(); ctx.fill(); ctx.restore();
    };

    // ----- the back wall, its door and the sign -----
    surface(() => ctx.rect(0, 0, W, GROUND), lit, 1, 0, 0, W, GROUND);
    // Large tone patches from separate pours.
    put(ctx, bake(240, 135, (i, j, o) => { const v = fbm(nA, i / 40, j / 40, 4); o[0] = o[1] = o[2] = v > 0 ? 255 : 0; o[3] = Math.abs(v) * (night ? 40 : 46); }), 0, 0, W, H, 1);
    const DX0 = 1560, DX1 = 1730, DY0 = LAND - 250;
    ctx.fillStyle = night ? '#000000' : mixHex(P.foreground, P.muted, .25); ctx.fillRect(DX0, DY0, DX1 - DX0, LAND - DY0);
    ctx.fillStyle = rgba('#000000', .35); ctx.fillRect(DX0, DY0, 26, LAND - DY0);
    const SG = [1412, LAND - 214, 108];

    // ----- shadows on the back wall -----
    // The stair flight and the landing.
    shadow(() => poly(ctx, stairPts.map(([x, y]) => [x + SD * KX, y + SD * KY])));
    // The handrail and its posts.
    const rail = k => [SX0 + k * RUN + RUN * .5, SY0 - (k + 1) * RISE - 92];
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.strokeStyle = shadeMul; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(rail(0)[0] + (SD - 14) * KX, rail(0)[1] + (SD - 14) * KY); ctx.lineTo(rail(STEPS - 1)[0] + (SD - 14) * KX, rail(STEPS - 1)[1] + (SD - 14) * KY); ctx.lineTo(W + 40, rail(STEPS - 1)[1] + (SD - 14) * KY); ctx.stroke();
    ctx.restore();
    // The cantilever above and the pier at the left.
    shadow(() => poly(ctx, [[0, 0], [W, 0], [W, CANT + CD * KY], [900 + CD * KX, CANT + CD * KY], [900, CANT], [900, 0]]));
    shadow(() => poly(ctx, [[PIER, 0], [PIER + PD * KX, PD * KY], [PIER + PD * KX, GROUND], [PIER, GROUND]]));

    // The sign: a square of safety orange with a white band, on 4 bolts. It
    // stays bright in the shade, as safety paint does.
    ctx.fillStyle = rgba('#000000', night ? .5 : .3); ctx.fillRect(SG[0] + 6, SG[1] + 6, SG[2], SG[2]);
    ctx.fillStyle = sign; ctx.fillRect(SG[0], SG[1], SG[2], SG[2]);
    ctx.save(); ctx.beginPath(); ctx.rect(SG[0], SG[1], SG[2], SG[2]); ctx.clip();
    ctx.fillStyle = night ? P.bright_foreground : '#ffffff';
    ctx.beginPath(); poly(ctx, [[SG[0] - 10, SG[1] + SG[2] * .62], [SG[0] + SG[2] * .62, SG[1] - 10], [SG[0] + SG[2] * .86, SG[1] - 10], [SG[0] - 10, SG[1] + SG[2] * .86]]); ctx.fill();
    ctx.fillStyle = linear(ctx, SG[0], SG[1], SG[0] + SG[2], SG[1] + SG[2], [[0, rgba('#ffffff', .18)], [1, rgba('#000000', .15)]]); ctx.fillRect(SG[0], SG[1], SG[2], SG[2]);
    ctx.restore();
    ctx.fillStyle = steel;
    for (const [dx, dy] of [[8, 8], [SG[2] - 8, 8], [8, SG[2] - 8], [SG[2] - 8, SG[2] - 8]]) { ctx.beginPath(); circle(ctx, SG[0] + dx, SG[1] + dy, 2.4); ctx.fill(); }


    // ----- the stair flight -----
    surface(() => poly(ctx, stairPts), mixHex(lit, litHi, .45), 2, SX0 - 10, LAND - 10, W, GROUND);
    // The underside edge of the flight and the landing.
    ctx.strokeStyle = rgba('#000000', night ? .5 : .25); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(SX0 + 150, SY0); ctx.lineTo(SX1 + 20, LAND + 86); ctx.lineTo(W + 20, LAND + 86); ctx.stroke();
    // Nosings: each tread catches the light, with a thin orange safety strip.
    for (let k = 0; k < STEPS; k++) {
      const x = SX0 + k * RUN, y = SY0 - (k + 1) * RISE;
      ctx.fillStyle = litHi; ctx.fillRect(x, y, RUN, 3);
      ctx.fillStyle = rgba(sign, .85); ctx.fillRect(x + RUN - 10, y, 10, 2.4);
      ctx.fillStyle = rgba('#000000', night ? .35 : .16); ctx.fillRect(x + RUN - 1.5, y, 1.5, RISE);
    }
    // The landing edge and the soffit under the flight.
    ctx.fillStyle = litHi; ctx.fillRect(SX1, LAND, W - SX1, 3);
    shadow(() => poly(ctx, [[SX0 + 150, SY0], [SX1 + 20, LAND + 86], [W + 20, LAND + 86], [W + 20, LAND + 70], [SX1 + 20, LAND + 70], [SX0 + 130, SY0]]), .8);
    shadow(() => ctx.rect(SX0 - 10, LAND - 10, 10, GROUND - LAND + 10), 0);
    // The steel handrail with posts.
    ctx.strokeStyle = steel; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(...rail(0)); ctx.lineTo(...rail(STEPS - 1)); ctx.lineTo(W + 40, rail(STEPS - 1)[1]); ctx.stroke();
    ctx.lineWidth = 3;
    for (let k = 0; k < STEPS; k += 4) { const [x, y] = rail(k); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 92); ctx.stroke(); }
    ctx.strokeStyle = rgba('#ffffff', night ? .12 : .4); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rail(0)[0], rail(0)[1] - 1.5); ctx.lineTo(rail(STEPS - 1)[0], rail(STEPS - 1)[1] - 1.5); ctx.lineTo(W + 40, rail(STEPS - 1)[1] - 1.5); ctx.stroke();

    // ----- the pier with a slit window -----
    surface(() => ctx.rect(0, 0, PIER, GROUND), lit, 3, 0, 0, PIER, GROUND);
    ctx.fillStyle = night ? mixHex(P.darker_background, P.accent, .08) : mixHex(P.foreground, P.muted, .2);
    ctx.fillRect(150, 200, 26, 520);
    ctx.fillStyle = rgba('#000000', .35); ctx.fillRect(150, 200, 26, 12); ctx.fillRect(150, 200, 8, 520);
    ctx.fillStyle = litHi; ctx.fillRect(PIER - 3, 0, 3, GROUND);
    // The cantilever: a heavy block over the landing.
    surface(() => ctx.rect(900, 0, W - 900, CANT), lit, 4, 900, 0, W, CANT);
    ctx.fillStyle = litHi; ctx.fillRect(900, CANT - 3, W - 900, 3);
    ctx.fillStyle = rgba('#000000', night ? .45 : .2); ctx.fillRect(900, 0, 3, CANT);
    shadow(() => ctx.rect(900, CANT - 26, W - 900, 26), .5);

    // ----- the ground -----
    ctx.fillStyle = night ? mixHex(lit, '#000000', .25) : mixHex(lit, '#ffffff', .25); ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = rgba('#000000', night ? .3 : .12);
    for (let x = 0; x < W; x += 240) ctx.fillRect(x, GROUND, 1.5, H - GROUND);
    shadow(() => poly(ctx, [[PIER, GROUND], [PIER + PD * KX * 1.4, H], [0, H], [0, GROUND]]), .9);
    shadow(() => poly(ctx, [[SX0, GROUND], [SX0 + 150, GROUND], [SX0 + 150 + SD * 1.1, H], [SX0 + SD * .9, H]]), .8);
    ctx.fillStyle = litHi; ctx.fillRect(0, GROUND, W, 2);

    // ----- light -----
    if (night) {
      // A lamp over the door, and the sign lit from above.
      const lx = DX0 - 40, ly = DY0 - 30;
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, lx, ly, 0, 640, [[0, rgba(P.bright_yellow, .32)], [.35, rgba(P.yellow, .1)], [1, rgba(P.yellow, 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = radial(ctx, SG[0] + SG[2] / 2, SG[1] + SG[2] / 2, 0, 260, [[0, rgba(P.accent, .22)], [1, rgba(P.accent, 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      ctx.fillStyle = P.bright_yellow; ctx.fillRect(lx - 18, ly - 4, 36, 8);
      bloom(ctx, x => { x.fillStyle = P.bright_yellow; x.fillRect(lx - 18, ly - 4, 36, 8); x.fillStyle = rgba(sign, .45); x.fillRect(SG[0], SG[1], SG[2], SG[2]); }, [50, 12], [.6, .3]);
    } else {
      ctx.fillStyle = radial(ctx, 300, -100, 100, 2000, [[0, rgba('#ffffff', .14)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, H);
    }

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .04);
  });

  // ---------- circuit/circuit-board ----------

  // Offsets a polyline of straight and 45 degree segments by d, with miter joins.
  function offsetLine(pts, d) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
      const n = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; return [-dy / l, dx / l]; };
      const n1 = i > 0 ? n(a, b) : n(b, c), n2 = i < pts.length - 1 ? n(b, c) : n1;
      let mx = n1[0] + n2[0], my = n1[1] + n2[1];
      const ml = Math.hypot(mx, my) || 1; mx /= ml; my /= ml;
      const k = d / Math.max(.3, mx * n1[0] + my * n1[1]);
      out.push([b[0] + mx * k, b[1] + my * k]);
    }
    return out;
  }

  // A circuit board seen from above: copper traces under green solder mask,
  // gold pads and vias, chips with tin legs, and resistors with color bands.
  scene('circuit', 'circuit-board', (ctx, P, r) => {
    const night = P.night;
    const nA = makeNoise(seedOf(r));
    const pr = rng(seedOf(r));
    const mask = night ? mixHex(P.background, P.green, .12) : mixHex(P.background, P.green, .3);
    const maskDark = night ? P.darker_background : mixHex(P.background, P.green, .42);
    const copper = night ? mixHex(P.background, P.green, .3) : mixHex(P.background, P.green, .18);
    const gold = night ? P.accent : withL(P.accent, .66), goldHi = night ? P.bright_blue : withL(P.accent, .86), goldLo = night ? mixHex(P.accent, P.brown, .5) : withL(P.accent, .48);
    const tin = night ? mixHex(P.foreground, P.muted, .3) : mixHex(P.foreground, '#ffffff', .62);
    const epoxy = night ? mixHex(P.darker_background, '#000000', .4) : mixHex(P.foreground, P.background, .18);
    const silk = night ? rgba(P.foreground, .65) : rgba('#ffffff', .9);
    const black = mixHex(P.darker_background, '#000000', .6), white = night ? P.bright_foreground : '#ffffff';
    const shadowOn = (blur, dx, dy, a) => { ctx.shadowColor = rgba('#000000', a); ctx.shadowBlur = blur * S; ctx.shadowOffsetX = dx * S; ctx.shadowOffsetY = dy * S; };
    const shadowOff = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0; };

    // ----- the board -----
    ctx.fillStyle = mask; ctx.fillRect(0, 0, W, H);
    put(ctx, bake(240, 135, (i, j, o) => { const v = fbm(nA, i / 30, j / 30, 4); o[0] = o[1] = o[2] = v > 0 ? 255 : 0; o[3] = Math.abs(v) * (night ? 30 : 40); }));
    ctx.fillStyle = linear(ctx, 0, 0, W, H, [[0, rgba('#ffffff', night ? .05 : .2)], [.5, rgba('#ffffff', 0)], [1, rgba('#000000', night ? .2 : .06)]]);
    ctx.fillRect(0, 0, W, H);
    // A ground plane: a fine hatch of copper in the calm middle.
    ctx.save(); ctx.beginPath(); ctx.roundRect(720, 420, 520, 300, 30); ctx.clip();
    ctx.strokeStyle = rgba(copper, .7); ctx.lineWidth = 2.2;
    for (let k = -400; k < 900; k += 14) { ctx.beginPath(); ctx.moveTo(720 + k, 420); ctx.lineTo(720 + k + 300, 720); ctx.stroke(); }
    ctx.restore();

    // ----- traces: bundles of parallel lines with 45 degree bends -----
    const traceAt = (pts, w) => {
      const line = (dx, dy, style, lw) => { ctx.strokeStyle = style; ctx.lineWidth = lw; ctx.beginPath(); pts.forEach(([x, y], i) => i ? ctx.lineTo(x + dx, y + dy) : ctx.moveTo(x + dx, y + dy)); ctx.stroke(); };
      line(1.2, 1.6, rgba('#000000', night ? .45 : .14), w);
      line(0, 0, copper, w);
      line(-.6, -.8, rgba('#ffffff', night ? .1 : .5), w * .3);
    };
    const vias = [];
    const bundle = (path, n, gap, w, endVia = true) => {
      ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
      for (let k = 0; k < n; k++) {
        const pts = offsetLine(path, (k - (n - 1) / 2) * gap);
        traceAt(pts, w);
        if (endVia) vias.push([...pts[pts.length - 1], w * .9 + 3]);
      }
    };
    // Paths are built from moves: [dx, dy] steps.
    const route = (x, y, steps) => { const pts = [[x, y]]; for (const [dx, dy] of steps) { x += dx; y += dy; pts.push([x, y]); } return pts; };
    bundle(route(470, 230, [[300, 0], [120, 120], [360, 0], [260, 260], [0, 300]]), 8, 20, 9);
    bundle(route(330, 470, [[0, 120], [160, 160], [380, 0], [100, 100], [300, 0]]), 6, 20, 9);
    bundle(route(470, 330, [[520, 0], [80, -80], [500, 0], [60, 60], [200, 0]]), 5, 18, 7);
    bundle(route(120, 1060, [[0, -60], [80, -80], [0, -260], [60, -60]]), 4, 20, 9, false);
    bundle(route(1780, 1050, [[0, -150], [-110, -110], [-300, 0]]), 3, 24, 12);
    bundle(route(1300, 80, [[0, 90], [70, 70], [160, 0]]), 4, 18, 7);
    bundle(route(900, 1080, [[0, -90], [-90, -90], [-260, 0], [-60, -60], [0, -60]]), 5, 18, 7);
    // A few lone traces that end in vias.
    for (let q = 0; q < 26; q++) {
      const x = 80 + pr() * 1760, y = 80 + pr() * 920;
      if (x > 680 && x < 1280 && y > 380 && y < 760) continue;
      const d = (pr() < .5 ? 1 : -1), len = 40 + pr() * 120;
      const pts = pr() < .5 ? route(x, y, [[len * d, 0], [40 * d, 40], [0, 30 + pr() * 60]]) : route(x, y, [[0, len], [40, 40 * d], [60 + pr() * 80, 0]]);
      traceAt(pts, 6); vias.push([...pts[0], 7]); vias.push([...pts[pts.length - 1], 7]);
    }

    // ----- vias and mounting holes -----
    const via = (x, y, rad) => {
      ctx.fillStyle = radial(ctx, x - rad * .3, y - rad * .3, 0, rad * 1.2, [[0, goldHi], [.6, gold], [1, goldLo]]);
      ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
      ctx.fillStyle = maskDark; ctx.beginPath(); circle(ctx, x, y, rad * .45); ctx.fill();
      ctx.fillStyle = rgba('#000000', .5); ctx.beginPath(); circle(ctx, x - rad * .1, y - rad * .1, rad * .38); ctx.fill();
    };
    vias.forEach(([x, y, rad]) => via(x, y, rad));
    for (const [x, y] of [[64, 64], [W - 64, 64], [64, H - 64], [W - 64, H - 64]]) {
      via(x, y, 30);
      ctx.strokeStyle = silk; ctx.lineWidth = 2; ctx.beginPath(); circle(ctx, x, y, 42); ctx.stroke();
    }

    // ----- gold fingers along the bottom edge -----
    for (let x = 240; x < 700; x += 34) {
      ctx.fillStyle = linear(ctx, x, 0, x + 22, 0, [[0, goldHi], [.5, gold], [1, goldLo]]);
      ctx.beginPath(); ctx.roundRect(x, 1010, 22, 90, 4); ctx.fill();
    }

    // ----- chips -----
    const chip = (x, y, w, h, pinsX, pinsY, pitch) => {
      // Tin legs, bent down to gold pads.
      const leg = (lx, ly, lw, lh) => {
        ctx.fillStyle = gold; ctx.fillRect(lx - 2, ly - 2, lw + 4, lh + 4);
        ctx.fillStyle = linear(ctx, lx, ly, lx + lw, ly + lh, [[0, white], [.4, tin], [1, mixHex(tin, '#000000', .35)]]); ctx.fillRect(lx, ly, lw, lh);
      };
      for (let k = 0; k < pinsX; k++) {
        const lx = x + w / 2 - (pinsX - 1) / 2 * pitch + k * pitch - 3.5;
        leg(lx, y - 26, 7, 26); leg(lx, y + h, 7, 26);
      }
      for (let k = 0; k < Math.abs(pinsY); k++) {
        const ly = y + h / 2 - (Math.abs(pinsY) - 1) / 2 * pitch + k * pitch - 3.5;
        leg(x - 26, ly, 26, 7); leg(x + w, ly, 26, 7);
      }
      shadowOn(16, 8, 12, night ? .7 : .4);
      ctx.fillStyle = epoxy; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
      shadowOff();
      ctx.fillStyle = linear(ctx, x, y, x + w, y + h, [[0, rgba('#ffffff', night ? .08 : .14)], [.5, rgba('#ffffff', 0)], [1, rgba('#000000', .2)]]);
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
      ctx.strokeStyle = rgba('#ffffff', night ? .12 : .2); ctx.lineWidth = 1.2; ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
      ctx.fillStyle = rgba('#000000', .45); ctx.beginPath(); circle(ctx, x + 18, y + 18, 7); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', night ? .1 : .2); ctx.beginPath(); circle(ctx, x + 19, y + 19, 4.5); ctx.fill();
      ctx.strokeStyle = silk; ctx.lineWidth = 2; ctx.strokeRect(x - 40, y - 40, w + 80, h + 80);
    };
    chip(214, 186, 232, 232, 16, 16, 13.5);
    chip(1110, 860, 170, 84, 8, 0, 20);
    chip(1360, 860, 170, 84, 8, 0, 20);

    // ----- a crystal and 2 electrolytic capacitors -----
    {
      const [x, y] = [640, 120];
      ctx.strokeStyle = silk; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x - 64, y - 30, 128, 60, 30); ctx.stroke();
      shadowOn(10, 5, 8, .5);
      ctx.fillStyle = linear(ctx, 0, y - 22, 0, y + 22, [[0, white], [.35, tin], [.7, mixHex(tin, '#000000', .3)], [1, tin]]);
      ctx.beginPath(); ctx.roundRect(x - 56, y - 22, 112, 44, 22); ctx.fill();
      shadowOff();
    }
    for (const [x, y, rad, sleeve] of [[1590, 196, 66, P.cyan], [1760, 210, 52, P.magenta]]) {
      ctx.strokeStyle = silk; ctx.lineWidth = 2; ctx.beginPath(); circle(ctx, x, y, rad + 10); ctx.stroke();
      ctx.save(); ctx.beginPath(); circle(ctx, x, y, rad + 10); ctx.clip();
      ctx.fillStyle = silk; ctx.fillRect(x - rad - 10, y - rad - 10, rad * .55, rad * 2 + 20);
      ctx.restore();
      shadowOn(24, 12, 18, night ? .7 : .4);
      ctx.fillStyle = night ? mixHex(sleeve, P.background, .3) : withL(sleeve, .5); ctx.beginPath(); circle(ctx, x, y, rad); ctx.fill();
      shadowOff();
      ctx.fillStyle = rgba(white, .6); ctx.beginPath(); ctx.arc(x, y, rad, Math.PI * .65, Math.PI * 1.35); ctx.arc(x, y, rad * .86, Math.PI * 1.35, Math.PI * .65, true); ctx.fill();
      const g = ctx.createConicGradient(-.8, x, y);
      [[0, white], [.15, tin], [.35, mixHex(tin, '#000000', .3)], [.5, white], [.65, tin], [.85, mixHex(tin, '#000000', .3)], [1, white]].forEach(([o, c]) => g.addColorStop(o, c));
      ctx.fillStyle = g; ctx.beginPath(); circle(ctx, x, y, rad * .84); ctx.fill();
      ctx.strokeStyle = rgba('#000000', .35); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - rad * .5, y); ctx.lineTo(x + rad * .5, y); ctx.moveTo(x, y - rad * .5); ctx.lineTo(x, y + rad * .5); ctx.stroke();
    }

    // ----- resistors with color bands -----
    const BANDS = [black, P.brown, P.red, P.orange, P.yellow, P.green, P.cyan, P.magenta, mixHex(P.muted, P.foreground, .3), white];
    const bodyTan = night ? mixHex(P.yellow, P.foreground, .45) : mixHex(withL(P.yellow, .82), '#ffffff', .2);
    const bodyBlue = night ? mixHex(P.cyan, P.foreground, .35) : withL(P.cyan, .76);
    const resistor = (x, y, len, vertical, digits) => {
      ctx.save(); ctx.translate(x, y); if (vertical) ctx.rotate(Math.PI / 2);
      const L = len, bw = L * .5, bh = 27;
      // Pads, leads, then the body on a soft shadow.
      for (const sx of [-1, 1]) { via(sx * L / 2, 0, 11); }
      ctx.strokeStyle = tin; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(-L / 2, 0); ctx.lineTo(L / 2, 0); ctx.stroke();
      ctx.strokeStyle = rgba('#ffffff', .6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(-L / 2, -1); ctx.lineTo(L / 2, -1); ctx.stroke();
      const body = c => { c.beginPath(); c.moveTo(-bw / 2 + 8, -bh / 2); c.lineTo(bw / 2 - 8, -bh / 2); c.arc(bw / 2 - 8, 0, bh / 2, -Math.PI / 2, Math.PI / 2); c.lineTo(-bw / 2 + 8, bh / 2); c.arc(-bw / 2 + 8, 0, bh / 2, Math.PI / 2, Math.PI * 1.5); c.closePath(); };
      shadowOn(10, vertical ? 8 : 5, vertical ? -5 : 8, night ? .6 : .35);
      const tone = digits.length > 4 ? bodyBlue : bodyTan;
      body(ctx); ctx.fillStyle = tone; ctx.fill();
      shadowOff();
      ctx.save(); body(ctx); ctx.clip();
      digits.forEach((d, i) => {
        const bx = -bw / 2 + 12 + i * (bw - 24) / (digits.length - .5) + (i === digits.length - 1 ? 6 : 0);
        ctx.fillStyle = d === 'g' ? gold : BANDS[d]; ctx.fillRect(bx, -bh / 2, 7.5, bh);
      });
      ctx.fillStyle = linear(ctx, 0, -bh / 2, 0, bh / 2, [[0, rgba('#ffffff', .45)], [.3, rgba('#ffffff', .1)], [.6, rgba('#000000', 0)], [1, rgba('#000000', .35)]]);
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh);
      ctx.restore();
      ctx.restore();
    };
    const pick = () => { const n = pr() < .3 ? 5 : 4, d = []; for (let i = 0; i < n - 1; i++) d.push(Math.floor(pr() * 10)); d.push('g'); if (d[0] === 0) d[0] = 1 + Math.floor(pr() * 9); return d; };
    for (let k = 0; k < 6; k++) resistor(1670, 400 + k * 66, 176, false, pick());
    for (let k = 0; k < 4; k++) resistor(150 + k * 66, 760, 176, true, pick());
    resistor(1000, 180, 160, false, pick());
    resistor(980, 980, 160, false, pick());

    // ----- small surface parts and lights -----
    const smd = (x, y, vertical, col) => {
      ctx.save(); ctx.translate(x, y); if (vertical) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = gold; ctx.fillRect(-15, -8, 8, 16); ctx.fillRect(7, -8, 8, 16);
      shadowOn(4, 2, 3, .45);
      ctx.fillStyle = col; ctx.fillRect(-10, -6, 20, 12);
      shadowOff();
      ctx.fillStyle = tin; ctx.fillRect(-12, -6, 4, 12); ctx.fillRect(8, -6, 4, 12);
      ctx.restore();
    };
    for (let k = 0; k < 7; k++) smd(1150 + k * 36, 800, true, night ? mixHex(P.brown, P.yellow, .3) : withL(P.brown, .6));
    for (let k = 0; k < 5; k++) smd(560, 420 + k * 34, false, epoxy);
    const leds = [[1440, 640, P.red], [1440, 690, P.green], [1440, 740, P.cyan]];
    leds.forEach(([x, y, c]) => smd(x, y, false, night ? c : withL(c, .6)));
    if (night) bloom(ctx, x => leds.forEach(([px, py, c]) => { x.fillStyle = c; x.fillRect(px - 10, py - 6, 20, 12); }), [26, 8], [.8, .7]);

    // The glossy solder mask mirrors a broad soft light.
    ctx.save(); ctx.translate(760, 300); ctx.rotate(-.5);
    ctx.fillStyle = linear(ctx, 0, -260, 0, 260, [[0, rgba('#ffffff', 0)], [.5, rgba('#ffffff', night ? .06 : .16)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); ctx.ellipse(0, 0, 1400, 260, 0, 0, TAU); ctx.fill();
    ctx.restore();

    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .045 : .035);
  });

  // A color as [r, g, b] numbers.
  function C(hex) { return rgb(hex); }
})();
