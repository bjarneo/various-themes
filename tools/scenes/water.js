// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Water and birds: beaches, pools, ponds, harbors, the deep sea, feathers and shells.
(() => {
  const TAU = Math.PI * 2;
  const rr = (r, a, b) => a + (b - a) * r();
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const seedOf = r => Math.floor(r() * 2147483647);

  // The color at OKLCH lightness L, with its chroma scaled by cx.
  const tone = (hex, L, cx = 1) => adjust(hex, { L: L - toOklch(hex).L, Cx: cx });

  // A small canvas filled per pixel. For each logical point x, y, fn writes
  // r, g, b and a into out. Draw it scaled with drawField.
  function field(cols, rows, x0, y0, w, h, fn) {
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const g = c.getContext('2d'), img = g.createImageData(cols, rows), d = img.data, o = [0, 0, 0, 0];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      fn(x0 + (i + .5) / cols * w, y0 + (j + .5) / rows * h, o);
      const k = (j * cols + i) * 4;
      d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3];
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function drawField(ctx, c, x0 = 0, y0 = 0, w = W, h = H) {
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(c, x0, y0, w, h);
    ctx.restore();
  }

  // Keeps the part of a convex polygon on the near side of the line through
  // the point mx, my with the normal nx, ny.
  function clipHalf(pts, mx, my, nx, ny) {
    const out = [], side = p => (p[0] - mx) * nx + (p[1] - my) * ny;
    for (let k = 0; k < pts.length; k++) {
      const a = pts[k], b = pts[(k + 1) % pts.length], da = side(a), db = side(b);
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  // Voronoi cells of a jittered grid over a box. drop removes a share of the
  // seeds, so the cells vary in size. Each cell has its center x, y, its
  // polygon pts and a random value v.
  function voronoi(r, x0, y0, x1, y1, size, jitter = .9, drop = 0) {
    const cols = Math.ceil((x1 - x0) / size) + 5, rows = Math.ceil((y1 - y0) / size) + 5, seeds = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const x = x0 + (i - 2 + .5 + (r() - .5) * jitter) * size, y = y0 + (j - 2 + .5 + (r() - .5) * jitter) * size;
      seeds.push(r() < drop ? null : [x, y]);
    }
    const cells = [], reach = drop > 0 ? 3 : 2;
    for (let j = 2; j < rows - 2; j++) for (let i = 2; i < cols - 2; i++) {
      const s = seeds[j * cols + i];
      if (!s) continue;
      const [px, py] = s, m = size * (reach + 1);
      let pts = [[px - m, py - m], [px + m, py - m], [px + m, py + m], [px - m, py + m]];
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const ii = i + di, jj = j + dj;
        if ((!di && !dj) || ii < 0 || jj < 0 || ii >= cols || jj >= rows || !seeds[jj * cols + ii]) continue;
        const [qx, qy] = seeds[jj * cols + ii];
        pts = clipHalf(pts, (px + qx) / 2, (py + qy) / 2, qx - px, qy - py);
      }
      cells.push({ x: px, y: py, pts, v: r() });
    }
    return cells;
  }
  // A rounded shape inside a cell, pulled toward its center by k. warp can
  // move each point a little, so the shapes lose their straight sides.
  function cellBlob(ctx, c, k, cut = .27, warp) {
    const pts = [];
    for (let i = 0; i < c.pts.length; i++) {
      const a = c.pts[i], b = c.pts[(i + 1) % c.pts.length];
      pts.push([c.x + (lerp(a[0], b[0], cut) - c.x) * k, c.y + (lerp(a[1], b[1], cut) - c.y) * k]);
      pts.push([c.x + (lerp(a[0], b[0], 1 - cut) - c.x) * k, c.y + (lerp(a[1], b[1], 1 - cut) - c.y) * k]);
    }
    if (warp) pts.forEach(p => { const [dx, dy] = warp(p[0], p[1]); p[0] += dx; p[1] += dy; });
    smoothPath(ctx, pts, true);
  }
  // Caustic light: the bright gaps between rounded cells, on a new layer.
  function causticLayer(cells, k, color) {
    const [c, x] = layer();
    x.fillStyle = color; x.fillRect(0, 0, W, H);
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); cells.forEach(cell => cellBlob(x, cell, k + (cell.v - .5) * .05)); x.fill();
    return c;
  }
  // Lace foam on the context x. dens gives the foam from 0 to 1 at the center
  // of each cell. A cell with more foam keeps a smaller hole, so the strands
  // get thicker.
  function lace(x, cells, dens, color, r, warp) {
    const kept = [];
    x.fillStyle = color;
    x.beginPath();
    for (const c of cells) {
      const d = dens(c.x, c.y);
      if (d <= 0) continue;
      kept.push([c, Math.min(1, d)]);
      cellBlob(x, c, 1.14, .2, warp);
    }
    x.fill();
    x.save();
    x.globalCompositeOperation = 'destination-out';
    x.beginPath();
    for (const [c, d0] of kept) {
      const d = d0 + (c.v - .5) * .6;
      if (d > .97) continue;
      cellBlob(x, c, lerp(.92, .32, clamp(d, 0, 1) ** 1.1), .4, warp);
      // Small bubbles in the dense foam.
      if (d > .4) for (let i = 0; i < 4; i++) {
        const a = r() * TAU, s = Math.sqrt(r()) * .75;
        const px = c.x + Math.cos(a) * s * (c.pts[0][0] - c.x), py = c.y + Math.sin(a) * s * (c.pts[0][1] - c.y);
        circle(x, px, py, .6 + r() ** 2 * 2.6);
      }
    }
    x.fill();
    x.restore();
  }
  // A warp for cellBlob from 2 noise fields.
  const warper = (n, scale, amp) => (x, y) => [n(x / scale, y / scale) * amp, n(x / scale + 31.7, y / scale + 17.3) * amp];

  // Many small dots in one path, for sand, specks and particles.
  function dots(ctx, r, count, area, rad, fill, mask) {
    const [x0, y0, x1, y1] = area;
    ctx.fillStyle = fill;
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const x = lerp(x0, x1, r()), y = lerp(y0, y1, r());
      if (mask && !mask(x, y)) continue;
      circle(ctx, x, y, rad[0] + (rad[1] - rad[0]) * r() ** 2);
    }
    ctx.fill();
  }

  // A closed outline of a blob: an ellipse with a noisy radius.
  function pebblePts(n, x, y, rad, elong, rot, seed, count = 10, wob = .16) {
    const pts = [];
    for (let i = 0; i < count; i++) {
      const a = i / count * TAU, w = 1 + n(seed + Math.cos(a) * .8, seed * .7 + Math.sin(a) * .8) * wob;
      const px = Math.cos(a) * rad * elong * w, py = Math.sin(a) * rad / elong * w;
      pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
    return pts;
  }
  // The outline of a worn shard: a few corners, rounded off.
  function shardPts(r, x, y, rad, elong, rot) {
    const k = 5 + Math.floor(r() * 4), a0 = r() * TAU, pts = [];
    for (let i = 0; i < k; i++) {
      const a = a0 + (i + (r() - .5) * .55) / k * TAU, d = rad * rr(r, .8, 1.12);
      const px = Math.cos(a) * d * elong, py = Math.sin(a) * d / elong;
      pts.push([x + px * Math.cos(rot) - py * Math.sin(rot), y + px * Math.sin(rot) + py * Math.cos(rot)]);
    }
    return pts;
  }
  // A soft shadow of a path only, with no fill of the path itself.
  function softShadow(ctx, path, dx, dy, blur, color) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur * S;
    ctx.shadowOffsetX = (dx + 5000) * S; ctx.shadowOffsetY = dy * S;
    ctx.translate(-5000, 0);
    ctx.fillStyle = '#000';
    ctx.fill(path);
    ctx.restore();
  }

  // Copies a reflection layer onto ctx between y0 and y1 in thin strips. Each
  // strip moves sideways a little, as on a rippled surface. alpha gets t, from
  // 0 at y0 to 1 at y1, and returns the opacity.
  function rippleCopy(ctx, src, y0, y1, n, amp, alpha, freq = .09) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let y = y0;
    while (y < y1) {
      const t = (y - y0) / (y1 - y0), h = 1 + t * 3.5;
      const dx = (n(y * freq, 1.3) * .75 + Math.sin(y * .7) * .25) * amp * (.25 + t);
      const sy = Math.floor(y * S), sh = Math.max(1, Math.floor((y + h) * S) - sy);
      ctx.globalAlpha = clamp(alpha(t), 0, 1);
      ctx.drawImage(src, 0, sy, src.width, sh, Math.round(dx * S), sy, src.width, sh);
      y += h;
    }
    ctx.restore();
  }

  // Short wave marks on a sea seen from the side: a dark lower face and a
  // light upper face, larger toward the viewer. Noise n leaves calm patches.
  // glow can give 0 to 1 at a point for a path of sun on the water. The marks
  // in that path come back as a Path2D for the caller to fill.
  function chop(ctx, r, n, hor, dark, light, glow, density = 1, x0 = 0, x1 = W) {
    const darkA = new Path2D(), darkB = new Path2D(), lightP = new Path2D(), sunP = new Path2D();
    for (let y = hor + 1.2; y < H + 12;) {
      const t = (y - hor) / (H - hor), len = 4 + t * 64, th = .4 + t * 3.4;
      const count = Math.round((x1 - x0) / len * 1.1 * density);
      for (let i = 0; i < count; i++) {
        const x = lerp(x0, x1, r()), yy = y + (r() - .5) * th * 2;
        const calm = n(x / (90 + t * 300), yy / (14 + t * 60)) * .5 + .5;
        if (calm < .3 + r() * .35) continue;
        const l = len * (.35 + r() * .9), w = th * (.45 + r() * .5);
        const d = r() < .5 ? darkA : darkB;
        d.moveTo(x + l, yy); d.ellipse(x, yy, l, w, 0, 0, TAU);
        const g = glow ? glow(x, yy) : 0;
        const p = g > r() ? sunP : lightP;
        if (r() < .6 || p === sunP) { const ly = yy - w * 1.25, ll = l * .62; p.moveTo(x + ll, ly); p.ellipse(x - l * .12, ly, ll, w * .45, 0, 0, TAU); }
      }
      y += th * 1.7;
    }
    ctx.save();
    ctx.fillStyle = dark; ctx.globalAlpha = 1; ctx.fill(darkA);
    ctx.globalAlpha = .55; ctx.fill(darkB);
    ctx.globalAlpha = 1; ctx.fillStyle = light; ctx.fill(lightP);
    ctx.restore();
    return sunP;
  }

  // A cumulus cloud on ctx: puffs over a flat base at y. top and base are the
  // colors at the top of the cloud and at its base.
  function cumulus(ctx, r, x, y, w, h, top, base) {
    const path = new Path2D(), k = 7 + Math.floor(r() * 6);
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1), px = x + (t - .5) * w * .9 + (r() - .5) * w * .08;
      const rad = (Math.sin(t * Math.PI) * .7 + .3) * h * rr(r, .45, .7);
      path.moveTo(px + rad, y - rad * .55); path.arc(px, y - rad * .55, rad, 0, TAU);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(x - w, y - h * 2, w * 2, h * 2); ctx.clip();
    ctx.fillStyle = linear(ctx, 0, y - h * 1.1, 0, y, [[0, top], [.65, mixHex(top, base, .4)], [1, base]]);
    ctx.fill(path);
    ctx.restore();
  }

  // A sailboat with its waterline center at x, y, facing right when dir is 1.
  // s = 1 gives a mast of 300 units. o holds the colors: hull, main, jib,
  // spin for a spinnaker or null, rig, and lit, the side the light comes from.
  function sailboat(ctx, o) {
    const { x, y, s, dir = 1, heel = 0 } = o;
    ctx.save();
    ctx.translate(x, y);
    if (o.mirror) ctx.scale(1, -1);
    ctx.scale(s * dir, s);
    const shade = (c, k) => tone(c, clamp(toOklch(c).L + k, 0, 1));
    // The rig leans with the heel. The hull tips only a little.
    ctx.save();
    ctx.rotate(heel * .12);
    ctx.beginPath();
    ctx.moveTo(-74, 1); ctx.lineTo(-79, -13); ctx.quadraticCurveTo(0, -10, 84, -19); ctx.quadraticCurveTo(77, -8, 66, 2); ctx.closePath();
    ctx.fillStyle = linear(ctx, 0, -19, 0, 2, [[0, shade(o.hull, .06)], [.55, o.hull], [1, shade(o.hull, -.12)]]);
    ctx.fill();
    ctx.strokeStyle = o.stripe || shade(o.hull, -.25); ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-77, -9); ctx.quadraticCurveTo(0, -6.5, 80, -14); ctx.stroke();
    // Crew on the rail.
    if (o.crew) {
      ctx.fillStyle = o.crew;
      for (let i = 0; i < 4; i++) { ctx.beginPath(); circle(ctx, -40 + i * 13, -18 - (i % 2), 4.2); ctx.fill(); ctx.fillRect(-44 + i * 13, -16, 8, 6); }
    }
    ctx.restore();
    ctx.save();
    ctx.translate(4, -12);
    ctx.rotate(heel);
    // Mainsail with a curved leech and a few seams.
    const main = new Path2D();
    main.moveTo(0, -8); main.lineTo(0, -292); main.quadraticCurveTo(-40, -150, -72, -16); main.quadraticCurveTo(-34, -6, 0, -8);
    ctx.fillStyle = linear(ctx, 0, 0, -72, 0, [[0, shade(o.main, o.lit > 0 ? -.08 : .05)], [.6, o.main], [1, shade(o.main, o.lit > 0 ? .07 : -.1)]]);
    ctx.fill(main);
    ctx.save(); ctx.clip(main);
    ctx.strokeStyle = rgba(shade(o.main, -.2), .35); ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let k = 1; k < 6; k++) { const yy = -8 - k * 48; ctx.moveTo(0, yy); ctx.lineTo(-80, yy + 14); }
    ctx.stroke();
    ctx.restore();
    // Jib on the forestay.
    if (o.jib) {
      const jib = new Path2D();
      jib.moveTo(78, -6); jib.lineTo(2, -238); jib.quadraticCurveTo(26, -120, 24, -12); jib.quadraticCurveTo(50, -2, 78, -6);
      ctx.fillStyle = linear(ctx, 78, 0, 10, 0, [[0, shade(o.jib, .06)], [1, shade(o.jib, -.08)]]);
      ctx.fill(jib);
    }
    // Spinnaker, full of wind in front of the boat.
    if (o.spin) {
      const sp = new Path2D();
      sp.moveTo(4, -282); sp.bezierCurveTo(150, -290, 196, -110, 128, -30); sp.quadraticCurveTo(84, -10, 40, -40); sp.bezierCurveTo(78, -120, 50, -230, 4, -282);
      ctx.fillStyle = radial(ctx, 70, -170, 10, 170, [[0, shade(o.spin, .08)], [.7, o.spin], [1, shade(o.spin, -.14)]]);
      ctx.fill(sp);
      if (o.spin2) {
        ctx.save(); ctx.clip(sp);
        ctx.fillStyle = o.spin2;
        ctx.beginPath(); ctx.moveTo(0, -200); ctx.bezierCurveTo(80, -220, 140, -170, 200, -120); ctx.lineTo(200, -90); ctx.bezierCurveTo(140, -140, 80, -186, 0, -170); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
    ctx.strokeStyle = o.rig; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -296); ctx.stroke();
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, -290); ctx.lineTo(80, -4); ctx.stroke();
    ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-74, -14); ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ---------- water/sea-glass ----------

  // Frosted sea glass on a beach, with the lace foam of a wave at the top left.
  scene('water', 'sea-glass', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r)), n3 = makeNoise(seedOf(r));
    const ph = r() * TAU;
    // The y of the foam edge at x. The sea lies above it.
    const front = x => 330 - (x - 960) * .16 + Math.sin(x / 260 + ph) * 22 + fbm(n1, x / 420, .5, 3) * 50;

    const sand = night ? tone(mixHex(P.dark_foreground, P.blue, .25), .34, .75) : P.background;
    const sandLo = night ? tone(sand, .28) : mixHex(P.darker_background, P.yellow, .08);
    const sandHi = night ? tone(sand, .44) : mixHex(P.background, '#ffffff', .65);
    const wet = night ? tone(mixHex(sand, P.blue, .35), .27, .9) : tone(mixHex(P.darker_background, P.yellow, .12), .77, 1.3);
    const deep = night ? tone(P.blue, .26, .8) : tone(P.blue, .58, .9);
    const shallow = night ? tone(P.cyan, .45, .7) : tone(P.cyan, .86, .75);
    const foam = night ? tone(P.bright_cyan, .92, .45) : '#ffffff';
    const shade = night ? '#000000' : tone(P.yellow, .45, .6);
    const glint = night ? tone(P.bright_cyan, .95, .3) : '#ffffff';

    // Dry sand with large soft patches.
    ctx.fillStyle = linear(ctx, 0, 0, W, H, [[0, sand], [.6, mixHex(sand, sandHi, .2)], [1, mixHex(sand, sandLo, .25)]]);
    ctx.fillRect(0, 0, W, H);
    if (night) {
      ctx.fillStyle = radial(ctx, 1350, 120, 0, 1400, [[0, rgba(sandHi, .7)], [.5, rgba(sandHi, .2)], [1, rgba(sandLo, .3)]]);
      ctx.fillRect(0, 0, W, H);
    }
    const [sr, sg, sb] = rgb(sandLo), [hr, hg, hb] = rgb(sandHi);
    drawField(ctx, field(240, 135, 0, 0, W, H, (x, y, o) => {
      const v = fbm(n2, x / 260, y / 260, 4);
      if (v > 0) { o[0] = hr; o[1] = hg; o[2] = hb; } else { o[0] = sr; o[1] = sg; o[2] = sb; }
      o[3] = Math.min(255, Math.abs(v) * (night ? 130 : 160));
    }));

    // Wet sand behind the swash: darker, with a gloss right at the edge.
    const [wr, wg, wb] = rgb(wet);
    const wetW = x => 170 + fbm(n3, x / 260, 1, 3) * 90;
    drawField(ctx, field(320, 180, 0, 0, W, H, (x, y, o) => {
      const t = (y - front(x)) / wetW(x);
      o[0] = wr; o[1] = wg; o[2] = wb;
      o[3] = t < 0 ? 255 : 255 * clamp(1 - t, 0, 1) ** 1.4 * .92;
    }));

    // Sand grains.
    dots(ctx, r, 18000, [0, 0, W, H], [.4, 1.3], rgba(sandLo, night ? .5 : .45));
    dots(ctx, r, 10000, [0, 0, W, H], [.4, 1.1], rgba(sandHi, night ? .3 : .85));
    dots(ctx, r, 1600, [0, 0, W, H], [.5, 1.5], rgba(mixHex(P.red, sand, .4), night ? .25 : .3));
    dots(ctx, r, 900, [0, 0, W, H], [.6, 1.6], rgba(mixHex(P.cyan, sand, .3), .3));

    // Old swash lines: thin trails of tiny bubbles on the wet sand.
    for (const [off, a] of [[120, .7], [205, .45]]) {
      ctx.fillStyle = rgba(foam, a * (night ? .55 : .8));
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += 1.6) {
        const y = front(x) + off + fbm(n2, x / 130, off, 3) * 26, k = fbm(n3, x / 70, off, 2);
        if (r() > .35 + k) continue;
        circle(ctx, x, y + (r() - .5) * 5 * (1 + k), .5 + r() ** 3 * 1.6);
      }
      ctx.fill();
    }

    // The sea: deeper toward the top left, clear over the sand at the edge.
    const [dr, dg, db] = rgb(deep), [lr, lg, lb] = rgb(shallow), [gr, gg, gb] = rgb(glint);
    const depth = (x, y) => {
      const d = front(x) - y;
      return d <= 0 ? 0 : clamp(d / 330 + fbm(n3, x / 300, y / 300, 3) * .22, 0, 1);
    };
    drawField(ctx, field(384, 216, 0, 0, W, H, (x, y, o) => {
      const d = front(x) - y, t = depth(x, y);
      // Long soft swells along the shore.
      const swell = Math.max(0, Math.sin(d / 46 + fbm(n2, x / 400, y / 400, 2) * 3)) ** 3 * .22 * clamp(d / 60, 0, 1);
      o[0] = lerp(lerp(lr, dr, t), gr, swell); o[1] = lerp(lerp(lg, dg, t), gg, swell); o[2] = lerp(lerp(lb, db, t), gb, swell);
      o[3] = d <= -2 ? 0 : 255 * clamp(.3 + t * .85, 0, 1) * clamp((d + 2) / 8, 0, 1);
    }));

    // Caustic light on the sand under the shallow water.
    const caus = causticLayer(voronoi(r, -40, -40, W * .9, 640, 30, .9, .2), .9, night ? tone(P.bright_cyan, .85, .6) : '#ffffff');
    {
      const [mc, mx] = layer();
      mx.drawImage(caus, 0, 0, W, H);
      mx.globalCompositeOperation = 'destination-in';
      drawField(mx, field(192, 108, 0, 0, W, H, (x, y, o) => { const d = front(x) - y; o[3] = d < 6 ? 0 : 255 * clamp(1 - depth(x, y) * 2.2, 0, 1) * clamp((d - 6) / 30, 0, 1); }));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = night ? .22 : .4; ctx.globalCompositeOperation = night ? 'lighter' : 'screen';
      ctx.drawImage(mc, 0, 0);
      ctx.restore();
    }

    // Glints on the water.
    ctx.fillStyle = rgba(glint, night ? .55 : .9);
    ctx.beginPath();
    for (let i = 0; i < 700; i++) {
      const x = r() * W, y = r() * 520, d = front(x) - y;
      if (d < 40 || fbm(n2, x / 150, y / 150, 2) < .1) continue;
      ellipse(ctx, x, y, .8 + r() * 2.6, .5 + r() * .6, -.16);
    }
    ctx.fill();

    // Lace foam behind the edge: open and fading further out, dense at the
    // edge of the wave.
    {
      const warp = warper(n3, 36, 4);
      const back = x => 110 + fbm(n1, x / 230, 9, 3) * 90;
      const [bc, bx] = layer();
      lace(bx, voronoi(r, -20, -60, W + 20, 640, 28, .95, .3), (x, y) => {
        const d = front(x) - y, b = back(x);
        if (d < 20 || d > b + 150) return 0;
        return .55 - (d - 20) / b * .3 + fbm(n3, x / 140, y / 140, 3) * 1.1;
      }, foam, r, warp);
      bx.globalCompositeOperation = 'destination-in';
      drawField(bx, field(240, 135, 0, 0, W, H, (x, y, o) => {
        const d = front(x) - y, b = back(x);
        o[3] = 255 * clamp(1 - (d - 30) / (b + 150), 0, 1) ** .8;
      }));
      const [fc, fx] = layer();
      lace(fx, voronoi(r, -20, -60, W + 20, 640, 14, .95, .25), (x, y) => {
        const d = front(x) - y;
        if (d < -1) return 0;
        return 1.1 - d / 55 + fbm(n2, x / 80, y / 80, 2) * .6;
      }, foam, r, warp);
      // The thick edge of the wave.
      fx.beginPath();
      const top = [], bot = [];
      for (let x = -20; x <= W + 20; x += 8) {
        const y = front(x), w = 3 + (fbm(n2, x / 50, 4, 3) * .5 + .5) * 12;
        top.push([x, y - w]); bot.push([x, y + 1.5 + Math.abs(fbm(n3, x / 30, 2, 2)) * 5]);
      }
      smoothPath(fx, [...top, ...bot.reverse()], true);
      fx.fillStyle = foam; fx.fill();
      // Bubbles along the edge.
      fx.beginPath();
      for (let x = -10; x <= W + 10; x += 2.2) if (r() < .5) circle(fx, x, front(x) + 4 + r() * 9, .5 + r() ** 2 * 2.4);
      fx.fill();
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.shadowColor = rgba(night ? '#000000' : tone(P.blue, .4), night ? .6 : .28);
      ctx.shadowBlur = 5 * S; ctx.shadowOffsetX = 3 * S; ctx.shadowOffsetY = 4.5 * S;
      ctx.globalAlpha = night ? .5 : .72;
      ctx.filter = blurPx(.7);
      ctx.drawImage(bc, 0, 0);
      ctx.filter = 'none';
      ctx.globalAlpha = night ? .78 : .97;
      ctx.drawImage(fc, 0, 0);
      ctx.restore();
      if (night) bloom(ctx, x => x.drawImage(fc, 0, 0, W, H), [14], [.35]);
    }

    // The sea glass. Most pieces lie along the wash line and toward the corners.
    const base = [P.blue, P.green, P.cyan, P.blue, P.green, P.cyan, P.blue, P.magenta, P.yellow, P.green, P.red];
    const cols = base.map(c => night ? tone(c, .64, .8) : tone(c, .8, .72));
    const frost = document.createElement('canvas');
    frost.width = frost.height = 128;
    {
      const g = frost.getContext('2d'), img = g.createImageData(128, 128), fr = rng(seedOf(r));
      for (let i = 0; i < img.data.length; i += 4) { const v = fr() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      g.putImageData(img, 0, 0);
    }
    const frostPat = ctx.createPattern(frost, 'repeat');
    const spots = [];
    for (let tries = 0; spots.length < 46 && tries < 4000; tries++) {
      const band = r() < .5;
      const x = rr(r, -30, W + 30);
      const y = band ? front(x) + rr(r, 40, 250) : rr(r, 300, H + 30);
      if (y < front(x) + 30) continue;
      // A calm middle: few pieces near the center of the frame.
      const cx = Math.abs(x - W * .5) / (W * .5), cy = Math.abs(y - H * .62) / (H * .42);
      if (Math.max(cx, cy) < .6 && r() < .9) continue;
      const rad = (band ? rr(r, 13, 30) : rr(r, 18, 48)) * (r() < .1 ? 1.45 : 1);
      if (spots.some(([sx, sy, s2]) => Math.hypot(sx - x, sy - y) < s2 + rad + 10)) continue;
      spots.push([x, y, rad]);
    }
    spots.sort((a, b) => a[1] - b[1]);
    for (const [x, y, rad] of spots) {
      const col = pick(r, cols);
      const pts = shardPts(r, x, y, rad, rr(r, 1, 1.5), r() * TAU);
      const path = new Path2D(); smoothPath(path, pts, true);
      // The shadow, and the light that the glass bends onto the sand.
      softShadow(ctx, path, rad * .16, rad * .22, rad * .3, rgba(shade, night ? .6 : .3));
      ctx.save();
      ctx.globalCompositeOperation = night ? 'lighter' : 'screen';
      const gx = x + rad * .4, gy = y + rad * .5;
      ctx.fillStyle = radial(ctx, gx, gy, 0, rad * .62, [[0, rgba(tone(col, .9, 1.2), night ? .3 : .75)], [1, rgba(col, 0)]]);
      ctx.beginPath(); circle(ctx, gx, gy, rad * .62); ctx.fill();
      ctx.restore();
      // The frosted body: milky in the middle, deeper at the edge.
      ctx.save();
      ctx.clip(path);
      ctx.fillStyle = radial(ctx, x - rad * .2, y - rad * .25, rad * .05, rad * 1.35, [
        [0, rgba(mixHex(col, '#ffffff', night ? .25 : .45), night ? .82 : .86)],
        [.6, rgba(col, night ? .78 : .8)],
        [1, rgba(tone(col, toOklch(col).L - .14, 1.35), .95)]]);
      ctx.fill(path);
      ctx.globalAlpha = night ? .1 : .13; ctx.globalCompositeOperation = 'overlay';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = frostPat; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      // Light leaves the glass at the far edge.
      ctx.translate(-rad * .08, -rad * .1);
      ctx.strokeStyle = rgba(tone(col, .95, .8), night ? .35 : .55); ctx.lineWidth = rad * .14;
      ctx.filter = blurPx(rad * .05);
      ctx.stroke(path);
      ctx.restore();
      // A broad soft sheen.
      ctx.save();
      ctx.translate(x - rad * .25, y - rad * .3); ctx.rotate(-.5); ctx.scale(1, .55);
      ctx.fillStyle = radial(ctx, 0, 0, 0, rad * .55, [[0, rgba('#ffffff', night ? .3 : .45)], [1, rgba('#ffffff', 0)]]);
      ctx.beginPath(); circle(ctx, 0, 0, rad * .55); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = rgba(tone(col, night ? .32 : .5, 1.2), night ? .55 : .4); ctx.lineWidth = .9;
      ctx.stroke(path);
    }

    if (night) {
      // Moonlight on the wet sand and the water.
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 1300, 200, 0, 900, [[0, rgba(P.bright_cyan, .24)], [.45, rgba(P.bright_cyan, .08)], [1, rgba(P.bright_cyan, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'soft-light';
      ctx.fillStyle = radial(ctx, 1500, 200, 0, 1100, [[0, rgba('#ffffff', .35)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/sea-foam ----------

  // Lace foam over shallow aqua water seen from above, with the shore in the
  // lower right corner. Every color is an aqua of the palette.
  scene('water', 'sea-foam', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r)), n3 = makeNoise(seedOf(r));
    // u runs toward the shore, v along it.
    const a = .52, ca = Math.cos(a), sa = Math.sin(a);
    const U = (x, y) => x * ca + y * sa, V = (x, y) => -x * sa + y * ca;
    const wob = (v, k) => Math.sin(v / 210 + k * 2.1) * 26 + fbm(n1, v / 380, k * 3.3, 3) * 70;
    const shore = v => 1590 + wob(v, 0) * .8;
    const crests = [1350, 1010].map((u, k) => v => u + wob(v, k + 1) * (1 + k * .4));
    const trail = [140, 230, 330];

    const deep = night ? tone(P.blue, .23, .85) : tone(P.blue, .52, .95);
    const mid = night ? tone(P.green, .33, .8) : tone(P.green, .7, .85);
    const shallow = night ? tone(P.yellow, .47, .7) : tone(P.yellow, .87, .65);
    const sand = night ? tone(P.cyan, .42, .75) : tone(P.background, .95, 1.4);
    const foam = night ? tone(P.bright_cyan, .93, .5) : '#ffffff';
    const shadowCol = night ? '#000000' : tone(P.blue, .4, .9);

    // Water from deep to shallow, with sand ripples seen through the shallows.
    const [d1, d2, d3] = rgb(deep), [m1, m2, m3] = rgb(mid), [s1, s2, s3] = rgb(shallow), [a1, a2, a3] = rgb(sand);
    drawField(ctx, field(480, 270, 0, 0, W, H, (x, y, o) => {
      const u = U(x, y), v = V(x, y), sh = shore(v);
      const t = clamp((u - 350) / (sh - 350) + fbm(n2, x / 420, y / 420, 3) * .18, 0, 1);
      let c1, c2, c3;
      if (t < .55) { const k = smooth(t / .55); c1 = lerp(d1, m1, k); c2 = lerp(d2, m2, k); c3 = lerp(d3, m3, k); } else { const k = smooth((t - .55) / .45); c1 = lerp(m1, s1, k); c2 = lerp(m2, s2, k); c3 = lerp(m3, s3, k); }
      // Long swells in the deep water.
      const sw = Math.max(0, Math.sin((u + fbm(n3, x / 300, y / 300, 2) * 160) / 34)) ** 4 * .12 * (1 - t);
      c1 = lerp(c1, s1, sw); c2 = lerp(c2, s2, sw); c3 = lerp(c3, s3, sw);
      const rip = Math.sin((u + fbm(n3, x / 160, y / 160, 2) * 40) / 9) * .5 + .5;
      const rk = clamp((t - .6) * 2.2, 0, 1) * rip * .16;
      c1 = lerp(c1, a1, rk); c2 = lerp(c2, a2, rk); c3 = lerp(c3, a3, rk);
      // The beach.
      const b = clamp((u - sh) / 8 + .5, 0, 1);
      o[0] = lerp(c1, a1, b); o[1] = lerp(c2, a2, b); o[2] = lerp(c3, a3, b); o[3] = 255;
    }));

    // Wet and dry sand.
    const wetC = night ? tone(P.cyan, .4, .45) : tone(P.cyan, .84, .5);
    const [w1, w2, w3] = rgb(wetC);
    drawField(ctx, field(320, 180, 0, 0, W, H, (x, y, o) => {
      const u = U(x, y), v = V(x, y), d = u - shore(v);
      o[0] = w1; o[1] = w2; o[2] = w3;
      o[3] = d < 0 ? 0 : 255 * clamp(1 - d / (90 + fbm(n2, v / 200, 3, 2) * 50), 0, 1) ** 1.2 * clamp(d / 4, 0, 1);
    }));
    dots(ctx, r, 9000, [0, 0, W, H], [.4, 1.2], rgba(tone(sand, night ? .42 : .82), .45), (x, y) => U(x, y) > shore(V(x, y)) + 3);
    dots(ctx, r, 5000, [0, 0, W, H], [.4, 1.1], rgba(tone(sand, night ? .62 : .99), .7), (x, y) => U(x, y) > shore(V(x, y)) + 3);

    // Caustics in the shallows.
    {
      const caus = causticLayer(voronoi(r, -40, -40, W + 40, H + 40, 34, .9, .2), .9, night ? tone(P.bright_cyan, .85, .6) : '#ffffff');
      const [mc, mx] = layer();
      mx.drawImage(caus, 0, 0, W, H);
      mx.globalCompositeOperation = 'destination-in';
      drawField(mx, field(192, 108, 0, 0, W, H, (x, y, o) => {
        const u = U(x, y), sh = shore(V(x, y));
        o[3] = 255 * clamp((u - sh + 520) / 400, 0, 1) * clamp((sh - u) / 30, 0, 1);
      }));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = night ? .22 : .38; ctx.globalCompositeOperation = night ? 'lighter' : 'screen';
      ctx.drawImage(mc, 0, 0);
      ctx.restore();
    }

    // Foam: a dense crest on each wave, lace trailing behind it toward the
    // sea, and the swash on the sand.
    const warp = warper(n3, 40, 5);
    const fronts = [shore, ...crests];
    const near = (x, y) => {
      const u = U(x, y), v = V(x, y);
      let best = 1e9, k0 = 0;
      fronts.forEach((f, k) => { const d = f(v) - u; if (d > -2 && d < best) { best = d; k0 = k; } });
      return [best, k0, v];
    };
    const [bc, bx] = layer();
    lace(bx, voronoi(r, -20, -20, W + 20, H + 20, 30, .95, .3), (x, y) => {
      const [d, k, v] = near(x, y), len = trail[k] + fbm(n2, v / 260, k, 2) * 110;
      if (d < 18 || d > len) return 0;
      return .6 - d / len * .6 + fbm(n3, x / 150, y / 150, 3) * 1.2 - k * .08;
    }, foam, r, warp);
    // Marbled streaks of old foam between the waves.
    lace(bx, voronoi(r, -20, -20, W + 20, H + 20, 22, .95, .3), (x, y) => {
      const u = U(x, y), sh = shore(V(x, y));
      if (u > sh - 20 || u < 650) return 0;
      const m = 1 - Math.abs(fbm(n1, x / 340 + fbm(n2, x / 300, y / 300, 2) * .8, y / 340, 3)) * 9;
      return m * .55 * clamp((u - 650) / 250, 0, 1);
    }, foam, r, warp);
    bx.globalCompositeOperation = 'destination-in';
    drawField(bx, field(240, 135, 0, 0, W, H, (x, y, o) => {
      const [d, k, v] = near(x, y), len = trail[k] + fbm(n2, v / 260, k, 2) * 110;
      o[3] = 255 * clamp(.4 + (1 - d / len) * .6, .4, 1);
    }));
    const [fc, fx] = layer();
    lace(fx, voronoi(r, -20, -20, W + 20, H + 20, 13, .95, .25), (x, y) => {
      const [d, k] = near(x, y);
      if (d < -1) return 0;
      return 1.15 - d / (k === 0 ? 45 : 60) + fbm(n2, x / 70, y / 70, 2) * .6;
    }, foam, r, warp);
    // The rolled edge of each crest.
    fx.fillStyle = foam;
    for (const [k, f] of fronts.entries()) {
      const top = [], bot = [];
      for (let v = -1400; v <= 1700; v += 10) {
        const u = f(v), w = (k === 0 ? 3 : 5) + (fbm(n2, v / 50, 4 + k, 3) * .5 + .5) * (k === 0 ? 10 : 15);
        const p = (uu) => [uu * ca - v * sa, uu * sa + v * ca];
        top.push(p(u - w)); bot.push(p(u + 1 + Math.abs(fbm(n3, v / 30, k, 2)) * 5));
      }
      fx.beginPath(); smoothPath(fx, [...top, ...bot.reverse()], true); fx.fill();
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Shadows of the foam on the bottom, seen through the water.
    ctx.shadowColor = rgba(shadowCol, night ? .55 : .3);
    ctx.shadowBlur = 7 * S; ctx.shadowOffsetX = 9 * S; ctx.shadowOffsetY = 12 * S;
    ctx.globalAlpha = night ? .55 : .8;
    ctx.drawImage(bc, 0, 0);
    ctx.globalAlpha = night ? .85 : 1;
    ctx.drawImage(fc, 0, 0);
    ctx.restore();
    if (night) bloom(ctx, x => x.drawImage(fc, 0, 0, W, H), [16], [.3]);

    // Glints on the water.
    ctx.fillStyle = rgba(night ? P.bright_cyan : '#ffffff', night ? .5 : .85);
    ctx.beginPath();
    for (let i = 0; i < 900; i++) {
      const x = r() * W, y = r() * H;
      if (U(x, y) > shore(V(x, y)) - 30 || fbm(n2, x / 160, y / 160, 2) < .12) continue;
      ellipse(ctx, x, y, .8 + r() * 2.4, .5 + r() * .5, -.5);
    }
    ctx.fill();

    // Moonlight or sunlight on the water.
    ctx.save(); ctx.globalCompositeOperation = night ? 'screen' : 'soft-light';
    ctx.fillStyle = radial(ctx, 520, 260, 0, 1000, night
      ? [[0, rgba(P.bright_cyan, .18)], [.5, rgba(P.bright_cyan, .05)], [1, rgba(P.bright_cyan, 0)]]
      : [[0, rgba('#ffffff', .4)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(0, 0, W, H); ctx.restore();
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/regatta ----------

  // Sailboats racing on a light chop, with navy and signal orange sails and
  // racing buoys. Night is a dusk with the sun on the horizon.
  scene('water', 'regatta', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const hor = 600, sunX = 1240;

    const navy = night ? tone(P.blue, .3, .9) : tone(P.blue, .36, 1.05);
    const orange = night ? tone(P.orange, .7, 1.1) : tone(P.orange, .67, 1.25);
    const signal = night ? tone(P.red, .62, 1.05) : tone(P.red, .6, 1.15);
    const cream = night ? tone(P.yellow, .82, .3) : mixHex(P.background, '#ffffff', .6);
    const haze = night ? tone(P.yellow, .78, .8) : mixHex(P.background, '#ffffff', .4);

    // Sky.
    if (night) {
      skyGradient(ctx, [[0, P.darker_background], [.3, P.background], [.48, mixHex(P.background, P.blue, .28)], [.62, mixHex(P.background, P.magenta, .45)], [.78, tone(P.red, .58, .95)], [hor / H, tone(P.orange, .8, 1)], [1, P.background]]);
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, sunX, hor, 0, 900, [[0, rgba(P.bright_yellow, .7)], [.2, rgba(P.orange, .35)], [.6, rgba(P.magenta, .08)], [1, rgba(P.magenta, 0)]]);
      ctx.fillRect(0, 0, W, hor);
      ctx.restore();
      ctx.fillStyle = radial(ctx, sunX, hor - 6, 0, 46, [[0, tone(P.bright_yellow, .97, .6)], [.8, tone(P.yellow, .9, 1)], [1, rgba(P.yellow, 0)]]);
      ctx.beginPath(); circle(ctx, sunX, hor - 6, 46); ctx.fill();
      stars(ctx, r, 140, [0, 0, W, hor * .45], [P.foreground, P.bright_cyan], 1.6);
    } else {
      skyGradient(ctx, [[0, tone(P.blue, .74, .55)], [.35, tone(P.blue, .86, .35)], [hor / H, haze], [1, haze]]);
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 420, 120, 0, 900, [[0, rgba('#ffffff', .55)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, hor); ctx.restore();
    }
    // Clouds low over the sea. At dusk the sun lights them from below.
    {
      const [cc, cx] = layer();
      const top = night ? mixHex(P.background, P.magenta, .45) : '#ffffff';
      const base = night ? tone(P.orange, .66, .9) : mixHex(haze, P.blue, .12);
      for (let i = 0; i < 7; i++) {
        const x = (i + .5) / 7 * W + rr(r, -90, 90), y = hor - rr(r, 70, 210), w = rr(r, 180, 380);
        cx.globalAlpha = rr(r, .5, .9);
        cumulus(cx, r, x, y, w, w * rr(r, .22, .32), top, base);
      }
      // A few thin, high clouds.
      for (let i = 0; i < 4; i++) {
        const x = rr(r, 100, W - 100), y = rr(r, 110, 300), w = rr(r, 260, 520);
        cx.globalAlpha = night ? .3 : .45;
        cx.fillStyle = night ? tone(P.magenta, .5, .7) : '#ffffff';
        for (let k = 0; k < 9; k++) { cx.beginPath(); ellipse(cx, x + (k / 8 - .5) * w, y + Math.sin(k * 1.3) * 6, w * rr(r, .1, .2), rr(r, 4, 10)); cx.fill(); }
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(night ? 6 : 3); ctx.globalAlpha = night ? .75 : .85; ctx.drawImage(cc, 0, 0); ctx.restore();
    }
    // A low headland on the horizon.
    {
      const pts = [];
      for (let x = -20; x <= 640; x += 10) pts.push([x, hor - 4 - Math.max(0, Math.sin(x / 640 * Math.PI)) * (34 + fbm(n1, x / 120, 3, 3) * 14) * fit(x, 0, 640, 1.4, .3)]);
      ctx.beginPath(); ctx.moveTo(-20, hor + 2); pts.forEach(p => ctx.lineTo(p[0], p[1])); ctx.lineTo(640, hor + 2); ctx.closePath();
      ctx.fillStyle = night ? mixHex(P.background, P.magenta, .25) : mixHex(haze, P.blue, .25);
      ctx.fill();
      ctx.fillStyle = night ? mixHex(P.background, P.magenta, .25) : mixHex(haze, P.blue, .3);
      ctx.fillRect(470, hor - 64, 7, 50); ctx.fillRect(467, hor - 68, 13, 6);
      if (night) { ctx.fillStyle = rgba(P.bright_yellow, .9); ctx.beginPath(); circle(ctx, 473.5, hor - 62, 2.2); ctx.fill(); }
    }

    // The sea, light at the horizon and deeper toward the viewer.
    const seaTop = night ? tone(P.orange, .66, .8) : tone(P.blue, .84, .45);
    const seaMid = night ? mixHex(P.background, P.magenta, .3) : tone(P.blue, .66, .75);
    const seaLow = night ? P.darker_background : tone(P.blue, .48, .9);
    ctx.fillStyle = linear(ctx, 0, hor, 0, H, [[0, seaTop], [.12, mixHex(seaTop, seaMid, .6)], [.45, seaMid], [1, seaLow]]);
    ctx.fillRect(0, hor, W, H - hor);
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, sunX, hor, 0, 520, [[0, rgba(P.orange, .55)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, hor, W, H - hor); ctx.restore();
    }

    // Boats from far to near. Each draws its reflection first.
    const boats = [];
    const far = [[120, .1], [300, .13], [690, .12], [820, .09], [1010, .15], [1480, .11], [1630, .14], [1820, .1]];
    far.forEach(([x, s0]) => boats.push({ x: x + rr(r, -30, 30), y: hor + 4 + s0 * 60, s: s0, far: true }));
    [[560, .42], [910, .3], [1420, .36], [1150, .24]].forEach(([x, s0]) => boats.push({ x, y: hor + 12 + s0 * 150, s: s0 }));
    boats.push({ x: 1660, y: 975, s: 1.5, big: true, dir: -1 });
    boats.push({ x: 290, y: 905, s: 1.3, big: true, spin: true });
    boats.sort((a, b) => a.y - b.y);
    const sails = [[navy, orange], [orange, cream], [cream, navy], [navy, cream], [signal, cream], [orange, navy]];
    const [rc, rx] = layer();
    const drawBoat = (b, c, mirror) => {
      const hz = b.far ? .55 : b.big ? 0 : .22;
      const fog = c => mixHex(c, night ? tone(P.magenta, .45, .6) : haze, hz);
      const [m, j] = b.pair;
      sailboat(c, {
        x: b.x, y: b.y, s: b.s, dir: b.dir || (b.x > W / 2 ? -1 : 1), heel: b.spin ? -.04 : -.16, mirror,
        hull: fog(b.hullC), main: fog(m), jib: b.spin ? null : fog(j), spin: b.spin ? fog(orange) : null, spin2: b.spin ? fog(navy) : null,
        rig: fog(night ? P.darker_background : tone(P.blue, .25, .5)), lit: 1, stripe: fog(b.big ? orange : navy),
        crew: b.big ? fog(night ? P.darker_background : tone(P.blue, .22, .6)) : null,
      });
    };
    boats.forEach((b, i) => { b.pair = b.big && !b.spin ? [orange, cream] : b.spin ? [navy, cream] : sails[i % sails.length]; b.hullC = i % 3 === 1 ? navy : cream; });
    boats.forEach(b => drawBoat(b, rx, true));
    rippleCopy(ctx, rc, hor, H, n2, 7, t => (night ? .55 : .5) * (1 - t * .5));

    // Chop, with the sun path at dusk.
    const glow = night ? (x, y) => Math.exp(-(((x - sunX) / (40 + (y - hor) * .55)) ** 2)) * .95 : null;
    const sunP = chop(ctx, r, n1, hor,
      rgba(night ? P.darker_background : tone(P.blue, .4, .9), night ? .5 : .3),
      rgba(night ? tone(P.magenta, .7, .8) : '#ffffff', night ? .28 : .42), glow);
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = rgba(P.bright_yellow, .8); ctx.fill(sunP);
      ctx.restore();
    }
    // Sparkles.
    ctx.fillStyle = rgba(night ? P.bright_yellow : '#ffffff', night ? .7 : .9);
    ctx.beginPath();
    for (let i = 0; i < 500; i++) {
      const x = r() * W, y = hor + 4 + r() ** 1.5 * (H - hor);
      if (night && Math.abs(x - sunX) > 60 + (y - hor) * .6) continue;
      ellipse(ctx, x, y, 1 + (y - hor) / 160 + r() * 2, .5 + (y - hor) / 500);
    }
    ctx.fill();

    // Buoys: inflatable racing marks with a white band.
    const buoy = (x, y, s, col) => {
      ctx.save(); ctx.translate(x, y); ctx.scale(s, s);
      ctx.fillStyle = rgba(night ? '#000000' : tone(P.blue, .3), .35);
      ctx.beginPath(); ellipse(ctx, 0, 2, 34, 6); ctx.fill();
      const body = new Path2D();
      body.moveTo(-22, 0); body.lineTo(-18, -62); body.quadraticCurveTo(0, -78, 18, -62); body.lineTo(22, 0); body.quadraticCurveTo(0, 6, -22, 0);
      ctx.fillStyle = linear(ctx, -22, 0, 22, 0, [[0, tone(col, toOklch(col).L + .08)], [.45, col], [1, tone(col, toOklch(col).L - .16)]]);
      ctx.fill(body);
      ctx.save(); ctx.clip(body); ctx.fillStyle = rgba(cream, .95); ctx.fillRect(-30, -40, 60, 10); ctx.restore();
      ctx.strokeStyle = rgba('#ffffff', .3); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-12, -60); ctx.lineTo(-15, -6); ctx.stroke();
      ctx.restore();
      // Reflection and a ring of ripples.
      ctx.save(); ctx.translate(x, y + 3); ctx.scale(s, -s * .8);
      ctx.globalAlpha = .35; ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-18, -62); ctx.quadraticCurveTo(0, -78, 18, -62); ctx.lineTo(22, 0); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = rgba(night ? P.bright_yellow : '#ffffff', .35); ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ellipse(ctx, x, y + 2, 44 * s, 7 * s); ctx.stroke();
    };
    buoy(1090, 700, .55, orange);
    buoy(760, 640, .3, orange);
    buoy(1830, 1010, 1.05, orange);

    // The boats themselves, with bow waves and wakes.
    for (const b of boats) {
      const dir = b.dir || (b.x > W / 2 ? -1 : 1);
      if (!b.far) {
        ctx.fillStyle = rgba(night ? '#000000' : tone(P.blue, .3), .3);
        ctx.beginPath(); ellipse(ctx, b.x, b.y + 3 * b.s, 90 * b.s, 6 * b.s); ctx.fill();
        // A wake of broken foam behind the stern.
        ctx.fillStyle = rgba(night ? tone(P.bright_yellow, .9, .5) : '#ffffff', .7);
        ctx.beginPath();
        for (let k = 0; k < 40; k++) {
          const t = k / 40, wx = b.x - dir * (70 + t * 260) * b.s, spread = t * 16 * b.s;
          for (const side of [-1, 1]) if (r() < .8 - t * .6) ellipse(ctx, wx + (r() - .5) * 8 * b.s, b.y + (3 + side * spread * .35 + spread * .5) * b.s / b.s, (5 + r() * 9) * b.s * (1 - t * .5), (1 + r()) * b.s * (1 - t * .5));
        }
        ctx.fill();
        ctx.fillStyle = rgba(night ? tone(P.bright_yellow, .9, .5) : '#ffffff', .85);
        ctx.beginPath(); ctx.moveTo(b.x + dir * 60 * b.s, b.y + 2 * b.s); ctx.quadraticCurveTo(b.x + dir * 82 * b.s, b.y - 12 * b.s, b.x + dir * 96 * b.s, b.y + 3 * b.s); ctx.quadraticCurveTo(b.x + dir * 80 * b.s, b.y + 6 * b.s, b.x + dir * 60 * b.s, b.y + 2 * b.s); ctx.fill();
      }
      drawBoat(b, ctx, false);
    }
    if (night) {
      // The low sun shines through the sails.
      bloom(ctx, x => { x.fillStyle = rgba(P.bright_yellow, .9); x.beginPath(); circle(x, sunX, hor - 6, 40); x.fill(); }, [120, 30], [.5, .6]);
    }
    vignette(ctx, P, night ? .45 : .12);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/pool ----------

  // A palm frond shadow: a curved rib with narrow leaflets on both sides.
  function frond(path, x, y, ang, len, droop, r, leaf = 1) {
    const ex = x + Math.cos(ang) * len, ey = y + Math.sin(ang) * len;
    const cx = x + Math.cos(ang) * len * .5 - Math.sin(ang) * droop, cy = y + Math.sin(ang) * len * .5 + Math.cos(ang) * droop;
    const at = t => [(1 - t) ** 2 * x + 2 * (1 - t) * t * cx + t * t * ex, (1 - t) ** 2 * y + 2 * (1 - t) * t * cy + t * t * ey];
    // The rib.
    const w = len * .012;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    path.moveTo(x + nx * w, y + ny * w); path.quadraticCurveTo(cx + nx * w * .6, cy + ny * w * .6, ex, ey);
    path.quadraticCurveTo(cx - nx * w * .6, cy - ny * w * .6, x - nx * w, y - ny * w); path.closePath();
    // Leaflets, longest near the middle of the rib.
    for (let t = .08; t < .98; t += .035) {
      const [px, py] = at(t), [qx, qy] = at(Math.min(1, t + .01));
      const a = Math.atan2(qy - py, qx - px), l = len * .26 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * leaf * (.85 + r() * .3) + 6;
      for (const side of [-1, 1]) {
        const la = a + side * (.62 + r() * .2);
        petal(path, px, py, l, l * .085, la, .45, .55);
      }
    }
  }

  // A swimming pool from above, flat and bright like a 1960s California
  // painting: wobbly light lines, a pink tile edge, a diving board and the
  // shadow of a palm. Night lights the water from a lamp in the wall.
  scene('water', 'pool', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const px0 = -60, py0 = 230, px1 = 1540, py1 = H + 60, cope = 46;

    const deck = night ? tone(mixHex(P.lighter_background, P.yellow, .14), .27, .8) : tone(mixHex(P.background, P.yellow, .2), .92, .9);
    const deckLine = night ? mixHex(deck, '#000000', .3) : mixHex(deck, P.yellow, .18);
    const pink = night ? tone(P.red, .5, .8) : tone(P.red, .78, .75);
    const pinkHi = night ? tone(P.red, .6, .7) : tone(P.red, .86, .55);
    const pinkLo = night ? tone(P.red, .4, .8) : tone(P.red, .68, .85);
    const water = night ? tone(P.blue, .42, 1) : tone(P.blue, .64, 1.15);
    const waterDeep = night ? tone(P.blue, .28, 1) : tone(P.blue, .54, 1.2);
    const line1 = night ? tone(P.bright_cyan, .9, .8) : tone(P.cyan, .9, .55);
    const line2 = night ? tone(P.cyan, .74, 1) : tone(P.cyan, .8, .9);
    const shadowDeck = night ? rgba('#000000', .5) : rgba(tone(P.blue, .4, .7), .42);
    const shadowWater = night ? rgba(tone(P.blue, .16, 1), .6) : rgba(tone(P.blue, .38, 1.2), .62);

    // The deck: concrete slabs.
    ctx.fillStyle = deck; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = linear(ctx, 0, 0, W, H, night
      ? [[0, rgba('#000000', .2)], [1, rgba('#000000', 0)]]
      : [[0, rgba('#ffffff', .35)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(0, 0, W, H);
    dots(ctx, r, 9000, [0, 0, W, H], [.4, 1.1], rgba(deckLine, .35));
    ctx.strokeStyle = rgba(deckLine, .7); ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = px1 + cope + 120; x < W; x += 150) { ctx.moveTo(x, py0 - cope); ctx.lineTo(x, H); }
    for (let y = py0 - cope - 100; y > 0; y -= 150) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
    for (let y = py0 + 140; y < H; y += 150) { ctx.moveTo(px1 + cope, y); ctx.lineTo(W, y); }
    ctx.stroke();

    // Water, deeper toward the lower left.
    const poolPath = new Path2D();
    poolPath.rect(px0, py0, px1 - px0, py1 - py0);
    ctx.save();
    ctx.clip(poolPath);
    ctx.fillStyle = linear(ctx, px1, py0, px0 + 200, py1, [[0, water], [1, waterDeep]]);
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    if (night) {
      // The pool lamp in the far wall.
      ctx.fillStyle = radial(ctx, 760, py0, 0, 900, [[0, rgba(P.bright_cyan, .75)], [.25, rgba(P.cyan, .35)], [1, rgba(P.blue, 0)]]);
      ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    }
    // Mosaic tiles along the waterline.
    ctx.fillStyle = night ? tone(P.blue, .36, 1.1) : tone(P.blue, .5, 1.2);
    ctx.fillRect(px0, py0, px1 - px0, 26); ctx.fillRect(px1 - 26, py0, 26, py1 - py0);
    ctx.strokeStyle = rgba(night ? '#000000' : '#ffffff', night ? .35 : .45); ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = px0; x < px1; x += 13) { ctx.moveTo(x, py0); ctx.lineTo(x, py0 + 26); }
    for (let y = py0 + 26; y < py1; y += 13) { ctx.moveTo(px1 - 26, y); ctx.lineTo(px1, y); }
    ctx.moveTo(px0, py0 + 13); ctx.lineTo(px1 - 13, py0 + 13); ctx.moveTo(px1 - 13, py0 + 13); ctx.lineTo(px1 - 13, py1);
    ctx.stroke();
    // A dark lane line on the floor, with a cross bar at each end.
    ctx.fillStyle = rgba(night ? tone(P.blue, .2) : tone(P.blue, .42, 1.2), .5);
    ctx.beginPath();
    const lane = [];
    for (let x = 140; x <= px1 - 160; x += 20) lane.push([x, 780 + n1(x / 90, 3) * 5]);
    lane.forEach(([x, y], i) => (i ? ctx.lineTo(x, y - 13) : ctx.moveTo(x, y - 13)));
    [...lane].reverse().forEach(([x, y]) => ctx.lineTo(x, y + 13));
    ctx.closePath(); ctx.fill();
    ctx.fillRect(px1 - 186, 730, 26, 100); ctx.fillRect(140, 730, 26, 100);

    // The light lines: rows of wavy lines that cross and form chains of
    // loops, thick and thin like brush strokes.
    const ribbon = (pts, wid, col) => {
      const top = [], bot = [];
      pts.forEach(([x, y], i) => { const w = wid(x, i); top.push([x, y - w / 2]); bot.push([x, y + w / 2]); });
      ctx.fillStyle = col;
      ctx.beginPath(); smoothPath(ctx, [...top, ...bot.reverse()], true); ctx.fill();
    };
    const lineSeed = seedOf(r);
    for (let k = 0, y0 = py0 + 30; y0 < py1 + 40; k++, y0 += 50 + n2(k * .7, 5) * 8) {
      for (const side of [0, 1]) {
        const pts = [], ph = k * 1.7 + side * Math.PI + n1(k, side * 3) * 1.2;
        for (let x = px0 - 30; x <= px1 + 30; x += 10) {
          const f = x / 150 + n1(x / 400, k * .9 + side * 7) * 2.2;
          pts.push([x, y0 + Math.sin(f * Math.PI + ph) * (17 + n2(x / 300, k + side) * 8) + n1(x / 90, k * 1.3) * 5]);
        }
        const wn = makeNoise(lineSeed + k * 13 + side * 7);
        ribbon(pts, x => clamp(1.2 + (wn(x / 70, .5) * .5 + .5) * 5.2, 1, 6.5), rgba(side ? line1 : line2, night ? .75 : .9));
      }
    }
    if (night) bloom(ctx, x => { x.fillStyle = rgba(P.bright_cyan, .6); x.fillRect(px0, py0, 1500, 500); }, [200], [.15]);
    ctx.restore();

    // The pink coping, with a rounded corner.
    const copePath = new Path2D();
    copePath.moveTo(px0, py0 - cope); copePath.lineTo(px1, py0 - cope);
    copePath.arcTo(px1 + cope, py0 - cope, px1 + cope, py0, cope);
    copePath.lineTo(px1 + cope, py1); copePath.lineTo(px1, py1); copePath.lineTo(px1, py0); copePath.lineTo(px0, py0); copePath.closePath();
    ctx.fillStyle = pink; ctx.fill(copePath);
    ctx.save(); ctx.clip(copePath);
    ctx.fillStyle = linear(ctx, 0, py0 - cope, 0, py0, [[0, rgba(pinkHi, 0)], [.55, rgba(pinkHi, .9)], [1, rgba(pinkLo, .8)]]);
    ctx.fillRect(px0, py0 - cope, px1 - px0 + cope, cope);
    ctx.fillStyle = linear(ctx, px1 + cope, 0, px1, 0, [[0, rgba(pinkHi, 0)], [.55, rgba(pinkHi, .9)], [1, rgba(pinkLo, .8)]]);
    ctx.fillRect(px1, py0, cope, py1 - py0);
    ctx.strokeStyle = rgba(pinkLo, .9); ctx.lineWidth = 2;
    ctx.beginPath();
    for (let x = px0 + 40; x < px1; x += 76) { ctx.moveTo(x, py0 - cope); ctx.lineTo(x, py0); }
    for (let y = py0 + 60; y < py1; y += 76) { ctx.moveTo(px1, y); ctx.lineTo(px1 + cope, y); }
    ctx.stroke();
    ctx.restore();
    // A thin dark gap where the coping meets the water.
    ctx.fillStyle = rgba(night ? '#000000' : tone(P.blue, .3), .35);
    ctx.fillRect(px0, py0, px1 - px0, 4); ctx.fillRect(px1 - 4, py0, 4, py1 - py0);

    // The ladder: 2 steel rails and steps under the water.
    {
      const lx = 520;
      ctx.fillStyle = rgba(night ? P.bright_cyan : '#ffffff', night ? .3 : .45);
      for (let k = 0; k < 3; k++) ctx.fillRect(lx - 4, py0 + 40 + k * 36, 72, 9);
      ctx.lineCap = 'round';
      for (const ox of [0, 64]) {
        ctx.strokeStyle = night ? tone(P.foreground, .55, .5) : tone(P.foreground, .62, .4); ctx.lineWidth = 9;
        ctx.beginPath(); ctx.moveTo(lx + ox, py0 - cope - 50); ctx.lineTo(lx + ox, py0 + 4); ctx.stroke();
        ctx.strokeStyle = rgba(night ? P.bright_cyan : '#ffffff', night ? .55 : .9); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(lx + ox - 2, py0 - cope - 48); ctx.lineTo(lx + ox - 2, py0); ctx.stroke();
        ctx.strokeStyle = rgba(night ? tone(P.cyan, .6) : tone(P.blue, .5), .6); ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(lx + ox + 3, py0 + 6); ctx.lineTo(lx + ox + 6, py0 + 118); ctx.stroke();
      }
    }

    // The palm shadow, from a tree beyond the top left corner.
    {
      const [sc, sx] = layer();
      const path = new Path2D(), cx = 300, cy = 300;
      // The trunk.
      path.moveTo(-120, -80); path.quadraticCurveTo(120, 160, cx - 8, cy - 4); path.lineTo(cx + 10, cy + 8); path.quadraticCurveTo(110, 190, -150, -40); path.closePath();
      const n = 11;
      for (let i = 0; i < n; i++) {
        const a = i / n * TAU + rr(r, -.15, .15), len = rr(r, 290, 420);
        frond(path, cx, cy, a, len, rr(r, -60, 60), r);
      }
      sx.fillStyle = '#000000';
      sx.fill(path);
      // The shadow is darker on the water than on the deck.
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      const [dc, dx] = layer();
      dx.save(); dx.setTransform(1, 0, 0, 1, 0, 0); dx.drawImage(sc, 0, 0); dx.restore();
      dx.globalCompositeOperation = 'source-in';
      dx.fillStyle = shadowDeck; dx.fillRect(0, 0, W, H);
      dx.globalCompositeOperation = 'source-over';
      dx.save(); dx.clip(poolPath);
      dx.globalCompositeOperation = 'destination-out'; dx.fillStyle = '#000'; dx.fillRect(px0, py0, px1 - px0, py1 - py0);
      dx.restore();
      ctx.filter = blurPx(1);
      ctx.drawImage(dc, 0, 0);
      const [wc, wx] = layer();
      wx.save(); wx.clip(poolPath); wx.setTransform(1, 0, 0, 1, 0, 0); wx.drawImage(sc, 0, 0); wx.restore();
      wx.globalCompositeOperation = 'source-in';
      wx.fillStyle = shadowWater; wx.fillRect(0, 0, W, H);
      ctx.filter = blurPx(1.5);
      ctx.drawImage(wc, 0, 0);
      ctx.restore();
    }

    // The diving board on its stand, with its shadow on the water.
    {
      const bx0 = 1180, bx1 = 1790, by = 690, bw = 74;
      const board = new Path2D();
      board.moveTo(bx1, by - bw / 2); board.lineTo(bx0 + bw / 2, by - bw / 2); board.arc(bx0 + bw / 2, by, bw / 2, -Math.PI / 2, Math.PI / 2, true); board.lineTo(bx1, by + bw / 2); board.closePath();
      ctx.save(); ctx.translate(34, 46); ctx.filter = blurPx(2.5);
      ctx.save(); ctx.translate(-34, -46); ctx.clip(poolPath); ctx.translate(34, 46); ctx.fillStyle = shadowWater; ctx.fill(board); ctx.restore();
      ctx.save(); ctx.translate(-34, -46); ctx.beginPath(); ctx.rect(px1 + cope, 0, W, H); ctx.clip(); ctx.translate(34, 46); ctx.fillStyle = shadowDeck; ctx.fill(board); ctx.fillRect(1640, by - bw / 2 - 16, 70, bw + 32); ctx.restore();
      ctx.restore();
      // The stand on the deck.
      ctx.fillStyle = night ? tone(P.foreground, .3, .5) : tone(P.foreground, .55, .4);
      ctx.fillRect(1640, by - bw / 2 - 16, 70, bw + 32);
      ctx.fillStyle = night ? tone(P.foreground, .38, .5) : tone(P.foreground, .68, .4);
      ctx.fillRect(1645, by - bw / 2 - 12, 60, bw + 24);
      ctx.fillStyle = linear(ctx, 0, by - bw / 2, 0, by + bw / 2, night
        ? [[0, tone(P.foreground, .62, .3)], [1, tone(P.foreground, .48, .3)]]
        : [[0, '#ffffff'], [1, tone(P.background, .86, 1)]]);
      ctx.fill(board);
      ctx.save(); ctx.clip(board);
      // The rough top of the board.
      dots(ctx, r, 1600, [bx0, by - bw / 2, bx1, by + bw / 2], [.4, 1], rgba(night ? '#000000' : tone(P.blue, .55, .4), .25));
      ctx.fillStyle = night ? tone(P.blue, .45, .8) : tone(P.blue, .7, .8);
      ctx.fillRect(bx0, by - bw / 2, bx1 - bx0, 6); ctx.fillRect(bx0, by + bw / 2 - 6, bx1 - bx0, 6);
      ctx.restore();
    }
    if (night) {
      // Glow of the water on the deck near the pool.
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 760, py0, 0, 900, [[0, rgba(P.cyan, .3)], [1, rgba(P.cyan, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .45 : .08);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/koi-pond ----------

  // The spine of a fish from the head backward, as points [x, y, angle].
  function spine(x, y, ang, len, bend, wig, count = 26) {
    const pts = [], step = len / (count - 1);
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1), th = ang + bend * (t - .25) * 1.6 + wig * Math.sin(t * Math.PI * 1.6);
      pts.push([x, y, th]);
      x -= Math.cos(th) * step; y -= Math.sin(th) * step;
    }
    return pts;
  }
  // The outline of a fish body around a spine. width gives the half width at
  // t, from 0 at the head to 1 at the tail.
  function bodyPath(sp, width) {
    const left = [], right = [], n = sp.length - 1;
    sp.forEach(([x, y, th], i) => {
      const w = width(i / n), nx = -Math.sin(th), ny = Math.cos(th);
      left.push([x + nx * w, y + ny * w]); right.push([x - nx * w, y - ny * w]);
    });
    const [hx, hy, hth] = sp[0], path = new Path2D();
    smoothPath(path, [[hx + Math.cos(hth) * width(.03) * .5, hy + Math.sin(hth) * width(.03) * .5], ...left.slice(1), ...right.slice(1).reverse()], true);
    return path;
  }
  // A koi from above. o: x, y, ang, len, bend, wig, base, patches, fin.
  function koi(ctx, o, r) {
    const sp = spine(o.x, o.y, o.ang, o.len, o.bend, o.wig);
    const w0 = o.len * .145, n = sp.length - 1;
    const width = t => t < .2 ? w0 * Math.sqrt(Math.max(0, 1 - ((.2 - t) / .2) ** 2)) * .96 + w0 * .04 : w0 * (1 - ((t - .2) / .8) ** 1.5 * .78);
    const body = bodyPath(sp, width);
    const at = t => sp[Math.min(n, Math.round(t * n))];
    const finA = o.finA ?? .6;
    // A fan fin with fine rays, from the body edge out along angle a.
    const fan = (x, y, a, len, wid) => {
      const p = new Path2D(); petal(p, x, y, len, wid, a, .62);
      ctx.fillStyle = linear(ctx, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, [[0, rgba(o.fin, finA)], [1, rgba(o.fin, finA * .35)]]);
      ctx.fill(p);
      if (o.rays !== false) {
        ctx.strokeStyle = rgba(o.fin, finA * .6); ctx.lineWidth = .9;
        ctx.beginPath();
        for (let k = -2; k <= 2; k++) { const b = a + k * wid / len * .55; ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(b) * len * .9, y + Math.sin(b) * len * .9); }
        ctx.stroke();
      }
    };
    for (const side of [1, -1]) {
      const [x, y, th] = at(.2), nx = -Math.sin(th), ny = Math.cos(th), w = width(.2);
      fan(x + nx * w * side * .7, y + ny * w * side * .7, th + Math.PI - side * 1.15, o.len * .2, o.len * .085);
      const [x2, y2, th2] = at(.52), nx2 = -Math.sin(th2), ny2 = Math.cos(th2), w2 = width(.52);
      fan(x2 + nx2 * w2 * side * .7, y2 + ny2 * w2 * side * .7, th2 + Math.PI - side * .8, o.len * .1, o.len * .04);
    }
    // The tail: a broad fan in 2 lobes.
    {
      const [x, y, th] = sp[n], [x2, y2] = at(.88), bx = -Math.cos(th), by = -Math.sin(th), nx = -Math.sin(th), ny = Math.cos(th);
      const L = o.len * .3, sw = o.tailSwing || 0, wb = width(.88);
      const tip1 = [x + bx * L + nx * L * (.5 + sw), y + by * L + ny * L * (.5 + sw)];
      const tip2 = [x + bx * L - nx * L * (.5 - sw), y + by * L - ny * L * (.5 - sw)];
      const fork = [x + bx * L * .62 + nx * L * sw * .4, y + by * L * .62 + ny * L * sw * .4];
      const p = new Path2D();
      p.moveTo(x2 + nx * wb, y2 + ny * wb);
      p.quadraticCurveTo(x + bx * L * .4 + nx * L * .42, y + by * L * .4 + ny * L * .42, tip1[0], tip1[1]);
      p.quadraticCurveTo(lerp(tip1[0], fork[0], .5) + bx * L * .05, lerp(tip1[1], fork[1], .5) + by * L * .05, fork[0], fork[1]);
      p.quadraticCurveTo(lerp(tip2[0], fork[0], .5) + bx * L * .05, lerp(tip2[1], fork[1], .5) + by * L * .05, tip2[0], tip2[1]);
      p.quadraticCurveTo(x + bx * L * .4 - nx * L * .42, y + by * L * .4 - ny * L * .42, x2 - nx * wb, y2 - ny * wb);
      p.closePath();
      ctx.fillStyle = linear(ctx, x2, y2, x + bx * L, y + by * L, [[0, rgba(o.fin, finA)], [1, rgba(o.fin, finA * .3)]]);
      ctx.fill(p);
      if (o.rays !== false) {
        ctx.strokeStyle = rgba(o.fin, finA * .5); ctx.lineWidth = .9;
        ctx.beginPath();
        for (let k = 0; k <= 8; k++) {
          const t = k / 8, ex = lerp(tip2[0], tip1[0], t), ey = lerp(tip2[1], tip1[1], t);
          ctx.moveTo(x, y); ctx.lineTo(lerp(x, ex, .92) + bx * L * .1 * Math.sin(t * Math.PI), lerp(y, ey, .92) + by * L * .1 * Math.sin(t * Math.PI));
        }
        ctx.stroke();
      }
    }
    // The body and its patches.
    ctx.save();
    ctx.fillStyle = o.base; ctx.fill(body);
    ctx.clip(body);
    for (const [col, k] of o.patches) {
      ctx.fillStyle = col;
      for (let i = 0; i < k; i++) {
        const t = rr(r, .04, .8), [x, y, th] = at(t), side = (r() - .5) * width(t) * 1.3;
        const rad = o.len * rr(r, .07, .13);
        ctx.beginPath(); smoothPath(ctx, pebblePts(o.noise, x - Math.sin(th) * side, y + Math.cos(th) * side, rad, rr(r, 1, 1.7), th, r() * 50, 9, .35), true); ctx.fill();
      }
    }
    // Fine rows of scales.
    if (o.scales !== false) {
      ctx.strokeStyle = rgba('#000000', .1); ctx.lineWidth = .9;
      ctx.beginPath();
      const step = w0 * .32;
      for (let t = .16; t < .88; t += step / o.len) {
        const [x, y, th] = at(t), w = width(t), cx = Math.cos(th), sy = Math.sin(th);
        for (let k = -3; k <= 3; k++) {
          const off = (k + (Math.round(t * o.len / step) % 2) * .5) * w * .3;
          if (Math.abs(off) > w * .85) continue;
          const px = x - sy * off, py = y + cx * off;
          ctx.moveTo(px + sy * step * .5, py - cx * step * .5);
          ctx.quadraticCurveTo(px - cx * step * .6, py - sy * step * .6, px - sy * step * .5, py + cx * step * .5);
        }
      }
      ctx.stroke();
    }
    // Roundness: dark sides, a light ridge along the back.
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.filter = blurPx(w0 * .12);
    ctx.strokeStyle = rgba('#000000', .3); ctx.lineWidth = w0 * .5;
    ctx.stroke(body);
    const ridge = new Path2D();
    sp.slice(2, Math.round(n * .78)).forEach(([x, y], i) => (i ? ridge.lineTo(x, y) : ridge.moveTo(x, y)));
    ctx.filter = blurPx(w0 * .22);
    ctx.strokeStyle = rgba('#ffffff', o.sheen ?? .32); ctx.lineWidth = w0 * .6;
    ctx.stroke(ridge);
    ctx.filter = 'none';
    // The dorsal fin, a thin line along the back.
    const dors = new Path2D();
    sp.slice(Math.round(n * .3), Math.round(n * .66)).forEach(([x, y], i) => (i ? dors.lineTo(x, y) : dors.moveTo(x, y)));
    ctx.strokeStyle = rgba(o.fin, .5); ctx.lineWidth = w0 * .12; ctx.stroke(dors);
    ctx.restore();
    // Eyes.
    const [hx, hy, hth] = at(.07), ex = -Math.sin(hth) * width(.07) * .72, ey = Math.cos(hth) * width(.07) * .72;
    ctx.fillStyle = rgba('#000000', .55);
    ctx.beginPath(); circle(ctx, hx + ex, hy + ey, w0 * .09); circle(ctx, hx - ex, hy - ey, w0 * .09); ctx.fill();
    return body;
  }

  // Koi under lily pads in a dark pond, seen from above.
  scene('water', 'koi-pond', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const deep = night ? tone(P.blue, .15, .7) : tone(P.blue, .52, .75);
    const mid = night ? tone(P.cyan, .24, .6) : tone(P.cyan, .68, .65);
    const sky = night ? tone(P.cyan, .36, .5) : tone(P.cyan, .82, .35);

    // Water: dark depths with soft reflections of the sky.
    ctx.fillStyle = linear(ctx, 0, 0, W * .6, H, [[0, mid], [.6, deep], [1, mixHex(deep, mid, .2)]]);
    ctx.fillRect(0, 0, W, H);
    const [m1, m2, m3] = rgb(sky);
    drawField(ctx, field(240, 135, 0, 0, W, H, (x, y, o) => {
      const v = fbm(n1, x / 700 + 3, y / 500, 3);
      o[0] = m1; o[1] = m2; o[2] = m3; o[3] = clamp(v * 1.5 + .05, 0, 1) * (night ? 80 : 120);
    }));

    // Koi: some deep and soft, most near the surface.
    const white = night ? tone(P.foreground, .9, .6) : tone(P.foreground, .97, .4);
    const red = night ? tone(P.red, .6, 1.1) : tone(P.red, .6, 1.15);
    const orange = night ? tone(P.yellow, .76, 1.05) : tone(P.yellow, .74, 1.15);
    const ink = night ? tone(P.background, .14, .5) : tone(P.background, .2, .5);
    const kinds = [
      { base: white, patches: [[red, 4]] },
      { base: orange, patches: [[tone(orange, toOklch(orange).L + .08), 2]], sheen: .45 },
      { base: white, patches: [[red, 3], [ink, 3]] },
      { base: red, patches: [[white, 2]] },
      { base: white, patches: [[orange, 3]] },
      { base: ink, patches: [[red, 2], [white, 3]] },
      { base: orange, patches: [[white, 2]], sheen: .45 },
      { base: white, patches: [[red, 2]] },
    ];
    const fish = [
      [470, 640, -.35, 360, .55, .1, 1], [1480, 330, 2.75, 400, -.6, .12, 1], [1180, 860, 3.5, 340, .8, -.1, 1],
      [880, 330, .55, 300, -.45, .15, 1], [300, 300, -.9, 290, .3, -.12, 1], [1720, 760, -2.2, 330, .5, .1, 1],
      [760, 990, -.1, 260, -.5, .1, 0], [1310, 560, 1.9, 240, .4, -.1, 0], [160, 860, .9, 230, -.3, .1, 0],
    ];
    const deepK = [], nearK = [];
    fish.forEach(([x, y, ang, len, bend, wig, near], i) => (near ? nearK : deepK).push({ x, y, ang, len, bend, wig, ...kinds[i % kinds.length], fin: white, noise: n2, tailSwing: rr(r, -.15, .15) }));
    {
      const [dc, dx] = layer();
      deepK.forEach(k => koi(dx, k, r));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = blurPx(5); ctx.globalAlpha = night ? .32 : .4; ctx.drawImage(dc, 0, 0);
      ctx.restore();
      ctx.fillStyle = rgba(deep, .25); ctx.fillRect(0, 0, W, H);
    }
    // Shadows on the bottom, then the fish near the surface.
    {
      const [sc, sx] = layer();
      nearK.forEach(k => koi(sx, { ...k, base: '#000000', patches: [], fin: '#000000', finA: .6, sheen: 0, rays: false, scales: false }, r));
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.filter = blurPx(7); ctx.globalAlpha = night ? .5 : .32; ctx.drawImage(sc, 18 * S, 26 * S);
      ctx.restore();
    }
    const [kc, kx] = layer();
    nearK.forEach(k => koi(kx, k, r));
    if (night) bloom(ctx, x => x.drawImage(kc, 0, 0, W, H), [40], [.35]);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(kc, 0, 0); ctx.restore();

    // A thin film of water over the fish.
    ctx.fillStyle = rgba(mid, night ? .12 : .1); ctx.fillRect(0, 0, W, H);

    // Ripples where a fish touched the surface.
    const ring = (x, y, R) => {
      for (let i = 0; i < 5; i++) {
        const rad = R * (.35 + i * .2), a = (1 - i / 5) * (night ? .35 : .5);
        ctx.lineWidth = 2.2 - i * .3;
        ctx.strokeStyle = rgba(night ? P.bright_cyan : '#ffffff', a);
        ctx.beginPath(); ellipse(ctx, x, y, rad, rad * .96); ctx.stroke();
        ctx.strokeStyle = rgba('#000000', a * .5);
        ctx.beginPath(); ellipse(ctx, x + 1.5, y + 2.5, rad, rad * .96); ctx.stroke();
      }
    };
    ring(1010, 560, 120); ring(560, 250, 70); ring(1640, 1000, 90);

    // Lily pads in clusters toward the corners.
    const pads = [];
    const cluster = (cx, cy, k, spread) => {
      for (let i = 0, tries = 0; i < k && tries < 400; tries++) {
        const rad = rr(r, 40, 110), x = cx + (r() - .5) * spread * 2, y = cy + (r() - .5) * spread * 1.4;
        if (pads.some(p => Math.hypot(p.x - x, p.y - y) < (p.rad + rad) * .82)) continue;
        pads.push({ x, y, rad, a: r() * TAU, tint: r() }); i++;
      }
    };
    cluster(1750, 160, 9, 260); cluster(140, 1000, 9, 300); cluster(80, 120, 4, 140); cluster(1880, 1040, 3, 120);
    const padC = night ? tone(P.green, .4, .85) : tone(P.green, .58, .9);
    const padHi = night ? tone(P.green, .5, .8) : tone(P.green, .7, .8);
    const padRim = night ? tone(P.yellow, .48, .6) : tone(P.yellow, .68, .7);
    for (const p of pads) {
      const path = new Path2D(), notch = .2;
      path.moveTo(p.x, p.y);
      path.arc(p.x, p.y, p.rad, p.a + notch, p.a - notch + TAU);
      path.closePath();
      softShadow(ctx, path, 6, 10, 10, rgba('#000000', night ? .55 : .35));
      ctx.fillStyle = radial(ctx, p.x - p.rad * .2, p.y - p.rad * .25, 0, p.rad * 1.1, [[0, padHi], [.75, padC], [1, mixHex(padC, padRim, .35 + p.tint * .4)]]);
      ctx.fill(path);
      ctx.save(); ctx.clip(path);
      ctx.strokeStyle = rgba(padHi, .7); ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 1; k < 14; k++) { const a = p.a + notch + k / 14 * (TAU - notch * 2); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(a) * p.rad, p.y + Math.sin(a) * p.rad); }
      ctx.stroke();
      ctx.strokeStyle = rgba(padRim, .6); ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.rad - 1.5, p.a + notch, p.a - notch + TAU); ctx.stroke();
      ctx.restore();
    }
    // Water lilies on 3 of the pads.
    const lilyC = night ? tone(P.magenta, .78, .8) : tone(P.magenta, .8, .8);
    [pads[1], pads[10], pads[4]].filter(Boolean).forEach((p, i) => {
      const x = p.x + p.rad * .2, y = p.y - p.rad * .15, s = 26 + i * 6;
      softShadow(ctx, (() => { const q = new Path2D(); q.arc(x, y, s, 0, TAU); return q; })(), 6, 9, 9, rgba('#000000', .4));
      for (const [k, len, col] of [[10, s * 1.25, mixHex(lilyC, '#ffffff', .2)], [8, s * .95, lilyC], [6, s * .6, mixHex(lilyC, '#ffffff', .45)]]) {
        for (let j = 0; j < k; j++) {
          const a = j / k * TAU + len;
          ctx.fillStyle = linear(ctx, x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, [[0, col], [1, mixHex(col, '#ffffff', .5)]]);
          ctx.beginPath(); petal(ctx, x, y, len, len * .32, a); ctx.fill();
        }
      }
      ctx.fillStyle = tone(P.yellow, .85, 1.1);
      ctx.beginPath(); circle(ctx, x, y, s * .2); ctx.fill();
    });

    // Light on the surface: the moon at night, a bright sky by day.
    {
      const [mc, mx] = layer(), mxp = 1120, myp = 250;
      mx.fillStyle = radial(mx, mxp, myp, 0, night ? 80 : 160, night
        ? [[0, rgba(P.bright_cyan, .95)], [.8, rgba(P.bright_cyan, .8)], [1, rgba(P.bright_cyan, 0)]]
        : [[0, rgba('#ffffff', .55)], [1, rgba('#ffffff', 0)]]);
      mx.beginPath(); circle(mx, mxp, myp, night ? 80 : 160); mx.fill();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      rippleCopy(ctx, mc, myp - 180, myp + 180, n1, 16, () => night ? .8 : .7, .3);
      ctx.fillStyle = radial(ctx, mxp, myp, 0, 420, [[0, rgba(night ? P.bright_cyan : '#ffffff', night ? .1 : .16)], [1, rgba('#ffffff', 0)]]);
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    vignette(ctx, P, night ? .55 : .2);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/kelp-forest ----------

  // A long kelp blade from the point x, y along the angle a, with a wavy
  // midline and ruffled edges.
  function kelpBlade(path, n, x, y, len, wid, a, wave, seed) {
    const left = [], right = [], dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, off = Math.sin(t * Math.PI * 1.4) * wave * len * t;
      const mx = x + dx * len * t + nx * off, my = y + dy * len * t + ny * off;
      const w = wid * Math.sin(Math.PI * Math.min(1, t ** .6 * 1.02)) * (1 + n(seed + t * 3, seed) * .25) + .6;
      left.push([mx + nx * w, my + ny * w]); right.push([mx - nx * w, my - ny * w]);
    }
    smoothPath(path, [[x, y], ...left.slice(1), ...right.slice(1).reverse()], true);
  }
  // A kelp plant: a stipe from the floor at x0 up to the surface, with long
  // blades and gas bladders along it. The current bends it by drift.
  function kelpPlant(r, n, x0, top, scale, drift) {
    const stipe = [], blades = new Path2D(), floats = new Path2D(), ph = r() * TAU;
    for (let y = H + 30; y >= top; y -= 12) {
      const k = (H + 30 - y) / (H + 30 - top);
      stipe.push([x0 + Math.sin(y / (190 * scale) + ph) * 34 * scale + drift * k * k * 160, y]);
    }
    let side = r() < .5 ? 1 : -1;
    for (let i = 2; i < stipe.length - 1; i += 1 + Math.floor(r() * 3)) {
      const [x, y] = stipe[i], k = i / stipe.length;
      side = r() < .8 ? -side : side;
      const len = rr(r, 110, 210) * scale * (.7 + k * .5);
      // Blades rise along the stipe and lean with the current.
      const a = -Math.PI / 2 + side * rr(r, .25, .75) + drift * 1.4;
      floats.moveTo(x + 5 * scale, y); floats.ellipse(x + side * 4 * scale, y - 2 * scale, 5.5 * scale, 4 * scale, a, 0, TAU);
      kelpBlade(blades, n, x + side * 6 * scale, y - 3 * scale, len, rr(r, 6, 11) * scale, a, rr(r, -.35, .35), r() * 90);
    }
    // Blades that float at the surface.
    const [tx, ty] = stipe[stipe.length - 1];
    for (let i = 0; i < 5; i++) {
      const sd = i % 2 ? 1 : -1;
      kelpBlade(blades, n, tx, ty + 6, rr(r, 140, 260) * scale, rr(r, 7, 12) * scale, (sd > 0 ? 0 : Math.PI) + rr(r, -.25, .25), rr(r, -.2, .2), r() * 90);
    }
    return { stipe, blades, floats };
  }

  // An underwater kelp forest with light rays from the surface and small fish.
  scene('water', 'kelp-forest', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const top = night ? tone(P.cyan, .42, .75) : tone(P.cyan, .88, .7);
    const mid = night ? tone(P.blue, .24, .8) : tone(P.blue, .66, .75);
    const low = night ? tone(P.blue, .1, .7) : tone(P.blue, .46, .85);
    const light = night ? tone(P.bright_cyan, .85, .6) : tone(P.bright_yellow, .97, .45);

    skyGradient(ctx, [[0, top], [.3, mixHex(top, mid, .6)], [.65, mid], [1, low]]);

    // The surface from below: a bright band with wavy light.
    {
      ctx.fillStyle = linear(ctx, 0, 0, 0, 120, [[0, rgba(light, night ? .45 : .8)], [1, rgba(light, 0)]]);
      ctx.fillRect(0, 0, W, 120);
      ctx.strokeStyle = rgba(light, night ? .35 : .6); ctx.lineCap = 'round';
      for (let i = 0; i < 70; i++) {
        const x = r() * W, y = r() ** 2 * 70 + 4, l = rr(r, 20, 90);
        ctx.lineWidth = rr(r, 1, 3.2) * (1 - y / 90);
        ctx.beginPath(); ctx.moveTo(x - l, y); ctx.quadraticCurveTo(x, y + rr(r, -6, 6), x + l, y + rr(r, -3, 3)); ctx.stroke();
      }
    }

    // Light rays, fanning out from the surface.
    {
      const [lc, lx] = layer();
      for (let i = 0; i < 11; i++) {
        const x = rr(r, -100, W + 100), w = rr(r, 20, 90), sl = rr(r, .12, .3), len = rr(r, 600, 1100);
        lx.fillStyle = linear(lx, 0, 0, 0, len, [[0, rgba(light, rr(r, .35, .7))], [1, rgba(light, 0)]]);
        lx.beginPath(); lx.moveTo(x - w / 2, 0); lx.lineTo(x + w / 2, 0); lx.lineTo(x + w * 1.8 + sl * len, len); lx.lineTo(x - w * .6 + sl * len, len); lx.closePath(); lx.fill();
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'screen'; ctx.filter = blurPx(22); ctx.globalAlpha = night ? .5 : .75;
      ctx.drawImage(lc, 0, 0);
      ctx.restore();
    }

    // Kelp in 3 layers: far and hazy, then mid, then near at the edges.
    const kelpC = night ? tone(P.red, .26, .7) : tone(P.magenta, .46, .9);
    const kelpLit = night ? tone(P.green, .42, .7) : tone(P.yellow, .72, .95);
    const floor = (layerK, fill) => {
      const pts = ridgePoints(n2, H - 40 + layerK * 30, 90 - layerK * 20, .004, layerK * 9, 12, 4);
      fillRidge(ctx, pts, fill);
    };
    const layers = [
      { xs: [90, 330, 560, 1240, 1450, 1720], scale: .55, haze: .78, blur: 3 },
      { xs: [200, 470, 1430, 1700], scale: .8, haze: .5, blur: 1.2 },
      { xs: [60, 300, 1630, 1870], scale: 1.15, haze: .06, blur: 0 },
    ];
    // Small fish in a school, in a curved band between the kelp.
    const school = (cx, cy, k, rad, ang, col, size, bend) => {
      ctx.fillStyle = col;
      ctx.beginPath();
      for (let i = 0; i < k; i++) {
        const u = r() * 2 - 1, v = (r() + r() + r() - 1.5) / 1.5;
        const x = cx + u * rad, y = cy + v * rad * .22 + u * u * bend;
        const s = size * rr(r, .75, 1.15), th = ang + u * bend / rad * 1.4 + rr(r, -.12, .12), c = Math.cos(th), sn = Math.sin(th);
        ctx.moveTo(x + c * s, y + sn * s); ctx.ellipse(x, y, s, s * .3, th, 0, TAU);
        ctx.moveTo(x - c * s * .8, y - sn * s * .8);
        ctx.lineTo(x - c * s * 1.45 - sn * s * .42, y - sn * s * 1.45 + c * s * .42);
        ctx.lineTo(x - c * s * 1.45 + sn * s * .42, y - sn * s * 1.45 - c * s * .42);
        ctx.closePath();
      }
      ctx.fill();
    };
    layers.forEach((L, li) => {
      const [kc, kx] = layer();
      const col = mixHex(kelpC, mid, L.haze), lit = mixHex(kelpLit, mid, L.haze);
      L.xs.forEach(x0 => {
        const pl = kelpPlant(r, n1, x0 + rr(r, -40, 40), rr(r, -20, 40), L.scale, rr(r, -.25, .35));
        kx.strokeStyle = col; kx.lineWidth = 5 * L.scale; kx.lineCap = 'round';
        kx.beginPath(); smoothPath(kx, pl.stipe); kx.stroke();
        kx.fillStyle = col; kx.fill(pl.blades);
        // Light comes through the blades from above.
        kx.save(); kx.clip(pl.blades);
        kx.fillStyle = linear(kx, 0, 0, 0, H, [[0, rgba(lit, .9)], [.6, rgba(lit, .35)], [1, rgba(lit, 0)]]);
        kx.fillRect(0, 0, W, H);
        kx.restore();
        kx.fillStyle = mixHex(lit, col, .3); kx.fill(pl.floats);
      });
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (L.blur) ctx.filter = blurPx(L.blur);
      ctx.drawImage(kc, 0, 0);
      ctx.restore();
      floor(li, mixHex(night ? P.darker_background : tone(P.blue, .32, .7), mid, L.haze * .9));
      if (li === 0) {
        school(980, 470, 220, 330, .06, rgba(mixHex(low, mid, .35), .6), 8, -90);
        school(760, 250, 60, 140, -.05, rgba(mixHex(low, mid, .55), .45), 6, 30);
      }
      if (li === 1) school(1180, 760, 30, 120, 3.2, rgba(low, .75), 13, 40);
    });

    // Boulders on the floor in front.
    for (const [x, y, rad] of [[140, H + 30, 190], [420, H + 60, 150], [1560, H + 50, 170], [1820, H + 20, 210], [980, H + 90, 120]]) {
      const pts = pebblePts(n2, x, y, rad, 1.35, 0, x * .01, 12, .18);
      const path = new Path2D(); smoothPath(path, pts, true);
      ctx.fillStyle = linear(ctx, 0, y - rad, 0, y + rad * .3, [[0, night ? tone(P.blue, .2, .6) : tone(P.blue, .5, .5)], [.25, night ? tone(P.blue, .12, .7) : tone(P.blue, .36, .7)], [1, night ? P.darker_background : tone(P.blue, .26, .8)]]);
      ctx.fill(path);
    }

    // A few bright fish near the kelp.
    const gar = night ? tone(P.orange, .55, .9) : tone(P.orange, .7, 1.2);
    for (const [x, y, s, d] of [[420, 640, 1, 1], [1530, 420, .8, -1]]) {
      ctx.save(); ctx.translate(x, y); ctx.scale(s * d, s);
      ctx.fillStyle = gar;
      ctx.beginPath(); ellipse(ctx, 0, 0, 34, 20); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-26, 0); ctx.quadraticCurveTo(-46, -20, -54, -16); ctx.quadraticCurveTo(-46, 0, -54, 16); ctx.quadraticCurveTo(-46, 20, -26, 0); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-14, -16); ctx.quadraticCurveTo(0, -30, 18, -16); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', .3); ctx.beginPath(); ellipse(ctx, 4, -7, 20, 6); ctx.fill();
      ctx.fillStyle = rgba('#000000', .6); ctx.beginPath(); circle(ctx, 20, -4, 3); ctx.fill();
      ctx.restore();
    }

    // Drifting particles.
    dots(ctx, r, 700, [0, 0, W, H], [.5, 2], rgba(light, night ? .3 : .45));
    if (night) bloom(ctx, x => { dots(x, r, 120, [0, 0, W, H], [1, 2.2], rgba(P.bright_cyan, .9)); }, [10], [.8]);
    vignette(ctx, P, night ? .55 : .2);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/deep-sea ----------

  // A jellyfish with its bell at x, y. It swims along the angle ang, and 0
  // is up.
  // body is the bell color, glow the color of its light.
  function jelly(ctx, r, x, y, s, ang, body, glow, alpha = 1) {
    ctx.save();
    ctx.translate(x, y); ctx.rotate(ang);
    ctx.globalAlpha = alpha;
    const ph = r() * TAU;
    // Long thin tentacles from the rim.
    const tl = s * rr(r, 3, 5.5);
    ctx.strokeStyle = linear(ctx, 0, 0, 0, tl, [[0, rgba(glow, .75)], [1, rgba(glow, 0)]]);
    ctx.lineWidth = Math.max(.7, s * .018); ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < 18; i++) {
      const x0 = -s * .95 + i / 17 * s * 1.9, pts = [];
      for (let t = 0; t <= 1.001; t += .1) pts.push([x0 * (1 - t * .3) + Math.sin(t * 7 + ph + i) * s * .18 * t, t * tl * (.6 + .4 * Math.sin(i * 2.3) ** 2)]);
      smoothPath(ctx, pts);
    }
    ctx.stroke();
    // Frilly oral arms under the bell.
    ctx.fillStyle = rgba(glow, .22);
    for (let i = 0; i < 4; i++) {
      const p = new Path2D(), x0 = (i - 1.5) * s * .22;
      const pts = [], len = s * rr(r, 1.4, 2.2);
      for (let t = 0; t <= 1.001; t += .1) pts.push([x0 + Math.sin(t * 5 + ph + i * 1.7) * s * .14, s * .1 + t * len]);
      const left = pts.map(([px, py], k) => [px - s * .09 * (1 - k / 11) * (1 + Math.sin(k * 2.7) * .4), py]);
      const right = pts.map(([px, py], k) => [px + s * .09 * (1 - k / 11) * (1 + Math.cos(k * 2.3) * .4), py]);
      smoothPath(p, [...left, ...right.reverse()], true);
      ctx.fill(p);
    }
    // The bell: clear in the middle, bright at the rim.
    const bell = new Path2D();
    bell.moveTo(-s, 0); bell.bezierCurveTo(-s, -s * 1.15, s, -s * 1.15, s, 0);
    for (let i = 0; i < 12; i++) { const x0 = s - i / 12 * s * 2, x1 = s - (i + 1) / 12 * s * 2; bell.quadraticCurveTo((x0 + x1) / 2, s * .12, x1, 0); }
    bell.closePath();
    ctx.fillStyle = radial(ctx, 0, -s * .1, s * .1, s * 1.05, [[0, rgba(body, .1)], [.65, rgba(body, .28)], [1, rgba(glow, .75)]]);
    ctx.fill(bell);
    ctx.strokeStyle = rgba(glow, .85); ctx.lineWidth = Math.max(1, s * .025);
    ctx.stroke(bell);
    // The inner bell, radial canals and a glowing core.
    ctx.save(); ctx.clip(bell);
    ctx.fillStyle = radial(ctx, 0, -s * .05, 0, s * .8, [[0, rgba(glow, .3)], [1, rgba(glow, 0)]]);
    ctx.beginPath(); ellipse(ctx, 0, -s * .05, s * .78, s * .62); ctx.fill();
    ctx.strokeStyle = rgba(glow, .22); ctx.lineWidth = Math.max(.8, s * .012);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) { const u = (i / 8 - .5) * 1.8; ctx.moveTo(u * s * .2, -s * .82); ctx.quadraticCurveTo(u * s * .75, -s * .7, u * s * 1.05, 0); }
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = radial(ctx, 0, -s * .35, 0, s * .32, [[0, rgba(glow, .55)], [1, rgba(glow, 0)]]);
    ctx.beginPath(); ellipse(ctx, 0, -s * .35, s * .32, s * .22); ctx.fill();
    ctx.fillStyle = radial(ctx, -s * .3, -s * .62, 0, s * .4, [[0, rgba('#ffffff', .35)], [1, rgba('#ffffff', 0)]]);
    ctx.fill(bell);
    ctx.restore();
  }
  // A comb jelly: a clear oval with rows of shimmering comb plates.
  function combJelly(ctx, x, y, s, ang, body, cols) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
    ctx.fillStyle = radial(ctx, 0, 0, s * .2, s * 1.05, [[0, rgba(body, .06)], [1, rgba(body, .28)]]);
    ctx.beginPath(); ctx.ellipse(0, 0, s * .62, s, 0, 0, TAU); ctx.fill();
    ctx.strokeStyle = rgba(cols[0], .5); ctx.lineWidth = Math.max(.8, s * .02); ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const u = (k / 5 - .5) * 1.6;
      ctx.beginPath();
      for (let t = -.8; t <= .8; t += .05) {
        const yy = t * s, xx = u * s * .62 * Math.sqrt(1 - t * t) * .66;
        ctx.moveTo(xx + s * .022, yy); ctx.ellipse(xx, yy, s * .022, s * .012, 0, 0, TAU);
      }
      ctx.fillStyle = cols[k % cols.length]; ctx.fill();
    }
    ctx.restore();
  }

  // The deep sea, where the light comes from animals. Day is the blue
  // twilight zone, still lit from above.
  scene('water', 'deep-sea', (ctx, P, r) => {
    const night = P.night;
    const top = night ? tone(P.blue, .22, .7) : tone(P.blue, .82, .55);
    const mid = night ? tone(P.blue, .12, .8) : tone(P.blue, .62, .85);
    const low = night ? P.darker_background : tone(P.blue, .46, 1);
    skyGradient(ctx, [[0, top], [.35, mid], [1, low]]);
    // Dim light from far above.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radial(ctx, W * .42, -200, 0, 1100, [[0, rgba(night ? P.cyan : '#ffffff', night ? .22 : .55)], [1, rgba(P.cyan, 0)]]);
    ctx.fillRect(0, 0, W, H);
    {
      const [lc, lx] = layer();
      for (let i = 0; i < 7; i++) {
        const x = rr(r, 300, 1500), w = rr(r, 40, 120), len = rr(r, 500, 900), sl = rr(r, -.15, .2);
        lx.fillStyle = linear(lx, 0, 0, 0, len, [[0, rgba(night ? P.bright_cyan : '#ffffff', night ? .12 : .4)], [1, rgba('#ffffff', 0)]]);
        lx.beginPath(); lx.moveTo(x - w / 2, 0); lx.lineTo(x + w / 2, 0); lx.lineTo(x + w + sl * len, len); lx.lineTo(x - w + sl * len, len); lx.closePath(); lx.fill();
      }
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(30); ctx.drawImage(lc, 0, 0);
    }
    ctx.restore();

    const glows = night ? [P.bright_cyan, P.cyan, P.bright_blue, P.bright_green, P.bright_magenta] : ['#ffffff', tone(P.bright_cyan, .95, .5), tone(P.cyan, .92, .5)];
    const body = night ? P.blue : '#ffffff';
    // Far, soft jellies.
    {
      const [fc, fx] = layer();
      for (const [x, y, s0] of [[300, 320, 46], [760, 160, 30], [1500, 640, 40], [980, 860, 34], [1780, 200, 28], [560, 760, 26]]) {
        jelly(fx, r, x, y, s0, rr(r, -.4, .4), body, pick(r, glows), night ? .5 : .55);
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(6); ctx.drawImage(fc, 0, 0); ctx.restore();
    }
    // Marine snow and glowing specks.
    const specks = (x, k, a) => {
      for (let i = 0; i < k; i++) {
        x.fillStyle = rgba(pick(r, glows), a * rr(r, .3, 1));
        x.beginPath(); circle(x, r() * W, r() * H, r() ** 3 * 2.6 + .5); x.fill();
      }
    };
    specks(ctx, 500, night ? .55 : .6);
    // The main animals, with a glow.
    const draw = x => {
      jelly(x, r, 1440, 300, 120, .25, body, night ? P.bright_cyan : '#ffffff');
      jelly(x, r, 330, 640, 86, -.3, body, night ? P.bright_magenta : tone(P.bright_cyan, .97, .4));
      jelly(x, r, 1700, 760, 52, -.15, body, night ? P.bright_blue : '#ffffff');
      jelly(x, r, 640, 260, 40, .4, body, night ? P.bright_green : '#ffffff');
      jelly(x, r, 1180, 620, 28, .1, body, night ? P.bright_cyan : '#ffffff');
      combJelly(x, 160, 230, 48, .5, body, night ? [P.bright_cyan, P.bright_magenta, P.bright_green, P.bright_blue] : [tone(P.cyan, .6, 1), tone(P.magenta, .6, 1), tone(P.green, .6, 1), tone(P.blue, .6, 1)]);
      combJelly(x, 1000, 960, 34, -.8, body, night ? [P.bright_green, P.bright_cyan, P.bright_blue] : [tone(P.cyan, .6, 1), tone(P.blue, .6, 1)]);
      // A chain of glowing beads, like a siphonophore.
      const pts = [];
      for (let t = 0; t <= 1; t += .02) pts.push([1960 - t * 640, 1010 - t * 220 + Math.sin(t * 9) * 26]);
      x.strokeStyle = rgba(night ? P.bright_cyan : '#ffffff', .4); x.lineWidth = 1.5;
      x.beginPath(); smoothPath(x, pts); x.stroke();
      pts.forEach(([px, py], i) => { if (i % 2) return; x.fillStyle = rgba(night ? (i % 6 ? P.bright_cyan : P.bright_magenta) : '#ffffff', .85); x.beginPath(); circle(x, px, py, 3.5 + Math.sin(i) * 1.4); x.fill(); });
      specks(x, 140, 1);
    };
    const [mc, mx] = layer();
    draw(mx);
    bloom(ctx, x => x.drawImage(mc, 0, 0, W, H), [60, 14], night ? [.8, .8] : [.35, .4]);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(mc, 0, 0); ctx.restore();
    vignette(ctx, P, night ? .6 : .2);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- water/harbor ----------

  // A harbor with moored boats and piers. Night lights it with red and green
  // beacons and sodium lamps that throw long reflections on the water.
  scene('water', 'harbor', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const hor = 520;
    const sodium = night ? tone(P.yellow, .82, 1.1) : P.yellow;
    const red = night ? tone(P.red, .66, 1.1) : tone(P.red, .55, 1.1);
    const green = night ? tone(P.green, .72, 1.1) : tone(P.green, .5, 1.1);
    const lights = [];

    // Sky.
    if (night) {
      skyGradient(ctx, [[0, P.darker_background], [.35, P.background], [hor / H, mixHex(P.lighter_background, P.orange, .12)], [1, P.background]]);
      stars(ctx, r, 220, [0, 0, W, hor * .7], [P.foreground, P.bright_blue, P.bright_yellow], 1.7);
      ctx.fillStyle = tone(P.bright_yellow, .93, .3);
      ctx.beginPath(); circle(ctx, 1560, 150, 34); ctx.fill();
      ctx.fillStyle = mixHex(P.darker_background, P.background, .6);
      ctx.beginPath(); circle(ctx, 1576, 140, 30); ctx.fill();
      bloom(ctx, x => { x.fillStyle = rgba(P.bright_yellow, .5); x.beginPath(); circle(x, 1560, 150, 34); x.fill(); }, [50], [.4]);
    } else {
      skyGradient(ctx, [[0, tone(P.blue, .74, .5)], [.4, tone(P.blue, .88, .3)], [hor / H, mixHex(P.background, '#ffffff', .3)], [1, P.background]]);
      const [cc, cx] = layer();
      for (let i = 0; i < 6; i++) {
        const x = (i + .5) / 6 * W + rr(r, -80, 80), y = rr(r, 200, 420), w = rr(r, 200, 380);
        cx.globalAlpha = rr(r, .6, .95);
        cumulus(cx, r, x, y, w, w * .28, '#ffffff', mixHex(P.background, P.blue, .12));
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(2.5); ctx.drawImage(cc, 0, 0); ctx.restore();
    }

    // Hills and the town across the water. Everything above the water also
    // goes on a layer for its reflection.
    const [rc, rx] = layer();
    const both = fn => { fn(ctx); rx.save(); rx.translate(0, hor * 2); rx.scale(1, -1); fn(rx); rx.restore(); };
    const hill = night ? mixHex(P.background, P.lighter_background, .7) : mixHex(tone(P.green, .62, .6), P.background, .35);
    const townC = night ? mixHex(P.darker_background, P.background, .5) : mixHex(tone(P.blue, .55, .35), P.background, .3);
    const hillPts = ridgePoints(n1, hor, 150, .0022, 3, 10, 4);
    both(c => fillRidge(c, hillPts.map(([x, y]) => [x, Math.min(hor, y + 30)]), hill));
    const houses = [];
    for (let x = -20; x < W + 20;) {
      const w = rr(r, 26, 70), h = rr(r, 26, 90) * (x > 600 && x < 1300 ? .6 : 1);
      houses.push({ x, w, h, roof: r() < .5, tint: r() });
      x += w + rr(r, 0, 10);
    }
    // Painted wooden houses by day: red, ochre, white and pale blue.
    const facade = night ? [townC] : [tone(P.red, .62, .75), tone(P.yellow, .8, .8), '#ffffff', tone(P.blue, .78, .55), tone(P.cyan, .8, .45), mixHex(P.background, '#ffffff', .5)];
    const roofC = night ? townC : tone(P.red, .45, .85);
    const winC = night ? townC : tone(P.blue, .35, .6);
    const haze = night ? townC : mixHex(P.background, '#ffffff', .2);
    both(c => {
      for (const hs of houses) {
        const y = hor - 6, wall = night ? townC : mixHex(facade[Math.floor(hs.tint * facade.length)], haze, .18);
        c.fillStyle = wall;
        c.fillRect(hs.x, y - hs.h, hs.w, hs.h + 6);
        if (!night) {
          // Shade on one side and small windows.
          c.fillStyle = rgba(tone(P.blue, .3, .5), .12); c.fillRect(hs.x + hs.w * .7, y - hs.h, hs.w * .3, hs.h + 6);
          c.fillStyle = rgba(winC, .55);
          for (let wy = y - 14; wy > y - hs.h + 6; wy -= 15) for (let wx = hs.x + 6; wx < hs.x + hs.w - 9; wx += 13) c.fillRect(wx, wy - 7, 5, 8);
        }
        if (hs.roof) {
          c.fillStyle = night ? townC : mixHex(roofC, haze, .15);
          c.beginPath(); c.moveTo(hs.x - 3, y - hs.h); c.lineTo(hs.x + hs.w / 2, y - hs.h - hs.w * .4); c.lineTo(hs.x + hs.w + 3, y - hs.h); c.fill();
        }
      }
      // A church tower.
      c.fillStyle = night ? townC : '#ffffff';
      c.fillRect(1380, hor - 170, 34, 170);
      c.fillStyle = night ? townC : tone(P.blue, .45, .7);
      c.beginPath(); c.moveTo(1376, hor - 170); c.lineTo(1397, hor - 250); c.lineTo(1418, hor - 170); c.fill();
      if (!night) { c.fillStyle = rgba(winC, .6); c.fillRect(1391, hor - 150, 12, 18); }
      // The quay.
      c.fillStyle = night ? mixHex(townC, '#000000', .3) : mixHex(P.foreground, P.background, .6);
      c.fillRect(-20, hor - 8, W + 40, 10);
    });
    // Lit windows in the town at night.
    if (night) {
      for (const hs of houses) {
        for (let wy = hor - 16; wy > hor - hs.h + 4; wy -= 14) for (let wx = hs.x + 5; wx < hs.x + hs.w - 8; wx += 12) {
          if (r() < .3) { ctx.fillStyle = rgba(tone(P.yellow, .8 + r() * .1, .9), .9); ctx.fillRect(wx, wy, 5, 7); if (r() < .3) lights.push({ x: wx + 2.5, y: wy, col: tone(P.yellow, .8, .9), size: 2, reflY: hor, len: 60 }); }
        }
      }
    }

    // The water.
    const wTop = night ? mixHex(P.background, P.lighter_background, .6) : tone(P.blue, .8, .5);
    const wLow = night ? P.darker_background : tone(P.blue, .55, .85);
    ctx.fillStyle = linear(ctx, 0, hor, 0, H, [[0, wTop], [1, wLow]]);
    ctx.fillRect(0, hor, W, H - hor);

    // Breakwater beacons: red on the left, green on the right.
    const beacon = (c, x, base, col) => {
      c.save(); c.translate(x, base); c.scale(1.45, 1.45); c.translate(-x, -base);
      c.fillStyle = night ? townC : mixHex(P.foreground, P.background, .45);
      c.fillRect(x - 60, base - 8, 120, 14);
      c.fillStyle = night ? mixHex(col, P.darker_background, .55) : col;
      c.beginPath(); c.moveTo(x - 11, base - 8); c.lineTo(x - 7, base - 78); c.lineTo(x + 7, base - 78); c.lineTo(x + 11, base - 8); c.fill();
      c.fillStyle = night ? townC : '#ffffff';
      c.fillRect(x - 8, base - 50, 16, 9);
      c.fillStyle = night ? townC : mixHex(P.foreground, P.background, .3);
      c.fillRect(x - 9, base - 92, 18, 14);
      c.restore();
    };
    const b1 = 560, b2 = 1300, bb = hor + 34;
    // The breakwater arms.
    const arm = (c, x0, x1) => { c.fillStyle = night ? mixHex(townC, '#000000', .2) : mixHex(P.foreground, P.background, .55); c.fillRect(x0, bb - 8, x1 - x0, 14); };
    rx.save(); rx.translate(0, bb * 2); rx.scale(1, -1); arm(rx, -20, b1 + 60); arm(rx, b2 - 60, W + 20); beacon(rx, b1, bb, red); beacon(rx, b2, bb, green); rx.restore();

    // Moored yachts, a fishing boat and a rowboat.
    const hullCols = night ? [mixHex(P.foreground, P.background, .45)] : ['#ffffff', tone(P.blue, .45, 1), tone(P.red, .55, 1), tone(P.green, .5, 1), tone(P.yellow, .75, 1)];
    const yacht = (c, x, y, s, dir, hc) => {
      c.save(); c.translate(x, y); c.scale(s * dir, s);
      c.fillStyle = hc;
      c.beginPath(); c.moveTo(-70, 0); c.lineTo(-74, -16); c.quadraticCurveTo(0, -13, 78, -22); c.quadraticCurveTo(70, -8, 60, 2); c.closePath(); c.fill();
      c.fillStyle = rgba('#000000', .2); c.fillRect(-72, -6, 140, 6);
      c.fillStyle = night ? mixHex(hc, '#000000', .2) : mixHex(hc, '#ffffff', .4);
      c.beginPath(); c.moveTo(-40, -15); c.lineTo(-34, -30); c.lineTo(14, -30); c.lineTo(26, -17); c.fill();
      c.fillStyle = night ? rgba(sodium, .8) : rgba(tone(P.blue, .3), .6);
      c.fillRect(-28, -27, 32, 6);
      c.strokeStyle = night ? mixHex(P.foreground, P.background, .5) : tone(P.foreground, .45, .5);
      c.lineWidth = 2.2; c.beginPath(); c.moveTo(0, -30); c.lineTo(0, -260); c.stroke();
      c.lineWidth = 1; c.beginPath(); c.moveTo(0, -255); c.lineTo(76, -22); c.moveTo(0, -255); c.lineTo(-72, -16); c.stroke();
      c.lineWidth = 5; c.beginPath(); c.moveTo(0, -42); c.lineTo(-62, -40); c.stroke();
      // The furled mainsail under a cover, and a rail at the stern.
      c.fillStyle = night ? mixHex(P.blue, P.darker_background, .5) : tone(P.blue, .45, 1);
      c.beginPath(); c.moveTo(-4, -50); c.quadraticCurveTo(-30, -54, -60, -46); c.lineTo(-60, -41); c.quadraticCurveTo(-30, -38, -4, -40); c.closePath(); c.fill();
      c.strokeStyle = night ? mixHex(P.foreground, P.background, .5) : tone(P.foreground, .55, .4); c.lineWidth = 1.6;
      c.beginPath(); c.moveTo(-74, -16); c.lineTo(-70, -30); c.lineTo(-48, -28); c.lineTo(-46, -15); c.stroke();
      c.restore();
    };
    const fishing = (c, x, y, s, dir) => {
      c.save(); c.translate(x, y); c.scale(s * dir, s);
      c.fillStyle = night ? mixHex(red, P.darker_background, .55) : red;
      c.beginPath(); c.moveTo(-80, 0); c.lineTo(-86, -22); c.quadraticCurveTo(10, -18, 92, -40); c.quadraticCurveTo(80, -12, 66, 2); c.closePath(); c.fill();
      c.fillStyle = night ? rgba('#000000', .3) : '#ffffff'; c.fillRect(-84, -24, 172, 5);
      c.fillStyle = night ? mixHex(P.foreground, P.background, .5) : '#ffffff';
      c.fillRect(-10, -74, 50, 52);
      c.fillStyle = night ? mixHex(P.foreground, P.background, .6) : tone(P.blue, .45, .9);
      c.fillRect(-14, -80, 58, 8);
      c.fillStyle = night ? rgba(sodium, .9) : rgba(tone(P.blue, .3), .7);
      c.fillRect(-2, -64, 12, 12); c.fillRect(16, -64, 12, 12);
      c.strokeStyle = night ? mixHex(P.foreground, P.background, .5) : tone(P.foreground, .4, .5); c.lineWidth = 3;
      c.beginPath(); c.moveTo(10, -80); c.lineTo(10, -170); c.moveTo(10, -150); c.lineTo(-70, -60); c.moveTo(10, -150); c.lineTo(80, -40); c.stroke();
      c.restore();
    };
    const rowboat = (c, x, y, s) => {
      c.save(); c.translate(x, y); c.scale(s, s);
      const hullC = night ? mixHex(P.cyan, P.darker_background, .55) : tone(P.cyan, .6, 1);
      // The inside of the boat, seen a little from above.
      c.fillStyle = night ? mixHex(P.brown, P.darker_background, .4) : tone(P.brown, .5, .8);
      c.beginPath(); c.moveTo(-62, -16); c.quadraticCurveTo(0, -30, 66, -20); c.quadraticCurveTo(0, -4, -62, -16); c.fill();
      c.strokeStyle = night ? mixHex(P.brown, P.darker_background, .2) : tone(P.brown, .62, .7); c.lineWidth = 4;
      c.beginPath(); c.moveTo(-12, -24); c.lineTo(-8, -12); c.moveTo(26, -25); c.lineTo(28, -13); c.stroke();
      // The hull.
      c.fillStyle = hullC;
      c.beginPath(); c.moveTo(-62, -16); c.quadraticCurveTo(0, -4, 66, -20); c.quadraticCurveTo(58, -2, 46, 2); c.quadraticCurveTo(0, 8, -48, 2); c.quadraticCurveTo(-58, -4, -62, -16); c.fill();
      c.strokeStyle = night ? mixHex(P.foreground, P.background, .6) : '#ffffff'; c.lineWidth = 2.5;
      c.beginPath(); c.moveTo(-62, -16); c.quadraticCurveTo(0, -4, 66, -20); c.stroke();
      c.restore();
    };
    const boats = [
      { y: hor + 40, draw: c => yacht(c, 900, hor + 40, .36, 1, hullCols[0]) },
      { y: hor + 56, draw: c => yacht(c, 1580, hor + 56, .42, -1, hullCols[1 % hullCols.length]) },
      { y: hor + 48, draw: c => yacht(c, 1120, hor + 48, .3, -1, hullCols[3 % hullCols.length]) },
      { y: 742, draw: c => yacht(c, 190, 742, .95, 1, hullCols[0]) },
      { y: 738, draw: c => fishing(c, 500, 738, 1.12, -1) },
      { y: 930, draw: c => yacht(c, 1440, 930, 1.35, -1, hullCols[2 % hullCols.length]) },
      { y: 945, draw: c => yacht(c, 1780, 945, 1.2, 1, hullCols[4 % hullCols.length]) },
      { y: 1010, draw: c => rowboat(c, 760, 1010, 1.7) },
    ];
    // Piers: decks on piles, with lamp posts.
    const pierC = night ? mixHex(P.darker_background, P.brown, .25) : tone(P.brown, .42, .7);
    const pierHi = night ? mixHex(P.background, P.brown, .35) : tone(P.brown, .58, .6);
    const pier = (c, x0, x1, deck, water, s) => {
      c.fillStyle = pierC;
      for (let x = x0 + 10; x < x1; x += 58 * s) c.fillRect(x, deck, 9 * s, water - deck + 4);
      c.strokeStyle = pierC; c.lineWidth = 3 * s;
      c.beginPath();
      for (let x = x0 + 10; x + 58 * s < x1; x += 58 * s) { c.moveTo(x + 4 * s, deck + 6); c.lineTo(x + 62 * s, water - 4); }
      c.stroke();
      c.fillStyle = pierHi; c.fillRect(x0, deck - 10 * s, x1 - x0, 6 * s);
      c.fillStyle = pierC; c.fillRect(x0, deck - 4 * s, x1 - x0, 10 * s);
    };
    const lamp = (c, x, deck, s) => {
      c.fillStyle = night ? P.darker_background : tone(P.foreground, .45, .5);
      c.fillRect(x - 2.5 * s, deck - 120 * s, 5 * s, 120 * s);
      c.beginPath(); c.moveTo(x - 9 * s, deck - 120 * s); c.lineTo(x + 9 * s, deck - 120 * s); c.lineTo(x + 5 * s, deck - 132 * s); c.lineTo(x - 5 * s, deck - 132 * s); c.fill();
      c.fillStyle = night ? sodium : mixHex(P.background, '#ffffff', .5);
      c.fillRect(x - 6 * s, deck - 120 * s, 12 * s, 5 * s);
    };
    const piers = [
      { y: 722, draw: c => { pier(c, -30, 720, 702, 734, 1); [110, 380, 650].forEach(x => lamp(c, x, 692, 1)); } },
      { y: 900, draw: c => { pier(c, 1180, W + 30, 872, 918, 1.5); [1300, 1570, 1840].forEach(x => lamp(c, x, 856, 1.5)); } },
    ];
    if (night) {
      [110, 380, 650].forEach(x => lights.push({ x, y: 692 - 117, col: sodium, size: 10, reflY: 734, len: 300 }));
      [1300, 1570, 1840].forEach(x => lights.push({ x, y: 856 - 117 * 1.5, col: sodium, size: 14, reflY: 918, len: 220 }));
      lights.push({ x: b1, y: bb - 85 * 1.45, col: red, size: 14, reflY: bb + 4, len: 460, beacon: true });
      lights.push({ x: b2, y: bb - 85 * 1.45, col: green, size: 14, reflY: bb + 4, len: 460, beacon: true });
      lights.push({ x: 190, y: 742 - 255 * .95, col: P.foreground, size: 3, reflY: 744, len: 200 });
      lights.push({ x: 1440, y: 930 - 255 * 1.35, col: P.foreground, size: 4, reflY: 932, len: 160 });
      lights.push({ x: 1780, y: 945 - 255 * 1.2, col: P.foreground, size: 3.5, reflY: 947, len: 140 });
      lights.push({ x: 900, y: hor + 40 - 255 * .36, col: red, size: 3, reflY: hor + 42, len: 120 });
      lights.push({ x: 1580, y: hor + 56 - 255 * .42, col: green, size: 3, reflY: hor + 58, len: 120 });
    }
    // Reflections of the boats and piers.
    for (const it of [...boats, ...piers]) { rx.save(); rx.translate(0, it.y * 2); rx.scale(1, -1); it.draw(rx); rx.restore(); }
    rippleCopy(ctx, rc, hor, H, n2, 9, t => (night ? .7 : .55) * (1 - t * .4), .12);

    // Ripples on the water.
    chop(ctx, r, n1, hor, rgba(night ? '#000000' : tone(P.blue, .4, .9), night ? .35 : .22), rgba(night ? P.lighter_background : '#ffffff', night ? .25 : .35), null, .7);

    // Long broken reflections of the lights.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (const L of lights) {
        ctx.fillStyle = L.col;
        for (let y = L.reflY; y < L.reflY + L.len; y += 2 + r() * 3.5) {
          const t = (y - L.reflY) / L.len, w = L.size * (1.2 + r() * 2.2) * (1 + t * 1.2);
          ctx.globalAlpha = (1 - t) ** 1.3 * (.35 + r() * .55) * (L.beacon ? 1 : .8);
          ctx.fillRect(L.x - w / 2 + n2(y * .08, L.x) * L.size * 1.5, y, w, 1 + t * 2.5);
        }
      }
      ctx.restore();
    }

    // The breakwater, the boats and the piers, back to front.
    arm(ctx, -20, b1 + 60); arm(ctx, b2 - 60, W + 20);
    beacon(ctx, b1, bb, red); beacon(ctx, b2, bb, green);
    [...boats, ...piers].sort((a, b) => a.y - b.y).forEach(it => it.draw(ctx));

    // Mooring lines from the boats to the piers.
    ctx.strokeStyle = night ? rgba(P.foreground, .25) : rgba(tone(P.foreground, .3, .5), .6); ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const [x0, y0, x1, y1] of [[260, 728, 300, 702], [130, 728, 80, 702], [560, 714, 620, 702], [1350, 912, 1300, 872], [1530, 910, 1580, 872], [1870, 926, 1900, 872], [1690, 928, 1660, 872]]) {
      ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, Math.max(y0, y1) + 12, x1, y1);
    }
    ctx.stroke();
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      for (const L of lights) if (L.size >= 10 && !L.beacon) {
        ctx.fillStyle = radial(ctx, L.x, L.y + 40, 0, 190, [[0, rgba(L.col, .28)], [1, rgba(L.col, 0)]]);
        ctx.fillRect(L.x - 200, L.y - 160, 400, 400);
      }
      ctx.restore();
      const glowAt = x => { for (const L of lights) { x.fillStyle = L.col; x.beginPath(); circle(x, L.x, L.y, L.size * (L.beacon ? 1 : .8)); x.fill(); } };
      glowAt(ctx);
      bloom(ctx, glowAt, [90, 24], [.7, .9]);
    }
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- birds/flamingos ----------

  // A flamingo with its foot at x, y, facing right when dir is 1. pose is
  // 'stand', 'feed' with the head down in the water, or 'rest' on one leg
  // with the head on the back. c holds the colors: body, deep, light, leg,
  // beak, tip.
  function flamingo(ctx, x, y, s, dir, pose, c) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(s * dir, s);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    // Legs: long and thin, with the ankle joint halfway.
    ctx.strokeStyle = c.leg; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(2, -118); ctx.lineTo(-4, -228); ctx.stroke();
    ctx.fillStyle = c.leg; ctx.beginPath(); circle(ctx, 2, -118, 5); ctx.fill();
    if (pose === 'rest') {
      ctx.beginPath(); ctx.moveTo(4, -226); ctx.lineTo(30, -150); ctx.lineTo(-12, -180); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(18, -2); ctx.lineTo(16, -116); ctx.lineTo(4, -228); ctx.stroke();
      ctx.beginPath(); circle(ctx, 16, -116, 4.6); ctx.fill();
    }
    // The body, tail and the black flight feathers.
    ctx.save();
    ctx.translate(-6, -262); ctx.rotate(pose === 'feed' ? .12 : -.18);
    const body = new Path2D();
    body.moveTo(72, -8); body.bezierCurveTo(70, -48, -20, -52, -62, -26); body.quadraticCurveTo(-108, -6, -104, 10);
    body.quadraticCurveTo(-70, 16, -40, 30); body.bezierCurveTo(0, 46, 66, 38, 72, -8);
    ctx.fillStyle = c.deep;
    ctx.beginPath(); ctx.moveTo(-60, 8); ctx.quadraticCurveTo(-104, 18, -126, 26); ctx.quadraticCurveTo(-96, 2, -56, -14); ctx.fill();
    ctx.fillStyle = linear(ctx, 0, -44, 0, 40, [[0, c.light], [.5, c.body], [1, c.deep]]);
    ctx.fill(body);
    ctx.save(); ctx.clip(body);
    ctx.fillStyle = c.tip;
    ctx.beginPath(); ctx.moveTo(-104, 12); ctx.quadraticCurveTo(-60, 4, -20, 22); ctx.lineTo(-30, 40); ctx.quadraticCurveTo(-80, 30, -110, 20); ctx.fill();
    // Wing coverts as soft scallops.
    ctx.strokeStyle = rgba(c.deep, .55); ctx.lineWidth = 2.4;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) { const px = -70 + i * 26 + k * 8, py = -6 + k * 11; ctx.moveTo(px - 12, py); ctx.quadraticCurveTo(px, py + 9, px + 12, py); }
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
    // Neck, head and the bent beak.
    ctx.strokeStyle = c.body; ctx.lineWidth = 11;
    ctx.beginPath();
    let hx, hy, ha;
    if (pose === 'feed') {
      ctx.moveTo(52, -276); ctx.bezierCurveTo(118, -300, 150, -210, 128, -110); ctx.quadraticCurveTo(116, -40, 112, -14);
      hx = 112; hy = -8; ha = Math.PI / 2;
    } else if (pose === 'rest') {
      ctx.moveTo(46, -288); ctx.bezierCurveTo(78, -330, 20, -360, -10, -322);
      hx = -16; hy = -318; ha = Math.PI * .9;
    } else {
      ctx.moveTo(48, -292); ctx.bezierCurveTo(98, -330, -14, -384, 24, -442); ctx.bezierCurveTo(36, -466, 64, -476, 80, -468);
      hx = 82; hy = -468; ha = .1;
    }
    ctx.stroke();
    ctx.strokeStyle = c.light; ctx.lineWidth = 3; ctx.globalAlpha = .6; ctx.stroke(); ctx.globalAlpha = 1;
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(ha);
    ctx.fillStyle = c.body; ctx.beginPath(); ellipse(ctx, 0, 0, 14, 11); ctx.fill();
    ctx.fillStyle = c.beak;
    ctx.beginPath(); ctx.moveTo(6, -9); ctx.quadraticCurveTo(26, -10, 32, -2); ctx.quadraticCurveTo(38, 8, 34, 24); ctx.quadraticCurveTo(26, 8, 6, 7); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.tip;
    ctx.beginPath(); ctx.moveTo(31, -3); ctx.quadraticCurveTo(38, 8, 34, 24); ctx.quadraticCurveTo(28, 10, 24, 6); ctx.closePath(); ctx.fill();
    ctx.fillStyle = c.tip; ctx.beginPath(); circle(ctx, 2, -3, 2.2); ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  // Flamingos standing in a shallow lagoon, with their reflections in soft haze.
  scene('birds', 'flamingos', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const hor = 590;
    const skyTop = night ? mixHex(P.darker_background, P.magenta, .1) : tone(P.cyan, .9, .35);
    const skyMid = night ? mixHex(P.background, P.magenta, .38) : tone(P.blue, .92, .35);
    const skyLow = night ? tone(P.orange, .7, .95) : tone(P.yellow, .93, .45);
    skyGradient(ctx, [[0, skyTop], [.32, skyMid], [hor / H, skyLow], [1, skyLow]]);
    // A low sun in the haze.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radial(ctx, 1180, hor - 40, 0, 700, [[0, rgba(night ? P.bright_yellow : '#ffffff', night ? .55 : .7)], [.3, rgba(night ? P.orange : '#ffffff', .2)], [1, rgba(P.orange, 0)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    ctx.fillStyle = rgba(night ? tone(P.bright_yellow, .95, .5) : '#ffffff', night ? .9 : .8);
    ctx.beginPath(); circle(ctx, 1180, hor - 40, 38); ctx.fill();

    // Far shore: low hills and mangroves, faint in the haze.
    const shore1 = mixHex(night ? mixHex(P.background, P.magenta, .35) : tone(P.green, .75, .35), skyLow, .55);
    const shore2 = mixHex(night ? mixHex(P.background, P.magenta, .25) : tone(P.green, .65, .4), skyLow, .35);
    const hill = ridgePoints(n1, hor - 8, 70, .002, 2, 10, 4);
    const trees = ridgePoints(n2, hor, 26, .012, 5, 6, 3);
    const [rc, rx] = layer();
    const both = fn => { fn(ctx); rx.save(); rx.translate(0, hor * 2); rx.scale(1, -1); fn(rx); rx.restore(); };
    both(c => { fillRidge(c, hill, shore1); fillRidge(c, trees, shore2); });

    // The lagoon, with sand bars.
    const wTop = night ? mixHex(skyLow, P.magenta, .15) : mixHex(skyLow, '#ffffff', .2);
    const wLow = night ? mixHex(P.darker_background, P.magenta, .2) : tone(P.cyan, .78, .5);
    ctx.fillStyle = linear(ctx, 0, hor, 0, H, [[0, wTop], [.5, mixHex(wTop, wLow, .6)], [1, wLow]]);
    ctx.fillRect(0, hor, W, H - hor);
    ctx.fillStyle = rgba(night ? tone(P.yellow, .55, .5) : tone(P.yellow, .9, .5), .35);
    for (const [y, h, x0, x1] of [[hor + 30, 6, 200, 900], [hor + 70, 10, 1200, 1900], [hor + 140, 16, -50, 700]]) {
      ctx.beginPath(); ellipse(ctx, (x0 + x1) / 2, y, (x1 - x0) / 2, h); ctx.fill();
    }

    const col = night
      ? { body: tone(P.blue, .48, 1), deep: tone(P.red, .36, .95), light: tone(P.bright_yellow, .8, .9), leg: tone(P.blue, .44, .85), beak: tone(P.bright_yellow, .7, .4), tip: P.darker_background }
      : { body: tone(P.blue, .74, .85), deep: tone(P.red, .62, .95), light: tone(P.bright_blue, .9, .6), leg: tone(P.blue, .68, .8), beak: tone(P.bright_yellow, .9, .4), tip: tone(P.foreground, .2, .5) };
    const haze = night ? mixHex(skyLow, P.magenta, .45) : skyLow;
    const fade = (cc, k) => Object.fromEntries(Object.entries(cc).map(([kk, v]) => [kk, mixHex(v, haze, k)]));
    const birds = [
      // far, small and hazy
      [760, hor + 26, .2, 1, 'stand', .6], [820, hor + 28, .19, -1, 'feed', .6], [880, hor + 25, .2, 1, 'rest', .6], [1460, hor + 30, .21, -1, 'stand', .6], [1510, hor + 32, .2, 1, 'feed', .6], [960, hor + 30, .18, 1, 'stand', .62],
      // middle
      [520, hor + 120, .5, 1, 'feed', .3], [640, hor + 128, .52, -1, 'stand', .3], [1330, hor + 132, .5, 1, 'rest', .3], [1440, hor + 124, .48, -1, 'stand', .3],
      // near
      [170, 1000, 1.08, 1, 'stand', 0], [400, 1040, .98, 1, 'rest', 0], [1590, 1020, 1.05, -1, 'feed', 0], [1800, 990, 1.1, -1, 'stand', 0],
    ];
    // The sun on the water.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = linear(ctx, 0, hor, 0, hor + 380, [[0, rgba(night ? P.bright_yellow : '#ffffff', night ? .5 : .55)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); ctx.moveTo(1150, hor); ctx.lineTo(1210, hor); ctx.lineTo(1300, hor + 380); ctx.lineTo(1060, hor + 380); ctx.closePath();
    ctx.filter = blurPx(18); ctx.fill(); ctx.filter = 'none';
    ctx.restore();
    // Reflections, then ripples, haze and the birds from far to near.
    for (const [x, y, s0, d, pose, h] of birds) {
      rx.save(); rx.translate(0, y * 2); rx.scale(1, -1); flamingo(rx, x, y, s0, d, pose, fade(col, h)); rx.restore();
    }
    rippleCopy(ctx, rc, hor, H, n2, 4, t => (night ? .55 : .5) * (1 - t * .3), .15);
    ctx.strokeStyle = rgba(night ? P.bright_yellow : '#ffffff', night ? .25 : .45); ctx.lineWidth = 1.4;
    for (let i = 0; i < 70; i++) {
      const y = hor + 6 + r() ** 1.6 * (H - hor), x = r() * W, l = 20 + (y - hor) * .25 * r();
      ctx.beginPath(); ctx.moveTo(x - l, y); ctx.lineTo(x + l, y); ctx.stroke();
    }
    let last = 1;
    for (const [x, y, s0, d, pose, h] of birds) {
      if (h < last) {
        // A band of haze between the depth layers.
        ctx.fillStyle = linear(ctx, 0, hor - 160, 0, y - 40, [[0, rgba(haze, 0)], [.6, rgba(haze, .18)], [1, rgba(haze, 0)]]);
        ctx.fillRect(0, hor - 160, W, y - hor + 120);
        last = h;
      }
      ctx.strokeStyle = rgba(night ? P.bright_yellow : '#ffffff', .5); ctx.lineWidth = 1.2 * s0;
      for (const ox of pose === 'rest' ? [0] : [0, 18]) { ctx.beginPath(); ellipse(ctx, x + ox * s0 * d, y, 22 * s0, 4 * s0); ctx.stroke(); }
      if (pose === 'feed') { ctx.beginPath(); ellipse(ctx, x + 112 * s0 * d, y, 30 * s0, 5 * s0); ctx.stroke(); }
      flamingo(ctx, x, y, s0, d, pose, fade(col, h));
    }
    // Soft haze over everything.
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, [[0, rgba(haze, 0)], [hor / H, rgba(haze, night ? .12 : .2)], [1, rgba(haze, 0)]]);
    ctx.fillRect(0, 0, W, H);
    vignette(ctx, P, night ? .45 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- birds/peacock-feather ----------

  // Peacock feather eyes in a repeating fan, iridescent.
  scene('birds', 'peacock-feather', (ctx, P, r) => {
    const night = P.night;
    const ox = 960, oy = 1560;
    const L = night ? 0 : .1;
    const gold = tone(P.yellow, .74 + L * .5, 1), bronze = tone(P.orange, .5 + L, .9), green = tone(P.green, .62 + L * .6, 1.15);
    const teal = tone(P.cyan, .74 + L * .4, 1.2), blue = tone(P.blue, .5 + L * .8, 1.2), navy = tone(P.blue, .2 + L * 1.6, 1), violet = tone(P.magenta, .45 + L, 1.1);
    const barbA = tone(P.green, .52 + L * .4, 1.1), barbB = tone(P.yellow, .66 + L * .4, 1);

    // Background: deep in the night, a pale silk in the day.
    skyGradient(ctx, night
      ? [[0, P.darker_background], [.6, P.background], [1, mixHex(P.background, P.green, .12)]]
      : [[0, P.background], [1, mixHex(P.background, P.green, .1)]]);
    ctx.fillStyle = radial(ctx, ox, oy, 200, 1600, [[0, rgba(night ? P.green : P.cyan, night ? .14 : .1)], [1, rgba(P.cyan, 0)]]);
    ctx.fillRect(0, 0, W, H);

    const rings = [[1580, 92, .1], [1290, 86, .6], [1010, 78, .15], [750, 70, .65], [500, 62, .2]];
    for (const [R, e, off] of rings) {
      const step = e * 3.1 / R;
      const feathers = [];
      for (let a = -Math.PI - step * off; a < step; a += step) feathers.push(a + rr(r, -.012, .012));
      for (const a of feathers) {
        const dx = Math.cos(a), dy = Math.sin(a), nx = -dy, ny = dx;
        const ex = ox + dx * R, ey = oy + dy * R;
        if (ex < -300 || ex > W + 300 || ey < -300 || ey > H + 360) continue;
        // Barbs along the shaft, longer toward the eye.
        const barbs = new Path2D(), fringe = new Path2D();
        for (let t = R - 380; t < R - e * .4; t += 3.2) {
          const k = (t - (R - 380)) / 380, len = 26 + k * e * 1.5;
          const sx = ox + dx * t, sy = oy + dy * t;
          for (const side of [-1, 1]) {
            const ba = a + side * (.5 + (1 - k) * .35) + rr(r, -.1, .1), bend = side * rr(r, .15, .4);
            barbs.moveTo(sx, sy);
            barbs.quadraticCurveTo(sx + Math.cos(ba) * len * .55, sy + Math.sin(ba) * len * .55, sx + Math.cos(ba + bend) * len, sy + Math.sin(ba + bend) * len);
          }
        }
        // A fringe of loose barbs around the eye.
        for (let i = 0; i < 110; i++) {
          const t = i / 110 * TAU, px = Math.cos(t) * e, py = Math.sin(t) * e * 1.3;
          const bx = ex + dx * py + nx * px, by = ey + dy * py + ny * px;
          const ba = Math.atan2(by - ey, bx - ex) + rr(r, -.3, .3), len = e * rr(r, .3, .85);
          fringe.moveTo(bx, by); fringe.quadraticCurveTo(bx + Math.cos(ba) * len * .5, by + Math.sin(ba) * len * .5, bx + Math.cos(ba + .2) * len, by + Math.sin(ba + .2) * len);
        }
        ctx.lineCap = 'round';
        ctx.lineWidth = 1.5; ctx.strokeStyle = rgba(barbA, night ? .5 : .55); ctx.stroke(barbs);
        ctx.lineWidth = .8; ctx.strokeStyle = rgba(barbB, night ? .5 : .6); ctx.stroke(barbs);
        ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(green, .65); ctx.stroke(fringe);
        ctx.lineWidth = .7; ctx.strokeStyle = rgba(gold, .7); ctx.stroke(fringe);
        // The shaft.
        ctx.strokeStyle = rgba(mixHex(gold, '#ffffff', .25), .75); ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(ox + dx * (R - 400), oy + dy * (R - 400)); ctx.lineTo(ex - dx * e * .4, ey - dy * e * .4); ctx.stroke();
        // The eye: a green rim, a broad bronze band and a turquoise ring round
        // a deep blue center.
        ctx.save();
        ctx.translate(ex, ey); ctx.rotate(a + Math.PI / 2);
        const band = (rx, ry, cy, stops) => { ctx.fillStyle = radial(ctx, 0, cy, 0, ry, stops); ctx.beginPath(); ellipse(ctx, 0, cy, rx, ry); ctx.fill(); };
        band(e, e * 1.3, 0, [[0, gold], [.8, mixHex(gold, green, .5)], [1, rgba(green, .9)]]);
        band(e * .86, e * 1.1, e * .06, [[0, bronze], [.75, mixHex(bronze, gold, .35)], [1, mixHex(gold, green, .3)]]);
        band(e * .6, e * .74, e * .14, [[0, teal], [.7, teal], [1, mixHex(teal, bronze, .5)]]);
        const hy = e * .2, hw = e * .42, hh = e * .5;
        ctx.fillStyle = radial(ctx, 0, hy + hh * .1, 0, hh * 1.1, [[0, navy], [.6, mixHex(navy, blue, .6)], [1, blue]]);
        ctx.beginPath();
        ctx.moveTo(0, hy - hh * .78);
        ctx.bezierCurveTo(hw * .5, hy - hh * 1.02, hw * 1.08, hy - hh * .6, hw, hy + hh * .1);
        ctx.bezierCurveTo(hw * .9, hy + hh * .75, hw * .4, hy + hh, 0, hy + hh);
        ctx.bezierCurveTo(-hw * .4, hy + hh, -hw * .9, hy + hh * .75, -hw, hy + hh * .1);
        ctx.bezierCurveTo(-hw * 1.08, hy - hh * .6, -hw * .5, hy - hh * 1.02, 0, hy - hh * .78);
        ctx.fill();
        // The fibers of the barbs run through the bands.
        ctx.strokeStyle = rgba(night ? '#000000' : bronze, .16); ctx.lineWidth = .8;
        ctx.beginPath();
        for (let i = 0; i < 48; i++) { const t = i / 48 * TAU; ctx.moveTo(Math.cos(t) * e * .3, hy * .5 + Math.sin(t) * e * .38); ctx.lineTo(Math.cos(t) * e, Math.sin(t) * e * 1.3); }
        ctx.stroke();
        // A sheen across the eye.
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = radial(ctx, -e * .25, -e * .35, 0, e * .9, [[0, rgba(violet, .35)], [.5, rgba(teal, .12)], [1, rgba(teal, 0)]]);
        ctx.beginPath(); ellipse(ctx, 0, 0, e, e * 1.3); ctx.fill();
        ctx.restore();
      }
    }
    // Iridescence: the hues shift across the fan.
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = linear(ctx, 0, 0, W, H, [[0, rgba(violet, .55)], [.5, rgba(teal, .2)], [1, rgba(gold, .5)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    if (!night) {
      // Daylight on silk: lift the shadows.
      ctx.fillStyle = rgba(P.background, .12); ctx.fillRect(0, 0, W, H);
    }
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- birds/kingfisher ----------

  // A kingfisher with its feet at x, y, facing right. c holds the colors:
  // blue, cyan, deep, rufous, white, beak, feet, eye.
  function kingfisher(ctx, x, y, s, c, r) {
    ctx.save();
    ctx.translate(x, y); ctx.scale(s, s);
    // Tail, behind the branch.
    ctx.fillStyle = c.deep;
    ctx.beginPath(); ctx.moveTo(-40, -30); ctx.lineTo(-92, 46); ctx.lineTo(-74, 54); ctx.lineTo(-22, -16); ctx.closePath(); ctx.fill();
    // Rufous breast and belly.
    ctx.save(); ctx.translate(14, -70); ctx.rotate(-.42);
    ctx.fillStyle = radial(ctx, 12, -10, 10, 90, [[0, tone(c.rufous, toOklch(c.rufous).L + .08)], [.7, c.rufous], [1, tone(c.rufous, toOklch(c.rufous).L - .12)]]);
    ctx.beginPath(); ellipse(ctx, 0, 0, 50, 80); ctx.fill();
    // Soft rows of breast feathers.
    ctx.strokeStyle = rgba(tone(c.rufous, toOklch(c.rufous).L - .1), .35); ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath();
    for (let k = 0; k < 5; k++) for (let i = 0; i < 4; i++) {
      const px = -30 + i * 18 + (k % 2) * 9, py = -40 + k * 20;
      if (Math.hypot(px / 46, py / 74) > .92) continue;
      ctx.moveTo(px - 7, py); ctx.quadraticCurveTo(px, py + 6, px + 7, py);
    }
    ctx.stroke();
    ctx.restore();
    // Wing and back.
    const wing = new Path2D();
    wing.moveTo(16, -142); wing.bezierCurveTo(-34, -150, -64, -90, -66, -40); wing.quadraticCurveTo(-68, 0, -56, 18);
    wing.quadraticCurveTo(-30, -10, -6, -60); wing.quadraticCurveTo(10, -100, 16, -142);
    ctx.fillStyle = linear(ctx, -60, -40, 10, -120, [[0, c.deep], [.6, c.blue], [1, tone(c.blue, toOklch(c.blue).L + .06)]]);
    ctx.fill(wing);
    ctx.save(); ctx.clip(wing);
    // Speckles on the wing coverts.
    ctx.fillStyle = rgba(c.cyan, .85);
    for (let i = 0; i < 60; i++) { const px = rr(r, -60, 10), py = rr(r, -130, -40); ctx.beginPath(); ellipse(ctx, px, py, 2.2, 1.3, -.8); ctx.fill(); }
    // The bright stripe down the back.
    ctx.strokeStyle = c.cyan; ctx.lineWidth = 9; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-8, -138); ctx.quadraticCurveTo(-52, -96, -62, -20); ctx.stroke();
    ctx.restore();
    // Head: crown, moustache, rufous cheek, white throat and neck patch.
    ctx.fillStyle = radial(ctx, 30, -175, 6, 60, [[0, tone(c.blue, toOklch(c.blue).L + .07)], [1, c.blue]]);
    ctx.beginPath(); circle(ctx, 38, -150, 44); ctx.fill();
    ctx.fillStyle = c.rufous;
    ctx.beginPath(); ctx.moveTo(62, -160); ctx.quadraticCurveTo(40, -168, 14, -158); ctx.quadraticCurveTo(10, -146, 22, -140); ctx.quadraticCurveTo(46, -146, 70, -150); ctx.fill();
    // A white flash on the side of the neck and a pale throat.
    ctx.fillStyle = c.white;
    ctx.beginPath(); ellipse(ctx, 6, -134, 14, 7.5, -.35); ctx.fill();
    ctx.save();
    ctx.beginPath(); circle(ctx, 38, -150, 44); ctx.clip();
    ctx.fillStyle = radial(ctx, 64, -114, 0, 22, [[0, c.white], [.75, c.white], [1, rgba(c.white, 0)]]);
    ctx.beginPath(); ellipse(ctx, 64, -114, 22, 16, -.3); ctx.fill();
    ctx.restore();
    ctx.fillStyle = c.deep;
    ctx.beginPath(); ctx.moveTo(72, -146); ctx.quadraticCurveTo(46, -138, 22, -138); ctx.quadraticCurveTo(44, -132, 66, -136); ctx.fill();
    ctx.fillStyle = rgba(c.cyan, .9);
    for (let i = 0; i < 36; i++) { const a = rr(r, Math.PI * 1.05, Math.PI * 1.95), d = rr(r, 14, 40); ctx.beginPath(); circle(ctx, 38 + Math.cos(a) * d, -150 + Math.sin(a) * d * .9, 1.6); ctx.fill(); }
    // The dagger beak.
    ctx.fillStyle = c.beak;
    ctx.beginPath(); ctx.moveTo(70, -162); ctx.lineTo(172, -146); ctx.lineTo(72, -138); ctx.closePath(); ctx.fill();
    ctx.fillStyle = mixHex(c.beak, c.rufous, .5);
    ctx.beginPath(); ctx.moveTo(72, -147); ctx.lineTo(118, -145); ctx.lineTo(72, -138); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = rgba('#ffffff', .25); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(76, -159); ctx.lineTo(160, -147); ctx.stroke();
    // Eye.
    ctx.fillStyle = c.eye; ctx.beginPath(); circle(ctx, 54, -160, 7.5); ctx.fill();
    ctx.fillStyle = rgba('#ffffff', .8); ctx.beginPath(); circle(ctx, 56.5, -162.5, 2.2); ctx.fill();
    // Feet on the branch.
    ctx.fillStyle = c.feet;
    ctx.beginPath(); ellipse(ctx, 2, -2, 10, 5); ellipse(ctx, 22, -2, 10, 5); ctx.fill();
    // A soft light on the crown and the breast.
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radial(ctx, 30, -176, 0, 40, [[0, rgba('#ffffff', .25)], [1, rgba('#ffffff', 0)]]);
    ctx.beginPath(); circle(ctx, 30, -176, 40); ctx.fill();
    ctx.restore();
  }

  // A kingfisher on a branch over a river, with soft leaves behind it.
  scene('birds', 'kingfisher', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(seedOf(r)), n2 = makeNoise(seedOf(r));
    const wl = 760;
    // Background: leaves out of focus over the river.
    const top = night ? mixHex(P.darker_background, P.blue, .15) : tone(P.green, .86, .45);
    const midC = night ? mixHex(P.background, P.blue, .3) : tone(P.cyan, .9, .4);
    skyGradient(ctx, [[0, top], [wl / H, midC], [1, midC]]);
    {
      const [bc, bx] = layer();
      const greens = night ? [tone(P.green, .3, .8), tone(P.blue, .32, .9), tone(P.cyan, .36, .8)] : [tone(P.green, .62, .9), tone(P.green, .74, .8), tone(P.green, .84, .6), tone(P.cyan, .74, .8)];
      for (let i = 0; i < 70; i++) {
        const x = r() * W, y = r() ** 1.4 * wl * .9, rad = rr(r, 40, 160);
        bx.fillStyle = rgba(pick(r, greens), rr(r, .35, .8));
        bx.beginPath(); circle(bx, x, y, rad); bx.fill();
      }
      // Bright spots of light through the leaves.
      for (let i = 0; i < 26; i++) {
        const x = r() * W, y = r() * wl * .8, rad = rr(r, 14, 40);
        bx.fillStyle = rgba(night ? tone(P.yellow, .75, .9) : '#ffffff', night ? rr(r, .25, .6) : rr(r, .4, .8));
        bx.beginPath(); circle(bx, x, y, rad); bx.fill();
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(34); ctx.drawImage(bc, 0, 0);
      // The leaves again, mirrored in the river.
      ctx.translate(0, wl * 2 * S); ctx.scale(1, -1); ctx.globalAlpha = .55; ctx.filter = blurPx(44); ctx.drawImage(bc, 0, 0);
      ctx.restore();
    }
    // The river.
    const wTop = night ? mixHex(P.background, P.blue, .3) : tone(P.cyan, .82, .55);
    const wLow = night ? P.darker_background : tone(P.blue, .6, .9);
    ctx.fillStyle = linear(ctx, 0, wl, 0, H, [[0, rgba(wTop, .5)], [1, rgba(wLow, .9)]]);
    ctx.fillRect(0, wl, W, H - wl);
    // The far bank.
    ctx.fillStyle = night ? rgba(P.darker_background, .6) : rgba(tone(P.green, .45, .8), .45);
    ctx.save(); ctx.filter = blurPx(6);
    ctx.beginPath(); ctx.moveTo(0, wl + 4); for (let x = 0; x <= W; x += 30) ctx.lineTo(x, wl - 8 - (fbm(n1, x / 200, 1, 3) * .5 + .5) * 26); ctx.lineTo(W, wl + 4); ctx.fill();
    ctx.restore();

    // The branch from the left, with twigs and a few leaves, and the bird.
    const bark = night ? tone(P.brown, .26, .7) : tone(P.brown, .42, .7);
    const barkHi = night ? tone(P.brown, .4, .6) : tone(P.brown, .6, .6);
    const leafC = night ? tone(P.green, .36, .8) : tone(P.green, .5, 1);
    const birdC = night
      ? { blue: tone(P.blue, .6, 1.05), cyan: tone(P.bright_blue, .82, 1.1), deep: tone(P.blue, .38, 1), rufous: tone(P.red, .62, 1.05), white: tone(P.foreground, .9, .5), beak: P.darker_background, feet: tone(P.red, .55, 1.1), eye: P.darker_background }
      : { blue: tone(P.blue, .58, 1.2), cyan: tone(P.cyan, .78, 1.3), deep: tone(P.blue, .4, 1.1), rufous: tone(P.red, .66, 1.15), white: '#ffffff', beak: tone(P.foreground, .18, .5), feet: tone(P.red, .58, 1.2), eye: tone(P.foreground, .12, .5) };
    const branchPts = [[-40, 668], [180, 650], [400, 628], [600, 612], [800, 594], [960, 572], [1060, 552]];
    const drawBranch = c => {
      c.lineCap = 'round'; c.lineJoin = 'round';
      // A tapered limb as a filled shape.
      const top = [], bot = [];
      branchPts.forEach(([x, y], i) => { const w = 38 - i * 5; top.push([x, y - w / 2]); bot.push([x, y + w / 2]); });
      c.fillStyle = linear(c, 0, 540, 0, 690, [[0, barkHi], [.5, bark], [1, mixHex(bark, '#000000', .3)]]);
      c.beginPath(); smoothPath(c, [...top, ...bot.reverse()], true); c.fill();
      // Bark lines.
      c.strokeStyle = rgba(mixHex(bark, '#000000', .35), .6); c.lineWidth = 1.4;
      c.beginPath();
      for (let i = 0; i < 26; i++) {
        const t = i / 26, x = lerp(-20, 980, t), y = lerp(668, 570, t) + (i % 3 - 1) * 4, l = 30 + (i % 4) * 12;
        c.moveTo(x, y); c.quadraticCurveTo(x + l / 2, y - 3, x + l, y - l * .1);
      }
      c.stroke();
      // Twigs.
      c.strokeStyle = bark;
      c.lineWidth = 6; c.beginPath(); c.moveTo(820, 592); c.quadraticCurveTo(880, 530, 960, 480); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.moveTo(900, 520); c.quadraticCurveTo(940, 500, 990, 506); c.stroke();
      c.lineWidth = 5; c.beginPath(); c.moveTo(280, 642); c.quadraticCurveTo(310, 700, 284, 752); c.stroke();
      c.fillStyle = leafC;
      for (const [x, y, a, l] of [[960, 480, -.7, 84], [962, 482, .2, 72], [990, 506, .5, 66], [284, 752, 1.9, 74], [470, 622, -2.3, 64], [1060, 552, -.15, 80], [1050, 556, .7, 62]]) {
        c.beginPath(); leaf(c, x, y, l, l * .3, a); c.fill();
        c.strokeStyle = rgba(mixHex(leafC, '#ffffff', .3), .5); c.lineWidth = 1.2;
        c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.cos(a) * l * .9, y + Math.sin(a) * l * .9); c.stroke();
      }
    };
    const bx0 = 560, by0 = 606, bs = 1.85, birdSeed = seedOf(r);
    {
      const [rc, rx] = layer();
      rx.save(); rx.translate(0, wl * 2); rx.scale(1, -1); drawBranch(rx); kingfisher(rx, bx0, by0, bs, birdC, rng(birdSeed)); rx.restore();
      rippleCopy(ctx, rc, wl, H, n2, 6, t => (night ? .45 : .5) * (1 - t * .6), .1);
    }
    // Ripples on the river.
    ctx.strokeStyle = rgba(night ? P.bright_blue : '#ffffff', night ? .25 : .5); ctx.lineCap = 'round';
    for (let i = 0; i < 90; i++) {
      const y = wl + 8 + r() ** 1.5 * (H - wl), x = r() * W, l = 14 + (y - wl) * .3 * r();
      ctx.lineWidth = 1 + (y - wl) / 220;
      ctx.beginPath(); ctx.moveTo(x - l, y); ctx.quadraticCurveTo(x, y - 2, x + l, y); ctx.stroke();
    }
    // Rings where a fish rose.
    for (let i = 0; i < 4; i++) {
      ctx.strokeStyle = rgba(night ? P.bright_blue : '#ffffff', .5 - i * .1); ctx.lineWidth = 1.6;
      ctx.beginPath(); ellipse(ctx, 1240, 900, 40 + i * 34, 7 + i * 6); ctx.stroke();
    }
    drawBranch(ctx);
    // A soft shadow under the bird, then the bird.
    kingfisher(ctx, bx0, by0, bs, birdC, rng(birdSeed));
    // Reeds at the right edge.
    const reed = night ? tone(P.green, .22, .7) : tone(P.green, .42, .9);
    ctx.fillStyle = reed;
    for (let i = 0; i < 22; i++) {
      const x = rr(r, 1640, W + 40), h = rr(r, 380, 760), lean = rr(r, -60, 40);
      ctx.beginPath(); ctx.moveTo(x - 5, H + 10); ctx.quadraticCurveTo(x + lean * .3, H - h * .6, x + lean, H - h); ctx.quadraticCurveTo(x + lean * .3 + 4, H - h * .6, x + 5, H + 10); ctx.fill();
    }
    ctx.fillStyle = night ? tone(P.brown, .3, .8) : tone(P.brown, .4, .9);
    for (const [x, y] of [[1700, 560], [1810, 470], [1880, 610]]) {
      ctx.beginPath(); ctx.roundRect(x - 9, y, 18, 70, 9); ctx.fill();
      ctx.fillRect(x - 1.5, y - 30, 3, 32);
    }
    if (night) {
      // Last light on the bird.
      bloom(ctx, x => kingfisher(x, bx0, by0, bs, birdC, rng(birdSeed)), [30], [.25]);
    }
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- birds/beetle ----------

  // The shell of a jewel beetle in close-up: metallic, from green at the
  // middle through teal and blue to violet at the edges.
  scene('birds', 'beetle', (ctx, P, r) => {
    const night = P.night;
    const L = night ? 0 : .08;
    const green = tone(P.green, .62 + L, 1.15), teal = tone(P.cyan, .58 + L, 1.2), blue = tone(P.magenta, .5 + L, 1.15), violet = tone(P.red, .42 + L, 1.15);
    const deep = tone(P.red, .2 + L, 1), gold = tone(P.yellow, .78 + L * .5, 1.1);

    // Background: a dark leaf at night, a pale one by day.
    skyGradient(ctx, night
      ? [[0, P.darker_background], [.5, P.background], [1, mixHex(P.background, P.green, .15)]]
      : [[0, P.background], [1, mixHex(P.background, P.green, .14)]]);
    {
      // Leaf veins, soft and large.
      const [vc, vx] = layer();
      vx.strokeStyle = rgba(night ? P.green : tone(P.green, .7, .6), night ? .12 : .22); vx.lineCap = 'round';
      vx.lineWidth = 16; vx.beginPath(); vx.moveTo(-100, 1180); vx.quadraticCurveTo(700, 520, 2100, -140); vx.stroke();
      vx.lineWidth = 7;
      for (let i = 0; i < 9; i++) {
        const t = i / 8, x = lerp(0, 1900, t), y = lerp(1130, -90, t) + (i % 2 ? 0 : 0);
        vx.beginPath(); vx.moveTo(x, y); vx.quadraticCurveTo(x + 260, y + 40, x + 520, y + 260); vx.stroke();
        vx.beginPath(); vx.moveTo(x, y); vx.quadraticCurveTo(x - 60, y - 260, x - 20, y - 520); vx.stroke();
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(10); ctx.drawImage(vc, 0, 0); ctx.restore();
    }

    ctx.save();
    ctx.translate(1090, 640); ctx.rotate(-.62); ctx.scale(1.3, 1.3);
    // Shapes in beetle space: the head points to -y.
    const elytron = side => {
      const p = new Path2D();
      p.moveTo(side * 4, -262);
      p.bezierCurveTo(side * 120, -268, side * 236, -262, side * 248, -200);
      p.bezierCurveTo(side * 262, -60, side * 254, 200, side * 200, 380);
      p.bezierCurveTo(side * 150, 520, side * 40, 600, side * 4, 610);
      p.closePath();
      return p;
    };
    const pron = new Path2D();
    pron.moveTo(-190, -262); pron.bezierCurveTo(-200, -330, -170, -410, -120, -432); pron.quadraticCurveTo(0, -452, 120, -432);
    pron.bezierCurveTo(170, -410, 200, -330, 190, -262); pron.quadraticCurveTo(0, -250, -190, -262); pron.closePath();
    const head = new Path2D();
    head.moveTo(-100, -430); head.bezierCurveTo(-110, -500, -60, -540, 0, -542); head.bezierCurveTo(60, -540, 110, -500, 100, -430); head.closePath();

    // Shadow on the leaf.
    const all = new Path2D(); all.addPath(elytron(-1)); all.addPath(elytron(1)); all.addPath(pron); all.addPath(head);
    softShadow(ctx, all, 40, 40, 40, rgba(night ? '#000000' : tone(P.green, .3, .6), night ? .7 : .3));
    // Legs and antennae: dark, glossy, tapered segments.
    const legC = night ? tone(P.red, .24, .9) : tone(P.red, .32, 1);
    const seg = (x0, y0, x1, y1, w0, w1) => {
      const a = Math.atan2(y1 - y0, x1 - x0), nx = -Math.sin(a), ny = Math.cos(a);
      const p = new Path2D();
      p.moveTo(x0 + nx * w0, y0 + ny * w0); p.lineTo(x1 + nx * w1, y1 + ny * w1); p.lineTo(x1 - nx * w1, y1 - ny * w1); p.lineTo(x0 - nx * w0, y0 - ny * w0); p.closePath();
      ctx.fillStyle = legC; ctx.fill(p);
      ctx.beginPath(); circle(ctx, x1, y1, w1); ctx.fill();
      if (w1 > 4) {
        ctx.strokeStyle = rgba(teal, .35); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(x0 + nx * w0 * .5, y0 + ny * w0 * .5); ctx.lineTo(x1 + nx * w1 * .5, y1 + ny * w1 * .5); ctx.stroke();
      }
    };
    for (const side of [-1, 1]) {
      for (const [y0, a1, a2] of [[-300, -.7, -1.2], [-110, .05, -.25], [70, .55, 1.05]]) {
        const kx = side * 300, ky = y0 + 70 * a1, fx = side * 400, fy = y0 + 230 * a2;
        seg(side * 150, y0, kx, ky, 15, 11);
        seg(kx, ky, fx, fy, 9, 6);
        const tx = fx + side * 22, ty = fy + 34 * Math.sign(a2);
        seg(fx, fy, tx, ty, 5, 4);
        seg(tx, ty, tx + side * 14, ty + 24 * Math.sign(a2), 4, 2);
      }
      // Short saw-toothed antennae.
      let ax = side * 46, ay = -536;
      for (let k = 0; k < 10; k++) {
        const nx2 = ax + side * (8 + k * .6), ny2 = ay - 17;
        ctx.fillStyle = legC;
        ctx.beginPath(); ctx.moveTo(ax + side * 3, ay); ctx.lineTo(nx2 + side * 6, ny2 + 4); ctx.lineTo(nx2, ny2); ctx.lineTo(ax - side * 3, ay - 2); ctx.closePath(); ctx.fill();
        ax = nx2; ay = ny2;
      }
    }
    // The elytra: metallic color across each one, deeper at the edges.
    for (const side of [-1, 1]) {
      const p = elytron(side);
      ctx.fillStyle = linear(ctx, 0, 0, side * 256, 0, [[0, mixHex(green, gold, .25)], [.3, green], [.58, teal], [.8, blue], [.94, violet], [1, deep]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      // Toward the tip the color runs to blue and violet.
      ctx.fillStyle = linear(ctx, 0, -200, 0, 620, [[0, rgba(gold, .18)], [.5, rgba(teal, 0)], [1, rgba(violet, .55)]]);
      ctx.fill(p);
      // Grooves with fine pits along the shell.
      for (let k = 1; k <= 9; k++) {
        const u = k / 10, pts = [];
        for (let y = -250; y < 600; y += 7) {
          const half = y < -200 ? 240 : y < 380 ? 250 - (y + 200) * .05 : 220 * Math.sqrt(Math.max(0, 1 - ((y - 380) / 240) ** 2));
          pts.push([side * (8 + u * half * .95), y]);
        }
        ctx.strokeStyle = rgba(deep, .35); ctx.lineWidth = 3;
        ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke();
        ctx.fillStyle = rgba(deep, .45);
        ctx.beginPath();
        pts.forEach(([x, y], i) => { if (i % 2) return; ctx.moveTo(x + 2, y); ctx.ellipse(x, y, 2, 2.8, 0, 0, TAU); });
        ctx.fill();
        ctx.strokeStyle = rgba('#ffffff', .14); ctx.lineWidth = 1.5;
        ctx.save(); ctx.translate(side * 4, 0); ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke(); ctx.restore();
      }
      // Chrome-like light: a dark band of reflected shade, a broad soft
      // highlight and a sharp line of light.
      ctx.fillStyle = linear(ctx, side * 130, 0, side * 240, 0, [[0, rgba(deep, 0)], [.5, rgba(deep, .45)], [1, rgba(deep, .1)]]);
      ctx.beginPath(); ellipse(ctx, side * 185, 60, 60, 520); ctx.fill();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = linear(ctx, side * 40, 0, side * 200, 0, [[0, rgba('#ffffff', 0)], [.35, rgba('#ffffff', night ? .45 : .55)], [.7, rgba('#ffffff', 0)]]);
      ctx.beginPath(); ellipse(ctx, side * 110, 40, 70, 420); ctx.fill();
      ctx.filter = blurPx(2);
      ctx.strokeStyle = rgba('#ffffff', night ? .85 : .9); ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(side * 96, -210); ctx.bezierCurveTo(side * 118, -40, side * 118, 160, side * 92, 330); ctx.stroke();
      ctx.filter = 'none';
      ctx.strokeStyle = rgba(gold, .45); ctx.lineWidth = 20;
      ctx.beginPath(); ctx.moveTo(side * 34, -230); ctx.lineTo(side * 30, 300); ctx.stroke();
      ctx.fillStyle = radial(ctx, side * 200, 470, 0, 160, [[0, rgba(violet, .7)], [1, rgba(violet, 0)]]);
      ctx.beginPath(); circle(ctx, side * 200, 470, 160); ctx.fill();
      // The bright window of the light on the shoulder.
      ctx.fillStyle = radial(ctx, side * 120, -190, 0, 70, [[0, rgba('#ffffff', night ? .7 : .8)], [.5, rgba('#ffffff', .25)], [1, rgba('#ffffff', 0)]]);
      ctx.beginPath(); ellipse(ctx, side * 120, -190, 60, 46); ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      // A rim of reflected light at the outer edge.
      ctx.strokeStyle = rgba(teal, .7); ctx.lineWidth = 6; ctx.stroke(p);
      ctx.restore();
    }
    // The seam between the elytra.
    ctx.strokeStyle = deep; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, -262); ctx.lineTo(0, 610); ctx.stroke();
    // Pronotum and head.
    ctx.fillStyle = linear(ctx, -200, 0, 200, 0, [[0, violet], [.2, blue], [.5, mixHex(green, gold, .3)], [.8, blue], [1, violet]]);
    ctx.fill(pron);
    ctx.save(); ctx.clip(pron);
    ctx.fillStyle = rgba(deep, .25);
    ctx.beginPath();
    for (let i = 0; i < 200; i++) { const x = rr(r, -190, 190), y = rr(r, -440, -260); ctx.moveTo(x + 1.6, y); ctx.ellipse(x, y, 1.6, 1.6, 0, 0, TAU); }
    ctx.fill();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = radial(ctx, -60, -380, 0, 140, [[0, rgba('#ffffff', night ? .5 : .6)], [1, rgba('#ffffff', 0)]]);
    ctx.fillRect(-200, -460, 400, 220);
    ctx.restore();
    ctx.strokeStyle = rgba(deep, .8); ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-190, -262); ctx.quadraticCurveTo(0, -250, 190, -262); ctx.stroke();
    ctx.fillStyle = linear(ctx, -100, 0, 100, 0, [[0, violet], [.5, teal], [1, violet]]);
    ctx.fill(head);
    // Large eyes at the sides of the head, with a soft sheen.
    for (const side of [-1, 1]) {
      ctx.fillStyle = radial(ctx, side * 80, -480, 0, 44, [[0, mixHex(deep, violet, .4)], [1, mixHex(deep, '#000000', .35)]]);
      ctx.beginPath(); ellipse(ctx, side * 82, -478, 20, 40, side * -.25); ctx.fill();
      ctx.fillStyle = rgba('#ffffff', .22);
      ctx.beginPath(); ellipse(ctx, side * 78, -494, 7, 14, side * -.25); ctx.fill();
    }
    ctx.restore();

    // A slow shift of the sheen across the frame.
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = linear(ctx, 0, H, W, 0, [[0, rgba(violet, .4)], [.5, rgba(green, .1)], [1, rgba(teal, .35)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    vignette(ctx, P, night ? .55 : .14);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
  // ---------- night/moon-charms ----------

  // Charm outlines, centered at 0, 0 with a size of about 1.
  const charmPath = {
    moon: () => {
      const p = new Path2D(), R = 1, R2 = .82, d = .48;
      const x = (R * R - R2 * R2 + d * d) / (2 * d), y = Math.sqrt(R * R - x * x);
      const phi = Math.atan2(y, x), psi = Math.atan2(y, x - d);
      p.arc(0, 0, R, -phi, phi, true); p.arc(d, 0, R2, psi, -psi, false); p.closePath();
      return p;
    },
    star: () => {
      const p = new Path2D();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rad = i % 2 ? .45 : 1; (i ? p.lineTo.bind(p) : p.moveTo.bind(p))(Math.cos(a) * rad, Math.sin(a) * rad); }
      p.closePath();
      return p;
    },
    sparkle: () => {
      const p = new Path2D();
      p.moveTo(0, -1); p.quadraticCurveTo(.12, -.12, 1, 0); p.quadraticCurveTo(.12, .12, 0, 1); p.quadraticCurveTo(-.12, .12, -1, 0); p.quadraticCurveTo(-.12, -.12, 0, -1); p.closePath();
      return p;
    },
    cross: () => {
      const p = new Path2D();
      p.roundRect(-.16, -1, .32, 2, .1); p.roundRect(-.62, -.52, 1.24, .32, .1);
      return p;
    },
    bat: () => {
      // The right half from the head down to the tail, mirrored for the left.
      const s0 = [0, -.1], segs = [
        [null, [.05, -.34]], [null, [.12, -.12]], [[.3, -.16], [.5, -.36]], [[.75, -.52], [1, -.46]],
        [[.9, -.3], [.93, -.04]], [[.78, -.14], [.68, .08]], [[.54, -.04], [.44, .16]], [[.32, .05], [.2, .2]], [[.12, .32], [0, .36]],
      ];
      const p = new Path2D();
      p.moveTo(...s0);
      segs.forEach(([c, e]) => (c ? p.quadraticCurveTo(c[0], c[1], e[0], e[1]) : p.lineTo(e[0], e[1])));
      for (let i = segs.length - 1; i >= 0; i--) {
        const [c] = segs[i], t = i ? segs[i - 1][1] : s0;
        if (c) p.quadraticCurveTo(-c[0], c[1], -t[0], t[1]); else p.lineTo(-t[0], t[1]);
      }
      p.closePath();
      return p;
    },
  };
  const charmCache = {};
  const charmOf = k => charmCache[k] || (charmCache[k] = charmPath[k]());

  // Crescent moons, stars, small crosses and tiny bats in pastel pink, lilac
  // and mint: hanging from fine chains and scattered over the ground.
  scene('night', 'moon-charms', (ctx, P, r) => {
    const night = P.night;
    const pastel = night
      ? [P.bright_red, P.bright_blue, P.bright_green, P.bright_magenta, P.bright_cyan]
      : [tone(P.red, .8, .75), tone(P.blue, .78, .8), tone(P.green, .8, .7), tone(P.magenta, .8, .75), tone(P.cyan, .8, .7)];
    const silver = night ? tone(P.foreground, .8, .4) : tone(P.foreground, .62, .4);

    // Ground: near black, or a pale lilac grey, with soft pastel mist.
    skyGradient(ctx, night ? [[0, P.darker_background], [.5, P.background], [1, P.darker_background]] : [[0, P.background], [1, P.dark_background]]);
    ctx.save(); ctx.globalCompositeOperation = night ? 'screen' : 'multiply';
    for (const [x, y, rad, c] of [[260, 200, 640, pastel[0]], [1700, 300, 700, pastel[1]], [1100, 1080, 760, pastel[2]]]) {
      ctx.fillStyle = radial(ctx, x, y, 0, rad, [[0, rgba(c, night ? .1 : .16)], [1, rgba(c, 0)]]);
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
    // Tiny star dust.
    stars(ctx, r, 260, [0, 0, W, H], pastel, 1.4);

    const charm = (c, kind, x, y, size, rot, col, glow) => {
      const p = charmOf(kind);
      c.save(); c.translate(x, y); c.rotate(rot); c.scale(size, size);
      if (!glow) {
        c.save();
        c.shadowColor = rgba(night ? '#000000' : tone(P.blue, .35, .5), night ? .7 : .28);
        c.shadowBlur = size * .25 * S; c.shadowOffsetX = size * .06 * S; c.shadowOffsetY = size * .1 * S;
        c.fillStyle = col; c.fill(p);
        c.restore();
      }
      c.fillStyle = linear(c, -1, -1, 1, 1, [[0, mixHex(col, '#ffffff', .35)], [.55, col], [1, tone(col, toOklch(col).L - .12, 1.1)]]);
      c.fill(p);
      if (!glow) {
        c.lineJoin = 'round';
        c.strokeStyle = rgba(silver, .9); c.lineWidth = .07; c.stroke(p);
        c.strokeStyle = rgba('#ffffff', .5); c.lineWidth = .03;
        c.save(); c.clip(p); c.translate(.05, .07); c.stroke(p); c.restore();
        c.fillStyle = radial(c, -.3, -.4, 0, .5, [[0, rgba('#ffffff', .65)], [1, rgba('#ffffff', 0)]]);
        c.save(); c.clip(p); c.fillRect(-1, -1, 2, 2); c.restore();
      }
      c.restore();
    };
    const kinds = ['moon', 'star', 'cross', 'bat', 'sparkle', 'moon', 'bat', 'star'];

    // Hanging charms on fine chains from the top edge.
    const hang = [], placed = [];
    const xs = [120, 300, 470, 640, 1290, 1450, 1620, 1800];
    xs.forEach((x0, i) => {
      const len = rr(r, 90, 300) + (i % 2) * 60, size = rr(r, 34, 54), sway = rr(r, -.08, .08);
      const x = x0 + Math.sin(sway) * len, y = len + size * 1.15;
      hang.push([kinds[(i * 3) % 4], x, y, size, sway, pastel[i % pastel.length], x0, len]);
      placed.push([x, y, size * 1.4]);
      for (let yy = 0; yy < len; yy += 40) placed.push([lerp(x0, x, yy / len), yy, 6]);
    });
    // Scattered charms, more toward the edges than the middle.
    const items = [];
    for (let tries = 0; items.length < 70 && tries < 6000; tries++) {
      const x = rr(r, 30, W - 30), y = rr(r, 40, H - 30);
      const dx = (x - W / 2) / (W / 2), dy = (y - H * .55) / (H * .45), e = Math.max(Math.abs(dx), Math.abs(dy));
      if (e < .55 && r() < .8) continue;
      const size = rr(r, 12, 30) * (e > .7 ? 1.25 : 1);
      if (placed.some(([px, py, ps]) => Math.hypot(px - x, py - y) < (ps + size) * 1.7)) continue;
      placed.push([x, y, size]);
      items.push([pick(r, kinds), x, y, size, rr(r, -.5, .5), pick(r, pastel)]);
    }
    const drawAll = (c, glow) => {
      for (const it of items) charm(c, it[0], it[1], it[2], it[3], it[4], it[5], glow);
      for (const [kind, x, y, size, sway, col, x0, len] of hang) {
        if (!glow) {
          // The chain: small links in a row.
          c.strokeStyle = silver; c.lineWidth = 1.6;
          const n = Math.floor(len / 9);
          for (let k = 0; k < n; k++) {
            const t = k / n, lx = lerp(x0, x, t), ly = lerp(-5, len, t);
            c.beginPath();
            if (k % 2) ellipse(c, lx, ly, 1.6, 4.4, -sway); else ellipse(c, lx, ly, 3.2, 4.6, -sway);
            c.stroke();
          }
          c.lineWidth = 2.4; c.beginPath(); ellipse(c, x, len + 4, 5, 6); c.stroke();
        }
        charm(c, kind, x, y + 6, size, sway * .6, col, glow);
      }
    };
    if (night) bloom(ctx, c => drawAll(c, true), [46, 12], [.6, .45]);
    drawAll(ctx, false);
    vignette(ctx, P, night ? .5 : .1);
    grain(ctx, seedOf(r), night ? .05 : .035);
  });
})();
