// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Studio scenes: paper, paint and light. Each scene shows its material.
(() => {
  const TAU = Math.PI * 2;
  const rr = (r, a, b) => a + (b - a) * r();
  const pick = (r, list) => list[Math.floor(r() * list.length)];

  // ---------- helpers ----------

  // A color ramp from [t, hex] stops. Returns a function of t in 0..1.
  const ramp = stops => t => {
    t = clamp(t, 0, 1);
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [a, ca] = stops[i - 1], [b, cb] = stops[i];
        return mixHex(ca, cb, (t - a) / (b - a || 1));
      }
    }
    return stops[stops.length - 1][1];
  };

  // The transform that maps the logical frame onto the canvas of ctx. A box
  // layer stores its own.
  function baseOf(ctx) { return ctx.canvas.base || [S, 0, 0, S, 0, 0]; }
  // The transform of ctx in logical units, without the base transform.
  function localOf(ctx) {
    const m = ctx.getTransform(), b = baseOf(ctx);
    return [m.a / b[0], m.b / b[0], m.c / b[0], m.d / b[0], (m.e - b[4]) / b[0], (m.f - b[5]) / b[0]];
  }

  // A full size layer with the same transform as ctx.
  function twin(ctx) {
    const [c, x] = layer();
    x.setTransform(ctx.getTransform());
    return [c, x];
  }
  // Draws a full size layer back onto ctx.
  function put(ctx, c, alpha = 1, op = 'source-over') {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  // Draws shapes with a blur of blur logical units. The work happens on a small
  // canvas, so a wide blur stays cheap at 6K. The draw function gets the same
  // local transform as ctx, and the clip of ctx still applies. box limits the
  // work to [x0, y0, x1, y1] of the frame.
  function soft(ctx, blur, draw, alpha = 1, op = 'source-over', box = null) {
    const ppu = Math.min(S, 1.25, 6 / Math.max(blur, .5)), pad = Math.ceil(blur * 2.5 + 2);
    const [bx0, by0, bx1, by1] = box || [0, 0, W, H];
    const x0 = Math.max(-pad, bx0 - pad), y0 = Math.max(-pad, by0 - pad);
    const x1 = Math.min(W + pad, bx1 + pad), y1 = Math.min(H + pad, by1 + pad);
    if (x1 <= x0 || y1 <= y0) return;
    const w = Math.ceil((x1 - x0) * ppu), h = Math.ceil((y1 - y0) * ppu);
    const a = document.createElement('canvas'); a.width = w; a.height = h;
    const ax = a.getContext('2d');
    ax.scale(ppu, ppu); ax.translate(-x0, -y0); ax.transform(...localOf(ctx));
    draw(ax);
    const b = document.createElement('canvas'); b.width = w; b.height = h;
    const bx = b.getContext('2d');
    bx.filter = `blur(${(blur * ppu).toFixed(2)}px)`;
    bx.drawImage(a, 0, 0);
    ctx.save();
    ctx.setTransform(...baseOf(ctx));
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    // The layer is blurred, so plain bilinear scaling is smooth enough and much faster.
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(b, x0, y0, w / ppu, h / ppu);
    ctx.restore();
  }

  // Builds a texture of w x h pixels over the logical frame. fn gets the
  // logical x and y of a pixel and writes r, g, b and a into out.
  function texture(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data, o = [0, 0, 0, 255];
    for (let j = 0, k = 0; j < h; j++) {
      for (let i = 0; i < w; i++, k += 4) {
        o[3] = 255;
        fn((i + .5) * W / w, (j + .5) * H / h, o);
        d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3];
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  // Draws a texture over the whole frame.
  function cover(ctx, c, alpha = 1, op = 'source-over') {
    ctx.save();
    ctx.setTransform(...baseOf(ctx));
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'low';
    ctx.drawImage(c, 0, 0, W, H);
    ctx.restore();
  }

  // A tile of random texels in 1 color. fn shapes the alpha of each texel.
  function tile(seed, size, color, fn = v => v) {
    const r = rng(seed), c = document.createElement('canvas');
    c.width = c.height = size;
    const x = c.getContext('2d'), img = x.createImageData(size, size), [cr, cg, cb] = rgb(color);
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = cr; img.data[i + 1] = cg; img.data[i + 2] = cb;
      img.data[i + 3] = clamp(fn(r()) * 255, 0, 255);
    }
    x.putImageData(img, 0, 0);
    return c;
  }
  // Fills a rectangle with a tile. 1 texel spans cell logical units. The tile
  // is scaled to output pixels once, so the fill itself copies pixels 1:1.
  function tileFill(ctx, c, cell = 1, alpha = 1, op = 'source-over', rect = [0, 0, W, H]) {
    const nw = c.width, nh = c.height, k = cell * baseOf(ctx)[0];
    const mw = Math.max(2, Math.round(nw * k)), mh = Math.max(2, Math.round(nh * k));
    const wrap = document.createElement('canvas'); wrap.width = nw * 3; wrap.height = nh * 3;
    const wx = wrap.getContext('2d');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) wx.drawImage(c, i * nw, j * nh);
    const big = document.createElement('canvas'); big.width = mw; big.height = mh;
    const bx = big.getContext('2d');
    bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high';
    bx.drawImage(wrap, nw, nh, nw, nh, 0, 0, mw, mh);
    ctx.save();
    ctx.beginPath(); ctx.rect(...rect);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.fillStyle = ctx.createPattern(big, 'repeat'); ctx.fill();
    ctx.restore();
  }
  // A seamless tile of soft noise: random texels, blurred across the tile
  // edges. fn shapes the alpha of each texel after the blur.
  function softTile(seed, size, blur, color, fn = v => v) {
    const r = rng(seed), raw = document.createElement('canvas');
    raw.width = raw.height = size;
    const rx = raw.getContext('2d'), img = rx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
    rx.putImageData(img, 0, 0);
    const big = document.createElement('canvas'); big.width = big.height = size * 3;
    const bx = big.getContext('2d');
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) bx.drawImage(raw, i * size, j * size);
    const out = document.createElement('canvas'); out.width = out.height = size;
    const ox = out.getContext('2d');
    ox.filter = `blur(${blur}px)`;
    ox.drawImage(big, -size, -size);
    ox.filter = 'none';
    const d = ox.getImageData(0, 0, size, size), [cr, cg, cb] = rgb(color);
    let lo = 255, hi = 0;
    for (let i = 0; i < d.data.length; i += 4) { lo = Math.min(lo, d.data[i]); hi = Math.max(hi, d.data[i]); }
    for (let i = 0; i < d.data.length; i += 4) {
      const v = (d.data[i] - lo) / (hi - lo || 1);
      d.data[i] = cr; d.data[i + 1] = cg; d.data[i + 2] = cb; d.data[i + 3] = clamp(fn(v), 0, 1) * 255;
    }
    ox.putImageData(d, 0, 0);
    return out;
  }
  // Paper tooth: soft grain of dark hollows and light peaks, and a few fine specks.
  function tooth(ctx, seed, dark, light, alpha = .5, cell = 1.1) {
    tileFill(ctx, softTile(seed, 192, 1.1, dark, v => smooth(clamp((v - .4) / .6, 0, 1)) * .4), cell * .85, alpha);
    tileFill(ctx, softTile(seed + 1, 192, 1.1, light, v => smooth(clamp((.6 - v) / .6, 0, 1)) * .36), cell * .85, alpha);
    tileFill(ctx, tile(seed + 2, 256, dark, v => (v > .994 ? .5 : 0)), cell, alpha);
  }

  // Paper fibers: short curved hairs in 1 color.
  function fibers(ctx, r, n, color, alpha, width, len, area = [0, 0, W, H]) {
    ctx.save();
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = width; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = rr(r, area[0], area[2]), y = rr(r, area[1], area[3]), a = r() * TAU, l = len * (.35 + r());
      const bend = (r() - .5) * l * .7, ex = x + Math.cos(a) * l, ey = y + Math.sin(a) * l;
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo((x + ex) / 2 - Math.sin(a) * bend, (y + ey) / 2 + Math.cos(a) * bend, ex, ey);
    }
    ctx.stroke();
    ctx.restore();
  }

  // Soft round stains, as foxing on old paper.
  function foxing(ctx, r, n, color, alpha, area = [0, 0, W, H], size = 6) {
    for (let i = 0; i < n; i++) {
      const s = size * (.3 + r() ** 2 * 1.7), x = rr(r, area[0], area[2]), y = rr(r, area[1], area[3]), a = alpha * (.4 + r() * .6);
      ctx.fillStyle = radial(ctx, x, y, 0, s * 1.5, [[0, rgba(color, a)], [.45, rgba(color, a * .8)], [.7, rgba(color, a * .25)], [1, rgba(color, 0)]]);
      ctx.fillRect(x - s * 1.5, y - s * 1.5, s * 3, s * 3);
    }
  }

  // Low frequency blotches of color, as on aged paper.
  function mottle(ctx, seed, color, alpha, scale = 320, bias = 0) {
    const n = makeNoise(seed), [cr, cg, cb] = rgb(color);
    cover(ctx, texture(320, 180, (x, y, o) => {
      const v = fbm(n, x / scale, y / scale, 5) + bias;
      o[0] = cr; o[1] = cg; o[2] = cb; o[3] = clamp(v * 1.6, 0, 1) * 255;
    }), alpha);
  }

  // Points of a rectangle outline centered on 0, 0 with a deckled edge: round
  // scallops of period per and depth amp.
  function deckle(w, h, per, amp, r, jit = .25) {
    const pts = [], x0 = -w / 2, y0 = -h / 2;
    const corners = [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0]];
    for (let s = 0; s < 4; s++) {
      const [ax, ay] = corners[s], [bx, by] = corners[(s + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / per));
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 6; k++) {
          const t = (i + k / 6) / n, f = Math.sin(k / 6 * Math.PI) ** .6;
          const off = amp * (f - 1) + (r() - .5) * amp * jit;
          pts.push([lerp(ax, bx, t) + nx * off, lerp(ay, by, t) + ny * off]);
        }
      }
    }
    return pts;
  }
  // A rectangle outline with a rough torn edge.
  function torn(w, h, step, amp, r) {
    const pts = [], x0 = -w / 2, y0 = -h / 2;
    const corners = [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0]];
    let drift = 0;
    for (let s = 0; s < 4; s++) {
      const [ax, ay] = corners[s], [bx, by] = corners[(s + 1) % 4];
      const len = Math.hypot(bx - ax, by - ay), n = Math.max(2, Math.round(len / step));
      const nx = (by - ay) / len, ny = -(bx - ax) / len;
      for (let i = 0; i < n; i++) {
        drift = clamp(drift + (r() - .5) * amp * .5, -amp, amp);
        const off = drift * .6 + (r() - .5) * amp * .5 - amp * .4;
        pts.push([lerp(ax, bx, i / n) + nx * off, lerp(ay, by, i / n) + ny * off]);
      }
    }
    return pts;
  }
  // Moves points from local coordinates to the frame: rotate by a, then move to cx, cy.
  function place(pts, cx, cy, a) {
    const c = Math.cos(a), s = Math.sin(a);
    return pts.map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
  }
  function pathOf(ctx, pts) { ctx.beginPath(); poly(ctx, pts); }
  // The bounding box of points as [x0, y0, x1, y1], grown by pad.
  function bboxOf(pts, pad = 0) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
  }

  // A soft shadow under a shape. The shape function adds the path.
  function dropShadow(ctx, shape, dx, dy, blur, color, alpha, box = null) {
    soft(ctx, blur, x => { x.translate(dx, dy); x.beginPath(); shape(x); x.fillStyle = rgba(color, 1); x.fill(); }, alpha, 'source-over', box);
  }


  // A layer at output resolution that covers only box = [x0, y0, x1, y1] of the frame.
  function boxLayer(box) {
    const [x0, y0, x1, y1] = [Math.floor(box[0]), Math.floor(box[1]), Math.ceil(box[2]), Math.ceil(box[3])];
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((x1 - x0) * S)); c.height = Math.max(1, Math.ceil((y1 - y0) * S));
    const x = c.getContext('2d');
    c.base = [S, 0, 0, S, -x0 * S, -y0 * S];
    x.setTransform(...c.base);
    c.box = [x0, y0];
    return [c, x];
  }
  function putBox(ctx, c, alpha = 1, op = 'source-over') {
    ctx.save();
    ctx.setTransform(...baseOf(ctx));
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.drawImage(c, c.box[0], c.box[1], c.width / S, c.height / S);
    ctx.restore();
  }
  // Draws a blurred copy of a full size layer.
  function haze(ctx, src, blur, alpha = 1, op = 'source-over') {
    soft(ctx, blur, x => x.drawImage(src, 0, 0, W, H), alpha, op);
  }

  // Points along a smooth curve through the control points, about step apart.
  function spline(ctrl, step = 4) {
    const out = [], p = [ctrl[0], ...ctrl, ctrl[ctrl.length - 1]];
    for (let i = 1; i < p.length - 2; i++) {
      const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
      const n = Math.max(1, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < n; k++) {
        const t = k / n, t2 = t * t, t3 = t2 * t;
        out.push([0, 1].map(j => .5 * (2 * p1[j] + (p2[j] - p0[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (3 * p1[j] - p0[j] - 3 * p2[j] + p3[j]) * t3)));
      }
    }
    out.push(ctrl[ctrl.length - 1].slice());
    return out;
  }
  // Unit normals of a polyline.
  function normals(pts) {
    return pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      return [-dy / l, dx / l];
    });
  }
  // Adds a closed outline along pts. wfn gives the width at t from 0 to 1.
  function taper(ctx, pts, wfn) {
    const nm = normals(pts), n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const w = wfn(i / (n - 1)) / 2;
      L.push([pts[i][0] + nm[i][0] * w, pts[i][1] + nm[i][1] * w]);
      R.push([pts[i][0] - nm[i][0] * w, pts[i][1] - nm[i][1] * w]);
    }
    ctx.moveTo(L[0][0], L[0][1]);
    for (let i = 1; i < n; i++) ctx.lineTo(L[i][0], L[i][1]);
    for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
  }
  // A dry brush stroke: bristle lines along pts that break up where the brush
  // runs dry. wfn gives the width and dry the share of bristles that skip.
  function bristles(ctx, pts, wfn, color, alpha, r, o = {}) {
    const n = o.count || 22, nm = normals(pts), noise = makeNoise(r() * 1e9 | 0), freq = o.freq || .04;
    const dry = o.dry || (() => .15), lw = o.lw || 1.2;
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
    for (let k = 0; k < n; k++) {
      const off = ((k + .5) / n - .5) + (r() - .5) / n, ph = r() * 100;
      ctx.globalAlpha = alpha * (.45 + r() * .55);
      ctx.lineWidth = lw * (.6 + r() * .8);
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i < pts.length; i++) {
        const t = i / (pts.length - 1), w = wfn(t);
        const on = noise(ph, i * freq) * .5 + .5 > dry(t) * (1 + Math.abs(off) * .8);
        const x = pts[i][0] + nm[i][0] * off * w, y = pts[i][1] + nm[i][1] * off * w;
        if (on && w > .2) { if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; } } else pen = false;
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  // Adds a smooth curve through the points, with quadratic curves between midpoints.
  function curve(ctx, pts, closed = false) {
    const n = pts.length;
    if (n < 3) { ctx.moveTo(pts[0][0], pts[0][1]); for (const p of pts) ctx.lineTo(p[0], p[1]); return; }
    if (closed) {
      ctx.moveTo((pts[n - 1][0] + pts[0][0]) / 2, (pts[n - 1][1] + pts[0][1]) / 2);
      for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      ctx.closePath();
    } else {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < n - 1; i++) { const a = pts[i], b = pts[i + 1]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
      ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    }
  }

  // Contour lines at level lv of the grid g, which holds gw x gh values spread
  // over box. Returns polylines in logical units, with closed = true on loops.
  function contours(g, gw, gh, lv, box = [0, 0, W, H]) {
    const [bx0, by0, bx1, by1] = box, sx = (bx1 - bx0) / (gw - 1), sy = (by1 - by0) / (gh - 1);
    const pt = new Map(), nb = new Map();
    const link = (a, b) => {
      if (!nb.has(a)) nb.set(a, []);
      if (!nb.has(b)) nb.set(b, []);
      nb.get(a).push(b); nb.get(b).push(a);
    };
    const hp = (i, j) => {
      const id = 2 * (j * gw + i);
      if (!pt.has(id)) { const a = g[j * gw + i], b = g[j * gw + i + 1]; pt.set(id, [bx0 + (i + (lv - a) / (b - a)) * sx, by0 + j * sy]); }
      return id;
    };
    const vp = (i, j) => {
      const id = 2 * (j * gw + i) + 1;
      if (!pt.has(id)) { const a = g[j * gw + i], b = g[(j + 1) * gw + i]; pt.set(id, [bx0 + i * sx, by0 + (j + (lv - a) / (b - a)) * sy]); }
      return id;
    };
    for (let j = 0; j < gh - 1; j++) {
      for (let i = 0; i < gw - 1; i++) {
        const idx = (g[j * gw + i] > lv) * 8 + (g[j * gw + i + 1] > lv) * 4 + (g[(j + 1) * gw + i + 1] > lv) * 2 + (g[(j + 1) * gw + i] > lv);
        if (idx === 0 || idx === 15) continue;
        const T = () => hp(i, j), Rt = () => vp(i + 1, j), B = () => hp(i, j + 1), L = () => vp(i, j);
        switch (idx) {
          case 1: case 14: link(L(), B()); break;
          case 2: case 13: link(B(), Rt()); break;
          case 3: case 12: link(L(), Rt()); break;
          case 4: case 11: link(T(), Rt()); break;
          case 5: link(L(), T()); link(B(), Rt()); break;
          case 6: case 9: link(T(), B()); break;
          case 7: case 8: link(L(), T()); break;
          case 10: link(T(), Rt()); link(L(), B()); break;
        }
      }
    }
    const seen = new Set(), lines = [];
    const walk = start => {
      const ids = [start];
      seen.add(start);
      for (let cur = start; ;) {
        const next = nb.get(cur).find(x => !seen.has(x));
        if (next === undefined) break;
        seen.add(next); ids.push(next); cur = next;
      }
      return ids.map(id => pt.get(id));
    };
    for (const [id, ns] of nb) if (ns.length === 1 && !seen.has(id)) { const l = walk(id); l.closed = false; lines.push(l); }
    for (const [id] of nb) if (!seen.has(id)) { const l = walk(id); l.closed = true; lines.push(l); }
    return lines;
  }
  // Samples fn on a gw x gh grid over box.
  function grid(gw, gh, fn, box = [0, 0, W, H]) {
    const g = new Float32Array(gw * gh), [x0, y0, x1, y1] = box;
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) g[j * gw + i] = fn(x0 + (x1 - x0) * i / (gw - 1), y0 + (y1 - y0) * j / (gh - 1));
    return g;
  }

  // ---------- paper/old-photo ----------

  // A tree in silhouette: tapered limbs that split, with the tips pushed to tips.
  function silTree(ctx, r, x0, y0, ang, len, wid, depth, tips) {
    const x1 = x0 + Math.cos(ang) * len, y1 = y0 + Math.sin(ang) * len;
    const nx = -Math.sin(ang), ny = Math.cos(ang), w1 = wid * .66;
    const bend = rr(r, -.12, .12) * len, mx = (x0 + x1) / 2 + nx * bend, my = (y0 + y1) / 2 + ny * bend;
    ctx.beginPath();
    ctx.moveTo(x0 + nx * wid / 2, y0 + ny * wid / 2);
    ctx.quadraticCurveTo(mx + nx * (wid + w1) / 4, my + ny * (wid + w1) / 4, x1 + nx * w1 / 2, y1 + ny * w1 / 2);
    ctx.lineTo(x1 - nx * w1 / 2, y1 - ny * w1 / 2);
    ctx.quadraticCurveTo(mx - nx * (wid + w1) / 4, my - ny * (wid + w1) / 4, x0 - nx * wid / 2, y0 - ny * wid / 2);
    ctx.closePath(); ctx.fill();
    ctx.beginPath(); circle(ctx, x1, y1, w1 / 2); ctx.fill();
    if (depth <= 0) { tips.push([x1, y1]); return; }
    if (depth < 3) tips.push([x1, y1]);
    const n = r() < .35 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      let a = ang + (i - (n - 1) / 2) * rr(r, .45, .8) + rr(r, -.2, .2);
      a = lerp(a, -Math.PI / 2, .12);
      silTree(ctx, r, x1, y1, a, len * rr(r, .62, .8), w1, depth - 1, tips);
    }
  }

  // A lake with trees, drawn in local units from 0, 0 to w, h. tone maps 0 to
  // the darkest sepia and 1 to the lightest.
  function lakePhoto(ctx, w, h, tone, r, opt) {
    const shore = h * opt.shore, box = opt.box;
    ctx.fillStyle = linear(ctx, 0, 0, 0, shore, [[0, tone(.72)], [.7, tone(.9)], [1, tone(.95)]]);
    ctx.fillRect(0, 0, w, shore + 2);
    // Soft clouds.
    soft(ctx, 14, x => {
      for (let i = 0; i < 7; i++) {
        x.fillStyle = rgba(tone(1), .55);
        x.beginPath(); ellipse(x, rr(r, 0, w), rr(r, h * .05, shore * .55), rr(r, 60, 160), rr(r, 10, 24)); x.fill();
      }
    }, 1, 'source-over', box);
    // Far hills.
    const n = makeNoise(r() * 1e9 | 0);
    const hill = [];
    for (let x = -10; x <= w + 10; x += 6) hill.push([x, shore - 30 - (fbm(n, x / 260, 1.3, 4) * .5 + .5) * h * .16]);
    soft(ctx, 1.2, x => {
      x.beginPath(); x.moveTo(-10, shore + 4); hill.forEach(p => x.lineTo(p[0], p[1])); x.lineTo(w + 10, shore + 4); x.closePath();
      x.fillStyle = tone(.74); x.fill();
    }, 1, 'source-over', box);
    // The tree line on the far shore.
    const trees = [];
    for (let x = -20; x < w + 20; x += rr(r, 5, 14)) {
      const tall = (fbm(n, x / 120, 4.2, 3) * .5 + .5);
      trees.push({ x, ht: 26 + tall * 70 * rr(r, .6, 1.25), wd: rr(r, 9, 17), fir: r() < .6, t: rr(r, .2, .36), y: shore + rr(r, -2, 3) });
    }
    const drawTrees = (x, k = 0) => {
      for (const tr of trees) {
        x.fillStyle = tone(tr.t + k);
        x.beginPath();
        if (tr.fir) {
          const steps = 6;
          x.moveTo(tr.x, tr.y - tr.ht);
          for (let i = 1; i <= steps; i++) { const f = i / steps; x.lineTo(tr.x + tr.wd * f, tr.y - tr.ht * (1 - f) + 3); x.lineTo(tr.x + tr.wd * f * .55, tr.y - tr.ht * (1 - f) + 2); }
          for (let i = steps; i >= 1; i--) { const f = i / steps; x.lineTo(tr.x - tr.wd * f * .55, tr.y - tr.ht * (1 - f) + 2); x.lineTo(tr.x - tr.wd * f, tr.y - tr.ht * (1 - f) + 3); }
          x.closePath();
        } else {
          const cr = tr.wd * 1.1;
          for (let i = 0; i < 4; i++) circle(x, tr.x + (i % 2 - .5) * cr * .7, tr.y - tr.ht * .45 - i * cr * .45, cr * (1 - i * .12));
          x.rect(tr.x - 1, tr.y - tr.ht * .4, 2, tr.ht * .4);
        }
        x.fill();
      }
    };
    soft(ctx, .8, x => drawTrees(x), 1, 'source-over', box);
    // Mist along the shore.
    soft(ctx, 10, x => { x.fillStyle = rgba(tone(.95), .55); x.fillRect(-20, shore - 30, w + 40, 26); }, 1, 'source-over', box);
    // Water with the reflection of the trees.
    ctx.fillStyle = linear(ctx, 0, shore, 0, h, [[0, tone(.86)], [.35, tone(.8)], [1, tone(.6)]]);
    ctx.fillRect(0, shore, w, h - shore);
    soft(ctx, 3, x => {
      x.translate(0, shore * 2 + 2); x.scale(1, -1);
      x.beginPath(); x.moveTo(-10, shore + 4); hill.forEach(p => x.lineTo(p[0], p[1])); x.lineTo(w + 10, shore + 4); x.closePath();
      x.fillStyle = rgba(tone(.78), .7); x.fill();
      drawTrees(x, .08);
    }, .75, 'source-over', box);
    // Ripples break the reflection into lines.
    ctx.save();
    for (let i = 0; i < 160; i++) {
      const y = shore + 3 + (h - shore) * r() ** 1.6, sw = 20 + r() * 140 * (1 + (y - shore) / h);
      ctx.fillStyle = rgba(tone(r() < .7 ? .95 : .4), .06 + r() * .16);
      ctx.fillRect(rr(r, -40, w), y, sw, .8 + (y - shore) / h * 2.2);
    }
    ctx.restore();
    // A rowboat with a figure.
    if (opt.boat) {
      const [bx, by] = opt.boat;
      const boat = x => {
        x.beginPath(); x.moveTo(bx - 40, by - 6); x.quadraticCurveTo(bx, by + 10, bx + 42, by - 7); x.lineTo(bx + 36, by - 2); x.quadraticCurveTo(bx, by + 6, bx - 36, by - 2); x.closePath();
        ellipse(x, bx + 4, by - 15, 7, 11); circle(x, bx + 4, by - 30, 5);
      };
      soft(ctx, 2, x => { x.translate(0, by * 2 + 4); x.scale(1, -1); boat(x); x.fillStyle = rgba(tone(.3), .5); x.fill(); }, 1, 'source-over', box);
      boat(ctx); ctx.fillStyle = tone(.12); ctx.fill();
      ctx.strokeStyle = tone(.15); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(bx - 12, by - 14); ctx.lineTo(bx - 52, by + 8); ctx.stroke();
    }
    // A dark bank with a tree in the foreground frames one side.
    if (opt.tree) {
      const side = opt.tree, edge = side < 0 ? 0 : w, inward = -side;
      const bank = x => {
        x.beginPath(); x.moveTo(edge, h * .74);
        x.bezierCurveTo(edge + inward * w * .12, h * .76, edge + inward * w * .22, h * .9, edge + inward * w * .36, h + 6);
        x.lineTo(edge, h + 6); x.closePath();
      };
      bank(ctx); ctx.fillStyle = tone(.1); ctx.fill();
      ctx.strokeStyle = tone(.1); ctx.lineCap = 'round';
      // A fringe of grass along the top of the bank.
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let i = 0; i < 220; i++) {
        const f = r() ** 1.3, bx = edge + inward * w * .36 * f, by = h * .74 + (h * .26) * f ** 2.2 + 5, ht = rr(r, 3, 12) * (1 - f * .5);
        ctx.moveTo(bx, by); ctx.quadraticCurveTo(bx + rr(r, -2, 2), by - ht * .6, bx + rr(r, -5, 5), by - ht);
      }
      ctx.stroke();
      const tips = [];
      ctx.fillStyle = tone(.06);
      silTree(ctx, r, edge + inward * w * .08, h * .8, -Math.PI / 2 + inward * .12, h * .24, h * .045, 6, tips);
      soft(ctx, .7, x => {
        // Leaves: larger clumps near each twig, small loose leaves at the edge.
        for (const [tx, ty] of tips) {
          for (let i = 0; i < 34; i++) {
            const a = r() * TAU, f = r() ** .6, d = f * 36, rad = lerp(8, 2, f) * rr(r, .7, 1.2);
            x.fillStyle = tone(rr(r, .03, .16));
            x.beginPath(); ellipse(x, tx + Math.cos(a) * d, ty + Math.sin(a) * d * .75, rad, rad * rr(r, .5, .9), r() * Math.PI); x.fill();
          }
        }
      }, 1, 'source-over', box);
    }
    // The lens darkens the corners.
    ctx.fillStyle = radial(ctx, w / 2, h / 2, h * .3, w * .72, [[0, rgba(tone(0), 0)], [1, rgba(tone(0), .55)]]);
    ctx.fillRect(0, 0, w, h);
  }

  // A deckled print. ph is the size of the picture, bd the border.
  function print(ctx, P, r, o) {
    const { cx, cy, a, pw, ph, bd, paperTone, tone } = o;
    const outline = place(deckle(pw + bd * 2, ph + bd * 2, 15, 3.2, r), cx, cy, a), box = bboxOf(outline, 4);
    dropShadow(ctx, x => poly(x, outline), o.shadow[0], o.shadow[1], o.shadow[2], '#000000', o.shadow[3], bboxOf(outline, 40));
    pathOf(ctx, outline);
    ctx.fillStyle = paperTone; ctx.fill();
    ctx.save();
    pathOf(ctx, outline); ctx.clip();
    // The border yellows toward its edge.
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a);
    soft(ctx, 6, x => { x.strokeStyle = rgba(P.night ? '#000000' : P.accent, P.night ? .4 : .2); x.lineWidth = 10; x.strokeRect(-pw / 2 - bd, -ph / 2 - bd, pw + bd * 2, ph + bd * 2); }, 1, 'source-over', box);
    // The picture.
    ctx.save();
    ctx.beginPath(); ctx.rect(-pw / 2, -ph / 2, pw, ph); ctx.clip();
    ctx.translate(-pw / 2, -ph / 2);
    lakePhoto(ctx, pw, ph, tone, r, { ...o.scene, box });
    // Silver grain and scratches.
    tileFill(ctx, tile(r() * 1e9 | 0, 256, tone(0), v => v ** 3 * .6), .7, .28, 'source-over', [0, 0, pw, ph]);
    tileFill(ctx, tile(r() * 1e9 | 0, 256, tone(1), v => v ** 4 * .5), .7, .2, 'source-over', [0, 0, pw, ph]);
    ctx.strokeStyle = rgba(tone(1), .35); ctx.lineWidth = .7;
    for (let i = 0; i < 9; i++) {
      const x = rr(r, 0, pw), y = rr(r, 0, ph);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + rr(r, -60, 60), y + rr(r, 30, 90), x + rr(r, -90, 90), y + rr(r, 80, 200)); ctx.stroke();
    }
    ctx.restore();
    // A thin dark line where the picture meets the border.
    ctx.strokeStyle = rgba(tone(.2), .25); ctx.lineWidth = 1;
    ctx.strokeRect(-pw / 2, -ph / 2, pw, ph);
    ctx.restore();
    // Fibers and foxing on the print.
    fibers(ctx, r, 260, tone(.3), .08, .6, 10, [cx - pw * .6, cy - ph * .6, cx + pw * .6, cy + ph * .6]);
    foxing(ctx, r, 26, P.accent, .22, [cx - pw * .6, cy - ph * .6, cx + pw * .6, cy + ph * .6], 3);
    ctx.restore();
    return outline;
  }

  scene('paper', 'old-photo', (ctx, P, r) => {
    const night = P.night;
    // The album page.
    if (night) {
      ctx.fillStyle = radial(ctx, 1150, 420, 40, 1300, [[0, mixHex(P.lighter_background, P.brown, .35)], [.45, P.lighter_background], [1, P.darker_background]]);
    } else {
      ctx.fillStyle = radial(ctx, 900, 480, 100, 1250, [[0, mixHex(P.background, '#ffffff', .25)], [.6, P.background], [1, P.darker_background]]);
    }
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.accent, night ? .35 : .12, 300);
    mottle(ctx, r() * 1e9 | 0, night ? P.brown : P.background, night ? .25 : .5, 140, -.05);
    // A water stain with a dark tide line.
    soft(ctx, 3, x => {
      x.strokeStyle = rgba(night ? '#000000' : P.accent, night ? .35 : .14); x.lineWidth = 3;
      x.beginPath(); ellipse(x, 300, 260, 190, 150, .4); x.stroke();
      x.fillStyle = rgba(night ? '#000000' : P.accent, night ? .08 : .04); x.fill();
    });
    fibers(ctx, r, 2600, night ? P.muted : '#ffffff', night ? .07 : .35, .7, 14);
    fibers(ctx, r, 1800, night ? '#000000' : P.dark_foreground, night ? .18 : .07, .6, 12);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, night ? P.muted : '#ffffff', night ? .45 : .35);
    foxing(ctx, r, 70, night ? '#000000' : P.accent, night ? .3 : .18, [0, 0, W, H], 5);

    // The two prints.
    const tone = night
      ? ramp([[0, mixHex(P.darker_background, P.brown, .3)], [.35, mixHex(P.brown, P.accent, .45)], [.72, mixHex(P.accent, P.light_foreground, .55)], [1, P.foreground]])
      : ramp([[0, mixHex(P.foreground, P.brown, .5)], [.35, mixHex(P.brown, P.accent, .65)], [.72, mixHex(P.accent, P.background, .6)], [1, mixHex(P.background, '#ffffff', .45)]]);
    const border = night ? mixHex(P.light_foreground, P.lighter_background, .3) : mixHex(P.background, '#ffffff', .6);
    const shadow = night ? [10, 16, 18, .6] : [8, 14, 16, .22];
    print(ctx, P, r, { cx: 360, cy: 860, a: .14, pw: 470, ph: 330, bd: 26, paperTone: border, tone, shadow,
      scene: { shore: .46, tree: 1, reeds: [0, 200] } });
    const main = print(ctx, P, r, { cx: 1235, cy: 500, a: -.06, pw: 900, ph: 620, bd: 36, paperTone: border, tone, shadow,
      scene: { shore: .5, tree: -1, boat: [560, 440], reeds: [640, 260] } });

    // Black paper corners hold the large print.
    const corner = night ? mixHex(P.darker_background, P.background, .5) : mixHex(P.foreground, P.brown, .3);
    const ca = -.06, cs = Math.cos(ca), sn = Math.sin(ca);
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => {
      const hx = (900 / 2 + 36) * sx, hy = (620 / 2 + 36) * sy, L = 78;
      const tri = [[hx + sx * 8, hy + sy * 8], [hx - sx * L, hy + sy * 8], [hx + sx * 8, hy - sy * L]].map(([x, y]) => [1235 + x * cs - y * sn, 500 + x * sn + y * cs]);
      dropShadow(ctx, x => poly(x, tri), 3, 5, 5, '#000000', night ? .5 : .25, bboxOf(tri, 20));
      pathOf(ctx, tri);
      ctx.fillStyle = linear(ctx, tri[1][0], tri[1][1], tri[2][0], tri[2][1], [[0, corner], [.5, mixHex(corner, night ? P.muted : P.dark_foreground, .25)], [1, corner]]);
      ctx.fill();
    });
    void main;

    // A warm lamp light at night, a soft daylight wash by day.
    if (night) soft(ctx, 120, x => { x.fillStyle = rgba(P.accent, .22); x.beginPath(); circle(x, 1150, 380, 520); x.fill(); }, 1, 'screen');
    vignette(ctx, P, night ? .6 : .18);
    grain(ctx, r() * 1e9 | 0, night ? .05 : .04);
  });
  // ---------- paper/blueprint ----------

  // Adds the outline of a spur gear with n teeth on the pitch radius R.
  function gearPath(ctx, cx, cy, n, R, add, ded, phase) {
    const p = TAU / n, Ra = R + add, Rf = R - ded;
    const prof = [[-.5, Rf], [-.38, Rf], [-.3, Rf + ded * .35], [-.22, R], [-.15, Ra - add * .3], [-.11, Ra], [0, Ra + .4], [.11, Ra], [.15, Ra - add * .3], [.22, R], [.3, Rf + ded * .35], [.38, Rf]];
    for (let k = 0; k < n; k++) {
      const c = phase + k * p;
      prof.forEach(([f, rad], i) => {
        const x = cx + Math.cos(c + f * p) * rad, y = cy + Math.sin(c + f * p) * rad;
        if (k === 0 && i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
    }
    ctx.closePath();
  }
  // Adds an arrowhead with its tip at x, y, pointing along ang.
  function arrowHead(ctx, x, y, ang, len = 15, wid = 3.6) {
    const c = Math.cos(ang), s = Math.sin(ang);
    ctx.moveTo(x, y);
    ctx.lineTo(x - c * len - s * wid, y - s * len + c * wid);
    ctx.lineTo(x - c * len + s * wid, y - s * len - c * wid);
    ctx.closePath();
  }
  // A row of short bars that stands for a line of text, centered on x, y along ang.
  function textBars(ctx, q, x, y, len, ang = 0, ht = 5) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    let u = -len / 2;
    ctx.beginPath();
    while (u < len / 2 - 9) {
      let w = 10 + q() * 16;
      if (len / 2 - u - w < 12) w = len / 2 - u;
      ctx.rect(u, -ht / 2, w, ht);
      u += w + 3 + q() * 4;
    }
    ctx.fill();
    ctx.restore();
  }
  // A linear dimension between points a and b, set off by off along the normal.
  function dimension(ctx, q, a, b, off, textLen = 40) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, nx = -uy, ny = ux, sg = Math.sign(off);
    const A = [a[0] + nx * off, a[1] + ny * off], B = [b[0] + nx * off, b[1] + ny * off];
    ctx.beginPath();
    ctx.moveTo(a[0] + nx * sg * 6, a[1] + ny * sg * 6); ctx.lineTo(A[0] + nx * sg * 12, A[1] + ny * sg * 12);
    ctx.moveTo(b[0] + nx * sg * 6, b[1] + ny * sg * 6); ctx.lineTo(B[0] + nx * sg * 12, B[1] + ny * sg * 12);
    ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]);
    ctx.stroke();
    ctx.beginPath(); arrowHead(ctx, A[0], A[1], Math.atan2(-uy, -ux)); arrowHead(ctx, B[0], B[1], Math.atan2(uy, ux)); ctx.fill();
    let ang = Math.atan2(uy, ux);
    if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
    textBars(ctx, q, (A[0] + B[0]) / 2 + nx * sg * 11, (A[1] + B[1]) / 2 + ny * sg * 11, textLen, ang);
  }

  scene('paper', 'blueprint', (ctx, P, r) => {
    const night = P.night;
    const ink = night ? P.bright_foreground : P.foreground;
    // The paper.
    ctx.fillStyle = night
      ? radial(ctx, 900, 470, 80, 1250, [[0, mixHex(P.background, P.lighter_background, .5)], [.6, P.background], [1, P.dark_background]])
      : radial(ctx, 900, 500, 80, 1250, [[0, mixHex(P.background, '#ffffff', .7)], [.7, P.background], [1, P.dark_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.accent, night ? .32 : .07, 240);
    mottle(ctx, r() * 1e9 | 0, night ? P.lighter_background : '#ffffff', night ? .4 : .6, 130, -.05);
    fibers(ctx, r, 2400, night ? P.foreground : P.accent, night ? .05 : .07, .6, 12);
    fibers(ctx, r, 1400, night ? '#000000' : P.dark_foreground, night ? .14 : .04, .6, 10);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.accent, night ? P.foreground : '#ffffff', night ? .3 : .22);

    // The grid.
    ctx.save();
    ctx.strokeStyle = rgba(P.accent, night ? .13 : .13); ctx.lineWidth = .6;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 24) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 12; y <= H; y += 24) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.strokeStyle = rgba(P.accent, night ? .22 : .22); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += 120) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let y = 12; y <= H; y += 120) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    ctx.restore();

    // The drawing. It runs twice: once blurred for the ink bleed, once sharp.
    const seed = r() * 1e9 | 0;
    const G1 = [1420, 560], N1 = 32, R1 = 300, ga = 215 * Math.PI / 180, N2 = 14, R2 = R1 * N2 / N1;
    const G2 = [G1[0] + Math.cos(ga) * (R1 + R2), G1[1] + Math.sin(ga) * (R1 + R2)];
    const drawing = x => {
      const q = rng(seed);
      x.lineJoin = 'round'; x.lineCap = 'round';
      x.strokeStyle = ink; x.fillStyle = ink;
      const thick = () => { x.lineWidth = 2.6; x.setLineDash([]); };
      const thin = () => { x.lineWidth = 1.1; x.setLineDash([]); };
      const center = () => { x.lineWidth = 1; x.setLineDash([26, 6, 4, 6]); };
      const hidden = () => { x.lineWidth = 1.3; x.setLineDash([9, 6]); };
      const cross = (cx, cy, s) => { x.moveTo(cx - s, cy); x.lineTo(cx + s, cy); x.moveTo(cx, cy - s); x.lineTo(cx, cy + s); };
      // A bore with a keyway at the top.
      const bore = (cx, cy, rad, kw, kd) => {
        const d = Math.asin(kw / 2 / rad);
        x.beginPath();
        x.arc(cx, cy, rad, -Math.PI / 2 + d, -Math.PI / 2 - d + TAU);
        x.lineTo(cx - kw / 2, cy - rad - kd); x.lineTo(cx + kw / 2, cy - rad - kd); x.closePath();
        x.stroke();
      };

      // The large gear.
      thick();
      x.beginPath(); gearPath(x, G1[0], G1[1], N1, R1, 14, 17, ga + Math.PI / N1); x.stroke();
      x.beginPath(); circle(x, G1[0], G1[1], R1 - 52); x.stroke();
      x.beginPath(); circle(x, G1[0], G1[1], 96); x.stroke();
      bore(G1[0], G1[1], 42, 22, 12);
      for (let i = 0; i < 6; i++) {
        const a = i * TAU / 6 + .26;
        x.beginPath(); circle(x, G1[0] + Math.cos(a) * 172, G1[1] + Math.sin(a) * 172, 44); x.stroke();
      }
      center();
      x.beginPath(); circle(x, G1[0], G1[1], R1); x.stroke();
      x.beginPath(); circle(x, G1[0], G1[1], 172); x.stroke();
      x.beginPath(); x.moveTo(G1[0] - R1 - 44, G1[1]); x.lineTo(G1[0] + R1 + 44, G1[1]); x.moveTo(G1[0], G1[1] - R1 - 44); x.lineTo(G1[0], G1[1] + R1 + 44); x.stroke();
      thin();
      x.beginPath();
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + .26; cross(G1[0] + Math.cos(a) * 172, G1[1] + Math.sin(a) * 172, 10); }
      x.stroke();

      // The small gear meshes with it.
      thick();
      x.beginPath(); gearPath(x, G2[0], G2[1], N2, R2, 14, 17, ga + Math.PI); x.stroke();
      x.beginPath(); circle(x, G2[0], G2[1], 58); x.stroke();
      bore(G2[0], G2[1], 26, 14, 8);
      center();
      x.beginPath(); circle(x, G2[0], G2[1], R2); x.stroke();
      x.beginPath(); x.moveTo(G2[0] - R2 - 40, G2[1]); x.lineTo(G2[0] + R2 + 40, G2[1]); x.moveTo(G2[0], G2[1] - R2 - 40); x.lineTo(G2[0], G2[1] + R2 + 40); x.stroke();
      x.beginPath(); x.moveTo(G1[0], G1[1]); x.lineTo(G2[0], G2[1]); x.stroke();

      // Dimensions of the gears.
      thin();
      dimension(x, q, [G1[0] + 8, G1[1] - R1 - 14], [G1[0] + 8, G1[1] + R1 + 14], -(R1 + 70), 46);
      // An angle between 2 holes.
      x.beginPath(); x.arc(G1[0], G1[1], 236, .26, .26 + TAU / 6); x.stroke();
      x.beginPath();
      arrowHead(x, G1[0] + Math.cos(.26) * 236, G1[1] + Math.sin(.26) * 236, .26 - Math.PI / 2);
      arrowHead(x, G1[0] + Math.cos(.26 + TAU / 6) * 236, G1[1] + Math.sin(.26 + TAU / 6) * 236, .26 + TAU / 6 + Math.PI / 2);
      x.fill();
      textBars(x, q, G1[0] + Math.cos(.78) * 256, G1[1] + Math.sin(.78) * 256, 30, .78 - Math.PI / 2);
      // A leader to a hole, with a note.
      const hx = G1[0] + Math.cos(.26 + TAU / 2) * 172, hy = G1[1] + Math.sin(.26 + TAU / 2) * 172;
      x.beginPath(); x.moveTo(hx - 30, hy + 30); x.lineTo(hx - 150, hy + 150); x.lineTo(hx - 250, hy + 150); x.stroke();
      x.beginPath(); arrowHead(x, hx - 31, hy + 31, Math.PI * .25); x.fill();
      textBars(x, q, hx - 200, hy + 138, 86); textBars(x, q, hx - 210, hy + 166, 64, 0, 4);
      // A detail circle on the teeth.
      const da = -.8, dx0 = G1[0] + Math.cos(da) * R1, dy0 = G1[1] + Math.sin(da) * R1;
      hidden(); x.beginPath(); circle(x, dx0, dy0, 46); x.stroke();
      thin(); x.beginPath(); x.moveTo(dx0 + 36, dy0 - 28); x.lineTo(1700, 200); x.stroke();
      // The detail view: 2 teeth, 3 times larger.
      thick();
      x.save();
      x.beginPath(); circle(x, 1770, 150, 104); x.clip();
      x.beginPath(); gearPath(x, 1770 - Math.cos(-1.35) * 3 * R1, 150 - Math.sin(-1.35) * 3 * R1, N1, R1 * 3, 42, 51, -1.35 + Math.PI / N1); x.stroke();
      center(); x.beginPath(); x.arc(1770 - Math.cos(-1.35) * 3 * R1, 150 - Math.sin(-1.35) * 3 * R1, R1 * 3, -1.6, -1.1); x.stroke();
      x.restore();
      thin(); x.beginPath(); circle(x, 1770, 150, 104); x.stroke();

      // The flange: front view and side view.
      const F = [300, 300];
      thick();
      x.beginPath(); circle(x, F[0], F[1], 150); x.stroke();
      x.beginPath(); circle(x, F[0], F[1], 64); x.stroke();
      x.beginPath(); circle(x, F[0], F[1], 40); x.stroke();
      for (let i = 0; i < 8; i++) { const a = i * TAU / 8; x.beginPath(); circle(x, F[0] + Math.cos(a) * 108, F[1] + Math.sin(a) * 108, 13); x.stroke(); }
      center();
      x.beginPath(); circle(x, F[0], F[1], 108); x.stroke();
      x.beginPath(); x.moveTo(F[0] - 180, F[1]); x.lineTo(660, F[1]); x.moveTo(F[0], F[1] - 180); x.lineTo(F[0], F[1] + 180); x.stroke();
      thick();
      x.beginPath(); x.rect(520, 150, 44, 300); x.rect(564, 236, 50, 128); x.stroke();
      hidden();
      x.beginPath(); x.moveTo(520, 260); x.lineTo(614, 260); x.moveTo(520, 340); x.lineTo(614, 340);
      x.moveTo(520, 179); x.lineTo(564, 179); x.moveTo(520, 205); x.lineTo(564, 205); x.moveTo(520, 395); x.lineTo(564, 395); x.moveTo(520, 421); x.lineTo(564, 421); x.stroke();
      // Projection lines between the views.
      x.save(); x.globalAlpha = .45; thin(); x.setLineDash([3, 5]);
      x.beginPath(); x.moveTo(F[0] + 30, 150); x.lineTo(510, 150); x.moveTo(F[0] + 30, 450); x.lineTo(510, 450); x.stroke();
      x.restore();
      thin();
      dimension(x, q, [520, 150], [614, 150], -40, 26);
      dimension(x, q, [F[0] - 150, F[1] + 150], [F[0] + 150, F[1] + 150], 46, 44);

      // A shaft in half section.
      const ay = 830, segs = [[150, 250, 64], [250, 520, 104], [520, 590, 150], [590, 860, 88]];
      thick();
      x.beginPath();
      segs.forEach(([a, b, d], i) => {
        const c = i === 0 || i === segs.length - 1 ? 6 : 0;
        if (i === 0) { x.moveTo(a, ay); x.lineTo(a, ay - d / 2 + c); x.lineTo(a + c, ay - d / 2); } else x.lineTo(a, ay - d / 2);
        x.lineTo(b - (i === segs.length - 1 ? c : 0), ay - d / 2);
        if (i === segs.length - 1) { x.lineTo(b, ay - d / 2 + c); x.lineTo(b, ay); } else x.lineTo(b, ay - segs[i + 1][2] / 2);
      });
      x.stroke();
      x.beginPath();
      segs.forEach(([a, b, d], i) => { x.moveTo(a, ay - d / 2); x.lineTo(a, ay + d / 2); if (i === segs.length - 1) { x.moveTo(b, ay - d / 2); x.lineTo(b, ay + d / 2); } });
      x.stroke();
      // The lower half is cut: hatching inside the outline.
      x.save();
      x.beginPath();
      segs.forEach(([a, b, d]) => x.rect(a, ay, b - a, d / 2));
      x.stroke();
      x.clip();
      x.lineWidth = .9;
      x.beginPath();
      for (let k = -200; k < 900; k += 11) { x.moveTo(k, ay + 80); x.lineTo(k + 80, ay); }
      x.stroke();
      x.restore();
      // A keyway seen from above, as a hidden slot.
      hidden(); x.beginPath(); x.moveTo(300, ay - 52); x.lineTo(300, ay - 38); x.lineTo(470, ay - 38); x.lineTo(470, ay - 52); x.stroke();
      center(); x.beginPath(); x.moveTo(120, ay); x.lineTo(890, ay); x.stroke();
      thin();
      segs.forEach(([a, b]) => dimension(x, q, [a, ay + 80], [b, ay + 80], 46, Math.min(40, (b - a) * .4)));
      dimension(x, q, [150, ay + 80], [860, ay + 80], 100, 50);
      dimension(x, q, [555, ay - 75], [555, ay + 75], 0.001, 30);

      // The border and the title block.
      thick();
      x.strokeRect(22, 22, W - 44, H - 44);
      thin();
      x.strokeRect(34, 34, W - 68, H - 68);
      x.beginPath();
      for (let k = 1; k < 8; k++) { x.moveTo(k * W / 8, 22); x.lineTo(k * W / 8, 34); x.moveTo(k * W / 8, H - 22); x.lineTo(k * W / 8, H - 34); }
      for (let k = 1; k < 4; k++) { x.moveTo(22, k * H / 4); x.lineTo(34, k * H / 4); x.moveTo(W - 22, k * H / 4); x.lineTo(W - 34, k * H / 4); }
      x.stroke();
      const tb = [1480, 920, W - 34, H - 34];
      thick(); x.strokeRect(tb[0], tb[1], tb[2] - tb[0], tb[3] - tb[1]);
      thin();
      x.beginPath();
      x.moveTo(tb[0], 958); x.lineTo(tb[2], 958); x.moveTo(tb[0] + 120, 1004); x.lineTo(tb[2], 1004);
      x.moveTo(tb[0] + 120, tb[1]); x.lineTo(tb[0] + 120, tb[3]); x.moveTo(1740, 958); x.lineTo(1740, tb[3]);
      x.stroke();
      textBars(x, q, 1660, 939, 220, 0, 8);
      textBars(x, q, 1680, 981, 90); textBars(x, q, 1810, 981, 70); textBars(x, q, 1670, 1025, 100); textBars(x, q, 1810, 1025, 60);
      // The projection symbol: a cone and 2 circles.
      x.beginPath(); x.moveTo(1498, 950); x.lineTo(1548, 940); x.lineTo(1548, 1010); x.lineTo(1498, 1000); x.closePath(); x.stroke();
      x.beginPath(); circle(x, 1574, 975, 18); circle(x, 1574, 975, 8); x.stroke();
      // Notes in the lower left of the sheet.
      for (let k = 0; k < 4; k++) textBars(x, q, 1020 + (k % 2) * 8, 970 + k * 18, 200 - k * 30 + (k % 2) * 20, 0, 4.5);
    };
    soft(ctx, 2.2, x => drawing(x), night ? .55 : .35);
    ctx.save(); ctx.globalAlpha = night ? .88 : .9; drawing(ctx); ctx.restore();

    // The sheet was folded in 6 panels.
    const folds = x => { x.beginPath(); x.moveTo(640, 0); x.lineTo(640, H); x.moveTo(1280, 0); x.lineTo(1280, H); x.moveTo(0, 540); x.lineTo(W, 540); };
    soft(ctx, 5, x => { x.strokeStyle = rgba('#000000', 1); x.lineWidth = 5; folds(x); x.stroke(); }, night ? .35 : .12);
    ctx.save(); ctx.translate(2, 2); ctx.strokeStyle = rgba('#ffffff', night ? .07 : .5); ctx.lineWidth = 1.5; folds(ctx); ctx.stroke(); ctx.restore();
    [[0, 0, 640, 540, .04], [1280, 540, 640, 540, .05], [640, 0, 640, 540, -.03]].forEach(([x0, y0, w, h, k]) => {
      ctx.fillStyle = rgba(k > 0 ? '#000000' : '#ffffff', Math.abs(k) * (night ? 1 : .6)); ctx.fillRect(x0, y0, w, h);
    });
    vignette(ctx, P, night ? .45 : .12);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paper/herbarium ----------

  // A pressed leaf on a curved midrib from x, y along angle a. Returns its parts.
  function leafParts(r, x, y, a, len, wid, bend) {
    const ctrl = [[x, y]];
    for (let k = 1; k <= 4; k++) { const ang = a + bend * k / 4; const p = ctrl[k - 1]; ctrl.push([p[0] + Math.cos(ang) * len / 4, p[1] + Math.sin(ang) * len / 4]); }
    const mid = spline(ctrl, 3);
    const wfn = t => wid * Math.sin(Math.PI * clamp(t, 0, 1)) ** .8 * (1.15 - .45 * t);
    const nm = normals(mid), n = mid.length, edgeL = [], edgeR = [], veins = [];
    for (let i = 0; i < n; i++) {
      const w = wfn(i / (n - 1)) / 2 * (1 + (r() - .5) * .04);
      edgeL.push([mid[i][0] + nm[i][0] * w, mid[i][1] + nm[i][1] * w]);
      edgeR.push([mid[i][0] - nm[i][0] * w, mid[i][1] - nm[i][1] * w]);
    }
    for (let t = .1; t < .9; t += .085) {
      const i = Math.round(t * (n - 1)), w = wfn(t) / 2;
      const tx = -nm[i][1], ty = nm[i][0];
      for (const sd of [1, -1]) {
        const ex = mid[i][0] + (nm[i][0] * sd * .85 + tx * .55) * w, ey = mid[i][1] + (nm[i][1] * sd * .85 + ty * .55) * w;
        veins.push([mid[i], [mid[i][0] + (nm[i][0] * sd * .5 + tx * .1) * w, mid[i][1] + (nm[i][1] * sd * .5 + ty * .1) * w], [ex, ey]]);
      }
    }
    return { outline: [...edgeL, ...edgeR.reverse()], mid, veins };
  }

  scene('paper', 'herbarium', (ctx, P, r) => {
    const night = P.night;
    // The sheet.
    const sheet = night ? mixHex(P.background, P.lighter_background, .55) : mixHex(P.background, '#ffffff', .3);
    ctx.fillStyle = radial(ctx, 860, 460, 60, 1300, [[0, night ? mixHex(sheet, P.muted, .1) : mixHex(sheet, '#ffffff', .3)], [.6, sheet], [1, night ? P.dark_background : P.darker_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.yellow, night ? .3 : .08, 280);
    mottle(ctx, r() * 1e9 | 0, night ? P.lighter_background : '#ffffff', night ? .3 : .45, 120, -.05);
    fibers(ctx, r, 3200, night ? P.foreground : '#ffffff', night ? .05 : .45, .6, 14);
    fibers(ctx, r, 1600, night ? '#000000' : P.dark_foreground, night ? .14 : .06, .6, 12);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, night ? P.muted : '#ffffff', night ? .35 : .25);
    foxing(ctx, r, 50, night ? '#000000' : P.orange, night ? .3 : .14, [0, 0, W, H], 5);

    // Colors of the dried plant.
    const leafA = night ? mixHex(P.green, sheet, .2) : mixHex(P.green, sheet, .12);
    const leafB = night ? mixHex(P.cyan, sheet, .3) : mixHex(P.blue, sheet, .25);
    const leafDry = night ? mixHex(P.yellow, P.brown, .35) : mixHex(P.yellow, P.orange, .4);
    const stemC = night ? mixHex(P.yellow, P.brown, .45) : mixHex(P.brown, P.yellow, .45);
    const rootC = night ? mixHex(P.orange, P.brown, .5) : mixHex(P.brown, sheet, .2);
    const vein = night ? mixHex(P.foreground, leafA, .45) : mixHex(sheet, leafA, .45);
    const edge = night ? P.brown : mixHex(P.brown, P.orange, .3);
    const petalC = night ? mixHex(P.magenta, sheet, .15) : mixHex(P.magenta, sheet, .15);
    const disk = night ? P.yellow : mixHex(P.yellow, P.orange, .5);

    // The plant: a main stem from the root at the lower left to the top right.
    const stems = [], leaves = [], flowers = [];
    const main = spline([[330, 950], [470, 770], [640, 600], [840, 450], [1060, 320], [1250, 215], [1390, 150]], 4);
    stems.push({ pts: main, w: t => 10 - t * 6.5 });
    const nm = normals(main);
    const at = t => main[Math.round(t * (main.length - 1))];
    const dirAt = t => { const i = Math.round(t * (main.length - 1)); return Math.atan2(-nm[i][0], nm[i][1]); };
    const b1 = spline([at(.42), [700, 420], [640, 300], [600, 215]], 4), b2 = spline([at(.6), [1020, 420], [1150, 430], [1270, 395]], 4);
    const b3 = spline([at(.25), [470, 600], [395, 520]], 4);
    stems.push({ pts: b1, w: t => 5 - t * 2.8 }, { pts: b2, w: t => 5 - t * 2.8 }, { pts: b3, w: t => 4 - t * 2.4 });
    // Leaves along the stems, on alternate sides.
    const addLeaves = (pts, from, to, step, size, side0) => {
      const n2 = normals(pts);
      let side = side0;
      for (let t = from; t < to; t += step) {
        const i = Math.round(t * (pts.length - 1)), dir = Math.atan2(-n2[i][0], n2[i][1]);
        const a = dir + side * rr(r, .7, 1.1), len = size * rr(r, .75, 1.15) * (1.15 - t * .5);
        leaves.push({ ...leafParts(r, pts[i][0], pts[i][1], a, len, len * rr(r, .28, .36), -side * rr(r, .1, .4)), dry: r() < .25, under: r() < .2 });
        side = -side;
      }
    };
    addLeaves(main, .08, .95, .068, 210, 1);
    addLeaves(b1, .2, .85, .2, 120, -1);
    addLeaves(b2, .25, .9, .18, 120, 1);
    addLeaves(b3, .3, .95, .3, 110, 1);
    // The rosette of large leaves at the base.
    for (const [a, len] of [[-2.6, 300], [-2.15, 250], [-.35, 270], [.15, 220], [-2.95, 200]]) {
      leaves.unshift({ ...leafParts(r, 340, 945, a, len, len * .32, rr(r, -.3, .3)), dry: r() < .3, under: false });
    }
    flowers.push([1390, 150, 46], [600, 215, 38], [1270, 395, 40], [395, 520, 22]);

    // The plant left a faint stain on the paper, and casts a small shadow.
    soft(ctx, 16, x => {
      x.fillStyle = night ? '#000000' : P.orange; x.lineCap = 'round';
      stems.forEach(s => { x.beginPath(); taper(x, s.pts, t => s.w(t) + 14); x.fill(); });
      leaves.forEach(l => { x.beginPath(); poly(x, l.outline); x.fill(); });
    }, night ? .3 : .08);
    soft(ctx, 4, x => {
      x.translate(3, 5);
      x.fillStyle = '#000000'; x.strokeStyle = '#000000'; x.lineCap = 'round';
      stems.forEach(s => { x.beginPath(); taper(x, s.pts, s.w); x.fill(); });
      leaves.forEach(l => { x.beginPath(); poly(x, l.outline); x.fill(); });
      flowers.forEach(([fx, fy, fr]) => { x.beginPath(); circle(x, fx, fy, fr); x.fill(); });
    }, night ? .5 : .16);

    // Roots: thin branching lines.
    ctx.save();
    ctx.strokeStyle = rootC; ctx.lineCap = 'round';
    const root = (x, y, a, len, w, d) => {
      const pts = [[x, y]];
      for (let k = 0; k < 8; k++) { a += rr(r, -.35, .35); const p = pts[pts.length - 1]; pts.push([p[0] + Math.cos(a) * len / 8, p[1] + Math.sin(a) * len / 8]); }
      ctx.lineWidth = w; ctx.beginPath(); curve(ctx, pts); ctx.stroke();
      if (d > 0) for (let k = 2; k < 8; k += 2) if (r() < .7) root(pts[k][0], pts[k][1], a + rr(r, -1, 1), len * .5, w * .6, d - 1);
    };
    for (let i = 0; i < 9; i++) root(330 + rr(r, -8, 8), 952, Math.PI / 2 + rr(r, -1.1, 1.1), rr(r, 70, 140), rr(r, 1.4, 3), 2);
    ctx.restore();

    // Stems.
    stems.forEach(s => {
      ctx.beginPath(); taper(ctx, s.pts, s.w); ctx.fillStyle = stemC; ctx.fill();
      ctx.strokeStyle = rgba(night ? '#000000' : P.brown, .3); ctx.lineWidth = .8; ctx.stroke();
    });
    // Leaves: a flat fill, browned edges and pale veins.
    leaves.forEach(l => {
      const base = l.dry ? leafDry : l.under ? leafB : leafA;
      const [x0, y0] = l.mid[0], [x1, y1] = l.mid[l.mid.length - 1];
      ctx.save();
      ctx.beginPath(); poly(ctx, l.outline);
      ctx.fillStyle = linear(ctx, x0, y0, x1, y1, [[0, mixHex(base, edge, .25)], [.5, base], [1, mixHex(base, sheet, .18)]]);
      ctx.globalAlpha = .94; ctx.fill(); ctx.globalAlpha = 1;
      ctx.clip();
      ctx.strokeStyle = rgba(edge, night ? .55 : .4); ctx.lineWidth = 5; ctx.stroke();
      ctx.strokeStyle = rgba(vein, .75); ctx.lineWidth = 1.6;
      ctx.beginPath(); curve(ctx, l.mid); ctx.stroke();
      ctx.lineWidth = .8; ctx.strokeStyle = rgba(vein, .55);
      ctx.beginPath(); l.veins.forEach(v => { ctx.moveTo(v[0][0], v[0][1]); ctx.quadraticCurveTo(v[1][0], v[1][1], v[2][0], v[2][1]); }); ctx.stroke();
      ctx.restore();
      ctx.beginPath(); poly(ctx, l.outline); ctx.strokeStyle = rgba(edge, .6); ctx.lineWidth = .8; ctx.stroke();
    });
    // Pressed flowers: flat petals around a disk.
    flowers.forEach(([fx, fy, fr]) => {
      const n = 13, rot = r() * TAU;
      ctx.beginPath();
      for (let i = 0; i < n; i++) petal(ctx, fx, fy, fr * rr(r, .85, 1.05), fr * .2, rot + i * TAU / n + rr(r, -.08, .08));
      ctx.fillStyle = petalC; ctx.globalAlpha = .9; ctx.fill(); ctx.globalAlpha = 1;
      ctx.strokeStyle = rgba(edge, .45); ctx.lineWidth = .8; ctx.stroke();
      ctx.beginPath(); circle(ctx, fx, fy, fr * .28); ctx.fillStyle = disk; ctx.fill();
      ctx.fillStyle = rgba(edge, .6);
      for (let i = 0; i < 26; i++) { const a = r() * TAU, d = Math.sqrt(r()) * fr * .25; ctx.beginPath(); circle(ctx, fx + Math.cos(a) * d, fy + Math.sin(a) * d, 1.4); ctx.fill(); }
    });

    // Strips of gummed tape hold the plant.
    const tapeC = night ? mixHex(sheet, P.foreground, .4) : mixHex(sheet, P.orange, .1);
    const tapes = [[at(.18), dirAt(.18)], [at(.47), dirAt(.47)], [at(.78), dirAt(.78)], [b1[Math.round(b1.length * .5)], -1.9], [b2[Math.round(b2.length * .6)], .1], [[300, 870], -.55], [[175, 760], .4]];
    tapes.forEach(([[tx, ty], a]) => {
      const L = rr(r, 64, 84), Wd = rr(r, 18, 22), pts = [];
      for (let k = 0; k <= 6; k++) pts.push([-L / 2 + rr(r, -2, 2), -Wd / 2 + k * Wd / 6]);
      for (let k = 6; k >= 0; k--) pts.push([L / 2 + rr(r, -2, 2), -Wd / 2 + k * Wd / 6]);
      const shape = place(pts, tx, ty, a + Math.PI / 2 + rr(r, -.12, .12));
      dropShadow(ctx, x => poly(x, shape), 1, 2, 2, '#000000', night ? .25 : .1, bboxOf(shape, 12));
      pathOf(ctx, shape);
      ctx.fillStyle = rgba(tapeC, night ? .5 : .72); ctx.fill();
      ctx.strokeStyle = rgba(night ? '#000000' : P.dark_foreground, .12); ctx.lineWidth = .8; ctx.stroke();
    });

    // The label in the lower right corner.
    const lab = [1390, 775, 1830, 1015], q = rng(r() * 1e9 | 0);
    const labC = night ? mixHex(sheet, P.foreground, .12) : mixHex(sheet, '#ffffff', .65);
    const labInk = night ? P.light_foreground : P.foreground;
    dropShadow(ctx, x => x.rect(lab[0], lab[1], lab[2] - lab[0], lab[3] - lab[1]), 3, 5, 6, '#000000', night ? .5 : .14, [lab[0] - 30, lab[1] - 30, lab[2] + 30, lab[3] + 30]);
    ctx.fillStyle = labC; ctx.fillRect(lab[0], lab[1], lab[2] - lab[0], lab[3] - lab[1]);
    ctx.strokeStyle = rgba(labInk, .7); ctx.lineWidth = 2; ctx.strokeRect(lab[0] + 12, lab[1] + 12, lab[2] - lab[0] - 24, lab[3] - lab[1] - 24);
    ctx.lineWidth = .8; ctx.strokeRect(lab[0] + 17, lab[1] + 17, lab[2] - lab[0] - 34, lab[3] - lab[1] - 34);
    ctx.fillStyle = rgba(labInk, .8);
    textBars(ctx, q, (lab[0] + lab[2]) / 2, lab[1] + 46, 260, 0, 9);
    ctx.fillStyle = rgba(labInk, .6);
    for (let k = 0; k < 5; k++) {
      const y = lab[1] + 86 + k * 27;
      textBars(ctx, q, lab[0] + 80, y, 80, 0, 5);
      ctx.fillRect(lab[0] + 128, y + 7, lab[2] - lab[0] - 160, .8);
    }
    // Handwritten entries in ink.
    ctx.strokeStyle = rgba(night ? P.cyan : P.blue, .75); ctx.lineWidth = 1.6; ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const y = lab[1] + 86 + k * 27, x1 = lab[0] + 140 + rr(r, 140, 260);
      for (let x = lab[0] + 140; x < x1;) {
        const wl = Math.min(rr(r, 30, 80), x1 - x), pts = [], ph = r() * 6;
        for (let t = 0; t <= wl; t += 5) pts.push([x + t, y - 3 + Math.sin(t / 7 + ph) * 2.2 + rr(r, -.6, .6)]);
        ctx.beginPath(); curve(ctx, pts); ctx.stroke();
        x += wl + rr(r, 10, 18);
      }
    }

    // A seed packet in the upper left, folded from 1 sheet.
    const pk = place([[-100, -66], [100, -66], [100, 66], [-100, 66]], 230, 210, -.08);
    dropShadow(ctx, x => poly(x, pk), 3, 5, 6, '#000000', night ? .5 : .14, bboxOf(pk, 30));
    pathOf(ctx, pk); ctx.fillStyle = labC; ctx.fill();
    ctx.strokeStyle = rgba(labInk, .25); ctx.lineWidth = 1;
    const fold = place([[-100, -66], [0, 4], [100, -66]], 230, 210, -.08);
    ctx.beginPath(); ctx.moveTo(fold[0][0], fold[0][1]); ctx.lineTo(fold[1][0], fold[1][1]); ctx.lineTo(fold[2][0], fold[2][1]); ctx.stroke();
    ctx.fillStyle = rgba(labInk, .5);
    textBars(ctx, q, 232, 252, 90, -.08, 4);
    ctx.fillStyle = rootC;
    for (let i = 0; i < 9; i++) { ctx.beginPath(); ellipse(ctx, 360 + rr(r, -20, 40), 250 + rr(r, -16, 30), 4, 2.4, r() * 3); ctx.fill(); }

    // A grey scale and a scale bar along the lower edge.
    const gs = [70, 1030];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = mixHex(night ? P.foreground : '#ffffff', night ? '#000000' : P.foreground, i / 5); ctx.fillRect(gs[0] + i * 34, gs[1] - 24, 34, 24); }
    for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? labC : labInk; ctx.fillRect(gs[0] + 230 + i * 30, gs[1] - 10, 30, 10); }
    ctx.strokeStyle = rgba(labInk, .6); ctx.lineWidth = 1; ctx.strokeRect(gs[0] + 230, gs[1] - 10, 180, 10);

    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paper/old-map ----------

  // Euclidean distance, in cells, from each cell to the nearest cell where mask is 1.
  function edt(mask, gw, gh) {
    const INF = 1e12, out = new Float64Array(gw * gh), n = Math.max(gw, gh);
    const f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
    const pass = len => {
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        for (;;) {
          s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
          if (s > z[k] || k === 0) break;
          k--;
        }
        if (s <= z[k]) { v[k] = q; z[k + 1] = INF; continue; }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    };
    for (let i = 0; i < gw * gh; i++) out[i] = mask[i] ? 0 : INF;
    for (let x = 0; x < gw; x++) { for (let y = 0; y < gh; y++) f[y] = out[y * gw + x]; pass(gh); for (let y = 0; y < gh; y++) out[y * gw + x] = d[y]; }
    for (let y = 0; y < gh; y++) { for (let x = 0; x < gw; x++) f[x] = out[y * gw + x]; pass(gw); for (let x = 0; x < gw; x++) out[y * gw + x] = Math.sqrt(d[x]); }
    return out;
  }
  // A grid of colors drawn over box. fn gives [r, g, b, a] for each cell.
  function gridImage(ctx, gw, gh, box, fn, alpha = 1, op = 'source-over') {
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const x = c.getContext('2d'), img = x.createImageData(gw, gh);
    for (let i = 0; i < gw * gh; i++) { const v = fn(i); img.data[i * 4] = v[0]; img.data[i * 4 + 1] = v[1]; img.data[i * 4 + 2] = v[2]; img.data[i * 4 + 3] = v[3]; }
    x.putImageData(img, 0, 0);
    const sx = (box[2] - box[0]) / (gw - 1), sy = (box[3] - box[1]) / (gh - 1);
    ctx.save();
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, box[0] - sx / 2, box[1] - sy / 2, gw * sx, gh * sy);
    ctx.restore();
  }

  scene('paper', 'old-map', (ctx, P, r) => {
    const night = P.night;
    const paperC = night ? mixHex(P.background, P.lighter_background, .7) : P.background;
    const ink = P.foreground;
    // Parchment.
    ctx.fillStyle = night
      ? radial(ctx, 940, 500, 60, 1250, [[0, mixHex(paperC, P.muted, .14)], [.6, paperC], [1, P.darker_background]])
      : radial(ctx, 940, 520, 60, 1250, [[0, mixHex(paperC, '#ffffff', .35)], [.65, paperC], [1, mixHex(P.darker_background, P.orange, .12)]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.orange, night ? .35 : .14, 260);
    mottle(ctx, r() * 1e9 | 0, night ? P.lighter_background : '#ffffff', night ? .35 : .4, 110, -.05);
    fibers(ctx, r, 2400, night ? P.foreground : '#ffffff', night ? .04 : .35, .6, 14);
    fibers(ctx, r, 1500, night ? '#000000' : P.brown, night ? .14 : .05, .6, 12);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.brown, night ? P.muted : '#ffffff', night ? .35 : .25);

    // The land: fractal noise, pushed up at the left and the lower right.
    const n = makeNoise(r() * 1e9 | 0), n2 = makeNoise(r() * 1e9 | 0);
    const bias = [[60, 560, 620, .62], [1800, 1080, 470, .56], [1660, 90, 150, .3], [900, 1010, 170, .3], [1470, 640, 80, .26], [1090, 430, 360, -.75]];
    const landF = (x, y) => {
      let v = fbm(n, x / 340, y / 340, 6) * .6 + fbm(n2, x / 90, y / 90, 3) * .08;
      for (const [bx, by, br, s] of bias) v += s * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (br * br));
      return v - .22;
    };
    const cell = 4, gw = Math.ceil(W / cell) + 5, gh = Math.ceil(H / cell) + 5;
    const box = [-2 * cell, -2 * cell, -2 * cell + (gw - 1) * cell, -2 * cell + (gh - 1) * cell];
    const f = grid(gw, gh, landF, box);
    const land = f.map(v => (v > 0 ? 1 : 0)), dSea = edt(land, gw, gh), dLand = edt(land.map(v => 1 - v), gw, gh);

    // Sea tint near the coast, and the colored band inside the coast.
    const [sr, sg, sb] = rgb(P.cyan), [lr, lg, lb] = rgb(night ? P.green : P.green), [yr, yg, yb] = rgb(P.yellow);
    gridImage(ctx, gw, gh, box, i => land[i] ? [0, 0, 0, 0] : [sr, sg, sb, 255 * (.08 + .3 * clamp(1 - dSea[i] * cell / 140, 0, 1) ** 2)], night ? .22 : .5);
    gridImage(ctx, gw, gh, box, i => {
      if (!land[i]) return [0, 0, 0, 0];
      const k = clamp(1 - dLand[i] * cell / 46, 0, 1) ** 1.3;
      return [lerp(yr, lr, k), lerp(yg, lg, k), lerp(yb, lb, k), 255 * (.22 + k * .6)];
    }, night ? .32 : .5);

    // Rhumb lines from the compass rose and 4 nodes on a circle around it.
    const RC = [1090, 430];
    ctx.save();
    ctx.lineWidth = .9;
    const rhumbs = (cx, cy, count, alpha, skip) => {
      for (let i = 0; i < count; i++) {
        const a = i * TAU / count, kind = (i * 32 / count) % 4 === 0 ? ink : (i * 32 / count) % 2 === 0 ? P.green : P.red;
        ctx.strokeStyle = rgba(kind, alpha);
        ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * skip, cy + Math.sin(a) * skip); ctx.lineTo(cx + Math.cos(a) * 2400, cy + Math.sin(a) * 2400); ctx.stroke();
      }
    };
    rhumbs(RC[0], RC[1], 32, night ? .32 : .38, 180);
    for (let k = 0; k < 4; k++) { const a = k * TAU / 4 + TAU / 8; rhumbs(RC[0] + Math.cos(a) * 700, RC[1] + Math.sin(a) * 700, 16, night ? .14 : .16, 0); }
    ctx.restore();

    // Sea hatching: horizontal strokes that fade away from the coast.
    ctx.save();
    ctx.strokeStyle = rgba(ink, night ? .3 : .34); ctx.lineWidth = .7;
    ctx.beginPath();
    for (let y = 4; y < H; y += 5.5) {
      const j = Math.round((y - box[1]) / cell);
      let start = null;
      for (let x = 0; x <= W; x += 3) {
        const i = Math.round((x - box[0]) / cell), d = dSea[j * gw + i] * cell;
        const lim = 34 + fbm(n2, x / 160, y / 160, 2) * 30;
        const on = !land[j * gw + i] && d > 30 && d < lim + 34 && (d < (lim + 34) * .7 || ((x * 7 + y * 3) % 23) > d / (lim + 34) * 18);
        if (on && start === null) start = x;
        if ((!on || x >= W) && start !== null) { if (x - start > 4) { ctx.moveTo(start, y); ctx.lineTo(x, y); } start = null; }
      }
    }
    ctx.stroke();
    ctx.restore();

    // Waterlines: offsets of the coast.
    ctx.save();
    ctx.strokeStyle = ink; ctx.lineJoin = 'round';
    [[8, .5, 1], [16, .32, .9], [26, .2, .8]].forEach(([d, a, w]) => {
      ctx.globalAlpha = a; ctx.lineWidth = w;
      ctx.beginPath(); contours(dSea, gw, gh, d / cell, box).forEach(l => curve(ctx, l, l.closed)); ctx.stroke();
    });
    ctx.restore();
    // The coastline, with a little ink bleed.
    const coast = contours(f, gw, gh, 0, box);
    soft(ctx, 2.5, x => { x.strokeStyle = ink; x.lineWidth = 3; x.beginPath(); coast.forEach(l => curve(x, l, l.closed)); x.stroke(); }, night ? .35 : .3);
    ctx.strokeStyle = ink; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    ctx.beginPath(); coast.forEach(l => curve(ctx, l, l.closed)); ctx.stroke();

    // Mountains and woods inland.
    const at = (x, y) => { const i = clamp(Math.round((x - box[0]) / cell), 0, gw - 1), j = clamp(Math.round((y - box[1]) / cell), 0, gh - 1); return land[j * gw + i] ? dLand[j * gw + i] * cell : 0; };
    const peaks = [];
    for (let k = 0; k < 900 && peaks.length < 90; k++) {
      const x = rr(r, 40, W - 40), y = rr(r, 60, H - 40), d = at(x, y);
      if (d < 40 || fbm(n2, x / 300, y / 300, 2) < -.05) continue;
      if (peaks.some(p => Math.abs(p[0] - x) < 40 && Math.abs(p[1] - y) < 26)) continue;
      peaks.push([x, y, rr(r, 13, 22) * (d > 90 ? 1.3 : 1)]);
    }
    peaks.sort((a, b) => a[1] - b[1]);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    peaks.forEach(([mx, my, s]) => {
      const tip = [mx + rr(r, -.15, .15) * s, my - s * rr(r, 1, 1.4)];
      ctx.beginPath(); ctx.moveTo(mx - s * 1.1, my); ctx.quadraticCurveTo(mx - s * .4, my - s * .5, tip[0], tip[1]); ctx.quadraticCurveTo(mx + s * .45, my - s * .45, mx + s * 1.1, my);
      ctx.fillStyle = rgba(mixHex(paperC, P.yellow, .2), .9); ctx.fill();
      ctx.strokeStyle = rgba(ink, .85); ctx.lineWidth = 1.4; ctx.stroke();
      ctx.lineWidth = .8; ctx.beginPath();
      for (let k = 1; k <= 5; k++) {
        const t = k / 6, px = lerp(tip[0], mx + s * 1.1, t), py = lerp(tip[1], my, t) - Math.sin(t * Math.PI) * s * .12;
        ctx.moveTo(px, py); ctx.lineTo(px - s * .25, py + (my - py) * .8);
      }
      ctx.stroke();
    });
    ctx.fillStyle = rgba(ink, .55);
    for (let k = 0; k < 520; k++) {
      const x = rr(r, 30, W - 30), y = rr(r, 40, H - 30), d = at(x, y);
      if (d < 18 || d > 120 || fbm(n2, x / 200 + 9, y / 200, 2) < .12) continue;
      if (peaks.some(p => Math.abs(p[0] - x) < 26 && Math.abs(p[1] - y) < 26)) continue;
      ctx.beginPath(); circle(ctx, x, y - 6, 3.4); ctx.rect(x - .5, y - 4, 1, 5); ctx.fill();
    }

    // The compass rose.
    const rose = (cx, cy, R) => {
      ctx.save();
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
      ctx.beginPath(); circle(ctx, cx, cy, R * 1.12); ctx.fillStyle = rgba(paperC, .75); ctx.fill();
      ctx.beginPath(); circle(ctx, cx, cy, R * 1.12); circle(ctx, cx, cy, R * 1.04); ctx.stroke();
      ctx.beginPath();
      for (let i = 0; i < 128; i++) { const a = i * TAU / 128, l = i % 4 === 0 ? R * .96 : R * 1.0; ctx.moveTo(cx + Math.cos(a) * l, cy + Math.sin(a) * l); ctx.lineTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04); }
      ctx.lineWidth = .7; ctx.stroke();
      ctx.lineWidth = 1;
      const pts = [];
      for (let i = 0; i < 32; i++) pts.push(i);
      pts.sort((a, b) => (b % 8 === 0) - (a % 8 === 0) || (b % 4 === 0) - (a % 4 === 0) || (b % 2 === 0) - (a % 2 === 0)).reverse();
      for (const i of pts) {
        const a = i * TAU / 32 - Math.PI / 2;
        const len = i % 8 === 0 ? R : i % 4 === 0 ? R * .74 : i % 2 === 0 ? R * .56 : R * .42;
        const w = i % 8 === 0 ? R * .13 : i % 4 === 0 ? R * .1 : R * .065;
        const c = Math.cos(a), s = Math.sin(a), tip = [cx + c * len, cy + s * len];
        const side = sd => [cx + c * len * .2 - s * w * sd, cy + s * len * .2 + c * w * sd];
        const fillA = i % 8 === 0 ? ink : i % 4 === 0 ? P.red : i % 2 === 0 ? P.green : P.yellow;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...tip); ctx.lineTo(...side(1)); ctx.closePath();
        ctx.fillStyle = mixHex(fillA, paperC, .1); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...tip); ctx.lineTo(...side(-1)); ctx.closePath();
        ctx.fillStyle = mixHex(paperC, '#ffffff', night ? 0 : .3); ctx.fill(); ctx.stroke();
      }
      ctx.beginPath(); circle(ctx, cx, cy, R * .07); ctx.fillStyle = P.red; ctx.fill(); ctx.stroke();
      // An ornament above north.
      ctx.beginPath(); ctx.moveTo(cx, cy - R * 1.32); ctx.lineTo(cx + R * .07, cy - R * 1.2); ctx.lineTo(cx, cy - R * 1.12); ctx.lineTo(cx - R * .07, cy - R * 1.2); ctx.closePath();
      ctx.fillStyle = P.red; ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    rose(RC[0], RC[1], 160);

    // A ship under sail.
    const ship = (sx, sy, s) => {
      ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s);
      ctx.strokeStyle = ink; ctx.lineWidth = 1.4 / s * .8; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(-60, -10); ctx.quadraticCurveTo(-40, 14, 0, 14); ctx.quadraticCurveTo(44, 14, 62, -14); ctx.lineTo(40, -8); ctx.lineTo(-44, -8); ctx.lineTo(-62, -22); ctx.closePath();
      ctx.fillStyle = mixHex(P.brown, paperC, night ? .2 : .35); ctx.fill(); ctx.stroke();
      [[-28, 62], [6, 84], [36, 58]].forEach(([mx, mh]) => {
        ctx.beginPath(); ctx.moveTo(mx, -8); ctx.lineTo(mx, -8 - mh); ctx.stroke();
        for (const [y0, h, w] of [[-14, mh * .38, mh * .36], [-14 - mh * .44, mh * .32, mh * .28]]) {
          ctx.beginPath(); ctx.moveTo(mx - w, y0 - h); ctx.quadraticCurveTo(mx, y0 - h + 6, mx + w, y0 - h); ctx.quadraticCurveTo(mx + w * 1.15, y0 - h / 2, mx + w, y0);
          ctx.quadraticCurveTo(mx, y0 + 7, mx - w, y0); ctx.quadraticCurveTo(mx - w * .85, y0 - h / 2, mx - w, y0 - h); ctx.closePath();
          ctx.fillStyle = mixHex(paperC, '#ffffff', night ? .08 : .4); ctx.fill(); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(mx, -8 - mh); ctx.lineTo(mx + 14, -4 - mh); ctx.lineTo(mx, -mh); ctx.fillStyle = P.red; ctx.fill();
      });
      ctx.beginPath();
      for (let k = -3; k <= 3; k++) { ctx.moveTo(k * 26 - 12, 22 + Math.abs(k) * 2); ctx.quadraticCurveTo(k * 26, 14 + Math.abs(k) * 2, k * 26 + 12, 22 + Math.abs(k) * 2); }
      ctx.stroke();
      ctx.restore();
    };
    ship(1530, 250, 1);

    // A scale bar with dividers.
    const bar = [1310, 960];
    ctx.strokeStyle = ink; ctx.lineWidth = 1.2;
    ctx.fillStyle = mixHex(paperC, '#ffffff', night ? .05 : .4); ctx.fillRect(bar[0] - 8, bar[1] - 30, 336, 48);
    ctx.strokeRect(bar[0] - 8, bar[1] - 30, 336, 48);
    for (let k = 0; k < 8; k++) { ctx.fillStyle = k % 2 ? paperC : ink; ctx.fillRect(bar[0] + k * 40, bar[1], 40, 8); }
    ctx.strokeRect(bar[0], bar[1], 320, 8);
    ctx.beginPath(); ctx.moveTo(bar[0] + 80, bar[1] - 4); ctx.lineTo(bar[0] + 120, bar[1] - 64); ctx.lineTo(bar[0] + 160, bar[1] - 4); ctx.stroke();
    ctx.beginPath(); circle(ctx, bar[0] + 120, bar[1] - 66, 4); ctx.stroke();

    // The border with a degree scale.
    ctx.lineWidth = 2.4; ctx.strokeStyle = ink;
    ctx.strokeRect(26, 26, W - 52, H - 52);
    ctx.lineWidth = 1; ctx.strokeRect(40, 40, W - 80, H - 80);
    ctx.fillStyle = ink;
    for (let x = 40, k = 0; x < W - 40; x += 40, k++) if (k % 2) { ctx.fillRect(x, 26, Math.min(40, W - 40 - x), 14); ctx.fillRect(x, H - 40, Math.min(40, W - 40 - x), 14); }
    for (let y = 40, k = 0; y < H - 40; y += 40, k++) if (k % 2) { ctx.fillRect(26, y, 14, Math.min(40, H - 40 - y)); ctx.fillRect(W - 40, y, 14, Math.min(40, H - 40 - y)); }

    // Folds and wear.
    const folds = x => { x.beginPath(); x.moveTo(960, 0); x.lineTo(960, H); x.moveTo(0, 540); x.lineTo(W, 540); };
    soft(ctx, 6, x => { x.strokeStyle = '#000000'; x.lineWidth = 6; folds(x); x.stroke(); }, night ? .35 : .14);
    ctx.save(); ctx.translate(2, 2); ctx.strokeStyle = rgba('#ffffff', night ? .06 : .4); ctx.lineWidth = 1.5; folds(ctx); ctx.stroke(); ctx.restore();
    foxing(ctx, r, 60, night ? '#000000' : P.brown, night ? .3 : .16, [0, 0, W, H], 6);
    vignette(ctx, P, night ? .55 : .2);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paper/ink-wash ----------

  scene('paper', 'ink-wash', (ctx, P, r) => {
    const night = P.night;
    const paperC = night ? mixHex(P.background, P.lighter_background, .5) : mixHex(P.background, '#ffffff', .35);
    const inkC = night ? mixHex(P.bright_foreground, P.foreground, .3) : mixHex(P.foreground, '#000000', .45);
    // Rice paper.
    ctx.fillStyle = radial(ctx, 1100, 420, 60, 1300, [[0, night ? mixHex(paperC, P.muted, .1) : mixHex(paperC, '#ffffff', .3)], [.65, paperC], [1, night ? P.darker_background : P.dark_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.muted, night ? .3 : .06, 260);
    fibers(ctx, r, 1600, night ? P.muted : P.dark_foreground, night ? .1 : .05, .5, 26);
    fibers(ctx, r, 900, night ? '#000000' : '#ffffff', night ? .2 : .5, .9, 34);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, night ? P.muted : '#ffffff', night ? .3 : .2);

    // Uneven absorption of the paper, cut out of each wash.
    const nz = makeNoise(r() * 1e9 | 0);
    const blot = texture(480, 270, (x, y, o) => { const v = fbm(nz, x / 70, y / 70, 4); o[0] = o[1] = o[2] = 0; o[3] = clamp(.35 + v * 1.4, 0, 1) * 255; });

    // Mountains: washes that are dark at the ridge and fade into mist.
    const n = makeNoise(r() * 1e9 | 0);
    const range = (x0, x1, base, peaks, a, mist, blur, rough) => {
      const pts = [];
      for (let x = x0; x <= x1; x += 4) {
        let h = 0;
        for (const [px, ph, pw] of peaks) h = Math.max(h, ph * Math.max(0, 1 - Math.abs(x - px) / pw) ** 1.5);
        const crag = 1 - Math.abs(n(x / 70 + base, base * .1));
        pts.push([x, base - h * (1 + (crag - .6) * rough) - fbm(n, x / 40, base, 3) * 10 * rough]);
      }
      const top = Math.min(...pts.map(p => p[1]));
      // Strong alpha inside the soft layer keeps the grey neutral. The range alpha applies when the layer is drawn.
      soft(wx, blur, x => {
        const band = d => { x.beginPath(); pts.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); for (let i = pts.length - 1; i >= 0; i--) x.lineTo(pts[i][0], Math.min(base + mist, pts[i][1] + d)); x.closePath(); x.fill(); };
        x.fillStyle = rgba(inkC, .09);
        for (let d = 10; d <= 130; d += 10) band(d);
        x.fillStyle = linear(x, 0, top, 0, base + mist, [[0, rgba(inkC, .3)], [.6, rgba(inkC, .2)], [1, rgba(inkC, 0)]]);
        band(2000);
        x.globalCompositeOperation = 'destination-out'; x.globalAlpha = .55; x.drawImage(blot, 0, 0, W, H);
      }, a, 'source-over', [x0 - 20, top - 20, x1 + 20, base + mist]);
      return pts;
    };
    const [wc, wx] = layer();
    range(780, 1500, 600, [[900, 150, 160], [1060, 230, 190], [1210, 170, 170], [1360, 120, 160]], .2, 120, 4, .5);
    const mid = range(1150, 1990, 700, [[1290, 320, 170], [1470, 470, 200], [1640, 400, 180], [1840, 320, 200]], .55, 200, 2.2, 1);
    range(1230, 1760, 830, [[1350, 150, 140], [1560, 230, 170]], .38, 110, 2.6, .8);
    // Ink settles unevenly in the fibers of the paper.
    tileFill(wx, softTile(r() * 1e9 | 0, 192, 1.2, '#000000', v => smooth(clamp((v - .4) / .6, 0, 1)) * .45), 1, 1, 'destination-out');
    put(ctx, wc);

    // Ink strokes go on 1 layer, so they can bleed into the paper.
    const [lc, lx] = layer();
    // Texture strokes down the slopes of the middle range.
    for (let i = 8; i < mid.length - 8; i += 9) {
      const [px, py] = mid[i], q = mid[i + 4], dir = Math.atan2(q[1] - py, q[0] - px) + Math.PI / 2 * (r() < .5 ? .7 : 1.1);
      if (r() < .3) continue;
      const len = rr(r, 40, 120), pts = spline([[px, py + 4], [px + Math.cos(dir) * len * .5 + rr(r, -8, 8), py + Math.sin(dir) * len * .5], [px + Math.cos(dir) * len, py + Math.sin(dir) * len]], 3);
      bristles(lx, pts, t => rr(r, 6, 14) * (1 - t * .6), inkC, .55, r, { count: 10, dry: t => .25 + t * .6, freq: .15, lw: 1.8 });
    }
    // Moss dots on the high ridges.
    lx.fillStyle = inkC;
    for (let i = 0; i < mid.length; i += 4) {
      if (r() < .7 || mid[i][1] > 560) continue;
      const [px, py] = mid[i];
      lx.globalAlpha = rr(r, .5, .9);
      lx.beginPath(); ellipse(lx, px + rr(r, -6, 6), py + rr(r, -2, 6), rr(r, 2, 5), rr(r, 1.5, 3.5), r() * 3); lx.fill();
    }
    lx.globalAlpha = 1;
    // A rock with a pine in the lower right corner.
    const rock = spline([[1460, 1100], [1500, 960], [1580, 900], [1690, 880], [1790, 840], [1960, 820]], 4);
    soft(ctx, 2, x => {
      x.beginPath(); x.moveTo(1460, 1100); rock.forEach(p => x.lineTo(p[0], p[1])); x.lineTo(1960, 1100); x.closePath();
      x.fillStyle = linear(x, 0, 820, 0, 1080, [[0, rgba(inkC, 1)], [.5, rgba(inkC, .5)], [1, rgba(inkC, .16)]]); x.fill();
      x.globalCompositeOperation = 'destination-out'; x.globalAlpha = .5; x.drawImage(blot, 0, 0, W, H);
    }, .5, 'source-over', [1440, 800, W, H]);
    bristles(lx, rock, t => 14 - t * 6, inkC, .85, r, { count: 14, dry: t => .2 + t * .3, freq: .1 });
    for (let k = 0; k < 6; k++) {
      const s0 = rock[Math.round(rr(r, .15, .8) * (rock.length - 1))], len = rr(r, 60, 140);
      bristles(lx, spline([[s0[0], s0[1] + 8], [s0[0] + rr(r, -20, 10), s0[1] + len * .5], [s0[0] + rr(r, -40, 0), s0[1] + len]], 3), t => 9 * (1 - t * .7), inkC, .55, r, { count: 8, dry: t => .3 + t * .5, freq: .2 });
    }
    // The pine: a crooked trunk, flat branches and pads of needles.
    const trunk = spline([[1700, 884], [1676, 790], [1716, 700], [1688, 610], [1630, 540]], 3);
    lx.beginPath(); taper(lx, trunk, t => 26 - t * 16); lx.fillStyle = rgba(inkC, .55); lx.fill();
    bristles(lx, trunk, t => 26 - t * 16, inkC, .9, r, { count: 18, dry: t => .15 + t * .2, freq: .12, lw: 1.6 });
    const pads = [];
    [[.3, -1, 150], [.48, 1, 190], [.66, -1, 170], [.84, 1, 150], [1, -1, 110]].forEach(([t, sd, len]) => {
      const p = trunk[Math.round(t * (trunk.length - 1))];
      const br = spline([p, [p[0] + sd * len * .45, p[1] - rr(r, 6, 24)], [p[0] + sd * len, p[1] + rr(r, -16, 6)]], 3);
      lx.beginPath(); taper(lx, br, u => 9 - u * 6); lx.fillStyle = rgba(inkC, .85); lx.fill();
      pads.push([br[br.length - 1], 1.1], [br[Math.round(br.length * .55)], .8]);
    });
    soft(ctx, 5, x => {
      x.fillStyle = rgba(inkC, .32);
      pads.forEach(([[px, py], k]) => { x.beginPath(); ellipse(x, px, py - 8 * k, 46 * k, 16 * k); x.fill(); });
    }, 1, 'source-over', [1400, 420, W, 900]);
    lx.strokeStyle = inkC; lx.lineCap = 'round';
    pads.forEach(([[px, py], k]) => {
      for (let j = 0; j < 3; j++) {
        const cx = px + rr(r, -26, 26) * k, cy = py - rr(r, 4, 14) * k;
        for (let i = 0; i < 16; i++) {
          const ang = -Math.PI + (i / 15) * Math.PI + rr(r, -.06, .06), l = rr(r, 16, 30) * k;
          lx.globalAlpha = rr(r, .6, .95); lx.lineWidth = rr(r, 1.3, 2.4);
          lx.beginPath(); lx.moveTo(cx, cy); lx.lineTo(cx + Math.cos(ang) * l * 1.3, cy + Math.sin(ang) * l * .55); lx.stroke();
        }
      }
    });
    lx.globalAlpha = 1;

    // Bamboo on the left: stalks of segments, twigs and leaves.
    const leafStroke = (x, y, a, len, wid, alpha) => {
      const c = rr(r, -.18, .18);
      const pts = spline([[x, y], [x + Math.cos(a) * len * .5, y + Math.sin(a) * len * .5], [x + Math.cos(a + c) * len, y + Math.sin(a + c) * len]], 3);
      lx.beginPath(); taper(lx, pts, t => wid * (t < .12 ? .25 + t / .12 * .75 : 1 - ((t - .12) / .88) ** 1.6) + .3);
      lx.fillStyle = rgba(inkC, alpha); lx.fill();
    };
    [[52, 16, .3, .02], [272, 21, .48, -.06], [150, 30, .9, .07]].forEach(([bx, wd, alpha, lean]) => {
      let y = 1110;
      const xAt = yy => bx + (1110 - yy) * lean * .15 + Math.sin(yy / 300) * 6;
      while (y > -60) {
        const seg = rr(r, 130, 175);
        const pts = spline([[xAt(y - 5), y - 5], [xAt(y - seg / 2), y - seg / 2], [xAt(y - seg + 5), y - seg + 5]], 3);
        lx.save();
        lx.beginPath(); taper(lx, pts, t => wd * (1 - Math.sin(t * Math.PI) * .06)); lx.clip();
        lx.fillStyle = linear(lx, xAt(y) - wd / 2, 0, xAt(y) + wd / 2, 0, [[0, rgba(inkC, alpha)], [.3, rgba(inkC, alpha * .62)], [.65, rgba(inkC, alpha * .78)], [1, rgba(inkC, alpha * .95)]]);
        lx.fillRect(xAt(y) - wd, y - seg - 10, wd * 2, seg + 20);
        lx.restore();
        bristles(lx, pts, () => wd, inkC, alpha * .5, r, { count: 10, dry: t => .5, freq: .06, lw: 1.2 });
        lx.strokeStyle = rgba(inkC, Math.min(1, alpha * 1.15)); lx.lineWidth = 3.4; lx.lineCap = 'round';
        lx.beginPath(); lx.moveTo(xAt(y) - wd * .62, y - 1); lx.quadraticCurveTo(xAt(y), y + 5, xAt(y) + wd * .62, y - 1); lx.stroke();
        if (y < 820) {
          for (const sd of [-1, 1]) {
            if (r() < .45) continue;
            const tx = xAt(y) + sd * wd * .4, a = -Math.PI / 2 + sd * rr(r, .45, .9), tl = rr(r, 60, 130);
            const ex = tx + Math.cos(a) * tl, ey = y + Math.sin(a) * tl;
            lx.lineWidth = 2.4; lx.beginPath(); lx.moveTo(tx, y - 4); lx.quadraticCurveTo((tx + ex) / 2 + sd * 12, (y + ey) / 2, ex, ey); lx.stroke();
            const count = 3 + Math.floor(r() * 3), fan = sd > 0 ? .5 : Math.PI - .5;
            for (let k = 0; k < count; k++) {
              const ang = fan + sd * (k - (count - 1) / 2) * .32 + rr(r, -.1, .1) + .35;
              leafStroke(ex, ey, ang, rr(r, 90, 160) * (alpha > .6 ? 1 : .8), rr(r, 15, 21) * (alpha > .6 ? 1 : .8), alpha * rr(r, .8, 1));
            }
          }
        }
        y -= seg;
      }
    });
    // Birds far away.
    lx.strokeStyle = inkC; lx.lineCap = 'round'; lx.lineWidth = 2.2;
    [[1000, 250, 1], [1060, 222, .8], [1110, 268, .7]].forEach(([bx, by, s]) => {
      lx.globalAlpha = .8;
      lx.beginPath(); lx.moveTo(bx - 16 * s, by - 5 * s); lx.quadraticCurveTo(bx - 7 * s, by - 9 * s, bx, by); lx.quadraticCurveTo(bx + 8 * s, by - 10 * s, bx + 18 * s, by - 7 * s); lx.stroke();
    });
    lx.globalAlpha = 1;
    // The strokes bleed a little into the fibers.
    haze(ctx, lc, 3, night ? .5 : .35);
    put(ctx, lc, .95);
    fibers(ctx, r, 700, paperC, .25, .7, 30);

    // The vermilion seal: a square with a carved pattern, cut on its own layer.
    const sx = 1792, sy = 960, ss = 58;
    const [sc, sxx] = boxLayer([sx - 50, sy - 50, sx + 50, sy + 60]);
    sxx.translate(sx, sy); sxx.rotate(.02);
    sxx.fillStyle = P.red;
    sxx.beginPath(); sxx.roundRect(-ss / 2, -ss / 2, ss, ss * 1.1, 4); sxx.fill();
    // The carving: a thin inner frame, a sun and 2 lines of waves. A picture, not a sign.
    sxx.globalCompositeOperation = 'destination-out';
    sxx.strokeStyle = '#000000'; sxx.lineCap = 'round'; sxx.lineJoin = 'round';
    sxx.lineWidth = 2.6; sxx.beginPath(); sxx.roundRect(-ss / 2 + 6, -ss / 2 + 6, ss - 12, ss * 1.1 - 12, 2); sxx.stroke();
    sxx.lineWidth = 3.6; sxx.beginPath(); circle(sxx, 7, -10, 7); sxx.stroke();
    for (const wy of [10, 20]) { sxx.beginPath(); sxx.moveTo(-17, wy); for (let k = 0; k < 4; k++) sxx.quadraticCurveTo(-17 + k * 9 + 4.5, wy - 6, -17 + (k + 1) * 9, wy); sxx.stroke(); }
    sxx.setTransform(...sc.base);
    tileFill(sxx, softTile(r() * 1e9 | 0, 128, .8, '#000000', v => smooth(clamp((v - .55) / .3, 0, 1)) * .8), 1, .7, 'destination-out', [sx - 50, sy - 50, 100, 110]);
    putBox(ctx, sc, .95);

    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .03);
  });
  // ---------- paper/newsprint ----------

  scene('paper', 'newsprint', (ctx, P, r) => {
    const night = P.night;
    const paperC = night ? mixHex(P.background, P.lighter_background, .6) : mixHex(P.background, '#ffffff', .15);
    const ink = night ? P.light_foreground : P.foreground;
    // Newsprint: grey flecks, yellowed toward the edges.
    ctx.fillStyle = radial(ctx, 900, 500, 80, 1250, night
      ? [[0, mixHex(paperC, P.muted, .1)], [.6, paperC], [1, P.darker_background]]
      : [[0, mixHex(paperC, '#ffffff', .25)], [.6, paperC], [1, mixHex(P.darker_background, P.orange, .14)]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.orange, night ? .3 : .08, 240);
    fibers(ctx, r, 2600, night ? P.muted : P.dark_foreground, night ? .12 : .1, .5, 7);
    fibers(ctx, r, 1600, night ? '#000000' : '#ffffff', night ? .2 : .4, .7, 10);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, night ? P.muted : '#ffffff', night ? .35 : .3, 1);

    const q = rng(r() * 1e9 | 0);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(-.018); ctx.translate(-W / 2, -H / 2);
    // The other side of the sheet shows through, mirrored.
    ctx.fillStyle = rgba(ink, night ? .05 : .045);
    for (let y = 230; y < H; y += 10.5) for (let c = 0; c < 6; c++) if (q() < .85) ctx.fillRect(1880 - c * 304 - 280, y + 4, 280 * (q() < .15 ? q() : 1), 3);

    const [lc, lx] = twin(ctx);
    lx.fillStyle = ink; lx.strokeStyle = ink;
    const colX = k => 60 + k * 304, colW = 280;
    // Lines of text with word gaps. Paragraphs end short.
    const text = (x0, y0, w, lines, lh = 10.5, ht = 3.3) => {
      let para = 3 + Math.floor(q() * 6);
      for (let i = 0; i < lines; i++, para--) {
        const y = y0 + i * lh, indent = para === 0 ? 0 : 0, end = para === 0 ? w * (.25 + q() * .6) : w;
        let x = x0 + (para === -1 ? 14 : indent);
        if (para < 0) para = 3 + Math.floor(q() * 7);
        while (x < x0 + end - 4) { const ww = Math.min(x0 + end - x, 8 + q() * 34); lx.fillRect(x, y, ww, ht); x += ww + 3.4; }
      }
      return y0 + lines * lh;
    };
    const head = (x0, y0, w, rows, ht) => {
      for (let i = 0; i < rows; i++) {
        let x = x0;
        const end = i === rows - 1 ? w * (.5 + q() * .4) : w;
        while (x < x0 + end - 10) { const ww = Math.min(x0 + end - x, ht * (1.4 + q() * 4)); lx.beginPath(); lx.roundRect(x, y0 + i * ht * 1.45, ww, ht, ht * .18); lx.fill(); x += ww + ht * .55; }
      }
      return y0 + rows * ht * 1.45;
    };
    // A halftone picture: dots on a 45 degree screen. dark gives the tone.
    const halftone = (x0, y0, w, h, dark, step = 6.4) => {
      lx.save(); lx.beginPath(); lx.rect(x0, y0, w, h); lx.clip();
      const c = Math.SQRT1_2;
      lx.beginPath();
      for (let a = -h - w; a < w + h; a += step) {
        for (let b = -h - w; b < w + h; b += step) {
          const x = x0 + w / 2 + (a - b) * c, y = y0 + h / 2 + (a + b) * c;
          if (x < x0 - step || x > x0 + w + step || y < y0 - step || y > y0 + h + step) continue;
          let v = clamp(dark((x - x0) / w, (y - y0) / h), 0, 1);
          if (night) v = 1 - v;
          if (v > .03) { const rad = step * .62 * Math.sqrt(v); lx.moveTo(x + rad, y); lx.arc(x, y, rad, 0, TAU); }
        }
      }
      lx.fill();
      lx.restore();
      lx.lineWidth = 1; lx.strokeRect(x0, y0, w, h);
    };

    // The masthead.
    lx.fillRect(40, 36, W - 80, 4); lx.fillRect(40, 44, W - 80, 1.2);
    // The title: the shapes of 3 bold words, with bumps for tall letters.
    let mx = 520;
    for (const ww of [250, 170, 290]) {
      lx.beginPath(); lx.roundRect(mx, 80, ww, 44, 5);
      for (let k = 0; k < 3; k++) { const bx = mx + 6 + q() * (ww - 30); lx.roundRect(bx, 62, 16, 30, 3); }
      lx.fill();
      mx += ww + 36;
    }
    lx.fillRect(40, 148, W - 80, 1.2); lx.fillRect(40, 152, W - 80, 4);
    for (const [x, w] of [[60, 220], [850, 220], [1640, 220]]) { let u = x; while (u < x + w) { const ww = 8 + q() * 26; lx.fillRect(u, 165, Math.min(ww, x + w - u), 3); u += ww + 4; } }
    lx.fillRect(40, 180, W - 80, 1);

    // The lead story: a large headline and a picture over 3 columns.
    let y = head(colX(0), 198, colX(4) - colX(0) - 24, 2, 24);
    const n = makeNoise(q() * 1e9 | 0);
    halftone(colX(0), y + 10, colX(3) - colX(0) - 24, 380, (u, v) => {
      let d = .12 + v * .1 - fbm(n, u * 4, v * 4, 3) * .12 * (v < .45 ? 1 : 0);
      d -= .5 * Math.exp(-((u - .7) ** 2 * 30 + (v - .28) ** 2 * 60));
      const ridge = .5 - (fbm(n, u * 5 + 3, 1.7, 4) * .5 + .5) * .2;
      if (v > ridge) d = .55 + (v - ridge) * .5;
      if (v > .62) d = .32 + Math.sin(v * 140) * .06 + n(u * 30, v * 8) * .08 - .3 * Math.exp(-((u - .7) ** 2) * 90);
      const bu = (u - .3) / .1, bv = (v - .45) / .2;
      if (bv > 0 && bv < 1 && Math.abs(bu) < bv * .5 && bu > -.02) d = .08;
      if (bv > 0 && bv < 1 && bu < 0 && bu > -bv * .35) d = .2;
      if (v > .64 && v < .67 && Math.abs(u - .3) < .07) d = .9;
      return d + Math.hypot(u - .5, v - .5) * .25;
    });
    const py = y + 400;
    text(colX(0), py, colX(3) - colX(0) - 24, 2, 9, 2.6);
    let ty = text(colX(0), py + 30, colW, 50);
    text(colX(1), py + 30, colW, 50); text(colX(2), py + 30, colW, 50);
    text(colX(3), y + 10, colW, 82);
    void ty;

    // The second story with a small picture.
    y = head(colX(4), 198, colX(6) - colX(4) - 24, 3, 15);
    y = text(colX(4), y + 12, colW, 22);
    text(colX(5), y - 22 * 10.5, colW, 22);
    halftone(colX(4), y + 12, colX(6) - colX(4) - 24, 230, (u, v) => {
      let d = .1 + v * .12;
      const bx = [[.08, .2, .55], [.2, .3, .35], [.3, .42, .62], [.42, .48, .2], [.48, .6, .48], [.6, .7, .3], [.7, .82, .58], [.82, .95, .4]];
      for (const [a, b, top] of bx) if (u > a && u < b && v > top) d = .7 + (u - a) * .4 - (Math.sin(v * 80) > .6 && u % .03 > .015 ? .4 : 0);
      if (u > .44 && u < .46 && v > .05) d = .8;
      if (v > .85) d = .45 + Math.sin(u * 60) * .05;
      return d;
    });
    y += 256;
    y = text(colX(4), y, colW, 19); text(colX(5), y - 19 * 10.5, colW, 19);
    // A pull quote between rules.
    lx.fillRect(colX(4), y + 10, colX(6) - colX(4) - 24, 2);
    head(colX(4) + 20, y + 26, colX(6) - colX(4) - 64, 2, 12);
    lx.fillRect(colX(4), y + 74, colX(6) - colX(4) - 24, 2);
    text(colX(4), y + 92, colW, 30); text(colX(5), y + 92, colW, 30);
    // Column rules.
    for (let k = 1; k < 6; k++) lx.fillRect(colX(k) - 12.6, k < 4 ? 680 : 198, .9, H);
    lx.fillRect(colX(4) - 12.6, 198, .9, 480);
    put(ctx, lc, 1);
    void lc;
    // Worn ink: specks of paper show through.
    ctx.restore();
    tileFill(ctx, tile(r() * 1e9 | 0, 256, paperC, v => (v > .82 ? .9 : 0)), .9, night ? .5 : .6);
    haze(ctx, lc, 1.5, night ? .2 : .18);

    // The blue pencil of the editor, and a few red marks.
    const [pc, px] = layer();
    px.lineCap = 'round'; px.lineJoin = 'round';
    const pencil = (pts, color, w = 3.6) => { px.strokeStyle = color; px.lineWidth = w; px.beginPath(); curve(px, spline(pts, 6)); px.stroke(); };
    const blue = P.blue, red = P.red;
    const loop = (cx, cy, rx, ry, a0) => { const pts = []; for (let k = 0; k <= 22; k++) { const a = a0 + k / 20 * TAU; pts.push([cx + Math.cos(a) * rx * (1 + k * .004), cy + Math.sin(a) * ry * (1 - k * .006)]); } pencil(pts, blue); };
    loop(1060, 520, 170, 80, -2.6);
    pencil([[1240, 470], [1330, 420], [1420, 440]], blue);
    pencil([[1405, 428], [1422, 441], [1402, 452]], blue);
    pencil([[690, 860], [700, 960], [692, 1040]], blue, 3);
    pencil([[360, 905], [600, 902]], blue, 2.2); pencil([[360, 926], [540, 924]], blue, 2.2);
    pencil([[1500, 230], [1520, 262], [1590, 170]], blue, 4.4);
    pencil([[930, 700], [1180, 640]], blue, 3.4); pencil([[940, 640], [1170, 700]], blue, 3.4);
    pencil([[1660, 300], [1690, 300], [1690, 480], [1660, 480]], blue);
    pencil([[1420, 760], [1700, 762]], blue, 2.4); pencil([[1420, 772], [1650, 774]], blue, 2.4);
    pencil([[100, 1010], [140, 990], [150, 1020], [120, 1028], [180, 1000]], blue);
    pencil([[1220, 960], [1240, 930], [1260, 960]], red, 2.4);
    px.strokeStyle = red; px.lineWidth = 2.2; px.beginPath(); circle(px, 1810, 560, 14); px.stroke();
    pencil([[1780, 620], [1830, 660]], red, 2.2); pencil([[1830, 620], [1780, 660]], red, 2.2);
    tileFill(px, tile(r() * 1e9 | 0, 256, '#000000', v => (v > .55 ? (v - .55) * 2.2 : 0)), .8, 1, 'destination-out');
    if (night) haze(ctx, pc, 4, .5, 'screen');
    put(ctx, pc, night ? .95 : .9);

    // A fold across the middle.
    soft(ctx, 7, x => { x.strokeStyle = '#000000'; x.lineWidth = 8; x.beginPath(); x.moveTo(0, 548); x.lineTo(W, 536); x.stroke(); }, night ? .45 : .14);
    ctx.strokeStyle = rgba('#ffffff', night ? .06 : .45); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(0, 552); ctx.lineTo(W, 540); ctx.stroke();
    vignette(ctx, P, night ? .5 : .15);
    grain(ctx, r() * 1e9 | 0, night ? .05 : .04);
  });
  // ---------- paper/chalkboard ----------

  scene('paper', 'chalkboard', (ctx, P, r) => {
    const night = P.night;
    const board = night ? P.background : P.background;
    const white = night ? mixHex(P.bright_foreground, P.foreground, .3) : P.foreground;
    const yellow = night ? P.yellow : mixHex(P.yellow, P.orange, .3);
    const pink = night ? P.blue : P.blue;
    // The slate.
    ctx.fillStyle = radial(ctx, 960, 470, 100, 1250, night
      ? [[0, mixHex(board, P.lighter_background, .7)], [.6, board], [1, P.darker_background]]
      : [[0, mixHex(board, '#ffffff', .35)], [.6, board], [1, P.darker_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.cyan, night ? .35 : .06, 220);
    mottle(ctx, r() * 1e9 | 0, night ? P.lighter_background : '#ffffff', night ? .5 : .5, 90, -.05);
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, night ? P.muted : '#ffffff', night ? .3 : .25, 1);

    // Old erasing: wide arcs of chalk dust and the ghost of an earlier lesson.
    soft(ctx, 22, x => {
      x.strokeStyle = white; x.lineCap = 'round';
      for (const [cx, cy, rad, a0, a1, w, al] of [[700, 560, 380, 3.6, 5.2, 170, .1], [1250, 420, 300, .3, 1.9, 150, .08], [400, 820, 250, 4, 5.5, 130, .07], [1600, 860, 300, 3.3, 4.4, 160, .08]]) {
        x.globalAlpha = al; x.lineWidth = w; x.beginPath(); x.arc(cx, cy, rad, a0, a1); x.stroke();
      }
    }, night ? 1 : .8);
    ctx.save();
    ctx.strokeStyle = rgba(white, night ? .05 : .05); ctx.lineWidth = 1;
    for (let k = 0; k < 160; k++) {
      const cx = 700, cy = 560, rad = 300 + k, a0 = 3.7 + r() * .3;
      ctx.beginPath(); ctx.arc(cx, cy, rad, a0, a0 + rr(r, .3, 1.2)); ctx.stroke();
    }
    ctx.restore();
    soft(ctx, 2, x => {
      x.strokeStyle = white; x.lineWidth = 3; x.globalAlpha = .07;
      x.beginPath(); circle(x, 820, 470, 120); x.moveTo(600, 380); x.lineTo(1020, 620); x.moveTo(1180, 540); x.lineTo(1100, 300); x.stroke();
    });

    // The chalk drawing goes on 1 layer.
    const [lc, lx] = layer();
    lx.lineCap = 'round'; lx.lineJoin = 'round';
    const chalk = (color, w = 3.4, dash = []) => { lx.strokeStyle = color; lx.fillStyle = color; lx.lineWidth = w; lx.setLineDash(dash); };
    const wob = (pts, amp = 1.2) => pts.map(([x, y]) => [x + rr(r, -amp, amp), y + rr(r, -amp, amp)]);
    const line = (x0, y0, x1, y1) => { const pts = []; for (let k = 0; k <= 4; k++) pts.push([lerp(x0, x1, k / 4), lerp(y0, y1, k / 4)]); lx.beginPath(); curve(lx, wob(pts, 1)); lx.stroke(); };
    const arrowTip = (x, y, a, s = 16) => { lx.beginPath(); lx.moveTo(x + Math.cos(a + 2.6) * s, y + Math.sin(a + 2.6) * s); lx.lineTo(x, y); lx.lineTo(x + Math.cos(a - 2.6) * s, y + Math.sin(a - 2.6) * s); lx.stroke(); };
    const ring = (cx, cy, rad, a0 = 0, a1 = TAU) => { const pts = []; const n = Math.ceil(rad * Math.abs(a1 - a0) / 14); for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } lx.beginPath(); curve(lx, wob(pts, 1.2)); lx.stroke(); };
    // Notes as quick wavy strokes, 1 per word, with no letter shapes.
    const scribble = (x0, y0, len, ht = 16) => {
      let x = x0;
      while (x < x0 + len) {
        const wl = Math.min(rr(r, 40, 110), x0 + len - x), pts = [], ph = r() * 6;
        for (let t = 0; t <= wl; t += 6) pts.push([x + t, y0 - ht * .4 + Math.sin(t / 9 + ph) * ht * .16 + rr(r, -1, 1)]);
        lx.beginPath(); curve(lx, pts); lx.stroke();
        x += wl + rr(r, 14, 26);
      }
    };

    // The unit circle, and the sine wave that it draws.
    const C = [330, 320], R = 160, th = .75;
    chalk(white);
    ring(C[0], C[1], R);
    line(C[0] - R - 40, C[1], C[0] + R + 40, C[1]); arrowTip(C[0] + R + 40, C[1], 0);
    line(C[0], C[1] + R + 40, C[0], C[1] - R - 40); arrowTip(C[0], C[1] - R - 40, -Math.PI / 2);
    const Pt = [C[0] + Math.cos(-th) * R, C[1] + Math.sin(-th) * R];
    chalk(yellow, 3.8); line(C[0], C[1], Pt[0], Pt[1]);
    lx.beginPath(); circle(lx, Pt[0], Pt[1], 6); lx.fill();
    chalk(yellow, 2.6); ring(C[0], C[1], 46, -th, 0);
    chalk(white, 2.6, [10, 9]); line(Pt[0], Pt[1], Pt[0], C[1]); line(Pt[0], Pt[1], 560, Pt[1]);
    chalk(white); line(560, C[1], 1040, C[1]); arrowTip(1040, C[1], 0);
    line(560, C[1] + R + 10, 560, C[1] - R - 30);
    chalk(pink, 3.8);
    const sine = [];
    for (let x = 560; x <= 1000; x += 8) sine.push([x, C[1] - Math.sin((x - 560) / 440 * TAU * 1.25 + th) * R]);
    lx.beginPath(); curve(lx, wob(sine, .8)); lx.stroke();
    chalk(white, 2.8); scribble(640, 120, 260, 15);

    // A cube and a pyramid in perspective.
    chalk(white);
    const cube = [[1400, 200], [1580, 200], [1580, 380], [1400, 380]], off = [70, -60];
    const back = cube.map(([x, y]) => [x + off[0], y + off[1]]);
    for (let k = 0; k < 4; k++) { line(...cube[k], ...cube[(k + 1) % 4]); if (k !== 3) line(...back[k], ...back[(k + 1) % 4]); }
    [0, 1, 2].forEach(k => line(...cube[k], ...back[k]));
    chalk(white, 2.6, [12, 10]); line(...back[3], ...back[0]); line(...back[3], ...back[2]); line(...cube[3], ...back[3]);
    chalk(yellow, 3);
    line(1700, 420, 1800, 210); line(1800, 210, 1860, 400); line(1700, 420, 1860, 400); line(1800, 210, 1770, 370);
    chalk(yellow, 2.4, [10, 9]); line(1700, 420, 1770, 370); line(1770, 370, 1860, 400);
    chalk(white, 2.8); scribble(1420, 470, 300, 14); scribble(1420, 510, 200, 14);

    // Axes with a parabola and its tangent.
    const O = [190, 940];
    chalk(white);
    line(O[0] - 30, O[1], 760, O[1]); arrowTip(760, O[1], 0);
    line(O[0], O[1] + 20, O[0], 560); arrowTip(O[0], 560, -Math.PI / 2);
    lx.beginPath(); for (let k = 1; k < 9; k++) { lx.moveTo(O[0] + k * 64, O[1] - 7); lx.lineTo(O[0] + k * 64, O[1] + 7); lx.moveTo(O[0] - 7, O[1] - k * 44); lx.lineTo(O[0] + 7, O[1] - k * 44); } lx.stroke();
    chalk(yellow, 3.8);
    const par = [];
    for (let x = 230; x <= 720; x += 8) par.push([x, O[1] - 20 - ((x - 470) / 240) ** 2 * 320]);
    lx.beginPath(); curve(lx, wob(par, .8)); lx.stroke();
    const tx0 = 620, ty0 = O[1] - 20 - ((tx0 - 470) / 240) ** 2 * 320, sl = -2 * (tx0 - 470) / 240 ** 2 * 320;
    chalk(pink, 3.4); line(tx0 - 95, ty0 - sl * 95, tx0 + 110, ty0 + sl * 110);
    lx.beginPath(); circle(lx, tx0, ty0, 7); lx.fill();
    chalk(white, 2.8); scribble(520, 620, 220, 14);

    // A right triangle with a square on each side.
    const A = [1130, 770], B = [1330, 770], Cc = [1130, 620], mid3 = [(A[0] + B[0] + Cc[0]) / 3, (A[1] + B[1] + Cc[1]) / 3];
    chalk(white, 3.6);
    line(...A, ...B); line(...B, ...Cc); line(...Cc, ...A);
    lx.beginPath(); lx.moveTo(A[0] + 22, A[1]); lx.lineTo(A[0] + 22, A[1] - 22); lx.lineTo(A[0], A[1] - 22); lx.stroke();
    const sq = (p, q2, color) => {
      let dx = q2[0] - p[0], dy = q2[1] - p[1];
      if ((dy) * (mid3[0] - p[0]) + (-dx) * (mid3[1] - p[1]) > 0) { dx = -dx; dy = -dy; }
      const pts = [p, q2, [q2[0] + dy, q2[1] - dx], [p[0] + dy, p[1] - dx]];
      chalk(color, 3);
      for (let k = 0; k < 4; k++) if (k) line(...pts[k], ...pts[(k + 1) % 4]);
      lx.save(); lx.beginPath(); poly(lx, pts); lx.clip();
      lx.lineWidth = 1.6; lx.globalAlpha = .5; lx.beginPath();
      for (let k = -900; k < 900; k += 14) { lx.moveTo(p[0] + k - 600, p[1] - 600); lx.lineTo(p[0] + k + 600, p[1] + 600); }
      lx.stroke(); lx.restore();
    };
    sq(B, A, yellow); sq(A, Cc, pink); sq(Cc, B, white);
    chalk(white, 2.8); scribble(1420, 980, 300, 14);
    // A bracket and an arrow that tie it together.
    chalk(pink, 3.2);
    const arc = spline([[1000, 340], [1120, 420], [1200, 540]], 6);
    lx.beginPath(); curve(lx, wob(arc, 1)); lx.stroke(); arrowTip(1200, 540, 1.0);
    chalk(white, 3);
    lx.beginPath(); curve(lx, wob([[1720, 640], [1736, 650], [1736, 760], [1750, 770], [1736, 780], [1736, 890], [1720, 900]], .6)); lx.stroke();
    scribble(1770, 780, 100, 14);
    lx.setLineDash([]);

    // Chalk breaks up on the grain of the slate.
    tileFill(lx, tile(r() * 1e9 | 0, 256, '#000000', v => (v > .5 ? (v - .5) * 1.7 : 0)), .9, 1, 'destination-out');
    tileFill(lx, tile(r() * 1e9 | 0, 128, '#000000', v => (v > .8 ? 1 : 0)), 3.2, .5, 'destination-out');
    haze(ctx, lc, 3, night ? .35 : .22);
    put(ctx, lc, night ? .92 : .85);

    // The wooden ledge with chalk and an eraser.
    const ly = 1022;
    soft(ctx, 10, x => { x.fillStyle = '#000000'; x.fillRect(0, ly - 18, W, 24); }, night ? .6 : .2);
    const wood = night ? mixHex(P.brown, P.background, .2) : mixHex(P.orange, P.background, .55);
    ctx.fillStyle = linear(ctx, 0, ly, 0, H, [[0, mixHex(wood, '#ffffff', night ? .12 : .3)], [.25, wood], [1, mixHex(wood, '#000000', night ? .45 : .2)]]);
    ctx.fillRect(0, ly, W, H - ly);
    ctx.strokeStyle = rgba(night ? '#000000' : P.brown, .25); ctx.lineWidth = 1;
    for (let k = 0; k < 18; k++) { const y = ly + 8 + r() * 52; ctx.beginPath(); ctx.moveTo(0, y); for (let x = 0; x <= W; x += 60) ctx.lineTo(x, y + Math.sin(x / 140 + k) * 2); ctx.stroke(); }
    // Chalk sticks on the ledge.
    [[380, white, 0], [430, yellow, .1], [470, pink, -.05], [1530, white, .08]].forEach(([cx, col, a]) => {
      ctx.save(); ctx.translate(cx, ly + 4); ctx.rotate(a);
      soft(ctx, 3, x => { x.fillStyle = '#000000'; x.fillRect(-36, 2, 76, 10); }, .4, 'source-over', [cx - 60, ly - 20, cx + 60, ly + 30]);
      ctx.fillStyle = linear(ctx, 0, -8, 0, 8, [[0, mixHex(col, '#ffffff', .3)], [1, mixHex(col, '#000000', .2)]]);
      ctx.beginPath(); ctx.roundRect(-36, -8, 72, 16, 7); ctx.fill();
      ctx.restore();
    });
    // The felt eraser.
    ctx.save(); ctx.translate(1700, ly - 6); ctx.rotate(-.03);
    soft(ctx, 6, x => { x.fillStyle = '#000000'; x.fillRect(-110, 0, 230, 20); }, .5, 'source-over', [1560, ly - 40, 1860, ly + 40]);
    ctx.fillStyle = mixHex(P.brown, P.orange, night ? .2 : .5); ctx.beginPath(); ctx.roundRect(-110, -40, 220, 30, 6); ctx.fill();
    ctx.fillStyle = mixHex(white, board, night ? .45 : .3); ctx.fillRect(-108, -12, 216, 18);
    tileFill(ctx, tile(r() * 1e9 | 0, 128, night ? '#000000' : '#ffffff', v => v * .5), 1, .6, 'source-over', [-108, -12, 216, 18]);
    ctx.restore();
    // Dust on the ledge.
    soft(ctx, 4, x => { x.fillStyle = white; for (let k = 0; k < 40; k++) { x.globalAlpha = r() * .25; x.beginPath(); ellipse(x, rr(r, 200, 1900), ly + rr(r, 3, 12), rr(r, 10, 60), 3); x.fill(); } }, night ? .8 : .6, 'source-over', [0, ly - 20, W, H]);

    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paint/oil-paint ----------

  // Thick paint as a height field: palette knife strokes add height and color,
  // then a light from the upper left shades the relief. The field has 1 cell
  // per output pixel up to 1 cell per logical unit.
  function impasto(ctx, P, r, strokes, o) {
    const k = Math.min(S, 1), gw = Math.round(W * k), gh = Math.round(H * k), cs = W / gw;
    const N = gw * gh, Hf = new Float32Array(N), Cr = new Float32Array(N), Cg = new Float32Array(N), Cb = new Float32Array(N);
    const [gr, gg, gb] = rgb(o.ground);
    for (let j = 0, i = 0; j < gh; j++) {
      for (let x = 0; x < gw; x++, i++) {
        const lx = (x + .5) * cs, ly = (j + .5) * cs;
        Hf[i] = .35 * Math.sin(lx * 2.1) * Math.sin(ly * 2.1);
        Cr[i] = gr; Cg[i] = gg; Cb[i] = gb;
      }
    }
    const n1 = makeNoise(r() * 1e9 | 0), n2 = makeNoise(r() * 1e9 | 0);
    // A gentle swell of the paint surface, shared by all strokes.
    const und = new Float32Array(N);
    for (let j = 0, i = 0; j < gh; j++) for (let x = 0; x < gw; x++, i++) und[i] = n1((x + .5) * cs / 90, (j + .5) * cs / 90);
    // Noise along 1 axis of a stroke, as a table with linear lookup.
    const TN = 512, table = (fn, a, b) => { const t = new Float32Array(TN + 1); for (let k = 0; k <= TN; k++) t[k] = fn(a + (b - a) * k / TN); return v => { const f = clamp((v - a) / (b - a), 0, 1) * TN, k = Math.min(TN - 1, f | 0); return t[k] + (t[k + 1] - t[k]) * (f - k); }; };
    for (const st of strokes) {
      const { cx, cy, ang, L, w, bend, A, B, h0 } = st, c = Math.cos(ang), s = Math.sin(ang), ph = r() * 100;
      const [ar, ag, ab] = rgb(A), [br, bg, bb] = rgb(B);
      const hx = Math.abs(c) * L / 2 + Math.abs(s) * (w / 2 + Math.abs(bend) * L / 4) + 4;
      const hy = Math.abs(s) * L / 2 + Math.abs(c) * (w / 2 + Math.abs(bend) * L / 4) + 4;
      const i0 = Math.max(0, Math.floor((cx - hx) / cs)), i1 = Math.min(gw - 1, Math.ceil((cx + hx) / cs));
      const j0 = Math.max(0, Math.floor((cy - hy) / cs)), j1 = Math.min(gh - 1, Math.ceil((cy + hy) / cs));
      const endS = .92;
      const width = table(sn => { let we = 1 + .07 * n1(sn * 2.5 + ph, 0); if (sn > .5) { const q = (sn - .5) / .5; we *= 1 - q * q * (.45 + .4 * n1(sn * 7 + ph, 3.3)); } return we; }, -1, 1.02);
      const cutT = table(tn => endS + .08 * n1(tn * 3 + ph, 7.7), -1.15, 1.15);
      const startT = table(tn => -1 + .07 * tn * tn + .02 * n1(tn * 4 + ph, 2.2), -1.15, 1.15);
      for (let j = j0; j <= j1; j++) {
        const y = (j + .5) * cs - cy;
        for (let i = i0; i <= i1; i++) {
          const x = (i + .5) * cs - cx;
          const u = x * c + y * s, sn = u / (L / 2);
          if (sn < -1 || sn > 1.02) continue;
          const v = -x * s + y * c - bend * u * u / L, tn = v / (w / 2);
          if (tn > 1.15 || tn < -1.15) continue;
          const e = Math.abs(tn) / width(sn);
          if (e >= 1) continue;
          const cut = cutT(tn), start = startT(tn);
          if (sn > cut || sn < start) continue;
          const a = Math.min(1, (1 - e) / .05, (sn - start) / .008, (cut - sn) / .01);
          const idx = j * gw + i;
          // Height: a raised lip at the edges, a pile where the knife lifted, streaks along the stroke.
          let h = h0 * (1 - .4 * (sn + 1) / 2);
          h += h0 * .95 * Math.exp(-(((e - .85) / .07) ** 2));
          h += h0 * .9 * Math.exp(-(((sn - cut + .03) / .035) ** 2));
          h += h0 * (.16 * n2(tn * 4.5 + ph, sn * .7) + .05 * n2(tn * 18 + ph, sn * 1.6));
          h += h0 * .3 * und[idx];
          h *= 1 - smooth(clamp((e - .9) / .1, 0, 1)) * .8;
          const m = clamp(.5 + 1.3 * n2(tn * 2.6 + ph * 2, sn * .5 + 9), 0, 1);
          Hf[idx] = Hf[idx] * (1 - a) + (h + Hf[idx] * .08) * a;
          Cr[idx] = Cr[idx] * (1 - a) + (ar + (br - ar) * m) * a;
          Cg[idx] = Cg[idx] * (1 - a) + (ag + (bg - ag) * m) * a;
          Cb[idx] = Cb[idx] * (1 - a) + (ab + (bb - ab) * m) * a;
        }
      }
    }
    // Light the relief.
    const c = document.createElement('canvas'); c.width = gw; c.height = gh;
    const x = c.getContext('2d'), img = x.createImageData(gw, gh), d = img.data;
    let Lx = -.55, Ly = -.65, Lz = .75; const ll = Math.hypot(Lx, Ly, Lz); Lx /= ll; Ly /= ll; Lz /= ll;
    let Hx = Lx, Hy = Ly, Hz = Lz + 1; const hl = Math.hypot(Hx, Hy, Hz); Hx /= hl; Hy /= hl; Hz /= hl;
    const [sr, sg, sb] = rgb(o.spec);
    for (let j = 0, i = 0; j < gh; j++) {
      for (let q = 0; q < gw; q++, i++) {
        const xl = q > 0 ? i - 1 : i, xr = q < gw - 1 ? i + 1 : i, yu = j > 0 ? i - gw : i, yd = j < gh - 1 ? i + gw : i;
        let nx = -(Hf[xr] - Hf[xl]) / ((xr - xl) * cs || 1) * o.bump, ny = -(Hf[yd] - Hf[yu]) / ((yd - yu) / gw * cs || 1) * o.bump, nz = 1;
        const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
        const dif = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
        const spc = Math.max(0, nx * Hx + ny * Hy + nz * Hz) ** o.shine * o.gloss;
        const lit = o.amb + dif * o.dif;
        d[i * 4] = Cr[i] * lit + sr * spc; d[i * 4 + 1] = Cg[i] * lit + sg * spc; d[i * 4 + 2] = Cb[i] * lit + sb * spc; d[i * 4 + 3] = 255;
      }
    }
    x.putImageData(img, 0, 0);
    cover(ctx, c);
  }

  scene('paint', 'oil-paint', (ctx, P, r) => {
    const night = P.night;
    const tones = night
      ? [mixHex(P.darker_background, P.accent, .25), mixHex(P.background, P.accent, .4), mixHex(P.background, P.green, .55), P.accent, mixHex(P.accent, P.green, .5), P.green, mixHex(P.yellow, P.accent, .3), P.cyan]
      : [mixHex(P.background, P.accent, .12), mixHex(P.background, P.accent, .26), mixHex(P.background, P.green, .4), mixHex(P.background, P.accent, .55), mixHex(P.background, P.yellow, .35), mixHex(P.background, '#ffffff', .6), mixHex(P.accent, P.background, .25), P.accent];
    const pickTone = (lo, hi) => tones[clamp(Math.floor(rr(r, lo, hi)), 0, tones.length - 1)];
    const flow = -.32, strokes = [];
    const add = (cx, cy, L, w, ang, lo, hi, h0) => strokes.push({ cx, cy, L, w, ang, bend: rr(r, -.12, .12), A: pickTone(lo, hi), B: pickTone(lo, hi), h0 });
    // Wide slabs cover the canvas. Smaller strokes cross them, most of them near the edges.
    for (let k = 0; k < 16; k++) add(rr(r, -200, W + 200), (k + .5) / 16 * (H + 360) - 180 + rr(r, -40, 40), rr(r, 1200, 1700), rr(r, 280, 380), flow + rr(r, -.16, .16), 0, 3.4, 5);
    for (let k = 0; k < 14; k++) add(rr(r, 0, W), rr(r, 0, H), rr(r, 420, 700), rr(r, 150, 220), flow + rr(r, -.45, .35), 1, 5.6, 6);
    for (let k = 0; k < 16; k++) {
      const side = r() < .7, cx = side ? (r() < .5 ? rr(r, 0, 460) : rr(r, 1460, W)) : rr(r, 0, W), cy = side ? rr(r, 0, H) : (r() < .5 ? rr(r, 0, 240) : rr(r, 840, H));
      add(cx, cy, rr(r, 280, 480), rr(r, 48, 80), flow + rr(r, -.35, .3), 2, 6, 7);
    }
    impasto(ctx, P, r, strokes, night
      ? { ground: P.darker_background, spec: mixHex(P.bright_foreground, P.cyan, .3), amb: .42, dif: .75, gloss: .75, shine: 38, bump: 1.1 }
      : { ground: P.background, spec: '#ffffff', amb: .7, dif: .4, gloss: .38, shine: 44, bump: 1 });
    // A warm light from the upper left.
    soft(ctx, 220, x => { x.fillStyle = rgba(night ? P.yellow : '#ffffff', night ? .1 : .22); x.beginPath(); circle(x, 260, 120, 760); x.fill(); }, 1, 'screen');
    vignette(ctx, P, night ? .55 : .14);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paint/marbling ----------

  // Paper marbling as vector math: drops of paint push the older paint aside,
  // then combs and swirls move every point. Each drop stays 1 closed outline.
  function marble(r) {
    const drops = [], maxSeg = 4.5, far = (x, y) => x < -260 || x > W + 260 || y < -260 || y > H + 260;
    const refine = () => {
      for (const d of drops) {
        const pts = d.pts, out = [];
        for (let i = 0; i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          out.push(a);
          const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          if (len > maxSeg && !(far(a[0], a[1]) && far(b[0], b[1]))) {
            const k = Math.ceil(len / maxSeg);
            for (let j = 1; j < k; j++) out.push([a[0] + (b[0] - a[0]) * j / k, a[1] + (b[1] - a[1]) * j / k]);
          }
        }
        d.pts = out;
      }
    };
    const each = fn => { for (const d of drops) for (const p of d.pts) fn(p); };
    return {
      drops,
      drop(cx, cy, rad, color) {
        const r2 = rad * rad;
        each(p => { const dx = p[0] - cx, dy = p[1] - cy, k = Math.sqrt(1 + r2 / (dx * dx + dy * dy || 1e-6)); p[0] = cx + dx * k; p[1] = cy + dy * k; });
        const n = Math.max(20, Math.ceil(TAU * rad / maxSeg)), pts = [];
        for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
        drops.push({ pts, color });
      },
      // A comb with tines every gap units across direction ang, pulled shift units along ang.
      comb(ang, gap, shift, sharp, offset = 0) {
        refine();
        const mx = Math.cos(ang), my = Math.sin(ang), nx = -my, ny = mx;
        each(p => {
          const dd = p[0] * nx + p[1] * ny + offset, m = ((dd % gap) + gap) % gap, d = Math.min(m, gap - m);
          const z = shift * sharp / (d + sharp);
          p[0] += mx * z; p[1] += my * z;
        });
      },
      wave(ang, amp, len, phase) {
        refine();
        const mx = Math.cos(ang), my = Math.sin(ang), nx = -my, ny = mx;
        each(p => { const z = amp * Math.sin((p[0] * nx + p[1] * ny) / len * TAU + phase); p[0] += mx * z; p[1] += my * z; });
      },
      swirl(cx, cy, turn, reach) {
        refine();
        each(p => {
          const dx = p[0] - cx, dy = p[1] - cy, d = Math.hypot(dx, dy), a = turn * Math.exp(-((d / reach) ** 2));
          const c = Math.cos(a), s = Math.sin(a);
          p[0] = cx + dx * c - dy * s; p[1] = cy + dx * s + dy * c;
        });
      },
      refine,
    };
  }

  scene('paint', 'marbling', (ctx, P, r) => {
    const night = P.night;
    const tones = night
      ? [mixHex(P.darker_background, P.accent, .18), mixHex(P.background, P.accent, .32), mixHex(P.background, P.red, .6), P.accent, P.green, P.yellow, P.cyan, mixHex(P.bright_foreground, P.cyan, .3)]
      : [mixHex(P.background, '#ffffff', .6), mixHex(P.background, P.accent, .1), mixHex(P.background, P.accent, .25), mixHex(P.background, P.green, .45), mixHex(P.background, P.red, .6), P.accent, P.green, mixHex(P.green, P.foreground, .3)];
    const bath = tones[2];
    // Most paint comes from the middle of the ramp, the extremes are rare.
    const toneAt = v => tones[clamp(Math.round((night ? 3.2 : 2.6) + (v - .5) * 5.4 * Math.abs(v - .5) * 2.2), 1, tones.length - 1)];
    const m = marble(r);
    // Stone pattern: large drops with rings inside.
    for (let k = 0; k < 230; k++) {
      const cx = rr(r, -120, W + 120), cy = rr(r, -120, H + 120), rad = rr(r, 40, 100);
      const rings = 1 + Math.floor(r() * 3);
      for (let j = 0; j < rings; j++) m.drop(cx, cy, rad * (1 - j * .32), toneAt(r()));
    }
    // Fine spots of the palest and darkest paint.
    for (let k = 0; k < 90; k++) m.drop(rr(r, -60, W + 60), rr(r, -60, H + 60), rr(r, 5, 14), tones[r() < .5 ? tones.length - 1 : 1]);
    // Combs back and forth, a long wave, then swirls near the corners.
    m.comb(Math.PI / 2, 80, 80, 18);
    m.comb(-Math.PI / 2, 80, 80, 18, 40);
    m.comb(0, 22, 20, 5);
    m.wave(Math.PI / 2, 34, 760, r() * 6);
    m.swirl(300, 820, 3.4, 260);
    m.swirl(1640, 260, -3, 280);
    m.swirl(1200, 900, 2.2, 170);
    m.refine();

    ctx.fillStyle = bath; ctx.fillRect(0, 0, W, H);
    for (const d of m.drops) {
      ctx.beginPath(); poly(ctx, d.pts);
      ctx.fillStyle = d.color; ctx.fill();
    }
    // Thin veins where the colors meet.
    ctx.save();
    ctx.lineWidth = .8; ctx.strokeStyle = rgba(night ? P.bright_foreground : P.foreground, night ? .12 : .1);
    for (const d of m.drops) { ctx.beginPath(); poly(ctx, d.pts); ctx.stroke(); }
    ctx.restore();

    // The paper: a sheen across the size, fibers and tooth.
    soft(ctx, 160, x => {
      x.fillStyle = rgba('#ffffff', night ? .06 : .18);
      x.beginPath(); x.moveTo(300, -100); x.lineTo(900, -100); x.lineTo(500, H + 100); x.lineTo(-100, H + 100); x.closePath(); x.fill();
    }, 1, 'screen');
    fibers(ctx, r, 2000, night ? P.foreground : '#ffffff', night ? .05 : .3, .6, 12);
    fibers(ctx, r, 1200, '#000000', night ? .12 : .04, .6, 10);
    tooth(ctx, r() * 1e9 | 0, '#000000', '#ffffff', night ? .14 : .08);
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paint/gouache ----------

  scene('paint', 'gouache', (ctx, P, r) => {
    const night = P.night, bg = P.background;
    const n = makeNoise(r() * 1e9 | 0);
    const tint = (c, t) => mixHex(c, bg, t);
    const C = night ? {
      skyTop: mixHex(P.darker_background, P.blue, .32), skyLow: mixHex(P.background, P.magenta, .38), orb: mixHex(P.yellow, P.bright_foreground, .45), halo: mixHex(P.blue, P.background, .45),
      cloud: mixHex(P.blue, P.background, .62), cloudEdge: mixHex(P.blue, P.foreground, .25), far: mixHex(P.blue, P.background, .58), far2: mixHex(P.magenta, P.background, .62),
      hills: [mixHex(P.cyan, P.background, .58), mixHex(P.yellow, P.background, .55), mixHex(P.green, P.background, .55), mixHex(P.green, P.darker_background, .62)],
      field: mixHex(P.yellow, P.background, .42), path: mixHex(P.yellow, P.background, .35), tree: mixHex(P.green, P.darker_background, .55), cypress: mixHex(P.cyan, P.darker_background, .7),
      wall: mixHex(P.foreground, P.background, .45), roof: mixHex(P.red, P.background, .4), window: P.yellow, flower: [P.red, P.yellow, P.magenta], trunk: mixHex(P.brown, P.background, .3),
    } : {
      skyTop: tint(P.blue, .55), skyLow: tint(P.cyan, .78), orb: tint(P.orange, .35), halo: tint(P.yellow, .82),
      cloud: mixHex(bg, '#ffffff', .7), cloudEdge: tint(P.blue, .7), far: tint(P.blue, .62), far2: tint(P.magenta, .65),
      hills: [tint(P.cyan, .55), tint(P.green, .5), tint(P.yellow, .5), tint(P.green, .25)],
      field: tint(P.yellow, .3), path: tint(P.orange, .62), tree: tint(P.green, .1), cypress: mixHex(P.green, P.foreground, .25),
      wall: mixHex(bg, '#ffffff', .7), roof: tint(P.red, .15), window: tint(P.blue, .35), flower: [P.red, tint(P.orange, .1), P.magenta], trunk: tint(P.brown, .2),
    };
    // A shape with a hand-painted edge, flat paint and faint brush marks.
    const paint = (pts, color, ang = 0, marks = 40, closed = true) => {
      const wob = pts.map(([x, y], i) => [x + n(i * .21, 3.3) * 1.6, y + n(i * .21, 7.7) * 1.6]);
      ctx.save();
      ctx.beginPath(); closed ? poly(ctx, wob) : curve(ctx, wob); ctx.fillStyle = color; ctx.fill();
      ctx.clip();
      const [x0, y0, x1, y1] = bboxOf(pts), c = Math.cos(ang), s = Math.sin(ang);
      ctx.lineCap = 'round';
      for (let k = 0; k < marks; k++) {
        const x = rr(r, x0, x1), y = rr(r, y0, y1), len = rr(r, 60, 240);
        ctx.strokeStyle = rgba(r() < .5 ? '#ffffff' : '#000000', rr(r, .025, night ? .07 : .05)); ctx.lineWidth = rr(r, 5, 16);
        ctx.beginPath(); ctx.moveTo(x - c * len / 2, y - s * len / 2); ctx.quadraticCurveTo(x, y + rr(r, -5, 5), x + c * len / 2, y + s * len / 2); ctx.stroke();
      }
      ctx.restore();
    };
    const band = (fn, bottom, step = 8) => { const pts = []; for (let x = -20; x <= W + 20; x += step) pts.push([x, fn(x)]); pts.push([W + 20, bottom], [-20, bottom]); return pts; };

    // The board shows at the edges of the painting.
    ctx.fillStyle = night ? P.darker_background : mixHex(bg, P.muted, .2); ctx.fillRect(0, 0, W, H);
    // Sky in horizontal strokes.
    ctx.save();
    ctx.beginPath(); ctx.rect(14, 14, W - 28, H - 28); ctx.clip();
    ctx.fillStyle = linear(ctx, 0, 0, 0, 640, [[0, C.skyTop], [1, C.skyLow]]); ctx.fillRect(0, 0, W, 700);
    for (let k = 0; k < 140; k++) {
      const y = rr(r, 0, 640), len = rr(r, 120, 420), x = rr(r, -100, W);
      ctx.strokeStyle = rgba(r() < .5 ? '#ffffff' : '#000000', rr(r, .02, .05)); ctx.lineWidth = rr(r, 8, 22); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len / 2, y + rr(r, -6, 6), x + len, y + rr(r, -4, 4)); ctx.stroke();
    }
    if (night) stars(ctx, r, 90, [40, 30, W - 40, 420], [C.orb, P.foreground], 1.8);
    // The sun or moon with flat rings around it.
    const ox = 1490, oy = 230;
    [[190, .35], [150, .5]].forEach(([rad, a]) => { ctx.fillStyle = rgba(C.halo, a); ctx.beginPath(); circle(ctx, ox, oy, rad); ctx.fill(); });
    paint(Array.from({ length: 60 }, (_, i) => [ox + Math.cos(i / 60 * TAU) * 104, oy + Math.sin(i / 60 * TAU) * 104]), C.orb, .3, 14);
    // Clouds with round tops and flat bottoms.
    [[380, 200, 1], [900, 140, .8], [1130, 330, .7]].forEach(([cx, cy, s]) => {
      const pts = [];
      const bumps = [[-150, 0, 60], [-80, -36, 72], [10, -50, 84], [100, -24, 64], [160, 0, 46]];
      for (let a = 0; a <= 1; a += .02) {
        const x = lerp(-200, 205, a);
        let y = 0;
        for (const [bx, by, br] of bumps) { const dx = x - bx; if (Math.abs(dx) < br) y = Math.min(y, by - Math.sqrt(br * br - dx * dx) + 40); }
        pts.push([cx + x * s, cy + y * s]);
      }
      pts.push([cx + 205 * s, cy + 40 * s], [cx - 200 * s, cy + 40 * s]);
      paint(pts, C.cloud, 0, 12);
      ctx.fillStyle = rgba(C.cloudEdge, .5); ctx.fillRect(cx - 190 * s, cy + 34 * s, 380 * s, 6 * s);
    });
    // Far mountains.
    paint(band(x => 560 - Math.max(0, Math.sin(x / 210 + 1.3)) * 90 - (fbm(n, x / 300, 1, 3) * .5 + .5) * 70, 700), C.far2, -.2, 30);
    paint(band(x => 610 - Math.max(0, Math.sin(x / 160 + .2)) * 60 - (fbm(n, x / 220, 4, 3) * .5 + .5) * 50, 720), C.far, .2, 30);
    // Rolling hills, near to far.
    const hill = (base, amp, len, ph) => x => base + Math.sin(x / len + ph) * amp + fbm(n, x / 400, base, 3) * 24;
    const h1 = hill(660, 26, 260, 1), h2 = hill(720, 46, 330, 3.2), h3 = hill(810, 50, 300, 5.1), h4 = hill(930, 60, 380, .4);
    paint(band(h1, 900), C.hills[0], .1, 40);
    // The ochre field with rows that follow the hill.
    paint(band(h2, 940), C.field, -.05, 50);
    ctx.save(); ctx.beginPath(); poly(ctx, band(h2, 940)); ctx.clip();
    ctx.strokeStyle = rgba(night ? '#000000' : P.orange, night ? .25 : .25); ctx.lineWidth = 5; ctx.lineCap = 'round';
    for (let k = 1; k < 9; k++) { ctx.beginPath(); for (let x = -20; x <= W + 20; x += 10) { const y = h2(x) + k * 16 + Math.sin(x / 90) * 3; x === -20 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.stroke(); }
    ctx.restore();
    paint(band(h3, 1000), C.hills[2], .15, 50);
    // A winding path.
    const path = spline([[1060, 760], [1000, 830], [1120, 900], [1010, 990], [1080, 1100]], 6);
    ctx.beginPath(); taper(ctx, path, t => 8 + t * 70); ctx.fillStyle = C.path; ctx.fill();
    // A small farmhouse.
    const hx = 1270, hy = h2(1270) + 14;
    ctx.fillStyle = C.wall; ctx.fillRect(hx - 54, hy - 52, 108, 56);
    ctx.fillStyle = C.roof; ctx.beginPath(); ctx.moveTo(hx - 66, hy - 50); ctx.lineTo(hx, hy - 96); ctx.lineTo(hx + 66, hy - 50); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.window; ctx.fillRect(hx - 32, hy - 36, 16, 18); ctx.fillRect(hx + 16, hy - 36, 16, 18);
    ctx.fillStyle = C.trunk; ctx.fillRect(hx - 8, hy - 30, 16, 34);
    if (night) soft(ctx, 14, x => { x.fillStyle = rgba(P.yellow, .5); x.fillRect(hx - 40, hy - 44, 80, 34); }, 1, 'screen', [hx - 120, hy - 140, hx + 120, hy + 60]);
    // Cypresses on the left and round trees on the right.
    const cypress = (x, y, h, w) => {
      const pts = [];
      for (let a = 0; a <= 1; a += .05) pts.push([x - w * Math.sin(a * Math.PI) ** .7 * (1 - a * .3), y - a * h]);
      for (let a = 1; a >= 0; a -= .05) pts.push([x + w * Math.sin(a * Math.PI) ** .7 * (1 - a * .3), y - a * h]);
      paint(pts, C.cypress, Math.PI / 2, 8);
    };
    [[220, 230, 34], [290, 300, 40], [356, 210, 30], [600, 190, 28]].forEach(([x, h, w]) => cypress(x, h3(x) + 30, h, w));
    const roundTree = (x, y, rad) => {
      ctx.fillStyle = C.trunk; ctx.fillRect(x - 5, y - rad * .4, 10, rad * 1.2);
      paint(Array.from({ length: 40 }, (_, i) => [x + Math.cos(i / 40 * TAU) * rad, y - rad * .9 + Math.sin(i / 40 * TAU) * rad * .85]), C.tree, -.4, 10);
    };
    [[1520, 64], [1640, 52], [1745, 70]].forEach(([x, rad]) => roundTree(x, h3(x) + 20, rad));
    // The foreground hill with flowers.
    paint(band(h4, 1100), C.hills[3], .05, 60);
    for (let k = 0; k < 160; k++) {
      const x = rr(r, 0, W), y = h4(x) + rr(r, 16, 150);
      if (x > 900 && x < 1250 && y < 1000) continue;
      ctx.fillStyle = pick(r, C.flower);
      ctx.beginPath(); ellipse(ctx, x, y, rr(r, 3, 7), rr(r, 2.5, 5)); ctx.fill();
    }
    // Tall grass in the lower corners.
    ctx.strokeStyle = night ? mixHex(P.green, P.background, .35) : tint(P.green, .05); ctx.lineCap = 'round';
    for (let k = 0; k < 90; k++) {
      const left = k < 50, x = left ? rr(r, -10, 380) : rr(r, 1560, W + 10), y = H + 10, ht = rr(r, 60, 200) * (left ? 1 - (x / 400) * .6 : .4 + (x - 1560) / 360 * .6);
      ctx.lineWidth = rr(r, 3, 7);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + rr(r, -10, 10), y - ht * .6, x + rr(r, -40, 40), y - ht); ctx.stroke();
    }
    ctx.restore();
    // Matte paint on board: a dry tooth over everything.
    tooth(ctx, r() * 1e9 | 0, '#000000', '#ffffff', night ? .35 : .28, 1);
    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, r() * 1e9 | 0, night ? .04 : .035);
  });
  // ---------- paint/fresco ----------

  // A crack: a random walk that keeps its heading, with short branches.
  function crackPath(r, x, y, a, len, step = 7) {
    const pts = [[x, y]];
    for (let d = 0; d < len; d += step) {
      a += rr(r, -.45, .45);
      const p = pts[pts.length - 1];
      pts.push([p[0] + Math.cos(a) * step, p[1] + Math.sin(a) * step]);
    }
    return pts;
  }

  scene('paint', 'fresco', (ctx, P, r) => {
    const night = P.night;
    const plaster = night ? mixHex(P.lighter_background, P.muted, .42) : mixHex(P.background, '#ffffff', .35);
    const rough = night ? mixHex(plaster, P.muted, .3) : mixHex(P.background, P.muted, .42);
    const fade = (c, t = .35) => mixHex(c, plaster, t);
    // Lime plaster.
    ctx.fillStyle = plaster; ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.muted, night ? .3 : .16, 200);
    mottle(ctx, r() * 1e9 | 0, '#ffffff', night ? .06 : .35, 90, -.05);

    // The painting goes on 1 layer, so it can wear away.
    const [lc, lx] = layer();
    const n = makeNoise(r() * 1e9 | 0);
    // Border bands at the top and the bottom.
    lx.fillStyle = fade(P.red, .2); lx.fillRect(0, 26, W, 64); lx.fillRect(0, 1000, W, 80);
    lx.fillStyle = fade(P.yellow, .25); lx.fillRect(0, 90, W, 8); lx.fillRect(0, 992, W, 8);
    lx.strokeStyle = fade(P.yellow, .2); lx.lineWidth = 6; lx.lineJoin = 'miter';
    lx.beginPath();
    for (let x = -20; x < W; x += 80) { lx.moveTo(x, 76); lx.lineTo(x, 40); lx.lineTo(x + 50, 40); lx.lineTo(x + 50, 64); lx.lineTo(x + 24, 64); lx.lineTo(x + 24, 52); lx.moveTo(x + 50, 76); lx.lineTo(x + 80, 76); }
    lx.stroke();
    // An azurite sky with gilded stars.
    lx.fillStyle = linear(lx, 0, 98, 0, 640, [[0, fade(P.blue, .1)], [1, fade(P.blue, .45)]]); lx.fillRect(0, 98, W, 560);
    lx.fillStyle = fade(P.yellow, .1);
    for (let k = 0; k < 46; k++) {
      const sx = rr(r, 30, W - 30), sy = rr(r, 130, 470), s = rr(r, 7, 12);
      lx.beginPath();
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU, rad = i % 2 ? s * .38 : s; lx.lineTo(sx + Math.cos(a) * rad, sy + Math.sin(a) * rad); }
      lx.closePath(); lx.fill();
    }
    // Hills in green earth, with terraces, and the ochre ground.
    const hillPts = (fn, bottom) => { const pts = []; for (let x = -20; x <= W + 20; x += 10) pts.push([x, fn(x)]); pts.push([W + 20, bottom], [-20, bottom]); return pts; };
    const h1 = x => 560 - Math.max(0, 1 - Math.abs(x - 380) / 520) ** 1.2 * 260 - Math.max(0, 1 - Math.abs(x - 1700) / 380) * 120 + n(x / 90, 1) * 10;
    lx.beginPath(); poly(lx, hillPts(h1, 1000)); lx.fillStyle = fade(P.green, .25); lx.fill();
    lx.strokeStyle = fade(mixHex(P.green, P.foreground, night ? 0 : .3), .2); lx.lineWidth = 3;
    for (let k = 1; k < 6; k++) { lx.beginPath(); for (let x = 0; x < 900; x += 12) { const y = h1(x) + k * 40 + Math.sin(x / 50 + k) * 6; x ? lx.lineTo(x, y) : lx.moveTo(x, y); } lx.stroke(); }
    lx.beginPath(); poly(lx, hillPts(x => 760 + Math.sin(x / 300) * 30, 1000)); lx.fillStyle = fade(P.yellow, .3); lx.fill();
    // A tree and a small tower on the hill.
    lx.fillStyle = fade(P.brown, .2); lx.fillRect(296, 360, 14, 120);
    lx.beginPath(); ellipse(lx, 303, 340, 70, 56); lx.fillStyle = fade(mixHex(P.green, P.foreground, night ? .1 : .35), .15); lx.fill();
    lx.fillStyle = fade(P.foreground, night ? .5 : .75); lx.fillRect(560, 330, 60, 130); lx.fillRect(552, 320, 76, 14);
    lx.fillStyle = fade(P.red, .2); lx.beginPath(); lx.moveTo(548, 322); lx.lineTo(590, 270); lx.lineTo(632, 322); lx.closePath(); lx.fill();
    lx.fillStyle = fade(P.brown, .1); lx.fillRect(578, 380, 22, 34);
    // 3 robed figures with halos.
    const figure = (x, base, h, robe, mantle, sd) => {
      const sh = base - h * .78, hw = h * .1, hem = h * .17, hy = base - h * .865;
      // The halo.
      lx.beginPath(); circle(lx, x, hy, h * .1); lx.fillStyle = fade(P.yellow, .05); lx.fill();
      lx.strokeStyle = fade(P.orange, .1); lx.lineWidth = 3; lx.stroke();
      lx.beginPath(); circle(lx, x, hy, h * .086); lx.lineWidth = 1.5; lx.stroke();
      // The robe, long and narrow.
      lx.beginPath(); lx.moveTo(x - hw, sh); lx.quadraticCurveTo(x - hw * 1.15, base - h * .4, x - hem, base); lx.lineTo(x + hem, base); lx.quadraticCurveTo(x + hw * 1.15, base - h * .4, x + hw, sh); lx.quadraticCurveTo(x, sh - h * .03, x - hw, sh);
      lx.fillStyle = fade(robe, .15); lx.fill();
      // The mantle over the shoulders, with a hem that falls to 1 side.
      const ya = base - h * (sd > 0 ? .32 : .5), yb = base - h * (sd > 0 ? .5 : .32);
      lx.beginPath(); lx.moveTo(x - hw * 1.15, sh + 4); lx.quadraticCurveTo(x - hw * 1.3, (sh + ya) / 2, x - hw * 1.22, ya);
      lx.quadraticCurveTo(x, (ya + yb) / 2 + h * .06, x + hw * 1.22, yb); lx.quadraticCurveTo(x + hw * 1.3, (sh + yb) / 2, x + hw * 1.15, sh + 4); lx.quadraticCurveTo(x, sh - h * .035, x - hw * 1.15, sh + 4);
      lx.fillStyle = fade(mantle, .12); lx.fill();
      // Folds.
      lx.strokeStyle = rgba(night ? '#000000' : P.foreground, .22); lx.lineWidth = 2.5; lx.lineCap = 'round';
      for (let k = 0; k < 5; k++) { const fx = x + (k - 2) * hem * .3; lx.beginPath(); lx.moveTo(x + (k - 2) * hw * .3, Math.max(ya, yb) - 10); lx.quadraticCurveTo(fx + rr(r, -5, 5), base - h * .2, fx * 1.04 - x * .04, base - 4); lx.stroke(); }
      for (let k = 0; k < 3; k++) { lx.beginPath(); lx.moveTo(x - hw * .9 + k * hw * .3, sh + 14); lx.quadraticCurveTo(x - hw * .4 + k * hw * .5, (sh + ya) / 2 + 20, x - hw * .2 + k * hw * .7, Math.min(ya, yb) + 10); lx.stroke(); }
      // Head and hands.
      const skin = night ? mixHex(P.orange, P.foreground, .55) : fade(P.orange, .5);
      lx.beginPath(); ellipse(lx, x, hy, h * .046, h * .06); lx.fillStyle = skin; lx.fill();
      lx.beginPath(); lx.arc(x, hy, h * .05, Math.PI * 1.15, Math.PI * 1.85); lx.quadraticCurveTo(x, hy - h * .045, x - h * .042, hy - h * .03); lx.closePath(); lx.fillStyle = fade(P.brown, night ? .1 : .25); lx.fill();
      lx.beginPath(); ellipse(lx, x + sd * hw * .5, base - h * .56, h * .022, h * .028); lx.fillStyle = skin; lx.fill();
    };
    figure(1190, 960, 560, P.red, P.blue, 1);
    figure(1400, 975, 600, P.blue, P.yellow, -1);
    figure(1610, 955, 540, P.green, P.red, -1);
    // A blue and red frame line around the scene.
    lx.strokeStyle = fade(P.red, .25); lx.lineWidth = 5; lx.strokeRect(-10, 104, W + 20, 880);

    // Wear: pigment rubbed thin, and losses down to the rough plaster.
    const wear = texture(640, 360, (x, y, o) => { const v = fbm(n, x / 70 + 9, y / 70, 4) + fbm(n, x / 300, y / 300 + 5, 3) * .4; o[0] = o[1] = o[2] = 0; const zone = smooth(clamp(fbm(n, x / 520 + 3, y / 520, 2) * 2.2 + .35, 0, 1)); o[3] = smooth(clamp((v - .1) / .3, 0, 1)) * .65 * zone * 255; });
    lx.save(); lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'destination-out'; lx.imageSmoothingQuality = 'high'; lx.drawImage(wear, 0, 0, lc.width, lc.height); lx.restore();
    tileFill(lx, tile(r() * 1e9 | 0, 256, '#000000', v => (v > .7 ? (v - .7) * 2.5 : 0)), 1.2, .9, 'destination-out');
    const lossN = makeNoise(r() * 1e9 | 0);
    const lossF = (x, y) => fbm(lossN, x / 230, y / 230, 5) * .7 + .8 * Math.exp(-(((x) / 520) ** 2 + ((y - H) / 380) ** 2)) + .55 * Math.exp(-(((x - W) / 300) ** 2 + ((y - 300) / 360) ** 2)) + .3 * Math.exp(-(((x - 900) / 140) ** 2 + ((y - 120) / 120) ** 2)) - .38;
    const cell = 5, gw = Math.ceil(W / cell) + 5, gh = Math.ceil(H / cell) + 5, gbox = [-2 * cell, -2 * cell, -2 * cell + (gw - 1) * cell, -2 * cell + (gh - 1) * cell];
    const lf = grid(gw, gh, lossF, gbox);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) if (i < 1 || j < 1 || i > gw - 2 || j > gh - 2) lf[j * gw + i] = Math.min(lf[j * gw + i], -1);
    const losses = contours(lf, gw, gh, 0, gbox);
    const lossPath = x => { x.beginPath(); losses.forEach(l => curve(x, l, true)); };
    lx.save(); lx.globalCompositeOperation = 'destination-out'; lossPath(lx); lx.fill('evenodd'); lx.restore();
    put(ctx, lc, night ? .9 : .92);

    // The rough plaster in the losses, with a shadow under the broken edge.
    ctx.save();
    lossPath(ctx); ctx.clip('evenodd');
    ctx.fillStyle = rough; ctx.fillRect(0, 0, W, H);
    tooth(ctx, r() * 1e9 | 0, '#000000', '#ffffff', night ? .55 : .9, 2.2);
    ctx.fillStyle = rgba(night ? '#000000' : P.dark_foreground, night ? .25 : .35);
    for (let k = 0; k < 900; k++) { ctx.beginPath(); circle(ctx, rr(r, 0, W), rr(r, 0, H), rr(r, .6, 2)); ctx.fill(); }
    soft(ctx, 4, x => { x.save(); x.beginPath(); x.rect(-50, -50, W + 100, H + 100); losses.forEach(l => { x.translate(5, 7); curve(x, l, true); x.translate(-5, -7); }); x.fillStyle = '#000000'; x.fill('evenodd'); x.restore(); }, night ? .45 : .35);
    ctx.restore();
    ctx.save(); ctx.translate(-1.2, -1.2); ctx.strokeStyle = rgba('#ffffff', night ? .12 : .6); ctx.lineWidth = 1.6; lossPath(ctx); ctx.stroke(); ctx.restore();
    ctx.strokeStyle = rgba(night ? '#000000' : P.dark_foreground, .35); ctx.lineWidth = 1; lossPath(ctx); ctx.stroke();

    // Cracks, with a light lip on 1 side.
    const cracks = [];
    for (let k = 0; k < 16; k++) {
      const main = crackPath(r, rr(r, 0, W), rr(r, 0, H), r() * TAU, rr(r, 200, 640), 8);
      cracks.push([main, rr(r, 1, 1.8)]);
      for (let b = 0; b < 3; b++) { const p = main[Math.floor(r() * main.length)]; cracks.push([crackPath(r, p[0], p[1], r() * TAU, rr(r, 40, 180), 6), rr(r, .6, 1)]); }
    }
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    cracks.forEach(([pts, w]) => {
      ctx.strokeStyle = rgba('#ffffff', night ? .1 : .5); ctx.lineWidth = w;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0] + 1.2, p[1] + 1.2) : ctx.moveTo(p[0] + 1.2, p[1] + 1.2))); ctx.stroke();
      ctx.strokeStyle = rgba(night ? '#000000' : P.foreground, night ? .6 : .45); ctx.lineWidth = w;
      ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    });
    // Seams between the days of work.
    ctx.strokeStyle = rgba(night ? '#000000' : P.muted, .25); ctx.lineWidth = 1.2;
    [[[0, 640], [400, 610], [760, 660], [1060, 600], [1100, 300], [1050, 98]], [[1060, 600], [1290, 650], [1500, 620], [1720, 690], [1920, 640]]].forEach(seam => { ctx.beginPath(); curve(ctx, spline(seam, 20).map(([x, y]) => [x + n(x / 40, y / 40) * 4, y + n(y / 40, x / 40) * 4])); ctx.stroke(); });
    // Salt bloom on the surface.
    soft(ctx, 30, x => { x.fillStyle = rgba('#ffffff', 1); for (let k = 0; k < 5; k++) { x.beginPath(); ellipse(x, rr(r, 0, W), rr(r, 0, H), rr(r, 60, 160), rr(r, 40, 100)); x.fill(); } }, night ? .04 : .12);
    tooth(ctx, r() * 1e9 | 0, '#000000', '#ffffff', night ? .35 : .4, 1.2);
    // Candle light at night, soft daylight by day.
    if (night) {
      soft(ctx, 200, x => { x.fillStyle = rgba(P.orange, .28); x.beginPath(); circle(x, 260, 1100, 760); x.fill(); }, 1, 'screen');
      ctx.fillStyle = linear(ctx, 0, 0, W, H * .4, [[0, rgba('#000000', 0)], [1, rgba('#000000', .35)]]); ctx.fillRect(0, 0, W, H);
    }
    vignette(ctx, P, night ? .55 : .15);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- paint/watercolor ----------

  // An outline with a wavering edge: a closed shape around cx, cy.
  function blob(r, cx, cy, rx, ry, amp = .12, n = 48) {
    const nz = makeNoise(r() * 1e9 | 0), pts = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU, k = 1 + fbm(nz, Math.cos(a) * 1.5, Math.sin(a) * 1.5, 3) * amp * 2;
      pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
    }
    return pts;
  }
  // A watercolor wash: thin paint that dries darker at its edge, with uneven
  // pigment, blooms and lifted areas. It glazes over what is below.
  function wash(ctx, P, r, pts, fill, edgeColor, o = {}) {
    const bb = bboxOf(pts, 40), [c, x] = boxLayer(bb);
    const shape = y => { y.beginPath(); curve(y, pts, true); };
    shape(x); x.fillStyle = fill; x.fill();
    soft(x, o.edgeBlur ?? 2.2, y => { shape(y); y.strokeStyle = edgeColor; y.lineWidth = o.edgeW ?? 7; y.stroke(); }, 1, 'source-over', bb);
    for (const [bx, by, br] of o.blooms || []) {
      const bl = blob(r, bx, by, br, br * rr(r, .7, 1), .3, 64), around = [bx - br * 2, by - br * 2, bx + br * 2, by + br * 2];
      soft(x, br * .25, y => { y.beginPath(); curve(y, bl, true); y.fillStyle = '#000000'; y.fill(); }, .6, 'destination-out', around);
      soft(x, 1, y => { y.beginPath(); curve(y, bl, true); y.strokeStyle = edgeColor; y.lineWidth = 3; y.stroke(); }, 1, 'source-over', around);
    }
    for (const [lx0, ly0, lr, la] of o.lifts || []) soft(x, lr * .35, y => { y.beginPath(); ellipse(y, lx0, ly0, lr, lr * .45); y.fillStyle = '#000000'; y.fill(); }, la ?? .8, 'destination-out', [lx0 - lr * 1.6, ly0 - lr * 1.2, lx0 + lr * 1.6, ly0 + lr * 1.2]);
    if (o.tex) { x.save(); x.globalCompositeOperation = 'destination-out'; x.globalAlpha = o.mottle ?? .35; x.drawImage(o.tex, 0, 0, W, H); x.restore(); }
    x.globalCompositeOperation = 'destination-in'; shape(x); x.fill();
    putBox(ctx, c, 1, P.night ? 'screen' : 'multiply');
  }

  scene('paint', 'watercolor', (ctx, P, r) => {
    const night = P.night;
    const paperC = night ? P.background : mixHex(P.background, '#ffffff', .5);
    ctx.fillStyle = paperC; ctx.fillRect(0, 0, W, H);
    // Cold pressed paper: soft bumps lit from the upper left.
    const nz = makeNoise(r() * 1e9 | 0), gw = 960, gh = 540, hgt = new Float32Array(gw * gh);
    for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) hgt[j * gw + i] = fbm(nz, i / 3.2, j / 3.2, 3);
    const relief = document.createElement('canvas'); relief.width = gw; relief.height = gh;
    const rx = relief.getContext('2d'), img = rx.createImageData(gw, gh);
    for (let j = 1; j < gh - 1; j++) for (let i = 1; i < gw - 1; i++) {
      const k = j * gw + i, v = clamp(128 + ((hgt[k - 1] - hgt[k + 1]) + (hgt[k - gw] - hgt[k + gw])) * 160, 0, 255);
      img.data[k * 4] = img.data[k * 4 + 1] = img.data[k * 4 + 2] = v; img.data[k * 4 + 3] = 255;
    }
    rx.putImageData(img, 0, 0);
    const pig = texture(480, 270, (x, y, o) => { const v = fbm(nz, x / 90 + 7, y / 90, 4); o[0] = o[1] = o[2] = 0; o[3] = clamp(.3 + v * 1.4, 0, 1) * 255; });

    const col = (c, a) => rgba(c, a);
    const k = night ? 1.25 : 1.3;
    // Faint pencil lines of the drawing under the paint.
    ctx.strokeStyle = rgba(P.foreground, night ? .1 : .14); ctx.lineWidth = 1; ctx.lineCap = 'round';
    [[[120, 588], [600, 560], [1100, 580], [1800, 570]], [[110, 700], [700, 712], [1500, 700], [1830, 706]], [[300, 470], [520, 420], [760, 500]], [[1200, 500], [1450, 440], [1700, 490]]].forEach(l => { ctx.beginPath(); curve(ctx, spline(l, 20).map(([x, y]) => [x + rr(r, -2, 2), y + rr(r, -3, 3)])); ctx.stroke(); });
    ctx.beginPath(); circle(ctx, 1430, 230, 74); ctx.stroke();

    // The sky: a graded wash with blooms and lifted clouds.
    const sky = [];
    for (let x = 80; x <= 1840; x += 40) sky.push([x + rr(r, -6, 6), 70 + rr(r, -14, 10)]);
    for (let x = 1840; x >= 80; x -= 40) sky.push([x, 660 + Math.sin(x / 140) * 16 + rr(r, -10, 10)]);
    wash(ctx, P, r, sky, linear(ctx, 0, 60, 0, 660, [[0, col(P.blue, .55 * k)], [.55, col(P.cyan, .25 * k)], [1, col(P.yellow, .14 * k)]]), col(P.blue, .32 * k),
      { blooms: [[620, 260, 90], [980, 170, 70]], lifts: [[420, 180, 110, .8], [800, 330, 150, .6], [1200, 140, 120, .7], [1430, 230, 80, 1]], tex: pig, mottle: .4 });
    // The sun, or a moon at night.
    wash(ctx, P, r, blob(r, 1430, 230, 70, 70, .05), col(night ? P.foreground : mixHex(P.yellow, P.orange, .5), night ? .7 : .3), col(night ? P.foreground : P.orange, night ? .5 : .35), { tex: pig, mottle: .2 });
    if (night) soft(ctx, 90, x => { x.fillStyle = rgba(P.yellow, .2); x.beginPath(); circle(x, 1430, 230, 200); x.fill(); }, 1, 'screen');
    // Far hills and near hills overlap, so the glazes darken where they meet.
    const ridge = (base, amp, len, ph, bottom) => { const pts = []; for (let x = 70; x <= 1850; x += 22) pts.push([x, base - (Math.sin(x / len + ph) * .5 + .5) * amp - fbm(nz, x / 160, base, 3) * amp * .5]); for (let x = 1850; x >= 70; x -= 60) pts.push([x, bottom + rr(r, -8, 8)]); return pts; };
    wash(ctx, P, r, ridge(580, 150, 210, 1, 720), linear(ctx, 0, 420, 0, 720, [[0, col(mixHex(P.magenta, P.blue, .5), .42 * k)], [1, col(P.magenta, .1 * k)]]), col(P.magenta, .4 * k), { tex: pig, blooms: [[1500, 560, 60]] });
    wash(ctx, P, r, ridge(680, 120, 260, 4, 790), linear(ctx, 0, 560, 0, 790, [[0, col(P.green, .55 * k)], [.7, col(P.yellow, .3 * k)], [1, col(P.yellow, .05)]]), col(P.green, .5 * k), { tex: pig, blooms: [[400, 690, 70], [1150, 680, 50]] });
    const lake = [];
    for (let x = 90; x <= 1830; x += 40) lake.push([x, 744 + rr(r, -6, 6)]);
    for (let x = 1830; x >= 90; x -= 40) lake.push([x, 900 - (x < 800 ? (800 - x) * .1 : 0) + Math.sin(x / 200) * 20 + rr(r, -6, 6)]);
    wash(ctx, P, r, lake, linear(ctx, 0, 740, 0, 900, [[0, col(P.cyan, .5 * k)], [1, col(P.blue, .45 * k)]]), col(P.blue, .4 * k),
      { tex: pig, lifts: [[600, 775, 260, .7], [1300, 800, 200, .6], [1430, 785, 70, .9], [1430, 830, 50, .8]] });
    // Trees on the shore, painted wet into wet, with reflections.
    const tree = (x, y, w, h) => {
      const pts = [];
      for (let a = 0; a <= 1; a += .05) pts.push([x - w * Math.sin(Math.PI * Math.min(1, a * 1.1)) ** .8 * (1 - a * .5) + rr(r, -3, 3), y - a * h]);
      for (let a = 1; a >= 0; a -= .05) pts.push([x + w * Math.sin(Math.PI * Math.min(1, a * 1.1)) ** .8 * (1 - a * .5) + rr(r, -3, 3), y - a * h]);
      return pts;
    };
    [[250, 760, 40, 190], [312, 766, 34, 240], [372, 760, 30, 170], [430, 770, 24, 120], [1620, 770, 38, 200], [1690, 772, 30, 150], [1745, 776, 22, 110]].forEach(([tx, ty, tw, th]) => {
      wash(ctx, P, r, tree(tx, ty, tw, th), col(mixHex(P.green, P.blue, .45), .62 * k), col(mixHex(P.green, P.blue, .7), .6 * k), { tex: pig, mottle: .3, edgeW: 5 });
      wash(ctx, P, r, tree(tx, ty, tw * .9, -th * .55), col(mixHex(P.green, P.blue, .4), .2 * k), col(P.green, .18 * k), { tex: pig, edgeBlur: 4 });
    });
    // The near bank.
    const bank = [];
    for (let x = 70; x <= 1850; x += 40) bank.push([x, 880 - (x < 900 ? (900 - x) * .14 : 0) + Math.sin(x / 120) * 12 + rr(r, -8, 8)]);
    for (let x = 1850; x >= 70; x -= 40) bank.push([x, 1010 + rr(r, -14, 8)]);
    wash(ctx, P, r, bank, linear(ctx, 0, 760, 0, 1010, [[0, col(P.yellow, .5 * k)], [.5, col(P.orange, .32 * k)], [1, col(P.green, .45 * k)]]), col(P.orange, .45 * k),
      { tex: pig, blooms: [[700, 950, 80], [1500, 945, 60]] });
    // Reeds on the bank in a few quick strokes.
    ctx.save(); ctx.globalCompositeOperation = night ? 'screen' : 'multiply';
    ctx.strokeStyle = rgba(mixHex(P.green, P.blue, .5), night ? .5 : .55); ctx.lineCap = 'round';
    for (let i = 0; i < 26; i++) { const x = rr(r, 120, 560), y = 900 + rr(r, -30, 40), h = rr(r, 40, 110); ctx.lineWidth = rr(r, 1.5, 3); ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + rr(r, -6, 6), y - h * .6, x + rr(r, -20, 20), y - h); ctx.stroke(); }
    ctx.restore();
    // Splatters.
    for (let i = 0; i < 46; i++) {
      const sx = r() < .5 ? rr(r, 1500, 1880) : rr(r, 60, 500), sy = r() < .5 ? rr(r, 880, 1050) : rr(r, 40, 200), rad = rr(r, 1.5, 7) * (r() < .1 ? 2 : 1);
      ctx.fillStyle = rgba(pick(r, [P.blue, P.red, P.green, P.orange]), night ? .4 : .35);
      ctx.save(); ctx.globalCompositeOperation = night ? 'screen' : 'multiply';
      ctx.beginPath(); circle(ctx, sx, sy, rad); ctx.fill();
      ctx.strokeStyle = rgba(pick(r, [P.blue, P.green]), .3); ctx.lineWidth = .8; ctx.stroke();
      ctx.restore();
    }
    // The paper texture shows through every wash.
    cover(ctx, relief, night ? .35 : .4, 'overlay');
    tooth(ctx, r() * 1e9 | 0, night ? '#000000' : P.dark_foreground, '#ffffff', night ? .3 : .2);
    vignette(ctx, P, night ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, night ? .04 : .03);
  });
  // ---------- light/darkroom ----------

  // A small photograph in local units from 0, 0 to w, h. tone runs from dark to light.
  function snapshot(ctx, r, w, h, kind, tone) {
    const n = makeNoise(r() * 1e9 | 0);
    ctx.fillStyle = linear(ctx, 0, 0, 0, h, [[0, tone(.55)], [.6, tone(.85)], [1, tone(.7)]]); ctx.fillRect(0, 0, w, h);
    if (kind === 'tree') {
      ctx.fillStyle = tone(.35); ctx.beginPath(); ctx.moveTo(0, h * .8); ctx.quadraticCurveTo(w * .5, h * .62, w, h * .78); ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.fill();
      ctx.fillStyle = tone(.08); ctx.fillRect(w * .48, h * .42, w * .04, h * .3);
      for (let i = 0; i < 26; i++) { ctx.beginPath(); circle(ctx, w * .5 + rr(r, -.22, .22) * w, h * .38 + rr(r, -.14, .1) * h, rr(r, .05, .1) * w); ctx.fill(); }
    } else if (kind === 'peaks') {
      ctx.fillStyle = tone(.92); ctx.beginPath(); circle(ctx, w * .72, h * .28, h * .09); ctx.fill();
      [[.62, .5, .45], [.7, .3, .25]].forEach(([base, amp, t], k) => {
        ctx.fillStyle = tone(t); ctx.beginPath(); ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += 3) ctx.lineTo(x, h * base - (fbm(n, x / w * 3 + k * 7, k, 4) * .5 + .5) * h * amp * .6);
        ctx.lineTo(w, h); ctx.fill();
      });
      ctx.fillStyle = tone(.75); ctx.fillRect(0, h * .78, w, h * .22);
      ctx.fillStyle = tone(.95); for (let i = 0; i < 9; i++) ctx.fillRect(w * rr(r, .3, .8), h * rr(r, .8, .98), w * rr(r, .05, .2), 1.4);
    } else if (kind === 'arch') {
      ctx.fillStyle = tone(.3); ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = tone(.9); ctx.beginPath(); ctx.moveTo(w * .25, h); ctx.lineTo(w * .25, h * .45); ctx.arc(w * .5, h * .45, w * .25, Math.PI, 0); ctx.lineTo(w * .75, h); ctx.fill();
      ctx.fillStyle = tone(.6); ctx.fillRect(w * .25, h * .84, w * .5, h * .05); ctx.fillRect(w * .2, h * .89, w * .6, h * .05); ctx.fillRect(w * .15, h * .94, w * .7, h * .06);
      ctx.fillStyle = tone(.45); ctx.beginPath(); ctx.moveTo(w * .25, h * .84); ctx.lineTo(w * .25, h * .45); ctx.arc(w * .5, h * .45, w * .25, Math.PI, Math.PI * 1.25); ctx.lineTo(w * .32, h * .84); ctx.closePath(); ctx.fill();
    } else {
      ctx.fillStyle = tone(.95); ctx.beginPath(); circle(ctx, w * .5, h * .5, h * .14); ctx.fill();
      ctx.fillStyle = tone(.4); ctx.fillRect(0, h * .56, w, h * .44);
      ctx.fillStyle = tone(.9); for (let i = 0; i < 12; i++) ctx.fillRect(w * (.5 - rr(r, .02, .2)), h * (.6 + i * .03), w * rr(r, .1, .4), 1.6);
    }
    ctx.fillStyle = radial(ctx, w / 2, h / 2, Math.min(w, h) * .3, Math.max(w, h) * .75, [[0, rgba(tone(0), 0)], [1, rgba(tone(0), .45)]]); ctx.fillRect(0, 0, w, h);
  }

  scene('light', 'darkroom', (ctx, P, r) => {
    const night = P.night;
    const wire = x => 238 + x / W * 40 + Math.sin(Math.PI * x / W) * 70;
    const lamp = [230, 140];
    // The wall.
    ctx.fillStyle = night ? linear(ctx, 0, 0, 0, H, [[0, P.background], [1, P.darker_background]]) : linear(ctx, 0, 0, 0, H, [[0, mixHex(P.background, '#ffffff', .4)], [1, P.dark_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.muted, night ? .4 : .08, 260);
    if (night) {
      soft(ctx, 260, x => { x.fillStyle = rgba(P.red, .5); x.beginPath(); circle(x, lamp[0] + 80, lamp[1] + 140, 560); x.fill(); }, 1, 'screen');
      soft(ctx, 90, x => { x.fillStyle = rgba(P.accent, .5); x.beginPath(); ellipse(x, lamp[0] + 40, lamp[1] + 120, 280, 200); x.fill(); }, 1, 'screen');
    }
    // The safelight: a box with a glowing red filter.
    ctx.fillStyle = night ? mixHex(P.darker_background, P.brown, .3) : mixHex(P.foreground, P.background, .2);
    ctx.beginPath(); ctx.roundRect(lamp[0] - 100, lamp[1] - 70, 200, 140, 14); ctx.fill();
    ctx.fillStyle = night ? radial(ctx, lamp[0], lamp[1], 10, 110, [[0, P.bright_red], [.5, P.red], [1, mixHex(P.red, P.background, .3)]]) : mixHex(P.red, P.foreground, .45);
    ctx.beginPath(); ctx.roundRect(lamp[0] - 82, lamp[1] - 52, 164, 104, 8); ctx.fill();
    ctx.strokeStyle = night ? rgba(P.bright_red, .6) : rgba('#ffffff', .3); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(lamp[0] - 70, lamp[1] - 40); ctx.lineTo(lamp[0] + 40, lamp[1] - 40); ctx.stroke();
    ctx.fillStyle = night ? mixHex(P.darker_background, P.brown, .3) : mixHex(P.foreground, P.background, .3); ctx.fillRect(lamp[0] - 8, 0, 16, lamp[1] - 70);
    if (night) bloom(ctx, x => { x.fillStyle = P.red; x.beginPath(); x.roundRect(lamp[0] - 82, lamp[1] - 52, 164, 104, 8); x.fill(); }, [80, 24], [.6, .5]);

    // Light falls off with the distance from the lamp.
    const lit = (x, y) => night ? clamp(1.15 - Math.hypot(x - lamp[0], y - lamp[1]) / 1700, .35, 1) : 1;
    const ramp2 = k => night
      ? ramp([[0, mixHex(P.darker_background, P.red, .1 * k)], [.5, mixHex(P.background, P.red, .55 * k)], [1, mixHex(P.red, P.bright_red, .5 * k + .1)]])
      : ramp([[0, mixHex(P.foreground, P.red, .2)], [.5, mixHex(P.red, P.background, .35)], [1, mixHex(P.background, '#ffffff', .5)]]);
    // The line across the room.
    ctx.strokeStyle = night ? rgba(P.dark_foreground, .7) : rgba(P.foreground, .6); ctx.lineWidth = 2;
    ctx.beginPath(); for (let x = -20; x <= W + 20; x += 20) x < 0 ? ctx.moveTo(x, wire(x)) : ctx.lineTo(x, wire(x)); ctx.stroke();
    const pin = (x, y, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = night ? mixHex(P.brown, P.background, .3) : mixHex(P.orange, P.background, .45);
      ctx.fillRect(-7, -20, 6, 46); ctx.fillRect(1, -20, 6, 46);
      ctx.fillStyle = night ? rgba(P.red, .5) : rgba('#ffffff', .4); ctx.fillRect(-7, -20, 2, 46);
      ctx.strokeStyle = night ? P.muted : P.dark_foreground; ctx.lineWidth = 1.6; ctx.beginPath(); circle(ctx, 0, 0, 5); ctx.stroke();
      ctx.restore();
    };
    // A print hangs from 1 or 2 pins: a white border around a picture.
    const printAt = (cx, w, h, a, kind) => {
      const top = wire(cx) + 10, k = lit(cx, top + h / 2);
      ctx.save(); ctx.translate(cx, top); ctx.rotate(a);
      soft(ctx, 12, x => { x.fillStyle = '#000000'; x.fillRect(-w / 2 + 10, 14, w, h); }, night ? .6 : .2);
      ctx.fillStyle = night ? mixHex(P.background, P.red, .5 * k) : mixHex(P.background, '#ffffff', .7);
      ctx.beginPath();
      ctx.moveTo(-w / 2, 0); ctx.lineTo(w / 2, 0); ctx.quadraticCurveTo(w / 2 + 4, h / 2, w / 2, h); ctx.quadraticCurveTo(0, h + 6, -w / 2, h); ctx.quadraticCurveTo(-w / 2 - 4, h / 2, -w / 2, 0);
      ctx.fill();
      ctx.save(); ctx.translate(-w / 2 + 14, 14);
      ctx.beginPath(); ctx.rect(0, 0, w - 28, h - 40); ctx.clip();
      snapshot(ctx, r, w - 28, h - 40, kind, ramp2(k));
      ctx.restore();
      // A gloss band and drops of water at the lower corners.
      ctx.fillStyle = linear(ctx, -w / 2, 0, w / 2, h, [[0, rgba('#ffffff', 0)], [.45, rgba('#ffffff', night ? .05 : .18)], [.55, rgba('#ffffff', 0)]]); ctx.fillRect(-w / 2, 0, w, h);
      ctx.fillStyle = night ? rgba(P.bright_red, .5) : rgba(P.foreground, .25);
      [[-w / 2 + 6, h + 9, 3.6], [w / 2 - 8, h + 7, 3], [w / 2 - 8, h + 22, 2.4]].forEach(([dx, dy, rad]) => { ctx.beginPath(); ellipse(ctx, dx, dy, rad * .8, rad); ctx.fill(); });
      ctx.restore();
      pin(cx - w * .32, top + 2, a); if (w > 200) pin(cx + w * .32, top + 2 + Math.sin(a) * w * .64, a);
    };
    // A strip of film negatives with sprocket holes.
    const filmAt = (cx, len, a) => {
      const top = wire(cx) + 10, wd = 70, k = lit(cx, top + len / 2);
      ctx.save(); ctx.translate(cx, top); ctx.rotate(a);
      soft(ctx, 10, x => { x.fillStyle = '#000000'; x.fillRect(-wd / 2 + 8, 12, wd, len); }, night ? .5 : .16);
      ctx.fillStyle = night ? mixHex(P.darker_background, P.red, .22 * k) : mixHex(P.orange, P.background, .35);
      ctx.fillRect(-wd / 2, 0, wd, len);
      const neg = night ? ramp([[0, mixHex(P.red, P.bright_red, .3 * k)], [1, mixHex(P.darker_background, P.red, .1)]]) : ramp([[0, mixHex(P.background, '#ffffff', .5)], [1, mixHex(P.orange, P.foreground, .45)]]);
      const kinds = ['peaks', 'tree', 'sun', 'arch'];
      for (let y = 14, i = 0; y + 48 < len; y += 56, i++) {
        ctx.save(); ctx.translate(-wd / 2 + 13, y); ctx.beginPath(); ctx.rect(0, 0, wd - 26, 46); ctx.clip();
        snapshot(ctx, r, wd - 26, 46, kinds[i % 4], neg);
        ctx.restore();
      }
      ctx.fillStyle = night ? P.background : mixHex(P.background, '#ffffff', .4);
      for (let y = 6; y < len - 6; y += 14) { ctx.beginPath(); ctx.roundRect(-wd / 2 + 3, y, 6, 8, 1.5); ctx.roundRect(wd / 2 - 9, y, 6, 8, 1.5); ctx.fill(); }
      ctx.restore();
      pin(cx, top + 2, a);
    };
    filmAt(470, 520, .03);
    printAt(700, 230, 300, -.02, 'tree');
    printAt(1000, 320, 250, .015, 'peaks');
    filmAt(1250, 460, -.02);
    printAt(1460, 240, 310, .02, 'arch');
    printAt(1770, 280, 240, -.03, 'sun');

    // The bench with 3 trays.
    const bench = 840;
    ctx.fillStyle = night ? linear(ctx, 0, bench, 0, H, [[0, mixHex(P.darker_background, P.red, .12)], [1, P.darker_background]]) : linear(ctx, 0, bench, 0, H, [[0, P.lighter_background], [1, P.darker_background]]);
    ctx.fillRect(0, bench, W, H - bench);
    ctx.fillStyle = night ? rgba(P.red, .35) : rgba('#ffffff', .6); ctx.fillRect(0, bench, W, 3);
    const tray = (x0, x1, liquid, withPrint) => {
      const y0 = bench + 34, y1 = H - 26, inset = 26;
      const outer = [[x0 + 30, y0], [x1 - 30, y0], [x1, y1], [x0, y1]];
      soft(ctx, 14, x => { x.fillStyle = '#000000'; x.beginPath(); poly(x, outer.map(([a, b]) => [a + 10, b + 12])); x.fill(); }, night ? .6 : .2);
      ctx.fillStyle = night ? mixHex(P.background, P.red, .2) : mixHex(P.background, P.muted, .25);
      ctx.beginPath(); poly(ctx, outer); ctx.fill();
      const inner = [[x0 + 30 + inset, y0 + inset * .6], [x1 - 30 - inset, y0 + inset * .6], [x1 - inset, y1 - inset * .6], [x0 + inset, y1 - inset * .6]];
      ctx.fillStyle = liquid; ctx.beginPath(); poly(ctx, inner); ctx.fill();
      ctx.save(); ctx.beginPath(); poly(ctx, inner); ctx.clip();
      if (withPrint) {
        ctx.save(); ctx.translate((x0 + x1) / 2 - 90, y0 + 40); ctx.transform(1, 0, -.12, .55, 0, 0);
        ctx.globalAlpha = .6; snapshot(ctx, r, 180, 230, 'peaks', ramp2(.8)); ctx.globalAlpha = 1;
        ctx.restore();
        ctx.fillStyle = rgba(liquid, .4); ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
      soft(ctx, 10, x => { x.fillStyle = rgba(night ? P.bright_red : '#ffffff', night ? .45 : .5); x.beginPath(); ellipse(x, (x0 + x1) / 2 - 80, y0 + 50, 120, 10, -.05); x.fill(); }, 1, 'screen');
      ctx.strokeStyle = rgba(night ? P.bright_red : '#ffffff', night ? .18 : .4); ctx.lineWidth = 1.2;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ellipse(ctx, (x0 + x1) / 2 + 60, y0 + 110, 30 + i * 26, 6 + i * 5); ctx.stroke(); }
      ctx.restore();
      ctx.strokeStyle = night ? rgba(P.bright_red, .35) : rgba('#ffffff', .7); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(outer[0][0], outer[0][1]); ctx.lineTo(outer[1][0], outer[1][1]); ctx.stroke();
    };
    const liq = night ? mixHex(P.darker_background, P.red, .16) : mixHex(P.background, P.red, .1);
    tray(150, 650, liq, false);
    tray(740, 1240, liq, true);
    tray(1330, 1830, liq, false);
    // Tongs across the first tray.
    ctx.strokeStyle = night ? mixHex(P.muted, P.red, .3) : mixHex(P.dark_foreground, P.background, .2); ctx.lineWidth = 7; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(300, bench + 26); ctx.lineTo(560, bench + 150); ctx.moveTo(312, bench + 20); ctx.lineTo(574, bench + 140); ctx.stroke();

    // Red haze in the air at night.
    if (night) soft(ctx, 160, x => { x.fillStyle = rgba(P.red, .1); x.fillRect(0, 0, W, H); x.fillStyle = rgba(P.red, .2); x.beginPath(); circle(x, lamp[0], lamp[1] + 200, 600); x.fill(); }, 1, 'screen');
    vignette(ctx, P, night ? .65 : .14);
    grain(ctx, r() * 1e9 | 0, night ? .05 : .035);
  });
  // ---------- light/anaglyph ----------

  // Edges of simple solids as pairs of 3D points around the origin.
  function solidEdges(kind, s) {
    const E = [];
    if (kind === 'cube') {
      const v = []; for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) v.push([x * s, y * s, z * s]);
      for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) if ([0, 1, 2].filter(k => v[i][k] !== v[j][k]).length === 1) E.push([v[i], v[j]]);
    } else if (kind === 'octa') {
      const v = [[s, 0, 0], [-s, 0, 0], [0, s, 0], [0, -s, 0], [0, 0, s], [0, 0, -s]];
      for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) if (Math.abs(Math.hypot(...v[i].map((a, k) => a - v[j][k])) - s * Math.SQRT2) < 1e-6) E.push([v[i], v[j]]);
    } else if (kind === 'ico') {
      const t = (1 + Math.sqrt(5)) / 2, v = [];
      for (const a of [-1, 1]) for (const b of [-t, t]) v.push([0, a, b], [a, b, 0], [b, 0, a]);
      const k = s / Math.hypot(1, t);
      for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) if (Math.abs(Math.hypot(...v[i].map((a, q) => a - v[j][q])) - 2) < 1e-6) E.push([v[i].map(c => c * k), v[j].map(c => c * k)]);
    } else if (kind === 'torus') {
      const R = s, rt = s * .34, nu = 22, nv = 10;
      const p = (u, w) => [(R + rt * Math.cos(w)) * Math.cos(u), rt * Math.sin(w), (R + rt * Math.cos(w)) * Math.sin(u)];
      for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
        const u = i / nu * TAU, u2 = (i + 1) / nu * TAU, w = j / nv * TAU, w2 = (j + 1) / nv * TAU;
        E.push([p(u, w), p(u2, w)], [p(u, w), p(u, w2)]);
      }
    } else if (kind === 'sphere') {
      const nl = 9, nm = 16, p = (a, b) => [s * Math.sin(a) * Math.cos(b), s * Math.cos(a), s * Math.sin(a) * Math.sin(b)];
      for (let i = 1; i < nl; i++) for (let j = 0; j < nm; j++) E.push([p(i / nl * Math.PI, j / nm * TAU), p(i / nl * Math.PI, (j + 1) / nm * TAU)]);
      for (let j = 0; j < nm; j++) for (let i = 0; i < nl; i++) E.push([p(i / nl * Math.PI, j / nm * TAU), p((i + 1) / nl * Math.PI, j / nm * TAU)]);
    }
    return E;
  }

  scene('light', 'anaglyph', (ctx, P, r) => {
    const night = P.night;
    const red = P.red, cyan = night ? P.green : P.green;
    ctx.fillStyle = night ? radial(ctx, 960, 520, 50, 1200, [[0, P.lighter_background], [1, P.darker_background]]) : radial(ctx, 960, 520, 50, 1200, [[0, mixHex(P.background, '#ffffff', .6)], [1, P.dark_background]]);
    ctx.fillRect(0, 0, W, H);
    if (!night) tooth(ctx, r() * 1e9 | 0, P.dark_foreground, '#ffffff', .25);

    const f = 900, z0 = 10.5, kd = 60, cx = 960, cy = 470;
    const n = makeNoise(r() * 1e9 | 0);
    // Lines in 3D: [a, b, width, alpha].
    const lines = [];
    const ground = (x, z) => -1.7 + (fbm(n, x * .14, z * .14, 4) * .5 + .5) * smooth(clamp((Math.abs(x) - 2.6) / 7, 0, 1)) * (1.2 + z * .14);
    for (let x = -26; x <= 26; x += 1.3) for (let z = 2.2; z < 44; z += 1.3) {
      const a = Math.min(1, 7 / z);
      lines.push([[x, ground(x, z), z], [x, ground(x, z + 1.3), z + 1.3], 1.3, a]);
      if (x + 1.3 <= 26) lines.push([[x, ground(x, z), z], [x + 1.3, ground(x + 1.3, z), z], 1.3, a]);
    }
    const rot = (p, ya, pa) => {
      let [x, y, z] = p;
      [x, z] = [x * Math.cos(ya) - z * Math.sin(ya), x * Math.sin(ya) + z * Math.cos(ya)];
      [y, z] = [y * Math.cos(pa) - z * Math.sin(pa), y * Math.sin(pa) + z * Math.cos(pa)];
      return [x, y, z];
    };
    const place3 = (kind, s, at, ya, pa, wd) => solidEdges(kind, s).forEach(([a, b]) => lines.push([rot(a, ya, pa).map((v, k) => v + at[k]), rot(b, ya, pa).map((v, k) => v + at[k]), wd, 1]));
    place3('ico', 1.3, [-3.3, .2, 6.6], .5, .4, 2.4);
    place3('torus', 1.4, [3.7, .7, 7.6], .3, 1.1, 2);
    place3('cube', .8, [1.3, 2.3, 14], .7, .5, 2);
    place3('sphere', 1.7, [-6.5, 2.6, 14.5], .2, .3, 1.6);
    place3('octa', 1.4, [-5.3, -.2, 3.6], .4, .2, 3);
    place3('cube', .5, [8.2, 3.6, 11], .2, .9, 2);

    // Each eye sees the scene with its own shift, set by the depth.
    const eye = (side, x) => {
      const pr = ([X, Y, Z]) => { const raw = kd * (1 - z0 / Z), d = raw < 0 ? 95 * Math.tanh(raw / 95) : raw; return [cx + f * X / Z + side * d / 2, cy - f * Y / Z]; };
      x.lineCap = 'round';
      for (const [a, b, wd, al] of lines) {
        if (a[2] < .5 || b[2] < .5) continue;
        const p = pr(a), q = pr(b);
        x.globalAlpha = al; x.lineWidth = wd;
        x.beginPath(); x.moveTo(p[0], p[1]); x.lineTo(q[0], q[1]); x.stroke();
      }
      x.globalAlpha = 1;
      // Stars, each printed twice.
      x.fillStyle = x.strokeStyle;
      const q = rng(seed);
      for (let i = 0; i < (night ? 120 : 40); i++) { const sx = q() * W, sy = q() * 300, z = 30 + q() * 30; x.globalAlpha = (.3 + q() * .6) * (night ? 1 : .5); x.beginPath(); circle(x, sx + side * kd * (1 - z0 / z) / 2, sy, .8 + q() * 1.6); x.fill(); }
      x.globalAlpha = 1;
    };
    const seed = r() * 1e9 | 0;
    if (night) {
      const [rc, rx] = layer(), [cc, cxx] = layer();
      rx.strokeStyle = red; eye(-1, rx);
      cxx.strokeStyle = cyan; eye(1, cxx);
      haze(ctx, rc, 8, .7, 'lighter'); haze(ctx, cc, 8, .7, 'lighter');
      put(ctx, rc, .95, 'lighter'); put(ctx, cc, .95, 'lighter');
    } else {
      const [rc, rx] = layer(), [cc, cxx] = layer();
      rx.strokeStyle = mixHex(red, P.background, .1); eye(-1, rx);
      cxx.strokeStyle = mixHex(cyan, P.background, .25); eye(1, cxx);
      put(ctx, rc, .9, 'multiply'); put(ctx, cc, .9, 'multiply');
      // Ink sits in the paper: specks of paper show through the lines.
      tileFill(ctx, tile(r() * 1e9 | 0, 256, P.background, v => (v > .86 ? .7 : 0)), 1, .5);
    }
    vignette(ctx, P, night ? .55 : .12);
    grain(ctx, r() * 1e9 | 0, night ? .045 : .035);
  });
  // ---------- light/cross-process ----------

  scene('light', 'cross-process', (ctx, P, r) => {
    const night = P.night;
    const hi = adjust(P.yellow, { L: night ? .1 : .3 });
    const tone = night
      ? ramp([[0, mixHex(P.darker_background, P.blue, .12)], [.25, mixHex(P.background, P.blue, .5)], [.5, mixHex(P.blue, P.green, .5)], [.72, mixHex(P.green, P.yellow, .55)], [.88, P.yellow], [1, mixHex(P.bright_yellow, P.foreground, .5)]])
      : ramp([[0, mixHex(P.blue, P.background, .15)], [.3, mixHex(P.cyan, P.background, .35)], [.55, mixHex(P.green, P.background, .45)], [.8, mixHex(hi, P.background, .2)], [1, mixHex(P.background, '#ffffff', .7)]]);
    const sun = night ? [1240, 500, 70] : [1330, 250, 80], horizon = 560;
    // Sky.
    ctx.fillStyle = linear(ctx, 0, 0, 0, horizon, night ? [[0, tone(.12)], [.55, tone(.38)], [.85, tone(.62)], [1, tone(.78)]] : [[0, tone(.26)], [.55, tone(.48)], [.85, tone(.72)], [1, tone(.88)]]);
    ctx.fillRect(0, 0, W, horizon + 2);
    soft(ctx, 220, x => { x.fillStyle = rgba(night ? P.magenta : adjust(P.magenta, { L: .25 }), night ? .35 : .3); x.beginPath(); circle(x, 200, 120, 520); x.fill(); }, 1, night ? 'screen' : 'source-over');
    soft(ctx, 160, x => { x.fillStyle = rgba(tone(.9), .8); x.beginPath(); circle(x, sun[0], sun[1], 300); x.fill(); }, 1, 'screen');
    // Clouds in long streaks.
    soft(ctx, 10, x => {
      for (let i = 0; i < 14; i++) { x.fillStyle = rgba(tone(night ? .55 : .95), rr(r, .2, .5)); x.beginPath(); ellipse(x, rr(r, 0, W), rr(r, 120, horizon - 120), rr(r, 120, 380), rr(r, 6, 16), rr(r, -.05, .05)); x.fill(); }
    });
    // The sun, with red halation around it.
    soft(ctx, 40, x => { x.fillStyle = rgba(P.red, night ? .7 : .45); x.beginPath(); circle(x, sun[0], sun[1], sun[2] * 1.5); x.fill(); }, 1, 'screen');
    ctx.fillStyle = tone(1); ctx.beginPath(); circle(ctx, sun[0], sun[1], sun[2]); ctx.fill();
    bloom(ctx, x => { x.fillStyle = tone(.95); x.beginPath(); circle(x, sun[0], sun[1], sun[2]); x.fill(); }, [120, 30], night ? [.6, .5] : [.35, .3]);
    // Gulls.
    ctx.strokeStyle = tone(.08); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    [[560, 210, 1], [610, 240, .8], [700, 190, .7], [470, 260, .6]].forEach(([gx, gy, s]) => { ctx.beginPath(); ctx.moveTo(gx - 18 * s, gy - 6 * s); ctx.quadraticCurveTo(gx - 8 * s, gy - 10 * s, gx, gy); ctx.quadraticCurveTo(gx + 8 * s, gy - 10 * s, gx + 18 * s, gy - 6 * s); ctx.stroke(); });
    // The sea, with a path of light under the sun.
    ctx.fillStyle = linear(ctx, 0, horizon, 0, 800, [[0, tone(night ? .4 : .55)], [1, tone(night ? .22 : .38)]]);
    ctx.fillRect(0, horizon, W, 300);
    ctx.save();
    for (let i = 0; i < 260; i++) {
      const y = horizon + 4 + (300 * r() ** 1.6), d = (y - horizon) / 300, w = rr(r, 20, 140) * (1 + d * 2);
      const nearPath = r() < .55, x = nearPath ? sun[0] + rr(r, -1, 1) * (40 + d * 260) : rr(r, -50, W);
      ctx.fillStyle = rgba(tone(nearPath ? .97 : .6), nearPath ? rr(r, .3, .8) : rr(r, .1, .3));
      ctx.fillRect(x - w / 2, y, w, 1 + d * 3);
    }
    ctx.restore();
    // The beach: wet sand, lines of foam, dry sand.
    const shore = x => 790 + Math.sin(x / 260) * 26 - x * .05;
    ctx.beginPath(); ctx.moveTo(0, shore(0)); for (let x = 0; x <= W; x += 10) ctx.lineTo(x, shore(x)); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, 720, 0, H, [[0, tone(.62)], [.2, tone(.8)], [1, tone(night ? .55 : .72)]]); ctx.fill();
    ctx.strokeStyle = rgba(tone(1), .8); ctx.lineWidth = 3;
    for (let k = 0; k < 3; k++) { ctx.beginPath(); for (let x = -10; x <= W + 10; x += 10) { const y = shore(x) - 6 - k * 14 + Math.sin(x / 40 + k * 2) * 3; x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); } ctx.globalAlpha = .8 - k * .25; ctx.stroke(); }
    ctx.globalAlpha = 1;
    soft(ctx, 20, x => { x.fillStyle = rgba(tone(.95), .35); x.beginPath(); ellipse(x, sun[0] - 100, 860, 260, 26); x.fill(); }, 1, 'screen');
    // A lifeguard hut on stilts.
    const hx = 400, hy = 760;
    ctx.strokeStyle = tone(.1); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(hx - 50, hy); ctx.lineTo(hx - 60, hy + 150); ctx.moveTo(hx + 50, hy); ctx.lineTo(hx + 60, hy + 150); ctx.moveTo(hx - 54, hy + 60); ctx.lineTo(hx + 54, hy + 100); ctx.moveTo(hx + 54, hy + 60); ctx.lineTo(hx - 54, hy + 100); ctx.stroke();
    ctx.fillStyle = tone(.12); ctx.fillRect(hx - 64, hy - 70, 128, 72);
    ctx.fillStyle = tone(.3); ctx.fillRect(hx - 44, hy - 56, 40, 30);
    ctx.fillStyle = tone(.08); ctx.beginPath(); ctx.moveTo(hx - 84, hy - 66); ctx.lineTo(hx, hy - 110); ctx.lineTo(hx + 84, hy - 66); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = tone(.12); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(hx + 66, hy); ctx.lineTo(hx + 130, hy + 150); ctx.moveTo(hx + 84, hy); ctx.lineTo(hx + 148, hy + 150); for (let k = 1; k < 6; k++) { ctx.moveTo(hx + 66 + k * 11, hy + k * 25); ctx.lineTo(hx + 84 + k * 11, hy + k * 25); } ctx.stroke();
    // A palm leans in from the right.
    const trunk = spline([[1790, H + 20], [1760, 820], [1690, 560], [1590, 330]], 6);
    ctx.beginPath(); taper(ctx, trunk, t => 46 - t * 26); ctx.fillStyle = tone(.06); ctx.fill();
    ctx.strokeStyle = rgba(tone(.3), .5); ctx.lineWidth = 2;
    for (let i = 4; i < trunk.length - 2; i += 3) { const [tx, ty] = trunk[i]; ctx.beginPath(); ctx.moveTo(tx - 20, ty); ctx.lineTo(tx + 20, ty + 4); ctx.stroke(); }
    const crown = trunk[trunk.length - 1];
    ctx.fillStyle = tone(.05);
    for (let i = 0; i < 9; i++) {
      const a = -Math.PI + i / 8 * Math.PI * 1.25 - .2 + rr(r, -.1, .1), len = rr(r, 220, 330);
      const pts = spline([crown, [crown[0] + Math.cos(a) * len * .5, crown[1] + Math.sin(a) * len * .5 - 40], [crown[0] + Math.cos(a) * len, crown[1] + Math.sin(a) * len + len * .35]], 6);
      const nm = normals(pts);
      ctx.beginPath();
      pts.forEach((p, k) => { const w = Math.sin(k / (pts.length - 1) * Math.PI) * 24; ctx.lineTo(p[0] + nm[k][0] * w, p[1] + nm[k][1] * w); });
      for (let k = pts.length - 1; k >= 0; k--) { const w = Math.sin(k / (pts.length - 1) * Math.PI) * 6; ctx.lineTo(pts[k][0] - nm[k][0] * w, pts[k][1] - nm[k][1] * w); }
      ctx.fill();
      ctx.save(); ctx.strokeStyle = tone(.05); ctx.lineWidth = 2.5;
      for (let k = 2; k < pts.length - 1; k++) { const w = Math.sin(k / (pts.length - 1) * Math.PI) * 30; ctx.beginPath(); ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k][0] + nm[k][0] * w + 6, pts[k][1] + nm[k][1] * w + 16); ctx.stroke(); }
      ctx.restore();
    }

    // The film rebate with sprocket holes on the left edge.
    ctx.fillStyle = tone(night ? 0 : .08); ctx.fillRect(0, 0, 44, H);
    ctx.fillStyle = rgba(tone(.95), night ? .8 : .7);
    for (let y = 18; y < H; y += 52) { ctx.beginPath(); ctx.roundRect(10, y, 22, 30, 4); ctx.fill(); }
    // Light leaks burn in from the film edge, over the rebate too.
    const leakA = night ? P.orange : adjust(P.orange, { L: .22, C: .04 }), leakB = night ? P.red : adjust(P.red, { L: .18, C: .04 }), leakC = night ? P.magenta : adjust(P.magenta, { L: .2 });
    soft(ctx, 80, x => {
      x.fillStyle = rgba(leakA, .95); x.beginPath(); ellipse(x, 90, 360, 260, 330, .1); x.fill();
      x.fillStyle = rgba(leakB, .9); x.beginPath(); ellipse(x, 120, 820, 220, 220); x.fill();
      x.fillStyle = rgba(leakC, .7); x.beginPath(); ellipse(x, W - 40, 80, 260, 260); x.fill();
    }, night ? .62 : .5, 'source-over');
    soft(ctx, 24, x => {
      x.fillStyle = rgba(night ? P.bright_yellow : '#ffffff', .85); x.beginPath(); ellipse(x, 40, 380, 80, 200); x.fill();
      x.fillStyle = rgba(leakA, .8); x.beginPath(); ellipse(x, 70, 640, 70, 110, .2); x.fill();
    }, night ? .85 : .75, 'screen');
    // Coarse, colored grain.
    tileFill(ctx, tile(r() * 1e9 | 0, 256, P.magenta, v => v ** 6 * .6), 1.4, night ? .35 : .25);
    tileFill(ctx, tile(r() * 1e9 | 0, 256, P.green, v => v ** 6 * .6), 1.4, night ? .35 : .25);
    vignette(ctx, P, night ? .6 : .2);
    grain(ctx, r() * 1e9 | 0, night ? .06 : .05);
  });
  // ---------- light/thermal ----------

  scene('light', 'thermal', (ctx, P, r) => {
    const night = P.night;
    const heat = night
      ? ramp([[0, P.darker_background], [.14, mixHex(P.background, P.magenta, .3)], [.32, mixHex(P.magenta, P.background, .15)], [.48, P.blue], [.62, P.red], [.76, P.orange], [.88, P.yellow], [1, mixHex(P.bright_yellow, P.bright_foreground, .5)]])
      : ramp([[0, mixHex(P.background, '#ffffff', .4)], [.14, mixHex(P.background, P.magenta, .2)], [.32, mixHex(P.magenta, P.background, .45)], [.48, mixHex(P.blue, P.background, .15)], [.62, P.red], [.76, adjust(P.orange, { L: .12 })], [.88, adjust(P.yellow, { L: .3 })], [1, adjust(P.yellow, { L: .45 })]]);
    const n = makeNoise(r() * 1e9 | 0);
    const g = (x, y, cx, cy, rx, ry, a = 0) => { const c = Math.cos(a), s = Math.sin(a), dx = x - cx, dy = y - cy, u = (dx * c + dy * s) / rx, v = (-dx * s + dy * c) / ry; return Math.exp(-(u * u + v * v)); };
    // Temperature: a warm body in the lower left, a hot cup with steam on a
    // table at the right, a radiator at the right edge and a cold window.
    const cup = [1480, 560];
    const T = (x, y) => {
      let t = .12 + y / H * .1 + fbm(n, x / 260, y / 260, 4) * .06;
      const win = smooth(clamp((x - 560) / 30, 0, 1)) * smooth(clamp((1000 - x) / 30, 0, 1)) * smooth(clamp((y - 110) / 30, 0, 1)) * smooth(clamp((430 - y) / 30, 0, 1));
      t -= .07 * win;
      t += .06 * (Math.exp(-(((x - 780) / 6) ** 2)) + Math.exp(-(((y - 270) / 6) ** 2))) * win;
      t += .62 * g(x, y, 330, 900, 300, 330) + .2 * g(x, y, 330, 560, 120, 140) + .3 * g(x, y, 300, 600, 90, 110);
      t += .16 * smooth(clamp((x - 980) / 80, 0, 1)) * Math.exp(-(((y - 668) / 14) ** 2));
      t += .78 * g(x, y, cup[0], cup[1], 82, 100) + .2 * g(x, y, cup[0], cup[1] + 40, 220, 120);
      t += .35 * Math.exp(-(((Math.hypot(x - cup[0] - 96, y - cup[1] + 6) - 34) / 9) ** 2));
      const st = clamp((cup[1] - 90 - y) / 380, 0, 1);
      const rise = smooth(clamp((cup[1] - 40 - y) / 90, 0, 1));
      t += .42 * rise * Math.exp(-(((x - cup[0] - Math.sin(y / 55) * 34 * st - n(y / 80, 3) * 50 * st) / (34 + st * 90)) ** 2)) * (1 - st) ** 1.2;
      t += .3 * g(x, y, 1420, 980, 300, 110, -.1) + .22 * g(x, y, 900, 1080, 420, 90);
      return t + fbm(n, x / 60 + 5, y / 60, 3) * .022;
    };
    const gw = 241, gh = 136, box = [0, 0, W, H], field = grid(gw, gh, T, box);
    const img = texture(480, 270, (x, y, o) => { const [cr, cg, cb] = rgb(heat(clamp(T(x, y), 0, 1))); o[0] = cr; o[1] = cg; o[2] = cb; });
    cover(ctx, img);
    // Isolines.
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.3;
    for (let lv = .2; lv < .96; lv += .08) {
      ctx.strokeStyle = rgba(night ? heat(Math.min(1, lv + .3)) : heat(Math.min(1, lv + .3)), night ? .8 : .6);
      ctx.beginPath(); contours(field, gw, gh, lv, box).forEach(l => curve(ctx, l, l.closed)); ctx.stroke();
    }
    ctx.restore();
    // Sensor noise: faint column stripes and speckle.
    const stripes = document.createElement('canvas'); stripes.width = 64; stripes.height = 1;
    const sx = stripes.getContext('2d'), rs = rng(r() * 1e9 | 0);
    for (let i = 0; i < 64; i++) { sx.fillStyle = rgba(rs() < .5 ? '#000000' : '#ffffff', rs() * .5); sx.fillRect(i, 0, 1, 1); }
    tileFill(ctx, stripes, 2, night ? .05 : .04);
    // The viewfinder: corner marks, a crosshair, a spot on the hottest point and a scale.
    const ui = night ? P.foreground : P.foreground;
    ctx.strokeStyle = rgba(ui, .75); ctx.lineWidth = 3; ctx.lineCap = 'square';
    [[60, 60, 1, 1], [W - 60, 60, -1, 1], [60, H - 60, 1, -1], [W - 60, H - 60, -1, -1]].forEach(([x, y, sx2, sy]) => { ctx.beginPath(); ctx.moveTo(x, y + sy * 60); ctx.lineTo(x, y); ctx.lineTo(x + sx2 * 60, y); ctx.stroke(); });
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(W / 2 - 34, H / 2); ctx.lineTo(W / 2 - 10, H / 2); ctx.moveTo(W / 2 + 10, H / 2); ctx.lineTo(W / 2 + 34, H / 2); ctx.moveTo(W / 2, H / 2 - 34); ctx.lineTo(W / 2, H / 2 - 10); ctx.moveTo(W / 2, H / 2 + 10); ctx.lineTo(W / 2, H / 2 + 34); ctx.stroke();
    ctx.beginPath(); circle(ctx, cup[0], cup[1], 22); ctx.moveTo(cup[0] - 34, cup[1]); ctx.lineTo(cup[0] - 22, cup[1]); ctx.moveTo(cup[0] + 22, cup[1]); ctx.lineTo(cup[0] + 34, cup[1]); ctx.stroke();
    const bx = W - 92, by0 = 300, by1 = 780;
    ctx.fillStyle = linear(ctx, 0, by1, 0, by0, Array.from({ length: 11 }, (_, i) => [i / 10, heat(i / 10)]));
    ctx.fillRect(bx, by0, 16, by1 - by0);
    ctx.strokeStyle = rgba(ui, .7); ctx.lineWidth = 1.5; ctx.strokeRect(bx, by0, 16, by1 - by0);
    ctx.beginPath(); for (let k = 0; k <= 8; k++) { const y = by0 + k * (by1 - by0) / 8; ctx.moveTo(bx - (k % 2 ? 6 : 12), y); ctx.lineTo(bx, y); } ctx.stroke();
    ctx.fillStyle = rgba(ui, .75);
    for (let k = 0; k < 4; k++) ctx.fillRect(70 + k * 26, H - 96, 16, 6);
    ctx.fillRect(W - 230, 92, 140, 6); ctx.fillRect(W - 190, 108, 100, 6);
    vignette(ctx, P, night ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, night ? .05 : .04);
  });
  // ---------- light/film-reel ----------

  scene('light', 'film-reel', (ctx, P, r) => {
    const night = P.night;
    const amber = night ? P.accent : P.accent;
    const lens = [1990, 150];
    // The room.
    ctx.fillStyle = night ? radial(ctx, 1300, 420, 50, 1500, [[0, P.lighter_background], [1, P.darker_background]]) : radial(ctx, 1100, 420, 50, 1500, [[0, mixHex(P.background, '#ffffff', .6)], [1, P.dark_background]]);
    ctx.fillRect(0, 0, W, H);
    mottle(ctx, r() * 1e9 | 0, night ? '#000000' : P.muted, night ? .4 : .08, 240);

    // The projector beam: a cone from the lens with smoke, flicker and dust.
    const beamA = [-140, 380], beamB = [-140, 1060];
    const wedge = x => { x.beginPath(); x.moveTo(lens[0], lens[1]); x.lineTo(beamA[0], beamA[1]); x.lineTo(beamB[0], beamB[1]); x.closePath(); };
    const beamCol = night ? mixHex(amber, P.foreground, .45) : adjust(amber, { L: .3 });
    soft(ctx, 90, x => { wedge(x); x.fillStyle = linear(x, lens[0], lens[1], 0, 700, [[0, rgba(amber, .5)], [.4, rgba(beamCol, .22)], [1, rgba(beamCol, .08)]]); x.fill(); }, night ? 1 : .5, night ? 'screen' : 'source-over');
    soft(ctx, 30, x => { wedge(x); x.fillStyle = linear(x, lens[0], lens[1], 0, 700, [[0, rgba(amber, .8)], [.3, rgba(beamCol, .42)], [1, rgba(beamCol, .14)]]); x.fill(); }, night ? 1 : .5, night ? 'screen' : 'source-over');
    const n = makeNoise(r() * 1e9 | 0);
    const ax = beamA[0] - lens[0], ay = (beamA[1] + beamB[1]) / 2 - lens[1], al = Math.hypot(ax, ay);
    const smoke = texture(480, 270, (x, y, o) => {
      const dx = x - lens[0], dy = y - lens[1], along = (dx * ax + dy * ay) / al, across = (-dx * ay + dy * ax) / al;
      const half = along * .2 + 4, inside = along > 0 ? smooth(clamp(1 - Math.abs(across) / half, 0, 1) * 2) : 0;
      const v = fbm(n, x / 180, y / 140, 5) * .5 + .5, flick = .7 + .3 * n(Math.atan2(dy, dx) * 60, 2);
      const [cr, cg, cb] = rgb(beamCol); o[0] = cr; o[1] = cg; o[2] = cb; o[3] = clamp(inside * v * v * flick * (night ? .55 : .35), 0, 1) * 255;
    });
    cover(ctx, smoke, 1, night ? 'screen' : 'source-over');
    // Flicker: thin rays of brighter and darker light.
    ctx.save(); ctx.globalCompositeOperation = night ? 'screen' : 'source-over';
    for (let i = 0; i < 18; i++) {
      const t = r(), a0 = lerp(Math.atan2(beamA[1] - lens[1], beamA[0] - lens[0]), Math.atan2(beamB[1] - lens[1], beamB[0] - lens[0]), t), w = rr(r, .001, .006);
      ctx.fillStyle = linear(ctx, lens[0], lens[1], lens[0] + Math.cos(a0) * 2000, lens[1] + Math.sin(a0) * 2000, [[0, rgba(beamCol, night ? .12 : .07)], [1, rgba(beamCol, 0)]]);
      ctx.beginPath(); ctx.moveTo(...lens); ctx.lineTo(lens[0] + Math.cos(a0 - w) * 2200, lens[1] + Math.sin(a0 - w) * 2200); ctx.lineTo(lens[0] + Math.cos(a0 + w) * 2200, lens[1] + Math.sin(a0 + w) * 2200); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // Dust in the beam: sharp specks and soft discs.
    const inBeam = (x, y) => { const dx = x - lens[0], dy = y - lens[1], along = (dx * ax + dy * ay) / al, across = (-dx * ay + dy * ax) / al; return along > 80 && Math.abs(across) < along * .19; };
    const dust = night ? mixHex(P.bright_foreground, amber, .2) : P.dark_foreground;
    soft(ctx, 5, x => { for (let i = 0; i < 70; i++) { const px = rr(r, 0, W), py = rr(r, 0, H); if (!inBeam(px, py)) continue; x.fillStyle = rgba(night ? dust : '#ffffff', rr(r, .1, .3) * (night ? 1 : 2)); x.beginPath(); circle(x, px, py, rr(r, 6, 16)); x.fill(); } }, 1, night ? 'screen' : 'source-over');
    for (let i = 0; i < 900; i++) {
      const px = rr(r, 0, W), py = rr(r, 0, H);
      if (!inBeam(px, py)) continue;
      ctx.fillStyle = rgba(dust, rr(r, .3, .9) * (night ? 1 : .5));
      ctx.beginPath(); circle(ctx, px, py, rr(r, .5, 1.8)); ctx.fill();
    }
    // The lens glows amber.
    if (night) bloom(ctx, x => { x.fillStyle = amber; x.beginPath(); circle(x, lens[0] - 30, lens[1], 60); x.fill(); x.fillStyle = P.bright_foreground; x.beginPath(); circle(x, lens[0] - 30, lens[1], 26); x.fill(); }, [140, 40], [.8, .7]);
    else soft(ctx, 60, x => { x.fillStyle = rgba(adjust(amber, { L: .35 }), .7); x.beginPath(); circle(x, lens[0] - 30, lens[1], 120); x.fill(); });

    // The reel: a metal flange with cutouts over wound film.
    const R = 330, C = [400, 690];
    soft(ctx, 30, x => { x.fillStyle = '#000000'; x.beginPath(); circle(x, C[0] + 26, C[1] + 34, R); x.fill(); }, night ? .7 : .25);
    const steelHi = night ? mixHex(P.light_foreground, amber, .15) : mixHex(P.background, '#ffffff', .7), steelLo = night ? mixHex(P.background, P.muted, .4) : mixHex(P.muted, P.background, .35);
    // Film wound on the hub.
    ctx.fillStyle = night ? mixHex(P.darker_background, P.brown, .3) : mixHex(P.foreground, P.muted, .25);
    ctx.beginPath(); circle(ctx, C[0], C[1], R * .9); ctx.fill();
    ctx.strokeStyle = rgba(night ? P.dark_foreground : P.muted, .35); ctx.lineWidth = .8;
    for (let k = 0; k < 70; k++) { ctx.beginPath(); circle(ctx, C[0], C[1], R * (.3 + k / 70 * .6)); ctx.stroke(); }
    soft(ctx, 14, x => { x.strokeStyle = rgba(night ? amber : '#ffffff', night ? .35 : .4); x.lineWidth = 30; x.beginPath(); x.arc(C[0], C[1], R * .62, -2.4, -1.2); x.stroke(); }, 1, 'screen');
    // The flange with 3 cutouts and small holes, as 1 path.
    ctx.beginPath(); circle(ctx, C[0], C[1], R);
    const rot = .4;
    for (let k = 0; k < 3; k++) {
      const a = rot + k * TAU / 3, sp = .72, r0 = R * .36, r1 = R * .84;
      ctx.moveTo(C[0] + Math.cos(a - sp) * r1, C[1] + Math.sin(a - sp) * r1);
      ctx.arc(C[0], C[1], r1, a - sp, a + sp);
      ctx.lineTo(C[0] + Math.cos(a + sp * .55) * r0, C[1] + Math.sin(a + sp * .55) * r0);
      ctx.arc(C[0], C[1], r0, a + sp * .55, a - sp * .55, true);
      ctx.closePath();
    }
    for (let k = 0; k < 3; k++) { const a = rot + TAU / 6 + k * TAU / 3; circle(ctx, C[0] + Math.cos(a) * R * .62, C[1] + Math.sin(a) * R * .62, R * .09); }
    ctx.fillStyle = linear(ctx, C[0] - R, C[1] - R, C[0] + R, C[1] + R, [[0, steelHi], [.5, mixHex(steelHi, steelLo, .5)], [1, steelLo]]);
    ctx.fill('evenodd');
    ctx.strokeStyle = rgba(night ? P.bright_foreground : '#ffffff', night ? .3 : .7); ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = rgba(night ? '#000000' : P.dark_foreground, .35); ctx.lineWidth = 3; ctx.beginPath(); circle(ctx, C[0], C[1], R - 2); ctx.stroke();
    ctx.strokeStyle = rgba(night ? P.bright_foreground : '#ffffff', night ? .18 : .5); ctx.lineWidth = 1.2;
    ctx.beginPath(); circle(ctx, C[0], C[1], R * .93); ctx.stroke();
    // The hub.
    ctx.fillStyle = linear(ctx, C[0] - 50, C[1] - 50, C[0] + 50, C[1] + 50, [[0, steelHi], [1, steelLo]]);
    ctx.beginPath(); circle(ctx, C[0], C[1], R * .16); ctx.fill(); ctx.stroke();
    ctx.fillStyle = night ? P.darker_background : P.foreground;
    ctx.fillRect(C[0] - 11, C[1] - 11, 22, 22);
    for (let k = 0; k < 3; k++) { const a = k * TAU / 3 - .3; ctx.beginPath(); circle(ctx, C[0] + Math.cos(a) * 34, C[1] + Math.sin(a) * 34, 5); ctx.fill(); }
    // Light on the metal.
    soft(ctx, 12, x => { x.strokeStyle = rgba('#ffffff', night ? .3 : .6); x.lineWidth = 10; x.beginPath(); x.arc(C[0], C[1], R * .97, -2.6, -1.5); x.stroke(); x.beginPath(); x.arc(C[0], C[1], R * .3, -2.8, -1.8); x.stroke(); }, 1, 'screen');

    // A strip of film unspools from the reel and runs along the bottom.
    const path = spline([[C[0] + R * .6, C[1] + R * .78], [820, 1000], [1150, 990], [1450, 900], [1700, 760], [1880, 560], [1990, 470]], 4);
    const lens2 = []; let acc = 0;
    for (let i = 0; i < path.length; i++) { if (i) acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); lens2.push(acc); }
    const at = s2 => { let i = lens2.findIndex(v => v >= s2); if (i < 1) i = 1; const t = (s2 - lens2[i - 1]) / (lens2[i] - lens2[i - 1] || 1); const p = [lerp(path[i - 1][0], path[i][0], t), lerp(path[i - 1][1], path[i][1], t)]; const a = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]); return [p, a]; };
    const fw = 128, fh = 96;
    soft(ctx, 16, x => { x.strokeStyle = '#000000'; x.lineWidth = fw; x.beginPath(); path.forEach((p, i) => (i ? x.lineTo(p[0] + 16, p[1] + 22) : x.moveTo(p[0] + 16, p[1] + 22))); x.stroke(); }, night ? .6 : .2);
    const base = night ? mixHex(P.muted, P.background, .45) : mixHex(P.foreground, P.muted, .2);
    ctx.strokeStyle = base; ctx.lineWidth = fw; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
    const kinds = ['peaks', 'tree', 'arch', 'sun'];
    const greyTone = night
      ? ramp([[0, mixHex(P.darker_background, amber, .05)], [.6, mixHex(P.muted, P.light_foreground, .4)], [1, mixHex(P.bright_foreground, amber, .25)]])
      : ramp([[0, mixHex(P.foreground, '#000000', .2)], [.6, P.muted], [1, mixHex(P.background, '#ffffff', .6)]]);
    for (let s2 = 30, k = 0; s2 + fh < acc; s2 += fh + 10, k++) {
      const [p, a] = at(s2 + fh / 2);
      ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a);
      ctx.save(); ctx.beginPath(); ctx.rect(-fh / 2, -fw / 2 + 24, fh, fw - 48); ctx.clip();
      ctx.translate(-fh / 2, -fw / 2 + 24);
      snapshot(ctx, r, fh, fw - 48, kinds[k % 4], greyTone);
      ctx.restore();
      ctx.fillStyle = night ? P.darker_background : mixHex(P.background, '#ffffff', .5);
      for (let q = 0; q < 4; q++) { ctx.beginPath(); ctx.roundRect(-fh / 2 + 6 + q * (fh + 10) / 4, -fw / 2 + 6, 12, 10, 2); ctx.roundRect(-fh / 2 + 6 + q * (fh + 10) / 4, fw / 2 - 16, 12, 10, 2); ctx.fill(); }
      ctx.restore();
    }
    // Where the strip crosses the beam it lights up.
    if (night) {
      ctx.save(); ctx.beginPath(); wedge(ctx); ctx.clip();
      ctx.globalCompositeOperation = 'screen'; ctx.strokeStyle = rgba(amber, .35); ctx.lineWidth = fw;
      ctx.beginPath(); path.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.stroke();
      ctx.restore();
    }
    // A gloss line along the film.
    ctx.strokeStyle = rgba('#ffffff', night ? .12 : .3); ctx.lineWidth = 2;
    ctx.beginPath(); path.forEach((p, i) => { const [q] = [p]; i ? ctx.lineTo(q[0], q[1] - fw / 2 + 2) : ctx.moveTo(q[0], q[1] - fw / 2 + 2); }); ctx.stroke();

    vignette(ctx, P, night ? .6 : .14);
    grain(ctx, r() * 1e9 | 0, night ? .05 : .04);
  });
})();
