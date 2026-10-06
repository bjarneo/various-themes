// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Landscapes, skies, an ice cave and a forge.
(() => {
  const TAU = Math.PI * 2;

  // ---------- local helpers ----------

  // The hue of a palette color at another OKLCH lightness, with chroma times cx.
  const tone = (hex, L, cx = 1) => { const o = toOklch(hex); return oklch(L, o.C * cx, o.h); };
  const rand = (r, a, b) => a + (b - a) * r();
  const seedOf = r => Math.floor(r() * 2 ** 31);

  // A canvas that covers the logical frame plus a margin, at scale pixels per unit.
  function canvasAt(scale, pad = 0) {
    const c = document.createElement('canvas');
    c.width = Math.ceil((W + 2 * pad) * scale); c.height = Math.ceil((H + 2 * pad) * scale);
    const x = c.getContext('2d');
    x.scale(scale, scale); x.translate(pad, pad);
    return [c, x];
  }

  // Draws on a small canvas, blurs it and lays it over ctx. Good for glows and mist.
  function soft(ctx, draw, { scale = .25, blur = 0, alpha = 1, op = 'source-over' } = {}) {
    const pad = Math.ceil(blur * 2.5);
    const [c, x] = canvasAt(scale, pad);
    draw(x);
    let src = c;
    if (blur > 0) {
      const b = document.createElement('canvas'); b.width = c.width; b.height = c.height;
      const bx = b.getContext('2d'); bx.filter = `blur(${(blur * scale).toFixed(2)}px)`; bx.drawImage(c, 0, 0); src = b;
    }
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'medium';
    ctx.drawImage(src, -pad, -pad, W + 2 * pad, H + 2 * pad); ctx.restore();
  }

  function blit(ctx, c, alpha = 1, op = 'source-over') {
    ctx.save(); ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, 0, 0, W, H); ctx.restore();
  }

  // Clouds from a density function, lit from one side. The texture covers box
  // at d pixels per unit. dens returns a value above 0 inside a cloud. lx and ly
  // give an offset toward the light. edge sets how soft the rims are.
  function clouds(ctx, box, d, dens, { lx = -6, ly = -10, lit, shade, rim, alpha = 1, edge = .12, gain = 6 }) {
    const [x0, y0, x1, y1] = box, tw = Math.ceil((x1 - x0) * d), th = Math.ceil((y1 - y0) * d);
    const c = document.createElement('canvas'); c.width = tw; c.height = th;
    const cx = c.getContext('2d'), img = cx.createImageData(tw, th), D = img.data;
    const L = rgb(lit), Sh = rgb(shade), R = rgb(rim || lit);
    for (let j = 0; j < th; j++) for (let i = 0; i < tw; i++) {
      const x = x0 + (i + .5) / d, y = y0 + (j + .5) / d, v = dens(x, y);
      const q = (j * tw + i) * 4;
      if (v <= 0) { D[q + 3] = 0; continue; }
      const t = clamp(.5 + (v - dens(x + lx, y + ly)) * gain, 0, 1), a = smooth(clamp(v / edge, 0, 1));
      // Thin parts near the rim take the rim color, as light shines through them.
      const thin = 1 - clamp(v / (edge * 2.5), 0, 1);
      for (let k = 0; k < 3; k++) D[q + k] = lerp(lerp(Sh[k], L[k], t), R[k], thin * t);
      D[q + 3] = a * alpha * 255;
    }
    cx.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(c, x0, y0, x1 - x0, y1 - y0); ctx.restore();
  }

  // A round glow with a soft falloff.
  function glow(ctx, x, y, rad, color, a = 1, op = 'source-over') {
    ctx.save(); ctx.globalCompositeOperation = op;
    ctx.fillStyle = radial(ctx, x, y, 0, rad, [[0, rgba(color, a)], [.15, rgba(color, a * .6)], [.4, rgba(color, a * .22)], [.7, rgba(color, a * .06)], [1, rgba(color, 0)]]);
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore();
  }

  // Points of a lumpy closed shape. bumps sets how many lobes the outline has.
  function blobPts(r, cx, cy, rx, ry, n = 16, rough = .15, bumps = 0, rot = 0) {
    const pts = [], p1 = r() * TAU, p2 = r() * TAU;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU;
      let k = 1 + rough * (Math.sin(a * 2 + p1) * .5 + Math.sin(a * 3 + p2) * .35 + (r() - .5) * .5);
      if (bumps) k *= 1 - .12 * Math.abs(Math.sin(a * bumps * .5 + p1));
      const px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
      pts.push([cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
    return pts;
  }
  function fillBlob(ctx, pts, fill) { ctx.fillStyle = fill; ctx.beginPath(); smoothPath(ctx, pts, true); ctx.fill(); }

  // Points on a cubic Bezier curve.
  function bez(p0, p1, p2, p3, n = 16) {
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
    }
    return out;
  }
  // A filled stroke along pts. The width runs from w0 to w1.
  function taper(ctx, pts, w0, w1) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let dx = b[0] - a[0], dy = b[1] - a[1];
      const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
      const w = lerp(w0, w1, i / (n - 1)) / 2;
      L.push([p[0] - dy * w, p[1] + dx * w]); R.push([p[0] + dy * w, p[1] - dx * w]);
    }
    ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
  }

  // Draws the part of src above y0 upside down below y0, as a reflection.
  // src is a canvas at output size. wave moves rows sideways, as ripples do.
  function mirror(ctx, src, y0, { wave = 0, strip = 2, phase = 0, alpha = 1 } = {}) {
    const s = src.width / W;
    if (src === ctx.canvas) {
      // Copy the part above the water once, so the strips do not each copy the whole canvas.
      const c = document.createElement('canvas'); c.width = src.width; c.height = Math.ceil(y0 * s);
      c.getContext('2d').drawImage(src, 0, 0); src = c;
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, y0, W, H - y0); ctx.clip();
    ctx.globalAlpha = alpha;
    ctx.translate(0, 2 * y0); ctx.scale(1, -1);
    if (!wave) ctx.drawImage(src, 0, 0, src.width, Math.floor(y0 * s), 0, 0, W, Math.floor(y0 * s) / s);
    else {
      for (let y = y0; y > 2 * y0 - H - strip; y -= strip) {
        const d = (y0 - y) / (H - y0);
        const off = (Math.sin(y * .83 + phase) * .55 + Math.sin(y * .19 + phase * 2.3) * .45) * wave * (.2 + d * 1.4);
        const sy = Math.max(0, y - strip - .6);
        if (y <= 0) break;
        ctx.drawImage(src, 0, sy * s, src.width, (y - sy) * s, off, sy, W, y - sy);
      }
    }
    ctx.restore();
  }

  // Horizontal glints on water: short strokes, longer and wider near the viewer.
  function ripples(ctx, r, y0, y1, count, color, alpha, x0 = 0, x1 = W) {
    ctx.save(); ctx.strokeStyle = color; ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const t = r() ** 1.6, y = lerp(y0, y1, t), x = lerp(x0, x1, r());
      const len = lerp(8, 90, t) * (.4 + r());
      ctx.globalAlpha = alpha * (.3 + r() * .7);
      ctx.lineWidth = lerp(.6, 2.2, t);
      ctx.beginPath(); ctx.moveTo(x - len / 2, y); ctx.lineTo(x + len / 2, y); ctx.stroke();
    }
    ctx.restore();
  }

  // A crown of foliage clumps inside an ellipse. lx and ly point toward the light.
  // leaves adds that many small leaves on the lit side of each clump.
  function crown(ctx, r, cx, cy, rx, ry, count, rad, C, lx = -.6, ly = -.8, leaves = 0) {
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * .84;
      list.push([cx + Math.cos(a) * d * rx, cy + Math.sin(a) * d * ry, rad * (.55 + r() * .6)]);
    }
    list.sort((p, q) => p[1] - q[1]);
    fillBlob(ctx, blobPts(r, cx, cy + ry * .08, rx * .8, ry * .7, 18, .12), C.dark);
    const la = Math.atan2(ly, lx);
    for (const [x, y, k] of list) {
      const depth = clamp((y - (cy - ry)) / (2 * ry), 0, 1);
      const g = ctx.createLinearGradient(x + lx * k, y + ly * k, x - lx * k * .8, y - ly * k * .8);
      g.addColorStop(0, mixHex(C.lit, C.base, depth * .55));
      g.addColorStop(.5, C.base);
      g.addColorStop(1, C.dark);
      fillBlob(ctx, blobPts(r, x, y, k, k * .82, 22, .1, 9), g);
      if (leaves) {
        ctx.beginPath();
        for (let j = 0; j < leaves; j++) {
          const a = la + rand(r, -1.4, 1.4), d = rand(r, .45, 1);
          leaf(ctx, x + Math.cos(a) * k * d, y + Math.sin(a) * k * .82 * d, k * rand(r, .16, .3), k * rand(r, .05, .09), a + rand(r, -1, 1));
        }
        ctx.fillStyle = mixHex(C.lit, C.base, .2 + depth * .5); ctx.globalAlpha = .6; ctx.fill(); ctx.globalAlpha = 1;
      }
    }
  }

  // Centers of leaf clusters inside an ellipse. Clusters keep a minimum distance,
  // and holes stay empty, so the background shows through the crown.
  function crownPoints(r, cx, cy, rx, ry, count, minD, holes = 0) {
    const gaps = [];
    for (let i = 0; i < holes; i++) { const a = r() * TAU, d = rand(r, .2, .6); gaps.push([cx + Math.cos(a) * rx * d, cy + Math.sin(a) * ry * d, Math.min(rx, ry) * rand(r, .2, .32)]); }
    const pts = [];
    for (let tries = 0; tries < count * 14 && pts.length < count; tries++) {
      const a = r() * TAU, d = Math.sqrt(r()), x = cx + Math.cos(a) * d * rx, y = cy + Math.sin(a) * d * ry;
      if (gaps.some(([gx, gy, gr]) => Math.hypot(x - gx, (y - gy) * 1.3) < gr)) continue;
      if (pts.some(([px, py]) => Math.hypot(x - px, y - py) < minD)) continue;
      pts.push([x, y, rand(r, .6, 1.3)]);
    }
    return pts;
  }

  // Many small leaf clusters, each with a shade side, a light side and small
  // leaves on its rim. lx and ly point toward the light. The clusters draw from
  // the top to the bottom in 3 bands, so lower clusters overlap upper ones.
  // round draws the rim leaves as round dabs instead of pointed leaves.
  function leafClusters(x, r, pts, size, C, lx, ly, leaves = 6, round = false) {
    pts = [...pts].sort((a, b) => a[1] - b[1]);
    const per = Math.ceil(pts.length / 3);
    for (let b = 0; b < 3; b++) {
      const shade = new Path2D(), mid = new Path2D(), light = new Path2D(), leafLit = new Path2D(), leafDark = new Path2D();
      for (const [cx, cy, k] of pts.slice(b * per, (b + 1) * per)) {
        const cr = size * k;
        smoothPath(shade, blobPts(r, cx - lx * cr * .14, cy - ly * cr * .14, cr, cr * .74, 11, .35), true);
        smoothPath(mid, blobPts(r, cx + lx * cr * .08, cy + ly * cr * .08, cr * .84, cr * .6, 11, .35), true);
        smoothPath(light, blobPts(r, cx + lx * cr * .3, cy + ly * cr * .3, cr * .66, cr * .4, 10, .35), true);
        for (let i = 0; i < leaves; i++) {
          const a = r() * TAU, d = cr * rand(r, .35, .85), lit = Math.cos(a) * lx + Math.sin(a) * ly > 0;
          if (round) ellipse(lit ? leafLit : leafDark, cx + Math.cos(a) * d * 1.05, cy + Math.sin(a) * d * .8, cr * rand(r, .2, .32), cr * rand(r, .14, .22), a);
          else leaf(lit ? leafLit : leafDark, cx + Math.cos(a) * d, cy + Math.sin(a) * d * .74, cr * rand(r, .5, .85), cr * rand(r, .06, .1), a + rand(r, -.45, .45));
        }
      }
      x.fillStyle = C.dark; x.fill(shade);
      x.fillStyle = mixHex(C.dark, C.base, .5); x.fill(leafDark);
      x.fillStyle = C.base; x.fill(mid);
      x.fillStyle = mixHex(C.base, C.lit, .55); x.fill(leafLit);
      x.fillStyle = C.lit; x.fill(light);
    }
  }

  // ---------- landscape/mangrove ----------

  // A mangrove: prop roots that arch into the water, a short trunk and a wide crown.
  // Roots behind the trunk come first and darker. lx points toward the light.
  function mangrove(ctx, r, x, yW, s, C, lx, leaves = 4) {
    const knot = yW - 170 * s, fronts = [];
    const root = (pts, w0, w1, col, cap = true) => {
      if (C.rim) {
        const k = pts.length > 10 ? 4 : 0;
        ctx.fillStyle = C.rim; ctx.globalAlpha = .55; ctx.beginPath(); ctx.save(); ctx.translate(lx * 1.2 * s, -1.2 * s); taper(ctx, pts.slice(k), lerp(w0, w1, k / pts.length), w1); ctx.restore(); ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = col; ctx.beginPath(); taper(ctx, pts, w0, w1); if (cap) circle(ctx, pts[0][0], pts[0][1], w0 / 2); ctx.fill();
    };
    for (const back of [true, false]) {
      const count = back ? 12 : 18;
      for (let i = 0; i < count; i++) {
        const h = r() ** .9, dir = r() < .5 ? -1 : 1;
        const sy = yW - (95 + 175 * h) * s, sx = x + dir * rand(r, 0, 8) * s;
        const ey = yW + (back ? rand(r, -8, 0) : rand(r, 0, 16)) * s;
        const reach = (yW - sy) * rand(r, .45, 1.7) * dir;
        const lift = rand(r, -6, 24) * s;
        const pts = bez([sx, sy], [sx + reach * rand(r, .25, .5), sy - lift], [sx + reach * rand(r, .75, .95), sy + (ey - sy) * rand(r, .12, .5)], [sx + reach, ey], 22);
        const col = back ? C.rootBack : C.root;
        root(pts, 10 * s, 4.5 * s, col);
        if (!back) fronts.push(pts);
        if (r() < .5) {
          const m = pts[Math.floor(rand(r, 6, 12))], d2 = reach * rand(r, -.3, .5) + dir * 20 * s;
          root(bez(m, [m[0] + d2 * .4, m[1] - 6 * s], [m[0] + d2 * .85, m[1] + (ey - m[1]) * .35], [m[0] + d2, ey + rand(r, -4, 8) * s], 14), 6 * s, 3.5 * s, col);
        }
      }
      if (back) {
        // The trunk rises from the root knot and forks into the crown.
        const tx = x + rand(r, -20, 20) * s;
        root(bez([tx, yW - 310 * s], [tx, knot - 90 * s], [x, knot - 40 * s], [x, yW - 80 * s], 16), 22 * s, 13 * s, C.root, false);
        for (let i = 0; i < 4; i++) {
          const ex = tx + rand(r, -170, 170) * s, ey = yW - rand(r, 360, 420) * s;
          root(bez([tx, yW - 290 * s], [tx + (ex - tx) * .2, yW - 330 * s], [ex, ey + 60 * s], [ex, ey], 14), 18 * s, 6 * s, C.root);
        }
      }
    }
    // Aerial roots that hang from the branches.
    ctx.strokeStyle = C.root; ctx.lineCap = 'round';
    for (let i = 0; i < 8; i++) {
      const ax = x + rand(r, -250, 250) * s, ay = yW - rand(r, 330, 370) * s, len = rand(r, 60, 330) * s;
      ctx.lineWidth = rand(r, 1.4, 2.8) * s;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.quadraticCurveTo(ax + rand(r, -14, 14) * s, ay + len * .5, ax + rand(r, -8, 8) * s, Math.min(ay + len, yW)); ctx.stroke();
    }
    crown(ctx, r, x + 10 * s, yW - 450 * s, 330 * s, 125 * s, 90, 46 * s, C, lx, -.75, leaves);
    return fronts;
  }

  // A small crab, seen from the front, that sits on the point cx, cy.
  function crab(x, cx, cy, s, body, dark) {
    x.strokeStyle = body; x.lineCap = 'round'; x.lineWidth = 1.6 * s;
    for (const k of [-1, 1]) for (let i = 0; i < 3; i++) {
      x.beginPath(); x.moveTo(cx + k * 5 * s, cy - 2 * s); x.quadraticCurveTo(cx + k * (10 + i * 3) * s, cy - (7 - i * 2) * s, cx + k * (12 + i * 3) * s, cy + (2 + i) * s); x.stroke();
    }
    x.lineWidth = 2.2 * s;
    for (const k of [-1, 1]) { x.beginPath(); x.moveTo(cx + k * 6 * s, cy - 5 * s); x.quadraticCurveTo(cx + k * 12 * s, cy - 13 * s, cx + k * 9 * s, cy - 16 * s); x.stroke(); }
    x.fillStyle = body;
    for (const k of [-1, 1]) { x.beginPath(); ellipse(x, cx + k * 9 * s, cy - 17 * s, 3.6 * s, 2.6 * s, k * .5); x.fill(); }
    x.beginPath(); ellipse(x, cx, cy - 5 * s, 8 * s, 5 * s); x.fill();
    x.fillStyle = dark;
    for (const k of [-1, 1]) { x.beginPath(); circle(x, cx + k * 2.5 * s, cy - 10.5 * s, 1.1 * s); x.fill(); }
  }

  scene('landscape', 'mangrove', (ctx, P, r) => {
    const N = P.night, yW = 655;
    const sky = N
      ? [[0, tone(P.cyan, .14, .35)], [.45, tone(P.cyan, .21, .4)], [.82, mixHex(tone(P.cyan, .3, .4), tone(P.yellow, .44, .45), .45)], [1, tone(P.yellow, .47, .45)]]
      : [[0, tone(P.cyan, .8, .35)], [.5, tone(P.cyan, .9, .22)], [.85, mixHex(P.background, '#ffffff', .4)], [1, mixHex(tone(P.yellow, .93, .3), '#ffffff', .3)]];
    skyGradient(ctx, sky, 0, yW);
    const mx = 1180, my = N ? 170 : 200;
    if (N) {
      stars(ctx, r, 160, [0, 0, W, yW * .62], [P.foreground, P.bright_yellow], 1.4);
      glow(ctx, mx, my, 620, tone(P.yellow, .62, .5), .3);
      glow(ctx, mx, my, 150, P.bright_yellow, .35);
      ctx.fillStyle = tone(P.bright_yellow, .95, .45); ctx.beginPath(); circle(ctx, mx, my, 32); ctx.fill();
    } else {
      glow(ctx, mx, my, 760, '#ffffff', .7);
      glow(ctx, mx, my, 170, '#ffffff', .8);
    }
    // Soft bands of humid haze.
    soft(ctx, x => {
      for (let i = 0; i < 10; i++) {
        x.fillStyle = rgba(N ? tone(P.cyan, .45, .4) : '#ffffff', N ? .1 : .45);
        x.beginPath(); ellipse(x, rand(r, 0, W), rand(r, 140, yW - 30), rand(r, 300, 760), rand(r, 10, 30)); x.fill();
      }
    }, { scale: .25, blur: 22 });

    // Far shores of mangrove forest, hazy with distance.
    const n = makeNoise(seedOf(r));
    const shore = (amp, f, sh, col, step = 5) => {
      const pts = [];
      for (let x = -20; x <= W + 20; x += step) {
        const big = fbm(n, x * f + sh, sh, 3) * .5 + .5;
        const bump = Math.abs(Math.sin(x * .045 + sh)) * .35 + Math.abs(Math.sin(x * .11 + sh * 3)) * .2;
        pts.push([x, yW + 2 - amp * (.35 + big * .9 + bump * .4)]);
      }
      fillRidge(ctx, pts, col);
    };
    const haze = sky[sky.length - 1][1];
    shore(40, .002, 3, mixHex(haze, N ? tone(P.accent, .2, .5) : tone(P.green, .62, .45), N ? .45 : .35));
    shore(26, .004, 9, mixHex(haze, N ? tone(P.accent, .17, .5) : tone(P.green, .5, .45), N ? .7 : .55));

    // The near trees go on their own layer, so the water can mirror them.
    const [T, tx] = layer();
    const C = N
      ? { rootBack: tone(P.magenta, .11, .3), root: tone(P.magenta, .16, .35), rim: tone(P.yellow, .42, .4), dark: tone(P.accent, .1, .5), base: tone(P.accent, .17, .55), lit: tone(P.green, .38, .55) }
      : { rootBack: tone(P.magenta, .36, .5), root: tone(P.magenta, .45, .55), rim: tone(P.yellow, .8, .35), dark: tone(P.green, .36, .7), base: tone(P.green, .5, .65), lit: tone(P.yellow, .78, .5) };
    const fade = (k) => Object.fromEntries(Object.entries(C).map(([key, v]) => [key, mixHex(v, haze, k)]));
    mangrove(tx, r, 790, yW, .3, { ...fade(.62), rim: null }, .8, 0);
    mangrove(tx, r, 1010, yW, .42, { ...fade(.48), rim: null }, .8, 0);
    mangrove(tx, r, 1730, yW, 1.1, C, -.8);
    const roots = mangrove(tx, r, 250, yW, 1.28, C, .8);
    // A crab climbs one of the front roots.
    const perch = roots.map(p => p[13]).filter(([x, y]) => x > 330 && x < 640 && y > 470 && y < 630)[0];
    if (perch) crab(tx, perch[0], perch[1] - 4, 1.3, N ? tone(P.red, .46, .7) : P.red, N ? tone(P.red, .12, .4) : tone(P.red, .25, .5));
    if (N) {
      // Fireflies in the crowns.
      for (let i = 0; i < 80; i++) {
        const left = r() < .55, fx = left ? rand(r, 0, 660) : rand(r, 1400, W), fy = rand(r, 60, yW - 30);
        glow(tx, fx, fy, rand(r, 8, 18), P.yellow, .5);
        tx.fillStyle = P.bright_yellow; tx.beginPath(); circle(tx, fx, fy, rand(r, .8, 1.8)); tx.fill();
      }
    }

    // Water: a base color, the sky and trees mirrored, then a tint that deepens toward the viewer.
    ctx.fillStyle = linear(ctx, 0, yW, 0, H, N
      ? [[0, tone(P.cyan, .3, .4)], [1, tone(P.cyan, .12, .4)]]
      : [[0, tone(P.cyan, .88, .25)], [1, tone(P.cyan, .66, .4)]]);
    ctx.fillRect(0, yW, W, H - yW);
    mirror(ctx, ctx.canvas, yW, { wave: 1.5, strip: 3, phase: 1, alpha: .85 });
    mirror(ctx, T, yW, { wave: 3, strip: 3, phase: 2, alpha: N ? .8 : .6 });
    ctx.fillStyle = linear(ctx, 0, yW, 0, H, N
      ? [[0, rgba(tone(P.cyan, .2, .5), .08)], [1, rgba(tone(P.cyan, .1, .5), .5)]]
      : [[0, rgba(tone(P.cyan, .8, .4), .08)], [1, rgba(tone(P.cyan, .58, .5), .4)]]);
    ctx.fillRect(0, yW, W, H - yW);
    // The moon or sun on the water.
    ctx.save(); ctx.beginPath(); ctx.rect(0, yW, W, H - yW); ctx.clip();
    glow(ctx, mx, yW + 40, 320, N ? tone(P.yellow, .6, .5) : '#ffffff', N ? .22 : .5);
    ripples(ctx, r, yW + 4, H, 240, N ? P.bright_yellow : '#ffffff', N ? .5 : .85, mx - 120, mx + 120);
    ripples(ctx, r, yW + 4, H, 240, N ? tone(P.cyan, .6, .4) : '#ffffff', N ? .16 : .45);
    ctx.restore();
    blit(ctx, T);

    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });
  // ---------- landscape/fjord ----------

  // An aurora: curtains of vertical rays along a wavy base line.
  function aurora(ctx, r, P, y0, amp, alpha = 1) {
    const n = makeNoise(seedOf(r));
    const curtains = [[y0, 0], [y0 - 60, 40], [y0 + 50, 80]];
    const draw = (x, step) => {
      x.globalCompositeOperation = 'lighter';
      curtains.forEach(([cy, sh], ci) => {
        for (let px = -40; px < W + 40; px += step) {
          const b = cy + Math.sin(px * .0019 + sh) * amp + fbm(n, px * .0014, sh, 3) * amp * 1.4;
          let k = clamp(fbm(n, px * .005, 7 + sh, 4) * 1.1 + .45, 0, 1) * clamp(fbm(n, px * .0012, 1.7 + sh, 2) * 1.6 + .55, 0, 1);
          k *= ci === 0 ? 1 : .55;
          if (k < .02) continue;
          const len = 110 + 240 * (fbm(n, px * .007, 11 + sh, 3) * .5 + .5);
          const g = x.createLinearGradient(0, b + 14, 0, b - len);
          g.addColorStop(0, rgba(P.green, 0));
          g.addColorStop(.07, rgba(P.bright_green, Math.min(1, 1.2 * k)));
          g.addColorStop(.3, rgba(P.green, .6 * k));
          g.addColorStop(.7, rgba(P.cyan, .14 * k));
          g.addColorStop(.88, rgba(P.magenta, .1 * k));
          g.addColorStop(1, rgba(P.magenta, 0));
          x.fillStyle = g; x.fillRect(px, b - len, step * .9, len + 14);
        }
      });
    };
    soft(ctx, x => draw(x, 8), { scale: .2, blur: 34, alpha: .55 * alpha, op: 'lighter' });
    soft(ctx, x => draw(x, 2.5), { scale: .5, blur: 2, alpha: alpha, op: 'lighter' });
  }

  // A rocky line from a to b by midpoint displacement.
  function rocky(r, a, b, rough, depth = 4) {
    let pts = [a, b];
    for (let d = 0; d < depth; d++) {
      const out = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const p = pts[i - 1], q = pts[i], len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
        const off = (r() - .5) * len * rough;
        out.push([(p[0] + q[0]) / 2 - (q[1] - p[1]) / len * off, (p[1] + q[1]) / 2 + (q[0] - p[0]) / len * off], q);
      }
      pts = out;
    }
    return pts;
  }
  // The y of a polyline at x. The polyline runs from left to right.
  function yAt(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return lerp(y0, y1, x1 === x0 ? 0 : (x - x0) / (x1 - x0));
    }
    return pts[pts.length - 1][1];
  }

  // A snowy mountain range. Ridges run down from the peaks and split each
  // mountain into a lit face and a shaded face. Snow caps the peaks and
  // runs down the gullies. o.start and o.end are the ends of the outline,
  // o.light is -1 for light from the left and 1 for light from the right.
  function range(x, r, o) {
    const C = o.C, pk = o.peaks, base = o.base, v = [o.start];
    for (let i = 0; i < pk.length - 1; i++) {
      const a = pk[i], b = pk[i + 1];
      v.push([lerp(a[0], b[0], rand(r, .38, .62)), Math.max(a[1], b[1]) + rand(r, .2, .45) * Math.abs(b[0] - a[0]) * .7]);
    }
    v.push(o.end);
    const contour = [];
    for (let i = 0; i < pk.length; i++) {
      const s1 = rocky(r, v[i], pk[i], o.rough, 5), s2 = rocky(r, pk[i], v[i + 1], o.rough, 5);
      contour.push(...(i ? s1.slice(1) : s1), ...s2.slice(1));
    }
    const outline = () => { x.beginPath(); poly(x, [...contour, [o.end[0], base + 3], [o.start[0], base + 3]]); };
    const down = (p, drift) => rocky(r, p, [p[0] + drift, base + 3], .1, 4);
    const ridges = pk.map(p => down(p, rand(r, -.2, .2) * (base - p[1])));
    const gullies = v.map((p, i) => (i === 0 || i === v.length - 1) ? [p, [p[0], base + 3]] : down(p, rand(r, -.15, .15) * (base - p[1])));
    // The shaded face of each peak lies on the side away from the light.
    const faces = pk.map((p, i) => {
      const ci = contour.indexOf(p);
      if (o.light < 0) {
        const cj = contour.indexOf(v[i + 1]);
        return [...contour.slice(ci, cj + 1), ...gullies[i + 1].slice(1), ...[...ridges[i]].reverse()];
      }
      const cj = contour.indexOf(v[i]);
      return [...contour.slice(cj, ci + 1), ...ridges[i].slice(1), ...[...gullies[i]].reverse()];
    });
    const top = Math.min(...pk.map(p => p[1]));
    outline(); x.fillStyle = linear(x, 0, top, 0, base, [[0, C.lit], [1, C.litLow || C.lit]]); x.fill();
    x.save(); outline(); x.clip();
    x.fillStyle = linear(x, 0, top, 0, base, [[0, C.shade], [1, C.shadeLow || C.shade]]);
    faces.forEach(f => { x.beginPath(); poly(x, f); x.fill(); });
    // Snow caps with teeth that reach down the gullies.
    const caps = pk.map((p, i) => {
      const l = v[i][0], rr = v[i + 1][0], depth = o.snow * (base - p[1]), pts = [];
      const steps = Math.max(6, Math.round((rr - l) / (15 * o.scale + 5)));
      for (let k = 0; k <= steps; k++) {
        const t = k / steps, px = lerp(l, rr, t) + (k && k < steps ? rand(r, -4, 4) : 0), bell = Math.exp(-(((px - p[0]) / ((rr - l) * .28)) ** 2));
        let dy = depth * (.06 + .62 * bell) * (k % 2 ? rand(r, .75, 1.5) : rand(r, .25, .65));
        if (k % 2 && r() < .3) dy += depth * rand(r, .3, .8) * bell;
        pts.push([px, yAt(contour, px) + dy]);
      }
      const ci = contour.indexOf(v[i]), cj = contour.indexOf(v[i + 1]);
      return [...contour.slice(ci, cj + 1).map(([px, py]) => [px, py - 2]), ...pts.reverse()];
    });
    const snow = new Path2D();
    caps.forEach(c => poly(snow, c));
    // Streaks of snow in the gullies below the caps.
    caps.forEach(c => {
      const n = Math.round(o.streaks * rand(r, .6, 1.4));
      for (let k = 0; k < n; k++) {
        const q = c[Math.floor(rand(r, c.length * .55, c.length))], len = rand(r, .15, .55) * (base - q[1]) * o.snow * 1.6, w = rand(r, 2, 6) * o.scale;
        taper(snow, rocky(r, [q[0], q[1] - 4], [q[0] + rand(r, -.25, .25) * len, q[1] + len], .12, 3), w, .4);
      }
    });
    x.fillStyle = C.snow; x.fill(snow);
    x.save(); x.beginPath(); faces.forEach(f => poly(x, f)); x.clip();
    x.fillStyle = C.snowShade; x.fill(snow);
    x.restore();
    x.restore();
    return { contour, faces, caps };
  }

  // Mist that gathers over the water at the foot of a layer. It covers only what the layer holds.
  function footMist(x, base, h, col, a) {
    x.save(); x.globalCompositeOperation = 'source-atop';
    x.fillStyle = linear(x, 0, base - h, 0, base, [[0, rgba(col, 0)], [1, rgba(col, a)]]); x.fillRect(-40, base - h, W + 80, h + 4);
    x.restore();
  }

  // A band of conifers along a shore. The top edge is a row of tree tips.
  function treeline(x, r, x0, x1, base, h, col, snowCol, size = 1) {
    const pts = [[x0, base + 2]];
    let px = x0;
    while (px < x1) {
      const w = rand(r, 7, 14) * size, th = h * rand(r, .55, 1) + rand(r, 0, 14) * size;
      pts.push([px + w * .1, base - th * .55], [px + w * .5, base - th], [px + w * .9, base - th * .55]);
      px += w * rand(r, .55, .9);
    }
    pts.push([x1, base + 2]);
    x.fillStyle = col; x.beginPath(); poly(x, pts); x.fill();
    if (snowCol) {
      x.fillStyle = snowCol;
      for (let i = 1; i < pts.length - 3; i += 3) {
        const [tx, ty] = pts[i + 1];
        if (r() < .7) { x.beginPath(); poly(x, [[tx, ty + 2], [tx + 3 * size, ty + 9 * size], [tx - 3 * size, ty + 8 * size]]); x.fill(); }
        if (r() < .5) { const yy = ty + rand(r, 14, 26) * size; x.beginPath(); poly(x, [[tx - 5 * size, yy], [tx + 1, yy - 3 * size], [tx + 4 * size, yy + 1]]); x.fill(); }
      }
    }
  }

  // A boathouse seen from the water: a gabled front, a roof side and a door.
  function naust(x, cx, base, w, h, C, side = 1) {
    const eave = base - h * .5, ridge = base - h, d = w * .32 * side;
    // The roof slope and the side wall that recede from the viewer.
    x.fillStyle = C.wallShade; x.beginPath(); poly(x, [[cx + w / 2 * side, eave], [cx + w / 2 * side + d, eave - h * .1], [cx + w / 2 * side + d, base - h * .06], [cx + w / 2 * side, base]]); x.fill();
    x.fillStyle = C.roof; x.beginPath(); poly(x, [[cx, ridge], [cx + d, ridge - h * .1], [cx + w / 2 * side + d + 4 * side, eave - h * .1 + 2], [cx + w / 2 * side + 4 * side, eave + 2]]); x.fill();
    // The gable front.
    x.fillStyle = C.wall; x.beginPath(); poly(x, [[cx - w / 2, base], [cx - w / 2, eave], [cx, ridge], [cx + w / 2, eave], [cx + w / 2, base]]); x.fill();
    // Boards.
    x.strokeStyle = C.wallShade; x.lineWidth = .8; x.globalAlpha = .5;
    for (let bx = cx - w / 2 + 4; bx < cx + w / 2; bx += 5) { x.beginPath(); x.moveTo(bx, base); x.lineTo(bx, Math.max(eave, ridge + Math.abs(bx - cx) / (w / 2) * (eave - ridge))); x.stroke(); }
    x.globalAlpha = 1;
    x.strokeStyle = C.trim; x.lineWidth = Math.max(1.5, w * .035); x.lineJoin = 'round';
    x.beginPath(); x.moveTo(cx - w / 2 - 3, eave + 2); x.lineTo(cx, ridge - 2); x.lineTo(cx + w / 2 + 3, eave + 2); x.stroke();
    x.fillStyle = C.door; x.fillRect(cx - w * .22, base - h * .42, w * .44, h * .42);
    x.strokeStyle = C.trim; x.lineWidth = 1.2; x.strokeRect(cx - w * .22, base - h * .42, w * .44, h * .42);
  }

  scene('landscape', 'fjord', (ctx, P, r) => {
    const N = P.night, yW = 612, n = makeNoise(seedOf(r));
    const sky = N
      ? [[0, tone(P.blue, .15, .45)], [.55, tone(P.blue, .23, .45)], [1, tone(P.blue, .32, .4)]]
      : [[0, tone(P.blue, .7, .6)], [.55, tone(P.blue, .84, .4)], [1, mixHex(tone(P.cyan, .95, .2), '#ffffff', .4)]];
    skyGradient(ctx, sky, 0, yW + 2);
    const haze = sky[2][1];
    if (N) {
      stars(ctx, r, 420, [0, 0, W, yW], [P.foreground, P.bright_blue, P.bright_yellow], 1.6);
      aurora(ctx, r, P, 300, 70);
    } else {
      glow(ctx, 260, 40, 900, '#ffffff', .55);
      glow(ctx, 260, 40, 260, tone(P.yellow, .97, .3), .5);
    }
    // The sky in the water.
    mirror(ctx, ctx.canvas, yW);

    // Each wall gets paler and hazier with distance. depth 0 is the farthest.
    const wallC = depth => {
      const f = N ? [.62, .44, .24, 0][depth] : [.66, .46, .24, 0][depth];
      const fade = c => mixHex(c, haze, f);
      return {
        lit: fade(N ? tone(P.blue, .3, .4) : tone(P.blue, .56, .3)),
        litLow: fade(N ? tone(P.blue, .22, .4) : tone(P.blue, .46, .35)),
        shade: fade(N ? tone(P.blue, .19, .45) : tone(P.blue, .38, .4)),
        shadeLow: fade(N ? tone(P.blue, .14, .45) : tone(P.blue, .32, .45)),
        snow: fade(N ? tone(P.bright_blue, .8, .3) : mixHex('#ffffff', P.red, .03)),
        snowShade: fade(N ? tone(P.blue, .5, .4) : tone(P.blue, .82, .3)),
        forest: fade(N ? tone(P.green, .13, .25) : tone(P.green, .3, .25)),
        mist: N ? tone(P.blue, .36, .35) : mixHex(haze, '#ffffff', .4), mistA: N ? .5 : .7,
      };
    };
    const walls = [
      { d: 0, base: yW, start: [690, yW], end: [1290, yW], peaks: [[790, 522], [880, 494], [975, 470], [1075, 490], [1180, 516]] },
      { d: 1, base: 620, start: [-30, 420], end: [960, 620], peaks: [[90, 405], [280, 372], [470, 392], [660, 420]] },
      { d: 1, base: 624, start: [995, 624], end: [W + 30, 400], peaks: [[1170, 410], [1360, 376], [1560, 360], [1780, 386]] },
      { d: 2, base: 648, start: [-30, 300], end: [800, 648], peaks: [[110, 272], [330, 232], [545, 292]] },
      { d: 2, base: 656, start: [1120, 656], end: [W + 30, 272], peaks: [[1330, 252], [1545, 206], [1765, 242]] },
      { d: 3, base: 722, start: [1420, 722], end: [W + 30, 130], peaks: [[1610, 150], [1810, 96]] },
      { d: 3, base: 772, start: [-30, 150], end: [470, 772], peaks: [[70, 128], [255, 176]], shore: true },
    ];
    const [L, lx] = layer();
    for (const w of walls) {
      lx.clearRect(0, 0, W, H);
      const C = wallC(w.d);
      range(lx, r, { ...w, C, light: -1, rough: [.14, .16, .18, .2][w.d], snow: [.5, .42, .36, .3][w.d], streaks: [2, 3, 5, 7][w.d], scale: [.4, .6, .8, 1][w.d], mistH: [40, 60, 90, 120][w.d] });
      if (w.d >= 2) {
        // Spruce forest on the lower slopes of the nearer walls.
        lx.save(); lx.globalCompositeOperation = 'source-atop';
        treeline(lx, r, -30, W + 30, w.base, w.d === 3 ? 70 : 34, C.forest, mixHex(C.snowShade, C.forest, .25), w.d === 3 ? 1.3 : .7);
        lx.restore();
      }
      footMist(lx, w.base, [40, 60, 60, 50][w.d], C.mist, C.mistA * [1, 1, .55, .35][w.d]);
      if (w.shore) {
        const B = N
          ? { wall: tone(P.red, .42, .7), wallShade: tone(P.red, .3, .6), roof: tone(P.bright_blue, .78, .3), trim: tone(P.foreground, .8, .5), door: tone(P.red, .2, .5) }
          : { wall: tone(P.red, .55, .95), wallShade: tone(P.red, .4, .8), roof: '#ffffff', trim: '#ffffff', door: tone(P.red, .3, .6) };
        // Falu red boathouses on a snowy strip of shore.
        lx.fillStyle = C.snow; lx.beginPath(); smoothPath(lx, [[-30, 752], [140, 750], [300, 754], [430, 758], [520, 766], [545, 772]]); lx.lineTo(545, 776); lx.lineTo(-30, 776); lx.closePath(); lx.fill();
        lx.fillStyle = C.shade; lx.fillRect(-30, 770, 590, 6);
        // Posts that carry the boathouses over the water.
        lx.fillStyle = B.door;
        for (const [bx, bw] of [[470, 86], [345, 110], [215, 92]]) for (let q = -1; q <= 1; q++) lx.fillRect(bx + q * bw * .42 - 2, 766, 4, 10);
        naust(lx, 470, 767, 86, 80, B, -1);
        naust(lx, 345, 767, 110, 100, B, -1);
        naust(lx, 215, 767, 92, 86, B, -1);
        if (N) { glow(lx, 405, 735, 70, P.yellow, .5); lx.fillStyle = P.bright_yellow; lx.fillRect(401, 731, 7, 8); }
      }
      blit(ctx, L);
      mirror(ctx, L, w.base, { alpha: .88 });
    }
    // The water darkens toward the viewer.
    ctx.fillStyle = linear(ctx, 0, yW, 0, H, N
      ? [[0, rgba(tone(P.blue, .12, .4), .05)], [1, rgba(tone(P.blue, .1, .4), .55)]]
      : [[0, rgba(tone(P.blue, .9, .2), .05)], [1, rgba(tone(P.blue, .55, .5), .35)]]);
    ctx.fillRect(0, yW, W, H - yW);
    ctx.save(); ctx.beginPath(); ctx.rect(0, yW, W, H - yW); ctx.clip();
    ripples(ctx, r, yW + 2, H, 160, N ? tone(P.bright_blue, .8, .3) : '#ffffff', N ? .14 : .4);
    if (N) {
      glow(ctx, 405, 770 + 42, 80, P.yellow, .3);
      ctx.fillStyle = rgba(P.bright_yellow, .5); for (let i = 0; i < 9; i++) ctx.fillRect(405 - rand(r, 4, 16), 790 + i * 9 + rand(r, 0, 4), rand(r, 8, 30), 1.6);
    }
    ctx.restore();
    vignette(ctx, P, N ? .45 : .1);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- landscape/spruce-forest ----------

  // A spruce with drooping tiers and snow on the top of each tier. The light comes from the right.
  function spruce(x, r, cx, base, h, C, tiers, flat = false) {
    const w = h * .2;
    const body = flat ? C.body : linear(x, cx - w, 0, cx + w, 0, [[0, C.dark], [.5, C.body], [1, C.lit]]);
    const snow = flat ? C.snow : linear(x, cx - w, 0, cx + w, 0, [[0, C.snowShade], [.45, C.snow], [1, C.snow]]);
    x.fillStyle = C.dark; x.fillRect(cx - h * .015, base - h * .1, h * .03, h * .1);
    for (let i = 0; i < tiers; i++) {
      const t = (i + 1) / tiers, y = base - h * .07 - (1 - t) * h * .9, th = h * .9 / tiers * 1.8;
      const hw = w * Math.pow(t, .8) * rand(r, .82, 1.15), droop = th * .22, top = y - th;
      const pts = [[cx, top], [cx + hw * .5, y - th * .4], [cx + hw, y + droop]];
      const fr = Math.max(2, Math.round(hw / 9));
      for (let k = 1; k < fr * 2; k++) pts.push([cx + hw - 2 * hw * k / (fr * 2), y + (k % 2 ? -th * .1 : droop * rand(r, .2, .9))]);
      pts.push([cx - hw, y + droop], [cx - hw * .5, y - th * .4]);
      x.fillStyle = body; x.beginPath(); poly(x, pts); x.fill();
      const sn = th * rand(r, .13, .24);
      x.fillStyle = snow; x.beginPath();
      poly(x, [[cx - hw * .95, y + droop * .5], [cx - hw * .5, y - th * .42], [cx, top - 1], [cx + hw * .5, y - th * .42], [cx + hw * .95, y + droop * .5],
        [cx + hw * .62, y - th * .4 + sn * .8], [cx + hw * .3, y - th * .5 + sn], [cx, top + sn * 1.3], [cx - hw * .3, y - th * .5 + sn], [cx - hw * .62, y - th * .4 + sn * .8]]);
      x.fill();
    }
  }

  scene('landscape', 'spruce-forest', (ctx, P, r) => {
    const N = P.night;
    const sky = N
      ? [[0, tone(P.blue, .13, .5)], [.55, tone(P.cyan, .22, .45)], [1, tone(P.cyan, .34, .4)]]
      : [[0, tone(P.cyan, .78, .35)], [.6, tone(P.cyan, .9, .22)], [1, mixHex(P.background, '#ffffff', .6)]];
    skyGradient(ctx, sky, 0, 640);
    const haze = sky[2][1];
    const mx = 1450, my = 165;
    if (N) {
      stars(ctx, r, 500, [0, 0, W, 560], [P.foreground, P.bright_cyan, P.bright_blue], 1.6);
      glow(ctx, mx, my, 560, tone(P.cyan, .6, .4), .28);
      glow(ctx, mx, my, 130, P.bright_cyan, .4);
      ctx.fillStyle = tone(P.foreground, .96, .4); ctx.beginPath(); circle(ctx, mx, my, 30); ctx.fill();
      // A faint ice halo around the moon.
      ctx.fillStyle = radial(ctx, mx, my, 100, 240, [[0, rgba(P.bright_cyan, 0)], [.5, rgba(P.bright_cyan, .035)], [1, rgba(P.bright_cyan, 0)]]);
      ctx.fillRect(mx - 240, my - 240, 480, 480);
    } else {
      glow(ctx, mx, my - 40, 820, '#ffffff', .7);
      glow(ctx, mx, my - 40, 200, '#ffffff', .8);
    }
    // Distant snowy mountains.
    const fade = (c, f) => mixHex(c, haze, f);
    const MC = f => ({
      lit: fade(N ? tone(P.cyan, .34, .6) : tone(P.cyan, .74, .25), f), shade: fade(N ? tone(P.blue, .24, .5) : tone(P.cyan, .6, .3), f),
      snow: fade(N ? tone(P.cyan, .68, .6) : '#ffffff', f), snowShade: fade(N ? tone(P.cyan, .42, .7) : tone(P.cyan, .86, .25), f),
    });
    range(ctx, r, { C: MC(.55), base: 580, start: [-30, 520], end: [W + 30, 500], peaks: [[150, 430], [420, 380], [700, 440], [1010, 400], [1300, 350], [1600, 420], [1830, 395]], light: 1, rough: .16, snow: .5, streaks: 2, scale: .5 });
    ctx.fillStyle = linear(ctx, 0, 470, 0, 590, [[0, rgba(haze, 0)], [1, rgba(haze, .85)]]); ctx.fillRect(0, 470, W, 120);

    // Forest layers from far to near, each on a snow bank.
    const n = makeNoise(seedOf(r));
    const layers = [
      { Y: 575, amp: 14, h: 46, gap: 9, f: .62, tiers: 5, clear: 0, flat: true },
      { Y: 628, amp: 22, h: 86, gap: 17, f: .44, tiers: 6, clear: 120, flat: true },
      { Y: 705, amp: 30, h: 150, gap: 32, f: .26, tiers: 8, clear: 300 },
      { Y: 815, amp: 34, h: 270, gap: 62, f: .1, tiers: 10, clear: 470 },
    ];
    const TC = f => ({
      body: fade(N ? tone(P.accent, .22, .45) : tone(P.accent, .42, .55), f), dark: fade(N ? tone(P.accent, .14, .45) : tone(P.accent, .32, .55), f),
      lit: fade(N ? tone(P.cyan, .34, .4) : tone(P.green, .52, .5), f),
      snow: fade(N ? tone(P.cyan, .66, .75) : '#ffffff', f), snowShade: fade(N ? tone(P.cyan, .4, .8) : tone(P.cyan, .84, .3), f),
    });
    layers.forEach((L, j) => {
      const bank = [];
      for (let x = -30; x <= W + 30; x += 20) bank.push([x, L.Y + Math.sin(x * .004 + j * 2) * L.amp + fbm(n, x * .003, j * 3, 3) * L.amp]);
      const C = TC(L.f);
      for (let x = -20; x < W + 20; x += L.gap * rand(r, .6, 1.2)) {
        if (Math.abs(x - 960) < L.clear * rand(r, .8, 1.1)) continue;
        const b = yAt(bank, x) + rand(r, 0, 10), h = L.h * rand(r, .65, 1.25);
        spruce(ctx, r, x, b + L.h * .05, h, C, L.tiers, L.flat);
      }
      ctx.fillStyle = linear(ctx, 0, L.Y - L.amp * 2, 0, L.Y + 120, [[0, fade(N ? tone(P.cyan, .55, .7) : '#ffffff', L.f)], [1, fade(N ? tone(P.cyan, .26, .8) : tone(P.cyan, .88, .25), L.f)]]);
      ctx.beginPath(); smoothPath(ctx, bank); ctx.lineTo(W + 30, H + 10); ctx.lineTo(-30, H + 10); ctx.closePath(); ctx.fill();
      // A thin mist above each bank.
      ctx.fillStyle = linear(ctx, 0, L.Y - L.h * .5, 0, L.Y + 10, [[0, rgba(haze, 0)], [1, rgba(haze, .35 * (1 - j / 4))]]); ctx.fillRect(0, L.Y - L.h * .5, W, L.h * .5 + 10);
    });
    // Moonlight or sunlight on the clearing, and the shadows of the big trees.
    glow(ctx, 980, 900, 700, N ? tone(P.cyan, .6, .4) : '#ffffff', N ? .14 : .5);
    // Big spruces frame the left and right edges.
    const C = TC(0);
    [[70, 1130, 1060], [300, 1110, 780], [1660, 1110, 860], [1880, 1140, 1100]].forEach(([x, b, h]) => {
      ctx.fillStyle = rgba(N ? tone(P.blue, .2, .4) : tone(P.cyan, .7, .35), .45);
      ctx.beginPath(); ellipse(ctx, x - 40, b - 60, h * .3, 26); ctx.fill();
      spruce(ctx, r, x, b, h, C, 15);
    });
    // Falling snow: sharp small flakes and soft big ones near the viewer.
    const flake = N ? tone(P.foreground, .9, .4) : '#ffffff';
    ctx.fillStyle = flake;
    for (let i = 0; i < 420; i++) { ctx.globalAlpha = rand(r, .35, .9); ctx.beginPath(); circle(ctx, rand(r, 0, W), rand(r, 0, H), rand(r, .8, 2.2)); ctx.fill(); }
    ctx.globalAlpha = 1;
    soft(ctx, x => {
      x.fillStyle = flake;
      for (let i = 0; i < 70; i++) { x.globalAlpha = rand(r, .3, .8); x.beginPath(); circle(x, rand(r, 0, W), rand(r, 0, H), rand(r, 4, 10)); x.fill(); }
    }, { scale: .25, blur: 6, alpha: N ? .7 : .9 });
    if (!N) {
      // A cool shade along the bottom edge.
      ctx.fillStyle = rgba(tone(P.cyan, .8, .3), .2); ctx.fillRect(0, 1000, W, 80);
    }
    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, seedOf(r), N ? .045 : .03);
  });

  // ---------- landscape/meadow ----------

  scene('landscape', 'meadow', (ctx, P, r) => {
    const N = P.night, n = makeNoise(seedOf(r));
    // Night is a warm dusk with the sun on the horizon. Day has a high sun.
    const sun = N ? [1330, 575] : [380, 170];
    const sky = N
      ? [[0, tone(P.blue, .15, .5)], [.42, tone(P.blue, .27, .45)], [.72, tone(P.red, .52, .7)], [1, tone(P.orange, .74, .9)]]
      : [[0, tone(P.cyan, .74, .45)], [.55, tone(P.cyan, .87, .3)], [1, mixHex(tone(P.yellow, .96, .3), '#ffffff', .4)]];
    skyGradient(ctx, sky, 0, 640);
    if (N) {
      stars(ctx, r, 140, [0, 0, W, 280], [P.foreground, P.bright_yellow], 1.3);
      glow(ctx, sun[0], sun[1], 1000, tone(P.orange, .74, .9), .55);
      glow(ctx, sun[0], sun[1], 280, tone(P.yellow, .92, .6), .8);
      ctx.fillStyle = tone(P.bright_yellow, .96, .5); ctx.beginPath(); circle(ctx, sun[0], sun[1], 48); ctx.fill();
    } else {
      glow(ctx, sun[0], sun[1], 900, '#ffffff', .75);
      glow(ctx, sun[0], sun[1], 220, tone(P.yellow, .98, .4), .9);
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); circle(ctx, sun[0], sun[1], 52); ctx.fill();
    }
    // Clouds: cumulus with flat bases by day, thin glowing streaks at dusk.
    if (N) {
      soft(ctx, x => {
        for (let i = 0; i < 12; i++) {
          const cy = rand(r, 260, 470), cx = rand(r, 200, W - 100), w = rand(r, 160, 420);
          x.fillStyle = rgba(tone(P.orange, .8, .8), rand(r, .25, .6)); x.beginPath(); ellipse(x, cx, cy, w, rand(r, 4, 10)); x.fill();
          x.fillStyle = rgba(tone(P.magenta, .45, .5), .4); x.beginPath(); ellipse(x, cx + 20, cy + 8, w * .8, 5); x.fill();
        }
      }, { scale: .25, blur: 5 });
    } else {
      const cn = makeNoise(seedOf(r));
      const cl = [[1010, 150, 300], [1500, 240, 230], [690, 320, 150], [1770, 110, 140]];
      clouds(ctx, [0, 0, W, 460], .6, (x, y) => {
        let v = -1;
        for (const [cx, cy, w] of cl) {
          const dx = (x - cx) / w, dy = (y - cy) / (w * .42);
          const base = y > cy + w * .12 ? (y - cy - w * .12) / 18 : 0;
          v = Math.max(v, 1 - dx * dx - dy * dy * (dy > 0 ? 2.5 : 1) - base);
        }
        return v * .9 + fbm(cn, x * .008, y * .012, 5) * .7 - .25;
      }, { lx: -8, ly: -12, lit: '#ffffff', shade: mixHex('#ffffff', tone(P.cyan, .74, .35), .55), alpha: .96, edge: .1, gain: 5 });
    }

    // Rolling hills, paler with distance, lit along their crests.
    const haze = sky[sky.length - 1][1];
    const hill = (Y, amp, f, sh, top, bottom, rim, dots) => {
      const pts = [];
      for (let x = -40; x <= W + 40; x += 30) pts.push([x, Y - amp * (fbm(n, x * f + sh, sh, 3) + .5)]);
      ctx.fillStyle = linear(ctx, 0, Y - amp, 0, Y + 140, [[0, top], [1, bottom]]);
      ctx.beginPath(); smoothPath(ctx, pts); ctx.lineTo(W + 40, H + 10); ctx.lineTo(-40, H + 10); ctx.closePath(); ctx.fill();
      if (dots) {
        // Flowers in the grass, as small dots.
        ctx.save(); ctx.beginPath(); smoothPath(ctx, pts); ctx.lineTo(W + 40, H + 10); ctx.lineTo(-40, H + 10); ctx.closePath(); ctx.clip();
        for (let i = 0; i < dots.count; i++) {
          const x = rand(r, 0, W), y = yAt(pts, x) + rand(r, 4, 150);
          ctx.globalAlpha = rand(r, .4, .9); ctx.fillStyle = dots.cols[Math.floor(r() * dots.cols.length)];
          ctx.beginPath(); circle(ctx, x, y, rand(r, .6, 1.4) * dots.size); ctx.fill();
        }
        ctx.restore();
      }
      if (rim) { ctx.save(); ctx.strokeStyle = rim; ctx.lineWidth = 2; ctx.globalAlpha = .55; ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke(); ctx.restore(); }
      return pts;
    };
    const G = (L, f) => mixHex(N ? tone(P.green, L * .5, .6) : tone(P.green, L, .55), haze, f);
    const rimC = N ? tone(P.orange, .78, .8) : null;
    const dotC = N ? [tone(P.yellow, .55, .5), tone(P.orange, .5, .6)] : ['#ffffff', P.bright_yellow, tone(P.yellow, .8, .7), tone(P.cyan, .6, .5)];
    hill(605, 90, .0018, 1, G(.84, .6), G(.72, .58), rimC);
    hill(655, 110, .0016, 4, G(.82, .42), G(.62, .44), rimC, { count: 120, size: .8, cols: dotC });
    const mid = hill(725, 130, .0014, 7, G(.8, .24), G(.54, .3), rimC, { count: 220, size: 1.1, cols: dotC });
    // A lone round tree on the middle hill.
    const tx = 560, ty = yAt(mid, tx) + 6;
    const TCc = N ? { dark: tone(P.green, .13, .5), base: tone(P.green, .19, .5), lit: tone(P.orange, .5, .7) } : { dark: tone(P.green, .4, .6), base: tone(P.green, .52, .6), lit: tone(P.yellow, .8, .5) };
    ctx.fillStyle = TCc.dark; ctx.beginPath(); taper(ctx, [[tx, ty], [tx + 2, ty - 50], [tx - 2, ty - 80]], 12, 6); ctx.fill();
    crown(ctx, r, tx, ty - 110, 80, 62, 24, 30, TCc, N ? .9 : -.6, -.6, 3);
    ctx.fillStyle = rgba(N ? '#000000' : tone(P.green, .4, .6), N ? .25 : .25); ctx.beginPath(); ellipse(ctx, tx + (N ? -60 : 50), ty + 4, 70, 7); ctx.fill();
    hill(805, 120, .0012, 10, G(.74, .08), G(.5, .16), rimC, { count: 320, size: 1.5, cols: dotC });
    hill(885, 90, .001, 13, N ? tone(P.green, .22, .5) : tone(P.green, .62, .55), N ? tone(P.green, .14, .5) : tone(P.green, .5, .6), null, { count: 260, size: 2, cols: dotC });
    if (N) glow(ctx, sun[0], 900, 700, tone(P.orange, .7, .8), .16);

    // Tall grasses and wildflowers, taller toward the corners.
    const blades = [];
    for (let i = 0; i < 1400; i++) {
      const x = rand(r, -20, W + 20), edge = Math.abs(x - 960) / 960, depth = r();
      const h = (110 + 330 * edge ** 1.6 + 130 * r()) * (.55 + depth * .6);
      blades.push([x, H + 10 - (1 - depth) * 90, h, depth]);
    }
    blades.sort((a, b) => a[3] - b[3]);
    const flowers = N ? [P.bright_yellow, P.foreground, P.orange, P.bright_cyan] : ['#ffffff', P.yellow, P.red, P.cyan, P.bright_yellow];
    for (const [x, y, h, d] of blades) {
      const lean = rand(r, -.05, .35) * h, tipx = x + lean, tipy = y - h;
      ctx.strokeStyle = N ? mixHex(tone(P.green, .12, .5), tone(P.green, .3, .5), r() * (1 - d)) : mixHex(tone(P.green, .45, .7), tone(P.yellow, .74, .6), r() * .7 * (1 - d * .5));
      ctx.lineWidth = rand(r, 1.2, 3) * (.6 + d * .6);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + lean * .1, y - h * .6, tipx, tipy); ctx.stroke();
      if (N && r() < .5) {
        // Backlit tips catch the sunset.
        ctx.strokeStyle = rgba(tone(P.yellow, .8, .7), .55); ctx.lineWidth *= .6;
        ctx.beginPath(); ctx.moveTo(lerp(x, tipx, .7), lerp(y, tipy, .75)); ctx.quadraticCurveTo(lerp(x, tipx, .9), lerp(y, tipy, .9), tipx, tipy); ctx.stroke();
      }
      const k = r();
      if (k < .12) {
        // A seed head.
        ctx.fillStyle = N ? tone(P.yellow, .7, .7) : tone(P.yellow, .78, .6);
        ctx.beginPath(); ellipse(ctx, tipx, tipy + 8, 2.2 + d * 2, 9 + d * 7, lean / h * .8); ctx.fill();
      } else if (k < .24) {
        const c = flowers[Math.floor(r() * flowers.length)], fr = 4 + d * 8;
        ctx.fillStyle = c;
        for (let q = 0; q < 6; q++) { const a = q / 6 * TAU; ctx.beginPath(); ellipse(ctx, tipx + Math.cos(a) * fr * .7, tipy + Math.sin(a) * fr * .7, fr * .55, fr * .32, a); ctx.fill(); }
        ctx.fillStyle = N ? tone(P.orange, .7, .8) : tone(P.yellow, .7, .9); ctx.beginPath(); circle(ctx, tipx, tipy, fr * .35); ctx.fill();
      }
    }
    if (N) {
      // Fireflies over the grass.
      for (let i = 0; i < 60; i++) {
        const fx = rand(r, 0, W), fy = rand(r, 640, 1040);
        glow(ctx, fx, fy, rand(r, 8, 16), P.yellow, .55);
        ctx.fillStyle = P.bright_yellow; ctx.beginPath(); circle(ctx, fx, fy, 1.4); ctx.fill();
      }
    }
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .03);
  });

  // ---------- landscape/peat-bog ----------

  // A clump of grass: a dark mound with blades that fan out.
  function tussock(x, r, cx, cy, size, base, blade, tip) {
    x.fillStyle = base; x.beginPath(); ellipse(x, cx, cy, size * .55, size * .2); x.fill();
    const count = Math.round(10 + size * .5);
    x.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + rand(r, -1.1, 1.1), len = size * rand(r, .5, 1.1), sx = cx + rand(r, -.4, .4) * size;
      const ex = sx + Math.cos(a) * len, ey = cy + Math.sin(a) * len * .9;
      x.strokeStyle = r() < .3 ? tip : blade; x.lineWidth = Math.max(.6, size * rand(r, .025, .05));
      x.beginPath(); x.moveTo(sx, cy); x.quadraticCurveTo(lerp(sx, ex, .3), lerp(cy, ey, .7), ex + Math.cos(a) * len * .15, ey + len * .12); x.stroke();
    }
  }

  scene('landscape', 'peat-bog', (ctx, P, r) => {
    const N = P.night, yH = 548, n = makeNoise(seedOf(r));
    const sky = N
      ? [[0, tone(P.blue, .15, .35)], [.6, tone(P.blue, .24, .3)], [1, tone(P.yellow, .42, .35)]]
      : [[0, tone(P.cyan, .84, .18)], [.6, tone(P.yellow, .92, .18)], [1, mixHex(P.background, '#ffffff', .5)]];
    skyGradient(ctx, sky, 0, yH + 4);
    const haze = sky[2][1];
    const mx = 560, my = 200;
    if (N) {
      stars(ctx, r, 120, [0, 0, W, 300], [P.foreground], 1.2);
      glow(ctx, mx, my, 600, tone(P.yellow, .62, .4), .3);
      glow(ctx, mx, my, 120, P.bright_yellow, .45);
      ctx.fillStyle = tone(P.bright_yellow, .94, .35); ctx.beginPath(); circle(ctx, mx, my, 30); ctx.fill();
    } else glow(ctx, 1380, 150, 900, '#ffffff', .7);
    // Thin layers of cloud that drift across the sky.
    const cn = makeNoise(seedOf(r));
    clouds(ctx, [0, 0, W, yH], .5, (x, y) => fbm(cn, x * .0022, y * .011, 5) * 1.3 + (y < 380 ? 0 : -(y - 380) / 300) - .12,
      { lx: 0, ly: -8, lit: N ? tone(P.yellow, .5, .35) : '#ffffff', shade: N ? tone(P.blue, .2, .3) : tone(P.cyan, .78, .12), rim: N ? tone(P.bright_yellow, .75, .4) : '#ffffff', alpha: N ? .75 : .8, edge: .25, gain: 4 });
    // Low hills on the horizon.
    const hill = (Y, amp, f, sh, col) => {
      const pts = [];
      for (let x = -40; x <= W + 40; x += 24) pts.push([x, Y - amp * (fbm(n, x * f + sh, sh, 4) * .8 + .5)]);
      fillRidge(ctx, pts, col);
    };
    const B = (L, f, c = P.blue, cx = .5) => mixHex(tone(c, L, cx), haze, f);
    hill(yH, 95, .0014, 2, B(N ? .28 : .74, .5));
    hill(yH + 2, 50, .0024, 6, B(N ? .21 : .62, .3, P.green));
    ctx.fillStyle = linear(ctx, 0, yH - 60, 0, yH + 20, [[0, rgba(haze, 0)], [1, rgba(haze, .75)]]); ctx.fillRect(0, yH - 60, W, 80);

    // The flat bog: a base gradient, then patches of moss, rust and straw in perspective.
    ctx.fillStyle = linear(ctx, 0, yH, 0, H, N
      ? [[0, mixHex(tone(P.blue, .3, .5), haze, .5)], [.3, tone(P.blue, .24, .55)], [1, tone(P.blue, .16, .5)]]
      : [[0, mixHex(tone(P.blue, .74, .35), haze, .5)], [.3, tone(P.blue, .66, .4)], [1, tone(P.blue, .56, .45)]]);
    ctx.fillRect(0, yH, W, H - yH);
    const patchCols = N
      ? [tone(P.green, .32, .6), tone(P.red, .3, .6), tone(P.yellow, .36, .5), tone(P.blue, .2, .5), tone(P.magenta, .27, .4)]
      : [tone(P.green, .62, .55), tone(P.red, .6, .5), tone(P.yellow, .76, .45), tone(P.blue, .5, .5), tone(P.magenta, .64, .35)];
    for (let i = 0; i < 520; i++) {
      const t = r() ** 1.5, y = lerp(yH + 4, H + 20, t), x = rand(r, -60, W + 60), w = lerp(20, 260, t) * rand(r, .5, 1.4);
      ctx.globalAlpha = rand(r, .25, .6) * (.4 + t * .6);
      fillBlob(ctx, blobPts(r, x, y, w, w * lerp(.05, .2, t), 12, .3), mixHex(patchCols[Math.floor(r() * patchCols.length)], haze, (1 - t) * .5));
    }
    ctx.globalAlpha = 1;

    // Dark pools that mirror the sky. Each pool joins 2 or 3 lumpy shapes.
    const pools = [[330, 598, 170], [860, 588, 120], [1300, 606, 220], [1690, 592, 130], [580, 680, 260], [1450, 712, 300], [200, 830, 300], [990, 795, 340], [1760, 890, 280], [690, 975, 330]];
    pools.forEach(([px, py, pw]) => {
      const t = (py - yH) / (H - yH), sq = lerp(.08, .2, t);
      const path = new Path2D();
      const parts = [[0, 0, 1]];
      for (let k = 0; k < 2; k++) parts.push([rand(r, -.6, .6), rand(r, -.3, .3), rand(r, .35, .6)]);
      parts.forEach(([ox, oy, k]) => smoothPath(path, blobPts(r, px + ox * pw, py + oy * pw * sq, pw * k, pw * k * sq, 16, .35), true));
      const ph = pw * sq, rimW = lerp(1.5, 6, t);
      ctx.save(); ctx.translate(0, rimW); ctx.fillStyle = N ? tone(P.blue, .1, .4) : tone(P.blue, .42, .45); ctx.fill(path); ctx.restore();
      ctx.save(); ctx.clip(path);
      ctx.fillStyle = linear(ctx, 0, py - ph * 1.3, 0, py + ph * 1.3, N
        ? [[0, tone(P.yellow, .42, .35)], [.4, tone(P.blue, .2, .3)], [1, tone(P.blue, .09, .4)]]
        : [[0, mixHex(haze, '#ffffff', .3)], [.35, tone(P.cyan, .66, .25)], [1, tone(P.cyan, .36, .35)]]);
      ctx.fillRect(px - pw * 2, py - ph * 3, pw * 4, ph * 6);
      if (N && Math.abs(px - mx) < pw * 1.2) glow(ctx, mx, py - ph * .2, pw * .45, P.bright_yellow, .5);
      // Grass on the far bank, mirrored upside down in the water.
      ctx.strokeStyle = rgba(N ? '#000000' : tone(P.blue, .38, .45), N ? .55 : .45); ctx.lineWidth = lerp(.6, 2, t);
      for (let i = 0; i < 16; i++) {
        const gx = px + rand(r, -1.2, 1.2) * pw, gy = py - ph * 1.6, len = rand(r, .1, .9) * ph * 1.4;
        ctx.globalAlpha = rand(r, .3, 1);
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + rand(r, -.3, .3) * len, gy + ph * .5 + len); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    });

    // Banks of low mist over the bog.
    soft(ctx, x => {
      for (let i = 0; i < 14; i++) {
        const y = rand(r, yH - 10, yH + 160);
        x.fillStyle = rgba(N ? tone(P.foreground, .6, .3) : '#ffffff', (N ? .22 : .6) * (1 - (y - yH) / 260));
        x.beginPath(); ellipse(x, rand(r, -100, W + 100), y, rand(r, 300, 760), rand(r, 10, 30)); x.fill();
      }
    }, { scale: .25, blur: 20 });

    // A few birches stand on a drier rise at mid distance.
    const bark = N ? tone(P.foreground, .52, .3) : '#ffffff', barkDark = N ? tone(P.blue, .14, .4) : tone(P.blue, .3, .4);
    const leafC = N ? { dark: tone(P.green, .14, .5), base: tone(P.green, .22, .5), lit: tone(P.yellow, .42, .5) } : { dark: tone(P.green, .58, .45), base: tone(P.green, .68, .45), lit: tone(P.yellow, .88, .45) };
    fillBlob(ctx, blobPts(r, 1560, 652, 190, 16, 14, .2), N ? tone(P.blue, .2, .45) : tone(P.blue, .6, .4));
    [[1470, 656, 150], [1545, 650, 205], [1610, 654, 175], [1680, 658, 120]].forEach(([x, b, h]) => {
      const lean = rand(r, -10, 10);
      ctx.fillStyle = bark; ctx.beginPath(); taper(ctx, [[x, b], [x + lean * .5, b - h * .5], [x + lean, b - h]], h * .045, h * .015); ctx.fill();
      ctx.fillStyle = barkDark;
      for (let k = 0; k < 6; k++) { const t = rand(r, .1, .8); ctx.fillRect(x + lean * t - h * .022, b - h * t, h * .03, 1.6); }
      crown(ctx, r, x + lean, b - h * .78, h * .2, h * .3, 18, h * .075, leafC, -.6, -.8, 4);
    });
    // Tussocks and cotton grass, larger toward the viewer.
    const tus = [];
    for (let i = 0; i < 260; i++) { const t = r() ** 1.3; tus.push([rand(r, -40, W + 40), lerp(yH + 6, H + 30, t), t]); }
    tus.sort((a, b) => a[2] - b[2]);
    for (const [x, y, t] of tus) {
      if (t < .5 && pools.some(([px, py, pw]) => Math.abs(x - px) < pw * .8 && Math.abs(y - py) < 20)) continue;
      const size = lerp(8, 130, t ** 1.4), f = (1 - t) * .55;
      tussock(ctx, r, x, y, size,
        mixHex(N ? tone(P.blue, .13, .4) : tone(P.blue, .38, .45), haze, f),
        mixHex(N ? tone(P.yellow, .36, .45) : tone(P.yellow, .62, .45), haze, f),
        mixHex(N ? tone(P.green, .45, .5) : tone(P.green, .5, .55), haze, f));
      if (t > .35 && r() < .35) {
        // Cotton grass heads.
        for (let k = 0; k < 4; k++) {
          const hx = x + rand(r, -.5, .5) * size, hy = y - size * rand(r, .8, 1.3);
          ctx.strokeStyle = mixHex(N ? tone(P.yellow, .4, .4) : tone(P.yellow, .55, .4), haze, f); ctx.lineWidth = Math.max(.6, size * .015);
          ctx.beginPath(); ctx.moveTo(hx + size * .05, y - size * .1); ctx.lineTo(hx, hy); ctx.stroke();
          ctx.fillStyle = N ? tone(P.foreground, .82, .3) : '#ffffff';
          fillBlob(ctx, blobPts(r, hx, hy - size * .04, size * .05, size * .07, 10, .3), ctx.fillStyle);
        }
      }
    }
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- landscape/moor ----------

  // A dry stone wall along a path of points from far to near.
  function stoneWall(x, r, path, h0, h1, C) {
    const n = path.length;
    for (let i = 0; i < n - 1; i++) {
      const t = i / (n - 1), [ax, ay] = path[i], [bx, by] = path[i + 1];
      const ha = lerp(h0, h1, t ** 1.3), hb = lerp(h0, h1, ((i + 1) / (n - 1)) ** 1.3);
      x.fillStyle = C.dark; x.beginPath(); poly(x, [[ax, ay], [bx, by], [bx, by - hb], [ax, ay - ha]]); x.fill();
      // Stones in rows. The near ones show their shapes.
      const rows = Math.max(2, Math.round(ha / 9)), len = Math.hypot(bx - ax, by - ay);
      for (let k = 0; k < rows; k++) {
        const v = (k + .5) / rows, sh = ha / rows;
        for (let u = 0; u < len; u += sh * rand(r, 1.1, 1.9)) {
          const f = u / len, sx = lerp(ax, bx, f), sy = lerp(ay, by, f) - v * lerp(ha, hb, f);
          x.fillStyle = r() < .5 ? C.stone : C.stone2;
          fillBlob(x, blobPts(r, sx, sy, sh * rand(r, .7, 1.1), sh * .42, 8, .2), x.fillStyle);
        }
      }
      // Coping stones on edge along the top.
      x.fillStyle = C.stone2;
      for (let u = 0; u < len; u += ha * .16) {
        const f = u / len, sx = lerp(ax, bx, f), sy = lerp(ay, by, f) - lerp(ha, hb, f);
        x.beginPath(); poly(x, [[sx - ha * .06, sy + 2], [sx - ha * .04, sy - ha * rand(r, .12, .2)], [sx + ha * .05, sy - ha * rand(r, .1, .18)], [sx + ha * .07, sy + 2]]); x.fill();
      }
    }
  }

  scene('landscape', 'moor', (ctx, P, r) => {
    const N = P.night, n = makeNoise(seedOf(r)), yH = 620;
    // Dusk with the sun just below the horizon, or a bright day of big clouds.
    const sun = N ? [1460, 650] : [520, 170];
    const sky = N
      ? [[0, tone(P.blue, .17, .5)], [.5, tone(P.magenta, .28, .5)], [.85, tone(P.red, .5, .7)], [1, tone(P.yellow, .66, .7)]]
      : [[0, tone(P.magenta, .7, .35)], [.6, tone(P.magenta, .84, .2)], [1, mixHex(P.background, '#ffffff', .5)]];
    skyGradient(ctx, sky, 0, yH + 4);
    glow(ctx, sun[0], sun[1], 1000, N ? tone(P.yellow, .7, .7) : '#ffffff', N ? .5 : .7);
    const cn = makeNoise(seedOf(r));
    // A deck of clouds in perspective: big overhead, small and flat near the horizon.
    clouds(ctx, [0, 0, W, yH - 60], .8, (x, y) => {
      const z = 1 / Math.max(.08, (yH - y) / yH), X = (x - W / 2) / W * z * 3.2, Z = z * 2.4;
      const v = fbm(cn, X * .9 + 3, Z, 5) * 1.5 + fbm(cn, X * .35, Z * .35 + 7, 2) * .8 + .02;
      return v - clamp((z - 2.6) * .14, 0, 1.4);
    }, N
      ? { lx: 10, ly: 16, lit: tone(P.red, .6, .65), shade: tone(P.blue, .2, .45), rim: tone(P.yellow, .84, .6), alpha: .98, edge: .13, gain: 5 }
      : { lx: -10, ly: -16, lit: '#ffffff', shade: tone(P.magenta, .78, .14), rim: '#ffffff', alpha: .98, edge: .13, gain: 5 });
    ctx.fillStyle = linear(ctx, 0, yH - 260, 0, yH, [[0, rgba(sky[sky.length - 2][1], 0)], [.6, rgba(sky[sky.length - 1][1], .55)], [1, rgba(sky[sky.length - 1][1], .9)]]); ctx.fillRect(0, yH - 260, W, 264);
    if (!N) {
      // Sunbeams through the gaps.
      soft(ctx, x => {
        x.fillStyle = rgba('#ffffff', .22);
        for (let i = 0; i < 6; i++) { const a = rand(r, .9, 1.9); x.beginPath(); poly(x, [[sun[0], sun[1]], [sun[0] + Math.cos(a - .04) * 1400, sun[1] + Math.sin(a - .04) * 1400], [sun[0] + Math.cos(a + .04) * 1400, sun[1] + Math.sin(a + .04) * 1400]]); x.fill(); }
      }, { scale: .25, blur: 20, alpha: .8 });
    }

    // Rolling moorland in layers with heather, bracken and grass.
    const haze = sky[sky.length - 1][1];
    const heather = N ? tone(P.blue, .38, .8) : tone(P.blue, .6, .7), bracken = N ? tone(P.red, .38, .7) : tone(P.red, .58, .65);
    const grass = N ? tone(P.yellow, .34, .45) : tone(P.yellow, .76, .4), moss = N ? tone(P.green, .3, .5) : tone(P.green, .6, .5);
    const hills = [[yH, 50, .0018, 1, .62], [yH + 40, 80, .0016, 4, .44], [yH + 110, 110, .0013, 7, .26], [yH + 220, 130, .0011, 10, .1], [yH + 360, 120, .0012, 13, 0]];
    let crest = null;
    const hillPts = [];
    hills.forEach(([Y, amp, f, sh, fade], i) => {
      const pts = [];
      for (let x = -40; x <= W + 40; x += 24) pts.push([x, Y - amp * (fbm(n, x * f + sh, sh, 4) + .5)]);
      const shape = () => { ctx.beginPath(); smoothPath(ctx, pts); ctx.lineTo(W + 40, H + 10); ctx.lineTo(-40, H + 10); ctx.closePath(); };
      shape(); ctx.fillStyle = linear(ctx, 0, Y - amp, 0, Y + 200, [[0, mixHex(i % 2 ? moss : grass, haze, fade)], [1, mixHex(N ? tone(P.blue, .14, .4) : tone(P.green, .5, .45), haze, fade)]]); ctx.fill();
      ctx.save(); shape(); ctx.clip();
      // Patches of heather and bracken: a crisp core, small dabs that break up the
      // rim, and tufts that stand up along the top edge.
      const t = i / (hills.length - 1), dot = lerp(1, 4.5, t), sq = lerp(.08, .2, t), patches = [];
      for (let k = 0; k < 5 + i * 2; k++) {
        const px = rand(r, -40, W + 40), py = yAt(pts, px) + rand(r, 10, 60 + i * 50), pw = rand(r, 120, 380) * (.4 + t), col = mixHex(r() < .7 ? heather : bracken, haze, fade);
        patches.push([px, py, pw, col, blobPts(r, px, py, pw * .8, pw * .8 * sq, 18, .3)]);
      }
      for (const [px, py, pw, col, core] of patches) {
        const light = new Path2D(), mid = new Path2D(), dark = new Path2D(), tufts = new Path2D();
        const count = Math.round(pw * (1.8 + t * 1.6));
        for (let q = 0; q < count; q++) {
          const a = r() * TAU, d = Math.sqrt(r()) * 1.2;
          if (d > .92 && r() > (1.2 - d) / .28) continue;
          const sz = dot * rand(r, .5, 1.25), k = r();
          ellipse(k < .3 ? light : k < .68 ? mid : dark, px + Math.cos(a) * d * pw, py + Math.sin(a) * d * pw * sq, sz * 1.7, sz * .7, rand(r, -.25, .25));
        }
        for (let q = 0; q < Math.round(pw * .06 * (1 + t * 2)); q++) {
          const a = Math.PI + rand(r, .1, .9) * Math.PI, d = rand(r, .8, 1.05), tx = px + Math.cos(a) * d * pw, ty = py + Math.sin(a) * d * pw * sq;
          for (let j = -1; j <= 1; j++) { tufts.moveTo(tx + j * dot * .5, ty); tufts.lineTo(tx + j * dot * 1.2 + rand(r, -.5, .5) * dot, ty - dot * rand(r, 2.2, 3.8)); }
        }
        ctx.globalAlpha = .9; fillBlob(ctx, core, col); ctx.globalAlpha = 1;
        ctx.fillStyle = mixHex(col, '#000000', .22); ctx.fill(dark);
        ctx.fillStyle = col; ctx.fill(mid);
        ctx.fillStyle = mixHex(col, '#ffffff', N ? .12 : .24); ctx.fill(light);
        ctx.strokeStyle = mixHex(col, '#000000', .12); ctx.lineWidth = Math.max(.8, dot * .45); ctx.lineCap = 'round'; ctx.stroke(tufts);
      }
      ctx.globalAlpha = 1;
      if (N) { ctx.fillStyle = linear(ctx, 0, Y - amp, 0, Y + 60, [[0, rgba(tone(P.yellow, .7, .6), .25)], [1, rgba(tone(P.yellow, .7, .6), 0)]]); ctx.fillRect(0, Y - amp - 10, W, amp + 80); }
      ctx.restore();
      if (i === 2) crest = pts;
      hillPts.push(pts);
    });
    // Cloud shadows and patches of light drift over the land.
    soft(ctx, x => {
      for (let i = 0; i < 9; i++) {
        const y = rand(r, yH + 20, H), w = lerp(120, 520, (y - yH) / (H - yH));
        x.fillStyle = N ? rgba('#000000', .28) : rgba(tone(P.blue, .3, .3), .2);
        x.beginPath(); ellipse(x, rand(r, 0, W), y, w, w * .16); x.fill();
      }
      if (!N) for (let i = 0; i < 4; i++) {
        const y = rand(r, yH + 40, 900), w = lerp(160, 480, (y - yH) / (H - yH));
        x.fillStyle = rgba(tone(P.yellow, .97, .3), .3); x.beginPath(); ellipse(x, rand(r, 200, W - 200), y, w, w * .15); x.fill();
      }
    }, { scale: .2, blur: 30 });
    // A wind-bent hawthorn on a far crest.
    const tx = 1480, ty = yAt(crest, tx) + 6, dark = N ? tone(P.blue, .11, .4) : tone(P.blue, .3, .35);
    ctx.fillStyle = dark; ctx.beginPath(); taper(ctx, bez([tx, ty], [tx - 2, ty - 40], [tx - 30, ty - 70], [tx - 70, ty - 86], 12), 14, 4); ctx.fill();
    ctx.beginPath(); taper(ctx, bez([tx - 20, ty - 56], [tx - 40, ty - 70], [tx - 90, ty - 74], [tx - 130, ty - 70], 10), 6, 2); ctx.fill();
    crown(ctx, r, tx - 84, ty - 90, 130, 24, 60, 11, N
      ? { dark: tone(P.blue, .11, .4), base: tone(P.blue, .16, .4), lit: tone(P.red, .42, .6) }
      : { dark: tone(P.green, .3, .45), base: tone(P.green, .4, .45), lit: tone(P.yellow, .7, .45) }, N ? .9 : -.6, -.4, 3);
    // Dry stone walls: a thin one on a far hill and a near one that climbs over the front hill.
    const W1 = N ? { dark: tone(P.blue, .09, .4), stone: tone(P.cyan, .36, .3), stone2: tone(P.yellow, .32, .35) } : { dark: tone(P.blue, .3, .3), stone: tone(P.cyan, .8, .2), stone2: tone(P.yellow, .74, .25) };
    const farPath = []; for (let i = 0; i <= 30; i++) { const x = lerp(1100, 160, i / 30); farPath.push([x, yAt(hillPts[2], x) + 30 + i * 1.6]); }
    stoneWall(ctx, r, farPath, 3, 6, { dark: mixHex(W1.dark, haze, .25), stone: mixHex(W1.stone, haze, .25), stone2: mixHex(W1.stone2, haze, .25) });
    const nearPath = []; for (let i = 0; i <= 44; i++) { const t = i / 44, x = lerp(1380, -80, t); nearPath.push([x, yAt(hillPts[4], x) + 6 + 190 * t ** 1.6]); }
    stoneWall(ctx, r, nearPath, 8, 120, W1);
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- landscape/olive-grove ----------

  // An olive tree: 2 or 3 gnarled stems that twist around each other above a
  // flared foot, thin branches, and a crown of small silvery leaf clusters with gaps.
  function olive(x, r, cx, base, s, C, lx) {
    x.fillStyle = C.shadow; x.beginPath(); ellipse(x, cx - 46 * s * lx, base + 4 * s, 120 * s, 15 * s); x.fill();
    const small = s < .45, ccy = base - 190 * s, rx = 150 * s, ry = 82 * s;
    const pts = crownPoints(r, cx + rand(r, -10, 10) * s, ccy, rx, ry, small ? 16 : 44, 24 * s, small ? 1 : 3);
    // The foot flares into the soil.
    x.fillStyle = C.trunk;
    x.beginPath(); x.moveTo(cx - 30 * s, base + 3 * s); x.quadraticCurveTo(cx - 14 * s, base - 4 * s, cx - 14 * s, base - 26 * s);
    x.lineTo(cx + 14 * s, base - 26 * s); x.quadraticCurveTo(cx + 14 * s, base - 4 * s, cx + 30 * s, base + 3 * s); x.closePath(); x.fill();
    const stems = small ? 2 : 2 + Math.floor(r() * 2), tops = [];
    for (let i = 0; i < stems; i++) {
      const u = i - (stems - 1) / 2, side = u < 0 ? -1 : 1, x0 = cx + u * 18 * s, x3 = cx - u * 34 * s + rand(r, -18, 18) * s, y3 = base - rand(r, 112, 140) * s;
      const pts2 = bez([x0, base], [x0 - side * 34 * s, base - 46 * s], [x3 + side * 40 * s, y3 + 52 * s], [x3, y3], 18);
      x.fillStyle = C.trunk; x.beginPath(); taper(x, pts2, 26 * s, 12 * s); x.fill();
      if (!small) {
        // A lit edge toward the light and a dark groove in the bark.
        x.fillStyle = C.trunkLit; x.beginPath(); taper(x, pts2.slice(2).map(([px, py]) => [px + lx * 8 * s, py - 2 * s]), 6 * s, 2 * s); x.fill();
        x.fillStyle = C.bark; x.beginPath(); taper(x, pts2.slice(1).map(([px, py]) => [px - lx * 4 * s, py]), 5 * s, 2 * s); x.fill();
      }
      tops.push(pts2[pts2.length - 1]);
    }
    if (!small) { x.fillStyle = C.bark; x.beginPath(); ellipse(x, cx + rand(r, -5, 5) * s, base - 20 * s, 6 * s, 15 * s); x.fill(); }
    // Thin branches reach out to the clusters, and show in the gaps.
    x.fillStyle = C.trunk;
    pts.forEach(([px, py], i) => {
      if (small ? i % 3 : i % 2) return;
      const [tx, ty] = tops.reduce((best, t) => (Math.hypot(t[0] - px, t[1] - py) < Math.hypot(best[0] - px, best[1] - py) ? t : best));
      x.beginPath(); taper(x, bez([tx, ty], [lerp(tx, px, .35), ty - 22 * s], [lerp(tx, px, .7), py + 18 * s], [px, py], 10), 9 * s, 2.5 * s); x.fill();
    });
    leafClusters(x, r, pts, 20 * s, C, lx, -.75, small ? 3 : 10);
  }

  scene('landscape', 'olive-grove', (ctx, P, r) => {
    const N = P.night, n = makeNoise(seedOf(r));
    const sky = N
      ? [[0, tone(P.blue, .15, .4)], [.55, tone(P.magenta, .3, .45)], [1, tone(P.orange, .6, .7)]]
      : [[0, tone(P.cyan, .8, .4)], [.6, tone(P.cyan, .9, .25)], [1, mixHex(tone(P.yellow, .96, .3), '#ffffff', .4)]];
    skyGradient(ctx, sky, 0, 620);
    const haze = sky[sky.length - 1][1];
    if (N) {
      stars(ctx, r, 160, [0, 0, W, 360], [P.foreground, P.bright_yellow], 1.3);
      // A thin crescent moon.
      ctx.fillStyle = tone(P.bright_yellow, .92, .4); ctx.beginPath(); circle(ctx, 420, 170, 26); ctx.fill();
      ctx.fillStyle = mixHex(sky[0][1], sky[1][1], .25); ctx.beginPath(); circle(ctx, 432, 162, 24); ctx.fill();
      glow(ctx, 300, 560, 900, tone(P.orange, .7, .7), .4);
    } else {
      glow(ctx, 260, 120, 900, '#ffffff', .8);
      glow(ctx, 260, 120, 160, tone(P.yellow, .98, .4), .9);
    }
    // Hazy hills far away, then the sea of hills in the valley.
    const ridge = (Y, amp, f, sh, col) => {
      const pts = [];
      for (let x = -40; x <= W + 40; x += 24) pts.push([x, Y - amp * (fbm(n, x * f + sh, sh, 4) + .5)]);
      fillRidge(ctx, pts, col);
    };
    const hz = (c, f) => mixHex(c, haze, f);
    ridge(470, 120, .0015, 2, hz(N ? tone(P.blue, .26, .4) : tone(P.cyan, .7, .25), .6));
    ridge(540, 100, .002, 5, hz(N ? tone(P.blue, .22, .45) : tone(P.green, .64, .3), .42));

    // Terraces climb to the right. Each has a stone wall at the front and a row of trees.
    const K = 7, rows = [];
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1), Y = 590 + 470 * t ** 1.15, rise = 470 * (1 - t * .62), wh = 6 + 70 * t ** 1.5;
      rows.push({ t, edge: x => Y - rise * (Math.max(0, x) / W) ** 1.35 + 16 * Math.sin(x * .004 + k * 1.7), wh });
    }
    const soil = N ? tone(P.red, .26, .6) : tone(P.red, .64, .55), soilDark = N ? tone(P.red, .18, .5) : tone(P.red, .52, .6);
    const dry = N ? tone(P.yellow, .3, .4) : tone(P.yellow, .8, .4);
    const stone = N ? tone(P.yellow, .3, .25) : tone(P.yellow, .8, .2), stone2 = N ? tone(P.cyan, .26, .2) : tone(P.cyan, .72, .15), joint = N ? tone(P.blue, .12, .4) : tone(P.red, .4, .4);
    const TC = f => ({
      dark: hz(N ? tone(P.accent, .16, .5) : tone(P.accent, .44, .5), f), base: hz(N ? tone(P.accent, .27, .45) : tone(P.green, .6, .4), f),
      lit: hz(N ? tone(P.cyan, .46, .4) : tone(P.cyan, .8, .3), f), trunk: hz(N ? tone(P.magenta, .18, .3) : tone(P.magenta, .42, .25), f),
      trunkLit: hz(N ? tone(P.yellow, .36, .3) : tone(P.yellow, .74, .2), f), bark: hz(N ? tone(P.magenta, .1, .3) : tone(P.magenta, .3, .3), f),
      shadow: rgba(N ? '#000000' : tone(P.red, .4, .5), N ? .3 : .25),
    });
    const lx = N ? -.7 : -.7;
    for (let k = 0; k < K; k++) {
      const R = rows[k], prev = k ? rows[k - 1] : null, f = (1 - R.t) * .55;
      const xs = []; for (let x = -40; x <= W + 40; x += 20) xs.push(x);
      // The terrace floor between the wall above and this edge.
      const top = xs.map(x => [x, prev ? prev.edge(x) + prev.wh : R.edge(x) - 40 - 160 * Math.max(0, x / W)]);
      const bot = xs.map(x => [x, R.edge(x)]);
      ctx.fillStyle = linear(ctx, 0, Math.min(...top.map(p => p[1])), 0, Math.max(...bot.map(p => p[1])), [[0, hz(soilDark, f)], [1, hz(soil, f)]]);
      ctx.beginPath(); poly(ctx, [...top, ...[...bot].reverse()]); ctx.fill();
      // Dry grass streaks on the soil.
      ctx.strokeStyle = hz(dry, f); ctx.lineCap = 'round';
      for (let i = 0; i < 90; i++) {
        const x = rand(r, -20, W + 20), y0 = prev ? prev.edge(x) + prev.wh : R.edge(x) - 60, y1 = R.edge(x), y = lerp(y0, y1, r());
        ctx.globalAlpha = rand(r, .12, .35); ctx.lineWidth = lerp(.8, 2.4, R.t);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + lerp(6, 30, R.t), y + rand(r, -2, 2)); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // A row of olive trees.
      const s = lerp(.22, 1.05, R.t ** 1.2), gap = 400 * s;
      for (let x = rand(r, -40, gap * .5); x < W + 60; x += gap * rand(r, .85, 1.2)) {
        const b = lerp(prev ? prev.edge(x) + prev.wh : R.edge(x) - 40, R.edge(x), rand(r, .45, .7));
        olive(ctx, r, x, b, s * rand(r, .85, 1.1), TC(f), lx);
      }
      // The stone wall face below the edge.
      const face = [...bot, ...[...bot].reverse().map(([x, y]) => [x, y + R.wh])];
      ctx.fillStyle = hz(joint, f); ctx.beginPath(); poly(ctx, face); ctx.fill();
      if (R.wh > 9) {
        ctx.save(); ctx.beginPath(); poly(ctx, face); ctx.clip();
        const sh = Math.max(5, R.wh / Math.max(2, Math.round(R.wh / 14)));
        for (let yy = 0; yy < R.wh; yy += sh) for (let x = -30; x < W + 30; x += sh * rand(r, 1.2, 2.2)) {
          const y = R.edge(x) + yy + sh * .5;
          fillBlob(ctx, blobPts(r, x, y, sh * rand(r, .7, 1.05), sh * .44, 8, .18), hz(r() < .55 ? stone : stone2, f));
        }
        ctx.restore();
      }
      ctx.strokeStyle = hz(N ? tone(P.yellow, .44, .3) : '#ffffff', f); ctx.globalAlpha = N ? .35 : .6; ctx.lineWidth = lerp(.6, 2, R.t);
      ctx.beginPath(); bot.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); ctx.globalAlpha = 1;
    }
    // The near terrace below the last wall.
    const last = rows[K - 1], xsF = []; for (let x = -40; x <= W + 40; x += 20) xsF.push([x, last.edge(x) + last.wh]);
    ctx.fillStyle = linear(ctx, 0, 900, 0, H, [[0, soilDark], [1, soil]]);
    ctx.beginPath(); poly(ctx, [...xsF, [W + 40, H + 10], [-40, H + 10]]); ctx.fill();
    // Cypresses on the crest of the hill.
    const crest = x => rows[0].edge(x) - 40 - 160 * Math.max(0, x / W);
    const cyp = hz(N ? tone(P.green, .16, .5) : tone(P.green, .4, .45), .45), cypLit = hz(N ? tone(P.green, .26, .5) : tone(P.green, .56, .45), .45);
    [[1180, 110], [1230, 140], [1420, 125], [1660, 150], [1700, 120]].forEach(([x, h]) => {
      const b = crest(x) + 8, w = h * .11;
      ctx.fillStyle = cyp; ctx.beginPath(); ctx.moveTo(x, b - h); ctx.quadraticCurveTo(x + w * 1.6, b - h * .45, x + w * .6, b); ctx.lineTo(x - w * .6, b); ctx.quadraticCurveTo(x - w * 1.6, b - h * .45, x, b - h); ctx.fill();
      ctx.fillStyle = cypLit; ctx.beginPath(); ctx.moveTo(x, b - h); ctx.quadraticCurveTo(x - w * 1.6, b - h * .45, x - w * .6, b); ctx.lineTo(x - w * .1, b); ctx.quadraticCurveTo(x - w * .5, b - h * .5, x, b - h); ctx.fill();
    });
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- landscape/moss-garden ----------

  // A torii gate: 2 pillars, a lower tie beam and a curved top beam.
  function torii(x, cx, base, h, col, dark) {
    const pw = h * .075, span = h * .78, top = base - h;
    x.fillStyle = col;
    for (const sx of [-1, 1]) { x.beginPath(); poly(x, [[cx + sx * span / 2 - pw / 2, base], [cx + sx * span / 2 + pw / 2, base], [cx + sx * span * .46 + pw / 2 * sx * .3 + pw / 2, top + h * .12], [cx + sx * span * .46 - pw / 2, top + h * .12]]); x.fill(); }
    x.fillRect(cx - span * .62, top + h * .3, span * 1.24, h * .07);
    x.fillRect(cx - pw * .4, top + h * .12, pw * .8, h * .2);
    x.fillRect(cx - span * .6, top + h * .1, span * 1.2, h * .065);
    x.fillStyle = dark;
    x.beginPath(); x.moveTo(cx - span * .78, top - h * .04); x.quadraticCurveTo(cx, top + h * .06, cx + span * .78, top - h * .04);
    x.lineTo(cx + span * .72, top + h * .07); x.quadraticCurveTo(cx, top + h * .13, cx - span * .72, top + h * .07); x.closePath(); x.fill();
  }

  // A stone lantern: base, post, platform, fire box with a window, roof and a jewel on top.
  function lantern(x, cx, base, h, C, lit) {
    const u = h / 100;
    const box = (w, y0, y1, col) => { x.fillStyle = col; x.fillRect(cx - w / 2, base - y1 * u, w, (y1 - y0) * u); };
    x.fillStyle = C.stone; x.beginPath(); ellipse(x, cx, base - 2 * u, 26 * u, 5 * u); x.fill();
    box(36 * u, 0, 8, C.shade); box(30 * u, 7, 11, C.stone);
    box(12 * u, 11, 46, C.stone); box(6 * u, 11, 46, C.lit);
    box(40 * u, 46, 53, C.shade); box(36 * u, 52, 56, C.stone);
    box(28 * u, 56, 75, C.stone);
    x.fillStyle = lit || C.shade; x.fillRect(cx - 8 * u, base - 72 * u, 16 * u, 13 * u);
    x.fillStyle = C.shade; x.fillRect(cx - .8 * u, base - 72 * u, 1.6 * u, 13 * u);
    x.fillStyle = C.stone; x.beginPath();
    x.moveTo(cx - 34 * u, base - 76 * u); x.quadraticCurveTo(cx - 20 * u, base - 80 * u, cx - 8 * u, base - 92 * u); x.lineTo(cx + 8 * u, base - 92 * u);
    x.quadraticCurveTo(cx + 20 * u, base - 80 * u, cx + 34 * u, base - 76 * u); x.lineTo(cx + 34 * u, base - 74 * u); x.lineTo(cx - 34 * u, base - 74 * u); x.closePath(); x.fill();
    x.fillStyle = C.moss; x.beginPath(); ellipse(x, cx - 6 * u, base - 84 * u, 14 * u, 4 * u); x.fill();
    x.fillStyle = C.stone; x.beginPath(); circle(x, cx, base - 96 * u, 5 * u); x.fill();
  }

  // A pine pad: a flat cloud of needles, lit on top.
  function pinePad(x, r, cx, cy, w, h, C) {
    const pts = [];
    for (let i = 0; i <= 14; i++) { const a = Math.PI + i / 14 * Math.PI; pts.push([cx + Math.cos(a) * w * (i % 2 ? .92 : 1), cy + Math.sin(a) * h * (i % 2 ? .78 : 1)]); }
    pts.push([cx + w * .9, cy + h * .25], [cx, cy + h * .4], [cx - w * .9, cy + h * .25]);
    x.fillStyle = linear(x, 0, cy - h, 0, cy + h * .4, [[0, C.lit], [.55, C.base], [1, C.dark]]);
    x.beginPath(); smoothPath(x, pts, true); x.fill();
    x.strokeStyle = C.lit; x.lineWidth = Math.max(.8, h * .03); x.globalAlpha = .5;
    for (let i = 0; i < w * .5; i++) {
      const px = cx + rand(r, -.85, .85) * w, py = cy - rand(r, 0, .7) * h * (1 - Math.abs(px - cx) / w);
      x.beginPath(); x.moveTo(px, py); x.lineTo(px + rand(r, -6, 6), py - rand(r, 4, 10)); x.stroke();
    }
    x.globalAlpha = 1;
  }

  // A maple leaf with 7 pointed lobes that hangs from its stem at angle a.
  function maple(x, cx, cy, s, a) {
    const pts = [];
    for (let i = 0; i < 14; i++) {
      const t = a - Math.PI * .85 + i / 13 * Math.PI * 1.7, lobe = i % 2 === 0;
      const k = lobe ? 1 - Math.abs(i - 6) * .07 : .32;
      pts.push([cx + Math.cos(t) * s * k, cy + Math.sin(t) * s * k]);
    }
    pts.push([cx + Math.cos(a + Math.PI) * s * .12, cy + Math.sin(a + Math.PI) * s * .12]);
    poly(x, pts);
  }

  scene('landscape', 'moss-garden', (ctx, P, r) => {
    const N = P.night, yG = 600;
    const sky = N
      ? [[0, tone(P.accent, .12, .5)], [.7, tone(P.cyan, .26, .4)], [1, tone(P.cyan, .32, .35)]]
      : [[0, tone(P.green, .78, .3)], [.7, tone(P.green, .9, .18)], [1, mixHex(P.background, '#ffffff', .5)]];
    skyGradient(ctx, sky, 0, yG + 40);
    const haze = sky[2][1];
    if (N) glow(ctx, 1250, 300, 700, tone(P.cyan, .55, .4), .25); else glow(ctx, 1500, 80, 900, '#ffffff', .7);
    // Cedar trunks in the mist, far to near.
    [[.75, 26, 6, 12], [.55, 16, 10, 20], [.32, 9, 18, 34]].forEach(([f, count, w0, w1]) => {
      for (let i = 0; i < count; i++) {
        const x = rand(r, -20, W + 20), w = rand(r, w0, w1);
        if (Math.abs(x - 1220) < 120 && f < .7) continue;
        ctx.fillStyle = mixHex(N ? tone(P.accent, .14, .4) : tone(P.green, .42, .3), haze, f);
        ctx.beginPath(); poly(ctx, [[x - w / 2, -10], [x + w / 2, -10], [x + w * .6, yG + 20], [x - w * .6, yG + 20]]); ctx.fill();
      }
      soft(ctx, x => { x.fillStyle = rgba(haze, .5); x.fillRect(0, yG - 200, W, 260); }, { scale: .1, blur: 40, alpha: .6 });
    });
    // Canopy along the top edge.
    soft(ctx, x => {
      for (let i = 0; i < 40; i++) {
        x.fillStyle = N ? tone(P.accent, .1, .5) : tone(P.green, .5, .45);
        x.beginPath(); ellipse(x, rand(r, -50, W + 50), rand(r, -60, 70), rand(r, 80, 200), rand(r, 40, 90)); x.fill();
      }
    }, { scale: .25, blur: 10, alpha: N ? .95 : .7 });
    if (!N) {
      // Shafts of light through the canopy.
      soft(ctx, x => {
        x.fillStyle = rgba('#ffffff', .35);
        for (let i = 0; i < 7; i++) { const x0 = rand(r, 500, 1900), w = rand(r, 30, 90); x.beginPath(); poly(x, [[x0, -20], [x0 + w, -20], [x0 + w - 520, 1100], [x0 - 520 - w * .5, 1100]]); x.fill(); }
      }, { scale: .2, blur: 24, alpha: .8 });
    }
    // The torii in the distance.
    const T = mixHex(N ? tone(P.red, .42, .8) : tone(P.red, .58, .9), haze, N ? .35 : .3);
    torii(ctx, 1220, yG + 6, 132, T, mixHex(N ? tone(P.accent, .12, .4) : tone(P.green, .3, .3), haze, .3));

    // The moss: a ground, then soft mounds from far to near.
    ctx.fillStyle = linear(ctx, 0, yG, 0, H, N
      ? [[0, mixHex(tone(P.accent, .3, .6), haze, .4)], [1, tone(P.accent, .2, .6)]]
      : [[0, mixHex(tone(P.green, .7, .5), haze, .4)], [1, tone(P.green, .55, .6)]]);
    ctx.fillRect(0, yG, W, H - yG);
    const mossLit = N ? tone(P.green, .5, .7) : tone(P.yellow, .82, .6), moss = N ? tone(P.accent, .32, .65) : tone(P.green, .62, .6), mossDark = N ? tone(P.accent, .17, .6) : tone(P.green, .44, .65);
    const mounds = [];
    for (let i = 0; i < 26; i++) { const t = r() ** 1.2; mounds.push([rand(r, -100, W + 100), lerp(yG + 12, H + 60, t), t]); }
    mounds.sort((a, b) => a[2] - b[2]);
    for (const [mx, my, t] of mounds) {
      if (Math.abs(mx - lerp(1220, 860, t)) < lerp(30, 240, t)) continue;
      const w = lerp(90, 520, t) * rand(r, .7, 1.2), h = w * rand(r, .24, .38), f = (1 - t) * .4;
      const pts = [];
      for (let k = 0; k <= 16; k++) { const a = Math.PI + k / 16 * Math.PI; pts.push([mx + Math.cos(a) * w, my + Math.sin(a) * h * (1 + .08 * Math.sin(k * 2.3))]); }
      ctx.fillStyle = radial(ctx, mx - w * .25, my - h * .9, 0, w * 1.1, [[0, mixHex(mossLit, haze, f)], [.45, mixHex(moss, haze, f)], [1, mixHex(mossDark, haze, f)]]);
      ctx.beginPath(); smoothPath(ctx, pts); ctx.closePath(); ctx.fill();
      // A velvet stipple on the top of the mound.
      ctx.fillStyle = mixHex(mossLit, haze, f);
      for (let k = 0; k < w * .8; k++) {
        const a = Math.PI + rand(r, .1, .9) * Math.PI, d = Math.sqrt(r());
        ctx.globalAlpha = rand(r, .2, .6); ctx.beginPath(); circle(ctx, mx + Math.cos(a) * w * d, my + Math.sin(a) * h * d, lerp(.5, 1.8, t)); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Mist lies on the ground where the moss meets the forest.
    soft(ctx, x => {
      for (let i = 0; i < 12; i++) { x.fillStyle = rgba(haze, N ? .5 : .8); x.beginPath(); ellipse(x, rand(r, -100, W + 100), yG + rand(r, -6, 20), rand(r, 200, 500), rand(r, 14, 30)); x.fill(); }
    }, { scale: .25, blur: 16, alpha: N ? .7 : .85 });
    // Stepping stones that wind to the gate.
    const stoneC = N ? tone(P.foreground, .42, .3) : tone(P.foreground, .9, .3), stoneD = N ? tone(P.accent, .14, .4) : tone(P.green, .5, .3);
    for (let i = 13; i >= 0; i--) {
      const t = i / 13, y = lerp(yG + 14, 1060, (1 - t) ** 1.6), x = lerp(1220, 840, (1 - t) ** 1.2) + Math.sin(t * 7) * lerp(40, 4, t);
      const w = lerp(150, 16, t ** .7) * rand(r, .8, 1.15), h = w * lerp(.3, .16, t);
      const f = t * .4;
      fillBlob(ctx, blobPts(r, x + w * .05, y + h * .35, w, h, 14, .14), mixHex(stoneD, haze, f));
      const top = blobPts(r, x, y, w, h, 14, .14);
      ctx.fillStyle = linear(ctx, x - w, y - h, x + w, y + h, [[0, mixHex(mixHex(stoneC, '#ffffff', N ? 0 : .3), haze, f)], [1, mixHex(mixHex(stoneC, stoneD, .35), haze, f)]]);
      ctx.beginPath(); smoothPath(ctx, top, true); ctx.fill();
    }
    // A pine leans in from the left with flat pads of needles.
    const PC = N ? { dark: tone(P.accent, .1, .5), base: tone(P.accent, .17, .5), lit: tone(P.green, .32, .5), bark: tone(P.magenta, .14, .2) }
      : { dark: tone(P.green, .3, .55), base: tone(P.green, .42, .55), lit: tone(P.green, .62, .5), bark: tone(P.magenta, .34, .25) };
    ctx.fillStyle = PC.bark;
    const limbs = [[[300, 340], [600, 300], 22], [[170, 610], [560, 590], 24], [[320, 310], [470, 150], 16], [[130, 790], [400, 820], 20], [[280, 380], [120, 230], 14], [[230, 470], [380, 450], 14]];
    limbs.forEach(([a, b, w]) => { ctx.beginPath(); taper(ctx, bez([a[0] - 20, a[1] + 6], [lerp(a[0], b[0], .4), a[1] - 50], [lerp(a[0], b[0], .7), b[1] + 30], b, 14), w, w * .4); ctx.fill(); });
    ctx.beginPath(); taper(ctx, bez([40, 1110], [230, 840], [60, 560], [330, 300], 30), 96, 34); ctx.fill();
    [[470, 140, 140, 44], [130, 220, 130, 40], [610, 290, 200, 58], [380, 440, 150, 46], [570, 580, 220, 62], [410, 810, 170, 50], [90, 470, 110, 38]].forEach(([x, y, w, h]) => pinePad(ctx, r, x, y, w, h, PC));
    // Maple branches in the top right corner.
    const MC = N ? [tone(P.green, .24, .6), tone(P.green, .32, .6), tone(P.red, .3, .7)] : [tone(P.yellow, .74, .7), tone(P.green, .62, .6), tone(P.red, .6, .8)];
    ctx.strokeStyle = PC.bark; ctx.lineCap = 'round';
    const twigs = [];
    for (let i = 0; i < 6; i++) {
      const y0 = rand(r, -20, 260), x1 = rand(r, 1350, 1700), y1 = y0 + rand(r, 30, 160);
      ctx.lineWidth = rand(r, 3, 8); ctx.beginPath(); ctx.moveTo(W + 20, y0); ctx.quadraticCurveTo(lerp(W, x1, .5), y0 - 30, x1, y1); ctx.stroke();
      for (let k = 0; k < 16; k++) { const t = rand(r, .15, 1); twigs.push([lerp(W + 20, x1, t) + rand(r, -40, 40), lerp(y0, y1, t) + rand(r, 0, 50)]); }
    }
    twigs.forEach(([x, y]) => {
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = MC[r() < .1 ? 2 : r() < .5 ? 0 : 1];
        ctx.beginPath(); maple(ctx, x + rand(r, -14, 14), y + rand(r, -6, 16), rand(r, 13, 22), Math.PI / 2 + rand(r, -.6, .6)); ctx.fill();
      }
    });
    // The stone lantern on the right.
    const LC = N ? { stone: tone(P.foreground, .34, .2), shade: tone(P.accent, .12, .3), lit: tone(P.foreground, .44, .2), moss: tone(P.green, .36, .6) }
      : { stone: tone(P.foreground, .78, .25), shade: tone(P.green, .5, .2), lit: tone(P.foreground, .9, .2), moss: tone(P.green, .58, .6) };
    const lx = 1600, lb = 900, lh = 280;
    if (N) {
      glow(ctx, lx, lb - lh * .66, 560, P.orange, .3);
      // A warm pool of light on the moss around the lantern.
      ctx.save(); ctx.translate(lx, lb - 10); ctx.scale(1, .3); glow(ctx, 0, 0, 620, P.orange, .4, 'screen'); ctx.restore();
    }
    lantern(ctx, lx, lb, lh, LC, N ? P.bright_yellow : null);
    if (N) {
      glow(ctx, lx, lb - lh * .655, 90, P.bright_yellow, .6);
      // Fireflies over the moss.
      for (let i = 0; i < 26; i++) { const fx = rand(r, 400, 1800), fy = rand(r, 560, 900); glow(ctx, fx, fy, 12, P.yellow, .5); ctx.fillStyle = P.bright_yellow; ctx.beginPath(); circle(ctx, fx, fy, 1.3); ctx.fill(); }
    } else {
      // Dappled light on the moss.
      soft(ctx, x => {
        for (let i = 0; i < 28; i++) {
          const y = rand(r, yG + 30, H), w = lerp(8, 50, (y - yG) / (H - yG)) * rand(r, .6, 1.4);
          x.fillStyle = rgba(tone(P.yellow, .95, .6), rand(r, .2, .45)); x.beginPath(); ellipse(x, rand(r, 400, W - 200), y, w, w * .3); x.fill();
        }
      }, { scale: .5, blur: 5, op: 'screen', alpha: .8 });
    }
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- landscape/infrared ----------

  scene('landscape', 'infrared', (ctx, P, r) => {
    const N = P.night, yH = 640, cn = makeNoise(seedOf(r));
    const sky = N
      ? [[0, tone(P.blue, .12, .7)], [.6, tone(P.blue, .22, .7)], [1, tone(P.cyan, .38, .55)]]
      : [[0, tone(P.blue, .5, .75)], [.6, tone(P.cyan, .66, .5)], [1, tone(P.cyan, .86, .3)]];
    skyGradient(ctx, sky, 0, yH + 4);
    // Infrared turns clouds bright and leaves pink.
    const pinkLit = N ? mixHex(P.bright_yellow, '#ffffff', .45) : '#ffffff', pink = N ? tone(P.green, .74, .75) : tone(P.green, .84, .5), pinkDark = N ? tone(P.magenta, .48, .7) : tone(P.magenta, .68, .55);
    clouds(ctx, [0, 0, W, yH], .6, (x, y) => {
      const z = 1 / Math.max(.05, (yH - y) / yH), X = (x - W / 2) / W * z * 2.4, Z = z * 1.6;
      return fbm(cn, X + 5, Z, 5) * 1.6 + .02 - (y < 200 ? (200 - y) / 400 : 0) - clamp((z - 4) * .1, 0, 1);
    }, { lx: -6, ly: -12, lit: pinkLit, shade: mixHex(pinkDark, sky[1][1], .45), rim: '#ffffff', alpha: N ? .85 : .9, edge: .12, gain: 4 });
    ctx.fillStyle = linear(ctx, 0, yH - 120, 0, yH, [[0, rgba(sky[2][1], 0)], [1, rgba(sky[2][1], .8)]]); ctx.fillRect(0, yH - 120, W, 124);
    // The foliage goes on its own layer, so it can glow.
    const [F, fx] = layer();
    const n = makeNoise(seedOf(r));
    // A far line of trees on the horizon.
    const far = [];
    for (let x = -20; x <= W + 20; x += 6) far.push([x, yH - 18 - 40 * (fbm(n, x * .004, 1, 4) + .5) - Math.abs(Math.sin(x * .03)) * 10]);
    fillRidge(fx, far, mixHex(pink, sky[2][1], .35));
    // The field.
    fx.fillStyle = linear(fx, 0, yH, 0, H, N
      ? [[0, mixHex(pink, sky[2][1], .35)], [.4, mixHex(pink, pinkDark, .45)], [1, tone(P.magenta, .3, .6)]]
      : [[0, mixHex(pinkLit, sky[2][1], .2)], [.4, pink], [1, mixHex(pink, pinkDark, .5)]]);
    fx.fillRect(0, yH - 2, W, H - yH + 2);
    fx.strokeStyle = pinkDark; fx.lineCap = 'round';
    for (let i = 0; i < 900; i++) {
      const t = r() ** 1.4, y = lerp(yH + 4, H + 10, t), x = rand(r, -10, W + 10), h = lerp(2, 30, t);
      fx.globalAlpha = rand(r, .15, .45); fx.lineWidth = lerp(.5, 1.8, t);
      fx.beginPath(); fx.moveTo(x, y); fx.lineTo(x + rand(r, -.3, .3) * h, y - h); fx.stroke();
    }
    fx.globalAlpha = 1;
    // Pale tufts and flowers glow in the field.
    fx.fillStyle = pinkLit;
    for (let i = 0; i < 260; i++) {
      const t = r() ** 1.5, y = lerp(yH + 6, H, t), x = rand(r, 0, W);
      fx.globalAlpha = rand(r, .3, .8); fx.beginPath(); circle(fx, x, y, lerp(.6, 3, t)); fx.fill();
    }
    fx.globalAlpha = 1;
    // A dirt path that winds into the distance.
    const pathPts = [];
    for (let i = 0; i <= 30; i++) { const t = i / 30, y = lerp(yH + 2, H + 20, t ** 1.6), x = 1010 + Math.sin(t * 3.2 + .6) * 120 * t, w = lerp(4, 300, t ** 1.6); pathPts.push([x, y, w]); }
    const dirt = N ? tone(P.blue, .22, .45) : tone(P.blue, .6, .3);
    const track = (k0, k1, col) => {
      fx.fillStyle = col;
      fx.beginPath(); poly(fx, [...pathPts.map(([x, y, w]) => [x + k0 * w, y]), ...[...pathPts].reverse().map(([x, y, w]) => [x + k1 * w, y])]); fx.fill();
    };
    // 2 wheel ruts with grass between them.
    soft(fx, x => {
      x.fillStyle = linear(x, 0, yH, 0, H, [[0, mixHex(dirt, pinkLit, .5)], [1, dirt]]);
      x.beginPath(); poly(x, [...pathPts.map(([px, y, w]) => [px - w / 2, y]), ...[...pathPts].reverse().map(([px, y, w]) => [px + w / 2, y])]); x.fill();
    }, { scale: .5, blur: 3 });
    track(-.14, .14, mixHex(pink, dirt, .35));
    // Trees: dark trunks and pale glowing crowns.
    const trunk = N ? tone(P.blue, .14, .55) : tone(P.blue, .36, .5);
    const C = { dark: pinkDark, base: pink, lit: pinkLit };
    // The crowns go on their own layer, so their edges can glow.
    const [CR, cx2] = layer();
    const tree = (x, b, s) => {
      // The shadow of the tree on the field.
      fx.fillStyle = rgba(N ? tone(P.blue, .12, .6) : tone(P.magenta, .55, .5), N ? .45 : .3);
      fx.beginPath(); ellipse(fx, x + 60 * s, b + 6 * s, 230 * s, 26 * s); fx.fill();
      fx.fillStyle = trunk;
      fx.beginPath(); taper(fx, bez([x, b], [x + 6 * s, b - 120 * s], [x - 10 * s, b - 220 * s], [x + 4 * s, b - 300 * s], 14), 30 * s, 12 * s); fx.fill();
      const ends = [];
      for (let i = 0; i < 6; i++) {
        const ex = x + rand(r, -200, 200) * s, ey = b - rand(r, 330, 470) * s;
        fx.beginPath(); taper(fx, bez([x, b - 220 * s], [x + (ex - x) * .3, b - 300 * s], [ex, ey + 60 * s], [ex, ey], 12), 14 * s, 4 * s); fx.fill();
        ends.push([ex, ey - 30 * s]);
      }
      ends.push([x, b - 500 * s], [x - 90 * s, b - 470 * s], [x + 100 * s, b - 480 * s], [x, b - 410 * s], [x - 60 * s, b - 390 * s], [x + 70 * s, b - 395 * s]);
      // The crown: many small clusters around the branch ends, with a few gaps where the sky shows.
      const small = s < .4, pts = [];
      ends.forEach(([ex, ey], i) => crownPoints(r, ex, ey, 110 * s, 72 * s, small ? 5 : 20, 17 * s, small || i % 2 ? 0 : 1).forEach(p => {
        if (!pts.some(([px, py]) => Math.hypot(p[0] - px, p[1] - py) < 18 * s)) pts.push(p);
      }));
      // Twigs reach out to the clusters and show in the gaps.
      pts.forEach(([px, py], i) => {
        if (i % 3) return;
        const [ex, ey] = ends.reduce((best, e) => (Math.hypot(e[0] - px, e[1] - py) < Math.hypot(best[0] - px, best[1] - py) ? e : best));
        fx.beginPath(); taper(fx, bez([ex, ey + 30 * s], [lerp(ex, px, .4), ey + 10 * s], [lerp(ex, px, .8), py + 10 * s], [px, py], 8), 6 * s, 2 * s); fx.fill();
      });
      leafClusters(cx2, r, pts, 24 * s, { dark: C.dark, base: C.base, lit: mixHex(C.base, C.lit, .7) }, -.5, -.85, small ? 3 : 10, true);
    };
    [[860, yH + 4, .16], [1150, yH + 6, .2], [700, yH + 8, .26], [1330, yH + 12, .3]].forEach(([x, b, s]) => tree(x, b, s));
    tree(1640, 760, .95); tree(1880, 800, 1.1);
    tree(250, 820, 1.35);
    // Halation: the bright parts bleed light, as on infrared film. The foliage gets a halo of its own.
    blit(ctx, F);
    soft(ctx, x => x.drawImage(F, 0, 0, W, H), { scale: .25, blur: 22, alpha: N ? .35 : .3, op: 'screen' });
    blit(ctx, CR);
    soft(ctx, x => x.drawImage(CR, 0, 0, W, H), { scale: .25, blur: 6, alpha: N ? .6 : .45, op: 'screen' });
    soft(ctx, x => x.drawImage(CR, 0, 0, W, H), { scale: .2, blur: 30, alpha: N ? .5 : .35, op: 'screen' });
    vignette(ctx, P, N ? .6 : .2);
    grain(ctx, seedOf(r), N ? .05 : .04);
  });

  // ---------- sky/overcast ----------

  scene('sky', 'overcast', (ctx, P, r) => {
    const N = P.night, yH = 905, cn = makeNoise(seedOf(r));
    const grey = (L) => tone(P.foreground, L, .6);
    const sun = N ? tone(P.accent, .8, .9) : tone(P.accent, .93, .55), sunCore = N ? tone(P.bright_blue, .93, .6) : '#ffffff';
    const bx = 1380, by = 250;
    skyGradient(ctx, N
      ? [[0, grey(.2)], [.6, grey(.3)], [1, grey(.42)]]
      : [[0, grey(.74)], [.6, grey(.84)], [1, grey(.92)]], 0, yH);
    // The bright sky behind the break.
    glow(ctx, bx, by, N ? 700 : 900, sun, N ? .6 : .7);
    glow(ctx, bx, by, 260, sunCore, N ? .85 : .95);
    // A deck of grey clouds in perspective with a break near the sun.
    clouds(ctx, [0, 0, W, yH - 120], .75, (x, y) => {
      const z = 1 / Math.max(.1, (yH - y) / yH), X = (x - W / 2) / W * z * 2.2, Z = z * 2;
      const hole = Math.exp(-(((x - bx) / 330) ** 2) - (((y - by) / 170) ** 2)) * 1.25 + Math.exp(-(((x - bx + 160) / 520) ** 2) - (((y - by - 40) / 90) ** 2)) * .5;
      return fbm(cn, X + 2, Z, 5) * 1.2 + fbm(cn, X * .3, Z * .3 + 5, 2) * .5 + .42 - hole - clamp((z - 5) * .05, 0, .4) - clamp((y - yH + 260) / 200, 0, 1) * 1.6;
    }, N
      ? { lx: (bx - W / 2) * .01, ly: -14, lit: grey(.46), shade: grey(.2), rim: mixHex(grey(.6), sun, .5), alpha: 1, edge: .1, gain: 4 }
      : { lx: (bx - W / 2) * .01, ly: -14, lit: grey(.9), shade: grey(.62), rim: mixHex('#ffffff', sun, .5), alpha: 1, edge: .1, gain: 4 });
    // The deck fades into a grey haze toward the horizon.
    ctx.fillStyle = linear(ctx, 0, yH - 330, 0, yH, N ? [[0, rgba(grey(.3), 0)], [.6, rgba(grey(.32), .7)], [1, grey(.36)]] : [[0, rgba(grey(.86), 0)], [.6, rgba(grey(.88), .75)], [1, grey(.9)]]);
    ctx.fillRect(0, yH - 330, W, 332);
    // Light spills over the cloud edges near the break.
    glow(ctx, bx, by, 620, sun, N ? .3 : .35, 'screen');
    glow(ctx, bx, by, 180, sunCore, N ? .35 : .5, 'screen');
    // Rays fan down from the break.
    soft(ctx, x => {
      for (let i = 0; i < 16; i++) {
        const a = Math.PI / 2 + rand(r, -.95, .55), w = rand(r, .012, .04), len = 1500;
        x.fillStyle = linear(x, bx, by, bx + Math.cos(a) * 900, by + Math.sin(a) * 900, [[0, rgba(sun, rand(r, .25, .5))], [1, rgba(sun, 0)]]);
        x.beginPath(); poly(x, [[bx, by], [bx + Math.cos(a - w) * len, by + Math.sin(a - w) * len], [bx + Math.cos(a + w) * len, by + Math.sin(a + w) * len]]); x.fill();
      }
    }, { scale: .25, blur: 10, alpha: N ? .55 : .6, op: 'screen' });
    // A calm sea below, with a patch of light under the rays, and a low headland.
    ctx.fillStyle = linear(ctx, 0, yH, 0, H, N ? [[0, grey(.36)], [1, grey(.2)]] : [[0, grey(.86)], [1, grey(.7)]]);
    ctx.fillRect(0, yH, W, H - yH);
    ctx.save(); ctx.beginPath(); ctx.rect(0, yH, W, H - yH); ctx.clip();
    ctx.fillStyle = radial(ctx, 1150, yH + 40, 0, 520, [[0, rgba(sunCore, N ? .55 : .8)], [.3, rgba(sun, N ? .35 : .45)], [1, rgba(sun, 0)]]);
    ctx.save(); ctx.translate(1150, yH + 40); ctx.scale(1, .16); ctx.translate(-1150, -(yH + 40)); ctx.fillRect(500, yH - 600, 1300, 1400); ctx.restore();
    ripples(ctx, r, yH + 2, H, 220, N ? sun : '#ffffff', N ? .3 : .5, 800, 1500);
    ripples(ctx, r, yH + 2, H, 160, N ? grey(.5) : grey(.96), .35);
    ctx.restore();
    const head = [];
    for (let x = -20; x <= 720; x += 8) head.push([x, yH + 2 - 46 * Math.max(0, 1 - (x / 720) ** 2) * (1 + .15 * fbm(cn, x * .01, 9, 3)) - (x < 200 ? 10 : 0)]);
    head.push([720, yH + 2]);
    ctx.fillStyle = N ? grey(.16) : grey(.56); ctx.beginPath(); poly(ctx, [...head, [-20, yH + 2]]); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, yH - 60, 0, yH + 4, [[0, rgba(N ? grey(.4) : grey(.92), 0)], [1, rgba(N ? grey(.4) : grey(.92), .5)]]); ctx.fillRect(0, yH - 60, W, 64);
    vignette(ctx, P, N ? .45 : .12);
    grain(ctx, seedOf(r), N ? .045 : .035);
  });

  // ---------- sky/planetarium ----------

  // The classic star projector: 2 star balls on a tilted axis, a cage between them, on a fork and pedestal.
  function projector(x, cx, cy, s, C, lenses) {
    const a = -.32, dx = Math.cos(a) * 190 * s, dy = Math.sin(a) * 190 * s;
    const [ax, ay] = [cx - dx, cy - dy], [bx, by] = [cx + dx, cy + dy];
    // Pedestal and fork.
    x.fillStyle = C.body;
    x.beginPath(); poly(x, [[cx - 70 * s, 1100], [cx + 70 * s, 1100], [cx + 40 * s, cy + 150 * s], [cx - 40 * s, cy + 150 * s]]); x.fill();
    x.beginPath(); poly(x, [[cx - 120 * s, cy + 160 * s], [cx + 120 * s, cy + 160 * s], [cx + 90 * s, cy + 120 * s], [cx - 90 * s, cy + 120 * s]]); x.fill();
    x.lineWidth = 22 * s; x.strokeStyle = C.body; x.lineCap = 'round';
    x.beginPath(); x.moveTo(cx - 90 * s, cy + 130 * s); x.lineTo(cx - 40 * s, cy + 10 * s); x.moveTo(cx + 90 * s, cy + 130 * s); x.lineTo(cx + 40 * s, cy - 10 * s); x.stroke();
    // The cage of planet projectors along the axis.
    x.lineWidth = 6 * s;
    for (let i = -3; i <= 3; i++) {
      const t = i / 4, px = cx + dx * t, py = cy + dy * t;
      x.beginPath(); x.moveTo(px - Math.sin(a) * 46 * s, py + Math.cos(a) * 46 * s); x.lineTo(px + Math.sin(a) * 46 * s, py - Math.cos(a) * 46 * s); x.stroke();
    }
    for (const k of [-1, 1]) { x.beginPath(); x.moveTo(ax - Math.sin(a) * 40 * s * k, ay + Math.cos(a) * 40 * s * k); x.lineTo(bx - Math.sin(a) * 40 * s * k, by + Math.cos(a) * 40 * s * k); x.stroke(); }
    x.fillStyle = C.body;
    for (let i = -2; i <= 2; i++) { const t = i / 3.2; x.beginPath(); circle(x, cx + dx * t, cy + dy * t, 16 * s); x.fill(); }
    // The star balls with lenses.
    for (const [px, py] of [[ax, ay], [bx, by]]) {
      x.fillStyle = radial(x, px - 25 * s, py - 30 * s, 0, 95 * s, [[0, C.lit], [.5, C.body], [1, C.dark]]);
      x.beginPath(); circle(x, px, py, 82 * s); x.fill();
      for (let i = 0; i < 90; i++) {
        const u = (i * 2.399) % TAU, v = Math.acos(1 - 2 * ((i + .5) / 90));
        const lx = Math.sin(v) * Math.cos(u), ly = Math.cos(v), lz = Math.sin(v) * Math.sin(u);
        if (lz < .1) continue;
        x.fillStyle = lenses; x.globalAlpha = .3 + lz * .7;
        x.beginPath(); circle(x, px + lx * 74 * s, py + ly * 74 * s, (1.6 + lz * 2.6) * s); x.fill();
      }
      x.globalAlpha = 1;
    }
  }

  scene('sky', 'planetarium', (ctx, P, r) => {
    const N = P.night, n = makeNoise(seedOf(r));
    const rimY = 830, rimRX = 1500, rimRY = 300, rimCX = 960, rimCY = rimY + rimRY;
    const rimAt = x => rimCY - rimRY * Math.sqrt(Math.max(0, 1 - ((x - rimCX) / rimRX) ** 2));
    // The dome.
    skyGradient(ctx, N
      ? [[0, tone(P.blue, .1, .5)], [.6, tone(P.blue, .16, .5)], [1, tone(P.blue, .24, .5)]]
      : [[0, mixHex(P.background, '#ffffff', .3)], [.7, P.background], [1, tone(P.blue, .9, .3)]]);
    const zx = 960, zy = -520;
    // The grid of the dome: circles of altitude and lines toward the zenith.
    ctx.save(); ctx.strokeStyle = N ? rgba(P.blue, .1) : rgba(tone(P.blue, .6, .4), .2); ctx.lineWidth = N ? 1 : 1.2;
    for (let k = 1; k <= 7; k++) { const t = k / 8; ctx.beginPath(); ellipse(ctx, zx, lerp(rimCY, zy, t), rimRX * (1 - t * .8), rimRY * (1 - t * .7)); ctx.stroke(); }
    for (let k = -12; k <= 12; k++) { const x = rimCX + k * 140; ctx.beginPath(); ctx.moveTo(zx, zy); ctx.quadraticCurveTo(lerp(zx, x, .9), lerp(zy, rimAt(x), .5), x, rimAt(x)); ctx.stroke(); }
    ctx.restore();
    // The Milky Way: a diagonal band of glow, nebulae and dense stars.
    const band = (x) => 120 + x * .38;
    soft(ctx, x => {
      for (let i = 0; i < 90; i++) {
        const px = rand(r, -100, W + 100), py = band(px) + rand(r, -1, 1) * rand(r, 20, 120);
        const c = [P.blue, P.magenta, P.cyan, P.green][Math.floor(r() * 4)];
        x.fillStyle = rgba(N ? c : tone(c, .8, .5), N ? rand(r, .04, .12) : rand(r, .05, .12));
        x.beginPath(); ellipse(x, px, py, rand(r, 60, 200), rand(r, 20, 60), .36); x.fill();
      }
    }, { scale: .25, blur: 26, op: N ? 'lighter' : 'source-over' });
    const starCols = N ? [P.foreground, P.bright_blue, P.bright_yellow, P.bright_red, P.bright_cyan] : [tone(P.blue, .45, .8), tone(P.blue, .55, .6), tone(P.magenta, .5, .6)];
    stars(ctx, r, N ? 900 : 380, [0, 0, W, rimY], starCols, N ? 1.6 : 1.4);
    for (let i = 0; i < (N ? 700 : 260); i++) {
      const px = rand(r, 0, W), py = band(px) + (r() - .5) * rand(r, 0, 220);
      if (py > rimAt(px)) continue;
      ctx.globalAlpha = rand(r, .3, .9); ctx.fillStyle = starCols[Math.floor(r() * starCols.length)];
      ctx.beginPath(); circle(ctx, px, py, rand(r, .4, 1.3)); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // A few constellations: bright stars joined by thin lines.
    const figures = [
      [[180, 150], [260, 190], [330, 170], [400, 230], [470, 210], [530, 280], [600, 300]],
      [[1450, 120], [1520, 180], [1620, 160], [1580, 260], [1500, 300], [1450, 230], [1520, 180]],
      [[860, 520], [930, 470], [1010, 500], [1060, 440], [1130, 470]],
      [[1680, 520], [1760, 480], [1840, 540], [1770, 600], [1680, 520]],
      [[260, 560], [330, 520], [380, 590], [450, 560]],
    ];
    ctx.save(); ctx.strokeStyle = N ? rgba(P.blue, .55) : rgba(tone(P.blue, .5, .8), .45); ctx.lineWidth = 1.4;
    figures.forEach(f => { ctx.beginPath(); f.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); });
    ctx.restore();
    figures.forEach(f => f.forEach(([x, y]) => {
      if (N) glow(ctx, x, y, 16, P.bright_blue, .5);
      ctx.fillStyle = N ? P.bright_foreground : tone(P.blue, .4, .9); ctx.beginPath(); circle(ctx, x, y, N ? 2.8 : 3.2); ctx.fill();
    }));
    // The rim: a projected horizon of trees, a cove light and the dark edge of the dome.
    const hz = [];
    for (let x = -20; x <= W + 20; x += 5) hz.push([x, rimAt(x) - 6 - 26 * (fbm(n, x * .01, 3, 4) + .5) - (Math.abs(Math.sin(x * .05)) * 8)]);
    glow(ctx, 960, rimY + 40, 1300, N ? P.blue : tone(P.yellow, .9, .5), N ? .18 : .4);
    fillRidge(ctx, hz, N ? tone(P.blue, .08, .4) : tone(P.blue, .72, .25));
    ctx.save(); ctx.strokeStyle = N ? rgba(P.bright_blue, .6) : rgba(tone(P.yellow, .8, .8), .9); ctx.lineWidth = 3;
    ctx.beginPath(); ellipse(ctx, rimCX, rimCY + 4, rimRX, rimRY); ctx.stroke(); ctx.restore();
    soft(ctx, x => { x.strokeStyle = N ? P.blue : tone(P.yellow, .85, .8); x.lineWidth = 16; x.beginPath(); ellipse(x, rimCX, rimCY + 6, rimRX, rimRY); x.stroke(); }, { scale: .25, blur: 14, alpha: N ? .7 : .6, op: N ? 'lighter' : 'source-over' });
    ctx.fillStyle = N ? tone(P.blue, .06, .4) : tone(P.blue, .8, .2);
    ctx.beginPath(); ellipse(ctx, rimCX, rimCY + 12, rimRX, rimRY); ctx.fill();
    // Rows of seats, curved like the rim. At night they are dark shapes.
    if (N) {
      const seat = tone(P.blue, .1, .4), seatLit = tone(P.blue, .2, .5);
      for (let row = 0; row < 5; row++) {
        const t = row / 4, ry = lerp(905, 1070, t ** 1.2), sw = lerp(34, 74, t), sh = lerp(40, 92, t);
        for (let x = -40 + (row % 2) * sw * .6; x < W + 60; x += sw * 1.3) {
          const y = ry + ((x - 960) / 960) ** 2 * -60 * (1 - t);
          ctx.fillStyle = seat; ctx.beginPath(); ctx.roundRect(x - sw / 2, y - sh, sw, sh * 1.2, sw * .35); ctx.fill();
          ctx.fillStyle = seatLit; ctx.beginPath(); ctx.roundRect(x - sw / 2 + sw * .12, y - sh + 2, sw * .76, sh * .12, sw * .2); ctx.fill();
        }
      }
    } else {
      // By day the seats show as reclining seats from behind: a curved back, a headrest, a seam and armrests.
      const base = tone(P.blue, .64, .42), lit = tone(P.blue, .82, .32), dark = tone(P.blue, .48, .42), arm = tone(P.blue, .42, .3);
      for (let row = 0; row < 5; row++) {
        const t = row / 4, ry = lerp(910, 1080, t ** 1.2), sw = lerp(38, 84, t), sh = lerp(46, 104, t);
        for (let x = -40 + (row % 2) * sw * .55; x < W + 60; x += sw * 1.14) {
          const y = ry + ((x - 960) / 960) ** 2 * -60 * (1 - t);
          const back = new Path2D();
          back.moveTo(x - sw * .34, y + sh * .15);
          back.bezierCurveTo(x - sw * .4, y - sh * .3, x - sw * .54, y - sh * .6, x - sw * .5, y - sh * .82);
          back.quadraticCurveTo(x, y - sh * 1.04, x + sw * .5, y - sh * .82);
          back.bezierCurveTo(x + sw * .54, y - sh * .6, x + sw * .4, y - sh * .3, x + sw * .34, y + sh * .15);
          back.closePath();
          ctx.fillStyle = rgba(dark, .35); ctx.beginPath(); ellipse(ctx, x + sw * .06, y + sh * .16, sw * .5, sh * .07); ctx.fill();
          ctx.fillStyle = linear(ctx, 0, y - sh, 0, y + sh * .15, [[0, lit], [.35, base], [1, dark]]);
          ctx.fill(back);
          ctx.save(); ctx.clip(back);
          ctx.fillStyle = linear(ctx, x - sw * .5, 0, x + sw * .5, 0, [[0, rgba(lit, .35)], [.35, rgba(lit, 0)], [.65, rgba(dark, 0)], [1, rgba(dark, .6)]]);
          ctx.fillRect(x - sw * .6, y - sh * 1.1, sw * 1.2, sh * 1.3);
          // The headrest leans back toward the viewer, so its top shows as a lit band with a shadow under it.
          ctx.fillStyle = rgba(lit, .85); ctx.beginPath();
          ctx.moveTo(x - sw * .52, y - sh * .8); ctx.quadraticCurveTo(x, y - sh * 1.04, x + sw * .52, y - sh * .8);
          ctx.lineTo(x + sw * .5, y - sh * .68); ctx.quadraticCurveTo(x, y - sh * .86, x - sw * .5, y - sh * .68); ctx.closePath(); ctx.fill();
          ctx.strokeStyle = rgba(dark, .6); ctx.lineWidth = Math.max(1, sw * .035);
          ctx.beginPath(); ctx.moveTo(x - sw * .5, y - sh * .68); ctx.quadraticCurveTo(x, y - sh * .86, x + sw * .5, y - sh * .68); ctx.stroke();
          ctx.strokeStyle = rgba(dark, .4); ctx.lineWidth = Math.max(1, sw * .025);
          ctx.beginPath(); ctx.moveTo(x, y - sh * .76); ctx.lineTo(x, y + sh * .12); ctx.stroke();
          ctx.restore();
          ctx.fillStyle = arm; ctx.beginPath(); ctx.roundRect(x + sw * .5, y - sh * .3, sw * .1, sh * .48, sw * .04); ctx.fill();
        }
      }
    }
    // The projector, with faint beams up to the dome at night.
    const pcx = 1250, pcy = 760;
    if (N) soft(ctx, x => {
      x.fillStyle = rgba(P.bright_blue, .05);
      for (let i = 0; i < 14; i++) { const a = rand(r, -2.6, -.5), w = .015; x.beginPath(); poly(x, [[pcx, pcy], [pcx + Math.cos(a - w) * 1600, pcy + Math.sin(a - w) * 1600], [pcx + Math.cos(a + w) * 1600, pcy + Math.sin(a + w) * 1600]]); x.fill(); }
    }, { scale: .25, blur: 8, op: 'lighter' });
    projector(ctx, pcx, pcy, .9, N
      ? { body: tone(P.blue, .1, .4), dark: tone(P.blue, .06, .4), lit: tone(P.blue, .32, .5) }
      : { body: tone(P.blue, .62, .18), dark: tone(P.blue, .48, .22), lit: tone(P.blue, .92, .12) }, N ? P.bright_yellow : tone(P.blue, .38, .5));
    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, seedOf(r), N ? .04 : .03);
  });

  // ---------- ice/ice-cave ----------

  scene('ice', 'ice-cave', (ctx, P, r) => {
    const N = P.night, O = [1150, 330], mid = [960, 600];
    // The sky beyond the opening, with far peaks.
    skyGradient(ctx, N
      ? [[0, tone(P.blue, .2, .6)], [.5, tone(P.blue, .32, .6)], [1, tone(P.cyan, .5, .5)]]
      : [[0, tone(P.blue, .8, .4)], [.5, tone(P.cyan, .92, .2)], [1, '#ffffff']], 60, 600);
    if (N) {
      stars(ctx, r, 260, [800, 80, 1500, 560], [P.foreground, P.bright_cyan], 1.6);
      glow(ctx, 1300, 190, 260, P.bright_cyan, .45);
      ctx.fillStyle = tone(P.foreground, .95, .3); ctx.beginPath(); circle(ctx, 1300, 190, 24); ctx.fill();
    } else glow(ctx, 1260, 220, 420, '#ffffff', .9);
    range(ctx, r, {
      C: N ? { lit: tone(P.cyan, .48, .5), shade: tone(P.blue, .34, .5), snow: tone(P.foreground, .82, .3), snowShade: tone(P.cyan, .58, .5) }
        : { lit: tone(P.cyan, .9, .25), shade: tone(P.blue, .82, .3), snow: '#ffffff', snowShade: tone(P.cyan, .92, .2) },
      base: 560, start: [820, 560], end: [1500, 560], peaks: [[930, 440], [1060, 400], [1200, 455], [1330, 420]], light: -1, rough: .14, snow: .5, streaks: 2, scale: .5,
    });
    // Rings of ice from the opening out to the viewer. Each ring is the frame with a hole.
    const base = blobPts(r, 0, 0, 300, 215, 22, .2);
    const ringCol = t => N
      ? mixHex(mixHex(tone(P.cyan, .62, .8), tone(P.blue, .34, .9), clamp(t * 1.6, 0, 1)), tone(P.red, .22, .9), clamp(t * 1.4 - .5, 0, 1))
      : mixHex(mixHex(mixHex(tone(P.cyan, .97, .25), '#ffffff', .4), tone(P.blue, .8, .55), clamp(t * 1.6, 0, 1)), tone(P.red, .7, .6), clamp(t * 1.4 - .5, 0, 1));
    const K = 7, edges = [];
    for (let k = 0; k < K; k++) {
      const t = k / (K - 1), sc = 1 + 2.7 * t ** 1.5, cx = lerp(O[0], mid[0], t * .7), cy = lerp(O[1], mid[1], t * .8);
      const hole = base.map(([x, y]) => { const j = 1 + (r() - .5) * .16 * (1 + t); return [cx + x * sc * j, cy + y * sc * j * (1 + t * .25)]; });
      const col = ringCol(t), inner = N ? mixHex(col, P.bright_cyan, .55 - t * .3) : mixHex(col, '#ffffff', .75 - t * .4);
      const ring = new Path2D(); ring.rect(-50, -50, W + 100, H + 100); smoothPath(ring, hole, true);
      ctx.fillStyle = radial(ctx, cx, cy, 200 * sc, 330 * sc + 300, [[0, inner], [.35, col], [1, mixHex(col, N ? '#000000' : tone(P.blue, .5, .6), N ? .45 : .2)]]);
      ctx.fill(ring, 'evenodd');
      // Scallops: shallow cups in the ice, with a soft light on the side toward the opening.
      // Bands of older, bluer ice follow the ring.
      const bands = [1, 2, 3].map(() => [rand(r, 1.12, 1.6), rand(r, 8, 22) * sc * .5]);
      ctx.save(); ctx.clip(ring, 'evenodd');
      soft(ctx, sx => {
        for (let i = 0; i < 80; i++) {
          const a = r() * TAU, d = rand(r, 1.02, 1.75), x = cx + Math.cos(a) * 300 * sc * d, y = cy + Math.sin(a) * 215 * sc * d;
          if (x < -100 || x > W + 100 || y < -100 || y > H + 100) continue;
          const sz = rand(r, 30, 70) * (.5 + sc * .35), toward = Math.atan2(cy - y, cx - x);
          const dark = N ? '#000000' : tone(P.blue, .55, .6);
          sx.fillStyle = radial(sx, x - Math.cos(toward) * sz * .15, y - Math.sin(toward) * sz * .15, 0, sz * .9, [[0, rgba(dark, N ? .14 : .1)], [1, rgba(dark, 0)]]);
          sx.beginPath(); ellipse(sx, x, y, sz, sz * .75, toward + Math.PI / 2); sx.fill();
          const hx = x + Math.cos(toward) * sz * .55, hy = y + Math.sin(toward) * sz * .55;
          sx.fillStyle = radial(sx, hx, hy, 0, sz * .5, [[0, rgba(inner, N ? .22 : .4)], [1, rgba(inner, 0)]]);
          sx.beginPath(); ellipse(sx, hx, hy, sz * .5, sz * .3, toward + Math.PI / 2); sx.fill();
        }
        sx.filter = `blur(${((5 + 6 * t) * .3).toFixed(2)}px)`;
        sx.globalAlpha = N ? .35 : .3;
        sx.strokeStyle = N ? tone(P.blue, .2, .9) : tone(P.blue, .72, .6);
        bands.forEach(([k2, lw]) => { sx.lineWidth = lw; sx.beginPath(); smoothPath(sx, hole.map(([hx, hy]) => [cx + (hx - cx) * k2, cy + (hy - cy) * k2]), true); sx.stroke(); });
        sx.filter = 'none'; sx.globalAlpha = 1;
      }, { scale: .3 });
      ctx.restore();
      edges.push([hole, inner, t]);
      // Icicles hang from the top of the hole.
      const ic = N ? mixHex(inner, P.bright_cyan, .3) : mixHex(inner, '#ffffff', .5);
      hole.forEach(([x, y]) => {
        if (y > cy - 40 * sc || r() < .3) return;
        const n = 1 + Math.floor(r() * 3);
        for (let q = 0; q < n; q++) {
          const ix = x + rand(r, -30, 30) * sc * .5, iy = y + 6 * sc * .5, len = rand(r, 30, 110) * (.4 + sc * .3), w = len * rand(r, .1, .16);
          ctx.fillStyle = linear(ctx, ix - w, 0, ix + w, 0, [[0, col], [.5, ic], [1, mixHex(col, ic, .3)]]);
          ctx.beginPath(); poly(ctx, [[ix - w, iy - 4], [ix + w, iy - 4], [ix + w * .2, iy + len * .7], [ix, iy + len], [ix - w * .3, iy + len * .6]]); ctx.fill();
        }
      });
    }
    // Light through thin ice along the edge of each hole.
    soft(ctx, x => {
      edges.forEach(([hole, inner, t]) => {
        x.filter = `blur(${((14 + 20 * t) * .25).toFixed(2)}px)`; x.globalAlpha = N ? .7 - t * .3 : .8 - t * .3;
        x.strokeStyle = inner; x.lineWidth = 10 + 18 * t; x.beginPath(); smoothPath(x, hole, true); x.stroke();
      });
    }, { scale: .25, op: 'screen' });
    // Light falls in through the opening and shines on the wet floor.
    soft(ctx, x => {
      x.fillStyle = rgba(N ? P.bright_cyan : '#ffffff', N ? .12 : .35);
      for (let i = 0; i < 5; i++) { const a = rand(r, 1.7, 2.3); x.beginPath(); poly(x, [[O[0] + rand(r, -150, 150), O[1] + 120], [O[0] + Math.cos(a - .1) * 1200, O[1] + Math.sin(a - .1) * 1200], [O[0] + Math.cos(a + .1) * 1200, O[1] + Math.sin(a + .1) * 1200]]); x.fill(); }
    }, { scale: .25, blur: 26, op: 'screen' });
    ctx.save(); ctx.translate(1000, 960); ctx.scale(1, .22);
    glow(ctx, 0, 0, 520, N ? P.bright_cyan : '#ffffff', N ? .3 : .7, 'screen');
    ctx.restore();
    vignette(ctx, P, N ? .55 : .1);
    grain(ctx, seedOf(r), N ? .045 : .03);
  });

  // ---------- fire/forge ----------

  scene('fire', 'forge', (ctx, P, r) => {
    const N = P.night;
    const hot = [1235, 744];
    // Heat colors from white hot to dull red. The day slots are dark, so the day uses light tones.
    const H1 = N ? P.bright_yellow : tone(P.yellow, .96, .5), H2 = N ? P.yellow : tone(P.yellow, .86, 1), H3 = N ? P.accent : tone(P.accent, .68, 1), H4 = N ? tone(P.red, .32, .8) : tone(P.red, .5, .9);
    // The brick wall.
    const wallBase = N ? tone(P.red, .16, .35) : tone(P.orange, .9, .12), wallAlt = N ? tone(P.brown, .14, .4) : tone(P.orange, .86, .15), mortar = N ? tone(P.red, .09, .3) : tone(P.orange, .8, .1);
    ctx.fillStyle = mortar; ctx.fillRect(0, 0, W, H);
    for (let y = 0, row = 0; y < 920; y += 34, row++) for (let x = (row % 2) * -45; x < W; x += 90) {
      ctx.fillStyle = mixHex(wallBase, wallAlt, r()); ctx.fillRect(x + 2, y + 2, 86, 30);
    }
    if (!N) {
      // A window lets daylight in from the upper right.
      ctx.fillStyle = tone(P.orange, .7, .2); ctx.fillRect(1530, 110, 290, 330);
      ctx.fillStyle = linear(ctx, 0, 120, 0, 430, [[0, '#ffffff'], [1, tone(P.cyan, .95, .2)]]); ctx.fillRect(1546, 126, 258, 298);
      ctx.fillStyle = tone(P.orange, .66, .2); ctx.fillRect(1670, 126, 10, 298); ctx.fillRect(1546, 270, 258, 10);
      soft(ctx, x => { x.fillStyle = rgba('#ffffff', .5); x.beginPath(); poly(x, [[1546, 126], [1804, 126], [1300, 1080], [700, 1080]]); x.fill(); }, { scale: .2, blur: 30, alpha: .6 });
    }
    // Firelight on the wall: bright near the hearth, dark far away.
    ctx.fillStyle = radial(ctx, 330, 640, 0, 1500, N
      ? [[0, rgba(P.orange, .45)], [.25, rgba(P.red, .2)], [.6, rgba('#000000', .45)], [1, rgba('#000000', .8)]]
      : [[0, rgba(P.orange, .25)], [.3, rgba(P.orange, .08)], [1, rgba(P.orange, 0)]]);
    ctx.fillRect(0, 0, W, H);
    // The floor.
    ctx.fillStyle = linear(ctx, 0, 900, 0, H, N ? [[0, tone(P.brown, .16, .4)], [1, tone(P.brown, .09, .4)]] : [[0, tone(P.orange, .78, .12)], [1, tone(P.orange, .68, .14)]]);
    ctx.fillRect(0, 900, W, H - 900);
    ctx.strokeStyle = rgba('#000000', N ? .3 : .08); ctx.lineWidth = 2;
    for (const y of [940, 995, 1060]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    for (let i = 0; i < 26; i++) { const y = [900, 940, 995][i % 3], x = rand(r, 0, W); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x - 960) * .06, [940, 995, 1060][i % 3]); ctx.stroke(); }
    glow(ctx, 600, 920, 900, P.orange, N ? .25 : .12);
    ctx.fillStyle = rgba('#000000', N ? .35 : .12); ctx.beginPath(); ellipse(ctx, 1380, 1078, 230, 22); ctx.fill();
    // The hood over the hearth, lit from below.
    const metal = N ? tone(P.brown, .12, .3) : tone(P.foreground, .42, .15), metalLit = N ? tone(P.orange, .45, .8) : tone(P.orange, .66, .4);
    const hood = [[150, -10], [480, -10], [640, 430], [-10, 430]];
    ctx.fillStyle = linear(ctx, 0, -10, 0, 450, [[0, metal], [.75, mixHex(metal, metalLit, .4)], [1, metalLit]]);
    ctx.beginPath(); poly(ctx, hood); ctx.fill();
    // Side shading, plate seams and rivets.
    ctx.fillStyle = linear(ctx, -10, 0, 640, 0, [[0, rgba('#000000', N ? .35 : .18)], [.35, rgba('#000000', 0)], [.7, rgba('#ffffff', N ? 0 : .08)], [1, rgba('#000000', N ? .3 : .12)]]);
    ctx.beginPath(); poly(ctx, hood); ctx.fill();
    ctx.strokeStyle = rgba('#000000', N ? .35 : .18); ctx.lineWidth = 2;
    for (const y of [110, 230, 340]) { const t = (y + 10) / 440; ctx.beginPath(); ctx.moveTo(lerp(150, -10, t), y); ctx.lineTo(lerp(480, 640, t), y); ctx.stroke(); }
    ctx.fillStyle = rgba(N ? metalLit : '#ffffff', N ? .5 : .5);
    for (const y of [110, 230, 340]) { const t = (y + 10) / 440, x0 = lerp(150, -10, t), x1 = lerp(480, 640, t); for (let x = x0 + 16; x < x1 - 8; x += 26) { ctx.beginPath(); circle(ctx, x, y + 7, 2.4); ctx.fill(); } }
    ctx.fillStyle = metalLit; ctx.fillRect(-10, 424, 650, 14);
    ctx.fillStyle = rgba('#000000', .25); ctx.fillRect(-10, 436, 650, 4);
    // The hearth of brick.
    const brick = N ? tone(P.red, .26, .55) : tone(P.red, .56, .55), brick2 = N ? tone(P.brown, .2, .5) : tone(P.red, .48, .5);
    ctx.fillStyle = mortar; ctx.fillRect(-10, 690, 660, 400);
    for (let y = 694, row = 0; y < H; y += 30, row++) for (let x = -10 + (row % 2) * -38; x < 650; x += 76) {
      ctx.fillStyle = mixHex(brick, brick2, r()); ctx.fillRect(Math.max(-10, x + 2), y + 2, Math.min(72, 648 - x), 26);
    }
    ctx.fillStyle = linear(ctx, 0, 690, 0, 900, [[0, rgba(P.orange, N ? .35 : .15)], [1, rgba(P.orange, 0)]]); ctx.fillRect(-10, 690, 660, 220);
    // The coal bed: dark coals with glowing hearts, hottest in the middle.
    const coals = [];
    for (let i = 0; i < 160; i++) {
      const x = rand(r, 40, 600), heat = Math.exp(-(((x - 320) / 200) ** 2)) * rand(r, .5, 1.1);
      coals.push([x, 690 - rand(r, 0, 40) * Math.exp(-(((x - 320) / 260) ** 2)), rand(r, 10, 22), heat]);
    }
    coals.sort((a, b) => a[1] - b[1]);
    const glowCol = t => t > .7 ? mixHex(H2, H1, (t - .7) / .3) : t > .35 ? mixHex(H3, H2, (t - .35) / .35) : mixHex(H4, H3, t / .35);
    for (const [x, y, s, h] of coals) {
      const pts = blobPts(r, x, y, s, s * .7, 7, .35);
      fillBlob(ctx, pts, N ? tone(P.brown, .12, .3) : tone(P.brown, .2, .3));
      ctx.fillStyle = radial(ctx, x, y, 0, s, [[0, glowCol(clamp(h, 0, 1))], [.6, rgba(glowCol(clamp(h * .7, 0, 1)), .8)], [1, rgba(H4, 0)]]);
      ctx.beginPath(); smoothPath(ctx, pts.map(([px, py]) => [lerp(x, px, .82), lerp(y, py, .82)]), true); ctx.fill();
    }
    // Flames and heat above the coals: a red and orange outer flame and a pale core.
    const flames = [];
    for (let i = 0; i < 26; i++) {
      const fx = rand(r, 120, 520), h = rand(r, 60, 200) * Math.exp(-(((fx - 320) / 220) ** 2)), w = rand(r, 14, 30);
      flames.push([fx, h, w, rand(r, -20, 20)]);
    }
    const flame = (x, fx, h, w, lean, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(fx - w, 690); x.quadraticCurveTo(fx - w * .6, 680 - h * .5, fx + lean, 680 - h); x.quadraticCurveTo(fx + w * .6, 680 - h * .5, fx + w, 690); x.fill(); };
    soft(ctx, x => {
      flames.forEach(([fx, h, w, lean]) => flame(x, fx, h, w, lean, linear(x, 0, 690, 0, 680 - h, [[0, rgba(H3, .95)], [.5, rgba(H4, .7)], [1, rgba(H4, 0)]])));
      flames.forEach(([fx, h, w, lean]) => flame(x, fx, h * .6, w * .55, lean * .6, linear(x, 0, 690, 0, 680 - h * .6, [[0, rgba(H1, 1)], [.5, rgba(H2, .8)], [1, rgba(H3, 0)]])));
    }, { scale: .5, blur: 4, op: N ? 'lighter' : 'source-over' });
    glow(ctx, 320, 660, 420, H3, N ? .45 : .3, N ? 'lighter' : 'source-over');
    // Tools hang from pegs on a plank on the right wall: tongs with their jaws down, and hammers.
    const tool = N ? tone(P.brown, .1, .3) : tone(P.foreground, .3, .15), plank = N ? tone(P.brown, .16, .5) : tone(P.orange, .5, .4);
    ctx.fillStyle = plank; ctx.fillRect(1500, 512, 420, 22);
    ctx.fillStyle = rgba('#000000', .25); ctx.fillRect(1500, 534, 420, 5);
    ctx.strokeStyle = tool; ctx.fillStyle = tool; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    [[1560, 300], [1640, 340], [1860, 310]].forEach(([x, len]) => {
      const hy = 530 + len * .78, by = 530 + len;
      ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(x - 10, 532); ctx.lineTo(x, hy); ctx.quadraticCurveTo(x + 16, hy + 20, x + 4, by); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x + 10, 532); ctx.lineTo(x, hy); ctx.quadraticCurveTo(x - 16, hy + 20, x - 4, by); ctx.stroke();
      ctx.beginPath(); circle(ctx, x, hy, 6); ctx.fill();
      ctx.beginPath(); circle(ctx, x, 524, 5); ctx.fill();
    });
    [[1730, 250], [1790, 210]].forEach(([x, len]) => {
      ctx.lineWidth = 11; ctx.beginPath(); ctx.moveTo(x, 528); ctx.lineTo(x, 528 + len); ctx.stroke();
      ctx.beginPath(); poly(ctx, [[x - 34, 520 + len], [x + 26, 520 + len], [x + 34, 526 + len], [x + 34, 542 + len], [x + 26, 548 + len], [x - 34, 548 + len]]); ctx.fill();
    });
    // The anvil on its stump.
    const steel = N ? tone(P.brown, .2, .25) : tone(P.foreground, .5, .1), steelLit = N ? tone(P.orange, .6, .8) : tone(P.foreground, .78, .1), wood = N ? tone(P.brown, .2, .5) : tone(P.orange, .5, .45), woodDark = N ? tone(P.brown, .12, .5) : tone(P.orange, .38, .45);
    ctx.fillStyle = linear(ctx, 1230, 0, 1510, 0, [[0, woodDark], [.4, wood], [1, woodDark]]);
    ctx.beginPath(); poly(ctx, [[1236, 930], [1504, 930], [1516, 1090], [1224, 1090]]); ctx.fill();
    ctx.strokeStyle = woodDark; ctx.lineWidth = 3;
    for (let i = 0; i < 9; i++) { const x = rand(r, 1250, 1490); ctx.beginPath(); ctx.moveTo(x, 940); ctx.lineTo(x + rand(r, -6, 6), 1080); ctx.stroke(); }
    ctx.fillStyle = mixHex(wood, steelLit, N ? .15 : .2); ctx.beginPath(); ellipse(ctx, 1370, 930, 136, 14); ctx.fill();
    const anvil = new Path2D();
    anvil.moveTo(1040, 770);
    anvil.quadraticCurveTo(1110, 752, 1185, 752); anvil.lineTo(1565, 752); anvil.lineTo(1590, 760); anvil.lineTo(1585, 790); anvil.lineTo(1500, 796);
    anvil.quadraticCurveTo(1470, 850, 1490, 880); anvil.lineTo(1545, 906); anvil.lineTo(1550, 932); anvil.lineTo(1190, 932); anvil.lineTo(1196, 906); anvil.lineTo(1255, 880);
    anvil.quadraticCurveTo(1275, 846, 1240, 800); anvil.quadraticCurveTo(1150, 792, 1040, 770); anvil.closePath();
    ctx.fillStyle = linear(ctx, 0, 752, 0, 932, [[0, steelLit], [.08, steel], [1, mixHex(steel, '#000000', N ? .3 : .15)]]);
    ctx.fill(anvil);
    ctx.save(); ctx.clip(anvil);
    ctx.fillStyle = linear(ctx, 1040, 0, 1400, 0, [[0, rgba(steelLit, N ? .55 : .3)], [1, rgba(steelLit, 0)]]); ctx.fillRect(1030, 750, 400, 190);
    ctx.restore();
    ctx.fillStyle = mixHex(steel, '#000000', .4); ctx.fillRect(1530, 754, 12, 8);
    ctx.fillStyle = rgba(steelLit, .6); ctx.fillRect(1185, 752, 380, 3);
    // The bar of hot iron, white at the hammered spot and dark at the end.
    const bar = linear(ctx, 1100, 0, 1520, 0, [[0, H4], [.2, H2], [.32, H1], [.45, H3], [.62, H4], [.8, N ? tone(P.brown, .2, .4) : tone(P.foreground, .42, .1)], [1, N ? tone(P.brown, .14, .3) : tone(P.foreground, .36, .1)]]);
    ctx.fillStyle = bar; ctx.beginPath(); ctx.roundRect(1100, 732, 420, 18, 6); ctx.fill();
    ctx.strokeStyle = tool; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(1500, 738); ctx.quadraticCurveTo(1700, 720, 1930, 690); ctx.moveTo(1500, 746); ctx.quadraticCurveTo(1700, 742, 1930, 726); ctx.stroke();
    // Sparks fly from the hot spot in arcs. Gravity pulls them down.
    const sparks = new Path2D(), sparkList = [];
    for (let i = 0; i < (N ? 230 : 170); i++) {
      const a = -Math.PI / 2 + rand(r, -1.45, 1.45) * (r() < .7 ? 1 : .5), v = rand(r, 260, 1000), g = 900, t1 = rand(r, .08, .8), tail = rand(r, .025, .07);
      const pts = [];
      for (let k = 0; k <= 6; k++) { const t = Math.max(0, t1 - tail + tail * k / 6); pts.push([hot[0] + Math.cos(a) * v * t, hot[1] + Math.sin(a) * v * t + .5 * g * t * t]); }
      sparkList.push(pts);
      sparks.moveTo(pts[0][0], pts[0][1]); pts.forEach(([x, y]) => sparks.lineTo(x, y));
    }
    for (let i = 0; i < 45; i++) {
      const x = rand(r, 140, 520), y = rand(r, 200, 640), len = rand(r, 6, 16);
      sparks.moveTo(x, y); sparks.lineTo(x + rand(r, -4, 4), y - len);
    }
    const sparkCore = N ? H1 : tone(P.accent, .62, 1), sparkGlow = N ? H3 : tone(P.accent, .72, 1);
    soft(ctx, x => { x.strokeStyle = sparkGlow; x.lineWidth = 8; x.lineCap = 'round'; x.stroke(sparks); }, { scale: .5, blur: 6, alpha: N ? .9 : .45, op: N ? 'lighter' : 'source-over' });
    ctx.strokeStyle = sparkCore; ctx.lineCap = 'round'; ctx.lineWidth = N ? 2.2 : 2.6; ctx.stroke(sparks);
    if (!N) { ctx.strokeStyle = tone(P.yellow, .9, .9); ctx.lineWidth = 1; ctx.stroke(sparks); }
    // The glow of the hot iron.
    glow(ctx, hot[0], hot[1], 260, H3, N ? .55 : .35, N ? 'lighter' : 'source-over');
    glow(ctx, hot[0], hot[1], 60, H1, N ? .8 : .7, N ? 'lighter' : 'source-over');
    vignette(ctx, P, N ? .55 : .12);
    grain(ctx, seedOf(r), N ? .05 : .035);
  });

})();
