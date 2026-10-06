// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Still life: fruit and glass.
(() => {
  const TAU = Math.PI * 2;
  const BLACK = '#000000', WHITE = '#ffffff';

  // ---------- local helpers ----------

  // The hue of hex at OKLCH lightness L, with its chroma scaled by Cx.
  const tone = (hex, L, Cx = 1) => { const o = toOklch(hex); return oklch(L, o.C * Cx, o.h); };
  // The hue of hex at lightness L with at least the chroma C. Day palettes
  // lose chroma in their dark yellows and oranges, and this brings it back.
  const vivid = (hex, L, C) => { const o = toOklch(hex); return oklch(L, Math.max(o.C, C), o.h); };

  // Gradient stops that fade out like a soft spot of light.
  const fade = (color, a) => [[0, rgba(color, a)], [.2, rgba(color, a * .86)], [.42, rgba(color, a * .55)], [.65, rgba(color, a * .24)], [.85, rgba(color, a * .06)], [1, rgba(color, 0)]];

  // A soft elliptical spot: a shadow, a glow or a pool of light.
  function spot(ctx, x, y, rx, ry, color, a, rot = 0) {
    if (rx <= 0 || ry <= 0) return;
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot); ctx.scale(1, ry / rx);
    ctx.fillStyle = radial(ctx, 0, 0, 0, rx, fade(color, a));
    ctx.fillRect(-rx, -rx, rx * 2, rx * 2);
    ctx.restore();
  }

  // A smooth profile through [y, radius] points, for a solid of revolution.
  function profile(pts, steps = 10) {
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[Math.max(i - 1, 0)], b = pts[i], c = pts[i + 1], d = pts[Math.min(i + 2, pts.length - 1)];
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        const f = j => .5 * (2 * b[j] + (c[j] - a[j]) * t + (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t2 + (3 * b[j] - a[j] - 3 * c[j] + d[j]) * t3);
        out.push([f(0), Math.max(0, f(1))]);
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
  // The radius of a profile at height y.
  function radAt(prof, y) {
    for (let i = 0; i < prof.length - 1; i++) {
      const [y0, r0] = prof[i], [y1, r1] = prof[i + 1];
      if (y >= y0 && y <= y1) return y1 === y0 ? r0 : lerp(r0, r1, (y - y0) / (y1 - y0));
    }
    return y < prof[0][0] ? prof[0][1] : prof[prof.length - 1][1];
  }
  // The part of a profile between 2 heights.
  function cut(prof, y0, y1) {
    const out = [[y0, radAt(prof, y0)]];
    prof.forEach(p => { if (p[0] > y0 && p[0] < y1) out.push(p); });
    out.push([y1, radAt(prof, y1)]);
    return out;
  }
  // The outline of a solid of revolution between the fractions k0 and k1 of
  // its radius. k = -1 is the left edge and k = 1 the right edge.
  function lathe(cx, prof, k0 = -1, k1 = 1) {
    const p = new Path2D();
    prof.forEach(([y, rad], i) => (i ? p.lineTo(cx + k0 * rad, y) : p.moveTo(cx + k0 * rad, y)));
    for (let i = prof.length - 1; i >= 0; i--) p.lineTo(cx + k1 * prof[i][1], prof[i][0]);
    p.closePath();
    return p;
  }
  // Fills a solid of revolution row by row in output pixels, so bands of
  // alpha leave no seams. fn returns [hex, alpha] at the fraction k of the radius.
  function latheFill(ctx, cx, prof, fn, y0 = prof[0][0], y1 = prof[prof.length - 1][0]) {
    const strip = document.createElement('canvas'), n = 160;
    strip.width = n; strip.height = 1;
    const sx = strip.getContext('2d'), img = sx.createImageData(n, 1);
    for (let i = 0; i < n; i++) {
      const [hex, a] = fn(-1 + 2 * (i + .5) / n), c = rgb(hex);
      img.data[i * 4] = c[0]; img.data[i * 4 + 1] = c[1]; img.data[i * 4 + 2] = c[2]; img.data[i * 4 + 3] = Math.round(clamp(a, 0, 1) * 255);
    }
    sx.putImageData(img, 0, 0);
    const m = ctx.getTransform();
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    const d0 = Math.ceil(m.d * y0 + m.f), d1 = Math.floor(m.d * y1 + m.f);
    for (let yd = d0; yd < d1; yd++) {
      const rad = radAt(prof, (yd + .5 - m.f) / m.d);
      if (rad <= .05) continue;
      const xa = m.a * (cx - rad) + m.e, xb = m.a * (cx + rad) + m.e;
      ctx.drawImage(strip, 0, 0, n, 1, xa, yd, xb - xa, 1);
    }
    ctx.restore();
  }
  // A highlight strip on a solid of revolution that fades in and out along its height.
  function streak(ctx, cx, prof, y0, y1, k0, k1, color, a) {
    if (y1 <= y0) return;
    ctx.fillStyle = linear(ctx, 0, y0, 0, y1, [[0, rgba(color, 0)], [.18, rgba(color, a)], [.7, rgba(color, a * .8)], [1, rgba(color, 0)]]);
    ctx.fill(lathe(cx, cut(prof, y0, y1), k0, k1));
  }

  // A tapered stroke through [x, y, width] points, for branches and stems.
  function taper(pts) {
    const L = [], R = [];
    pts.forEach((p, i) => {
      const a = pts[Math.max(i - 1, 0)], b = pts[Math.min(i + 1, pts.length - 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1, w = p[2] / 2;
      L.push([p[0] - dy / d * w, p[1] + dx / d * w]);
      R.push([p[0] + dy / d * w, p[1] - dx / d * w]);
    });
    const path = new Path2D();
    smoothPath(path, [...L, ...R.reverse()], true);
    return path;
  }

  // A tube along an axis of [x, y, radius] points, for stalks and long fruit.
  // band gives the strip between the fractions k0 and k1 of the radius,
  // and k0 and k1 can be functions of the point index.
  function tube(axis) {
    const n = axis.length;
    const nrm = axis.map((p, i) => {
      const a = axis[Math.max(i - 1, 0)], b = axis[Math.min(i + 1, n - 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy) || 1;
      return [-dy / d, dx / d];
    });
    const at = (i, k) => [axis[i][0] + nrm[i][0] * axis[i][2] * k, axis[i][1] + nrm[i][1] * axis[i][2] * k];
    const band = (k0, k1, i0 = 0, i1 = n - 1) => {
      const f0 = typeof k0 === 'function' ? k0 : () => k0, f1 = typeof k1 === 'function' ? k1 : () => k1;
      const p = new Path2D();
      for (let i = i0; i <= i1; i++) { const q = at(i, f0(i)); i === i0 ? p.moveTo(q[0], q[1]) : p.lineTo(q[0], q[1]); }
      for (let i = i1; i >= i0; i--) { const q = at(i, f1(i)); p.lineTo(q[0], q[1]); }
      p.closePath();
      return p;
    };
    // A gradient along the axis with the color of each point.
    const along = (ctx, color, stops = 14, i0 = 0, i1 = n - 1) => {
      const [x0, y0] = axis[i0], [x1, y1] = axis[i1], dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy || 1;
      const g = ctx.createLinearGradient(x0, y0, x1, y1);
      for (let s = 0; s < stops; s++) {
        const i = Math.round(lerp(i0, i1, s / (stops - 1)));
        g.addColorStop(clamp(((axis[i][0] - x0) * dx + (axis[i][1] - y0) * dy) / len2, 0, 1), color(i));
      }
      return g;
    };
    // Shades the tube in bands. color gives the color at band k and point i.
    const shade = (ctx, color, count = 40, stops = 14) => {
      for (let b = 0; b < count; b++) {
        const k0 = -1 + 2 * b / count, k1 = Math.min(1, k0 + 2 / count + .02), k = (k0 + k1) / 2;
        ctx.fillStyle = along(ctx, i => color(k, i), stops);
        ctx.fill(band(k0, k1));
      }
    };
    // The 3D normal at band k and point i, with z toward the viewer.
    const normal = (k, i) => { const z = Math.sqrt(Math.max(0, 1 - k * k)); return [nrm[i][0] * k, nrm[i][1] * k, z]; };
    // The band where a light in direction h makes the brightest shine.
    const peak = (h, i) => { const a = nrm[i][0] * h[0] + nrm[i][1] * h[1]; return a / Math.hypot(a, h[2]); };
    return { n, axis, nrm, at, band, along, shade, normal, peak, outline: band(-1, 1) };
  }
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const unit = v => { const d = Math.hypot(...v); return v.map(x => x / d); };



  // A copy of the picture so far, for refraction inside glass.
  function snapshot(ctx) {
    const [c, x] = layer();
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.drawImage(ctx.canvas, 0, 0);
    return c;
  }
  // Draws a snapshot inside clip, flipped and scaled around the point cx, cy, as a lens does.
  function refract(ctx, snap, clip, cx, cy, sx, sy, alpha = 1) {
    ctx.save();
    ctx.clip(clip);
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy); ctx.scale(sx, sy); ctx.translate(-cx, -cy);
    ctx.drawImage(snap, 0, 0, W, H);
    ctx.restore();
  }

  // Clips to a box with a margin, so a blur filter works only on that box.
  function clipBox(ctx, x0, y0, x1, y1, m = 40) { ctx.beginPath(); ctx.rect(x0 - m, y0 - m, x1 - x0 + 2 * m, y1 - y0 + 2 * m); ctx.clip(); }
  // The box around the points of an axis, widened by the largest radius.
  function axisBox(axis) {
    const rad = Math.max(...axis.map(p => p[2]));
    return [Math.min(...axis.map(p => p[0])) - rad, Math.min(...axis.map(p => p[1])) - rad, Math.max(...axis.map(p => p[0])) + rad, Math.max(...axis.map(p => p[1])) + rad];
  }

  // Light from a window of 2 by 2 panes, cast as a slanted patch on a wall.
  function windowLight(ctx, x, y, w, h, skew, color, a, soft = 14) {
    ctx.save();
    clipBox(ctx, x, y, x + w + Math.max(0, skew), y + h, soft * 3);
    ctx.filter = blurPx(soft);
    ctx.fillStyle = rgba(color, a);
    const gap = w * .05, pw = (w - gap) / 2, ph = (h - gap) / 2;
    ctx.beginPath();
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const x0 = x + i * (pw + gap), y0 = y + j * (ph + gap), s0 = skew * (y0 - y) / h, s1 = skew * (y0 + ph - y) / h;
      poly(ctx, [[x0 + s0, y0], [x0 + pw + s0, y0], [x0 + pw + s1, y0 + ph], [x0 + s1, y0 + ph]]);
    }
    ctx.fill();
    ctx.restore();
  }

  // Round dots of light, out of focus. Soft edges come from the gradient, so
  // no blur filter is needed.
  function bokeh(ctx, r, count, area, colors, size, alpha, soft = .5) {
    const [x0, y0, x1, y1] = area, e = 1 - soft * .6;
    for (let i = 0; i < count; i++) {
      const x = lerp(x0, x1, r()), y = lerp(y0, y1, r()), s = size * (.4 + r() * .9), c = colors[Math.floor(r() * colors.length)];
      const a = alpha * (.35 + r() * .65);
      ctx.fillStyle = radial(ctx, x, y, 0, s, [[0, rgba(c, a * .5)], [e * .8, rgba(c, a * .6)], [e, rgba(c, a * .62)], [lerp(e, 1, .5), rgba(c, a * .3)], [1, rgba(c, 0)]]);
      ctx.beginPath(); circle(ctx, x, y, s); ctx.fill();
    }
  }

  // A low resolution texture from a function of u and v that returns [r, g, b, a], drawn over the area.
  function texture(ctx, cols, rows, fn, x = 0, y = 0, w = W, h = H, alpha = 1, op = 'source-over') {
    const c = document.createElement('canvas');
    c.width = cols; c.height = rows;
    const tx = c.getContext('2d'), img = tx.createImageData(cols, rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const v = fn(i / (cols - 1), j / (rows - 1)), k = (j * cols + i) * 4;
      img.data[k] = v[0]; img.data[k + 1] = v[1]; img.data[k + 2] = v[2]; img.data[k + 3] = v[3];
    }
    tx.putImageData(img, 0, 0);
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = alpha; ctx.globalCompositeOperation = op;
    ctx.drawImage(c, x, y, w, h);
    ctx.restore();
  }

  // ---------- fruit ----------

  scene('fruit', 'persimmons', (ctx, P, r) => {
    const N = P.night, noise = makeNoise(r() * 1e9 | 0);
    const dusk = P.magenta, fruit = P.accent;

    // The sky in soft bands, as the bokashi of a woodblock print: deep color
    // at the top and a warm glow low down.
    if (N) skyGradient(ctx, [[0, tone(dusk, .13, .6)], [.16, tone(dusk, .18, .6)], [.5, tone(dusk, .27, .5)], [.78, tone(P.yellow, .38, .45)], [.92, tone(fruit, .44, .6)], [1, tone(fruit, .36, .6)]]);
    else skyGradient(ctx, [[0, tone(dusk, .6, .7)], [.12, tone(dusk, .74, .5)], [.3, tone(dusk, .9, .25)], [.58, P.background], [.85, tone(fruit, .9, .35)], [1, tone(fruit, .85, .45)]]);

    // Wood grain of the print block, faint in the sky.
    texture(ctx, 320, 180, (u, v) => {
      const g = fbm(noise, u * 3, v * 40, 3) * .5 + .5;
      return [0, 0, 0, clamp((g - .45) * 200, 0, 255)];
    }, 0, 0, W, H, N ? .05 : .035);

    // The moon at night, a low red sun by day.
    const mx = 1250, my = 290, mr = 120;
    if (N) {
      spot(ctx, mx, my, mr * 4.4, mr * 4.4, tone(P.yellow, .8, .3), .2);
      ctx.fillStyle = radial(ctx, mx - mr * .3, my - mr * .3, 0, mr * 1.1, [[0, tone(P.yellow, .96, .25)], [1, tone(P.yellow, .87, .35)]]);
      ctx.beginPath(); circle(ctx, mx, my, mr); ctx.fill();
      ctx.save(); ctx.beginPath(); circle(ctx, mx, my, mr); ctx.clip();
      [[-.3, -.1, .4], [.28, .22, .3], [-.05, .45, .22], [.32, -.36, .2]].forEach(([u, v, s]) => spot(ctx, mx + u * mr, my + v * mr, s * mr, s * mr * .85, tone(dusk, .62, .3), .32));
      ctx.restore();
    } else {
      spot(ctx, mx, my, mr * 3.2, mr * 3.2, tone(fruit, .95, .4), .45);
      ctx.fillStyle = tone(P.red, .68, .8);
      ctx.globalAlpha = .85;
      ctx.beginPath(); circle(ctx, mx, my, mr); ctx.fill();
      ctx.globalAlpha = 1;
    }

    // A far peak with snow on its top.
    const pkx = 1520, pky = 900, pkw = 470, pkh = 380;
    const pk = new Path2D();
    pk.moveTo(pkx - pkw, pky);
    pk.bezierCurveTo(pkx - pkw * .55, pky - pkh * .3, pkx - pkw * .16, pky - pkh * .9, pkx - pkw * .07, pky - pkh);
    pk.lineTo(pkx + pkw * .07, pky - pkh);
    pk.bezierCurveTo(pkx + pkw * .16, pky - pkh * .9, pkx + pkw * .55, pky - pkh * .3, pkx + pkw, pky);
    pk.closePath();
    const pkC = N ? tone(dusk, .17, .5) : tone(dusk, .7, .45);
    ctx.fillStyle = linear(ctx, 0, pky - pkh, 0, pky, [[0, pkC], [.7, rgba(pkC, .6)], [1, rgba(pkC, 0)]]);
    ctx.fill(pk);
    ctx.save(); ctx.clip(pk);
    // The snow reaches down the gullies in narrow fingers.
    const cap = [[pkx - pkw * .6, pky - pkh * .8]];
    for (let i = 1; i < 24; i++) {
      const x = pkx - pkw * .6 + i * pkw * .05, deep = i % 2 ? .52 + r() * .16 : .76 + r() * .04;
      cap.push([x + (i % 2 ? (r() - .5) * 8 : 0), pky - pkh * deep]);
    }
    cap.push([pkx + pkw * .6, pky - pkh * .8], [pkx + pkw * .6, 0], [pkx - pkw * .6, 0]);
    ctx.fillStyle = N ? tone(P.yellow, .62, .2) : WHITE;
    ctx.beginPath(); smoothPath(ctx, cap, true, .25); ctx.fill();
    ctx.restore();

    // Low hills, each dark at its ridge and pale below, with bands of mist.
    const kasumi = (x0, x1, y, h, a) => {
      const c = N ? tone(dusk, .42, .3) : WHITE, p = new Path2D();
      p.roundRect(x0, y, x1 - x0, h, h / 2);
      p.roundRect(x0 + (x1 - x0) * .2, y - h * .55, (x1 - x0) * .45, h, h / 2);
      ctx.fillStyle = linear(ctx, 0, y - h * .6, 0, y + h, [[0, rgba(c, a)], [.75, rgba(c, a * .85)], [1, rgba(c, a * .2)]]);
      ctx.fill(p);
    };
    const hills = [
      [940, 140, .0012, N ? tone(dusk, .26, .45) : tone(dusk, .7, .4)],
      [1000, 110, .0019, N ? tone(dusk, .19, .5) : tone(dusk, .6, .42)],
      [1065, 90, .0026, N ? tone(dusk, .13, .5) : tone(P.green, .5, .4)],
    ];
    hills.forEach(([base, amp, freq, col], i) => {
      const pts = [];
      for (let x = -20; x <= W + 20; x += 10) pts.push([x, base - (fbm(noise, x * freq + i * 7.3, i * 3.1, 2) * .5 + .62) * amp]);
      fillRidge(ctx, pts, linear(ctx, 0, base - amp * 1.2, 0, base + 60, [[0, col], [1, mixHex(col, N ? tone(dusk, .3, .4) : WHITE, .55)]]));
      if (i === 0) { kasumi(-80, 700, base - 80, 40, N ? .3 : .8); kasumi(1100, 2000, base - 40, 34, N ? .28 : .75); }
      if (i === 1) { kasumi(200, 1080, base - 50, 30, N ? .22 : .65); kasumi(1450, 1980, base - 120, 24, N ? .2 : .6); }
    });

    // Bare branches that grow in from the corners.
    const limbs = [], tips = [];
    function grow(x, y, a, len, w, depth) {
      const n = Math.max(3, Math.round(len / 36)), pts = [[x, y, w]], a0 = a;
      for (let i = 1; i <= n; i++) {
        a += (r() - .5) * .55;
        if (depth === 3) a = lerp(a, a0, .35);
        x += Math.cos(a) * len / n; y += Math.sin(a) * len / n;
        pts.push([x, y, Math.max(3.2, w * (1 - i / n * .72))]);
      }
      limbs.push(pts);
      if (depth === 0) { tips.push([x, y]); return; }
      const kids = 2 + Math.floor(r() * 2);
      for (let k = 0; k < kids; k++) {
        const i = 1 + Math.floor((k + r()) / kids * (n - 1));
        const [px, py, pw] = pts[i], side = k % 2 ? 1 : -1;
        grow(px, py, a + side * (.45 + r() * .55) + .25, len * (.42 + r() * .22), pw * .72, depth - 1);
      }
      if (depth === 1) tips.push([x, y]);
    }
    grow(-40, 150, .2, 980, 46, 3);
    grow(1970, 70, Math.PI - .55, 720, 40, 3);
    grow(-30, 860, -.35, 330, 26, 2);

    const bark = N ? tone(P.brown, .16, .6) : tone(P.brown, .26, .65);
    const barkLit = N ? tone(dusk, .42, .3) : tone(P.brown, .5, .45), moonRim = tone(P.yellow, .84, .35);
    // Each limb has a lit edge. At night the edge faces the moon and is brighter near it.
    const rimOf = (x, y) => {
      if (!N) return [barkLit, 1.2, 2.6];
      const dx = mx - x, dy = my - y, d = Math.hypot(dx, dy) || 1, k = fit(d, 150, 1500, 3, 1.6);
      return [mixHex(barkLit, moonRim, fit(d, 150, 1500, .85, .35)), -dx / d * k, -dy / d * k];
    };
    limbs.forEach(pts => {
      const path = taper(pts), [rc, ox, oy] = rimOf(...pts[Math.floor(pts.length / 2)]);
      ctx.fillStyle = rc; ctx.fill(path);
      ctx.save(); ctx.clip(path); ctx.translate(ox, oy); ctx.fillStyle = bark; ctx.fill(path); ctx.restore();
    });

    // Persimmons hang from the tips: a squat body, 4 lobes and a leafy calyx.
    const body = (R) => {
      const p = new Path2D();
      for (let i = 0; i <= 72; i++) {
        const t = i / 72 * TAU, c = Math.cos(t), s = Math.sin(t);
        const px = Math.sign(c) * Math.abs(c) ** .8 * R, py = Math.sign(s) * Math.abs(s) ** .85 * R * .84;
        i ? p.lineTo(px, py) : p.moveTo(px, py);
      }
      p.closePath();
      return p;
    };
    const lit = tone(P.yellow, N ? .8 : .84, 1.1), mid = tone(fruit, N ? .66 : .7, 1.1), deep = tone(P.red, N ? .46 : .54, 1);
    const calyx = tone(P.green, N ? .42 : .45, .55), line = tone(P.brown, .22, .6);
    const calyxLit = N ? mixHex(calyx, moonRim, .5) : tone(P.green, .64, .5);
    const placed = [];
    tips.filter(([x, y]) => y > 40 && y < 820 && x > -20 && x < W + 20).forEach(([x, y]) => {
      const R = 30 + r() * 26, stem = 8 + R * .3, cy = y + stem + R * .76;
      if (placed.length >= 16 || placed.some(([px, py, pr]) => Math.hypot(px - x, py - cy) < (pr + R) * 1.05)) return;
      placed.push([x, cy, R]);
      const tilt = (r() - .5) * .35;
      // A short woody stem runs from the tip down to the calyx, and the fruit turns on the calyx.
      const kx = x + tilt * stem * .5, ky = y + stem, fx = kx - Math.sin(tilt) * R * .76, fy = ky + Math.cos(tilt) * R * .76;
      if (N) spot(ctx, fx, fy, R * 2.4, R * 2.4, mid, .14);
      const [rc, ox, oy] = rimOf(x, y), sp = new Path2D();
      sp.moveTo(x, y - 3); sp.quadraticCurveTo(x + (kx - x) * .3 + 2, (y + ky) / 2, kx, ky + 2);
      ctx.lineCap = 'round';
      ctx.strokeStyle = rc; ctx.lineWidth = 6.5; ctx.stroke(sp);
      ctx.save(); ctx.translate(ox * .55, oy * .55); ctx.strokeStyle = bark; ctx.lineWidth = 5.5; ctx.stroke(sp); ctx.restore();
      ctx.fillStyle = bark; ctx.beginPath(); circle(ctx, x, y, 4); ctx.fill();
      ctx.save();
      ctx.translate(fx, fy); ctx.rotate(tilt);
      const p = body(R);
      ctx.fillStyle = radial(ctx, -R * .3, -R * .3, R * .05, R * 1.15, [[0, lit], [.45, mid], [1, deep]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.fillStyle = linear(ctx, -R, -R, R, R, [[.55, rgba(deep, 0)], [1, rgba(tone(P.red, .35), .55)]]);
      ctx.fillRect(-R, -R, 2 * R, 2 * R);
      ctx.strokeStyle = rgba(deep, .35); ctx.lineWidth = 1.6;
      [-.42, .42].forEach(k => { ctx.beginPath(); ctx.moveTo(k * R * .5, -R * .8); ctx.quadraticCurveTo(k * R * 1.25, 0, k * R * .45, R * .84); ctx.stroke(); });
      ctx.restore();
      ctx.strokeStyle = rgba(line, .6); ctx.lineWidth = 1.4; ctx.stroke(p);
      ctx.fillStyle = rgba(WHITE, N ? .32 : .55);
      ctx.beginPath(); ellipse(ctx, -R * .38, -R * .38, R * .22, R * .11, -.5); ctx.fill();
      // The calyx: 4 broad sepals with a lit upper edge, and the knob of the stem.
      const sepals = [[Math.PI + .25, .7, .3], [-.25, .7, .3], [Math.PI / 2 + .3, .38, .24], [Math.PI / 2 - .35, .34, .22]];
      [[calyxLit, 0], [calyx, 1.8]].forEach(([c, dy]) => {
        ctx.fillStyle = c;
        sepals.forEach(([a, l, w2]) => { ctx.beginPath(); leaf(ctx, 0, -R * .76 + dy, R * l, R * w2, a); ctx.fill(); });
      });
      ctx.fillStyle = tone(P.brown, N ? .3 : .35, .6);
      ctx.beginPath(); ellipse(ctx, 0, -R * .78, R * .15, R * .09); ctx.fill();
      ctx.fillStyle = rgba(calyxLit, .8);
      ctx.beginPath(); ellipse(ctx, -R * .03, -R * .81, R * .07, R * .03); ctx.fill();
      ctx.restore();
    });

    // A few birds far away.
    ctx.strokeStyle = N ? tone(dusk, .2, .5) : tone(P.brown, .35, .5); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const bx = 960 + i * 50 + r() * 30, by = 500 + Math.sin(i * 1.3) * 24 + r() * 20, s = 7 + r() * 5;
      ctx.beginPath(); ctx.moveTo(bx - s, by - s * .3); ctx.quadraticCurveTo(bx - s * .4, by - s * .5, bx, by); ctx.quadraticCurveTo(bx + s * .4, by - s * .5, bx + s, by - s * .3); ctx.stroke();
    }

    paper(ctx, P, r() * 1e9 | 0, .9);
    vignette(ctx, P, N ? .42 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  // Honeycomb: wax cells full of honey, with drips down into calm space.
  scene('fruit', 'honeycomb', (ctx, P, r) => {
    const N = P.night, noise = makeNoise(r() * 1e9 | 0);
    const amber = mixHex(P.yellow, P.accent, .45);
    const honeyHi = tone(P.yellow, N ? .86 : .9, .95), honey = tone(P.accent, N ? .66 : .74, 1.15), honeyLo = tone(P.magenta, N ? .4 : .5, 1.1);
    const wax = tone(amber, N ? .6 : .87, .7), waxLo = tone(P.accent, N ? .36 : .68, .7), waxHi = tone(amber, N ? .78 : .95, .5);
    const capHi = tone(amber, N ? .88 : .98, .3), cap = tone(amber, N ? .76 : .91, .45), capLo = tone(amber, N ? .56 : .78, .6);

    // Warm light behind the comb.
    if (N) skyGradient(ctx, [[0, tone(P.accent, .2, .6)], [.6, P.background], [1, P.darker_background]]);
    else skyGradient(ctx, [[0, tone(P.yellow, .95, .35)], [.6, P.background], [1, tone(P.accent, .9, .3)]]);
    spot(ctx, 1500, 760, 900, 520, N ? tone(P.accent, .5) : WHITE, N ? .22 : .6);

    // The comb covers the upper left. Its lower edge runs down to the left.
    const R = 44, cw = Math.sqrt(3) * R, rowH = R * 1.5;
    const edge = x => 300 + (x < 0 ? 0 : x) * -.06 + 260 * smooth(clamp(1 - x / 1500, 0, 1)) + fbm(noise, x * .004, 3, 3) * 120;
    const hex = (x, y, s, rr = 0) => {
      const p = new Path2D(), pts = [];
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; pts.push([x + Math.cos(a) * s, y + Math.sin(a) * s]); }
      if (!rr) { poly(p, pts); return p; }
      pts.forEach((q, i) => {
        const a = pts[(i + 5) % 6], b = pts[(i + 1) % 6];
        const p0 = [lerp(q[0], a[0], rr), lerp(q[1], a[1], rr)], p1 = [lerp(q[0], b[0], rr), lerp(q[1], b[1], rr)];
        i ? p.lineTo(p0[0], p0[1]) : p.moveTo(p0[0], p0[1]);
        p.quadraticCurveTo(q[0], q[1], p1[0], p1[1]);
      });
      p.closePath();
      return p;
    };

    const cells = [];
    for (let row = -1; row * rowH < 1100; row++) {
      for (let col = -1; col * cw < W + cw; col++) {
        const x = col * cw + (row % 2 ? cw / 2 : 0) - 20, y = row * rowH + 10;
        const d = edge(x) - y;
        if (d < -R * .3) continue;
        cells.push({ x, y, d, key: `${row},${col}`, row, col });
      }
    }
    // A cell at the lower edge has no cell below it, so honey can drip from it.
    const have = new Set(cells.map(c => c.key));
    cells.forEach(c => {
      const below = c.row % 2 ? [c.col, c.col + 1] : [c.col - 1, c.col];
      c.low = !below.some(k => have.has(`${c.row + 1},${k}`));
    });

    // A soft shadow under the comb, then the wax sheet.
    ctx.save();
    ctx.filter = blurPx(30);
    ctx.fillStyle = rgba(N ? BLACK : tone(P.brown, .4), N ? .55 : .25);
    const sheet = new Path2D();
    cells.forEach(c => sheet.addPath(hex(c.x, c.y + 26, R + 6)));
    ctx.fill(sheet);
    ctx.restore();
    const sheet0 = new Path2D();
    cells.forEach(c => sheet0.addPath(hex(c.x, c.y, R + 4)));
    ctx.fillStyle = linear(ctx, 0, 0, 0, 900, [[0, waxHi], [.7, wax], [1, waxLo]]);
    ctx.fill(sheet0);

    const drips = [];
    cells.forEach(c => {
      const { x, y, d } = c, inner = hex(x, y, R - 5.5, .28);
      const kind = d < R * .8 ? (r() < .5 ? 'empty' : 'honey') : (r() < .14 ? 'cap' : r() < .08 ? 'empty' : 'honey');
      if (kind === 'cap') {
        // A wax cap: a pale, matte dome.
        ctx.fillStyle = radial(ctx, x - R * .25, y - R * .3, 2, R * 1.1, [[0, capHi], [.55, cap], [1, capLo]]);
        ctx.fill(inner);
        ctx.fillStyle = rgba(WHITE, N ? .12 : .3);
        for (let i = 0; i < 8; i++) { ctx.beginPath(); circle(ctx, x + (r() - .5) * R, y + (r() - .5) * R, 1 + r() * 2); ctx.fill(); }
      } else {
        // The empty part of a cell is deep and dark.
        ctx.fillStyle = radial(ctx, x, y + R * .2, 2, R, [[0, tone(P.accent, N ? .14 : .45, .7)], [.7, tone(P.accent, N ? .22 : .58, .6)], [1, waxLo]]);
        ctx.fill(inner);
        if (kind === 'honey') {
          const level = r() < .65 ? 0 : r() * .5, yl = y - R + level * 2 * R, shade = .9 + r() * .2;
          ctx.save(); ctx.clip(inner);
          if (level > 0) { ctx.beginPath(); ctx.rect(x - R, yl, 2 * R, 2 * R); ctx.clip(); }
          ctx.fillStyle = radial(ctx, x + R * .1, y + R * .3, 1, R * 1.05, [[0, honeyHi], [.45, tone(honey, toOklch(honey).L * shade)], [.85, honeyLo], [1, tone(P.brown, N ? .3 : .45, .9)]]);
          ctx.fill(inner);
          ctx.restore();
          if (level > 0) {
            // The meniscus where the honey meets the empty part.
            ctx.save(); ctx.clip(inner);
            ctx.strokeStyle = rgba(honeyHi, .8); ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(x - R, yl + 3); ctx.quadraticCurveTo(x, yl - 3, x + R, yl + 3); ctx.stroke();
            ctx.restore();
          } else {
            ctx.strokeStyle = rgba(WHITE, N ? .5 : .75); ctx.lineWidth = 3; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.arc(x, y + 2, R * .62, Math.PI * 1.12, Math.PI * 1.5); ctx.stroke();
          }
          ctx.fillStyle = rgba(WHITE, N ? .75 : .95);
          ctx.beginPath(); ellipse(ctx, x - R * .3, Math.max(y - R * .32, yl + 8), 4.5, 3, -.6); ctx.fill();
          ctx.fillStyle = rgba(honeyHi, .5);
          ctx.beginPath(); ellipse(ctx, x + R * .15, y + R * .42, R * .3, R * .12); ctx.fill();
          if (c.low && level < .2 && r() < .65) drips.push([x + (r() - .5) * R * .5, y + R * .55]);
        }
      }
      // Inner bevel: dark at the top edge, light at the bottom edge.
      ctx.save(); ctx.clip(inner);
      ctx.strokeStyle = linear(ctx, 0, y - R, 0, y + R, [[0, rgba(BLACK, N ? .45 : .22)], [.5, rgba(BLACK, 0)], [1, rgba(WHITE, N ? .2 : .45)]]);
      ctx.lineWidth = 7; ctx.stroke(inner);
      ctx.restore();
    });
    // The far part of the comb falls into shade.
    ctx.save(); ctx.clip(sheet0);
    ctx.fillStyle = radial(ctx, 0, 0, 0, 1100, [[0, rgba(N ? BLACK : tone(P.brown, .4, .6), N ? .5 : .22)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // Honey drips: a thin neck and a full drop at the end.
    drips.forEach(([x, y]) => {
      const len = 40 + r() ** 1.6 * 380, w = 7 + r() * 7, dr = w * (1.1 + r() * .5), by = y + len;
      const p = new Path2D();
      p.moveTo(x - w * 2.2, y - 6);
      p.bezierCurveTo(x - w * .8, y + 8, x - w * .45, y + len * .4, x - w * .42, by - dr * 1.5);
      p.bezierCurveTo(x - w * .4, by - dr * .8, x - dr, by - dr * .6, x - dr, by);
      p.arc(x, by, dr, Math.PI, 0, true);
      p.bezierCurveTo(x + dr, by - dr * .6, x + w * .4, by - dr * .8, x + w * .42, by - dr * 1.5);
      p.bezierCurveTo(x + w * .45, y + len * .4, x + w * .8, y + 8, x + w * 2.2, y - 6);
      p.closePath();
      if (N) spot(ctx, x, by, dr * 4, dr * 4, honey, .25);
      ctx.fillStyle = linear(ctx, x - dr, 0, x + dr, 0, [[0, honeyLo], [.35, honey], [.6, honeyHi], [1, honeyLo]]);
      ctx.fill(p);
      ctx.fillStyle = rgba(WHITE, N ? .55 : .8);
      ctx.beginPath(); ellipse(ctx, x - dr * .35, by - dr * .3, dr * .22, dr * .35, .3); ctx.fill();
      ctx.strokeStyle = rgba(WHITE, N ? .35 : .55); ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(x - w * .2, y + 12); ctx.quadraticCurveTo(x - w * .25, y + len * .5, x - w * .18, by - dr * 1.6); ctx.stroke();
      // Some drips let go of a drop.
      if (r() < .35) {
        const fy = by + 50 + r() * 120, fr = dr * .7;
        ctx.fillStyle = radial(ctx, x - fr * .3, fy - fr * .3, 0, fr * 1.4, [[0, honeyHi], [.6, honey], [1, honeyLo]]);
        ctx.beginPath(); ctx.moveTo(x, fy - fr * 2.2); ctx.quadraticCurveTo(x + fr * 1.05, fy - fr * .4, x + fr, fy); ctx.arc(x, fy, fr, 0, Math.PI); ctx.quadraticCurveTo(x - fr * 1.05, fy - fr * .4, x, fy - fr * 2.2); ctx.fill();
        ctx.fillStyle = rgba(WHITE, .7); ctx.beginPath(); circle(ctx, x - fr * .35, fy - fr * .2, fr * .22); ctx.fill();
      }
    });

    // A bee in the open space.
    const bee = (x, y, s, ang) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.scale(s, s);
      spot(ctx, 10, 80, 50, 10, N ? BLACK : tone(P.brown, .4), N ? .25 : .1);
      ctx.strokeStyle = tone(P.brown, .2, .6); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      [[-14, 10, -20, 28], [-4, 12, -2, 30], [6, 12, 14, 28]].forEach(([x0, y0, x1, y1]) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 + 2, y1 - 6, x1, y1); ctx.stroke(); });
      const abd = new Path2D(); abd.ellipse(18, 3, 27, 18, .12, 0, TAU);
      ctx.fillStyle = radial(ctx, 12, -6, 2, 32, [[0, tone(P.yellow, .9, .9)], [.6, tone(P.accent, .72, 1.1)], [1, tone(P.accent, .5, 1)]]);
      ctx.fill(abd);
      ctx.save(); ctx.clip(abd); ctx.fillStyle = tone(P.brown, .2, .6);
      [10, 23, 36].forEach(sx => { ctx.beginPath(); ctx.ellipse(sx, 3, 4.5, 22, .2, 0, TAU); ctx.fill(); });
      ctx.restore();
      ctx.fillStyle = radial(ctx, -14, -6, 1, 18, [[0, tone(P.accent, .62, .9)], [1, tone(P.brown, .25, .7)]]);
      ctx.beginPath(); circle(ctx, -12, -1, 14); ctx.fill();
      ctx.fillStyle = tone(P.brown, .18, .6); ctx.beginPath(); circle(ctx, -30, 3, 10); ctx.fill();
      ctx.lineWidth = 1.8;
      [[-34, -6, -46, -22], [-30, -7, -36, -26]].forEach(([x0, y0, x1, y1]) => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 - 4, y1 + 6, x1, y1); ctx.stroke(); });
      ctx.fillStyle = rgba(WHITE, N ? .22 : .45); ctx.strokeStyle = rgba(WHITE, N ? .55 : .85); ctx.lineWidth = 1.2;
      [[-8, -24, 30, 12, -.7], [8, -26, 26, 11, -.25]].forEach(([wx, wy, rx, ry, a]) => { ctx.beginPath(); ellipse(ctx, wx, wy, rx, ry, a); ctx.fill(); ctx.stroke(); });
      ctx.restore();
    };
    bee(1560, 760, 1.7, -.12);

    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  // Wood seen from above: soft streaks from a small texture, then fine grain lines.
  function woodTop(ctx, r, dark, light, lines, lineA, angle = 0) {
    const n1 = makeNoise(r() * 1e9 | 0), n2 = makeNoise(r() * 1e9 | 0);
    const [dr, dg, db] = rgb(dark), [lr, lg, lb] = rgb(light);
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(angle); ctx.translate(-W / 2, -H / 2);
    texture(ctx, 400, 240, (u, v) => {
      const warp = fbm(n2, u * 2.2, v * 2.6, 3) * 2.2;
      const g = fbm(n1, u * 1.1, v * 16 + warp, 4) * .5 + .5;
      const t = smooth(clamp(g * 1.5 - .25, 0, 1));
      return [lerp(dr, lr, t), lerp(dg, lg, t), lerp(db, lb, t), 255];
    }, -120, -120, W + 240, H + 240);
    ctx.lineCap = 'round';
    for (let i = 0; i < 150; i++) {
      const y0 = -100 + i * 8.8 + r() * 6, pts = [];
      for (let x = -140; x <= W + 140; x += 48) pts.push([x, y0 + fbm(n2, x * .0016, y0 * .012, 3) * 70]);
      ctx.strokeStyle = rgba(lines, lineA * (.4 + r() * .9)); ctx.lineWidth = .8 + r() * 1.4;
      ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke();
    }
    ctx.restore();
  }

  // Places count points in a box, apart from each other and from the points in taken.
  function scatter(r, count, box, gap, taken = []) {
    const out = [];
    for (let tries = 0; out.length < count && tries < count * 60; tries++) {
      const p = [lerp(box[0], box[2], r()), lerp(box[1], box[3], r())];
      if ([...taken, ...out].every(q => Math.hypot(p[0] - q[0], p[1] - q[1]) > gap)) out.push(p);
    }
    taken.push(...out);
    return out;
  }

  // An egg outline along x: the tip at +x is narrower than the base at -x.
  function egg(len, wid, taper2 = .18) {
    const p = new Path2D();
    for (let i = 0; i <= 64; i++) {
      const t = i / 64 * TAU, c = Math.cos(t);
      const x = c * len / 2, y = Math.sin(t) * wid / 2 * (1 - taper2 * c);
      i ? p.lineTo(x, y) : p.moveTo(x, y);
    }
    p.closePath();
    return p;
  }
  // The light direction of the scene, turned into the frame of an object rotated by ang.
  const localLight = (ang, lx = -.6, ly = -.8) => [Math.cos(ang) * lx + Math.sin(ang) * ly, -Math.sin(ang) * lx + Math.cos(ang) * ly];

  scene('fruit', 'pistachios', (ctx, P, r) => {
    const N = P.night;
    woodTop(ctx, r, N ? tone(P.brown, .25, .9) : tone(P.yellow, .72, .7), N ? tone(P.orange, .42, .55) : tone(P.yellow, .86, .5), N ? BLACK : tone(P.brown, .45, .7), N ? .16 : .1, -.05);
    // Window light from the upper left.
    spot(ctx, 560, 260, 1500, 1000, N ? tone(P.yellow, .8, .5) : WHITE, N ? .14 : .32);

    const shellHi = tone(P.yellow, N ? .9 : .94, .45), shell = tone(P.yellow, N ? .76 : .83, .75), shellLo = tone(P.brown, N ? .44 : .56, .7);
    const kernHi = tone(P.green, N ? .84 : .88, .9), kern = tone(P.green, N ? .68 : .72, 1.15), kernLo = tone(P.green, N ? .42 : .5, 1);
    const skin = tone(P.magenta, N ? .4 : .46, .9), skin2 = tone(P.red, N ? .42 : .48, .8);
    const shadowC = N ? BLACK : tone(P.brown, .3, .6), shadowA = N ? .55 : .3;

    function nut(x, y, len, ang, open) {
      const wid = len * .64, [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      spot(ctx, -lx * 7, -ly * 9, len * .6, wid * .62, shadowC, shadowA);
      const outline = egg(len, wid);
      ctx.fillStyle = radial(ctx, lx * len * .2, ly * wid * .3, 1, len * .62, [[0, shellHi], [.45, shell], [1, shellLo]]);
      ctx.fill(outline);
      ctx.save(); ctx.clip(outline);
      // The seam runs along the middle, so the 2 halves bulge on each side.
      ctx.fillStyle = linear(ctx, 0, -wid / 2, 0, wid / 2, [[0, rgba(shellLo, .3)], [.3, rgba(shellLo, 0)], [.5, rgba(shellLo, .45)], [.7, rgba(shellLo, 0)], [1, rgba(shellLo, .35)]]);
      ctx.fill(outline);
      ctx.strokeStyle = rgba(shellLo, .18); ctx.lineWidth = 1;
      for (let s = -3; s <= 3; s++) { ctx.beginPath(); ctx.ellipse(0, s * wid * .07, len * .5, wid * .3 * (1 - Math.abs(s) * .08), 0, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
      // The split at the tip end shows the kernel between the 2 halves.
      if (open > 0) {
        const gx0 = -len * .24, gx1 = len * .5, gw = wid * .5 * open, gap = new Path2D();
        gap.moveTo(gx0, 0);
        gap.bezierCurveTo(lerp(gx0, gx1, .4), -gw * .5, gx1 - len * .15, -gw, gx1 - len * .03, -gw * .66);
        gap.quadraticCurveTo(gx1 + len * .05, 0, gx1 - len * .03, gw * .66);
        gap.bezierCurveTo(gx1 - len * .15, gw, lerp(gx0, gx1, .4), gw * .5, gx0, 0);
        gap.closePath();
        ctx.fillStyle = radial(ctx, len * .24, -gw * .2, 1, len * .4, [[0, kernHi], [.45, kern], [1, kernLo]]);
        ctx.fill(gap);
        ctx.save(); ctx.clip(gap);
        for (let s = 0; s < 4; s++) {
          ctx.fillStyle = rgba(s % 2 ? skin : skin2, .5 + r() * .25);
          ctx.beginPath(); ellipse(ctx, len * (-.1 + r() * .45), (r() - .5) * gw * 1.4, len * (.05 + r() * .09), gw * (.2 + r() * .3), r() * 3); ctx.fill();
        }
        ctx.fillStyle = rgba(WHITE, .35); ctx.beginPath(); ellipse(ctx, len * .25, -gw * .3, len * .08, gw * .14, .1); ctx.fill();
        ctx.strokeStyle = rgba(BLACK, .45); ctx.lineWidth = 7; ctx.stroke(gap);
        ctx.restore();
        ctx.strokeStyle = rgba(shellHi, .95); ctx.lineWidth = 2.2; ctx.stroke(gap);
      } else {
        ctx.strokeStyle = rgba(shellLo, .6); ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(-len * .5, 0); ctx.quadraticCurveTo(0, wid * .04, len * .5, 0); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = rgba(WHITE, N ? .35 : .5);
      ctx.beginPath(); ellipse(ctx, lx * len * .22, ly * wid * .3 - wid * .12, len * .14, wid * .07, lx * .3); ctx.fill();
      ctx.fillStyle = rgba(shellLo, .7);
      ctx.beginPath(); circle(ctx, -len * .47, 0, 2.5); ctx.fill();
      ctx.restore();
    }
    function kernel(x, y, len, ang) {
      const wid = len * .5, [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      spot(ctx, -lx * 5, -ly * 7, len * .55, wid * .6, shadowC, shadowA);
      const p = egg(len, wid, .3);
      ctx.fillStyle = radial(ctx, lx * len * .2, ly * wid * .3, 1, len * .6, [[0, kernHi], [.5, kern], [1, kernLo]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      // A papery skin covers the base and breaks up toward the green tip.
      ctx.fillStyle = linear(ctx, -len / 2, 0, len * .3, 0, [[0, rgba(skin, .85)], [.55, rgba(skin2, .55)], [1, rgba(skin2, 0)]]);
      ctx.fill(p);
      for (let s = 0; s < 4; s++) { ctx.fillStyle = rgba(s % 2 ? skin : skin2, .45 + r() * .3); ctx.beginPath(); ellipse(ctx, (r() - .3) * len * .7, (r() - .5) * wid, len * (.04 + r() * .08), wid * (.1 + r() * .2), r() * 3); ctx.fill(); }
      ctx.fillStyle = linear(ctx, 0, -wid / 2, 0, wid / 2, [[0, rgba(BLACK, 0)], [.6, rgba(BLACK, 0)], [1, rgba(BLACK, .35)]]);
      ctx.fill(p);
      ctx.restore();
      ctx.fillStyle = rgba(WHITE, N ? .4 : .55);
      ctx.beginPath(); ellipse(ctx, lx * len * .2, ly * wid * .28, len * .16, wid * .08, 0); ctx.fill();
      ctx.restore();
    }
    function halfShell(x, y, len, ang) {
      const wid = len * .58, [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      spot(ctx, -lx * 5, -ly * 7, len * .58, wid * .6, shadowC, shadowA * .8);
      const p = egg(len, wid);
      ctx.fillStyle = shell; ctx.fill(p);
      const inner = egg(len * .88, wid * .8);
      // The inside is a hollow: lit on the far wall, in shade on the near wall.
      ctx.fillStyle = radial(ctx, -lx * len * .15, -ly * wid * .2, 1, len * .5, [[0, shellHi], [.6, tone(P.yellow, N ? .84 : .9, .45)], [1, shellLo]]);
      ctx.fill(inner);
      ctx.strokeStyle = rgba(shellHi, .9); ctx.lineWidth = 1.5; ctx.stroke(p);
      ctx.restore();
    }
    // A celadon bowl in the top right corner, full of nuts.
    const bx = 1700, by = 150, bR = 310;
    spot(ctx, bx + 26, by + 40, bR * 1.08, bR * 1.08, shadowC, shadowA * 1.1);
    const glaze = tone(P.cyan, N ? .5 : .74, 1.1), glazeLo = tone(P.cyan, N ? .3 : .55, 1.1), glazeHi = tone(P.cyan, N ? .74 : .92, .6);
    ctx.fillStyle = radial(ctx, bx - bR * .4, by - bR * .4, 10, bR * 1.3, [[0, glazeHi], [.5, glaze], [1, glazeLo]]);
    ctx.beginPath(); circle(ctx, bx, by, bR); ctx.fill();
    ctx.fillStyle = radial(ctx, bx + bR * .25, by + bR * .25, 10, bR, [[0, glazeHi], [.6, glaze], [1, glazeLo]]);
    ctx.beginPath(); circle(ctx, bx, by, bR * .88); ctx.fill();
    ctx.save(); ctx.beginPath(); circle(ctx, bx, by, bR * .86); ctx.clip();
    const pile = [];
    for (let i = 0; i < 70; i++) { const a = r() * TAU, d = Math.sqrt(r()) * bR * .9; pile.push([bx + Math.cos(a) * d, by + Math.sin(a) * d]); }
    pile.sort((a, b) => a[1] - b[1]).forEach(([x, y]) => nut(x, y, 92 + r() * 18, r() * TAU, r() < .7 ? .5 + r() * .5 : 0));
    ctx.fillStyle = radial(ctx, bx + bR * .3, by + bR * .3, bR * .3, bR * .95, [[0, rgba(BLACK, 0)], [.7, rgba(BLACK, 0)], [1, rgba(BLACK, N ? .55 : .3)]]);
    ctx.fillRect(bx - bR, by - bR, bR * 2, bR * 2);
    ctx.restore();
    ctx.strokeStyle = rgba(glazeHi, .9); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(bx, by, bR * .985, Math.PI * .55, Math.PI * 1.25); ctx.stroke();

    // Nuts spill from the bowl and lie along the lower edge and the left side.
    const taken = [[bx, by + 60], [bx - 120, by + 20], [bx + 40, by - 60]];
    const groups = [
      [9, [1260, 330, 1900, 640], 95],
      [16, [80, 880, 1840, 1050], 100],
      [9, [40, 120, 330, 860], 100],
      [3, [600, 380, 1250, 760], 220],
    ];
    const items = [];
    groups.forEach(([count, box, gap]) => scatter(r, count, box, gap, taken).forEach(p => items.push(p)));
    items.sort((a, b) => a[1] - b[1]).forEach(([x, y]) => {
      const t = r(), len = 96 + r() * 22, ang = r() * TAU;
      if (t < .66) nut(x, y, len, ang, r() < .85 ? .45 + r() * .55 : 0);
      else if (t < .84) kernel(x, y, len * .78, ang);
      else halfShell(x, y, len, ang);
    });

    vignette(ctx, P, N ? .55 : .14);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('fruit', 'aubergines', (ctx, P, r) => {
    const N = P.night, tableY = 690;
    // The wall: light falls from the upper left.
    if (N) skyGradient(ctx, [[0, tone(P.blue, .22, .45)], [.64, tone(P.blue, .16, .5)], [1, P.darker_background]]);
    else skyGradient(ctx, [[0, tone(P.blue, .93, .25)], [.64, tone(P.blue, .88, .28)], [1, tone(P.blue, .82, .3)]]);
    spot(ctx, 420, 220, 1100, 760, N ? tone(P.blue, .5, .4) : WHITE, N ? .3 : .55);
    windowLight(ctx, 300, 120, 560, 470, 260, N ? tone(P.blue, .6, .4) : WHITE, N ? .1 : .5, 18);
    // The table top, with a soft line where it meets the wall.
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, tone(P.brown, .27, .55)], [1, tone(P.brown, .13, .6)]] : [[0, tone(P.yellow, .9, .35)], [1, tone(P.yellow, .82, .4)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    // Grain of the table top, in perspective.
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 44; i++) {
      const y = tableY + (i / 44) ** 1.6 * (H - tableY) + 2;
      ctx.strokeStyle = rgba(N ? BLACK : tone(P.brown, .5, .4), N ? .18 : .06 + r() * .05);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(500, y + (r() - .5) * 6, 1300, y + (r() - .5) * 6, W, y + (r() - .5) * 4); ctx.stroke();
    }
    spot(ctx, 700, tableY + 120, 1100, 260, N ? tone(P.yellow, .6, .3) : WHITE, N ? .16 : .4);
    ctx.fillStyle = linear(ctx, 0, tableY - 6, 0, tableY + 26, [[0, rgba(BLACK, 0)], [.3, rgba(BLACK, N ? .3 : .1)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(0, tableY - 6, W, 32);

    const Lt = unit([-.45, -.7, .55]), Hv = unit([Lt[0], Lt[1], Lt[2] + 1]);
    const skinLo = tone(P.blue, N ? .12 : .17, 1), skinMid = tone(P.blue, N ? .3 : .34, 1.15), skinHi = tone(P.blue, N ? .48 : .52, 1.1);
    const bounce = N ? tone(P.yellow, .4, .4) : tone(P.yellow, .75, .45);
    const calyxC = tone(P.green, N ? .5 : .55, .8), calyxLo = tone(P.green, N ? .26 : .32, .8), calyxHi = tone(P.green, N ? .74 : .8, .6);
    const ramp = (t) => t < .5 ? mixHex(skinLo, skinMid, t * 2) : mixHex(skinMid, skinHi, (t - .5) * 2);

    function aubergine(x0, y0, x1, y1, R, bend) {
      const n = 60, axis = [], dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy), cap = R / d;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), off = Math.sin(t * Math.PI) * bend;
        let rad = R * (.36 + .64 * smooth(clamp(t / .6, 0, 1)));
        if (t > 1 - cap) rad *= Math.sqrt(Math.max(0, 1 - ((t - 1 + cap) / cap) ** 2));
        axis.push([x0 + dx * t - dy / d * off, y0 + dy * t + dx / d * off, Math.max(rad, .5)]);
      }
      const tb = tube(axis);
      // A shadow under the fruit, then a tight contact shadow.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2 + R * .9, a = Math.atan2(dy, dx);
      spot(ctx, mx + 30, my + 4, d * .62, R * .55, BLACK, N ? .6 : .32, a);
      spot(ctx, mx, my - R * .1, d * .5, R * .22, BLACK, N ? .7 : .4, a);
      tb.shade(ctx, (k, i) => {
        const nn = tb.normal(k, i), dif = Math.max(0, dot3(nn, Lt));
        let c = ramp(clamp(dif * 1.05, 0, 1));
        const down = clamp(nn[1], 0, 1);
        return mixHex(c, bounce, down * down * .28);
      }, 44);
      // The glossy skin: a wide soft sheen and a sharp streak.
      const pk = i => tb.peak(Hv, i), bb = axisBox(axis);
      ctx.save();
      clipBox(ctx, ...bb, 20);
      ctx.filter = blurPx(6);
      ctx.fillStyle = tb.along(ctx, i => rgba(skinHi, Math.sin(i / (n - 1) * Math.PI) * .6));
      ctx.fill(tb.band(i => pk(i) - .28, i => pk(i) + .22));
      ctx.filter = blurPx(1.5);
      ctx.fillStyle = tb.along(ctx, i => rgba(WHITE, clamp(Math.sin(clamp((i / (n - 1) - .18) / .74, 0, 1) * Math.PI) * 1.4, 0, 1) * (N ? .8 : .9)));
      ctx.fill(tb.band(i => pk(i) - .07, i => pk(i) + .05, 8, n - 4));
      ctx.filter = blurPx(3);
      ctx.fillStyle = tb.along(ctx, i => rgba(bounce, Math.sin(i / (n - 1) * Math.PI) * .45));
      ctx.fill(tb.band(.82, .95, 6, n - 6));
      ctx.restore();
      // The stem and the calyx with its pointed sepals.
      const ux = dx / d, uy = dy / d, sl = R * .9;
      ctx.strokeStyle = calyxLo; ctx.lineCap = 'round'; ctx.lineWidth = R * .26;
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo(x0 - ux * sl * .6, y0 - uy * sl * .6 - R * .15, x0 - ux * sl, y0 - uy * sl - R * .3); ctx.stroke();
      ctx.strokeStyle = calyxC; ctx.lineWidth = R * .14;
      ctx.beginPath(); ctx.moveTo(x0, y0 - R * .03); ctx.quadraticCurveTo(x0 - ux * sl * .6, y0 - uy * sl * .6 - R * .2, x0 - ux * sl, y0 - uy * sl - R * .34); ctx.stroke();
      ctx.fillStyle = tone(P.yellow, N ? .7 : .8, .5);
      ctx.beginPath(); ellipse(ctx, x0 - ux * sl, y0 - uy * sl - R * .3, R * .12, R * .08, a); ctx.fill();
      const ti = t => Math.round(t * (n - 1));
      // Broad sepals that hug the shoulder, each with a curved edge and a point.
      const tips = [[-1.04, .2 + r() * .05], [-.5, .27 + r() * .05], [.05, .31 + r() * .04], [.58, .26 + r() * .05], [1.04, .19 + r() * .05]];
      const cal = new Path2D();
      let q = tb.at(0, -1.1); cal.moveTo(q[0], q[1]);
      q = tb.at(ti(tips[0][1] * .6), -1.08); cal.quadraticCurveTo(...tb.at(ti(tips[0][1] * .3), -1.12), q[0], q[1]);
      tips.forEach(([k, t], j) => {
        q = tb.at(ti(t), k * .98); cal.lineTo(q[0], q[1]);
        if (j < tips.length - 1) {
          const k2 = (k + tips[j + 1][0]) / 2, kn = tips[j + 1][0], tn = tips[j + 1][1];
          q = tb.at(ti(.12), k2); cal.quadraticCurveTo(...tb.at(ti(t * .8), lerp(k, k2, .7)), q[0], q[1]);
          q = tb.at(ti(tn * .82), lerp(kn, k2, .45)); cal.quadraticCurveTo(...tb.at(ti(tn * .4), lerp(k2, kn, .2)), q[0], q[1]);
        }
      });
      q = tb.at(ti(tips[4][1] * .6), 1.08); cal.lineTo(q[0], q[1]);
      q = tb.at(0, 1.1); cal.quadraticCurveTo(...tb.at(ti(tips[4][1] * .3), 1.12), q[0], q[1]);
      cal.closePath();
      ctx.fillStyle = tb.along(ctx, () => calyxC);
      ctx.fillStyle = linear(ctx, ...tb.at(ti(.1), -1), ...tb.at(ti(.1), 1), [[0, calyxHi], [.45, calyxC], [1, calyxLo]]);
      ctx.fill(cal);
      ctx.strokeStyle = rgba(calyxHi, .5); ctx.lineWidth = 1.5;
      tips.forEach(([k, t]) => { const p0 = tb.at(1, k * .4), p1 = tb.at(ti(t * .85), k * .9); ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke(); });
    }

    // A round slice lying flat: cream flesh, a ring of seeds and a thin purple skin.
    function slice(x, y, R) {
      const ry = R * .4, th = R * .12;
      spot(ctx, x + 18, y + th + 6, R * 1.2, ry * 1.3, BLACK, N ? .55 : .3);
      ctx.fillStyle = linear(ctx, x - R, 0, x + R, 0, [[0, skinHi], [.5, skinMid], [1, skinLo]]);
      ctx.beginPath(); ctx.ellipse(x, y + th, R, ry, 0, 0, Math.PI); ctx.lineTo(x - R, y); ctx.ellipse(x, y, R, ry, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
      ctx.fillStyle = skinMid; ctx.beginPath(); ellipse(ctx, x, y, R, ry); ctx.fill();
      ctx.fillStyle = radial(ctx, x - R * .3, y - ry * .3, 2, R, [[0, tone(P.yellow, N ? .9 : .97, .45)], [.7, tone(P.yellow, N ? .82 : .92, .6)], [1, tone(P.yellow, N ? .7 : .84, .8)]]);
      ctx.beginPath(); ellipse(ctx, x, y, R * .94, ry * .9); ctx.fill();
      ctx.fillStyle = rgba(tone(P.yellow, N ? .76 : .86, .9), .6); ctx.beginPath(); ellipse(ctx, x, y, R * .55, ry * .5); ctx.fill();
      ctx.fillStyle = rgba(tone(P.brown, .35, .6), .6);
      for (let i = 0; i < 40; i++) { const a = i / 40 * TAU + r() * .1, d = .38 + r() * .3; ctx.beginPath(); ellipse(ctx, x + Math.cos(a) * R * d, y + Math.sin(a) * ry * d, 3, 1.8, 0); ctx.fill(); }
      ctx.strokeStyle = rgba(WHITE, .35); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(x, y, R * .97, ry * .95, 0, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    }

    // Back group on the right, then the front fruit.
    aubergine(1470, 600, 2010, 640, 112, -20);
    aubergine(1120, 720, 1740, 840, 128, 26);
    aubergine(1990, 940, 1450, 1010, 104, 16);
    // A single one on the left with 3 slices.
    aubergine(640, 870, 90, 940, 118, -22);
    slice(780, 975, 110); slice(990, 1015, 100); slice(640, 1035, 96);

    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('fruit', 'strawberries', (ctx, P, r) => {
    const N = P.night;
    // A linen cloth: a soft fold of light and a fine weave.
    ctx.fillStyle = N ? tone(P.accent, .2, .3) : tone(P.accent, .955, .12);
    ctx.fillRect(0, 0, W, H);
    spot(ctx, 760, 420, 1300, 900, N ? tone(P.accent, .45, .3) : WHITE, N ? .35 : .6);
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 4.5) { ctx.strokeStyle = rgba(N ? BLACK : tone(P.accent, .6, .2), .03 + r() * .03); ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 4.5) { ctx.strokeStyle = rgba(N ? BLACK : tone(P.accent, .6, .2), .03 + r() * .03); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    const shadowC = N ? BLACK : tone(P.accent, .35, .5), shadowA = N ? .55 : .26;
    const redHi = tone(P.red, N ? .7 : .72, 1.05), red = tone(P.red, N ? .56 : .6, 1.12), redLo = tone(P.red, N ? .34 : .4, 1.05);
    const seed = tone(P.yellow, N ? .8 : .82, .9), leafC = tone(P.green, N ? .58 : .62, 1), leafLo = tone(P.green, N ? .34 : .4, 1), leafHi = tone(P.green, N ? .8 : .84, .7);
    const hw = (v, len) => len * .46 * (v < .3 ? .62 + .38 * Math.sin(v / .3 * Math.PI / 2) : Math.max(.02, 1 - ((v - .3) / .7) ** 1.7));
    const outline = (len) => {
      const p = new Path2D(), pts = [];
      for (let i = 0; i <= 24; i++) { const v = i / 24; pts.push([hw(v, len), v * len]); }
      for (let i = 24; i >= 0; i--) { const v = i / 24; pts.push([-hw(v, len), v * len]); }
      pts.push([-hw(0, len) * .5, -len * .05], [0, -len * .07], [hw(0, len) * .5, -len * .05]);
      smoothPath(p, pts, true);
      return p;
    };

    function sepals(len, count, spread) {
      for (let j = 0; j < count; j++) {
        const a = -Math.PI / 2 + (j / (count - 1) - .5) * spread + (r() - .5) * .2, l = len * (.22 + r() * .1);
        ctx.fillStyle = linear(ctx, 0, 0, Math.cos(a) * l, Math.sin(a) * l, [[0, leafLo], [.5, leafC], [1, leafHi]]);
        ctx.beginPath(); leaf(ctx, 0, len * .03, l, len * .055, a); ctx.fill();
      }
      ctx.fillStyle = leafC; ctx.beginPath(); circle(ctx, 0, 0, len * .045); ctx.fill();
      ctx.strokeStyle = leafLo; ctx.lineWidth = len * .035; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * .02, -len * .1, len * .07, -len * .17); ctx.stroke();
      ctx.strokeStyle = leafHi; ctx.lineWidth = len * .012;
      ctx.beginPath(); ctx.moveTo(-len * .005, -len * .01); ctx.quadraticCurveTo(len * .012, -len * .1, len * .06, -len * .165); ctx.stroke();
    }

    function berry(x, y, len, ang) {
      const [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      spot(ctx, -lx * 12, len * .48 - ly * 14, len * .5, len * .6, shadowC, shadowA);
      const p = outline(len);
      ctx.fillStyle = radial(ctx, lx * len * .2, len * .35 + ly * len * .25, len * .02, len * .75, [[0, redHi], [.35, red], [.8, redLo], [1, tone(P.red, N ? .26 : .32, 1)]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      // Seeds sit in small dimples, in staggered rows.
      for (let row = 0, v = .08; v < .96; row++, v += .062) {
        const w = hw(v, len), cnt = Math.max(2, Math.round(w / (len * .055)));
        for (let s = 0; s < cnt; s++) {
          const u = -.92 + 1.84 * (s + (row % 2 ? .5 : 0) + .25) / (cnt + .5);
          if (Math.abs(u) > .95) continue;
          const sx = u * w * .94 + (r() - .5) * len * .012, sy = v * len + (1 - u * u) * len * .015 + (r() - .5) * len * .012, f = Math.sqrt(1 - u * u), sz = len * .016 * (.7 + .3 * f);
          ctx.fillStyle = rgba(redLo, .55);
          ctx.beginPath(); ellipse(ctx, sx - lx * 1.5, sy - ly * 1.5, sz * 1.5 * f + 1, sz * 1.7, 0); ctx.fill();
          ctx.fillStyle = seed;
          ctx.beginPath(); ellipse(ctx, sx, sy, sz * .62 * f + .5, sz, 0); ctx.fill();
          ctx.fillStyle = rgba(WHITE, .55);
          ctx.beginPath(); circle(ctx, sx + lx * sz * .4, sy + ly * sz * .5, sz * .3); ctx.fill();
        }
      }
      // Wet shine on the lit side.
      spot(ctx, lx * len * .22, len * .33 + ly * len * .22, len * .16, len * .22, WHITE, N ? .35 : .45);
      ctx.fillStyle = linear(ctx, lx * len * .5, len * .4 + ly * len * .5, -lx * len * .5, len * .4 - ly * len * .5, [[0, rgba(BLACK, 0)], [.55, rgba(BLACK, 0)], [1, rgba(BLACK, N ? .4 : .3)]]);
      ctx.fill(p);
      ctx.restore();
      sepals(len, 7, 3.6);
      ctx.restore();
    }

    function halfBerry(x, y, len, ang) {
      const [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      spot(ctx, -lx * 10, len * .48 - ly * 12, len * .5, len * .58, shadowC, shadowA);
      const p = outline(len);
      ctx.fillStyle = red; ctx.fill(p);
      ctx.save(); ctx.translate(0, len * .06); ctx.scale(.88, .9);
      const inner = outline(len);
      ctx.fillStyle = radial(ctx, 0, len * .4, len * .03, len * .6, [[0, tone(P.accent, N ? .84 : .88, .45)], [.3, tone(P.red, N ? .74 : .76, .75)], [.75, redHi], [1, red]]);
      ctx.fill(inner);
      ctx.restore();
      // The pale core and the fibers that run out to the seeds.
      ctx.strokeStyle = rgba(WHITE, .35); ctx.lineWidth = 1.4;
      for (let i = 0; i < 14; i++) {
        const v = .15 + i / 14 * .75, side = i % 2 ? 1 : -1;
        ctx.beginPath(); ctx.moveTo(side * len * .03, v * len); ctx.quadraticCurveTo(side * hw(v, len) * .5, v * len - len * .04, side * hw(v, len) * .82, v * len - len * .02); ctx.stroke();
      }
      ctx.save(); ctx.translate(0, len * .42); ctx.scale(.22, 1);
      ctx.fillStyle = radial(ctx, 0, 0, 0, len * .32, [[0, rgba(WHITE, .6)], [.6, rgba(WHITE, .3)], [1, rgba(WHITE, 0)]]);
      ctx.beginPath(); circle(ctx, 0, 0, len * .32); ctx.fill();
      ctx.restore();
      for (let i = 0; i < 18; i++) { ctx.fillStyle = rgba(WHITE, .4 + r() * .4); ctx.beginPath(); circle(ctx, (r() - .5) * len * .5, len * (.2 + r() * .6), 1 + r() * 2.5); ctx.fill(); }
      ctx.fillStyle = leafC; ctx.beginPath(); ellipse(ctx, 0, -len * .03, len * .3, len * .045); ctx.fill();
      ctx.restore();
    }

    // A mint leaf with a toothed edge and sunken veins.
    function mint(x, y, len, ang) {
      const [lx, ly] = localLight(ang);
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const wf = t => len * .36 * Math.sin(Math.PI * t ** .7) ** .8 * (1 - t * .1);
      const side = s => {
        const pts = [];
        for (let i = 0; i <= 40; i++) { const t = i / 40, tooth = (i % 2 ? .86 : 1) * (t > .08 && t < .96 ? 1 : .92); pts.push([t * len, s * wf(t) * tooth]); }
        return pts;
      };
      const top = side(-1), bot = side(1), p = new Path2D();
      smoothPath(p, [...top, ...bot.reverse()], true, .3);
      spot(ctx, -lx * 8 + len * .5, -ly * 8, len * .55, len * .28, shadowC, shadowA * .8);
      ctx.fillStyle = linear(ctx, 0, -len * .3, 0, len * .3, ly < 0 ? [[0, leafHi], [.45, leafC], [.55, leafLo], [1, leafC]] : [[0, leafC], [.45, leafLo], [.55, leafC], [1, leafHi]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.lineCap = 'round';
      const vein = (w, c) => {
        ctx.strokeStyle = c; ctx.lineWidth = w;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(len * .5, len * .015, len * .98, 0); ctx.stroke();
        for (let i = 1; i <= 6; i++) {
          const t = i / 7.5;
          [-1, 1].forEach(s => { ctx.beginPath(); ctx.moveTo(t * len, 0); ctx.quadraticCurveTo((t + .08) * len, s * wf(t) * .5, (t + .2) * len, s * wf(t + .15) * .9); ctx.stroke(); });
        }
      };
      ctx.translate(1, 1.5); vein(3.2, rgba(leafLo, .55));
      ctx.translate(-1, -1.5); vein(1.6, rgba(leafHi, .55));
      spot(ctx, len * .4, ly < 0 ? -len * .1 : len * .1, len * .3, len * .08, WHITE, .25);
      ctx.restore();
      ctx.restore();
    }
    function sprig(x, y, ang, s) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.strokeStyle = leafLo; ctx.lineWidth = 6 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(-40 * s, 0); ctx.lineTo(250 * s, 0); ctx.stroke();
      [[30, 140], [120, 115], [195, 80]].forEach(([at, l]) => {
        mint(at * s, 0, l * s, -1 + (r() - .5) * .3);
        mint(at * s, 0, l * s * .95, 1 + (r() - .5) * .3);
      });
      mint(250 * s, 0, 70 * s, (r() - .5) * .4);
      ctx.restore();
    }

    sprig(260, 760, -.6, 1.2);
    sprig(1590, 120, 2.6, 1.1);
    sprig(1500, 1000, -2.9, .9);
    mint(130, 80, 160, .5); mint(1780, 960, 150, 3.6); mint(980, 1010, 130, -.3);
    berry(140, 880, 250, -.25); berry(400, 905, 230, .45); berry(240, 1040, 210, -1.4); halfBerry(580, 995, 215, .9);
    berry(1610, 300, 240, 2.6); berry(1830, 200, 250, 3.4); halfBerry(1390, 140, 205, 2.2); berry(1880, 480, 210, 2.0);
    berry(1240, 1010, 195, -1.9); berry(80, 330, 185, 1.2);

    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('fruit', 'rhubarb', (ctx, P, r) => {
    const N = P.night, noise = makeNoise(r() * 1e9 | 0);
    // A table seen from above, lit from the upper left.
    ctx.fillStyle = N ? tone(P.accent, .19, .3) : tone(P.yellow, .955, .14);
    ctx.fillRect(0, 0, W, H);
    spot(ctx, 640, 360, 1400, 900, N ? tone(P.yellow, .5, .3) : WHITE, N ? .25 : .55);
    texture(ctx, 240, 135, (u, v) => [0, 0, 0, 128 + 127 * fbm(noise, u * 6, v * 4, 4)], 0, 0, W, H, N ? .06 : .035);
    const shadowC = N ? BLACK : tone(P.accent, .35, .4), shadowA = N ? .55 : .25;
    const Lt = unit([-.5, -.65, .6]);

    // A wide stoneware bowl of custard on the right.
    const bx = 1500, by = 700, bR = 560;
    spot(ctx, bx + 40, by + 50, bR * 1.06, bR * 1.04, shadowC, shadowA * 1.3);
    const clay = tone(P.yellow, N ? .74 : .95, .18), clayLo = tone(P.yellow, N ? .5 : .82, .25), clayHi = tone(P.yellow, N ? .86 : .99, .1);
    ctx.fillStyle = radial(ctx, bx - bR * .45, by - bR * .45, 20, bR * 1.4, [[0, clayHi], [.55, clay], [1, clayLo]]);
    ctx.beginPath(); circle(ctx, bx, by, bR); ctx.fill();
    ctx.strokeStyle = rgba(WHITE, N ? .2 : .5); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(bx, by, bR * .985, Math.PI * .95, Math.PI * 1.45); ctx.stroke();
    // The inner wall in shade on the near side of the light.
    ctx.fillStyle = radial(ctx, bx + bR * .1, by + bR * .1, bR * .6, bR * .9, [[0, clay], [1, clayLo]]);
    ctx.beginPath(); circle(ctx, bx, by, bR * .88); ctx.fill();
    // The custard: smooth and glossy, with a swirl from the spoon.
    const custard = tone(P.yellow, N ? .84 : .88, N ? .75 : 1.05), custardLo = tone(P.yellow, N ? .66 : .74, .95), custardHi = tone(P.yellow, N ? .94 : .97, .5);
    const pool = new Path2D(); pool.arc(bx + 6, by + 8, bR * .8, 0, TAU);
    ctx.fillStyle = radial(ctx, bx, by, bR * .3, bR * .82, [[0, custard], [.8, custard], [1, custardLo]]);
    ctx.fill(pool);
    ctx.fillStyle = linear(ctx, bx - bR, by - bR, bx + bR, by + bR, [[0, rgba(custardHi, .5)], [.5, rgba(custardHi, 0)], [1, rgba(custardLo, .25)]]);
    ctx.fill(pool);
    ctx.save(); ctx.clip(pool);
    // The swirl is a groove: a shade on one side and a light edge on the other.
    const spiral = [];
    for (let t = 0; t <= 1; t += .005) { const a = t * 5.2 * Math.PI, d = 18 + t * bR * .78; spiral.push([bx + 6 + Math.cos(a) * d, by + 8 + Math.sin(a) * d]); }
    ctx.lineCap = 'round';
    ctx.filter = blurPx(3);
    ctx.strokeStyle = rgba(custardLo, .75); ctx.lineWidth = 9; ctx.beginPath(); smoothPath(ctx, spiral.map(([x, y]) => [x + 3, y + 4])); ctx.stroke();
    ctx.strokeStyle = rgba(custardHi, .9); ctx.lineWidth = 5; ctx.beginPath(); smoothPath(ctx, spiral.map(([x, y]) => [x - 3, y - 3])); ctx.stroke();
    // A ribbon of rhubarb syrup bleeds into the custard.
    const syrup = tone(P.accent, N ? .6 : .66, 1);
    // The edge where the custard meets the bowl.
    ctx.strokeStyle = rgba(custardLo, .9); ctx.lineWidth = 10; ctx.filter = blurPx(5); ctx.stroke(pool); ctx.filter = 'none';
    // A soft reflection of the window.
    ctx.filter = blurPx(10);
    ctx.fillStyle = rgba(WHITE, N ? .35 : .55);
    ctx.beginPath(); ctx.roundRect(bx - 330, by - 360, 150, 110, 30); ctx.roundRect(bx - 168, by - 380, 140, 100, 30); ctx.fill();
    ctx.filter = 'none';
    ctx.restore();

    // Rhubarb: deep red at the base, pink above, with green flecks toward the top.
    const base = tone(P.red, N ? .4 : .44, 1.15), mid = tone(P.accent, N ? .56 : .6, 1.1), top = mixHex(tone(P.accent, N ? .72 : .76, .7), tone(P.green, N ? .72 : .76, .6), .35), fleck = tone(P.green, N ? .62 : .66, .9);
    const colorAt = t => t < .6 ? mixHex(base, mid, t / .6) : mixHex(mid, top, (t - .6) / .4);
    function stalk(x0, y0, x1, y1, R, bend, cutEnd) {
      const n = 60, axis = [], dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1), off = Math.sin(t * Math.PI) * bend;
        axis.push([x0 + dx * t - dy / d * off, y0 + dy * t + dx / d * off, R * (1.05 - t * .25)]);
      }
      const tb = tube(axis), bb = axisBox(axis);
      ctx.save(); clipBox(ctx, bb[0] + 16, bb[1] + 18, bb[2] + 16, bb[3] + 18); ctx.translate(16, 18); ctx.fillStyle = rgba(shadowC, shadowA); ctx.filter = blurPx(12); ctx.fill(tb.outline); ctx.restore();
      tb.shade(ctx, (k, i) => {
        const nn = tb.normal(k, i), dif = Math.max(0, dot3(nn, Lt)), c = colorAt(i / (n - 1));
        return dif < .6 ? mixHex(tone(c, toOklch(c).L * .55, 1.1), c, dif / .6) : mixHex(c, WHITE, (dif - .6) * .55);
      }, 40);
      ctx.save(); ctx.clip(tb.outline);
      // Fine ribs, and flecks of green toward the top.
      // Streaks of lighter and darker color run along the stalk.
      for (let j = 0; j < 9; j++) {
        const k = -.8 + j * .2 + (r() - .5) * .08, light = j % 2;
        ctx.fillStyle = tb.along(ctx, i => rgba(light ? WHITE : BLACK, (light ? .1 : .09) * (.5 + .5 * Math.sin(i * .21 + j))));
        ctx.fill(tb.band(k, k + .07 + r() * .05));
      }
      for (let j = 0; j < 70; j++) {
        const t = .5 + r() ** .6 * .5, i = Math.min(n - 1, Math.round(t * (n - 1))), [px, py] = tb.at(i, (r() - .5) * 1.7);
        ctx.fillStyle = rgba(fleck, (t - .5) * 1.1 * (.3 + r() * .4));
        ctx.beginPath(); ellipse(ctx, px, py, 6 + r() * 16, 1.2 + r() * 1.8, Math.atan2(dy, dx)); ctx.fill();
      }
      ctx.restore();
      if (cutEnd) {
        const [cx, cy, rad] = axis[n - 1], a = Math.atan2(dy, dx);
        ctx.fillStyle = colorAt(1); ctx.beginPath(); ellipse(ctx, cx, cy, rad * .3, rad, a); ctx.fill();
        ctx.fillStyle = tone(P.green, N ? .84 : .9, .35); ctx.beginPath(); ellipse(ctx, cx + Math.cos(a) * 1.5, cy + Math.sin(a) * 1.5, rad * .2, rad * .82, a); ctx.fill();
      }
    }
    // A large crinkled leaf at the top of one stalk, mostly out of frame.
    const leafAt = (x, y, R, a) => {
      const g = tone(P.green, N ? .42 : .5, 1), gLo = tone(P.green, N ? .26 : .34, 1.05), gHi = tone(P.green, N ? .6 : .68, .8), vein = mixHex(tone(P.green, N ? .78 : .85, .5), tone(P.accent, N ? .78 : .85, .5), .4);
      const pts = [];
      for (let i = 0; i < 90; i++) {
        const t = i / 90 * TAU, rr = R * (.82 + .12 * Math.sin(t * 3 + 1) + .05 * Math.sin(t * 17) + .03 * Math.sin(t * 29));
        pts.push([x + Math.cos(t + a) * rr, y + Math.sin(t + a) * rr * .9 - R * .55]);
      }
      const lp = new Path2D(); smoothPath(lp, pts, true);
      ctx.save(); clipBox(ctx, x - R * 1.1, y - R * 1.6, x + R * 1.1, y + R * .6); ctx.translate(18, 22); ctx.fillStyle = rgba(shadowC, shadowA); ctx.filter = blurPx(14); ctx.fill(lp); ctx.restore();
      ctx.fillStyle = radial(ctx, x - R * .2, y - R * .7, R * .1, R * 1.1, [[0, gHi], [.5, g], [1, gLo]]);
      ctx.fill(lp);
      ctx.save(); ctx.clip(lp);
      // Pleats between the veins: soft dark and light strips.
      const veins = [];
      for (let i = 0; i < 6; i++) veins.push(a - Math.PI * .5 + (i - 2.5) * .5 + (r() - .5) * .12);
      ctx.filter = blurPx(8); ctx.lineWidth = 34;
      [0, 1].forEach(odd => {
        ctx.strokeStyle = rgba(odd ? gLo : gHi, .5);
        ctx.beginPath();
        veins.forEach((va, i) => {
          if (i % 2 !== odd) return;
          const m = va + .18;
          ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(m) * R * .6, y + Math.sin(m) * R * .6, x + Math.cos(m + .1) * R * 1.3, y + Math.sin(m + .1) * R * 1.3);
        });
        ctx.stroke();
      });
      ctx.filter = 'none';
      ctx.lineCap = 'round';
      veins.forEach(va => {
        ctx.strokeStyle = rgba(vein, .85); ctx.lineWidth = 7;
        const ex = x + Math.cos(va) * R * 1.2, ey = y + Math.sin(va) * R * 1.2;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(va - .1) * R * .6, y + Math.sin(va - .1) * R * .6, ex, ey); ctx.stroke();
        ctx.lineWidth = 2.5;
        for (let k = 1; k < 6; k++) {
          const t = k / 6 + (r() - .5) * .05, bx0 = x + Math.cos(va - .05) * R * t, by0 = y + Math.sin(va - .05) * R * t, l = R * (.12 + r() * .1);
          [-1, 1].forEach(sd => { const ba = va + sd * (.7 + r() * .3); ctx.beginPath(); ctx.moveTo(bx0, by0); ctx.quadraticCurveTo(bx0 + Math.cos(ba - sd * .3) * l * .6, by0 + Math.sin(ba - sd * .3) * l * .6, bx0 + Math.cos(ba) * l, by0 + Math.sin(ba) * l); ctx.stroke(); });
        }
      });
      ctx.restore();
    };
    stalk(-120, 1180, 720, -80, 46, 30, false);
    stalk(40, 1200, 860, 50, 42, -16, true);
    stalk(-160, 880, 300, 150, 36, 20, false);
    leafAt(300, 150, 430, -.25);
    stalk(300, 1220, 1010, 360, 38, 26, true);

    // Short pieces of stalk, some poached soft and pink.
    const piece = (x, y, len, R, a, poached) => {
      const axis = [];
      for (let i = 0; i < 12; i++) { const t = i / 11; axis.push([x + Math.cos(a) * (t - .5) * len, y + Math.sin(a) * (t - .5) * len, R]); }
      const tb = tube(axis), bb = axisBox(axis);
      ctx.save(); clipBox(ctx, bb[0] + 8, bb[1] + 10, bb[2] + 8, bb[3] + 10, 24); ctx.translate(8, 10); ctx.fillStyle = rgba(shadowC, shadowA * (poached ? .5 : 1)); ctx.filter = blurPx(6); ctx.fill(tb.outline); ctx.restore();
      tb.shade(ctx, k => {
        const c = poached ? tone(P.accent, N ? .66 : .7, 1) : mid, dif = Math.max(0, dot3(tb.normal(k, 5), Lt));
        return mixHex(tone(c, toOklch(c).L * .62, 1.1), c, Math.min(1, dif / .7));
      }, 20, 4);
      if (poached) { ctx.fillStyle = tb.along(ctx, i => rgba(WHITE, .5 * Math.sin(i / 11 * Math.PI))); ctx.fill(tb.band(-.6, -.35)); }
      [0, 11].forEach(i => { const [cx, cy] = axis[i]; ctx.fillStyle = poached ? tone(P.accent, N ? .74 : .78, .8) : tone(P.accent, N ? .8 : .86, .45); ctx.beginPath(); ellipse(ctx, cx, cy, R * .14, R * .96, a); ctx.fill(); });
    };
    ctx.save(); ctx.beginPath(); circle(ctx, bx + 6, by + 8, bR * .8); ctx.clip();
    // Poached pieces in a loose pile, glossy with syrup.
    spot(ctx, bx - 120, by - 60, 230, 150, syrup, .35);
    // Batons cut at a slant, soft and glossy.
    const baton = (x, y, len, w, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      spot(ctx, 5, w * .6, len * .55, w * .7, shadowC, shadowA * .7);
      const p = new Path2D();
      p.moveTo(-len / 2 + w * .35, -w / 2); p.lineTo(len / 2, -w / 2); p.quadraticCurveTo(len / 2 + 3, -w / 2 + 3, len / 2 - 2, -w / 2 + 6);
      p.lineTo(len / 2 - w * .35, w / 2); p.lineTo(-len / 2, w / 2); p.quadraticCurveTo(-len / 2 - 3, w / 2 - 3, -len / 2 + 2, w / 2 - 6); p.closePath();
      ctx.fillStyle = linear(ctx, 0, -w / 2, 0, w / 2, [[0, tone(P.accent, N ? .78 : .82, .8)], [.45, tone(P.accent, N ? .64 : .68, 1)], [1, tone(P.red, N ? .44 : .5, 1.05)]]);
      ctx.fill(p);
      ctx.strokeStyle = rgba(tone(P.red, .4, 1), .25); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-len * .4, w * .1); ctx.lineTo(len * .42, w * .1); ctx.stroke();
      ctx.fillStyle = rgba(WHITE, .55); ctx.beginPath(); ctx.roundRect(-len * .32, -w * .36, len * .55, w * .14, w * .07); ctx.fill();
      ctx.restore();
    };
    [[bx - 230, by - 90, -.35, 130], [bx - 120, by - 150, .25, 112], [bx - 160, by - 10, -.8, 120], [bx - 40, by - 60, .55, 104], [bx - 210, by + 60, .1, 110], [bx - 70, by + 40, -.2, 96]].forEach(([x, y, a, l]) => baton(x, y, l, 34, a));
    ctx.restore();
    piece(1000, 980, 110, 26, .4, false); piece(880, 1040, 100, 24, -.3, false); piece(1130, 110, 100, 24, 1.1, false);

    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  // Marble seen from above: a soft base and faint veins from a small texture.
  function marble(ctx, r, base, vein, alpha) {
    const n1 = makeNoise(r() * 1e9 | 0), n2 = makeNoise(r() * 1e9 | 0), [vr, vg, vb] = rgb(vein);
    ctx.fillStyle = base; ctx.fillRect(0, 0, W, H);
    texture(ctx, 480, 270, (u, v) => {
      const t = u * 4 + v * 2.5 + fbm(n1, u * 2.4, v * 2.4, 3) * 2.6;
      const line = Math.abs(Math.sin(t * Math.PI));
      const a = (1 - smooth(clamp(line * 3, 0, 1))) * (.25 + .45 * (fbm(n2, u * 3, v * 3, 2) * .5 + .5));
      return [vr, vg, vb, clamp(a * 255, 0, 255)];
    }, 0, 0, W, H, alpha);
  }

  scene('fruit', 'grapefruit', (ctx, P, r) => {
    const N = P.night;
    marble(ctx, r, N ? tone(P.accent, .2, .25) : tone(P.accent, .965, .08), N ? tone(P.accent, .34, .2) : tone(P.accent, .78, .12), N ? .5 : .55);
    spot(ctx, 820, 360, 1300, 900, N ? tone(P.yellow, .55, .4) : WHITE, N ? .2 : .5);
    const shadowC = N ? BLACK : tone(P.accent, .4, .4), shadowA = N ? .6 : .3;
    const peel = mixHex(tone(P.yellow, N ? .8 : .84, .95), tone(P.accent, N ? .72 : .76, .9), .35), peelLo = tone(P.green, N ? .55 : .62, .9), peelHi = tone(P.yellow, N ? .92 : .95, .6);
    const pith = tone(P.cyan, N ? .9 : .95, .3), pithLo = tone(P.cyan, N ? .78 : .86, .45);
    const fleshHi = tone(P.accent, N ? .78 : .82, .85), flesh = tone(P.red, N ? .62 : .66, 1.05), fleshLo = tone(P.red, N ? .44 : .5, 1.05);

    // A cut face: a rind, the white pith and wedges of juicy flesh.
    function face(x, y, R, rot, rind, depth) {
      spot(ctx, x + R * .1, y + R * .14, R * 1.12, R * 1.12, shadowC, shadowA);
      // The side of the fruit shows below the cut face.
      ctx.fillStyle = linear(ctx, x - R, y, x + R, y, [[0, peelHi], [.5, peel], [1, peelLo]]);
      ctx.beginPath(); circle(ctx, x + depth * .3, y + depth, R); ctx.fill();
      ctx.fillStyle = radial(ctx, x - R * .3, y - R * .3, R * .2, R * 1.1, [[0, peelHi], [.6, peel], [1, peelLo]]);
      ctx.beginPath(); circle(ctx, x, y, R); ctx.fill();
      // A thin colored zest, then a thick white pith.
      ctx.fillStyle = radial(ctx, x, y, R * .5, R * (1 - rind * .3), [[0, pith], [.85, pith], [1, pithLo]]);
      ctx.beginPath(); circle(ctx, x, y, R * (1 - rind * .3)); ctx.fill();
      const segs = 11 + Math.floor(r() * 3), ri = R * .06, ro = R * (1 - rind - .01);
      for (let j = 0; j < segs; j++) {
        const a0 = rot + j / segs * TAU + .016, a1 = rot + (j + 1) / segs * TAU - .016, am = (a0 + a1) / 2;
        const wedge = new Path2D();
        wedge.moveTo(x + Math.cos(am) * ri, y + Math.sin(am) * ri);
        wedge.lineTo(x + Math.cos(a0) * ro * .92, y + Math.sin(a0) * ro * .92);
        wedge.quadraticCurveTo(x + Math.cos(a0 + .02) * ro * 1.02, y + Math.sin(a0 + .02) * ro * 1.02, x + Math.cos(a0 + .08) * ro, y + Math.sin(a0 + .08) * ro);
        wedge.arc(x, y, ro, a0 + .08, a1 - .08);
        wedge.quadraticCurveTo(x + Math.cos(a1 - .02) * ro * 1.02, y + Math.sin(a1 - .02) * ro * 1.02, x + Math.cos(a1) * ro * .92, y + Math.sin(a1) * ro * .92);
        wedge.closePath();
        ctx.fillStyle = radial(ctx, x, y, ri, ro, [[0, fleshLo], [.35, flesh], [.85, fleshHi], [1, flesh]]);
        ctx.fill(wedge);
        ctx.save(); ctx.clip(wedge);
        // Juice cells: small teardrops that point out from the middle.
        const cells = Math.round(R * .55);
        for (let m = 0; m < cells; m++) {
          const rho = lerp(ri + R * .05, ro, Math.sqrt(r())), a = lerp(a0, a1, r()), l = R * (.03 + r() * .03);
          const cx = x + Math.cos(a) * rho, cy = y + Math.sin(a) * rho;
          ctx.fillStyle = rgba(r() < .5 ? fleshHi : fleshLo, .35 + r() * .3);
          ctx.beginPath(); ellipse(ctx, cx, cy, l, l * .35, a); ctx.fill();
          if (r() < .28) { ctx.fillStyle = rgba(WHITE, .45 + r() * .45); ctx.beginPath(); ellipse(ctx, cx - l * .2, cy - l * .2, l * .3, l * .12, a); ctx.fill(); }
        }
        ctx.strokeStyle = rgba(pith, .6); ctx.lineWidth = 2.5; ctx.stroke(wedge);
        ctx.restore();
      }
      ctx.fillStyle = pith; ctx.beginPath(); circle(ctx, x, y, ri * 1.1); ctx.fill();
      // A wet sheen across the face.
      spot(ctx, x - R * .28, y - R * .3, R * .45, R * .28, WHITE, N ? .2 : .3, -.6);
    }
    function whole(x, y, R) {
      spot(ctx, x + R * .15, y + R * .2, R * 1.1, R * 1.05, shadowC, shadowA);
      ctx.fillStyle = radial(ctx, x - R * .35, y - R * .4, R * .1, R * 1.15, [[0, peelHi], [.45, peel], [1, peelLo]]);
      ctx.beginPath(); circle(ctx, x, y, R); ctx.fill();
      ctx.save(); ctx.beginPath(); circle(ctx, x, y, R); ctx.clip();
      // A pink blush on one side of the peel.
      spot(ctx, x + R * .35, y + R * .25, R * .9, R * .8, tone(P.red, N ? .6 : .66, .9), .45);
      for (let i = 0; i < R * 6; i++) { const a = r() * TAU, d = Math.sqrt(r()) * R; ctx.fillStyle = rgba(r() < .5 ? peelLo : peelHi, .25); ctx.beginPath(); circle(ctx, x + Math.cos(a) * d, y + Math.sin(a) * d, .8 + r() * 1.4); ctx.fill(); }
      ctx.restore();
      spot(ctx, x - R * .35, y - R * .4, R * .3, R * .22, WHITE, .5, -.6);
    }
    function drop(x, y, s) {
      spot(ctx, x + 2, y + 3, s * 1.3, s * 1.1, shadowC, shadowA * .6);
      ctx.fillStyle = rgba(fleshHi, .45); ctx.beginPath(); ellipse(ctx, x, y, s, s * .85); ctx.fill();
      ctx.fillStyle = rgba(WHITE, .85); ctx.beginPath(); circle(ctx, x - s * .3, y - s * .3, s * .25); ctx.fill();
    }

    whole(1880, 600, 250);
    face(240, 880, 330, r(), .1, 26);
    face(1690, 120, 280, r(), .1, 22);
    face(1430, 900, 190, r(), .07, 9);
    face(640, 100, 150, r(), .07, 8);
    face(820, 1010, 120, r(), .07, 7);
    for (let i = 0; i < 14; i++) drop(lerp(480, 1300, r()), lerp(780, 1060, r()), 3 + r() * 6);
    for (let i = 0; i < 8; i++) drop(lerp(1200, 1600, r()), lerp(220, 420, r()), 3 + r() * 5);

    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('fruit', 'blackberries', (ctx, P, r) => {
    const N = P.night;
    if (N) skyGradient(ctx, [[0, tone(P.blue, .2, .5)], [.6, P.background], [1, P.darker_background]]);
    else skyGradient(ctx, [[0, tone(P.blue, .93, .2)], [.6, tone(P.magenta, .95, .12)], [1, tone(P.blue, .9, .22)]]);
    spot(ctx, 1240, 300, 900, 700, N ? tone(P.cyan, .5, .5) : WHITE, N ? .22 : .7);
    // Out of focus berries and leaves far behind.
    bokeh(ctx, r, 26, [0, 0, W, H], N ? [tone(P.magenta, .35, .6), tone(P.blue, .3, .5), tone(P.red, .3, .5)] : [tone(P.magenta, .9, .35), WHITE, tone(P.blue, .9, .3)], 74, N ? .35 : .5, .8);

    const Lt = unit([-.45, -.6, .66]), Hv = unit([Lt[0], Lt[1], Lt[2] + 1]);
    const cane = N ? tone(P.red, .3, .55) : tone(P.red, .4, .55), caneHi = N ? tone(P.red, .45, .5) : tone(P.red, .55, .5);
    const leafCols = N ? [tone(P.magenta, .3, .45), tone(P.red, .3, .5), tone(P.blue, .27, .4)] : [tone(P.magenta, .5, .45), tone(P.red, .5, .5), tone(P.blue, .45, .4)];
    const ripeLo = tone(P.magenta, N ? .14 : .17, .9), ripe = tone(P.magenta, N ? .3 : .33, 1), ripeHi = tone(P.cyan, N ? .72 : .75, .6);
    const redLo = tone(P.red, N ? .32 : .38, 1), red = tone(P.red, N ? .52 : .56, 1.1), redHi = tone(P.yellow, N ? .85 : .88, .7);

    // A cane: a tapered stem with thorns that point back to the root.
    function caneAlong(pts) {
      const path = taper(pts);
      ctx.fillStyle = cane; ctx.fill(path);
      ctx.save(); ctx.clip(path); ctx.translate(-1.5, -2); ctx.strokeStyle = rgba(caneHi, .8); ctx.lineWidth = 2; ctx.stroke(path); ctx.restore();
      for (let i = 1; i < pts.length - 1; i++) {
        const [x, y, w] = pts[i], [x2, y2] = pts[i + 1], a = Math.atan2(y2 - y, x2 - x);
        for (let s = 0; s < 2; s++) {
          if (r() < .35) continue;
          const side = (i + s) % 2 ? 1 : -1, t = r(), bx = lerp(x, x2, t), by = lerp(y, y2, t), l = 6 + w * .9;
          const nx = -Math.sin(a) * side, ny = Math.cos(a) * side;
          const ex = bx + nx * w * .45, ey = by + ny * w * .45;
          ctx.fillStyle = caneHi;
          ctx.beginPath();
          ctx.moveTo(ex - Math.cos(a) * l * .45, ey - Math.sin(a) * l * .45);
          ctx.quadraticCurveTo(ex + nx * l * .3, ey + ny * l * .3, ex + nx * l - Math.cos(a) * l * .7, ey + ny * l - Math.sin(a) * l * .7);
          ctx.lineTo(ex + Math.cos(a) * l * .35, ey + Math.sin(a) * l * .35);
          ctx.closePath(); ctx.fill();
        }
      }
    }
    // A leaflet with a toothed edge.
    function leaflet(x, y, len, ang, col) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      const wf = t => len * .28 * Math.sin(Math.PI * t ** .85);
      const pts = [];
      for (let i = 0; i <= 36; i++) { const t = i / 36; pts.push([t * len, -wf(t) * (i % 2 ? .9 : 1)]); }
      for (let i = 36; i >= 0; i--) { const t = i / 36; pts.push([t * len, wf(t) * (i % 2 ? .9 : 1)]); }
      const p = new Path2D(); smoothPath(p, pts, true, .3);
      ctx.fillStyle = linear(ctx, 0, -len * .3, 0, len * .3, [[0, tone(col, toOklch(col).L + .12)], [.5, col], [1, tone(col, toOklch(col).L - .08)]]);
      ctx.fill(p);
      ctx.strokeStyle = rgba(WHITE, N ? .12 : .25); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(len * .95, 0);
      for (let i = 1; i < 7; i++) { const t = i / 8; ctx.moveTo(t * len, 0); ctx.lineTo((t + .12) * len, -wf(t + .1) * .85); ctx.moveTo(t * len, 0); ctx.lineTo((t + .12) * len, wf(t + .1) * .85); }
      ctx.stroke();
      ctx.restore();
    }
    function leafGroup(x, y, ang, s) {
      const col = leafCols[Math.floor(r() * leafCols.length)];
      [[-.9, .75], [.9, .75], [-.35, .9], [.35, .9], [0, 1.1]].forEach(([da, l]) => {
        leaflet(x + Math.cos(ang) * 10, y + Math.sin(ang) * 10, 130 * s * l, ang + da, col);
      });
    }
    // A berry made of drupelets: small glossy balls packed on an oval.
    function berry(x, y, R, kind) {
      const lo = kind ? redLo : ripeLo, mid = kind ? red : ripe, hi = kind ? redHi : ripeHi;
      spot(ctx, x + R * .2, y + R * .3, R * 1.3, R * 1.3, BLACK, N ? .35 : .15);
      ctx.fillStyle = lo; ctx.beginPath(); ellipse(ctx, x, y, R * .95, R * 1.1); ctx.fill();
      const pts = [], M = 110, ga = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < M; i++) {
        const z = 1 - 2 * (i + .5) / M, rr = Math.sqrt(1 - z * z), a = i * ga;
        if (z < -.25) continue;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr, z]);
      }
      pts.sort((a, b) => a[2] - b[2]).forEach(([u, v, z]) => {
        const px = x + u * R * .82, py = y + v * R * .98, nn = unit([u, v * .85, z + .1]);
        const dif = Math.max(0, dot3(nn, Lt)), sp = Math.max(0, dot3(nn, Hv)) ** 30;
        const dr = R * .25 * (.55 + .45 * Math.max(0, z));
        ctx.fillStyle = radial(ctx, px - dr * .35, py - dr * .4, dr * .1, dr * 1.1, [[0, mixHex(mid, hi, dif * .45)], [.6, mixHex(lo, mid, .4 + dif * .6)], [1, lo]]);
        ctx.beginPath(); circle(ctx, px, py, dr); ctx.fill();
        ctx.fillStyle = rgba(WHITE, .25 + sp * .7 + dif * .2);
        ctx.beginPath(); circle(ctx, px - dr * .32, py - dr * .36, dr * .22); ctx.fill();
      });
    }
    function cluster(x, y, ang, count) {
      const items = [];
      for (let i = 0; i < count; i++) {
        const a = ang + (i - (count - 1) / 2) * .5 + (r() - .5) * .2, d = 40 + r() * 70;
        items.push([x + Math.cos(a) * d, y + Math.sin(a) * d, 28 + r() * 10, r() < .72 ? 0 : 1]);
      }
      ctx.strokeStyle = cane; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
      items.forEach(([bx, by]) => { ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo((x + bx) / 2, Math.min(y, by) - 10, bx, by - 20); ctx.stroke(); });
      items.sort((a, b) => a[1] - b[1]).forEach(([bx, by, R, kind]) => {
        berry(bx, by, R, kind);
        ctx.fillStyle = tone(P.red, N ? .3 : .38, .45);
        for (let s = 0; s < 5; s++) { ctx.beginPath(); leaf(ctx, bx, by - R * .98, R * .34, R * .09, -Math.PI / 2 + (s - 2) * .7); ctx.fill(); }
      });
    }
    function arch(x0, y0, x1, y1, lift, w) {
      const pts = [];
      for (let i = 0; i <= 26; i++) {
        const t = i / 26;
        pts.push([lerp(x0, x1, t), lerp(y0, y1, t) - Math.sin(t * Math.PI) * lift, w * (1 - t * .65)]);
      }
      return pts;
    }
    const canes = [arch(-60, 1000, 900, 300, 380, 22), arch(1990, 900, 1050, 160, 260, 20), arch(-40, 200, 640, 60, 120, 14), arch(1960, 380, 1500, 1100, 120, 14)];
    canes.forEach((pts, ci) => {
      for (let i = 4; i < pts.length - 2; i += 4 + Math.floor(r() * 2)) leafGroup(pts[i][0], pts[i][1], Math.atan2(pts[i + 1][1] - pts[i][1], pts[i + 1][0] - pts[i][0]) + (i % 8 ? 1 : -1) * 1.3, .8 + r() * .35);
      caneAlong(pts);
      for (let i = 6; i < pts.length - 1; i += 6 + Math.floor(r() * 3)) cluster(pts[i][0], pts[i][1] + 10, Math.PI / 2 + (r() - .5) * .6, 3 + Math.floor(r() * 3));
      void ci;
    });

    vignette(ctx, P, N ? .5 : .12);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('fruit', 'mochi', (ctx, P, r) => {
    const N = P.night, tableY = 610;
    // A plaster wall with a shoji panel on the left, lit from behind.
    ctx.fillStyle = linear(ctx, 0, 0, 0, tableY, N ? [[0, tone(P.accent, .17, .25)], [1, tone(P.accent, .22, .25)]] : [[0, tone(P.yellow, .93, .18)], [1, tone(P.yellow, .9, .2)]]);
    ctx.fillRect(0, 0, W, tableY);
    const sx0 = 60, sx1 = 760, sy1 = tableY - 30;
    const lamp = mixHex(P.yellow, P.orange, .5);
    ctx.fillStyle = N ? tone(lamp, .5, .75) : tone(P.yellow, .985, .12);
    ctx.fillRect(sx0, 0, sx1 - sx0, sy1);
    spot(ctx, (sx0 + sx1) / 2, 260, 420, 360, N ? tone(lamp, .8, .8) : WHITE, N ? .55 : .7);
    const barC = N ? tone(P.brown, .2, .6) : tone(P.brown, .5, .5);
    ctx.fillStyle = barC;
    for (let x = sx0; x <= sx1; x += (sx1 - sx0) / 4) ctx.fillRect(x - 4, 0, 8, sy1);
    for (let y = 90; y < sy1; y += 120) ctx.fillRect(sx0, y - 3, sx1 - sx0, 6);
    ctx.fillRect(sx0 - 14, 0, 18, sy1 + 4); ctx.fillRect(sx1 - 4, 0, 18, sy1 + 4); ctx.fillRect(sx0 - 14, sy1 - 6, sx1 - sx0 + 28, 16);
    // The glow of the panel spills on the wall.
    spot(ctx, (sx0 + sx1) / 2, 300, 900, 500, N ? tone(lamp, .6, .7) : WHITE, N ? .18 : .3);
    paper(ctx, P, r() * 1e9 | 0, .5);
    // The table.
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, tone(P.brown, .28, .6)], [1, tone(P.brown, .14, .6)]] : [[0, tone(P.yellow, .84, .45)], [1, tone(P.yellow, .76, .5)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    ctx.lineWidth = 1.4;
    for (let i = 0; i < 46; i++) {
      const y = tableY + (i / 46) ** 1.5 * (H - tableY) + 3;
      ctx.strokeStyle = rgba(N ? BLACK : tone(P.brown, .5, .5), N ? .2 : .07 + r() * .05);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.bezierCurveTo(600, y + (r() - .5) * 8, 1300, y + (r() - .5) * 8, W, y + (r() - .5) * 6); ctx.stroke();
    }
    ctx.fillStyle = rgba(BLACK, N ? .35 : .1); ctx.fillRect(0, tableY, W, 4);
    spot(ctx, 420, tableY + 80, 700, 140, N ? tone(P.yellow, .7, .6) : WHITE, N ? .2 : .35);
    const shadowC = N ? BLACK : tone(P.brown, .35, .5), shadowA = N ? .6 : .3;

    // A soft dome of rice cake, dusted with starch.
    const pink = tone(P.accent, N ? .78 : .86, .6), white = tone(P.yellow, N ? .9 : .97, .12), matcha = tone(P.green, N ? .66 : .74, .75), kinako = tone(P.yellow, N ? .72 : .78, .65);
    function mochi(x, y, w, h, col, dust, leafWrap) {
      spot(ctx, x + w * .1, y + w * .04, w * .62, w * .16, shadowC, shadowA * 1.2);
      const p = new Path2D();
      p.moveTo(-w / 2, 0);
      p.bezierCurveTo(-w * .58, -h * .38, -w * .34, -h, 0, -h);
      p.bezierCurveTo(w * .34, -h, w * .58, -h * .38, w / 2, 0);
      p.bezierCurveTo(w * .34, w * .13, -w * .34, w * .13, -w / 2, 0);
      ctx.save(); ctx.translate(x, y);
      const L0 = toOklch(col).L;
      ctx.fillStyle = radial(ctx, -w * .18, -h * .72, 2, w * .8, [[0, tone(col, Math.min(.99, L0 + .08), .6)], [.45, col], [1, tone(col, L0 - .2, 1.1)]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      ctx.fillStyle = linear(ctx, 0, -h * .2, 0, w * .12, [[0, rgba(WHITE, 0)], [1, rgba(WHITE, N ? .14 : .24)]]);
      ctx.fill(p);
      for (let i = 0; i < 160; i++) { ctx.fillStyle = rgba(dust, .25 + r() * .5); ctx.beginPath(); circle(ctx, (r() - .5) * w, -h * r() ** .7, .6 + r() * 1.6); ctx.fill(); }
      if (leafWrap) {
        // A salted cherry leaf wrapped around the front.
        const lf = new Path2D();
        lf.moveTo(-w * .56, -h * .1);
        for (let i = 0; i <= 20; i++) { const t = i / 20, xx = lerp(-w * .56, w * .56, t); lf.lineTo(xx, -h * (.28 + .3 * Math.sin(t * Math.PI)) + (i % 2 ? 4 : -2)); }
        lf.lineTo(w * .56, w * .2); lf.lineTo(-w * .56, w * .2); lf.closePath();
        ctx.fillStyle = linear(ctx, -w / 2, 0, w / 2, 0, [[0, tone(P.green, N ? .52 : .58, .6)], [.4, tone(P.green, N ? .6 : .66, .55)], [1, tone(P.green, N ? .34 : .42, .7)]]);
        ctx.fill(lf);
        ctx.strokeStyle = rgba(tone(P.green, N ? .8 : .85, .4), .55); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(-w * .5, -h * .05); ctx.quadraticCurveTo(0, -h * .32, w * .5, -h * .04); ctx.stroke();
        ctx.lineWidth = 1.2;
        for (let i = -4; i <= 4; i++) { const xx = i * w * .1; ctx.beginPath(); ctx.moveTo(xx, -h * .2 + Math.abs(i) * 3); ctx.lineTo(xx + w * .04, -h * .45 + Math.abs(i) * 6); ctx.stroke(); }
      }
      ctx.restore();
      spot(ctx, -w * .18, -h * .74, w * .16, h * .1, WHITE, N ? .35 : .5, -.2);
      ctx.restore();
    }
    // Dango: 3 balls on a bamboo skewer, lying on a board.
    function dango(x, y, ang, R, cols) {
      const ux = Math.cos(ang), uy = Math.sin(ang) * .5, step = R * 1.9;
      ctx.strokeStyle = tone(P.yellow, N ? .62 : .74, .6); ctx.lineWidth = 8; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x - ux * R * 1.5, y - uy * R * 1.5 - R * .55); ctx.lineTo(x + ux * (step * 2 + R * 2.6), y + uy * (step * 2 + R * 2.6) - R * .55); ctx.stroke();
      cols.forEach((c, i) => {
        const bx = x + ux * step * i, by = y + uy * step * i - R * .8;
        spot(ctx, bx + R * .3, by + R * .82, R * 1.1, R * .3, shadowC, shadowA * 1.2);
        const L0 = toOklch(c).L;
        ctx.fillStyle = radial(ctx, bx - R * .35, by - R * .4, R * .1, R * 1.15, [[0, tone(c, Math.min(.99, L0 + .08), .6)], [.5, c], [1, tone(c, L0 - .17, 1.1)]]);
        ctx.beginPath(); circle(ctx, bx, by, R); ctx.fill();
        ctx.fillStyle = rgba(WHITE, N ? .14 : .24); ctx.beginPath(); ellipse(ctx, bx + R * .1, by + R * .72, R * .62, R * .16); ctx.fill();
        spot(ctx, bx - R * .35, by - R * .45, R * .3, R * .2, WHITE, N ? .35 : .5, -.5);
      });
    }

    // The plate with 3 daifuku.
    const px = 640, py = 860, prx = 430, pry = 140;
    spot(ctx, px + 30, py + pry * .5, prx * 1.08, pry * 1.15, shadowC, shadowA);
    const glaze = N ? tone(P.cyan, .42, .7) : tone(P.cyan, .8, .55), gL = toOklch(glaze).L;
    ctx.fillStyle = tone(glaze, gL - .14); ctx.beginPath(); ellipse(ctx, px, py + 18, prx * .9, pry * .86); ctx.fill();
    ctx.fillStyle = linear(ctx, px - prx, 0, px + prx, 0, [[0, tone(glaze, gL + .08)], [1, tone(glaze, gL - .06)]]);
    ctx.beginPath(); ellipse(ctx, px, py, prx, pry); ctx.fill();
    ctx.fillStyle = radial(ctx, px - prx * .2, py - pry * .2, 4, prx * .8, [[0, tone(glaze, gL + .05)], [1, tone(glaze, gL - .05)]]);
    ctx.beginPath(); ellipse(ctx, px, py + 6, prx * .78, pry * .7); ctx.fill();
    ctx.strokeStyle = rgba(WHITE, .5); ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.ellipse(px, py, prx * .99, pry * .97, 0, Math.PI * 1.05, Math.PI * 1.65); ctx.stroke();
    for (let i = 0; i < 70; i++) { ctx.fillStyle = rgba(WHITE, .25 + r() * .4); ctx.beginPath(); circle(ctx, px + (r() - .5) * prx * 1.4, py + (r() - .5) * pry * 1.1, .6 + r() * 1.4); ctx.fill(); }
    mochi(px + 20, py - 20, 250, 168, white, WHITE, false);
    mochi(px - 150, py + 30, 262, 172, pink, WHITE, true);
    mochi(px + 170, py + 44, 250, 166, matcha, WHITE, false);

    // A board with 2 skewers of dango on the right.
    const bd = new Path2D();
    bd.moveTo(1180, 800); bd.lineTo(1880, 772); bd.lineTo(1960, 1000); bd.lineTo(1220, 1040); bd.closePath();
    spot(ctx, 1590, 960, 440, 90, shadowC, shadowA);
    ctx.save(); ctx.translate(0, 22); ctx.fillStyle = N ? tone(P.brown, .3, .6) : tone(P.yellow, .6, .55); ctx.fill(bd); ctx.restore();
    ctx.fillStyle = linear(ctx, 1180, 780, 1900, 1040, N ? [[0, tone(P.yellow, .5, .45)], [1, tone(P.yellow, .38, .5)]] : [[0, tone(P.yellow, .9, .35)], [1, tone(P.yellow, .82, .4)]]);
    ctx.fill(bd);
    ctx.save(); ctx.clip(bd); ctx.strokeStyle = rgba(tone(P.brown, .45, .5), N ? .25 : .12); ctx.lineWidth = 1.5;
    for (let i = 0; i < 18; i++) { const y = 790 + i * 14; ctx.beginPath(); ctx.moveTo(1150, y); ctx.bezierCurveTo(1400, y - 6 + r() * 8, 1700, y - 14 + r() * 8, 1980, y - 18); ctx.stroke(); }
    ctx.restore();
    dango(1300, 905, -.06, 56, [pink, white, matcha]);
    dango(1370, 985, -.08, 56, [pink, white, matcha]);

    // A tea cup at the back, with a thread of steam.
    const cx = 1640, top = 560, bot = 770, cR = 88;
    const cup = profile([[top, cR], [top + 120, cR * .96], [bot - 14, cR * .86], [bot, cR * .8]], 6);
    spot(ctx, cx + 30, bot + 4, cR * 1.5, 20, shadowC, shadowA);
    const cupC = N ? tone(P.blue, .4, .5) : tone(P.blue, .62, .5);
    latheFill(ctx, cx, cup, k => [mixHex(tone(cupC, toOklch(cupC).L + .12, .6), tone(cupC, toOklch(cupC).L - .14, 1), smooth((k + 1) / 2)), 1]);
    ctx.fillStyle = tone(P.yellow, N ? .8 : .9, .35); ctx.fill(lathe(cx, cut(cup, bot - 30, bot)));
    ctx.fillStyle = tone(cupC, toOklch(cupC).L - .2); ctx.beginPath(); ellipse(ctx, cx, top, cR, cR * .22); ctx.fill();
    ctx.fillStyle = tone(P.green, N ? .55 : .62, .8); ctx.beginPath(); ellipse(ctx, cx, top + 6, cR * .9, cR * .18); ctx.fill();
    ctx.strokeStyle = rgba(WHITE, .5); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, top, cR, cR * .22, 0, 0, Math.PI); ctx.stroke();
    streak(ctx, cx, cup, top + 20, bot - 40, -.62, -.48, WHITE, .35);
    ctx.save(); clipBox(ctx, cx - 120, top - 340, cx + 120, top); ctx.filter = blurPx(6); ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = rgba(WHITE, N ? .16 : .3); ctx.lineWidth = 10 - i * 2;
      const x0 = cx - 30 + i * 30;
      ctx.beginPath(); ctx.moveTo(x0, top - 10); ctx.bezierCurveTo(x0 + 40, top - 90, x0 - 50, top - 160, x0 + 10, top - 260 - i * 30); ctx.stroke();
    }
    ctx.restore();

    // A few cherry petals.
    for (let i = 0; i < 10; i++) {
      const x = lerp(160, 1900, r()), y = lerp(1000, 1070, r());
      if (x > 1150 && x < 1960 && y < 1050) continue;
      ctx.fillStyle = rgba(pink, .95); ctx.beginPath(); petal(ctx, x, y, 22, 12, r() * TAU); ctx.fill();
    }

    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  // ---------- glass ----------

  // The outline of a cup: the sides of a profile and the far half of its rim ellipse.
  function cupPath(cx, prof, ell) {
    const p = new Path2D(), [y0, r0] = prof[0];
    prof.forEach(([y, rad], i) => (i ? p.lineTo(cx - rad, y) : p.moveTo(cx - rad, y)));
    for (let i = prof.length - 1; i >= 0; i--) p.lineTo(cx + prof[i][1], prof[i][0]);
    p.ellipse(cx, y0, r0, r0 * ell, 0, 0, -Math.PI, true);
    p.closePath();
    return p;
  }
  // The rim of a cup: the far half thin and faint, the near half bright.
  function rim(ctx, cx, y, rad, ell, color, a, part = 'both') {
    ctx.lineWidth = 1.6;
    if (part !== 'front') { ctx.strokeStyle = rgba(color, a * .45); ctx.beginPath(); ctx.ellipse(cx, y, rad, rad * ell, 0, Math.PI, TAU); ctx.stroke(); }
    if (part !== 'back') {
      ctx.strokeStyle = linear(ctx, cx - rad, 0, cx + rad, 0, [[0, rgba(color, a * .5)], [.3, rgba(color, a)], [.7, rgba(color, a * .7)], [1, rgba(color, a * .35)]]);
      ctx.lineWidth = 2.4; ctx.beginPath(); ctx.ellipse(cx, y, rad, rad * ell, 0, 0, Math.PI); ctx.stroke();
    }
  }
  // The walls of a clear glass: dark at the silhouette, a broad soft reflection and a sharp one.
  function glassWalls(ctx, cx, prof, edge, edgeA, hi, hiA, y0 = prof[0][0], y1 = prof[prof.length - 1][0]) {
    const part = cut(prof, y0, y1);
    latheFill(ctx, cx, part, k => { const e = Math.abs(k); return [edge, e > .72 ? smooth((e - .72) / .28) * edgeA : 0]; });
    latheFill(ctx, cx, part, k => { const e = Math.abs(k); return [hi, e > .9 ? Math.max(0, 1 - Math.abs(e - .955) / .045) * hiA * .7 : 0]; });
    const h = y1 - y0;
    streak(ctx, cx, prof, y0 + h * .06, y1 - h * .12, -.8, -.6, hi, hiA * .55);
    streak(ctx, cx, prof, y0 + h * .1, y1 - h * .3, -.56, -.5, hi, hiA * .9);
    streak(ctx, cx, prof, y0 + h * .14, y1 - h * .22, .66, .72, hi, hiA * .6);
  }
  // The region of a liquid inside a profile, from its surface at yTop down to yBot.
  function liquidPath(cx, inner, yTop, yBot, ell) {
    const part = cut(inner, yTop, yBot), p = new Path2D(), rT = part[0][1];
    part.forEach(([y, rad], i) => (i ? p.lineTo(cx - rad, y) : p.moveTo(cx - rad, y)));
    for (let i = part.length - 1; i >= 0; i--) p.lineTo(cx + part[i][1], part[i][0]);
    p.ellipse(cx, yTop, rT, rT * ell, 0, 0, -Math.PI, true);
    p.closePath();
    return { path: p, part, rT };
  }
  // Mirrors what is above y below it, faded, as on a polished surface.
  function reflect(ctx, y, depth, alpha, blur = 2) {
    const [c, x] = layer();
    x.save();
    x.translate(0, 2 * y); x.scale(1, -1);
    x.drawImage(ctx.canvas, 0, 0, W, H);
    x.restore();
    // Keep only a band below y that fades out with depth.
    x.globalCompositeOperation = 'destination-in';
    x.fillStyle = linear(x, 0, y, 0, y + depth, [[0, rgba(BLACK, 1)], [1, rgba(BLACK, 0)]]);
    x.fillRect(0, y, W, depth);
    x.globalCompositeOperation = 'destination-out';
    x.fillStyle = BLACK; x.fillRect(0, 0, W, y);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha; ctx.filter = blurPx(blur);
    ctx.drawImage(c, 0, 0);
    ctx.restore();
  }

  scene('glass', 'absinthe', (ctx, P, r) => {
    const N = P.night, cx = 1240, tableY = 860;
    const green = tone(P.accent, N ? .62 : .66, 1.1), louche = tone(P.green, N ? .82 : .88, .5), deep = tone(P.accent, N ? .42 : .5, 1.1);
    // A dim bar at night, a bright cafe by day.
    if (N) skyGradient(ctx, [[0, tone(P.accent, .17, .5)], [.7, tone(P.accent, .12, .5)], [1, P.darker_background]], 0, tableY);
    else skyGradient(ctx, [[0, tone(P.accent, .96, .18)], [.75, tone(P.accent, .92, .22)], [1, tone(P.accent, .86, .26)]], 0, tableY);
    spot(ctx, cx, 560, 900, 620, N ? green : WHITE, N ? .22 : .5);
    bokeh(ctx, r, 22, [0, 40, W, 560], N ? [tone(P.yellow, .7, .8), tone(P.accent, .6, .9), tone(P.orange, .65, .7)] : [WHITE, tone(P.accent, .9, .4)], 60, N ? .45 : .5, .9);
    // The bar top.
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, tone(P.brown, .22, .6)], [1, tone(P.brown, .1, .6)]] : [[0, tone(P.accent, .86, .15)], [1, tone(P.accent, .8, .18)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    ctx.fillStyle = rgba(N ? tone(P.yellow, .6, .5) : WHITE, N ? .18 : .6); ctx.fillRect(0, tableY, W, 2);

    // A bottle of absinthe on the left, a little behind the glass.
    const bx = 400, bProf = profile([[170, 26], [190, 26], [300, 27], [350, 34], [400, 62], [440, 94], [480, 110], [500, 112], [800, 112], [835, 108], [845, 100]], 8);
    spot(ctx, bx + 40, 845, 190, 26, BLACK, N ? .6 : .25);
    ctx.fillStyle = N ? tone(P.accent, .2, .9) : tone(P.accent, .42, .9); ctx.fill(lathe(bx, bProf));
    latheFill(ctx, bx, bProf, k => [k < -.2 ? WHITE : BLACK, k < -.2 ? Math.max(0, .14 - Math.abs(k + .55) * .4) : clamp((k + .2) * .5, 0, .45)]);
    ctx.fillStyle = rgba(green, N ? .5 : .35); ctx.fill(lathe(bx, cut(bProf, 520, 830), -.86, .86));
    ctx.fillStyle = N ? tone(P.yellow, .8, .3) : tone(P.yellow, .94, .2);
    ctx.fill(lathe(bx, cut(bProf, 560, 720), -.95, .95));
    ctx.fillStyle = rgba(BLACK, .25); ctx.fill(lathe(bx, cut(bProf, 560, 720), .3, .95));
    ctx.strokeStyle = deep; ctx.lineWidth = 3; ctx.stroke(lathe(bx, cut(bProf, 576, 704), -.82, .82));
    ctx.fillStyle = deep; ctx.beginPath(); leaf(ctx, bx - 6, 676, 60, 13, -Math.PI / 2 - .2); ctx.fill();
    ctx.beginPath(); leaf(ctx, bx + 2, 670, 46, 10, -Math.PI / 2 + .45); ctx.fill();
    glassWalls(ctx, bx, bProf, BLACK, .3, WHITE, N ? .35 : .55);
    ctx.fillStyle = tone(P.red, N ? .35 : .45, .7); ctx.fill(lathe(bx, profile([[150, 30], [175, 30], [210, 27]], 3)));

    // The glass: a wide bowl, a small reservoir, a short stem and a round foot.
    const top = 330, ell = .2;
    const prof = profile([[top, 162], [400, 152], [480, 128], [545, 98], [585, 80], [612, 84], [640, 90], [668, 76], [690, 44], [705, 27], [790, 23], [830, 26], [846, 48], [856, 112], [860, 120]], 8);
    const inner = prof.map(([y, rad]) => [y, Math.max(0, rad - 6)]);
    spot(ctx, cx + 60, tableY + 6, 260, 34, BLACK, N ? .55 : .22);
    spot(ctx, cx + 20, tableY + 4, 170, 22, green, N ? .6 : .45);
    const snap = snapshot(ctx);
    rim(ctx, cx, top, 162, ell, WHITE, N ? .55 : .8, 'back');
    // The absinthe: clear green in the reservoir, clouded where the water falls in.
    const liqTop = 470, liq = liquidPath(cx, inner, liqTop, 676, ell);
    refract(ctx, snap, liq.path, cx, 580, -1.3, 1.1, 1);
    ctx.fillStyle = linear(ctx, 0, liqTop, 0, 680, [[0, rgba(louche, .82)], [.35, rgba(mixHex(louche, green, .5), .86)], [.7, rgba(green, .9)], [1, rgba(deep, .95)]]);
    ctx.fill(liq.path);
    ctx.save(); ctx.clip(liq.path);
    // Clouds of louche where the water sinks in, in one blurred stroke.
    ctx.filter = blurPx(10);
    ctx.strokeStyle = rgba(louche, .45); ctx.lineWidth = 18;
    ctx.beginPath();
    for (let i = 0; i < 7; i++) {
      const x0 = cx + (r() - .5) * 120;
      ctx.moveTo(x0, liqTop + 10); ctx.bezierCurveTo(x0 + (r() - .5) * 160, 540, x0 + (r() - .5) * 120, 590, cx + (r() - .5) * 60, 640);
    }
    ctx.stroke();
    ctx.filter = 'none';
    latheFill(ctx, cx, liq.part, k => [deep, Math.abs(k) > .6 ? (Math.abs(k) - .6) * 1.2 : 0]);
    ctx.restore();
    ctx.fillStyle = linear(ctx, cx - liq.rT, 0, cx + liq.rT, 0, [[0, rgba(louche, .9)], [.4, rgba(WHITE, .55)], [1, rgba(louche, .8)]]);
    ctx.beginPath(); ellipse(ctx, cx, liqTop, liq.rT, liq.rT * ell); ctx.fill();
    // Rings where the drops land.
    ctx.strokeStyle = rgba(WHITE, .5); ctx.lineWidth = 1.5;
    [18, 34, 52].forEach((rr, i) => { ctx.globalAlpha = 1 - i * .3; ctx.beginPath(); ctx.ellipse(cx - 10, liqTop + 2, rr, rr * ell, 0, 0, TAU); ctx.stroke(); });
    ctx.globalAlpha = 1;
    glassWalls(ctx, cx, prof, N ? BLACK : deep, N ? .45 : .3, WHITE, N ? .6 : .85, top, 700);
    // The foot.
    ctx.fillStyle = rgba(WHITE, N ? .08 : .2); ctx.beginPath(); ellipse(ctx, cx, 850, 120, 120 * ell); ctx.fill();
    ctx.strokeStyle = rgba(WHITE, N ? .5 : .8); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, 850, 120, 120 * ell, 0, .1, Math.PI - .1); ctx.stroke();
    glassWalls(ctx, cx, cut(prof, 700, 846), BLACK, .3, WHITE, N ? .5 : .7);
    rim(ctx, cx, top, 162, ell, WHITE, N ? .7 : .9, 'front');

    // The slotted spoon across the rim, with the sugar cube and the drip of water.
    ctx.save();
    ctx.translate(cx, top - 4); ctx.rotate(-.05); ctx.scale(1, .34);
    const sp = new Path2D();
    sp.moveTo(-250, -14); sp.lineTo(-150, -16); sp.bezierCurveTo(-110, -60, 110, -60, 150, -16); sp.lineTo(250, -14);
    sp.lineTo(256, 0); sp.lineTo(250, 14); sp.lineTo(150, 16); sp.bezierCurveTo(110, 60, -110, 60, -150, 16); sp.lineTo(-250, 14); sp.lineTo(-256, 0); sp.closePath();
    for (let i = -4; i <= 4; i++) for (let j = -1; j <= 1; j++) {
      if (Math.abs(i) === 4 && j) continue;
      sp.moveTo(i * 26 + 9, j * 22); sp.ellipse(i * 26, j * 22, 9, 5, 0, 0, TAU);
    }
    const metal = linear(ctx, -250, 0, 250, 0, [[0, tone(P.foreground, .5, .3)], [.2, tone(P.foreground, .95, .2)], [.38, tone(P.foreground, .6, .3)], [.55, tone(P.foreground, .9, .2)], [.75, tone(P.foreground, .45, .3)], [1, tone(P.foreground, .8, .2)]]);
    ctx.fillStyle = rgba(BLACK, .35); ctx.save(); ctx.translate(4, 14); ctx.fill(sp, 'evenodd'); ctx.restore();
    ctx.fillStyle = metal; ctx.fill(sp, 'evenodd');
    ctx.restore();
    // The sugar cube in 3 faces: top, left and right.
    const sx = cx - 6, sy = top - 30, s = 46;
    const face = (pts, c) => { ctx.fillStyle = c; ctx.beginPath(); poly(ctx, pts); ctx.fill(); };
    const sugarHi = N ? tone(P.foreground, .95, .2) : WHITE, sugar = tone(P.foreground, N ? .82 : .9, .25), sugarLo = tone(P.foreground, N ? .64 : .76, .3);
    face([[sx - s, sy - s * .3], [sx, sy - s * .6], [sx + s, sy - s * .3], [sx, sy]], sugarHi);
    face([[sx - s, sy - s * .3], [sx, sy], [sx, sy + s * 1.05], [sx - s, sy + s * .75]], sugar);
    face([[sx, sy], [sx + s, sy - s * .3], [sx + s, sy + s * .75], [sx, sy + s * 1.05]], sugarLo);
    for (let i = 0; i < 90; i++) { ctx.fillStyle = rgba(r() < .5 ? WHITE : BLACK, .08 + r() * .12); ctx.fillRect(sx - s + r() * 2 * s, sy - s * .5 + r() * s * 1.5, 2, 2); }
    ctx.fillStyle = rgba(green, .28); ctx.beginPath(); poly(ctx, [[sx - s, sy + s * .45], [sx, sy + s * .75], [sx + s, sy + s * .45], [sx + s, sy + s * .75], [sx, sy + s * 1.05], [sx - s, sy + s * .75]]); ctx.fill();
    // Water drips onto the cube from a tap above, and from the spoon into the glass.
    const drop = (x, y, d) => {
      ctx.fillStyle = rgba(N ? louche : WHITE, N ? .35 : .5);
      ctx.beginPath(); ctx.moveTo(x, y - d * 2.2); ctx.quadraticCurveTo(x + d * 1.05, y - d * .4, x + d, y); ctx.arc(x, y, d, 0, Math.PI); ctx.quadraticCurveTo(x - d * 1.05, y - d * .4, x, y - d * 2.2); ctx.fill();
      ctx.strokeStyle = rgba(WHITE, .85); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(x, y, d * .7, Math.PI * .9, Math.PI * 1.4); ctx.stroke();
      ctx.fillStyle = rgba(WHITE, .9); ctx.beginPath(); circle(ctx, x - d * .35, y - d * .2, d * .2); ctx.fill();
    };
    // A brass tap from a water fountain above.
    const brass = (x0, x1) => linear(ctx, x0, 0, x1, 0, [[0, tone(P.yellow, N ? .32 : .4, .9)], [.3, tone(P.yellow, N ? .8 : .86, .7)], [.55, tone(P.yellow, N ? .55 : .62, .9)], [1, tone(P.yellow, N ? .28 : .36, .9)]]);
    ctx.fillStyle = brass(cx - 30, cx + 30); ctx.beginPath(); ctx.roundRect(cx - 26, -20, 52, 58, 10); ctx.fill();
    ctx.fillStyle = brass(cx - 40, cx + 40); ctx.beginPath(); ctx.roundRect(cx - 36, 30, 72, 26, 12); ctx.fill();
    ctx.fillStyle = brass(cx - 12, cx + 12); ctx.beginPath(); ctx.roundRect(cx - 10, 50, 20, 52, 5); ctx.fill();
    ctx.fillStyle = brass(cx - 15, cx + 15); ctx.beginPath(); ctx.roundRect(cx - 14, 96, 28, 9, 4); ctx.fill();
    ctx.fillStyle = brass(cx + 30, cx + 90); ctx.beginPath(); ctx.roundRect(cx + 30, 36, 60, 12, 6); ctx.fill();
    ctx.beginPath(); circle(ctx, cx + 92, 42, 12); ctx.fill();
    drop(cx, 128, 7); drop(cx - 2, 214, 8);
    drop(cx - 30, 384, 6); drop(cx + 34, 420, 5);

    if (N) bloom(ctx, x => { x.fillStyle = rgba(green, .9); x.fill(liq.path); x.fillStyle = rgba(green, .5); x.fill(lathe(bx, cut(bProf, 520, 830), -.86, .86)); }, [90, 26], [.55, .35]);
    reflect(ctx, tableY, 170, N ? .22 : .14, 3);
    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('glass', 'bottles', (ctx, P, r) => {
    const N = P.night, sill = 790, front = 930, hue = P.accent;
    // The window: sky and soft trees behind 3 tall panes.
    skyGradient(ctx, N ? [[0, tone(hue, .14, .5)], [.6, tone(hue, .26, .5)], [1, tone(hue, .36, .55)]] : [[0, tone(hue, .88, .3)], [.7, tone(hue, .96, .16)], [1, WHITE]], 0, sill);
    if (N) { spot(ctx, 1180, 260, 520, 520, tone(hue, .75, .4), .35); spot(ctx, 1180, 260, 95, 95, tone(hue, .96, .15), 1); }
    else spot(ctx, 980, 520, 1200, 520, WHITE, .85);
    ctx.save(); clipBox(ctx, 0, 0, W, sill, 0); ctx.filter = blurPx(12);
    const n = makeNoise(r() * 1e9 | 0);
    fillRidge(ctx, ridgePoints(n, sill - 20, 300, .0018, 3), rgba(tone(hue, N ? .12 : .74, .7), N ? .95 : .55));
    fillRidge(ctx, ridgePoints(n, sill + 10, 160, .003, 9), rgba(tone(hue, N ? .09 : .66, .8), N ? .95 : .5));
    ctx.restore();
    // The frame and the bars.
    const frame = N ? tone(hue, .1, .4) : tone(hue, .88, .1), frameLo = N ? tone(hue, .06, .4) : tone(hue, .78, .14);
    ctx.fillStyle = frame;
    ctx.fillRect(0, 0, 80, sill); ctx.fillRect(W - 80, 0, 80, sill); ctx.fillRect(0, 0, W, 46);
    [660, 1260].forEach(x => ctx.fillRect(x - 14, 0, 28, sill));
    ctx.fillRect(0, 372, W, 22);
    ctx.fillStyle = frameLo;
    [660, 1260].forEach(x => ctx.fillRect(x + 8, 0, 6, sill)); ctx.fillRect(0, 388, W, 6);
    ctx.fillRect(74, 0, 6, sill); ctx.fillRect(W - 80, 0, 6, sill);
    // The sill: a lit top that runs toward us, a front edge, the wall below.
    ctx.fillStyle = linear(ctx, 0, sill, 0, front, N ? [[0, tone(hue, .3, .35)], [1, tone(hue, .2, .4)]] : [[0, tone(hue, .97, .08)], [1, tone(hue, .9, .12)]]);
    ctx.fillRect(0, sill, W, front - sill);
    ctx.fillStyle = N ? tone(hue, .13, .4) : tone(hue, .8, .15); ctx.fillRect(0, front, W, 42);
    ctx.fillStyle = linear(ctx, 0, front + 42, 0, H, N ? [[0, tone(hue, .11, .5)], [1, P.darker_background]] : [[0, tone(hue, .86, .14)], [1, tone(hue, .8, .18)]]);
    ctx.fillRect(0, front + 42, W, H - front - 42);
    ctx.fillStyle = rgba(N ? tone(hue, .7, .4) : WHITE, N ? .35 : .95); ctx.fillRect(0, front - 2, W, 2.5);
    ctx.fillStyle = rgba(BLACK, N ? .4 : .12); ctx.fillRect(0, sill, W, 3);

    const base = 846;
    const bottles = [
      { x: 230, kind: 'wine', h: 560, w: 86, L: N ? .42 : .48, C: 1.2 },
      { x: 420, kind: 'flask', h: 300, w: 124, L: N ? .6 : .64, C: 1 },
      { x: 590, kind: 'apothecary', h: 420, w: 70, L: N ? .34 : .4, C: 1.3 },
      { x: 1350, kind: 'tall', h: 500, w: 58, L: N ? .56 : .6, C: 1.1 },
      { x: 1540, kind: 'jug', h: 360, w: 134, L: N ? .46 : .52, C: 1.2 },
      { x: 1740, kind: 'small', h: 230, w: 60, L: N ? .66 : .7, C: .9 },
    ];
    const profOf = b => {
      const t = base - b.h, w = b.w;
      if (b.kind === 'wine') return profile([[t, w * .34], [t + 14, w * .34], [t + 22, w * .3], [t + b.h * .3, w * .32], [t + b.h * .42, w * .78], [t + b.h * .5, w], [base - 16, w], [base, w * .95]], 8);
      if (b.kind === 'flask') return profile([[t, w * .24], [t + 12, w * .24], [t + 18, w * .2], [t + 70, w * .22], [t + 110, w * .6], [t + 170, w * .98], [base - 50, w * .96], [base - 8, w * .74], [base, w * .66]], 8);
      if (b.kind === 'apothecary') return profile([[t, w * .46], [t + 22, w * .46], [t + 30, w * .36], [t + 62, w * .38], [t + 92, w * .92], [t + 108, w], [base - 10, w], [base, w * .96]], 6);
      if (b.kind === 'jug') return profile([[t, w * .24], [t + 16, w * .24], [t + 24, w * .2], [t + 64, w * .22], [t + 120, w * .78], [t + 190, w], [base - 60, w * .98], [base - 12, w * .86], [base, w * .8]], 8);
      if (b.kind === 'small') return profile([[t, w * .4], [t + 14, w * .4], [t + 22, w * .34], [t + 52, w * .36], [t + 80, w * .9], [t + 96, w], [base - 8, w], [base, w * .95]], 6);
      return profile([[t, w * .36], [t + 14, w * .36], [t + 22, w * .3], [t + b.h * .32, w * .32], [t + b.h * .46, w * .9], [t + b.h * .52, w], [base - 14, w], [base, w * .95]], 8);
    };
    // Light through the glass lays green light and shade across the sill.
    bottles.forEach(b => {
      const g = tone(hue, Math.min(.92, b.L + .32), 1.2);
      const sh = new Path2D();
      sh.moveTo(b.x - b.w * .95, base); sh.lineTo(b.x + b.w * .95, base); sh.lineTo(b.x + b.w * 1.25, front); sh.lineTo(b.x - b.w * .85, front); sh.closePath();
      ctx.save(); clipBox(ctx, b.x - b.w * 1.3, base, b.x + b.w * 1.6, front, 30); ctx.filter = blurPx(8);
      ctx.fillStyle = linear(ctx, 0, base, 0, front, [[0, rgba(N ? BLACK : tone(hue, .35, .6), N ? .55 : .3)], [1, rgba(N ? BLACK : tone(hue, .35, .6), N ? .2 : .08)]]);
      ctx.fill(sh);
      ctx.restore();
      spot(ctx, b.x + b.w * .12, base + (front - base) * .5, b.w * .5, (front - base) * .42, g, N ? .75 : .9);
      spot(ctx, b.x + b.w * .12, base + (front - base) * .5, b.w * .18, (front - base) * .18, WHITE, N ? .4 : .55);
    });
    const snap = snapshot(ctx);
    bottles.forEach(b => {
      const prof = profOf(b), body = lathe(b.x, prof), top = prof[0][0];
      const lit = tone(hue, Math.min(.95, b.L + .3), b.C * .9), g = tone(hue, b.L, b.C), dark = tone(hue, b.L * .42, b.C);
      refract(ctx, snap, body, b.x, base - b.h * .4, -1.35, 1.1, .9);
      // Thin glass in the middle lets the light through. The edges are thick and dark.
      latheFill(ctx, b.x, prof, k => {
        const e = Math.abs(k);
        return [e < .5 ? mixHex(lit, g, e / .5) : mixHex(g, dark, (e - .5) / .5), .5 + e * e * .45];
      });
      ctx.fillStyle = linear(ctx, 0, top, 0, base, [[0, rgba(dark, .25)], [.45, rgba(dark, 0)], [.93, rgba(dark, .15)], [1, rgba(dark, .7)]]);
      ctx.fill(body);
      ctx.save(); ctx.clip(body);
      ctx.fillStyle = rgba(lit, .55); ctx.fillRect(b.x - b.w, base - 14, b.w * 2, 3);
      for (let i = 0; i < 14; i++) {
        const y = lerp(base - b.h * .55, base - 20, r()), rad = radAt(prof, y), x = b.x + (r() - .5) * 1.6 * rad;
        ctx.strokeStyle = rgba(lit, .55); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.ellipse(x, y, 1.5 + r() * 3, 1.2 + r() * 2, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
      glassWalls(ctx, b.x, prof, dark, .45, WHITE, N ? .55 : .8);
      // The lip at the top.
      const [ty, tr] = prof[0];
      ctx.fillStyle = dark; ctx.beginPath(); ellipse(ctx, b.x, ty, tr, tr * .3); ctx.fill();
      ctx.strokeStyle = rgba(lit, .9); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(b.x, ty, tr, tr * .3, 0, 0, TAU); ctx.stroke();
      if (b.kind === 'apothecary') {
        ctx.fillStyle = radial(ctx, b.x - 8, ty - 26, 2, 30, [[0, lit], [.6, g], [1, dark]]);
        ctx.beginPath(); circle(ctx, b.x, ty - 20, 22); ctx.fill();
        ctx.fillStyle = rgba(WHITE, .6); ctx.beginPath(); circle(ctx, b.x - 8, ty - 28, 5); ctx.fill();
      }
    });
    if (N) bloom(ctx, x => bottles.forEach(b => { x.fillStyle = rgba(tone(hue, b.L + .25, 1.1), .55); x.fill(lathe(b.x, profOf(b), -.5, .5)); }), [60, 16], [.4, .25]);
    vignette(ctx, P, N ? .45 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('glass', 'wine', (ctx, P, r) => {
    const N = P.night, tableY = 820, wine = P.accent;
    const wineC = tone(wine, N ? .32 : .36, 1.2), wineHi = tone(wine, N ? .55 : .6, 1.1), wineLo = tone(wine, N ? .16 : .2, 1.1);
    if (N) skyGradient(ctx, [[0, tone(wine, .17, .6)], [.8, tone(wine, .12, .6)], [1, P.darker_background]], 0, tableY);
    else skyGradient(ctx, [[0, tone(wine, .96, .12)], [.8, tone(wine, .93, .15)], [1, tone(wine, .88, .2)]], 0, tableY);
    if (N) bokeh(ctx, r, 18, [0, 40, W, 600], [tone(wine, .7, .6), tone(P.yellow, .75, .6)], 76, .5, .9);
    spot(ctx, 420, 380, 900, 600, N ? tone(P.yellow, .7, .5) : WHITE, N ? .2 : .6);
    // A linen cloth on the table.
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, tone(wine, .26, .35)], [1, tone(wine, .14, .4)]] : [[0, tone(wine, .97, .06)], [1, tone(wine, .9, .1)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    ctx.fillStyle = rgba(N ? BLACK : tone(wine, .5, .3), N ? .25 : .08); ctx.fillRect(0, tableY, W, 3);

    // The bottle.
    const bx = 360, bProf = profile([[120, 28], [150, 28], [290, 29], [350, 40], [395, 70], [432, 94], [470, 104], [780, 104], [812, 100], [822, 92]], 8);
    spot(ctx, bx + 50, 822, 200, 24, BLACK, N ? .6 : .25);
    ctx.fillStyle = tone(wine, N ? .12 : .18, 1); ctx.fill(lathe(bx, bProf));
    latheFill(ctx, bx, bProf, k => [wineHi, Math.max(0, .5 - Math.abs(k + .45) * 1.4) * (N ? .6 : .8)]);
    ctx.fillStyle = N ? tone(P.yellow, .82, .25) : tone(P.yellow, .96, .15); ctx.fill(lathe(bx, cut(bProf, 560, 720), -.97, .97));
    ctx.fillStyle = linear(ctx, bx - 104, 0, bx + 104, 0, [[0, rgba(BLACK, .2)], [.3, rgba(BLACK, 0)], [.6, rgba(BLACK, .05)], [1, rgba(BLACK, .45)]]); ctx.fill(lathe(bx, cut(bProf, 560, 720), -.97, .97));
    ctx.strokeStyle = wineC; ctx.lineWidth = 2; ctx.stroke(lathe(bx, cut(bProf, 584, 696), -.8, .8));
    // A small emblem of grapes and 2 thin rules, with no lettering.
    ctx.fillStyle = wineC;
    [[0, 0], [-11, 0], [11, 0], [-5.5, 10], [5.5, 10], [0, 20]].forEach(([dx, dy]) => { ctx.beginPath(); circle(ctx, bx + dx, 618 + dy, 5.5); ctx.fill(); });
    ctx.beginPath(); leaf(ctx, bx + 2, 610, 20, 7, -1.1); ctx.fill();
    ctx.fillRect(bx - 44, 660, 88, 2.5); ctx.fillRect(bx - 30, 672, 60, 2);
    ctx.fillStyle = tone(wine, N ? .3 : .38, 1); ctx.fill(lathe(bx, profile([[100, 31], [120, 31], [190, 30]], 3)));
    glassWalls(ctx, bx, bProf, BLACK, .25, WHITE, N ? .5 : .8);

    // A wine glass: a tulip bowl on a long stem.
    function wineGlass(cx, top, s, level, swirl, snap) {
      const ell = .22;
      const bowl = profile([[top, 92 * s], [top + 60 * s, 112 * s], [top + 140 * s, 122 * s], [top + 210 * s, 104 * s], [top + 255 * s, 60 * s], [top + 272 * s, 14 * s]], 10);
      const stemTop = top + 272 * s, foot = tableY;
      spot(ctx, cx + 40, foot + 4, 150 * s, 18, BLACK, N ? .5 : .2);
      spot(ctx, cx + 20, foot + 2, 80 * s, 10, wineHi, N ? .5 : .35);
      rim(ctx, cx, top, 92 * s, ell, WHITE, N ? .5 : .8, 'back');
      const inner = bowl.map(([y, rad]) => [y, Math.max(0, rad - 4)]);
      const yl = top + level * s, liq = liquidPath(cx, inner, yl, stemTop - 6, ell);
      if (swirl) {
        // A swirled wine climbs one side of the bowl: a tilted surface and a thin film above it.
        const p = new Path2D(), part = cut(inner, top + 60 * s, stemTop - 6), tilt = .28;
        part.forEach(([y, rad], i) => (i ? p.lineTo(cx - rad, y) : p.moveTo(cx - rad, y)));
        for (let i = part.length - 1; i >= 0; i--) p.lineTo(cx + part[i][1], part[i][0]);
        p.closePath();
        // A thin film of wine on the glass above the surface, with a few legs running down.
        ctx.save(); ctx.clip(p);
        const film = new Path2D(), fx0 = cx - 130 * s, fx1 = cx + 130 * s;
        film.moveTo(fx0, yl + Math.tan(tilt) * 130 * s);
        for (let i = 0; i <= 20; i++) { const t = i / 20, x = lerp(fx0, fx1, t); film.lineTo(x, yl - 30 * s - t * 70 * s - Math.sin(t * 9) * 6 * s); }
        film.lineTo(fx1, yl - Math.tan(tilt) * 130 * s + 40 * s); film.closePath();
        ctx.fillStyle = linear(ctx, 0, yl - 110 * s, 0, yl + 20 * s, [[0, rgba(wineHi, 0)], [.5, rgba(wineHi, .2)], [1, rgba(wineC, .35)]]);
        ctx.filter = blurPx(4); ctx.fill(film); ctx.filter = 'none';
        ctx.translate(cx, yl); ctx.rotate(-tilt);
        const surf = new Path2D(); surf.rect(-300 * s, 0, 600 * s, 400 * s); surf.ellipse(0, 0, 130 * s, 130 * s * ell, 0, 0, -Math.PI, true);
        ctx.fillStyle = linear(ctx, 0, 0, 0, 200 * s, [[0, wineHi], [.4, wineC], [1, wineLo]]);
        ctx.fill(surf);
        ctx.fillStyle = rgba(wineHi, .6); ctx.beginPath(); ellipse(ctx, 0, 0, 130 * s, 130 * s * ell); ctx.fill();
        ctx.fillStyle = rgba(WHITE, .25); ctx.beginPath(); ellipse(ctx, -30 * s, -4 * s, 70 * s, 70 * s * ell * .6); ctx.fill();
        ctx.restore();
      } else {
        refract(ctx, snap, liq.path, cx, yl + 60 * s, -1.2, 1.1, 1);
        ctx.fillStyle = linear(ctx, 0, yl, 0, stemTop, [[0, rgba(wineC, .85)], [1, rgba(wineLo, .95)]]);
        ctx.fill(liq.path);
        ctx.save(); ctx.clip(liq.path);
        latheFill(ctx, cx, liq.part, k => [wineLo, Math.abs(k) > .5 ? (Math.abs(k) - .5) * 1.4 : 0]);
        spot(ctx, cx - 20 * s, yl + 70 * s, 50 * s, 60 * s, wineHi, .5);
        ctx.restore();
        ctx.fillStyle = linear(ctx, cx - liq.rT, 0, cx + liq.rT, 0, [[0, wineC], [.35, wineHi], [1, wineLo]]);
        ctx.beginPath(); ellipse(ctx, cx, yl, liq.rT, liq.rT * ell); ctx.fill();
      }
      glassWalls(ctx, cx, bowl, N ? BLACK : wineLo, N ? .35 : .22, WHITE, N ? .6 : .9);
      // The stem and the foot.
      const stem = profile([[stemTop, 9 * s], [stemTop + 20 * s, 6 * s], [foot - 30, 6 * s], [foot - 10, 14 * s], [foot - 4, 86 * s], [foot, 90 * s]], 6);
      ctx.fillStyle = rgba(WHITE, N ? .1 : .3); ctx.fill(lathe(cx, stem));
      glassWalls(ctx, cx, stem, N ? BLACK : wineLo, .3, WHITE, N ? .6 : .9);
      ctx.strokeStyle = rgba(WHITE, N ? .45 : .8); ctx.lineWidth = 1.6; ctx.beginPath(); ctx.ellipse(cx, foot - 4, 88 * s, 88 * s * ell, 0, .1, Math.PI - .1); ctx.stroke();
      rim(ctx, cx, top, 92 * s, ell, WHITE, N ? .7 : 1, 'front');
    }
    const snap = snapshot(ctx);
    wineGlass(1180, 330, 1.25, 170, true, snap);
    wineGlass(1600, 400, 1.08, 150, false, snap);
    // A cork and a few drops on the cloth.
    ctx.save(); ctx.translate(780, 900); ctx.rotate(-.3);
    spot(ctx, 8, 22, 70, 16, BLACK, N ? .5 : .2);
    ctx.fillStyle = linear(ctx, 0, -22, 0, 22, [[0, tone(P.yellow, N ? .7 : .8, .5)], [1, tone(P.yellow, N ? .45 : .55, .6)]]); ctx.beginPath(); ctx.roundRect(-55, -22, 110, 44, 8); ctx.fill();
    ctx.fillStyle = wineC; ctx.beginPath(); ellipse(ctx, 55, 0, 9, 22); ctx.fill();
    ctx.restore();
    ctx.fillStyle = rgba(wineC, .7); [[860, 960, 9], [900, 990, 5], [700, 1010, 7]].forEach(([x, y, s]) => { ctx.beginPath(); ellipse(ctx, x, y, s * 1.4, s * .6); ctx.fill(); });

    if (N) reflect(ctx, tableY, 160, .15, 4);
    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  // The region where f is above thr, as a path made of grid cells.
  // Neighbor cells share edges in opposite directions, so the fill has no seams.
  function isoPath(f, x0, y0, x1, y1, step, thr = 1) {
    const cols = Math.ceil((x1 - x0) / step) + 1, rows = Math.ceil((y1 - y0) / step) + 1, v = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) v[j * cols + i] = f(x0 + i * step, y0 + j * step) - thr;
    const p = new Path2D();
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const X = x0 + i * step, Y = y0 + j * step;
      const c = [[X, Y, v[j * cols + i]], [X + step, Y, v[j * cols + i + 1]], [X + step, Y + step, v[(j + 1) * cols + i + 1]], [X, Y + step, v[(j + 1) * cols + i]]];
      if (c.every(q => q[2] < 0)) continue;
      const pts = [];
      for (let k = 0; k < 4; k++) {
        const [px, py, pv] = c[k], [qx, qy, qv] = c[(k + 1) % 4];
        if (pv >= 0) pts.push([px, py]);
        if ((pv >= 0) !== (qv >= 0)) { const t = pv / (pv - qv); pts.push([px + (qx - px) * t, py + (qy - py) * t]); }
      }
      if (pts.length < 3) continue;
      p.moveTo(pts[0][0], pts[0][1]);
      for (let k = 1; k < pts.length; k++) p.lineTo(pts[k][0], pts[k][1]);
      p.closePath();
    }
    return p;
  }

  scene('glass', 'lava-lamp', (ctx, P, r) => {
    const N = P.night, shelf = 930;
    // A room with a soft wavy wallpaper.
    if (N) skyGradient(ctx, [[0, tone(P.magenta, .16, .6)], [.85, tone(P.magenta, .12, .6)], [1, P.darker_background]], 0, shelf);
    else skyGradient(ctx, [[0, tone(P.accent, .95, .15)], [.85, tone(P.accent, .91, .2)], [1, tone(P.accent, .86, .24)]], 0, shelf);
    ctx.save();
    for (let i = 0; i < 16; i++) {
      const x0 = i * 130 - 40;
      ctx.fillStyle = rgba(i % 2 ? (N ? tone(P.accent, .3, .6) : tone(P.accent, .8, .4)) : (N ? tone(P.orange, .3, .6) : tone(P.orange, .82, .4)), N ? .1 : .12);
      ctx.beginPath(); ctx.moveTo(x0, 0);
      for (let y = 0; y <= shelf; y += 20) ctx.lineTo(x0 + Math.sin(y * .012 + i) * 26, y);
      for (let y = shelf; y >= 0; y -= 20) ctx.lineTo(x0 + 64 + Math.sin(y * .012 + i + .8) * 26, y);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    // The shelf.
    ctx.fillStyle = linear(ctx, 0, shelf, 0, H, N ? [[0, tone(P.magenta, .24, .5)], [1, tone(P.magenta, .1, .6)]] : [[0, tone(P.orange, .85, .3)], [1, tone(P.orange, .76, .35)]]);
    ctx.fillRect(0, shelf, W, H - shelf);
    ctx.fillStyle = rgba(WHITE, N ? .15 : .5); ctx.fillRect(0, shelf, W, 2);

    const lamps = [
      { x: 1360, h: 860, R: 128, liquid: P.magenta, wax: P.green },
      { x: 430, h: 660, R: 98, liquid: P.accent, wax: P.yellow },
      { x: 1780, h: 470, R: 70, liquid: P.orange, wax: P.magenta },
    ];
    const parts = lamps.map(l => {
      const baseH = l.h * .3, capH = l.h * .085, gTop = shelf - l.h + capH, gBot = shelf - baseH, R = l.R;
      const glass = profile([[gTop, R * .36], [lerp(gTop, gBot, .25), R * .55], [lerp(gTop, gBot, .6), R * .86], [lerp(gTop, gBot, .86), R], [gBot, R * .78]], 10);
      const base = profile([[gBot - 6, R * .8], [gBot + 10, R * .76], [shelf - 6, R * 1.18], [shelf, R * 1.2]], 4);
      const cap = profile([[gTop - capH, R * .2], [gTop - capH + 6, R * .22], [gTop + 4, R * .4]], 4);
      return { ...l, baseH, capH, gTop, gBot, glass, base, cap };
    });
    // Light from the lamps on the wall and the shelf.
    parts.forEach(l => {
      spot(ctx, l.x, l.gTop + (l.gBot - l.gTop) * .6, l.R * 5, l.h * .75, vivid(l.liquid, N ? .55 : .8, .12), N ? .35 : .4);
      spot(ctx, l.x, shelf + 30, l.R * 3.2, 50, vivid(l.wax, N ? .6 : .8, .12), N ? .35 : .3);
    });
    parts.forEach(l => {
      const { x, R, glass, gTop, gBot } = l;
      spot(ctx, x + 20, shelf + 4, R * 1.6, 16, BLACK, N ? .6 : .25);
      // The liquid glows brighter near the bulb at the bottom.
      const liqLo = vivid(l.liquid, N ? .32 : .5, .13), liq = vivid(l.liquid, N ? .52 : .66, .15), liqHi = vivid(l.liquid, N ? .75 : .84, .11);
      latheFill(ctx, x, glass, k => [mixHex(liq, liqLo, Math.abs(k) ** 1.6), 1]);
      const body = lathe(x, glass);
      ctx.fillStyle = linear(ctx, 0, gTop, 0, gBot, [[0, rgba(liqLo, .5)], [.6, rgba(liq, 0)], [1, rgba(liqHi, .55)]]);
      ctx.fill(body);
      // Wax: metaballs that rise from a pool at the bottom.
      const balls = [[x, gBot - R * .1, R * 1.1, R * .3]];
      const n = 4 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = r(), y = lerp(gTop + R * .5, gBot - R * .7, t), rad = radAt(glass, y);
        const s = R * (.16 + r() * .22);
        balls.push([x + (r() - .5) * rad * .7, y, s * (.85 + r() * .2), s * (1 + r() * .7)]);
      }
      balls.push([x + (r() - .5) * R * .3, gBot - R * .55, R * .26, R * .5]);
      const field = (px, py) => { let v = 0; balls.forEach(([bx, by, rx, ry]) => { const d = ((px - bx) / rx) ** 2 + ((py - by) / ry) ** 2; v += 1 / (d + .001); }); return v; };
      const thr = 1.1, wax = isoPath(field, x - R, gTop, x + R, gBot, 2.5, thr);
      const waxLo = vivid(l.wax, N ? .44 : .5, .15), waxC = vivid(l.wax, N ? .72 : .76, .17), waxHi = vivid(l.wax, N ? .88 : .93, .1);
      // Shade the wax from a soft height: a blurred mask of the wax, so a merged
      // blob shades as one body. The bulb lights the undersides.
      const step = 3, cols = Math.ceil(2 * R / step) + 1, rows = Math.ceil((gBot - gTop) / step) + 1;
      let hgt = new Float32Array(cols * rows);
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) hgt[j * cols + i] = field(x - R + i * step, gTop + j * step) > thr ? 1 : 0;
      const boxBlur = (src, rad, horiz) => {
        const out = new Float32Array(src.length), n1 = horiz ? cols : rows, n2 = horiz ? rows : cols;
        for (let b2 = 0; b2 < n2; b2++) {
          const at = a2 => (horiz ? src[b2 * cols + clamp(a2, 0, n1 - 1)] : src[clamp(a2, 0, n1 - 1) * cols + b2]);
          let acc = 0;
          for (let a2 = -rad; a2 <= rad; a2++) acc += at(a2);
          for (let a2 = 0; a2 < n1; a2++) {
            out[horiz ? b2 * cols + a2 : a2 * cols + b2] = acc / (2 * rad + 1);
            acc += at(a2 + rad + 1) - at(a2 - rad);
          }
        }
        return out;
      };
      const rb = Math.max(2, Math.round(R * .2 / step));
      for (let pass = 0; pass < 2; pass++) { hgt = boxBlur(hgt, rb, true); hgt = boxBlur(hgt, rb, false); }
      const Lb = unit([0, .8, .6]), Hs = unit([-.35, -.45, 1.7]), [lr, lg, lb] = rgb(waxLo), [mr, mg, mb] = rgb(waxC), [hr, hg, hb] = rgb(waxHi);
      ctx.save(); ctx.clip(lathe(x, glass, -.97, .97)); ctx.clip(wax);
      texture(ctx, cols, rows, (u, v) => {
        const i = Math.round(u * (cols - 1)), j = Math.round(v * (rows - 1)), at = (a2, b2) => hgt[clamp(b2, 0, rows - 1) * cols + clamp(a2, 0, cols - 1)];
        const h = at(i, j);
        if (h < .02) return [mr, mg, mb, 0];
        const sc = R * 1.2, gx = (at(i + 1, j) - at(i - 1, j)) / (2 * step), gy = (at(i, j + 1) - at(i, j - 1)) / (2 * step);
        const nn = unit([-gx * sc, -gy * sc, 1]);
        const dif = Math.max(0, dot3(nn, Lb)), sp = Math.max(0, dot3(nn, Hs)) ** 30 * .3;
        const k = clamp(.3 + h * .5 - Math.max(0, -nn[1]) * .45, 0, 1), d = smooth(clamp((dif - .45) / .5, 0, 1)) * (N ? .8 : .9) + v * .08;
        let cr = lerp(lerp(lr, mr, k), hr, d), cg = lerp(lerp(lg, mg, k), hg, d), cb = lerp(lerp(lb, mb, k), hb, d);
        cr = lerp(cr, 255, sp); cg = lerp(cg, 255, sp); cb = lerp(cb, 255, sp);
        return [cr, cg, cb, 255];
      }, x - R, gTop, (cols - 1) * step, (rows - 1) * step);
      ctx.restore();
      glassWalls(ctx, x, glass, BLACK, N ? .35 : .25, WHITE, N ? .55 : .75);
      // Metal base and cap.
      const metal = (pr, dark) => latheFill(ctx, x, pr, k => {
        const t = (k + 1) / 2, v = .5 + .5 * Math.cos(t * 9 - 1.2);
        return [mixHex(dark, N ? tone(P.foreground, .9, .3) : WHITE, v * (1 - Math.abs(k) ** 4) * .9), 1];
      });
      metal(l.base, N ? tone(l.liquid, .22, .6) : tone(l.liquid, .4, .6));
      metal(l.cap, N ? tone(l.liquid, .22, .6) : tone(l.liquid, .4, .6));
      ctx.fillStyle = rgba(BLACK, .35);
      for (let i = -3; i <= 3; i++) { ctx.beginPath(); circle(ctx, x + i * R * .2, shelf - l.baseH * .35, R * .05); ctx.fill(); }
    });
    if (N) bloom(ctx, x => parts.forEach(l => { x.fillStyle = rgba(tone(l.liquid, .6, 1), .8); x.fill(lathe(l.x, l.glass)); }), [80, 24], [.5, .3]);
    reflect(ctx, shelf, 140, N ? .22 : .14, 3);
    vignette(ctx, P, N ? .5 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('glass', 'aperitivo', (ctx, P, r) => {
    const N = P.night, tableY = 800;
    const drink = tone(P.accent, N ? .56 : .62, 1.15), drinkLo = tone(P.red, N ? .36 : .42, 1.1), drinkHi = tone(P.yellow, N ? .8 : .84, 1);
    const olive = vivid(P.green, N ? .64 : .68, .13), oliveLo = vivid(P.green, N ? .38 : .44, .1), oliveHi = vivid(P.green, N ? .88 : .9, .08);
    const orange = vivid(P.yellow, N ? .74 : .78, .15), orangeLo = vivid(P.accent, N ? .52 : .58, .15);
    // Evening over a piazza with strings of lights, or a sunny terrace under an awning.
    if (N) {
      skyGradient(ctx, [[0, tone(P.magenta, .18, .5)], [.55, tone(P.accent, .3, .6)], [1, tone(P.yellow, .45, .6)]], 0, tableY);
      bokeh(ctx, r, 18, [0, 300, W, 760], [tone(P.yellow, .8, .7), tone(P.accent, .65, .8)], 64, .5, .9);
      [[-50, 60, 2000, 120, 160], [-50, 210, 2000, 260, 120]].forEach(([x0, y0, x1, y1, sag]) => {
        ctx.strokeStyle = rgba(BLACK, .5); ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + x1) / 2, (y0 + y1) / 2 + sag * 2, x1, y1); ctx.stroke();
        for (let t = .03; t < 1; t += .055) {
          const x = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * (x0 + x1) / 2 + t * t * x1, y = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * ((y0 + y1) / 2 + sag * 2) + t * t * y1;
          spot(ctx, x, y + 10, 40, 40, tone(P.yellow, .85, .8), .35);
          ctx.fillStyle = tone(P.yellow, .95, .5); ctx.beginPath(); circle(ctx, x, y + 10, 5); ctx.fill();
        }
      });
    } else {
      skyGradient(ctx, [[0, tone(P.yellow, .95, .2)], [1, tone(P.accent, .9, .25)]], 0, tableY);
      spot(ctx, 900, 500, 1100, 500, WHITE, .7);
      // A striped awning with a scalloped edge.
      const stripes = 14, sw = W / stripes;
      for (let i = 0; i < stripes; i++) {
        ctx.fillStyle = i % 2 ? tone(P.background, .98, .3) : tone(P.accent, .62, .9);
        ctx.beginPath(); ctx.moveTo(i * sw, 0); ctx.lineTo(i * sw, 120); ctx.arc(i * sw + sw / 2, 120, sw / 2, Math.PI, 0, true); ctx.lineTo((i + 1) * sw, 0); ctx.closePath(); ctx.fill();
      }
      ctx.fillStyle = linear(ctx, 0, 0, 0, 170, [[0, rgba(BLACK, 0)], [.7, rgba(BLACK, .05)], [1, rgba(BLACK, .16)]]);
      ctx.fillRect(0, 0, W, 175);
      spot(ctx, W / 2, 230, 1200, 70, tone(P.accent, .5, .5), .18);
    }
    // A marble table.
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, tone(P.yellow, .36, .3)], [1, tone(P.yellow, .2, .3)]] : [[0, tone(P.yellow, .96, .1)], [1, tone(P.yellow, .9, .12)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    ctx.fillStyle = rgba(WHITE, N ? .2 : .8); ctx.fillRect(0, tableY, W, 2);
    const shadowC = N ? BLACK : tone(P.accent, .35, .4), shadowA = N ? .55 : .25;

    // The tumbler with the drink, the ice and a slice of orange.
    const cx = 1280, top = 400, ell = .22, R = 160;
    const prof = profile([[top, R], [600, R * .97], [tableY + 30, R * .9]], 6);
    const inner = prof.map(([y, rad]) => [y, rad - 7]);
    spot(ctx, cx + 120, tableY + 40, R * 1.6, 40, shadowC, shadowA);
    spot(ctx, cx + 60, tableY + 40, R * 1.1, 30, drink, N ? .7 : .6);
    const snap = snapshot(ctx);
    rim(ctx, cx, top, R, ell, WHITE, N ? .6 : .9, 'back');
    const yl = 500, liq = liquidPath(cx, inner, yl, tableY - 10, ell);
    refract(ctx, snap, liq.path, cx, 640, -1.3, 1.1, 1);
    ctx.fillStyle = linear(ctx, 0, yl, 0, tableY, [[0, rgba(drinkHi, .78)], [.4, rgba(drink, .85)], [1, rgba(drinkLo, .92)]]);
    ctx.fill(liq.path);
    ctx.save(); ctx.clip(liq.path);
    latheFill(ctx, cx, liq.part, k => [drinkLo, Math.abs(k) > .55 ? (Math.abs(k) - .55) * 1.3 : 0]);
    // The orange wheel against the glass.
    ctx.save(); ctx.translate(cx + 50, 640); ctx.scale(1, .95);
    ctx.fillStyle = rgba(orange, .9); ctx.beginPath(); ctx.arc(0, 0, 110, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(tone(P.yellow, .92, .4), .9); ctx.beginPath(); ctx.arc(0, 0, 96, 0, TAU); ctx.fill();
    for (let i = 0; i < 10; i++) {
      const a0 = i / 10 * TAU + .04, a1 = (i + 1) / 10 * TAU - .04;
      ctx.fillStyle = rgba(mixHex(orange, drink, .4), .9);
      ctx.beginPath(); ctx.moveTo(Math.cos((a0 + a1) / 2) * 8, Math.sin((a0 + a1) / 2) * 8); ctx.arc(0, 0, 90, a0, a1); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = rgba(drink, .35); ctx.fill(liq.path);
    ctx.restore();
    // Ice cubes: clear above the drink, tinted under it.
    const cube = (x, y, s, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      const p = new Path2D(); p.roundRect(-s / 2, -s / 2, s, s, s * .18);
      ctx.fillStyle = rgba(WHITE, .22); ctx.fill(p);
      ctx.strokeStyle = rgba(WHITE, .7); ctx.lineWidth = 2.5; ctx.stroke(p);
      ctx.fillStyle = linear(ctx, -s / 2, -s / 2, s / 2, s / 2, [[0, rgba(WHITE, .6)], [.3, rgba(WHITE, .05)], [.7, rgba(WHITE, .15)], [1, rgba(WHITE, .5)]]);
      ctx.beginPath(); ctx.roundRect(-s * .38, -s * .38, s * .76, s * .76, s * .12); ctx.fill();
      ctx.restore();
    };
    ctx.save(); ctx.clip(cupPath(cx, inner, ell));
    cube(cx - 60, yl - 10, 120, .2); cube(cx + 70, yl - 26, 110, -.25); cube(cx - 10, yl + 80, 100, .5);
    ctx.restore();
    ctx.fillStyle = linear(ctx, cx - liq.rT, 0, cx + liq.rT, 0, [[0, rgba(drink, .6)], [.4, rgba(drinkHi, .5)], [1, rgba(drinkLo, .6)]]);
    ctx.beginPath(); ellipse(ctx, cx, yl, liq.rT, liq.rT * ell); ctx.fill();
    // The heavy base.
    ctx.fillStyle = rgba(WHITE, N ? .12 : .3); ctx.fill(lathe(cx, cut(prof, tableY - 10, tableY + 30)));
    glassWalls(ctx, cx, prof, N ? BLACK : drinkLo, N ? .4 : .25, WHITE, N ? .6 : .9);
    rim(ctx, cx, top, R, ell, WHITE, N ? .75 : 1, 'front');
    // An orange slice on the rim.
    ctx.save(); ctx.translate(cx - R + 10, top + 10); ctx.rotate(-.5);
    ctx.fillStyle = orangeLo; ctx.beginPath(); ctx.arc(0, 0, 76, Math.PI, TAU); ctx.fill();
    ctx.fillStyle = tone(P.yellow, .93, .4); ctx.beginPath(); ctx.arc(0, -2, 68, Math.PI, TAU); ctx.fill();
    for (let i = 0; i < 5; i++) { const a0 = Math.PI + i / 5 * Math.PI + .05, a1 = Math.PI + (i + 1) / 5 * Math.PI - .05; ctx.fillStyle = orange; ctx.beginPath(); ctx.moveTo(0, -4); ctx.arc(0, -4, 62, a0, a1); ctx.closePath(); ctx.fill(); }
    ctx.restore();

    // A small dish of green olives with a pick.
    const ox = 640, oy = 900;
    spot(ctx, ox + 30, oy + 30, 230, 50, shadowC, shadowA);
    ctx.fillStyle = N ? tone(P.cyan, .5, .6) : tone(P.cyan, .78, .5); ctx.beginPath(); ellipse(ctx, ox, oy + 16, 200, 56); ctx.fill();
    ctx.fillStyle = N ? tone(P.cyan, .66, .5) : tone(P.cyan, .9, .4); ctx.beginPath(); ellipse(ctx, ox, oy, 210, 60); ctx.fill();
    ctx.fillStyle = N ? tone(P.cyan, .58, .55) : tone(P.cyan, .84, .45); ctx.beginPath(); ellipse(ctx, ox, oy + 4, 170, 44); ctx.fill();
    // A green olive: an oval with a glossy skin.
    const oliveAt = (x, y, s, a) => {
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      spot(ctx, 6, s * .55, s * 1.25, s * .45, shadowC, shadowA);
      ctx.fillStyle = radial(ctx, -s * .35, -s * .3, 1, s * 1.3, [[0, oliveHi], [.35, olive], [.85, oliveLo], [1, tone(oliveLo, toOklch(oliveLo).L - .08)]]);
      ctx.beginPath(); ellipse(ctx, 0, 0, s * 1.25, s * .9); ctx.fill();
      ctx.fillStyle = rgba(WHITE, .75); ctx.beginPath(); ellipse(ctx, -s * .45, -s * .38, s * .3, s * .1, -.25); ctx.fill();
      ctx.fillStyle = rgba(WHITE, .9); ctx.beginPath(); circle(ctx, -s * .18, -s * .5, s * .06); ctx.fill();
      ctx.fillStyle = rgba(oliveHi, .35); ctx.beginPath(); ellipse(ctx, s * .3, s * .55, s * .6, s * .14, -.1); ctx.fill();
      ctx.restore();
    };
    [[-100, -10], [-30, 6], [50, -14], [115, 4], [-10, -28], [-70, 14]].forEach(([dx, dy]) => oliveAt(ox + dx, oy + dy - 14, 30, (r() - .5) * .8));
    // 3 olives on a pick across the dish.
    ctx.strokeStyle = tone(P.yellow, N ? .7 : .78, .5); ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(ox - 260, oy - 70); ctx.lineTo(ox + 210, oy - 20); ctx.stroke();
    ctx.fillStyle = tone(P.red, N ? .55 : .58, 1); ctx.beginPath(); circle(ctx, ox - 262, oy - 70, 10); ctx.fill();
    [[-150, -58], [-70, -50], [10, -41]].forEach(([dx, dy]) => oliveAt(ox + dx, oy + dy, 34, .1));
    // Half an orange on the left, cut face up: a round peel below a juicy face.
    const hx = 250, hy = 920, hr = 175, hry = 72;
    spot(ctx, hx + 40, hy + 120, hr * 1.15, 50, shadowC, shadowA * 1.2);
    ctx.fillStyle = radial(ctx, hx - hr * .45, hy + 20, 10, hr * 1.3, [[0, tone(orange, toOklch(orange).L + .08, .8)], [.45, orange], [1, orangeLo]]);
    ctx.beginPath(); ctx.ellipse(hx, hy, hr, hr * .82, 0, 0, Math.PI); ctx.lineTo(hx - hr, hy); ctx.fill();
    spot(ctx, hx - hr * .5, hy + hr * .35, hr * .22, hr * .1, WHITE, .4, -.3);
    for (let i = 0; i < 160; i++) { const a = r() * Math.PI, d = Math.sqrt(r()); ctx.fillStyle = rgba(orangeLo, .25); ctx.beginPath(); circle(ctx, hx + Math.cos(a) * hr * d, hy + Math.sin(a) * hr * .8 * d, .8 + r()); ctx.fill(); }
    ctx.fillStyle = orangeLo; ctx.beginPath(); ellipse(ctx, hx, hy, hr, hry); ctx.fill();
    ctx.fillStyle = tone(P.yellow, N ? .9 : .95, .3); ctx.beginPath(); ellipse(ctx, hx, hy, hr * .95, hry * .93); ctx.fill();
    const juice = vivid(P.accent, N ? .68 : .7, .16), juiceHi = vivid(P.yellow, N ? .82 : .85, .15);
    for (let i = 0; i < 11; i++) {
      const a0 = i / 11 * TAU + .03, a1 = (i + 1) / 11 * TAU - .03;
      ctx.fillStyle = radial(ctx, hx, hy, 4, hr * .88, [[0, juice], [1, juiceHi]]);
      ctx.beginPath(); ctx.moveTo(hx + Math.cos((a0 + a1) / 2) * 6, hy + Math.sin((a0 + a1) / 2) * 3); ctx.ellipse(hx, hy, hr * .86, hry * .84, 0, a0, a1); ctx.closePath(); ctx.fill();
    }
    for (let i = 0; i < 90; i++) { const a = r() * TAU, d = .15 + r() * .7; ctx.fillStyle = rgba(r() < .5 ? WHITE : orangeLo, .3 + r() * .3); ctx.beginPath(); ellipse(ctx, hx + Math.cos(a) * hr * .86 * d, hy + Math.sin(a) * hry * .84 * d, 4, 1.5, Math.atan2(Math.sin(a) * hry, Math.cos(a) * hr)); ctx.fill(); }
    ctx.fillStyle = tone(P.yellow, N ? .9 : .95, .3); ctx.beginPath(); ellipse(ctx, hx, hy, 10, 5); ctx.fill();
    spot(ctx, hx - hr * .3, hy - hry * .35, hr * .3, hry * .2, WHITE, .35);

    if (N) bloom(ctx, x => { x.fillStyle = rgba(drink, .7); x.fill(liq.path); }, [70, 20], [.35, .25]);
    vignette(ctx, P, N ? .45 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('glass', 'sherbet', (ctx, P, r) => {
    const N = P.night, tableY = 830;
    if (N) skyGradient(ctx, [[0, P.lighter_background], [.8, P.background], [1, P.dark_background]], 0, tableY);
    else skyGradient(ctx, [[0, tone(P.background, .975, 1)], [.8, P.background], [1, P.dark_background]], 0, tableY);
    windowLight(ctx, 160, 90, 520, 420, 220, N ? tone(P.accent, .6, .4) : WHITE, N ? .08 : .55, 16);
    spot(ctx, 1260, 420, 760, 520, N ? tone(P.accent, .5, .5) : WHITE, N ? .2 : .5);
    spot(ctx, 300, 260, 700, 460, N ? tone(P.green, .45, .5) : vivid(P.green, .9, .06), N ? .14 : .5);
    spot(ctx, 1750, 250, 700, 460, N ? tone(P.magenta, .45, .5) : vivid(P.magenta, .9, .06), N ? .14 : .5);
    spot(ctx, 900, 120, 700, 300, N ? tone(P.accent, .45, .5) : vivid(P.accent, .92, .05), N ? .1 : .4);
    ctx.fillStyle = linear(ctx, 0, tableY, 0, H, N ? [[0, P.lighter_background], [1, P.darker_background]] : [[0, tone(P.background, .93, 1)], [1, tone(P.background, .87, 1)]]);
    ctx.fillRect(0, tableY, W, H - tableY);
    ctx.fillStyle = rgba(WHITE, N ? .08 : .6); ctx.fillRect(0, tableY, W, 2);
    const shadowC = N ? BLACK : tone(P.muted, .4, 1), shadowA = N ? .55 : .22;
    const Lt = unit([-.45, -.6, .66]);

    // A scoop: a frosty ball with a ragged lip where the scoop let go.
    function scoop(x, y, R, col) {
      const L0 = toOklch(col).L, lo = vivid(col, L0 - .2, .1), hi = tone(col, Math.min(.97, L0 + .1), .6);
      const pts = [];
      for (let i = 0; i < 64; i++) {
        const a = i / 64 * TAU, low = Math.max(0, Math.sin(a)), rag = low > .3 ? (r() - .5) * .07 : (r() - .5) * .015;
        const rr = R * (1 + rag + .025 * Math.sin(a * 9 + R));
        pts.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr * (.9 + low * .06)]);
      }
      const p = new Path2D(); smoothPath(p, pts, true);
      ctx.fillStyle = radial(ctx, x - R * .38, y - R * .42, R * .05, R * 1.3, [[0, hi], [.42, col], [.85, lo], [1, tone(lo, toOklch(lo).L - .06)]]);
      ctx.fill(p);
      ctx.save(); ctx.clip(p);
      // Fine frost: pale grains on the lit side, small pits in the shade.
      for (let i = 0; i < R * 5; i++) {
        const a = r() * TAU, d = Math.sqrt(r()) * R, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d;
        const lit = dot3(unit([Math.cos(a) * d / R, Math.sin(a) * d / R, Math.sqrt(Math.max(0, 1 - (d / R) ** 2))]), Lt);
        ctx.fillStyle = rgba(r() < lit ? WHITE : lo, .18 + r() * .25);
        ctx.beginPath(); circle(ctx, px, py, .6 + r() * 1.8); ctx.fill();
      }
      // Soft folds near the bottom.
      ctx.filter = blurPx(3); ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const yy = y + R * (.35 + i * .2), w = R * (.85 - i * .2);
        ctx.strokeStyle = rgba(lo, .45); ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(x - w, yy); ctx.quadraticCurveTo(x, yy + R * .12, x + w, yy - R * .05); ctx.stroke();
        ctx.strokeStyle = rgba(hi, .5); ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x - w, yy - 6); ctx.quadraticCurveTo(x, yy + R * .12 - 6, x + w, yy - R * .05 - 6); ctx.stroke();
      }
      ctx.filter = 'none';
      ctx.restore();
      spot(ctx, x - R * .4, y - R * .45, R * .3, R * .2, WHITE, N ? .3 : .45, -.6);
    }
    // A coupe: a wide, shallow glass bowl on a stem.
    function coupe(cx, top, s, scoops, extras) {
      const ell = .22, rr = 250 * s;
      const bowl = profile([[top, rr], [top + 40 * s, rr * .97], [top + 90 * s, rr * .8], [top + 128 * s, rr * .45], [top + 145 * s, rr * .12], [top + 150 * s, 18 * s]], 10);
      const stemTop = top + 150 * s;
      spot(ctx, cx + 40, tableY + 6, 230 * s, 26, shadowC, shadowA);
      spot(ctx, cx, tableY + 4, 150 * s, 16, scoops[0][3], N ? .3 : .25);
      const stem = profile([[stemTop, 16 * s], [stemTop + 30 * s, 10 * s], [tableY - 26, 10 * s], [tableY - 8, 30 * s], [tableY - 3, 120 * s], [tableY, 124 * s]], 6);
      ctx.fillStyle = rgba(WHITE, N ? .08 : .25); ctx.fill(lathe(cx, stem));
      glassWalls(ctx, cx, stem, N ? BLACK : tone(P.muted, .4, 1), .3, WHITE, N ? .6 : .9);
      ctx.strokeStyle = rgba(WHITE, N ? .5 : .85); ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cx, tableY - 3, 122 * s, 122 * s * ell, 0, .1, Math.PI - .1); ctx.stroke();
      rim(ctx, cx, top, rr, ell, WHITE, N ? .5 : .8, 'back');
      // The scoops sit down in the bowl.
      const sorted = [...scoops].sort((a, b) => a[1] - b[1]);
      sorted.forEach(([dx, dy, R, col]) => scoop(cx + dx * s, top + dy * s, R * s, col));
      if (extras) extras();
      // The front of the bowl: a veil of glass over the scoops, then the reflections.
      const front = lathe(cx, bowl);
      ctx.fillStyle = linear(ctx, 0, top, 0, top + 150 * s, [[0, rgba(WHITE, N ? .1 : .22)], [1, rgba(WHITE, N ? .16 : .3)]]);
      ctx.fill(front);
      glassWalls(ctx, cx, bowl, N ? BLACK : tone(P.muted, .4, 1), N ? .4 : .22, WHITE, N ? .65 : .95);
      rim(ctx, cx, top, rr, ell, WHITE, N ? .8 : 1, 'front');
    }
    const orangeS = vivid(P.accent, N ? .8 : .82, .12), rasp = vivid(P.red, N ? .7 : .72, .13), lime = vivid(P.green, N ? .85 : .87, .1);
    // A rolled wafer and a mint leaf for the big dish.
    const garnish = () => {
      ctx.save(); ctx.translate(1430, 340); ctx.rotate(.5);
      const wafer = tone(P.yellow, N ? .76 : .82, .7);
      ctx.fillStyle = linear(ctx, 0, -16, 0, 16, [[0, tone(wafer, toOklch(wafer).L + .1, .6)], [.5, wafer], [1, tone(wafer, toOklch(wafer).L - .2)]]);
      ctx.beginPath(); ctx.roundRect(-150, -16, 300, 32, 14); ctx.fill();
      ctx.strokeStyle = rgba(tone(P.brown, .4, .7), .5); ctx.lineWidth = 3;
      for (let x = -140; x < 150; x += 22) { ctx.beginPath(); ctx.moveTo(x, -16); ctx.lineTo(x + 14, 16); ctx.stroke(); }
      ctx.fillStyle = tone(P.brown, .45, .7); ctx.beginPath(); ellipse(ctx, -150, 0, 6, 16); ctx.fill();
      ctx.restore();
      // 2 mint leaves tucked in beside the lime scoop.
      [[1222, 438, -2.5, 96], [1226, 444, -1.75, 84]].forEach(([x, y, a, l]) => {
        const c0 = tone(P.green, N ? .6 : .66, 1.1), c1 = tone(P.green, N ? .38 : .44, 1.1);
        ctx.fillStyle = linear(ctx, x, y, x + Math.cos(a) * l, y + Math.sin(a) * l, [[0, c1], [.6, c0], [1, tone(P.green, N ? .72 : .78, .9)]]);
        ctx.beginPath(); leaf(ctx, x, y, l, l * .36, a); ctx.fill();
        ctx.strokeStyle = rgba(WHITE, .4); ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l * .9, y + Math.sin(a) * l * .9); ctx.stroke();
      });
    };
    coupe(1300, 570, 1.25, [[-100, 10, 118, orangeS], [100, 18, 114, rasp], [0, -100, 112, lime]], garnish);
    coupe(440, 650, .85, [[-62, 8, 108, rasp], [70, 4, 102, lime]]);
    // A spoon on the table.
    ctx.save(); ctx.translate(820, 960); ctx.rotate(-.12);
    spot(ctx, 10, 18, 230, 20, shadowC, shadowA);
    ctx.fillStyle = linear(ctx, -200, 0, 200, 0, [[0, tone(P.foreground, .5, .3)], [.3, tone(P.foreground, .95, .2)], [.6, tone(P.foreground, .6, .3)], [1, tone(P.foreground, .85, .2)]]);
    ctx.beginPath(); ctx.roundRect(-200, -7, 300, 14, 7); ctx.fill();
    ctx.beginPath(); ellipse(ctx, 140, 0, 60, 30); ctx.fill();
    ctx.fillStyle = rgba(WHITE, .5); ctx.beginPath(); ellipse(ctx, 125, -8, 30, 10); ctx.fill();
    ctx.restore();

    if (N) reflect(ctx, tableY, 150, .16, 3);
    vignette(ctx, P, N ? .45 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });

  scene('glass', 'gelato', (ctx, P, r) => {
    const N = P.night;
    // The back wall of the shop: tiles under a warm light.
    if (N) skyGradient(ctx, [[0, tone(P.brown, .18, .7)], [1, tone(P.brown, .24, .7)]], 0, 360);
    else skyGradient(ctx, [[0, tone(P.yellow, .95, .25)], [1, tone(P.yellow, .9, .3)]], 0, 360);
    ctx.strokeStyle = rgba(N ? BLACK : tone(P.yellow, .6, .4), N ? .35 : .22); ctx.lineWidth = 2;
    for (let y = 20; y < 360; y += 56) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); for (let x = (Math.round(y / 56) % 2) * 56; x < W; x += 112) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + 56); ctx.stroke(); } }
    spot(ctx, W / 2, 80, 1300, 300, N ? tone(P.yellow, .75, .7) : WHITE, N ? .3 : .6);
    // The case: a steel ledge, then a cold, dim well for the pans.
    const steel = (y0, y1, dark) => {
      ctx.fillStyle = linear(ctx, 0, y0, 0, y1, [[0, tone(P.foreground, dark ? .32 : .82, .15)], [.45, tone(P.foreground, dark ? .55 : .95, .1)], [1, tone(P.foreground, dark ? .22 : .7, .15)]]);
      ctx.fillRect(0, y0, W, y1 - y0);
    };
    steel(340, 372, N);
    ctx.fillStyle = linear(ctx, 0, 372, 0, 820, N ? [[0, tone(P.cyan, .14, .3)], [1, tone(P.cyan, .2, .3)]] : [[0, tone(P.cyan, .8, .15)], [1, tone(P.cyan, .86, .12)]]);
    ctx.fillRect(0, 372, W, 448);

    const flav = {
      pistachio: [P.green, N ? .72 : .76, .09, 'nuts'], strawberry: [P.red, N ? .72 : .74, .12, 'berry'],
      stracciatella: [P.yellow, N ? .94 : .96, .02, 'fleck'], chocolate: [P.brown, N ? .42 : .44, .07, 'shard'],
      lemon: [P.yellow, N ? .9 : .9, .1, 'slice'], mint: [P.cyan, N ? .84 : .86, .07, 'leaf'],
      hazelnut: [P.orange, N ? .66 : .68, .08, 'nuts'], berry: [P.magenta, N ? .6 : .62, .11, 'berry'], vanilla: [P.yellow, N ? .92 : .93, .05, 'pod'],
    };
    // A pan of gelato: ridges of a heaped, swirled top, stacked from back to front.
    function pan(x0, x1, yb, yf, hgt, name) {
      const [src, L0, C0, garnish] = flav[name], col = vivid(src, L0, C0);
      const lo = vivid(src, L0 - .22, C0 * .9), hi = tone(col, Math.min(.98, L0 + .08), .7);
      const inset = (x1 - x0) * .04, n = 6, ph = r() * 6, freq = 2 + r() * 1.5;
      // The opening of the pan, dark at the back.
      ctx.fillStyle = N ? tone(P.foreground, .25, .1) : tone(P.foreground, .6, .1);
      ctx.beginPath(); poly(ctx, [[x0 + inset, yb], [x1 - inset, yb], [x1, yf], [x0, yf]]); ctx.fill();
      const ridge = (t, j) => {
        const pts = [], y = lerp(yb, yf, t), c = hgt * Math.sin(Math.PI * clamp(t * .9 + .12, 0, 1)) ** .7;
        for (let i = 0; i <= 28; i++) {
          const u = i / 28, xa = lerp(lerp(x0 + inset, x0, t), lerp(x1 - inset, x1, t), u);
          // The heap rounds down into the corners of the pan.
          const bump = Math.sin(Math.PI * u) ** .55;
          pts.push([xa, y - c * bump + (Math.sin(u * freq * Math.PI + ph + j * 2.3) * .16 + Math.sin(u * 5.3 - j * 1.1 + ph) * .06) * hgt * bump]);
        }
        return pts;
      };
      for (let j = 0; j < n; j++) {
        const t = j / (n - 1), top = ridge(t, j), yBot = Math.min(yf, lerp(yb, yf, t) + hgt * .35);
        const band = new Path2D();
        band.moveTo(top[0][0], yBot); top.forEach(([px, py]) => band.lineTo(px, py)); band.lineTo(top[top.length - 1][0], yBot); band.closePath();
        const yTop = Math.min(...top.map(q => q[1]));
        ctx.fillStyle = linear(ctx, 0, yTop, 0, yBot, [[0, hi], [.3, col], [1, lo]]);
        ctx.fill(band);
        ctx.strokeStyle = rgba(WHITE, N ? .35 : .55); ctx.lineWidth = 2.5; ctx.lineCap = 'round';
        ctx.beginPath(); top.slice(2, -2).forEach(([px, py], i) => (i ? ctx.lineTo(px, py + 3) : ctx.moveTo(px, py + 3))); ctx.stroke();
        if (name === 'stracciatella') for (let i = 0; i < 16; i++) { const q = top[2 + Math.floor(r() * (top.length - 4))]; ctx.fillStyle = tone(P.brown, .25, .8); ctx.beginPath(); ellipse(ctx, q[0] + (r() - .5) * 10, q[1] + 8 + r() * hgt * .25, 3, 2, r() * 3); ctx.fill(); }
      }
      // The steel rim at the front of the pan.
      ctx.fillStyle = linear(ctx, 0, yf - 4, 0, yf + 12, [[0, tone(P.foreground, N ? .75 : .97, .1)], [1, tone(P.foreground, N ? .35 : .7, .15)]]);
      ctx.fillRect(x0 - 3, yf - 4, x1 - x0 + 6, 14);
      // A garnish on the crest.
      const gx = lerp(x0, x1, .35 + r() * .3), gy = lerp(yb, yf, .4) - hgt * .95;
      const g = hgt / 100;
      ctx.save(); ctx.translate(gx, gy); ctx.scale(g, g);
      if (garnish === 'nuts') for (let i = 0; i < 14; i++) { const c = vivid(P.green, .55 + r() * .25, .1); ctx.fillStyle = c; ctx.beginPath(); ellipse(ctx, (r() - .5) * 150, r() * 40, 8, 5.5, r() * 3); ctx.fill(); ctx.fillStyle = rgba(WHITE, .35); ctx.beginPath(); ellipse(ctx, (r() - .5) * 150, r() * 40, 3, 2, 0); ctx.fill(); }
      if (garnish === 'berry') [[-26, 4, -.3], [24, 8, .35]].forEach(([bx2, by2, a2]) => {
        ctx.save(); ctx.translate(bx2, by2); ctx.rotate(a2);
        ctx.fillStyle = radial(ctx, -8, -6, 2, 40, [[0, vivid(P.red, .66, .14)], [.6, vivid(P.red, .52, .16)], [1, vivid(P.red, .38, .14)]]);
        ctx.beginPath(); ctx.moveTo(-28, -12); ctx.quadraticCurveTo(0, -30, 28, -12); ctx.quadraticCurveTo(18, 32, 0, 38); ctx.quadraticCurveTo(-18, 32, -28, -12); ctx.fill();
        ctx.fillStyle = tone(P.yellow, .82, .8); for (let k = 0; k < 9; k++) { ctx.beginPath(); circle(ctx, (r() - .5) * 34, -6 + r() * 34, 1.6); ctx.fill(); }
        ctx.fillStyle = tone(P.green, .55, .8); ctx.beginPath(); ellipse(ctx, 0, -18, 22, 7); ctx.fill();
        ctx.restore();
      });
      if (garnish === 'pod') { ctx.strokeStyle = tone(P.brown, .28, .7); ctx.lineWidth = 9; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(-80, 14); ctx.quadraticCurveTo(0, -14, 80, 8); ctx.stroke(); ctx.strokeStyle = rgba(WHITE, .3); ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-70, 9); ctx.quadraticCurveTo(0, -18, 70, 3); ctx.stroke(); }
      if (garnish === 'shard') for (let i = 0; i < 4; i++) { const sx2 = (i - 1.5) * 36; ctx.fillStyle = tone(P.brown, .2 + r() * .1, .8); ctx.beginPath(); poly(ctx, [[sx2 - 6, -30], [sx2 + 22, -8], [sx2 + 6, 22], [sx2 - 14, 4]]); ctx.fill(); ctx.fillStyle = rgba(WHITE, .25); ctx.beginPath(); poly(ctx, [[sx2 - 6, -30], [sx2 + 22, -8], [sx2 + 4, -6]]); ctx.fill(); }
      if (garnish === 'leaf') { [[-.4, 74], [-2.6, 64], [-1.5, 58]].forEach(([a2, l]) => { ctx.fillStyle = linear(ctx, 0, 0, Math.cos(a2) * l, Math.sin(a2) * l, [[0, tone(P.green, .4, 1)], [1, tone(P.green, .62, .9)]]); ctx.beginPath(); leaf(ctx, 0, 8, l, l * .34, a2); ctx.fill(); }); }
      if (garnish === 'slice') { ctx.fillStyle = vivid(P.yellow, .8, .15); ctx.beginPath(); ellipse(ctx, 0, 0, 48, 20); ctx.fill(); ctx.fillStyle = tone(P.yellow, .95, .4); ctx.beginPath(); ellipse(ctx, 0, 0, 41, 17); ctx.fill(); ctx.strokeStyle = vivid(P.yellow, .82, .12); ctx.lineWidth = 2; for (let k = 0; k < 8; k++) { const a2 = k / 8 * TAU; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a2) * 38, Math.sin(a2) * 15); ctx.stroke(); } }
      ctx.restore();
    }
    // Back row, smaller and higher. Front row, larger.
    const back = ['lemon', 'mint', 'hazelnut', 'berry', 'vanilla'], front = ['pistachio', 'strawberry', 'stracciatella', 'chocolate'];
    const bw = W / back.length, fw = W / front.length;
    back.forEach((f, i) => pan(i * bw + 10, (i + 1) * bw - 10, 400, 540, 78, f));
    ctx.fillStyle = rgba(BLACK, N ? .3 : .1); ctx.fillRect(0, 548, W, 10);
    front.forEach((f, i) => pan(i * fw + 12, (i + 1) * fw - 12, 590, 800, 118, f));
    // The front of the counter.
    steel(808, 846, N);
    ctx.fillStyle = linear(ctx, 0, 846, 0, H, N ? [[0, tone(P.brown, .26, .7)], [1, tone(P.brown, .14, .7)]] : [[0, tone(P.yellow, .86, .35)], [1, tone(P.yellow, .8, .4)]]);
    ctx.fillRect(0, 846, W, H - 846);
    ctx.strokeStyle = rgba(N ? BLACK : tone(P.brown, .5, .5), N ? .3 : .12); ctx.lineWidth = 2;
    for (let x = 0; x < W; x += 96) { ctx.beginPath(); ctx.moveTo(x, 846); ctx.lineTo(x, H); ctx.stroke(); }
    // The curved front glass: soft reflections across the case.
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    [[160, .1], [720, .07], [1260, .09], [1700, .06]].forEach(([x, a]) => {
      ctx.fillStyle = linear(ctx, x, 0, x + 300, 0, [[0, rgba(WHITE, 0)], [.5, rgba(WHITE, a * (N ? 1.3 : 2))], [1, rgba(WHITE, 0)]]);
      ctx.beginPath(); poly(ctx, [[x, 372], [x + 170, 372], [x + 360, 808], [x + 190, 808]]); ctx.fill();
    });
    ctx.restore();
    ctx.fillStyle = rgba(WHITE, N ? .4 : .75); ctx.fillRect(0, 374, W, 2);
    if (N) spot(ctx, W / 2, 380, 1100, 40, tone(P.yellow, .9, .5), .3);

    vignette(ctx, P, N ? .45 : .1);
    grain(ctx, r() * 1e9 | 0, .045);
  });
})();
