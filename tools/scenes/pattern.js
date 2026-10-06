// Scenes for tools/render.html. See tools/lib.js for the helpers and the scene() registry.
// Pattern scenes: tiles, textiles and ceramics.

(() => {
  const TAU = Math.PI * 2;
  const BLACK = '#000000', WHITE = '#ffffff';
  const lum = hex => toOklch(hex).L;
  const shade = (hex, k) => mixHex(hex, BLACK, k);
  const tint = (hex, k) => mixHex(hex, WHITE, k);
  const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];
  const jit = (r, a) => (r() - .5) * 2 * a;

  // A small canvas filled pixel by pixel. fn gets the column, the row and an out array, and writes r, g, b and a into out.
  function pixels(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d'), img = x.createImageData(w, h), d = img.data, o = [0, 0, 0, 0];
    for (let j = 0, k = 0; j < h; j++) {
      for (let i = 0; i < w; i++, k += 4) {
        fn(i, j, o);
        d[k] = o[0]; d[k + 1] = o[1]; d[k + 2] = o[2]; d[k + 3] = o[3];
      }
    }
    x.putImageData(img, 0, 0);
    return c;
  }

  // A canvas that covers the frame at k output pixels per logical unit.
  function lowLayer(k) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(W * k)); c.height = Math.max(1, Math.round(H * k));
    const x = c.getContext('2d');
    x.scale(c.width / W, c.height / H);
    return [c, x];
  }

  // Draws the shapes of draw onto ctx, blurred. The blur runs on a small
  // canvas, so a wide blur stays cheap at 6K.
  function soft(ctx, draw, blur, alpha = 1, op = 'source-over', dx = 0, dy = 0) {
    const k = Math.min(S, Math.max(2.5 / Math.max(blur, .1), .08));
    const [a, ax] = lowLayer(k);
    draw(ax);
    const [b, bx] = lowLayer(k);
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.filter = `blur(${(blur * k).toFixed(2)}px)`;
    bx.drawImage(a, 0, 0);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(b, dx, dy, W, H);
    ctx.restore();
  }

  // A repeating tile, size logical units wide, drawn crisp at output resolution.
  function tilePattern(ctx, w, h, draw) {
    const pw = Math.max(4, Math.round(w * S)), ph = Math.max(4, Math.round(h * S));
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const x = c.getContext('2d');
    x.scale(pw / w, ph / h);
    draw(x, w, h);
    const p = ctx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scale(w / pw, h / ph));
    return p;
  }

  // A tile of per-pixel noise at output resolution. fn gets a random function and returns a value and an alpha, both 0 to 255.
  function speckle(ctx, seed, fn, size = 256) {
    const rr = rng(seed);
    const c = pixels(size, size, (i, j, o) => { const [v, a] = fn(rr); o[0] = o[1] = o[2] = v; o[3] = a; });
    const p = ctx.createPattern(c, 'repeat');
    p.setTransform(new DOMMatrix().scale(1 / S));
    return p;
  }

  // Fills the frame with a pattern under a blend mode.
  function overlay(ctx, fill, alpha, op) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.globalCompositeOperation = op;
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // A low resolution map of fractal noise, as a grey canvas with alpha.
  function noiseMap(seed, cols, rows, sx, sy, oct, fn) {
    const n = makeNoise(seed);
    return pixels(cols, rows, (i, j, o) => {
      const v = fbm(n, i * sx, j * sy, oct);
      fn(v, o, i, j);
    });
  }

  // ---------- tiles/brick-wall ----------

  // An ivy leaf with 5 lobes. lobe 0 gives a heart shape, 1 deep lobes.
  function ivyLeaf(x, cx, cy, size, ang, lobe) {
    const keys = [[0, 1], [.45, .6], [.95, .84], [1.5, .57], [2.05, .64], [2.7, .42], [Math.PI, .12]];
    const pts = [];
    for (let i = 0; i < 44; i++) {
      const phi = -Math.PI + i / 44 * TAU, a = Math.abs(phi);
      let k = 0;
      while (k < keys.length - 2 && keys[k + 1][0] < a) k++;
      const [a0, r0] = keys[k], [a1, r1] = keys[k + 1];
      const t = smooth(clamp((a - a0) / (a1 - a0), 0, 1));
      const keyed = lerp(r0, r1, t), round = a < 2.9 ? .72 + .28 * Math.cos(a * .9) : lerp(.5, .12, (a - 2.9) / .24);
      const rad = size * lerp(round, keyed, lobe);
      const th = ang + phi;
      pts.push([cx + Math.cos(th) * rad, cy + Math.sin(th) * rad]);
    }
    x.beginPath();
    smoothPath(x, pts, true);
  }

  scene('tiles', 'brick-wall', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9));
    // A lamp above the frame at night. Low sun from the upper left in the day.
    const lx = night ? 1250 : -200, ly = night ? 150 : -300;

    const mortar = night ? mixHex(P.dark_foreground, P.background, .5) : mixHex(P.light_foreground, P.background, .7);
    const tone = c => (night ? withL(adjust(c, { Cx: .8 }), .43) : withL(adjust(c, { Cx: .62 }), .66));
    const bricks = [P.red, P.blue, P.orange, mixHex(P.red, P.brown, .45), mixHex(P.blue, P.yellow, .3), P.magenta].map(tone);
    const weights = [3, 3, 2, 2.2, 1.6, .6];
    const total = weights.reduce((a, b) => a + b, 0);
    const clinker = night ? withL(mixHex(P.magenta, P.brown, .5), .27) : withL(mixHex(P.magenta, P.brown, .5), .44);
    const pale = tone(mixHex(P.yellow, P.blue, .45));

    ctx.fillStyle = mortar; ctx.fillRect(0, 0, W, H);
    overlay(ctx, speckle(ctx, r() * 1e9, rr => [rr() < .5 ? 0 : 255, rr() * 140]), night ? .25 : .35, 'overlay');

    const ch = 52, mort = 9, bl = 160;
    const y0 = -r() * ch;
    const list = [];
    for (let j = 0; y0 + j * ch < H + ch; j++) {
      const y = y0 + j * ch + jit(r, 1.2);
      let x = -bl * (.5 + r() * .5) + (j % 2) * bl / 2;
      while (x < W + bl) {
        const w = bl - mort + jit(r, 5), h = ch - mort + jit(r, 2);
        list.push({ x: x + mort / 2 + jit(r, 1.5), y: y + mort / 2, w, h });
        x += w + mort + jit(r, 2);
      }
    }

    // The joints sit deeper than the bricks, so each brick shades the joint below it.
    soft(ctx, x => {
      x.fillStyle = BLACK;
      list.forEach(b => { x.fillRect(b.x + 1, b.y + 2, b.w + 1, b.h + 2); });
    }, 3.5, night ? .6 : .4, 'multiply', 1, 2.5);

    for (const b of list) {
      const { x: bx, y: by, w, h } = b;
      const roll = r(), field = fbm(n2, bx * .0016, by * .004, 3);
      let base;
      if (roll < .06) base = clinker;
      else if (roll < .1) base = pale;
      else {
        let t = (r() * .7 + (field * .5 + .5) * .3) * total, i = 0;
        while (i < weights.length - 1 && t > weights[i]) { t -= weights[i]; i++; }
        base = bricks[i];
      }
      base = adjust(base, { L: jit(r, .04) + field * .05, C: jit(r, .01) });
      // An outline with soft corners and small chips.
      const pts = [], c = 3 + r() * 3;
      const edge = (x0, y0, x1, y1, steps) => {
        for (let i = 0; i < steps; i++) {
          const t = i / steps;
          pts.push([lerp(x0, x1, t) + jit(r, .8), lerp(y0, y1, t) + jit(r, .8)]);
        }
      };
      edge(bx + c, by, bx + w - c, by, 6); edge(bx + w, by + c, bx + w, by + h - c, 2);
      edge(bx + w - c, by + h, bx + c, by + h, 6); edge(bx, by + h - c, bx, by + c, 2);
      if (r() < .3) { const k = Math.floor(r() * pts.length); pts[k] = [lerp(pts[k][0], bx + w / 2, .05), lerp(pts[k][1], by + h / 2, .3)]; }
      ctx.save();
      ctx.beginPath(); poly(ctx, pts);
      const fx = clamp(r(), .2, .8);
      ctx.fillStyle = linear(ctx, bx, by, bx + w, by + h, [[0, adjust(base, { L: jit(r, .03) })], [fx, base], [1, adjust(base, { L: -.03 - r() * .05 })]]);
      ctx.fill();
      ctx.clip();
      // Kiln flashing: a darker end on some bricks.
      if (r() < .3) {
        const ex = r() < .5 ? bx : bx + w;
        ctx.fillStyle = radial(ctx, ex, by + h / 2, 0, w * (.3 + r() * .4), [[0, rgba(shade(base, .4), .5)], [1, rgba(shade(base, .4), 0)]]);
        ctx.fillRect(bx, by, w, h);
      }
      // Pits and grains of sand.
      const dots = 12 + Math.floor(r() * 20);
      for (let i = 0; i < dots; i++) {
        const dark = r() < .65;
        ctx.fillStyle = dark ? rgba(BLACK, .15 + r() * .25) : rgba(tint(base, .5), .2 + r() * .3);
        ctx.beginPath(); circle(ctx, bx + r() * w, by + r() * h, .4 + r() ** 2 * 2); ctx.fill();
      }
      // A spalled face: the front broke off and shows the rough core.
      if (r() < .04) {
        const sx = bx + r() * w * .55, sw = w * (.25 + r() * .3), q = [];
        for (let i = 0; i < 11; i++) {
          const a = i / 11 * TAU;
          q.push([sx + sw / 2 + Math.cos(a) * sw * (.35 + r() * .2), by + h * .55 + Math.sin(a) * h * (.4 + r() * .35)]);
        }
        ctx.beginPath(); poly(ctx, q);
        const core = adjust(base, { L: -.07, C: .008 });
        ctx.fillStyle = core; ctx.fill();
        ctx.save(); ctx.clip();
        for (let i = 0; i < 26; i++) {
          ctx.fillStyle = rgba(r() < .5 ? BLACK : WHITE, .08 + r() * .12);
          ctx.beginPath(); circle(ctx, sx + r() * sw, by + r() * h, .5 + r() * 1.6); ctx.fill();
        }
        ctx.strokeStyle = rgba(BLACK, .35); ctx.lineWidth = 3;
        ctx.beginPath(); poly(ctx, q.map(p => [p[0], p[1] - 1.5])); ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
      // A lit top edge and a dark lower edge.
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = rgba(tint(base, .5), night ? .3 : .45);
      ctx.beginPath(); ctx.moveTo(pts[1][0], pts[1][1] + .8); for (let i = 2; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1] + .8); ctx.stroke();
      ctx.strokeStyle = rgba(shade(base, .6), .4);
      ctx.beginPath(); ctx.moveTo(pts[9][0], pts[9][1] - .8); for (let i = 10; i < 14; i++) ctx.lineTo(pts[i][0], pts[i][1] - .8); ctx.stroke();
    }

    // Grime that runs down the wall, and lime bloom.
    const grime = noiseMap(r() * 1e9, 240, 135, .09, .012, 4, (v, o, i, j) => {
      o[0] = o[1] = o[2] = 0; o[3] = clamp((v + .1) * 200, 0, 255) * (.45 + .55 * j / 135);
    });
    ctx.save(); ctx.globalAlpha = night ? .32 : .22; ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(grime, 0, 0, W, H); ctx.restore();
    const salt = noiseMap(r() * 1e9, 240, 135, .05, .05, 4, (v, o) => { o[0] = o[1] = o[2] = 255; o[3] = clamp((v - .18) * 600, 0, 140); });
    ctx.save(); ctx.globalAlpha = night ? .1 : .3; ctx.drawImage(salt, 0, 0, W, H); ctx.restore();

    // Ivy: vines climb from the lower left and hang from the top right.
    const leaves = [], stems = [];
    const grow = (x, y, heading, len, bias, depth) => {
      const pts = [[x, y]];
      let h = heading;
      for (let s = 0; s < len; s += 13) {
        h += fbm(n1, x * .004 + depth * 3.1, y * .004, 2) * .45 + (bias - h) * .07;
        x += Math.cos(h) * 13; y += Math.sin(h) * 13;
        pts.push([x, y]);
        if (Math.round(s / 13) % 2 === 0 && r() < .95) {
          const side = Math.round(s / 26) % 2 ? 1 : -1;
          const size = (16 + 30 * (1 - s / len) ** .7) * (1 - depth * .1) * (.8 + r() * .4);
          let la = h + side * (1.2 + r() * .5);
          const px = x + Math.cos(la) * size * .95, py = y + Math.sin(la) * size * .95;
          la = la + (Math.atan2(Math.sin(Math.PI / 2 - la), Math.cos(Math.PI / 2 - la))) * .3 + jit(r, .35);
          leaves.push({ x: px, y: py, sx: x, sy: y, size, ang: la, lobe: .25 + r() * .6, t: r() + (1 - s / len) * .3 - depth * .1, age: r() });
        }
        if (depth < 3 && r() < .04) grow(x, y, h + (r() < .5 ? -1 : 1) * (.5 + r() * .6), len * (.3 + r() * .35), bias + jit(r, .6), depth + 1);
      }
      stems.push({ pts, w: Math.max(1.2, 4.8 - depth * 1.2) });
    };
    for (let i = 0; i < 7; i++) grow(-30 + r() * 300, H + 30, -Math.PI / 2 + jit(r, .35), 600 + r() * 650, -Math.PI / 2 + .3 * (r() - .35), 0);
    for (let i = 0; i < 2; i++) grow(-30, 350 + r() * 450, -.25 + jit(r, .3), 300 + r() * 250, -1.0, 1);
    for (let i = 0; i < 5; i++) grow(1450 + r() * 500, -30, Math.PI / 2 + jit(r, .5), 300 + r() * 380, Math.PI / 2 + jit(r, .6), 0);

    const leafDark = night ? withL(P.green, .3) : withL(P.green, .4);
    const leafMid = night ? withL(P.green, .45) : withL(P.green, .56);
    const leafLight = night ? P.bright_green : withL(P.bright_green, .78);

    // Leaf and stem shadows on the wall.
    soft(ctx, x => {
      x.fillStyle = BLACK; x.strokeStyle = BLACK;
      stems.forEach(s => { x.lineWidth = s.w; x.beginPath(); smoothPath(x, s.pts); x.stroke(); });
      leaves.forEach(l => { ivyLeaf(x, l.x, l.y, l.size, l.ang, l.lobe); x.fill(); });
    }, 8, night ? .6 : .4, 'multiply', 9, 13);

    ctx.lineCap = 'round';
    stems.forEach(s => {
      ctx.strokeStyle = mixHex(P.brown, P.green, .3);
      ctx.lineWidth = s.w; ctx.beginPath(); smoothPath(ctx, s.pts); ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, .14); ctx.lineWidth = s.w * .35; ctx.beginPath(); smoothPath(ctx, s.pts.map(p => [p[0] - s.w * .2, p[1] - s.w * .2])); ctx.stroke();
    });
    leaves.sort((a, b) => a.t - b.t);
    const sun = night ? [lx, ly] : [-400, -400];
    for (const l of leaves) {
      ctx.strokeStyle = mixHex(leafDark, P.brown, .3); ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.moveTo(l.sx, l.sy); ctx.quadraticCurveTo((l.sx + l.x) / 2 + 4, (l.sy + l.y) / 2 - 4, l.x, l.y); ctx.stroke();
      const deep = clamp(.25 - l.t * .25, 0, .25);
      const c0 = shade(mixHex(leafDark, P.yellow, l.age * .1), deep);
      const c1 = shade(mixHex(leafMid, P.yellow, l.age * .22), deep);
      const ca = Math.cos(l.ang), sa = Math.sin(l.ang);
      ivyLeaf(ctx, l.x, l.y, l.size, l.ang, l.lobe);
      ctx.fillStyle = linear(ctx, l.x - ca * l.size * .3, l.y - sa * l.size * .3, l.x + ca * l.size, l.y + sa * l.size, [[0, c0], [.55, c1], [1, c0]]);
      ctx.fill();
      ctx.strokeStyle = rgba(leafLight, .22); ctx.lineWidth = 1; ctx.stroke();
      ctx.save(); ctx.clip();
      // The leaf folds along its midrib, so one half catches more light.
      const toSun = Math.atan2(sun[1] - l.y, sun[0] - l.x), side = Math.sin(toSun - l.ang) > 0 ? 1 : -1;
      ctx.translate(l.x, l.y); ctx.rotate(l.ang);
      ctx.fillStyle = rgba(BLACK, .22);
      ctx.fillRect(-l.size * 1.5, side > 0 ? -l.size * 1.5 : 0, l.size * 3, l.size * 1.5);
      ctx.fillStyle = radial(ctx, l.size * .3, side * l.size * .35, 0, l.size * .75, [[0, rgba(leafLight, night ? .35 : .45)], [1, rgba(leafLight, 0)]]);
      ctx.fillRect(-l.size * 1.5, -l.size * 1.5, l.size * 3, l.size * 3);
      ctx.restore();
      // Pale veins.
      ctx.strokeStyle = rgba(tint(leafMid, .5), night ? .32 : .5); ctx.lineWidth = .9;
      ctx.beginPath();
      [0, .95, -.95, 2.0, -2.0].forEach(a => {
        const len = l.size * (a === 0 ? .85 : Math.abs(a) < 1 ? .65 : .45) * (l.lobe * .3 + .7);
        ctx.moveTo(l.x, l.y);
        ctx.quadraticCurveTo(l.x + Math.cos(l.ang + a * .9) * len * .5, l.y + Math.sin(l.ang + a * .9) * len * .5, l.x + Math.cos(l.ang + a) * len, l.y + Math.sin(l.ang + a) * len);
      });
      ctx.stroke();
    }

    // Light and shade over the whole wall.
    if (night) {
      // An iron lantern on the wall gives the light.
      const ax = 1250, ay = 150;
      soft(ctx, x => { x.fillStyle = BLACK; x.fillRect(ax - 38, ay - 44, 76, 140); x.fillRect(ax - 6, ay - 96, 12, 60); }, 8, .45, 'multiply', 14, 30);
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, ax, ay, 80, 1600, [[0, WHITE], [.28, tint(P.yellow, .5)], [.6, mixHex(shade(P.cyan, .45), tint(P.yellow, .5), .3)], [1, shade(P.cyan, .72)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, ax, ay + 40, 0, 900, [[0, rgba(P.yellow, .5)], [.35, rgba(P.orange, .16)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      const iron = mixHex(P.darker_background, P.brown, .25);
      ctx.save(); ctx.translate(ax, ay); ctx.scale(1.45, 1.45);
      // The bracket: a scroll of iron from the wall.
      ctx.strokeStyle = iron; ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(0, -46); ctx.lineTo(0, -64); ctx.moveTo(-34, -64); ctx.lineTo(34, -64); ctx.stroke();
      ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(34, -64); ctx.quadraticCurveTo(44, -40, 30, -30); ctx.stroke();
      ctx.beginPath(); ctx.arc(-38, -58, 6, -Math.PI / 2, Math.PI); ctx.stroke();
      ctx.fillStyle = radial(ctx, 0, 18, 2, 44, [[0, P.bright_yellow], [.45, P.yellow], [1, P.orange]]);
      ctx.fillRect(-20, -22, 40, 78);
      ctx.fillStyle = iron;
      ctx.beginPath(); poly(ctx, [[-30, -22], [30, -22], [14, -46], [-14, -46]]); ctx.fill();
      ctx.beginPath(); circle(ctx, 0, -50, 5); ctx.fill();
      ctx.fillRect(-26, 54, 52, 9); ctx.fillRect(-12, 63, 24, 7);
      ctx.fillRect(-25, -24, 5, 80); ctx.fillRect(20, -24, 5, 80); ctx.fillRect(-2, -24, 4, 80);
      ctx.fillStyle = rgba(WHITE, .25); ctx.fillRect(-18, -20, 3, 72);
      ctx.restore();
      soft(ctx, x => { x.fillStyle = P.yellow; x.fillRect(ax - 30, ay - 32, 60, 113); }, 70, .5, 'lighter');
      soft(ctx, x => { x.fillStyle = P.yellow; x.fillRect(ax - 29, ay - 32, 58, 113); }, 18, .45, 'lighter');
      soft(ctx, x => { x.fillStyle = P.bright_yellow; x.beginPath(); ellipse(x, ax, ay + 26, 10, 20, 0); x.fill(); }, 9, .85, 'lighter');
    } else {
      // Dappled shade from a tree out of the frame.
      const dap = noiseMap(r() * 1e9, 192, 108, .06, .06, 4, (v, o) => { o[0] = o[1] = o[2] = 0; o[3] = clamp((v - .08) * 900, 0, 255); });
      ctx.save(); ctx.globalAlpha = .13; ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(dap, 0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 150, -150, 0, 1700, [[0, rgba(tint(P.yellow, .75), .42)], [.55, rgba(tint(P.yellow, .75), .12)], [1, rgba(P.background, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .16);
    grain(ctx, Math.floor(r() * 1e9), night ? .05 : .04);
  });

  // ---------- tiles/delft-tiles ----------

  // Brush work for a painted tile. Each call draws in tile units, where the tile spans -100 to 100.
  function brush(x, r, ink, washC) {
    const wob = pts => pts.map(p => [p[0] + jit(r, .7), p[1] + jit(r, .7)]);
    return {
      line(pts, w, a = .9) {
        x.strokeStyle = rgba(ink, a); x.lineWidth = w; x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath(); smoothPath(x, wob(pts)); x.stroke();
      },
      wash(path, a = .4) { x.fillStyle = rgba(washC, a); x.beginPath(); path(); x.fill(); },
      shape(pts, a = .4, w = 1.4) {
        const q = wob(pts);
        x.fillStyle = rgba(washC, a); x.beginPath(); smoothPath(x, q, true); x.fill();
        x.strokeStyle = rgba(ink, .85); x.lineWidth = w; x.stroke();
      },
      poly(pts, a = .4, w = 1.4) {
        const q = wob(pts);
        x.fillStyle = rgba(washC, a); x.beginPath(); poly(x, q); x.fill();
        x.strokeStyle = rgba(ink, .85); x.lineWidth = w; x.lineJoin = 'round'; x.stroke();
      },
      dot(px, py, rad, a = .9) { x.fillStyle = rgba(ink, a); x.beginPath(); circle(x, px, py, rad); x.fill(); },
    };
  }

  const delftMotifs = {
    windmill(x, r, b) {
      b.wash(() => { x.moveTo(-62, 40); x.bezierCurveTo(-30, 31, 22, 35, 64, 37); x.lineTo(62, 50); x.bezierCurveTo(20, 54, -30, 52, -60, 50); x.closePath(); }, .3);
      b.line([[-64, 40], [-30, 34], [12, 36], [64, 37]], 1.6);
      for (let i = 0; i < 9; i++) { const gx = -54 + i * 13 + jit(r, 3); b.line([[gx, 44], [gx + 2, 38 - r() * 6]], .9, .7); }
      b.poly([[-15, 37], [15, 37], [9, -9], [-9, -9]], .45);
      b.shape([[-12, -9], [-7, -19], [0, -23], [7, -19], [12, -9]], .6);
      b.wash(() => { x.moveTo(-3, 37); x.lineTo(-3, 27); x.arc(0, 27, 3, Math.PI, 0); x.lineTo(3, 37); }, .9);
      b.dot(-4, 10, 1.6); b.dot(4, 2, 1.6);
      const a0 = r() * TAU, hx = 0, hy = -15;
      for (let k = 0; k < 4; k++) {
        const a = a0 + k * TAU / 4, c = Math.cos(a), s = Math.sin(a), nx = -s, ny = c;
        b.line([[hx, hy], [hx + c * 46, hy + s * 46]], 1.8);
        const p0 = [hx + c * 11, hy + s * 11], p1 = [hx + c * 44, hy + s * 44];
        const q = [p0, p1, [p1[0] + nx * 8, p1[1] + ny * 8], [p0[0] + nx * 8, p0[1] + ny * 8]];
        b.poly(q, .18, .9);
        for (let t = .25; t < 1; t += .25) b.line([[lerp(p0[0], p1[0], t), lerp(p0[1], p1[1], t)], [lerp(p0[0], p1[0], t) + nx * 8, lerp(p0[1], p1[1], t) + ny * 8]], .7, .7);
      }
      b.dot(hx, hy, 2.4);
      b.line([[34, -52], [38, -55], [42, -52]], 1, .8); b.line([[46, -44], [49, -46], [52, -44]], .9, .7);
    },
    tulip(x, r, b) {
      b.wash(() => { x.ellipse(0, 46, 40, 7, 0, 0, TAU); }, .3);
      b.line([[-36, 46], [-12, 43], [14, 44], [38, 46]], 1.3);
      b.line([[0, 44], [-2, 18], [1, -6], [0, -16]], 2);
      b.shape([[-2, 40], [-20, 22], [-34, -2], [-24, 8], [-8, 26]], .5, 1.2);
      b.shape([[2, 38], [18, 16], [30, 0], [26, 14], [10, 30]], .5, 1.2);
      b.shape([[-16, -22], [-18, -40], [-10, -54], [-4, -40], [0, -48], [4, -40], [10, -54], [18, -40], [16, -22], [0, -14]], .55, 1.5);
      b.line([[-6, -36], [-4, -24]], 1, .7); b.line([[6, -36], [4, -24]], 1, .7);
      b.line([[-30, -40], [-26, -50]], .9, .6); b.line([[30, -34], [33, -44]], .9, .6);
    },
    ship(x, r, b) {
      for (let i = 0; i < 3; i++) {
        const y = 34 + i * 7, w = 62 - i * 8;
        b.line([[-w, y], [-w / 2, y - 3], [0, y + 1], [w / 2, y - 3], [w, y]], 1.1, .8 - i * .15);
      }
      b.shape([[-42, 12], [42, 12], [32, 28], [-34, 28]], .55, 1.6);
      b.line([[-6, 12], [-6, -56]], 1.6); b.line([[20, 12], [20, -36]], 1.4);
      b.poly([[-26, -46], [14, -46], [11, -32], [12, -18], [-24, -18], [-23, -32]], .2, 1.1);
      b.poly([[-24, -14], [12, -14], [9, -4], [10, 6], [-22, 6], [-21, -4]], .25, 1.1);
      b.poly([[8, -30], [32, -30], [30, -20], [31, -10], [9, -10], [10, -20]], .2, 1);
      b.poly([[-6, -56], [8, -53], [-6, -50]], .8, 1);
      b.line([[-42, 12], [-56, -2]], 1.2);
      b.line([[-50, -52], [-46, -55], [-42, -52]], 1, .8);
    },
    vase(x, r, b) {
      b.shape([[-14, 46], [-24, 30], [-22, 14], [-10, 6], [-12, 0], [12, 0], [10, 6], [22, 14], [24, 30], [14, 46]], .5, 1.5);
      b.line([[-21, 24], [21, 24]], 1, .7);
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i - 2) * .42 + jit(r, .1), len = 46 + r() * 16;
        const ex = Math.cos(a) * len, ey = Math.sin(a) * len;
        b.line([[0, 2], [ex * .5 + jit(r, 4), ey * .5], [ex, ey]], 1.1);
        const pr = 7 + r() * 4;
        for (let p = 0; p < 6; p++) {
          const pa = p / 6 * TAU;
          b.shape([[ex, ey], [ex + Math.cos(pa - .35) * pr, ey + Math.sin(pa - .35) * pr], [ex + Math.cos(pa) * pr * 1.25, ey + Math.sin(pa) * pr * 1.25], [ex + Math.cos(pa + .35) * pr, ey + Math.sin(pa + .35) * pr]], .35, .8);
        }
        b.dot(ex, ey, 2.4);
        if (i % 2) b.shape([[ex * .5, ey * .5], [ex * .5 + 14, ey * .5 - 4], [ex * .5 + 20, ey * .5 + 2], [ex * .5 + 8, ey * .5 + 4]], .45, .9);
      }
    },
    bird(x, r, b) {
      b.line([[-58, 34], [-20, 22], [20, 18], [56, 4]], 2.2);
      for (let i = 0; i < 4; i++) { const bx = -40 + i * 26, by = 28 - i * 6; b.shape([[bx, by], [bx + 6, by + 8], [bx + 14, by + 10], [bx + 8, by + 2]], .45, .9); }
      b.shape([[-20, 16], [-30, 2], [-22, -14], [-6, -22], [8, -22], [16, -12], [12, 2], [0, 12]], .4, 1.5);
      b.shape([[-24, 6], [-46, 22], [-40, 10], [-30, 2]], .55, 1.2);
      b.shape([[-14, -4], [4, -12], [10, -2], [-6, 6]], .5, 1);
      b.poly([[14, -18], [24, -16], [15, -12]], .9, 1);
      b.dot(6, -16, 1.6);
      b.line([[-2, 14], [-4, 22]], 1); b.line([[4, 12], [4, 20]], 1);
    },
  };

  // A quarter ornament at a corner. It points to the center of its tile.
  function delftCorner(x, b, cx, cy) {
    x.save(); x.translate(cx, cy); x.rotate(Math.atan2(-cy, -cx));
    b.shape([[2, 0], [10, -5], [22, 0], [10, 5]], .55, 1.1);
    b.line([[4, -3], [8, -12], [16, -16], [19, -11]], 1.1);
    b.line([[4, 3], [8, 12], [16, 16], [19, 11]], 1.1);
    b.dot(26, 0, 1.8);
    x.restore();
  }

  scene('tiles', 'delft-tiles', (ctx, P, r) => {
    const night = P.night;
    const pitch = 214, grout = 7, ts = pitch - grout;
    const ox = -r() * pitch * .6, oy = -r() * pitch * .5;
    const glaze = night ? withL(mixHex(P.foreground, P.bright_yellow, .6), .56) : mixHex(mixHex(P.background, P.light_foreground, .08), WHITE, .2);
    const ink = night ? withL(P.blue, .27) : mixHex(P.blue, P.bright_foreground, .25);
    const washC = night ? withL(P.blue, .38) : P.blue;
    const groutC = night ? withL(P.muted, .25) : mixHex(P.muted, P.background, .45);
    const clay = night ? withL(mixHex(P.red, P.muted, .6), .4) : mixHex(mixHex(P.red, P.muted, .7), P.background, .35);
    // The light: a window at the upper right. Daylight, or moonlight at night.
    const lx = 1650, ly = -60;

    ctx.fillStyle = groutC; ctx.fillRect(0, 0, W, H);
    overlay(ctx, speckle(ctx, r() * 1e9, rr => [rr() < .5 ? 0 : 255, rr() * 160]), .3, 'overlay');

    const tiles = [];
    for (let j = 0; oy + j * pitch < H; j++) {
      for (let i = 0; ox + i * pitch < W; i++) {
        tiles.push({ cx: ox + i * pitch + pitch / 2 + jit(r, 1.4), cy: oy + j * pitch + pitch / 2 + jit(r, 1.4), rot: jit(r, .007), tx: jit(r, 1), ty: jit(r, 1), s: ts + jit(r, 1.5) });
      }
    }
    // Each tile shades the grout below and to the left.
    soft(ctx, x => {
      x.fillStyle = BLACK;
      tiles.forEach(t => { x.save(); x.translate(t.cx + 2, t.cy + 3); x.rotate(t.rot); x.fillRect(-t.s / 2, -t.s / 2, t.s, t.s); x.restore(); });
    }, 4, night ? .7 : .45, 'multiply');

    const names = Object.keys(delftMotifs);
    let last = -1;
    tiles.forEach(t => {
      ctx.save();
      ctx.translate(t.cx, t.cy); ctx.rotate(t.rot);
      const hs = t.s / 2, base = adjust(glaze, { L: jit(r, .015), h: jit(r, 8), C: jit(r, .004) });
      ctx.beginPath(); ctx.roundRect(-hs, -hs, t.s, t.s, 5);
      ctx.fillStyle = base; ctx.fill();
      ctx.save(); ctx.clip();
      // Thin glaze at the edges shows the clay.
      ctx.fillStyle = radial(ctx, t.tx * 30, t.ty * 30, hs * .5, hs * 1.5, [[0, rgba(clay, 0)], [.75, rgba(clay, .06)], [1, rgba(clay, .28)]]);
      ctx.fillRect(-hs, -hs, t.s, t.s);
      ctx.scale(t.s / 200, t.s / 200);
      const b = brush(ctx, r, ink, washC);
      let k;
      do k = Math.floor(r() * names.length); while (k === last);
      last = k;
      if (r() < .5) {
        ctx.strokeStyle = rgba(ink, .8); ctx.lineWidth = 1.8;
        ctx.beginPath(); circle(ctx, jit(r, 1), jit(r, 1), 80 + jit(r, 1)); ctx.stroke();
        ctx.lineWidth = .9; ctx.beginPath(); circle(ctx, jit(r, 1), jit(r, 1), 75); ctx.stroke();
      }
      ctx.save(); ctx.rotate(jit(r, .05)); delftMotifs[names[k]](ctx, r, b); ctx.restore();
      [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(([sx, sy]) => delftCorner(ctx, b, sx * 100, sy * 100));
      // Crackle in the glaze.
      ctx.strokeStyle = rgba(night ? BLACK : shade(clay, .4), night ? .22 : .16); ctx.lineWidth = .5;
      ctx.beginPath();
      for (let c = 0; c < 14; c++) {
        let px = jit(r, 100), py = jit(r, 100), a = r() * TAU;
        ctx.moveTo(px, py);
        for (let s = 0; s < 6 + r() * 10; s++) { a += jit(r, .7); px += Math.cos(a) * (6 + r() * 9); py += Math.sin(a) * (6 + r() * 9); ctx.lineTo(px, py); }
      }
      ctx.stroke();
      ctx.restore();
      // A chipped corner shows the bare clay.
      if (r() < .12) {
        const sx = r() < .5 ? -1 : 1, sy = r() < .5 ? -1 : 1, q = [[sx * hs, sy * hs]];
        const d1 = 10 + r() * 16, d2 = 10 + r() * 16;
        q.push([sx * (hs - d1), sy * hs], [sx * (hs - d1 * .6), sy * (hs - 5 - r() * 4)], [sx * (hs - 4 - r() * 4), sy * (hs - d2 * .7)], [sx * hs, sy * (hs - d2)]);
        ctx.beginPath(); poly(ctx, q); ctx.fillStyle = clay; ctx.fill();
        ctx.strokeStyle = rgba(BLACK, .25); ctx.lineWidth = 1; ctx.stroke();
      }
      // A bevel: light on the upper edge, shade on the lower edge.
      ctx.beginPath(); ctx.roundRect(-hs + 1, -hs + 1, t.s - 2, t.s - 2, 5);
      ctx.strokeStyle = linear(ctx, 0, -hs, 0, hs, [[0, rgba(WHITE, night ? .2 : .7)], [.5, rgba(WHITE, 0)], [1, rgba(BLACK, .18)]]);
      ctx.lineWidth = 2; ctx.stroke();
      ctx.restore();
    });

    // The glossy glaze reflects the light source. Each tile sits at its own angle, so the reflection breaks up.
    soft(ctx, x => {
      tiles.forEach(t => {
        x.save(); x.translate(t.cx, t.cy); x.rotate(t.rot);
        x.beginPath(); x.rect(-t.s / 2 + 2, -t.s / 2 + 2, t.s - 4, t.s - 4); x.clip();
        x.rotate(-t.rot * 4); x.translate(-t.cx + t.tx * 26, -t.cy + t.ty * 26);
        x.fillStyle = rgba(night ? P.bright_yellow : WHITE, .55 + r() * .45);
        const wx = 1180, wy = 40, pw = 180, ph = 250, gap = 16;
        for (let a = 0; a < 2; a++) {
          for (let c = 0; c < 2; c++) {
            const px = wx + a * (pw + gap), py = wy + c * (ph + gap), q = [];
            for (let e = 0; e < 4; e++) {
              const [x0, y0] = [[px, py], [px + pw, py], [px + pw, py + ph], [px, py + ph]][e], [x1, y1] = [[px + pw, py], [px + pw, py + ph], [px, py + ph], [px, py]][e];
              for (let k = 0; k < 4; k++) q.push([lerp(x0, x1, k / 4) + jit(r, 3), lerp(y0, y1, k / 4) + jit(r, 3)]);
            }
            x.beginPath(); smoothPath(x, q, true); x.fill();
          }
        }
        x.restore();
      });
    }, 6, night ? .38 : .7, 'screen');

    // Light falloff over the wall.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, lx, ly, 100, 2000, [[0, WHITE], [.35, tint(P.blue, .55)], [.75, shade(P.blue, .25)], [1, shade(P.blue, .6)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, lx, ly, 200, 2300, [[0, WHITE], [.55, mixHex(WHITE, P.dark_background, .6)], [1, mixHex(P.darker_background, P.muted, .25)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .45 : .12);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- tiles/mosaic ----------

  scene('tiles', 'mosaic', (ctx, P, r) => {
    const night = P.night;
    const n1 = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9));
    // The rings of tesserae follow the dome around its apex, up and to the right of the frame.
    const cx = 1530, cy = -150, pitch = 12.6, ts = 10.4;
    // The light: candles below at night, a window on the left in the day.
    const hx = night ? 420 : 380, hy = night ? 980 : 420;
    const goldRamp = night
      ? [shade(P.magenta, .72), shade(P.magenta, .4), P.magenta, P.yellow, P.bright_yellow, tint(P.bright_yellow, .65)]
      : [adjust(withL(P.magenta, .46), { C: .03 }), adjust(withL(P.magenta, .6), { C: .05 }), adjust(withL(P.yellow, .7), { C: .07 }), adjust(withL(P.yellow, .79), { C: .07 }), adjust(withL(P.bright_yellow, .88), { C: .05 }), tint(withL(P.bright_yellow, .92), .6)];
    const blues = night
      ? [withL(P.blue, .2), withL(P.blue, .25), withL(P.green, .27), withL(P.blue, .31), withL(P.cyan, .3)]
      : [withL(P.blue, .34), withL(P.blue, .4), withL(P.green, .44), withL(P.blue, .47), withL(P.cyan, .5)];
    const red = night ? withL(P.red, .4) : withL(P.red, .55);
    const white = night ? withL(P.foreground, .7) : mixHex(P.background, WHITE, .6);
    const ramp = (stops, t) => {
      t = clamp(t, 0, .999) * (stops.length - 1);
      const i = Math.floor(t);
      return mixHex(stops[i], stops[i + 1], t - i);
    };

    ctx.fillStyle = night ? mixHex(P.darker_background, P.brown, .15) : mixHex(mixHex(P.muted, P.background, .4), P.magenta, .18);
    ctx.fillRect(0, 0, W, H);

    // Zones by distance from the apex.
    const medal = 120, sky = 640, band1 = sky + pitch * 5, arch0 = band1 + pitch * 6, arch1 = arch0 + 250, band2 = arch1 + pitch * 4;
    const starRows = [205, 335, 465, 590];
    const inStar = (rho, th) => {
      for (const sr of starRows) {
        if (Math.abs(rho - sr) > 34) continue;
        const count = Math.round(TAU * sr / 150), step = TAU / count, off = sr * .37;
        const j = Math.round((th - off) / step), u = (th - off - j * step) * sr, v = rho - sr;
        const d = Math.hypot(u, v), a = Math.atan2(v, u);
        if (d < 40 * (.3 + .7 * Math.abs(Math.cos(4 * a)) ** 5)) return true;
      }
      return false;
    };
    // The kind of tessera at a place: g gold, b blue, w white, r red.
    const kindAt = (rho, th, k, m) => {
      if (rho < medal) {
        const a = Math.atan2(Math.sin(th), Math.cos(th));
        return rho < 60 * (.45 + .55 * Math.abs(Math.cos(4 * a)) ** 3) ? 'g' : rho > medal - pitch * 1.5 ? 'w' : 'b';
      }
      if (rho < medal + pitch * 2) return rho < medal + pitch ? 'r' : 'g';
      if (rho < sky) return inStar(rho, th) ? 's' : 'b';
      if (rho < band1) {
        const i = Math.floor((rho - sky) / pitch), p = ((m % 10) + 10) % 10;
        if (i === 0 || i === 4) return 'g';
        return p === i || p === 10 - i || (i === 2 && p === 5) ? 'w' : 'r';
      }
      if (rho < arch0) return rho < band1 + pitch ? 'w' : 'g';
      if (rho < arch1) {
        const ring = (arch0 + arch1) / 2, count = Math.round(TAU * ring / 230), step = TAU / count;
        const j = Math.round(th / step), u = (th - j * step) * rho, v = rho - arch0 - 18;
        const aw = step * rho / 2 - 22;
        const inside = v >= 0 && v < arch1 - arch0 - 24 && (v > aw ? Math.abs(u) < aw : Math.hypot(u, aw - v) < aw);
        const edge = v >= -pitch && v < arch1 - arch0 - 24 + pitch && (v > aw ? Math.abs(u) < aw + pitch * 1.1 : Math.hypot(u, aw - v) < aw + pitch * 1.1);
        if (inside) return v > arch1 - arch0 - 24 - pitch * 2 ? 'g' : 'b';
        if (edge) return (k + m) % 3 ? 'w' : 'r';
        return 'g';
      }
      if (rho < band2) { const i = Math.floor((rho - arch1) / pitch); return i === 1 ? 'r' : i === 2 ? 'w' : 'g'; }
      return 'g';
    };

    const far = Math.hypot(cx, H - cy) + 40;
    const sparks = [];
    for (let k = 0; ; k++) {
      const rho0 = 6 + k * pitch;
      if (rho0 > far) break;
      const count = Math.max(6, Math.floor(TAU * rho0 / pitch)), step = TAU / count, th0 = r() * step;
      for (let m = 0; m < count; m++) {
        const th = th0 + m * step + jit(r, step * .08), rho = rho0 + jit(r, .9);
        const x = cx + Math.cos(th) * rho, y = cy + Math.sin(th) * rho;
        if (x < -12 || x > W + 12 || y < -12 || y > H + 12) { r(); r(); continue; }
        const kind = kindAt(rho, th, k, m);
        // A few tesserae fell out and show the setting bed.
        if ((kind === 'g' || kind === 'b') && fbm(n2, x * .012, y * .012, 3) > .42 && r() < .55) { r(); r(); continue; }
        // Each tessera sits at its own small tilt, so it catches the light on its own.
        const tx = (r() + r() - 1) * .32, ty = (r() + r() - 1) * .32;
        const ix = (x - hx) / 1700 + fbm(n1, x * .0015 + 9, y * .0015, 3) * .14, iy = (y - hy) / 1700 + fbm(n1, x * .0015, y * .0015 + 9, 3) * .14;
        const spec = Math.exp(-((tx - ix) ** 2 + (ty - iy) ** 2) / .012);
        const dist = Math.hypot(x - hx, y - hy);
        const diff = night ? clamp(1.12 - dist / 1500, .22, 1) : clamp(1.05 - dist / 3200, .72, 1);
        const wob = fbm(n1, x * .01, y * .01, 2) * .08;
        let col, glow = 0;
        if (kind === 'g' || kind === 's') {
          const t = (.3 + wob + (tx - ty) * .25 + r() * .12 + (kind === 's' ? .25 : 0)) * diff + spec * .62 * (night ? diff : 1) + (kind === 's' && night ? .2 : 0);
          col = ramp(goldRamp, t);
          glow = spec * diff;
        } else if (kind === 'b') {
          col = adjust(pick(r, blues), { L: (diff - 1) * (night ? .12 : .06) + wob * .6 });
          col = mixHex(col, WHITE, spec * .25 * diff);
        } else {
          col = kind === 'w' ? white : red;
          col = mixHex(adjust(col, { L: jit(r, .04) + (diff - 1) * (night ? .3 : .1) }), WHITE, spec * .3);
        }
        const a = th + Math.PI / 2 + jit(r, .1), sw = ts * (.9 + r() * .14), sh = ts * (.9 + r() * .14);
        ctx.save();
        ctx.translate(x, y); ctx.rotate(a);
        const q = [[-sw / 2 + jit(r, .7), -sh / 2 + jit(r, .7)], [sw / 2 + jit(r, .7), -sh / 2 + jit(r, .7)], [sw / 2 + jit(r, .7), sh / 2 + jit(r, .7)], [-sw / 2 + jit(r, .7), sh / 2 + jit(r, .7)]];
        ctx.beginPath(); poly(ctx, q);
        if (kind === 'b') ctx.fillStyle = col;
        else {
          // The tilt shows as a light side and a dark side.
          const gx = tx * 18, gy = ty * 18;
          ctx.fillStyle = linear(ctx, -gx - 3, -gy - 3, gx + 3, gy + 3, [[0, tint(col, .14)], [1, shade(col, .16)]]);
        }
        ctx.fill();
        if (glow > .45) {
          ctx.strokeStyle = rgba(tint(col, .7), Math.min(1, glow) * .7); ctx.lineWidth = .9;
          ctx.beginPath(); ctx.moveTo(q[0][0] + 1, q[0][1] + .8); ctx.lineTo(q[1][0] - 1, q[1][1] + .8); ctx.stroke();
          sparks.push([x, y, glow]);
        }
        ctx.restore();
      }
    }

    // The gold glows where the light catches it.
    soft(ctx, x => {
      sparks.forEach(([px, py, g]) => { x.fillStyle = rgba(P.bright_yellow, Math.min(1, g)); x.fillRect(px - 6, py - 6, 12, 12); });
    }, night ? 10 : 7, night ? .55 : .35, 'lighter');

    // The dome curves away from the light.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, hx, hy, 150, 2100, [[0, WHITE], [.5, mixHex(WHITE, P.blue, .3)], [1, shade(P.blue, .55)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, hx, hy + 200, 0, 900, [[0, rgba(P.orange, .35)], [.5, rgba(P.orange, .1)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, hx, hy, 0, 1300, [[0, rgba(WHITE, .35)], [.5, rgba(WHITE, .1)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, Math.floor(r() * 1e9), night ? .05 : .04);
  });

  // ---------- tiles/bauhaus ----------

  // Points of a closed outline with a slightly ragged printed edge.
  function ragged(pts, r, n, amp = 1.2, step = 14) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
      const len = Math.hypot(x1 - x0, y1 - y0), k = Math.max(1, Math.round(len / step));
      for (let j = 0; j < k; j++) {
        const t = j / k, x = lerp(x0, x1, t), y = lerp(y0, y1, t);
        out.push([x + n(x * .03, y * .03) * amp + jit(r, amp * .25), y + n(y * .03 + 5, x * .03) * amp + jit(r, amp * .25)]);
      }
    }
    return out;
  }
  const disc = (cx, cy, rad, a0 = 0, a1 = TAU, steps = 120) => {
    const pts = [];
    for (let i = 0; i <= steps; i++) { const a = lerp(a0, a1, i / steps); pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); }
    return pts;
  };
  const rectPts = (x, y, w, h, rot = 0) => {
    const cx = x + w / 2, cy = y + h / 2, c = Math.cos(rot), s = Math.sin(rot);
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([u, v]) => [cx + u * c - v * s, cy + u * s + v * c]);
  };

  scene('tiles', 'bauhaus', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9));
    const paperC = night ? mixHex(P.lighter_background, P.dark_foreground, .1) : mixHex(P.background, WHITE, .25);
    const ink = night
      ? { red: P.red, yellow: P.yellow, blue: P.blue, black: P.darker_background }
      : { red: P.red, yellow: adjust(withL(P.yellow, .82), { C: .1 }), blue: P.blue, black: P.bright_foreground };

    ctx.fillStyle = paperC; ctx.fillRect(0, 0, W, H);
    paper(ctx, P, Math.floor(r() * 1e9), night ? .8 : .9);
    // Paper fibers.
    ctx.strokeStyle = rgba(night ? WHITE : P.dark_foreground, night ? .035 : .06); ctx.lineWidth = .6;
    ctx.beginPath();
    for (let i = 0; i < 1400; i++) { const x = r() * W, y = r() * H, a = r() * TAU, l = 4 + r() * 10; ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 1) * l * .5, y + Math.sin(a + 1) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); }
    ctx.stroke();

    // The composition, one list of shapes for each ink. Each ink sits a little off register.
    const shapes = {
      yellow: [[[0, H + 4], [640, H + 4], [0, 430]], disc(1452, 418, 96)],
      red: [disc(1440, 420, 300), rectPts(232, 362, 64, 64), rectPts(560, 196, 230, 22)],
      blue: [rectPts(1218, 610, 300, 300), disc(330, -6, 210, 0, Math.PI), rectPts(1640, 990, 280, 26)],
      black: [rectPts(1800, -10, 62, H + 20), rectPts(560, 960, 1260, 18), disc(1660, 820, 72), rectPts(80, 116, 1000, 7),
        rectPts(1118, 40, 7, 860), [[700, 1090], [880, 760], [1060, 1090]].map(([x, y]) => [x, y]),
        ...[0, 1, 2, 3, 4].map(i => disc(320 + i * 44, 300, 9, 0, TAU, 24))],
    };
    const offs = { yellow: [-2, 2.5], red: [2.5, -1.5], blue: [1.5, 2], black: [0, 0] };
    const [inkC, ix] = layer();
    ix.globalCompositeOperation = night ? 'source-over' : 'multiply';
    if (!night) { ix.fillStyle = WHITE; ix.fillRect(0, 0, W, H); }
    for (const key of ['yellow', 'blue', 'red', 'black']) {
      const [dx, dy] = offs[key];
      shapes[key].forEach(pts => {
        const q = ragged(pts.map(([x, y]) => [x + dx, y + dy]), r, n, key === 'black' ? .9 : 1.3);
        ix.beginPath(); poly(ix, q);
        ix.fillStyle = adjust(ink[key], { L: jit(r, .015) });
        ix.fill();
        // Ink gathers at the edge of the stencil.
        ix.strokeStyle = rgba(shade(ink[key], .25), .5); ix.lineWidth = 1.6; ix.stroke();
      });
    }
    // Ink density varies across the screen, and the paper shows through in specks.
    ix.globalCompositeOperation = 'destination-out';
    const mott = noiseMap(Math.floor(r() * 1e9), 384, 216, .05, .05, 4, (v, o) => { o[0] = o[1] = o[2] = 0; o[3] = clamp((v + .15) * 100, 0, 34); });
    ix.drawImage(mott, 0, 0, W, H);
    // Streaks from the squeegee and specks where the screen was clogged.
    for (let i = 0; i < 30; i++) { ix.fillStyle = rgba(BLACK, .015 + r() * .035); ix.fillRect(0, r() * H, W, 1 + r() * 5); }
    for (let i = 0; i < 5000; i++) {
      ix.fillStyle = rgba(BLACK, .3 + r() * .6);
      ix.beginPath(); circle(ix, r() * W, r() * H, .35 + r() ** 3 * 1.4); ix.fill();
    }

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (night) { ctx.globalAlpha = .94; ctx.drawImage(inkC, 0, 0); } else { ctx.globalCompositeOperation = 'multiply'; ctx.drawImage(inkC, 0, 0); }
    ctx.restore();
    // The ink sits in the paper grain.
    overlay(ctx, speckle(ctx, Math.floor(r() * 1e9), rr => [rr() * 255, 255]), night ? .06 : .05, 'overlay');

    // The poster was folded in four. The folds catch the light and crack the ink.
    const fx = W * .5 + jit(r, 20), fy = H * .5 + jit(r, 14);
    ctx.lineWidth = 2;
    ctx.strokeStyle = rgba(WHITE, night ? .1 : .5); ctx.beginPath(); ctx.moveTo(fx - 1.5, 0); ctx.lineTo(fx - 1.5, H); ctx.moveTo(0, fy - 1.5); ctx.lineTo(W, fy - 1.5); ctx.stroke();
    ctx.strokeStyle = rgba(BLACK, night ? .3 : .12); ctx.beginPath(); ctx.moveTo(fx + 1, 0); ctx.lineTo(fx + 1, H); ctx.moveTo(0, fy + 1); ctx.lineTo(W, fy + 1); ctx.stroke();
    ctx.fillStyle = rgba(paperC, .7);
    for (let i = 0; i < 900; i++) {
      const along = r() < .5, t = r();
      const x = along ? fx + jit(r, 3) : t * W, y = along ? t * H : fy + jit(r, 3);
      ctx.fillRect(x, y, .6 + r() * 1.6, .6 + r() * 1.6);
    }
    // Each panel bows a little between the folds.
    [[0, 0, fx, fy], [fx, 0, W - fx, fy], [0, fy, fx, H - fy], [fx, fy, W - fx, H - fy]].forEach(([x, y, w, h], i) => {
      ctx.fillStyle = linear(ctx, x, y, x + w, y + h, [[0, rgba(WHITE, night ? .03 : .12)], [.5, rgba(WHITE, 0)], [1, rgba(BLACK, night ? .1 : .05)]]);
      if (i % 2) ctx.fillStyle = linear(ctx, x + w, y, x, y + h, [[0, rgba(BLACK, night ? .08 : .04)], [.6, rgba(BLACK, 0)], [1, rgba(WHITE, night ? .03 : .1)]]);
      ctx.fillRect(x, y, w, h);
    });
    // Age: foxing spots and a worn edge.
    for (let i = 0; i < 26; i++) {
      const x = r() * W, y = r() * H, s = 2 + r() ** 3 * 10;
      ctx.fillStyle = radial(ctx, x, y, 0, s, [[0, rgba(night ? BLACK : P.brown, .2)], [1, rgba(P.brown, 0)]]);
      ctx.fillRect(x - s, y - s, s * 2, s * 2);
    }

    // Light across the poster.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 980, 420, 100, 1700, [[0, WHITE], [.5, mixHex(WHITE, P.background, .25)], [1, mixHex(P.background, P.lighter_background, .5)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 980, 420, 0, 900, [[0, rgba(P.foreground, .07)], [1, rgba(P.foreground, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = linear(ctx, 0, 0, W, H, [[0, WHITE], [.6, mixHex(WHITE, P.dark_background, .5)], [1, P.darker_background]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- tiles/atomic ----------

  // The ring number of flat sawn wood at a point. The rings form arches.
  function woodRing(seed, opts = {}) {
    const n = makeNoise(seed);
    const freq = opts.freq || .03, d0 = opts.d0 ?? 40, slope = opts.slope ?? .22, yc = opts.yc ?? H * .55;
    return (x, y) => {
      const d = d0 + x * slope + fbm(n, x * .0012, y * .0025, 3) * 70;
      const yy = (y - yc) * 1.1 + fbm(n, x * .0018 + 5, y * .003, 4) * 55;
      return Math.sqrt(d * d + yy * yy) * freq;
    };
  }

  // A wood grain map at low resolution.
  function woodMap(seed, cols, rows, ramp, opts = {}) {
    const ring = woodRing(seed, opts), m = makeNoise(seed + 17);
    return pixels(cols, rows, (i, j, o) => {
      const x = i / cols * W, y = j / rows * H;
      const t = ring(x, y), f = t - Math.floor(t);
      const late = (.5 + .5 * Math.cos(TAU * (f - .8))) ** 12;
      const streak = fbm(m, x * .0014, y * .07, 3) * .5 + .5;
      const broad = fbm(m, x * .0006 + 7, y * .0012, 3) * .5 + .5;
      const v = clamp(late * .32 + streak * .5 + broad * .38 - .14, 0, 1);
      const k = v * (ramp.length - 1), a = Math.floor(k), b = Math.min(ramp.length - 1, a + 1), u = k - a;
      for (let c = 0; c < 3; c++) o[c] = lerp(ramp[a][c], ramp[b][c], u);
      o[3] = 255;
    });
  }

  // Crisp grain lines along the rings, traced with marching squares. keep picks the levels.
  function grainLines(ctx, T, step, keep) {
    const gs = 6, cols = Math.ceil(W / gs) + 1, rows = Math.ceil(H / gs) + 1, g = new Float32Array(cols * rows);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) g[j * cols + i] = T(i * gs, j * gs);
    ctx.beginPath();
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const v4 = [g[j * cols + i], g[j * cols + i + 1], g[(j + 1) * cols + i + 1], g[(j + 1) * cols + i]];
        const p4 = [[i * gs, j * gs], [(i + 1) * gs, j * gs], [(i + 1) * gs, (j + 1) * gs], [i * gs, (j + 1) * gs]];
        const lo = Math.min(...v4), hi = Math.max(...v4);
        for (let v = Math.ceil(lo / step) * step; v < hi; v += step) {
          if (!keep(v)) continue;
          const pts = [];
          for (let e = 0; e < 4; e++) {
            const a = v4[e], b = v4[(e + 1) % 4];
            if ((a - v) * (b - v) < 0) { const t = (v - a) / (b - a), P0 = p4[e], P1 = p4[(e + 1) % 4]; pts.push([lerp(P0[0], P1[0], t), lerp(P0[1], P1[1], t)]); }
          }
          for (let k = 0; k + 1 < pts.length; k += 2) { ctx.moveTo(pts[k][0], pts[k][1]); ctx.lineTo(pts[k + 1][0], pts[k + 1][1]); }
        }
      }
    }
    ctx.stroke();
  }

  // A boomerang: two arms that meet at a rounded elbow, with round ends.
  function boomerang(x, len, wid, bend) {
    const c = [[-len, bend * .55], [-len * .45, bend * .02], [0, -bend * .2], [len * .45, -bend * .02], [len * .9, bend * .5]];
    const at = t => {
      const k = t * (c.length - 1), i = Math.min(c.length - 2, Math.floor(k)), u = k - i;
      const p0 = c[Math.max(0, i - 1)], p1 = c[i], p2 = c[i + 1], p3 = c[Math.min(c.length - 1, i + 2)];
      const f = (a, b, cc, d) => .5 * (2 * b + (-a + cc) * u + (2 * a - 5 * b + 4 * cc - d) * u * u + (-a + 3 * b - 3 * cc + d) * u * u * u);
      return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
    };
    const left = [], right = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, [px, py] = at(t), [qx, qy] = at(Math.min(1, t + .01)), [sx, sy] = at(Math.max(0, t - .01));
      const dx = qx - sx, dy = qy - sy, l = Math.hypot(dx, dy) || 1, w = wid * (.55 + .45 * Math.sin(Math.PI * t) ** .5);
      left.push([px - dy / l * w, py + dx / l * w]); right.push([px + dy / l * w, py - dx / l * w]);
    }
    // Round end caps.
    const cap = (p, q, o) => { const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, rr = Math.hypot(p[0] - q[0], p[1] - q[1]) / 2, a = Math.atan2(p[1] - my, p[0] - mx); return [1, 2, 3].map(k => [mx + Math.cos(a + o * k * Math.PI / 4) * rr, my + Math.sin(a + o * k * Math.PI / 4) * rr]); };
    const L = left.length - 1;
    x.beginPath();
    smoothPath(x, [...left, ...cap(left[L], right[L], -1), ...right.reverse(), ...cap(right[L], left[0], -1)], true);
  }

  scene('tiles', 'atomic', (ctx, P, r) => {
    const night = P.night;
    // Walnut at night. A lighter, sunlit walnut in the day.
    const woodRamp = (night
      ? [mixHex(P.brown, P.orange, .25), P.brown, mixHex(P.brown, BLACK, .3), mixHex(P.brown, BLACK, .55), mixHex(P.darker_background, BLACK, .3)]
      : [withL(mixHex(P.brown, P.background, .3), .84), withL(mixHex(P.brown, P.muted, .3), .76), withL(mixHex(P.brown, P.muted, .3), .68), withL(P.brown, .6), withL(P.brown, .5)]
    ).map(rgb);
    const seam = 1296;
    const woodSeed = Math.floor(r() * 1e9), woodOpts = { d0: 30, slope: .2, yc: 560 };
    const wood = woodMap(woodSeed, 960, 540, woodRamp, woodOpts);
    // Book-matched veneer: the right door mirrors the left one.
    ctx.drawImage(wood, 0, 0, W, H);
    ctx.save(); ctx.beginPath(); ctx.rect(seam, 0, W - seam, H); ctx.clip();
    ctx.translate(seam * 2, 0); ctx.scale(-1, 1); ctx.drawImage(wood, 0, 0, W, H); ctx.restore();
    // Grain lines follow the rings. The right door mirrors the left one.
    const ring = woodRing(woodSeed, woodOpts), Tm = (x, y) => ring(x < seam ? x : 2 * seam - x, y);
    const fr = v => v - Math.floor(v);
    ctx.lineWidth = .8; ctx.strokeStyle = rgba(BLACK, night ? .3 : .22);
    grainLines(ctx, Tm, .1, v => fr(v + .001) > .65 && fr(v + .001) < .95);
    ctx.lineWidth = .6; ctx.strokeStyle = rgba(BLACK, night ? .12 : .1);
    grainLines(ctx, Tm, .1, v => fr(v + .001) <= .65 || fr(v + .001) >= .95);
    // Fine pores.
    const gn = makeNoise(Math.floor(r() * 1e9));
    ctx.lineWidth = .7;
    for (let i = 0; i < 700; i++) {
      const y0 = r() * H, x0 = r() * W - 100, len = 60 + r() * 240, dark = r() < .7;
      ctx.strokeStyle = rgba(dark ? BLACK : WHITE, dark ? .04 + r() * .1 : .03 + r() * .05);
      ctx.beginPath();
      for (let x = x0; x < x0 + len; x += 20) { const y = y0 + fbm(gn, x * .002, y0 * .004, 3) * 40; if (x === x0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.stroke();
    }

    const teal = night ? [P.blue, P.green, P.bright_blue] : [P.blue, P.green, withL(P.cyan, .52)];
    const mustard = night ? [P.yellow, P.bright_yellow] : [adjust(withL(P.yellow, .7), { C: .05 }), adjust(withL(P.yellow, .64), { C: .05 })];
    const orange = night ? [P.red, P.orange] : [P.red, adjust(withL(P.orange, .6), { C: .03 })];
    const cream = night ? P.foreground : mixHex(P.background, WHITE, .5);
    const families = [teal, mustard, orange];

    // Motifs spread over the panel: larger near the edges, a quieter field in the middle left.
    const items = [];
    for (let tries = 0; tries < 3000 && items.length < 42; tries++) {
      const x = r() * (W + 160) - 80, y = r() * (H + 160) - 80;
      const edge = Math.min(x, W - x, y * 1.6, (H - y) * 1.6);
      const calm = Math.exp(-(((x - 800) / 560) ** 2 + ((y - 500) / 300) ** 2));
      if (r() < calm * 1.1) continue;
      const size = lerp(128, 66, clamp(edge / 420, 0, 1)) * (.75 + r() * .45);
      if (items.some(o => Math.hypot(o.x - x, o.y - y) < (o.size + size) * 1.15)) continue;
      items.push({ x, y, size, kind: r(), rot: r() * TAU, fam: Math.floor(r() * 3) });
    }

    const [pc, px] = layer();
    for (const it of items) {
      const fam = families[it.fam], col = pick(r, fam), alt = pick(r, families[(it.fam + 1 + Math.floor(r() * 2)) % 3]);
      px.save(); px.translate(it.x, it.y); px.rotate(it.rot);
      const s = it.size;
      if (it.kind < .3) {
        // A boomerang with an outline printed a little off register.
        boomerang(px, s * 1.05, s * .22, s * .9);
        px.fillStyle = col; px.fill();
        px.save(); px.translate(s * .06, s * .08); boomerang(px, s * 1.05, s * .22, s * .9); px.restore();
        px.strokeStyle = alt; px.lineWidth = 2.2; px.stroke();
      } else if (it.kind < .52) {
        // A starburst with balls on its rays.
        const rays = 8 + Math.floor(r() * 7);
        px.strokeStyle = col; px.fillStyle = col; px.lineWidth = 2.4; px.lineCap = 'round';
        for (let k = 0; k < rays; k++) {
          const a = k / rays * TAU + jit(r, .12), l = s * (.55 + r() * .5);
          px.beginPath(); px.moveTo(0, 0); px.lineTo(Math.cos(a) * l, Math.sin(a) * l); px.stroke();
          px.beginPath(); circle(px, Math.cos(a) * l, Math.sin(a) * l, 3.5 + r() * 3); px.fill();
        }
        px.fillStyle = alt; px.beginPath(); circle(px, 0, 0, s * .16); px.fill();
      } else if (it.kind < .7) {
        // A four pointed sparkle.
        const R = s * .85;
        px.beginPath(); px.moveTo(0, -R); px.quadraticCurveTo(0, 0, R * .75, 0); px.quadraticCurveTo(0, 0, 0, R); px.quadraticCurveTo(0, 0, -R * .75, 0); px.quadraticCurveTo(0, 0, 0, -R);
        px.fillStyle = col; px.fill();
        px.fillStyle = cream; px.beginPath(); circle(px, 0, 0, s * .07); px.fill();
      } else if (it.kind < .86) {
        // An atom: three orbits around a nucleus.
        px.strokeStyle = col; px.lineWidth = 2.4;
        for (let k = 0; k < 3; k++) { px.beginPath(); ellipse(px, 0, 0, s * .95, s * .32, k * Math.PI / 3); px.stroke(); }
        px.fillStyle = alt; px.beginPath(); circle(px, 0, 0, s * .15); px.fill();
        px.fillStyle = cream;
        for (let k = 0; k < 3; k++) { const a = r() * TAU, ro = k * Math.PI / 3; const ex = Math.cos(a) * s * .95, ey = Math.sin(a) * s * .32; px.beginPath(); circle(px, ex * Math.cos(ro) - ey * Math.sin(ro), ex * Math.sin(ro) + ey * Math.cos(ro), 4); px.fill(); }
      } else {
        // An oval with an offset ring.
        px.fillStyle = col; px.beginPath(); ellipse(px, 0, 0, s * .8, s * .48); px.fill();
        px.strokeStyle = alt; px.lineWidth = 2.2; px.beginPath(); ellipse(px, s * .12, -s * .08, s * .8, s * .48); px.stroke();
        px.fillStyle = cream; px.beginPath(); circle(px, -s * .3, 0, s * .08); px.fill();
      }
      px.restore();
    }
    // Confetti dots and dashes between the motifs.
    for (let i = 0; i < 150; i++) {
      const x = r() * W, y = r() * H;
      if (r() < Math.exp(-(((x - 800) / 560) ** 2 + ((y - 500) / 300) ** 2)) * 1.1) continue;
      if (items.some(o => Math.hypot(o.x - x, o.y - y) < o.size * .9)) continue;
      px.fillStyle = r() < .4 ? cream : pick(r, pick(r, families));
      if (r() < .6) { px.beginPath(); circle(px, x, y, 2 + r() * 3); px.fill(); } else { px.save(); px.translate(x, y); px.rotate(r() * TAU); px.fillRect(-7, -1.5, 14, 3); px.restore(); }
    }
    // Brush marks in the enamel.
    const strokes = noiseMap(Math.floor(r() * 1e9), 480, 270, .015, .25, 3, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 260); });
    px.globalCompositeOperation = 'source-atop'; px.globalAlpha = .22;
    px.drawImage(strokes, 0, 0, W, H);
    px.globalAlpha = 1;
    // Wear: paint chips away and shows the wood.
    px.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 2600; i++) { px.fillStyle = rgba(BLACK, .4 + r() * .6); px.beginPath(); circle(px, r() * W, r() * H, .4 + r() ** 3 * 2.2); px.fill(); }
    const wear = noiseMap(Math.floor(r() * 1e9), 320, 180, .06, .06, 4, (v, o) => { o[0] = o[1] = o[2] = 0; o[3] = clamp((v + .05) * 260, 0, 90); });
    px.drawImage(wear, 0, 0, W, H);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = night ? .92 : .95; ctx.drawImage(pc, 0, 0); ctx.restore();

    // The gap between the two doors.
    ctx.fillStyle = rgba(BLACK, night ? .75 : .45); ctx.fillRect(seam - 2, 0, 4, H);
    ctx.fillStyle = rgba(WHITE, night ? .08 : .3); ctx.fillRect(seam + 2, 0, 1.2, H);
    ctx.fillStyle = linear(ctx, seam - 30, 0, seam - 2, 0, [[0, rgba(BLACK, 0)], [1, rgba(BLACK, night ? .25 : .1)]]); ctx.fillRect(seam - 30, 0, 28, H);

    // Lacquer sheen and the light of the room.
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 420, 160, 80, 1900, [[0, WHITE], [.45, mixHex(WHITE, P.orange, .3)], [1, mixHex(P.background, BLACK, .3)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 420, 160, 0, 820, [[0, rgba(P.yellow, .22)], [.5, rgba(P.orange, .07)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = linear(ctx, 0, 0, W, H * .6, [[0, rgba(WHITE, .25)], [.35, rgba(WHITE, .05)], [.5, rgba(WHITE, .14)], [.62, rgba(WHITE, 0)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .15);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- tiles/stained-glass ----------

  scene('tiles', 'stained-glass', (ctx, P, r) => {
    const night = P.night;
    const cx = 1440, cy = 540, R = 600;
    const jewel = k => (night ? adjust(withL(P[k], .56), { C: .02 }) : adjust(withL(P[k], .56), { C: .03 }));
    const lead = night ? mixHex(P.darker_background, BLACK, .5) : mixHex(P.foreground, BLACK, .45);
    const stone = night ? mixHex(P.lighter_background, P.muted, .25) : withL(mixHex(mixHex(P.background, P.muted, .5), P.yellow, .3), .74);

    // Outside, seen through the clear quarries: sky and soft trees.
    const [bc, bx] = lowLayer(.25);
    bx.fillStyle = linear(bx, 0, 0, 0, H, night
      ? [[0, shade(P.blue, .62)], [.55, shade(P.blue, .5)], [1, shade(P.cyan, .6)]]
      : [[0, tint(P.cyan, .55)], [.55, tint(P.blue, .78)], [1, tint(P.green, .7)]]);
    bx.fillRect(0, 0, W, H);
    for (let i = 0; i < 26; i++) {
      const x = r() * 950, y = 600 + r() * 520, s = 90 + r() * 170;
      bx.fillStyle = rgba(night ? shade(P.green, .75) : mixHex(P.green, WHITE, .45), .45);
      bx.beginPath(); circle(bx, x, y, s); bx.fill();
    }
    if (night) { bx.fillStyle = radial(bx, 330, 200, 0, 220, [[0, rgba(P.bright_foreground, .75)], [.2, rgba(P.bright_foreground, .3)], [1, rgba(P.bright_foreground, 0)]]); bx.fillRect(0, 0, W, H); }
    ctx.save(); ctx.filter = blurPx(16); ctx.drawImage(bc, 0, 0, W, H); ctx.restore();

    // Diamond quarries of pale glass, each a little different.
    const qa = 56, qb = 96, quarries = [];
    for (let j = -1; j * qb < H + qb; j++) {
      for (let i = -1; i * qa * 2 < W + qa * 2; i++) {
        const x = i * qa * 2 + (j % 2 ? qa : 0), y = j * qb;
        quarries.push([[x, y - qb], [x + qa, y], [x, y + qb], [x - qa, y]]);
      }
    }
    const pale = night ? [P.bright_cyan, P.bright_blue, P.foreground, P.bright_yellow] : [WHITE, tint(P.cyan, .75), tint(P.yellow, .8), tint(P.green, .8)];
    const paint = night ? mixHex(P.darker_background, P.brown, .3) : mixHex(P.brown, P.dark_foreground, .4);
    quarries.forEach(q => {
      const [x, y] = [q[0][0], q[1][1]];
      ctx.fillStyle = linear(ctx, x - qa + jit(r, 30), y - qb, x + qa, y + qb + jit(r, 30), [[0, rgba(pick(r, pale), night ? .24 : .5)], [.5 + jit(r, .3), rgba(WHITE, night ? .05 : .14)], [1, rgba(pick(r, pale), night ? .18 : .4)]]);
      ctx.beginPath(); poly(ctx, q); ctx.fill();
      // Crown glass: a wavy streak of light in each pane.
      ctx.save(); ctx.clip();
      ctx.strokeStyle = rgba(WHITE, night ? .05 : .16); ctx.lineWidth = 8 + r() * 14;
      const sx = x + jit(r, qa * .5);
      ctx.beginPath(); ctx.moveTo(sx - qa, y - qb); ctx.quadraticCurveTo(sx + jit(r, 30), y, sx + qa * .6, y + qb); ctx.stroke();
      ctx.restore();
      // A small painted flower in some panes.
      if (r() < .3) {
        ctx.strokeStyle = rgba(paint, night ? .45 : .55); ctx.lineWidth = 1.4;
        for (let k = 0; k < 4; k++) { ctx.beginPath(); petal(ctx, x, y, 22, 7, k * Math.PI / 2 + Math.PI / 4); ctx.stroke(); }
        ctx.fillStyle = rgba(paint, .5); ctx.beginPath(); circle(ctx, x, y, 3); ctx.fill();
        ctx.beginPath(); ctx.moveTo(x, y + 26); ctx.quadraticCurveTo(x + 10, y + 44, x + 2, y + 60); ctx.stroke();
      }
    });
    ctx.save();
    ctx.strokeStyle = lead; ctx.lineWidth = 5;
    ctx.beginPath(); quarries.forEach(q => poly(ctx, q)); ctx.stroke();
    ctx.strokeStyle = rgba(WHITE, night ? .07 : .25); ctx.lineWidth = 1.2;
    ctx.beginPath(); quarries.forEach(q => poly(ctx, q.map(p => [p[0] - 1, p[1] - 1]))); ctx.stroke();
    ctx.restore();

    // The rose: a disc of stone with openings of glass.
    const at = (u, a) => [cx + Math.cos(a) * u, cy + Math.sin(a) * u];
    ctx.fillStyle = stone; ctx.beginPath(); circle(ctx, cx, cy, R + 34); ctx.fill();
    const tex = noiseMap(Math.floor(r() * 1e9), 240, 135, .08, .08, 4, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 200); });
    ctx.save(); ctx.beginPath(); circle(ctx, cx, cy, R + 34); ctx.clip();
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .6; ctx.drawImage(tex, 0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // Pits and grains of the stone.
    for (let i = 0; i < 2600; i++) {
      const a = r() * TAU, d = Math.sqrt(r()) * (R + 34);
      ctx.fillStyle = rgba(r() < .6 ? BLACK : WHITE, .08 + r() * .14);
      ctx.beginPath(); circle(ctx, cx + Math.cos(a) * d, cy + Math.sin(a) * d, .5 + r() * 1.6); ctx.fill();
    }
    ctx.fillStyle = linear(ctx, cx - R, cy - R, cx + R, cy + R, [[0, rgba(WHITE, night ? .05 : .3)], [.5, rgba(WHITE, 0)], [1, rgba(BLACK, night ? .3 : .22)]]);
    ctx.fillRect(cx - R - 40, cy - R - 40, R * 2 + 80, R * 2 + 80);
    ctx.restore();

    // An opening shaped like a wedge with a pointed head, from radius u0 to u1.
    const wedge = (a, half, u0, u1) => {
      const t = Math.tan(half), us = u1 / (1 + 1.75 * t), pts = [];
      for (let i = 0; i <= 6; i++) { const u = lerp(u0, us, i / 6); pts.push(at(u / Math.cos(half), a - half)); }
      const sl = at(us / Math.cos(half), a - half), sr = at(us / Math.cos(half), a + half), ap = at(u1, a);
      const out = (p, k) => [p[0] + Math.cos(a) * (u1 - us) * k, p[1] + Math.sin(a) * (u1 - us) * k];
      for (let i = 1; i <= 10; i++) { const s = i / 10, c = out(sl, .62); pts.push([(1 - s) ** 2 * sl[0] + 2 * (1 - s) * s * c[0] + s * s * ap[0], (1 - s) ** 2 * sl[1] + 2 * (1 - s) * s * c[1] + s * s * ap[1]]); }
      for (let i = 9; i >= 0; i--) { const s = i / 10, c = out(sr, .62); pts.push([(1 - s) ** 2 * sr[0] + 2 * (1 - s) * s * c[0] + s * s * ap[0], (1 - s) ** 2 * sr[1] + 2 * (1 - s) * s * c[1] + s * s * ap[1]]); }
      for (let i = 6; i >= 0; i--) { const u = lerp(u0, us, i / 6); pts.push(at(u / Math.cos(half), a + half)); }
      return pts;
    };
    const ring = (r0, r1, a0, a1, steps = 4) => {
      const pts = [];
      for (let i = 0; i <= steps; i++) pts.push(at(r1, lerp(a0, a1, i / steps)));
      for (let i = steps; i >= 0; i--) pts.push(at(r0, lerp(a0, a1, i / steps)));
      return pts;
    };
    const roundPts = (x, y, rad) => { const pts = []; for (let i = 0; i < 32; i++) { const a = i / 32 * TAU; pts.push([x + Math.cos(a) * rad, y + Math.sin(a) * rad]); } return pts; };
    const field = () => { const v = r(); return v < .58 ? jewel('blue') : v < .8 ? jewel('red') : v < .87 ? jewel('green') : v < .93 ? jewel('yellow') : v < .97 ? jewel('magenta') : jewel('cyan'); };
    const glassFill = (pts, col, lit = 1) => {
      let mx = 0, my = 0; pts.forEach(q => { mx += q[0]; my += q[1]; }); mx /= pts.length; my /= pts.length;
      const ext = Math.max(8, ...pts.map(q => Math.hypot(q[0] - mx, q[1] - my)));
      const c = adjust(col, { L: jit(r, .05), h: jit(r, 6) });
      ctx.fillStyle = radial(ctx, mx + jit(r, ext * .3), my + jit(r, ext * .3), 0, ext * 1.15, [[0, tint(c, (night ? .3 : .2) * lit)], [.5, c], [1, shade(c, night ? .5 : .38)]]);
      ctx.beginPath(); poly(ctx, pts); ctx.fill();
    };
    const leadLine = (pts, lw) => {
      ctx.beginPath(); poly(ctx, pts);
      ctx.lineWidth = lw; ctx.strokeStyle = lead; ctx.stroke();
    };
    const lights = [];
    // An opening of the tracery, filled with small panes in rings and columns, and a medallion.
    const opening = (outline, a, half, u0, u1, cols, med) => {
      ctx.save(); ctx.beginPath(); poly(ctx, outline); ctx.clip();
      const cells = [];
      for (let u = u0 - 8; u < u1 + 10; u += 30 + r() * 6) {
        for (let k = 0; k < cols; k++) {
          const a0 = a - half * 1.3 + k * half * 2.6 / cols, a1 = a0 + half * 2.6 / cols;
          cells.push(ring(u, u + 34, a0, a1, 3));
        }
      }
      cells.forEach(c => glassFill(c, field()));
      cells.forEach(c => leadLine(c, 3));
      if (med) {
        const [mx, my] = at(med.u, a), mp = roundPts(mx, my, med.rad);
        glassFill(mp, med.col, 1.6); leadLine(mp, 4);
        // A small flower painted on the medallion in dark glass paint.
        ctx.strokeStyle = rgba(BLACK, .45); ctx.lineWidth = 1.2;
        for (let p = 0; p < 4; p++) { const pa = a + p * Math.PI / 2 + Math.PI / 4; ctx.beginPath(); petal(ctx, mx, my, med.rad * .75, med.rad * .22, pa); ctx.stroke(); }
        lights.push([mx, my, med.rad, med.col]);
      }
      ctx.restore();
      // The carved edge of the opening: a chamfer in shade, and a lit rim.
      ctx.beginPath(); poly(ctx, outline);
      ctx.lineWidth = 16; ctx.strokeStyle = rgba(BLACK, night ? .3 : .16); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = lead; ctx.stroke();
      ctx.lineWidth = 2.2; ctx.strokeStyle = rgba(WHITE, night ? .1 : .6);
      ctx.beginPath(); poly(ctx, outline.map(p => [p[0] + 4, p[1] + 4])); ctx.stroke();
    };

    // The center roundel: a rosette.
    const center = roundPts(cx, cy, 104);
    ctx.save(); ctx.beginPath(); poly(ctx, center); ctx.clip();
    glassFill(center, jewel('blue'));
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU, p = [];
      for (let i = 0; i <= 12; i++) { const t = i / 12, w = Math.sin(t * Math.PI) * 22; p.push(at(30 + t * 70, a + w / (30 + t * 70))); }
      for (let i = 12; i >= 0; i--) { const t = i / 12, w = Math.sin(t * Math.PI) * 22; p.push(at(30 + t * 70, a - w / (30 + t * 70))); }
      glassFill(p, k % 2 ? jewel('red') : jewel('magenta')); leadLine(p, 4);
    }
    const eye = roundPts(cx, cy, 30); glassFill(eye, jewel('yellow'), 1.2); leadLine(eye, 4);
    ctx.restore();
    ctx.lineWidth = 7; ctx.strokeStyle = lead; ctx.beginPath(); poly(ctx, center); ctx.stroke();
    lights.push([cx, cy, 100, jewel('magenta')]);

    // 12 inner openings, 12 small roundels between their heads, 24 outer openings and 24 rim roundels.
    for (let k = 0; k < 12; k++) {
      const a = (k + .5) / 12 * TAU, half = Math.PI / 12 * .74;
      opening(wedge(a, half, 128, 330), a, half, 128, 330, 2, { u: 250, rad: 23, col: pick(r, [jewel('yellow'), jewel('green'), jewel('cyan')]) });
      const b = (k + 1) / 12 * TAU, [rx, ry] = at(318, b), rp = roundPts(rx, ry, 26);
      glassFill(rp, jewel('red')); leadLine(rp, 5);
    }
    for (let k = 0; k < 24; k++) {
      const a = (k + .5) / 24 * TAU, half = Math.PI / 24 * .76;
      opening(wedge(a, half, 368, 556), a, half, 368, 556, 2, { u: 470, rad: 17, col: pick(r, [jewel('yellow'), jewel('red'), jewel('green')]) });
      const [rx, ry] = at(R - 18, (k + 1) / 24 * TAU), rp = roundPts(rx, ry, 17);
      glassFill(rp, pick(r, [jewel('cyan'), jewel('yellow'), jewel('magenta')])); leadLine(rp, 4);
    }
    // Moldings of the stone rings.
    [[R + 34, 3], [R + 4, 2], [352, 2], [120, 2]].forEach(([rad, w]) => {
      ctx.lineWidth = w; ctx.strokeStyle = rgba(BLACK, night ? .5 : .25); ctx.beginPath(); circle(ctx, cx, cy, rad); ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, night ? .06 : .4); ctx.beginPath(); circle(ctx, cx, cy, rad - w); ctx.stroke();
    });

    // Antique glass: streaks, seeds and uneven thickness.
    const streak = noiseMap(Math.floor(r() * 1e9), 480, 270, .02, .1, 4, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 300); });
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .3; ctx.drawImage(streak, 0, 0, W, H); ctx.restore();
    ctx.fillStyle = rgba(WHITE, night ? .2 : .4);
    for (let i = 0; i < 600; i++) { ctx.beginPath(); circle(ctx, r() * W, r() * H, .5 + r() ** 3 * 1.5); ctx.fill(); }

    // Light glows through the glass.
    const glow = x => {
      lights.forEach(([lx, ly, rad, col]) => { x.fillStyle = col; x.beginPath(); circle(x, lx, ly, rad); x.fill(); });
      x.fillStyle = rgba(jewel('blue'), .8);
      for (let k = 0; k < 24; k++) { const a = (k + .5) / 24 * TAU; x.beginPath(); poly(x, wedge(a, Math.PI / 24 * .7, 370, 550)); x.fill(); }
      for (let k = 0; k < 12; k++) { const a = (k + .5) / 12 * TAU; x.beginPath(); poly(x, wedge(a, Math.PI / 12 * .7, 130, 325)); x.fill(); }
    };
    if (night) {
      soft(ctx, glow, 50, .42, 'lighter');
      soft(ctx, glow, 12, .16, 'lighter');
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, cx, cy, 120, 1500, [[0, WHITE], [.4, mixHex(WHITE, P.background, .2)], [1, mixHex(P.background, BLACK, .1)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      soft(ctx, glow, 34, .2, 'screen');
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, cx - 300, cy - 360, 0, 1500, [[0, rgba(WHITE, .32)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .12);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- tiles/tin-litho ----------

  function star5(x, cx, cy, R, rr, rot) {
    x.moveTo(cx + Math.cos(rot - Math.PI / 2) * R, cy + Math.sin(rot - Math.PI / 2) * R);
    for (let i = 1; i < 10; i++) {
      const a = rot - Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? rr : R;
      x.lineTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d);
    }
    x.closePath();
  }

  // A domed rivet head lit from the upper left.
  function rivet(x, px, py, rad, metal) {
    x.fillStyle = rgba(BLACK, .35); x.beginPath(); circle(x, px + rad * .3, py + rad * .4, rad * 1.05); x.fill();
    x.fillStyle = radial(x, px - rad * .35, py - rad * .4, rad * .1, rad * 1.2, [[0, tint(metal, .8)], [.45, metal], [1, shade(metal, .55)]]);
    x.beginPath(); circle(x, px, py, rad); x.fill();
  }

  scene('tiles', 'tin-litho', (ctx, P, r) => {
    const night = P.night;
    const red = P.red, blue = night ? P.blue : P.blue, key = night ? P.darker_background : P.bright_foreground;
    const yellow = night ? P.yellow : adjust(withL(P.yellow, .83), { C: .1 });
    const cream = night ? P.foreground : mixHex(P.background, WHITE, .3);
    const field = night ? withL(P.blue, .3) : P.background;
    const starC = night ? [yellow, P.bright_yellow, cream] : [red, blue, adjust(withL(P.yellow, .78), { C: .1 })];
    const tin = night ? mixHex(P.foreground, P.muted, .45) : mixHex(P.light_foreground, P.background, .55);

    // The printed sheet.
    ctx.fillStyle = field; ctx.fillRect(0, 0, W, H);
    // A soft printed gradient behind the stars.
    ctx.fillStyle = radial(ctx, 620, 430, 0, 900, night ? [[0, rgba(P.cyan, .2)], [1, rgba(P.cyan, 0)]] : [[0, rgba(P.yellow, .07)], [1, rgba(P.yellow, 0)]]);
    ctx.fillRect(0, 0, W, H);
    // Stars on a loose grid, a little off register: color first, then the key outline.
    const stars5 = [];
    for (let j = 0; j < 9; j++) {
      for (let i = 0; i < 17; i++) {
        const x = 150 + i * 118 + (j % 2) * 59 + jit(r, 14), y = 120 + j * 100 + jit(r, 12);
        if (y > 860 || r() < .25) continue;
        stars5.push([x, y, 10 + r() * 16, r() * TAU, pick(r, starC)]);
      }
    }
    stars5.forEach(([x, y, s, a, c]) => { ctx.fillStyle = c; ctx.beginPath(); star5(ctx, x + 1.5, y - 1, s, s * .45, a); ctx.fill(); });
    ctx.strokeStyle = rgba(key, .8); ctx.lineWidth = 1.4;
    stars5.forEach(([x, y, s, a]) => { ctx.beginPath(); star5(ctx, x, y, s, s * .45, a); ctx.stroke(); });
    ctx.fillStyle = cream;
    for (let i = 0; i < 160; i++) { const x = 100 + r() * 1800, y = 90 + r() * 760; ctx.beginPath(); circle(ctx, x, y, 1.5 + r() * 2.5); ctx.fill(); }

    // The rocket, printed big across the right side.
    ctx.save();
    ctx.translate(1450, 455); ctx.rotate(.66); ctx.scale(1.06, 1.06);
    const body = x => {
      x.beginPath();
      x.moveTo(-92, 150); x.lineTo(-92, -110);
      x.bezierCurveTo(-92, -220, -40, -300, 0, -340);
      x.bezierCurveTo(40, -300, 92, -220, 92, -110);
      x.lineTo(92, 150); x.quadraticCurveTo(80, 215, 0, 225); x.quadraticCurveTo(-80, 215, -92, 150); x.closePath();
    };
    const fins = x => {
      x.beginPath();
      x.moveTo(-90, 40); x.quadraticCurveTo(-190, 120, -200, 290); x.lineTo(-150, 270); x.quadraticCurveTo(-120, 220, -80, 200); x.closePath();
      x.moveTo(90, 40); x.quadraticCurveTo(190, 120, 200, 290); x.lineTo(150, 270); x.quadraticCurveTo(120, 220, 80, 200); x.closePath();
    };
    // The flame.
    [[yellow, 1], [P.orange, .72], [red, .45]].forEach(([c, k]) => {
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(-60 * k, 215); ctx.bezierCurveTo(-70 * k, 330 * k + 220 * (1 - k), -20 * k, 420 * k + 240 * (1 - k), 0, 470 * k + 230 * (1 - k));
      ctx.bezierCurveTo(20 * k, 420 * k + 240 * (1 - k), 70 * k, 330 * k + 220 * (1 - k), 60 * k, 215); ctx.closePath(); ctx.fill();
    });
    ctx.fillStyle = blue; fins(ctx); ctx.fill();
    ctx.fillStyle = red; body(ctx); ctx.fill();
    ctx.save(); body(ctx); ctx.clip();
    ctx.fillStyle = cream; ctx.fillRect(-100, -205, 200, 34); ctx.fillRect(-100, 112, 200, 26);
    ctx.fillStyle = yellow; ctx.fillRect(-100, -171, 200, 9); ctx.fillRect(-100, 103, 200, 9);
    // Printed shading as halftone dots on the shadow side.
    ctx.fillStyle = rgba(key, .55);
    for (let yy = -340; yy < 230; yy += 9) {
      for (let xx = -92; xx < 92; xx += 9) {
        const off = (Math.floor(yy / 9) % 2) * 4.5, t = clamp((xx + off + 20) / 110, 0, 1);
        if (t <= 0) continue;
        ctx.beginPath(); circle(ctx, xx + off, yy, 4.2 * Math.sqrt(t)); ctx.fill();
      }
    }
    ctx.fillStyle = rgba(WHITE, .35); ctx.fillRect(-70, -260, 16, 420);
    ctx.restore();
    // Portholes with rivets around them.
    [-140, -30].forEach(py => {
      ctx.fillStyle = cream; ctx.beginPath(); circle(ctx, 0, py, 40); ctx.fill();
      ctx.fillStyle = night ? withL(P.cyan, .45) : P.cyan; ctx.beginPath(); circle(ctx, 0, py, 29); ctx.fill();
      ctx.fillStyle = rgba(WHITE, .7); ctx.beginPath(); ellipse(ctx, -9, py - 10, 9, 5, -.6); ctx.fill();
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; rivet(ctx, Math.cos(a) * 35, py + Math.sin(a) * 35, 3, tin); }
    });
    // The key plate prints a little off register.
    ctx.translate(-2.5, 2);
    ctx.strokeStyle = key; ctx.lineWidth = 4; ctx.lineJoin = 'round';
    body(ctx); ctx.stroke(); fins(ctx); ctx.stroke();
    [-140, -30].forEach(py => { ctx.beginPath(); circle(ctx, 0, py, 40); ctx.stroke(); ctx.lineWidth = 2.5; ctx.beginPath(); circle(ctx, 0, py, 29); ctx.stroke(); ctx.lineWidth = 4; });
    ctx.beginPath(); ctx.moveTo(-92, 70); ctx.lineTo(92, 70); ctx.stroke();
    ctx.restore();

    // A sawtooth band at the top and stripes at the bottom.
    ctx.fillStyle = yellow; ctx.fillRect(0, 0, W, 64);
    ctx.fillStyle = red; ctx.beginPath();
    for (let x = 0; x < W + 40; x += 40) { ctx.moveTo(x, 0); ctx.lineTo(x + 20, 46); ctx.lineTo(x + 40, 0); }
    ctx.fill();
    ctx.fillStyle = key; ctx.fillRect(0, 62, W, 5);
    const sy = 902;
    for (let x = 0, k = 0; x < W; x += 46, k++) { ctx.fillStyle = k % 2 ? cream : red; ctx.fillRect(x, sy, 46, H - sy); }
    ctx.fillStyle = blue; ctx.fillRect(0, sy - 18, W, 18);
    ctx.fillStyle = key; ctx.fillRect(0, sy - 21, W, 3); ctx.fillRect(0, sy, W, 3);
    ctx.fillStyle = cream;
    for (let x = 30; x < W; x += 60) { ctx.beginPath(); star5(ctx, x, sy - 9, 6, 2.6, 0); ctx.fill(); }

    // Ink sits on bright tin: a brushed metal sheen shows through.
    const brushed = noiseMap(Math.floor(r() * 1e9), 160, 540, .4, .006, 3, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 200); });
    ctx.save(); ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = .18; ctx.drawImage(brushed, 0, 0, W, H); ctx.restore();

    // Seams: a folded edge on the left with tabs, and rivets along the bands.
    const seam = (x0, w) => {
      // The next sheet laps over this one and casts a thin shadow.
      ctx.fillStyle = linear(ctx, x0 + w, 0, x0 + w + 14, 0, [[0, rgba(BLACK, night ? .55 : .3)], [1, rgba(BLACK, 0)]]);
      ctx.fillRect(x0 + w, 0, 14, H);
      ctx.fillStyle = linear(ctx, 0, 0, x0 + w, 0, [[0, shade(tin, .35)], [.55, tin], [.85, tint(tin, .45)], [1, shade(tin, .25)]]);
      ctx.fillRect(0, 0, x0 + w, H);
      for (let y = 40; y < H; y += 86) rivet(ctx, x0 + w * .5, y + jit(r, 2), 6, tin);
    };
    seam(40, 34);
    for (let x = 140; x < W; x += 96) { rivet(ctx, x, 82, 7, tin); rivet(ctx, x + 48, sy - 40, 6, tin); }

    // Wear: scratches show bare tin, and rust grows at the seams.
    ctx.lineCap = 'round';
    for (let i = 0; i < 260; i++) {
      const x = r() * W, y = r() * H, a = jit(r, .5) + (r() < .5 ? 0 : Math.PI / 2), l = 6 + r() ** 2 * 60;
      ctx.strokeStyle = rgba(tint(tin, .5), .18 + r() * .3); ctx.lineWidth = .5 + r() * .9;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    const rust = mixHex(P.orange, P.brown, .5);
    for (let i = 0; i < 70; i++) {
      const edge = r() < .5, x = edge ? 60 + r() * 40 : r() * W, y = edge ? r() * H : (r() < .5 ? 70 + r() * 25 : sy - 30 + r() * 30), s = 2 + r() ** 2 * 12;
      ctx.fillStyle = radial(ctx, x, y, 0, s, [[0, rgba(rust, .5)], [1, rgba(rust, 0)]]);
      ctx.beginPath(); circle(ctx, x, y, s); ctx.fill();
    }
    // Worn ink along the band edges.
    ctx.fillStyle = rgba(tin, .5);
    for (let i = 0; i < 1400; i++) {
      const x = r() * W, y = r() < .5 ? 64 + jit(r, 4) : sy - 20 + jit(r, 4) + (r() < .5 ? 20 : 0);
      ctx.fillRect(x, y, .6 + r() * 2.2, .6 + r() * 1.4);
    }

    // The sheet curves a little, so a broad highlight runs across the tin.
    ctx.save(); ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = linear(ctx, 0, 0, W, H * .4, night
      ? [[0, rgba(WHITE, 0)], [.42, rgba(WHITE, .05)], [.5, rgba(P.bright_cyan, .16)], [.56, rgba(WHITE, .04)], [1, rgba(WHITE, 0)]]
      : [[0, rgba(WHITE, 0)], [.4, rgba(WHITE, .14)], [.5, rgba(WHITE, .38)], [.57, rgba(WHITE, .1)], [1, rgba(WHITE, 0)]]);
    ctx.fillRect(0, 0, W, H); ctx.restore();
    // Dents catch the light on one side.
    for (let i = 0; i < 5; i++) {
      const x = 200 + r() * 1600, y = 120 + r() * 800, s = 30 + r() * 50;
      ctx.fillStyle = linear(ctx, x - s, y - s, x + s, y + s, [[0, rgba(WHITE, .1)], [.5, rgba(WHITE, 0)], [1, rgba(BLACK, .12)]]);
      ctx.beginPath(); ellipse(ctx, x, y, s, s * .6, r() * TAU); ctx.fill();
    }
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 1300, 380, 120, 1500, [[0, WHITE], [.5, mixHex(WHITE, P.background, .3)], [1, mixHex(P.background, BLACK, .1)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- textile/tufted-leather ----------

  // Turns a height field into a shaded canvas. h gives the height at x and y in logical units.
  // shadeFn gets the diffuse and specular terms, the height, x, y and out, and writes the color into out.
  function shadeField(cols, rows, h, shadeFn, light = [-.45, -.65, .62]) {
    const ll = Math.hypot(...light), L = light.map(v => v / ll);
    const hv = [L[0], L[1], L[2] + 1], hl = Math.hypot(...hv), Hh = hv.map(v => v / hl);
    const sx = W / cols, sy = H / rows, e = Math.min(sx, sy) * .75;
    return pixels(cols, rows, (i, j, o) => {
      const x = (i + .5) * sx, y = (j + .5) * sy;
      const h0 = h(x, y), hx = h(x + e, y), hy = h(x, y + e);
      let nx = -(hx - h0) / e, ny = -(hy - h0) / e, nz = 1;
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const diff = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const spec = Math.max(0, nx * Hh[0] + ny * Hh[1] + nz * Hh[2]);
      shadeFn(diff, spec, h0, x, y, o);
      o[3] = 255;
    });
  }
  const rampRGB = (stops, t) => {
    t = clamp(t, 0, .9999) * (stops.length - 1);
    const i = Math.floor(t), u = t - i, a = stops[i], b = stops[i + 1];
    return [lerp(a[0], b[0], u), lerp(a[1], b[1], u), lerp(a[2], b[2], u)];
  };

  scene('textile', 'tufted-leather', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9));
    const dx = 330, dy = 178, ox = 120 + r() * 60, oy = 96;
    const weltY = 942, weltR = 30;
    const leather = mixHex(mixHex(P.red, P.magenta, .3), P.brown, night ? .15 : .25);
    const ramp = (night
      ? [mixHex(P.darker_background, BLACK, .3), withL(leather, .18), withL(leather, .27), withL(leather, .37), withL(leather, .47), withL(mixHex(leather, P.cyan, .3), .6)]
      : [withL(leather, .3), withL(leather, .4), withL(leather, .5), withL(leather, .6), withL(leather, .69), withL(mixHex(leather, P.cyan, .3), .8)]).map(rgb);
    const sheen = rgb(night ? P.bright_cyan : tint(P.bright_cyan, .6));
    const worn = rgb(night ? mixHex(P.cyan, P.muted, .4) : mixHex(P.cyan, P.background, .3));
    const lx = night ? 420 : 300, ly = night ? 180 : -100;

    // Lattice coordinates: buttons sit where s and t are whole numbers.
    const lat = (x, y) => { const px = (x - ox) / (dx / 2), py = (y - oy) / dy; return [(px + py) / 2, (px - py) / 2]; };
    const puffOf = (a, b) => .85 + (Math.sin(a * 12.9898 + b * 78.233) * 43758.5453 % 1 + 1) % 1 * .3;
    const height = (x, y) => {
      if (y > weltY - weltR) {
        const d = (y - weltY) / weltR;
        if (d < 1) return 38 * Math.sqrt(Math.max(0, 1 - d * d)) + 6;
        const u = clamp((y - weltY - weltR) / (H - weltY - weltR), 0, 1);
        return 30 * Math.sin(Math.PI * (.15 + u * .7)) + fbm(n2, x * .004, y * .01, 3) * 5;
      }
      const [s, t] = lat(x, y), fs = s - Math.floor(s), ft = t - Math.floor(t);
      let h = (Math.sin(Math.PI * fs) * Math.sin(Math.PI * ft)) ** .55 * 66 * puffOf(Math.floor(s), Math.floor(t));
      // Folds radiate from the nearest button.
      const bs = Math.round(s), bt = Math.round(t), bx = ox + (bs + bt) * dx / 2, by = oy + (bs - bt) * dy;
      const d = Math.hypot(x - bx, y - by), a = Math.atan2(y - by, x - bx);
      h += Math.sin(a * 7 + bs * 3 + bt * 5) * 6 * Math.exp(-d / 42) * clamp(d / 12, 0, 1);
      h += fbm(n, x * .01, y * .01, 3) * 2.5;
      // The panel tucks in above the welt.
      h *= clamp((weltY - weltR - y) / 22, 0, 1) ** .5;
      return h;
    };
    const field = shadeField(1120, 630, height, (diff, spec, h, x, y, o) => {
      const fall = night ? clamp(1.25 - Math.hypot(x - lx, y - ly) / 1500, .28, 1) : clamp(1.12 - Math.hypot(x - lx, y - ly) / 2600, .7, 1);
      const ao = clamp(.55 + h / 70, .45, 1);
      let v = (diff * .85 + .12) * ao * fall;
      const c = rampRGB(ramp, v);
      const sp = spec ** 26 * .55 * fall + spec ** 6 * .08 * fall;
      const w = clamp((h - 40) / 18, 0, 1) * (fbm(n2, x * .012, y * .012, 3) * .5 + .5) * .45;
      for (let k = 0; k < 3; k++) o[k] = clamp(lerp(c[k], worn[k] * (.4 + .6 * fall), w) + (sheen[k] - c[k]) * sp, 0, 255);
    });
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(field, 0, 0, W, H); ctx.restore();

    // Leather grain: a seamless net of fine creases around small pebbles.
    const grainTile = tilePattern(ctx, 220, 220, x => {
      const k = 30, c = 220 / k, pts = [...Array(k)].map((_, j) => [...Array(k)].map((__, i) => [(i + .5 + jit(r, .38)) * c, (j + .5 + jit(r, .38)) * c]));
      const at = (i, j) => { const p = pts[((j % k) + k) % k][((i % k) + k) % k]; return [p[0] + Math.floor(i / k) * 220, p[1] + Math.floor(j / k) * 220]; };
      x.lineWidth = .7; x.strokeStyle = rgba(BLACK, .55); x.lineJoin = 'round';
      for (const [ox, oy] of [[0, 0], [-220, 0], [0, -220], [-220, -220]]) {
        x.beginPath();
        for (let j = 0; j < k; j++) {
          for (let i = 0; i < k; i++) {
            const p = at(i, j), q = [at(i + 1, j), at(i, j + 1), at(i + 1, j + 1)];
            x.moveTo(p[0] + ox, p[1] + oy); x.lineTo(q[0][0] + ox, q[0][1] + oy);
            x.moveTo(p[0] + ox, p[1] + oy); x.lineTo(q[r() < .5 ? 1 : 2][0] + ox, q[r() < .5 ? 1 : 2][1] + oy);
          }
        }
        x.stroke();
      }
      x.fillStyle = rgba(WHITE, .22);
      for (let j = 0; j < k; j++) for (let i = 0; i < k; i++) { const p = pts[j][i]; x.beginPath(); circle(x, p[0] + c * .5 - .8, p[1] + c * .5 - .8, c * .22); x.fill(); }
    });
    overlay(ctx, grainTile, night ? .2 : .18, 'overlay');

    // Creases between the buttons, and the buttons.
    const buttons = [];
    for (let bs = -6; bs < 14; bs++) {
      for (let bt = -10; bt < 10; bt++) {
        const bx = ox + (bs + bt) * dx / 2, by = oy + (bs - bt) * dy;
        if (bx < -dx || bx > W + dx || by < -dy || by > weltY - 40) continue;
        buttons.push([bx + jit(r, 2), by + jit(r, 2), bs, bt]);
      }
    }
    const find = (s, t) => buttons.find(b => b[2] === s && b[3] === t);
    ctx.lineCap = 'round';
    buttons.forEach(([bx, by, bs, bt]) => {
      [[1, 0], [0, 1]].forEach(([ds, dt]) => {
        const o = find(bs + ds, bt + dt);
        if (!o) return;
        const mx = (bx + o[0]) / 2 + jit(r, 4), my = (by + o[1]) / 2 + jit(r, 4) + 3;
        ctx.strokeStyle = rgba(BLACK, night ? .55 : .35); ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.quadraticCurveTo(mx, my, o[0], o[1]); ctx.stroke();
        ctx.strokeStyle = rgba(WHITE, night ? .06 : .14); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(bx - 1.5, by - 2); ctx.quadraticCurveTo(mx - 1.5, my - 2.5, o[0] - 1.5, o[1] - 2); ctx.stroke();
      });
    });
    buttons.forEach(([bx, by]) => {
      const fall = night ? clamp(1.25 - Math.hypot(bx - lx, by - ly) / 1500, .3, 1) : 1;
      ctx.fillStyle = radial(ctx, bx, by, 0, 26, [[0, rgba(BLACK, .7)], [.45, rgba(BLACK, .35)], [1, rgba(BLACK, 0)]]);
      ctx.beginPath(); circle(ctx, bx, by, 26); ctx.fill();
      const base = withL(leather, (night ? .4 : .55) * fall);
      ctx.fillStyle = radial(ctx, bx - 3.5, by - 4, 1, 12, [[0, tint(base, .35)], [.5, base], [1, shade(base, .5)]]);
      ctx.beginPath(); circle(ctx, bx, by, 10.5); ctx.fill();
      ctx.fillStyle = rgba(WHITE, .25 * fall); ctx.beginPath(); ellipse(ctx, bx - 3.5, by - 4.5, 3, 1.8, -.6); ctx.fill();
    });

    // Brass nail heads along the welt.
    const brass = night ? mixHex(P.yellow, P.orange, .25) : adjust(withL(mixHex(P.yellow, P.orange, .3), .72), { C: .03 });
    for (let x = -6 + r() * 8, k = 0; x < W + 20; x += 32 + jit(r, 1), k++) {
      const y = weltY - 3 + jit(r, 1.6), fall = night ? clamp(1.25 - Math.hypot(x - lx, y - ly) / 1500, .3, 1) : 1;
      const tone = adjust(brass, { L: jit(r, .04) - (1 - fall) * .35, h: jit(r, 5) });
      ctx.fillStyle = rgba(BLACK, .5); ctx.beginPath(); circle(ctx, x + 2.5, y + 4, 13.5); ctx.fill();
      ctx.fillStyle = radial(ctx, x - 4, y - 4.5, .5, 14, [[0, tint(tone, .6)], [.35, tone], [.8, shade(tone, .45)], [1, shade(tone, .7)]]);
      ctx.beginPath(); circle(ctx, x, y, 12.5); ctx.fill();
      ctx.fillStyle = rgba(night ? P.bright_yellow : WHITE, .55 * fall); ctx.beginPath(); ellipse(ctx, x - 4, y - 4.5, 3.4, 2, -.6); ctx.fill();
      // Tarnish and dents on some heads.
      if (r() < .2) { ctx.fillStyle = rgba(shade(P.green, .4), .16); ctx.beginPath(); circle(ctx, x + 3, y + 3, 4 + r() * 4); ctx.fill(); }
    }

    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, lx, ly, 0, 900, [[0, rgba(P.orange, .12)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .18);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- textile/shibori ----------

  // A plain weave tile: threads over and under, each a little different.
  function weaveTile(ctx, r, size, pitch, light, dark) {
    return tilePattern(ctx, size, size, x => {
      const k = Math.round(size / pitch), p = size / k;
      const warp = [...Array(k)].map(() => .7 + r() * .6), weft = [...Array(k)].map(() => .7 + r() * .6);
      for (let j = 0; j < k; j++) {
        for (let i = 0; i < k; i++) {
          const over = (i + j) % 2 === 0, cx = (i + .5) * p, cy = (j + .5) * p;
          const w = over ? p * .46 * warp[i] : p * .62, h = over ? p * .62 : p * .46 * weft[j];
          x.fillStyle = over
            ? linear(x, cx - w, cy, cx + w, cy, [[0, dark], [.45, light], [1, dark]])
            : linear(x, cx, cy - h, cx, cy + h, [[0, dark], [.45, light], [1, dark]]);
          x.beginPath(); x.roundRect(cx - w, cy - h, w * 2, h * 2, Math.min(w, h) * .9); x.fill();
        }
      }
    });
  }

  scene('textile', 'shibori', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9)), n3 = makeNoise(Math.floor(r() * 1e9));
    const s1 = 530 + r() * 30, s2 = 1200 + r() * 40;
    const ramp = (night
      ? [withL(P.foreground, .8), withL(mixHex(P.foreground, P.blue, .45), .62), withL(P.blue, .45), withL(P.blue, .34), withL(P.blue, .25), withL(P.blue, .19)]
      : [mixHex(P.background, WHITE, .55), withL(mixHex(P.background, P.blue, .3), .87), withL(P.blue, .64), withL(P.blue, .5), withL(P.blue, .4), withL(P.blue, .33)]).map(rgb);
    const smoothstep = (a, b, v) => smooth(clamp((v - a) / (b - a), 0, 1));
    const tri = t => Math.abs((((t % 2) + 2) % 2) - 1);
    const hash = (a, b) => ((Math.sin(a * 12.9898 + b * 78.233) * 43758.5453) % 1 + 1) % 1;
    // Kumo bursts in the right panel.
    const kumo = [];
    for (let tries = 0; tries < 800 && kumo.length < 14; tries++) {
      const R = 80 + r() * 140, x = s2 + 30 + r() * (W - s2 + 40), y = r() * (H + 80) - 40;
      if (kumo.some(k => Math.hypot(k.x - x, k.y - y) < (k.R + R) * .72)) continue;
      kumo.push({ x, y, R, N: 18 + Math.floor(r() * 12), ph: r() * TAU, sp: jit(r, .4) });
    }
    const dye = (x, y) => {
      const mott = fbm(n3, x * .004, y * .004, 4) * .14;
      if (x < s1) {
        // Itajime: folded like an accordion and clamped between square blocks.
        const gx = x / 132 + .3, gy = y / 132 + .45, u = tri(gx), v = tri(gy);
        const cell = hash(Math.round(gx), Math.round(gy));
        const edge = Math.max(u, v) - .4 - cell * .14 + fbm(n, x * .035, y * .035, 3) * .06 + fbm(n2, x * .12, y * .12, 2) * .025;
        let d = smoothstep(-.03, .1, edge);
        // Dye creeps under the block from its edges.
        d = Math.max(d, .06 + cell * .2 + .45 * smoothstep(-.16, 0, edge));
        d += .1 * Math.exp(-((u - 1) ** 2) / .0008) + .1 * Math.exp(-((v - 1) ** 2) / .0008);
        return clamp(d * .94 + mott, 0, 1);
      }
      if (x < s2) {
        // Arashi: wrapped on a pole and scrunched, so the dye leaves fine diagonal rain.
        const w = x * .8 + y * .6, along = -x * .6 + y * .8;
        const crinkle = Math.sin(along * .09 + fbm(n, x * .01, y * .01, 2) * 3) * .9;
        const ph = w * .42 + fbm(n, x * .0035, y * .0035, 3) * 7 + crinkle + fbm(n2, along * .04, w * .015, 3) * 2.2;
        const line = .5 + .5 * Math.sin(ph), breakup = smoothstep(-.25, .35, fbm(n2, along * .015, w * .04, 3));
        const band = fbm(n3, w * .004, along * .001, 2) * .5 + .5;
        return clamp(.88 - .62 * smoothstep(.72, .96, line) * breakup - band * .18 + mott, 0, 1);
      }
      // Kumo: pinched and bound, so pale spider lines radiate from each point.
      let d = .92;
      for (const k of kumo) {
        const dx = x - k.x, dy = y - k.y, rho = Math.hypot(dx, dy) / k.R;
        if (rho > 1.2) continue;
        const a = Math.atan2(dy, dx) + rho * k.sp + fbm(n, dx * .02 + k.x, dy * .02, 2) * .14;
        const len = .55 + .5 * (fbm(n2, Math.floor((a + Math.PI) / TAU * k.N) * 1.7, k.y, 1) * .5 + .5);
        const ray = (.5 + .5 * Math.cos(a * k.N + k.ph)) ** (6 + rho * 14) * (1 - smoothstep(.25, len, rho));
        const core = 1 - smoothstep(.05, .2, rho + fbm(n2, dx * .05, dy * .05, 2) * .06);
        const glow = (1 - smoothstep(0, .9, rho)) * .3;
        // Bound rings stay pale, and the thread itself leaves a dark line.
        const ringW = (Math.exp(-((rho - .78) ** 2) / .0012) * .3 + Math.exp(-((rho - .9) ** 2) / .0008) * .2) * smoothstep(0, .45, fbm(n2, Math.cos(a) * 2 + k.x, Math.sin(a) * 2, 2));
        const bind = Math.exp(-((rho - .45) ** 2) / .0018);
        const resist = clamp(Math.max(core, ray * .95, glow, ringW) * (1 - bind * .7), 0, 1);
        d = Math.min(d, 1 - resist * (.8 + fbm(n2, x * .05, y * .05, 2) * .25));
      }
      return clamp(d + mott * .8, 0, 1);
    };
    const cloth = pixels(960, 540, (i, j, o) => {
      const x = (i + .5) * 2, y = (j + .5) * 2, c = rampRGB(ramp, dye(x, y));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2]; o[3] = 255;
    });
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(cloth, 0, 0, W, H); ctx.restore();

    // The weave of the cotton.
    overlay(ctx, weaveTile(ctx, r, 96, 3.2, WHITE, BLACK), night ? .2 : .16, 'overlay');
    // Slubs: thicker threads that run across the cloth.
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 260; i++) {
      const horiz = r() < .5, p = r() * (horiz ? H : W), a = r() * (horiz ? W : H), l = 30 + r() * 140;
      ctx.strokeStyle = rgba(r() < .5 ? WHITE : BLACK, .05 + r() * .06);
      ctx.beginPath();
      if (horiz) { ctx.moveTo(a, p); ctx.lineTo(a + l, p + jit(r, 1)); } else { ctx.moveTo(p, a); ctx.lineTo(p + jit(r, 1), a + l); }
      ctx.stroke();
    }

    // The panels are sewn together: a ridge at each seam and a running stitch.
    [s1, s2].forEach(sx => {
      ctx.fillStyle = linear(ctx, sx - 16, 0, sx + 16, 0, [[0, rgba(BLACK, 0)], [.42, rgba(BLACK, night ? .4 : .22)], [.5, rgba(BLACK, night ? .6 : .35)], [.58, rgba(WHITE, night ? .08 : .2)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(sx - 16, 0, 32, H);
      ctx.strokeStyle = night ? withL(P.foreground, .62) : mixHex(P.background, WHITE, .5); ctx.lineWidth = 2.2; ctx.lineCap = 'round';
      ctx.beginPath();
      for (let y = -r() * 20; y < H; y += 21 + jit(r, 2)) { const xx = sx + 11 + jit(r, 1.2); ctx.moveTo(xx, y); ctx.lineTo(xx + jit(r, .8), y + 11 + jit(r, 1.5)); }
      ctx.stroke();
    });

    // The cloth hangs with soft folds.
    const folds = noiseMap(Math.floor(r() * 1e9), 192, 108, .012, .03, 3, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 330); });
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = night ? .55 : .5; ctx.drawImage(folds, 0, 0, W, H); ctx.restore();
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 700, 160, 100, 2000, [[0, WHITE], [.5, mixHex(WHITE, P.blue, .2)], [1, shade(P.blue, .5)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 300, 0, 0, 1500, [[0, rgba(WHITE, .25)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .45 : .14);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- textile/silk ----------

  scene('textile', 'silk', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9));
    // The silk is gathered above the top left corner and falls in a fan of folds.
    const gx = -420 + r() * 120, gy = -380 + r() * 100;
    const ph1 = r() * TAU, ph2 = r() * TAU;
    const height = (x, y) => {
      const dx = x - gx, dy = y - gy, d = Math.hypot(dx, dy);
      const th = Math.atan2(dy, dx) + fbm(n, x * .0007, y * .0007, 2) * .2;
      // Folds swell and fade along their length.
      const amp = clamp(.55 + .6 * fbm(n2, x * .0011, y * .0011, 2), .1, 1);
      let h = Math.sin(th * 14 + ph1 + d * .0009) * 72 * amp * (.55 + d / 2600);
      h += Math.sin(th * 33 + ph2 + d * .0022) * 18 * (1.1 - amp);
      // A slow sag across the folds.
      h += Math.sin(d * .0036 + th * 1.6) * 34;
      // A second gather below the right edge pulls a few folds the other way.
      const ex = x - 2350, ey = y - 1500, e = Math.hypot(ex, ey), th2 = Math.atan2(ey, ex) + fbm(n2, x * .0009, y * .0009, 2) * .15;
      h += Math.sin(th2 * 12 + ph2) * 40 * smooth(clamp((1500 - e) / 700, 0, 1));
      return h;
    };
    const mauve = P.blue;
    const ramp = (night
      ? [mixHex(P.darker_background, BLACK, .2), withL(mauve, .17), withL(mauve, .26), withL(mauve, .38), withL(mixHex(mauve, P.magenta, .4), .52), withL(mixHex(mauve, P.cyan, .5), .7)]
      : [withL(mauve, .5), withL(mauve, .6), withL(mixHex(mauve, P.cyan, .2), .7), withL(mixHex(mauve, P.cyan, .35), .8), withL(mixHex(mauve, P.cyan, .5), .88), withL(P.cyan, .94)]).map(rgb);
    const sheen = rgb(night ? P.bright_cyan : mixHex(P.background, WHITE, .6));
    const lx = night ? 1550 : 1700, ly = night ? 60 : -200;
    const field = shadeField(960, 540, height, (diff, spec, h, x, y, o) => {
      const fall = night ? clamp(1.3 - Math.hypot(x - lx, y - ly) / 1650, .3, 1) : clamp(1.15 - Math.hypot(x - lx, y - ly) / 3000, .72, 1);
      const ao = clamp(.75 + h / 180, .5, 1);
      const v = (diff ** 1.6 * .95 + .05) * ao * fall;
      const c = rampRGB(ramp, v);
      const sp = (spec ** 70 * .75 + spec ** 9 * .2) * fall;
      for (let k = 0; k < 3; k++) o[k] = clamp(c[k] + (sheen[k] - c[k]) * sp, 0, 255);
    }, [.58, -.62, .42]);
    ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(field, 0, 0, W, H); ctx.restore();

    // Fine satin threads catch the light along the weave.
    const satin = tilePattern(ctx, 160, 160, x => {
      x.lineWidth = .5;
      for (let i = 0; i < 260; i++) {
        const y = r() * 160, x0 = r() * 160, l = 10 + r() * 50;
        x.strokeStyle = rgba(r() < .5 ? WHITE : BLACK, .12 + r() * .18);
        x.beginPath(); x.moveTo(x0, y); x.lineTo(x0 + l, y + jit(r, .4)); x.stroke();
        x.beginPath(); x.moveTo(x0 - 160, y); x.lineTo(x0 - 160 + l, y + jit(r, .4)); x.stroke();
      }
    });
    ctx.save();
    ctx.translate(W / 2, H / 2); ctx.rotate(.55); ctx.translate(-W, -H);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = night ? .14 : .12;
    ctx.fillStyle = satin; ctx.fillRect(0, 0, W * 2, H * 2);
    ctx.restore();

    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, lx, ly, 0, 900, [[0, rgba(P.magenta, .1)], [1, rgba(P.magenta, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .14);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- textile/tweed ----------

  scene('textile', 'tweed', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9)), n2 = makeNoise(Math.floor(r() * 1e9));
    const warp = night ? withL(mixHex(P.brown, P.muted, .3), .3) : withL(mixHex(P.brown, P.muted, .3), .56);
    const weft = night ? withL(mixHex(P.dark_foreground, P.yellow, .25), .58) : withL(mixHex(P.muted, P.yellow, .25), .87);
    const flecks = [P.red, P.green, P.yellow, P.magenta, P.blue, P.cyan].map(c => (night ? withL(c, .55) : withL(c, .6)));
    ctx.fillStyle = shade(mixHex(warp, weft, .35), .35); ctx.fillRect(0, 0, W, H);

    // A 2/2 twill on a grid of threads. The twill turns direction every 12 threads: herringbone.
    const t = 14, N = 10, cols = Math.ceil(W / t) + 2, rows = Math.ceil(H / t) + 2;
    // Each thread has its own thickness, and the threads wander a little.
    const tw = [...Array(cols + 2)].map(() => .8 + r() * .25), th = [...Array(rows + 2)].map(() => .8 + r() * .25);
    const wx = (x, y) => fbm(n2, x * .004, y * .004, 2) * 3, wy = (x, y) => fbm(n2, x * .004 + 7, y * .004, 2) * 3;
    const up = (i, j) => { const dir = Math.floor(i / N) % 2 ? 1 : -1, shift = Math.floor(i / N) % 2 ? 2 : 0; return ((((i * dir + j + shift) % 4) + 4) % 4) < 2; };
    const [wc, g] = layer();
    const float = (x, y, w, h, c, vertical) => {
      g.fillStyle = vertical
        ? linear(g, x, 0, x + w, 0, [[0, shade(c, .35)], [.35, tint(c, .08)], [.65, c], [1, shade(c, .4)]])
        : linear(g, 0, y, 0, y + h, [[0, shade(c, .35)], [.35, tint(c, .08)], [.65, c], [1, shade(c, .4)]]);
      g.beginPath(); g.roundRect(x, y, w, h, Math.min(w, h) * .45); g.fill();
      // The ends dive under the crossing thread.
      g.fillStyle = vertical
        ? linear(g, 0, y, 0, y + h, [[0, rgba(BLACK, .22)], [.2, rgba(BLACK, 0)], [.8, rgba(BLACK, 0)], [1, rgba(BLACK, .28)]])
        : linear(g, x, 0, x + w, 0, [[0, rgba(BLACK, .22)], [.2, rgba(BLACK, 0)], [.8, rgba(BLACK, 0)], [1, rgba(BLACK, .28)]]);
      g.fill();
      // The twist of the yarn.
      g.strokeStyle = rgba(shade(c, .55), .3); g.lineWidth = .7;
      g.beginPath();
      if (vertical) for (let yy = y + 2; yy < y + h - 2; yy += 3.4) { g.moveTo(x + 1, yy + 2.5); g.lineTo(x + w - 1, yy - 1); }
      else for (let xx = x + 2; xx < x + w - 2; xx += 3.4) { g.moveTo(xx - 1, y + 1); g.lineTo(xx + 2.5, y + h - 1); }
      g.stroke();
      // A knop of colored fiber spun into the yarn.
      if (r() < .22) {
        const k = 1 + Math.floor(r() * 3), fc = pick(r, flecks);
        for (let i = 0; i < k; i++) {
          const fx = x + w * (.2 + r() * .6), fy = y + h * (.2 + r() * .6);
          g.fillStyle = rgba(fc, .9);
          g.beginPath(); ellipse(g, fx, fy, 2.2 + r() * 3, 1.5 + r() * 1.8, r() * TAU); g.fill();
        }
      }
    };
    const yarn = (base, x, y) => adjust(base, { L: jit(r, .05) + fbm(n, x * .005, y * .005, 3) * .06, C: jit(r, .006) });
    // Weft floats first, then warp floats on top of them.
    for (let j = -1; j < rows; j++) {
      let i = -1;
      while (i < cols) {
        if (up(i, j)) { i++; continue; }
        let k = i; while (k < cols && !up(k, j)) k++;
        const h = t * 1.02 * th[j + 1], x = i * t - t * .1 + jit(r, .8) + wx(i * t, j * t), y = j * t + (t - h) / 2 + jit(r, .9) + wy(i * t, j * t);
        float(x, y, (k - i) * t + t * .2, h, yarn(weft, x, y), false);
        i = k;
      }
    }
    for (let i = -1; i < cols; i++) {
      let j = -1;
      while (j < rows) {
        if (!up(i, j)) { j++; continue; }
        let k = j; while (k < rows && up(i, k)) k++;
        const w = t * 1.04 * tw[i + 1], x = i * t + (t - w) / 2 + jit(r, .9) + wx(i * t, j * t), y = j * t - t * .12 + jit(r, .8) + wy(i * t, j * t);
        float(x, y, w, (k - j) * t + t * .24, yarn(warp, x, y), true);
        j = k;
      }
    }
    // Wool is soft: the weave blurs a little under its own fuzz.
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.filter = blurPx(.6); ctx.drawImage(wc, 0, 0); ctx.restore();

    // Heathered wool: fibers of lighter and darker shades in every yarn.
    const heather = tilePattern(ctx, 180, 180, x => {
      for (let i = 0; i < 2600; i++) {
        x.fillStyle = r() < .5 ? rgba(WHITE, .5) : rgba(BLACK, .5);
        x.beginPath(); ellipse(x, r() * 180, r() * 180, .5 + r() * 1.2, .4 + r() * .5, r() * TAU); x.fill();
      }
    });
    overlay(ctx, heather, .22, 'overlay');
    // Fibers: colored flecks and loose hairs over the weave.
    ctx.lineCap = 'round';
    for (let i = 0; i < 500; i++) {
      const x = r() * W, y = r() * H, a = r() * TAU, l = 4 + r() * 10;
      ctx.strokeStyle = rgba(pick(r, flecks), .7); ctx.lineWidth = .9 + r() * .8;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + .8) * l * .5, y + Math.sin(a + .8) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    for (let i = 0; i < 11000; i++) {
      const x = r() * W, y = r() * H, a = r() * TAU, l = 5 + r() * 20;
      ctx.strokeStyle = rgba(r() < .6 ? tint(weft, .3) : shade(warp, .2), .12 + r() * .2); ctx.lineWidth = .55;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(a + 1) * l * .5, y + Math.sin(a + 1) * l * .5, x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }

    // The cloth lies in a soft fold, and the light falls across it.
    const fold = noiseMap(Math.floor(r() * 1e9), 192, 108, .01, .016, 3, (v, o) => { const k = v > 0 ? 255 : 0; o[0] = o[1] = o[2] = k; o[3] = Math.min(255, Math.abs(v) * 300); });
    ctx.save(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = .6; ctx.drawImage(fold, 0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = linear(ctx, 1100, 1080, 1500, 500, [[0, rgba(BLACK, 0)], [.42, rgba(BLACK, .5)], [.5, rgba(BLACK, .55)], [.62, rgba(WHITE, .4)], [.8, rgba(WHITE, 0)]]);
    ctx.fillRect(0, 0, W, H); ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = night ? 'multiply' : 'screen';
    ctx.fillStyle = night
      ? radial(ctx, 500, 200, 100, 1900, [[0, WHITE], [.5, mixHex(WHITE, P.background, .35)], [1, mixHex(P.background, BLACK, .3)]])
      : radial(ctx, 300, -100, 0, 1700, [[0, rgba(WHITE, .3)], [1, rgba(WHITE, 0)]]);
    ctx.fillRect(0, 0, W, H); ctx.restore();
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 500, 200, 0, 800, [[0, rgba(P.yellow, .1)], [1, rgba(P.yellow, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .16);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- textile/tapestry ----------

  scene('textile', 'tapestry', (ctx, P, r) => {
    const night = P.night;
    const n = makeNoise(Math.floor(r() * 1e9));
    // The weave: ribs 8 units wide, and weft beads 4 units tall.
    const RW = 8, BH = 4, cols = W / RW, rows = H / BH;
    const tone = (c, L) => withL(c, L);
    const yarn = night ? {
      ground: [tone(mixHex(P.blue, P.green, .45), .26), tone(mixHex(P.blue, P.green, .45), .3), tone(mixHex(P.blue, P.green, .45), .22)],
      green: [tone(P.green, .38), tone(P.green, .5), tone(mixHex(P.green, P.yellow, .4), .6)],
      red: [tone(P.red, .48), tone(P.red, .6)], yellow: [tone(P.yellow, .7), tone(P.yellow, .8)], blue: [tone(P.blue, .5), tone(P.cyan, .68)],
      pink: [tone(P.magenta, .58), tone(P.magenta, .72)], white: [tone(P.foreground, .86)], brown: [tone(P.brown, .4)],
      border: [tone(P.red, .4), tone(P.red, .48)],
    } : {
      ground: [mixHex(P.background, P.yellow, .2), mixHex(P.background, P.yellow, .3), mixHex(P.background, P.green, .15)],
      green: [tone(P.green, .52), tone(P.green, .62), tone(mixHex(P.green, P.yellow, .4), .72)],
      red: [tone(P.red, .58), tone(P.red, .68)], yellow: [tone(P.yellow, .7), tone(P.yellow, .8)], blue: [tone(P.blue, .55), tone(P.cyan, .68)],
      pink: [tone(P.magenta, .62), tone(P.magenta, .74)], white: [mixHex(P.background, WHITE, .6)], brown: [tone(P.brown, .5)],
      border: [tone(P.red, .62), tone(P.red, .7)],
    };
    const flowerSets = [yarn.red, yarn.yellow, yarn.blue, yarn.pink, yarn.white];

    // The cartoon: the design, drawn at the size of the weave.
    const dc = document.createElement('canvas');
    dc.width = cols; dc.height = rows;
    const d = dc.getContext('2d');
    d.scale(cols / W, rows / H);
    d.fillStyle = yarn.ground[0]; d.fillRect(0, 0, W, H);
    // Abrash: each dye lot came out a little different, so the ground has bands.
    for (let y = 0; y < H; y += 20 + r() * 60) { d.fillStyle = rgba(pick(r, yarn.ground), .6); d.fillRect(0, y, W, 8 + r() * 40); }
    const leafy = (x, y, len, wid, a, col) => { d.fillStyle = col; d.beginPath(); leaf(d, x, y, len, wid, a); d.fill(); };
    const flower = (x, y, rad, set, petals = 5) => {
      d.fillStyle = set[0];
      for (let i = 0; i < petals; i++) { const a = i / petals * TAU + r(); d.beginPath(); petal(d, x, y, rad, rad * .55, a); d.fill(); }
      d.fillStyle = set[1] || set[0]; d.beginPath(); circle(d, x, y, rad * .35); d.fill();
      d.fillStyle = pick(r, yarn.yellow); d.beginPath(); circle(d, x, y, rad * .16); d.fill();
    };
    const plant = (x, y, s) => {
      const kind = r(), lean = jit(r, .25), tx = x + lean * s, ty = y - s;
      const set = pick(r, flowerSets);
      // A rosette of leaves at the base.
      const base = 4 + Math.floor(r() * 3);
      for (let i = 0; i < base; i++) leafy(x, y, s * (.3 + r() * .14), s * .1, -Math.PI / 2 + (i / (base - 1) - .5) * 2.6 + jit(r, .15), pick(r, yarn.green));
      d.strokeStyle = yarn.green[0]; d.lineWidth = Math.max(5, s * .045); d.lineCap = 'round';
      d.beginPath(); d.moveTo(x, y); d.quadraticCurveTo(x + jit(r, s * .15), y - s * .5, tx, ty); d.stroke();
      const pairs = 1 + Math.floor(r() * 3);
      for (let i = 0; i < pairs; i++) {
        const t = .3 + i / pairs * .5, px = lerp(x, tx, t), py = lerp(y, ty, t), g = pick(r, yarn.green);
        leafy(px, py, s * (.3 - t * .12), s * .09, -Math.PI / 2 - .8 - r() * .4, g);
        leafy(px, py, s * (.3 - t * .12), s * .09, -Math.PI / 2 + .8 + r() * .4, g);
      }
      if (kind < .3) flower(tx, ty, s * .2, set, 5 + Math.floor(r() * 3));
      else if (kind < .55) {
        for (let i = 0; i < 4; i++) { const a = -Math.PI / 2 + jit(r, 1.1), l = s * (.15 + r() * .15), bx = tx + Math.cos(a) * l, by = ty + Math.sin(a) * l; d.beginPath(); d.moveTo(tx, ty); d.lineTo(bx, by); d.lineWidth = 4; d.stroke(); flower(bx, by, s * .1, set); }
      } else if (kind < .78) {
        // A spike of bells.
        for (let i = 0; i < 6; i++) { const t = .45 + i * .1, bx = lerp(x, tx, t) + (i % 2 ? 1 : -1) * s * .08, by = lerp(y, ty, t); d.fillStyle = set[i % set.length]; d.beginPath(); ellipse(d, bx, by, s * .065, s * .085, 0); d.fill(); }
      } else {
        // Strawberries: white flowers and red fruit.
        for (let i = 0; i < 3; i++) { const bx = tx + jit(r, s * .25), by = ty + s * .2 + jit(r, s * .2); flower(bx, by, s * .09, yarn.white); }
        for (let i = 0; i < 3; i++) { d.fillStyle = yarn.red[0]; d.beginPath(); ellipse(d, x + jit(r, s * .3), y - s * (.2 + r() * .3), s * .065, s * .08, 0); d.fill(); }
      }
    };
    // Plants strewn over the ground, as in a millefleur.
    const spots = [];
    for (let tries = 0; tries < 4000 && spots.length < 90; tries++) {
      const x = r() * (W + 80) - 40, y = 150 + r() * (H - 190), s = 100 + r() * 80;
      if (spots.some(p => Math.hypot(p[0] - x, (p[1] - y) * 1.2) < (p[2] + s) * .5)) continue;
      spots.push([x, y, s]);
    }
    spots.sort((a, b) => a[1] - b[1]).forEach(([x, y, s]) => plant(x, y, s));
    // Small single flowers fill the gaps.
    for (let i = 0; i < 160; i++) { const x = r() * W, y = 90 + r() * (H - 180); if (spots.some(p => Math.hypot(p[0] - x, p[1] - p[2] * .5 - y) < p[2] * .5)) continue; flower(x, y, 9 + r() * 6, pick(r, flowerSets)); }
    // Woven borders at the top and the bottom.
    [[0, 62], [H - 62, H]].forEach(([y0, y1]) => {
      d.fillStyle = yarn.border[0]; d.fillRect(0, y0, W, y1 - y0);
      d.fillStyle = pick(r, yarn.yellow); d.fillRect(0, y0 + 6, W, 5); d.fillRect(0, y1 - 11, W, 5);
      for (let x = 20; x < W; x += 64) {
        d.fillStyle = yarn.border[1]; d.beginPath(); poly(d, [[x, (y0 + y1) / 2 - 16], [x + 16, (y0 + y1) / 2], [x, (y0 + y1) / 2 + 16], [x - 16, (y0 + y1) / 2]]); d.fill();
        d.fillStyle = yarn.white[0]; d.beginPath(); circle(d, x, (y0 + y1) / 2, 5); d.fill();
        d.fillStyle = yarn.green[1]; d.beginPath(); circle(d, x + 32, (y0 + y1) / 2, 4); d.fill();
      }
    });

    // Every bead takes one yarn: snap each cell to the nearest yarn, with dither for hatching.
    const pal = Object.values(yarn).flat().map(rgb);
    const img = d.getImageData(0, 0, cols, rows), px = img.data;
    const bayer = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const k = (j * cols + i) * 4, dth = (bayer[(j % 4) * 4 + (i % 4)] / 16 - .5) * 34;
        let best = 0, bd = 1e9;
        for (let q = 0; q < pal.length; q++) {
          const c = pal[q], e = (px[k] + dth - c[0]) ** 2 + (px[k + 1] + dth - c[1]) ** 2 + (px[k + 2] + dth - c[2]) ** 2;
          if (e < bd) { bd = e; best = q; }
        }
        // Each bead varies a little, and the light fades whole areas.
        const v = 1 + jit(r, .05) + fbm(n, i * .02, j * .012, 3) * .1;
        for (let c = 0; c < 3; c++) px[k + c] = clamp(pal[best][c] * v, 0, 255);
      }
    }
    d.putImageData(img, 0, 0);
    ctx.save(); ctx.imageSmoothingEnabled = false; ctx.drawImage(dc, 0, 0, W, H); ctx.restore();

    // Ribs and beads of the weave.
    const ribs = tilePattern(ctx, RW, BH * 2, x => {
      for (let b = 0; b < 2; b++) {
        const y = b * BH;
        x.fillStyle = linear(x, 0, y, 0, y + BH, [[0, rgba(WHITE, .9)], [.45, rgba(WHITE, .4)], [1, rgba(BLACK, .9)]]);
        x.beginPath(); x.roundRect(.5, y + .3, RW - 1, BH - .6, 1.6); x.fill();
      }
      x.fillStyle = rgba(BLACK, .9); x.fillRect(RW - .7, 0, .7, BH * 2);
    });
    overlay(ctx, ribs, night ? .3 : .26, 'overlay');
    // Loose fibers on the surface.
    ctx.lineWidth = .5;
    for (let i = 0; i < 2500; i++) {
      const x = r() * W, y = r() * H, a = r() * TAU, l = 3 + r() * 9;
      ctx.strokeStyle = rgba(r() < .5 ? WHITE : BLACK, .08 + r() * .1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    // The tapestry hangs in slow vertical waves.
    ctx.save(); ctx.globalCompositeOperation = 'soft-light';
    const g = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 12; i++) { const t = i / 12; g.addColorStop(t, rgba(i % 2 ? BLACK : WHITE, .22 + jit(r, .08))); }
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 700, 300, 100, 1800, [[0, WHITE], [.5, mixHex(WHITE, P.background, .3)], [1, mixHex(P.background, BLACK, .2)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 700, 300, 0, 800, [[0, rgba(P.yellow, .1)], [1, rgba(P.yellow, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .16);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- ceramic/celadon-bowl ----------

  // A body of revolution seen from a little above. prof gives R and h for t: t runs
  // from 0 at the top to 1 at the foot, R is the radius and h the height above the base.
  function lathe(ctx, cx, baseY, prof, E, light, colorAt, steps = 110) {
    const cosE = Math.sqrt(1 - E * E), view = [0, E, cosE];
    const L = light.map(v => v / Math.hypot(...light));
    const Hv = [L[0] + view[0], L[1] + view[1], L[2] + view[2]], hl = Math.hypot(...Hv), Hn = Hv.map(v => v / hl);
    const at = (p, phi) => [cx + p.R * Math.sin(phi), baseY - p.h * cosE + p.R * E * Math.cos(phi)];
    for (let i = 0; i < steps; i++) {
      const t0 = i / steps, t1 = Math.min(1, (i + 1.6) / steps), p0 = prof(t0), p1 = prof(t1);
      const dR = (p1.R - p0.R) / ((p0.h - p1.h) || 1e-3);
      const pts = [];
      for (let k = 0; k <= 24; k++) pts.push(at(p0, -Math.PI / 2 + k / 24 * Math.PI));
      for (let k = 24; k >= 0; k--) pts.push(at(p1, -Math.PI / 2 + k / 24 * Math.PI));
      const Rm = Math.max(p0.R, p1.R, 1), g = ctx.createLinearGradient(cx - Rm, 0, cx + Rm, 0);
      for (let k = 0; k <= 16; k++) {
        const phi = -Math.PI / 2 + k / 16 * Math.PI, s = Math.sin(phi), c = Math.cos(phi);
        const nl = Math.hypot(1, dR), n = [s / nl, dR / nl, c / nl];
        const diff = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
        const spec = Math.max(0, n[0] * Hn[0] + n[1] * Hn[1] + n[2] * Hn[2]);
        g.addColorStop(clamp((p0.R * s + Rm) / (2 * Rm), 0, 1), colorAt(diff, spec, t0, s, c));
      }
      ctx.fillStyle = g;
      ctx.beginPath(); poly(ctx, pts); ctx.fill();
    }
    return at;
  }

  // Crackle in the glaze: a network of cells laid on the surface. cell is the
  // size of a cell in units of arc length.
  function crackle(ctx, r, prof, at, cell, color, width, alpha, t0 = 0, t1 = 1, height = 400) {
    const maxR = Math.max(...[0, .2, .4, .6, .8, 1].map(t => prof(lerp(t0, t1, t)).R));
    const nu = Math.ceil(Math.PI * maxR / cell) + 2, nt = Math.ceil(height * (t1 - t0) / cell) + 2;
    const pts = [];
    for (let j = 0; j <= nt; j++) {
      pts.push([]);
      for (let i = 0; i <= nu; i++) pts[j].push([(i - nu / 2 + jit(r, .42)) * cell, t0 + (j + jit(r, .42)) * cell / height]);
    }
    const map = (u, t) => {
      if (t < t0 || t > t1) return null;
      const p = prof(t), phi = u / Math.max(p.R, 10);
      return Math.abs(phi) > Math.PI / 2 - .04 ? null : at(p, phi);
    };
    const edge = (a, b) => {
      const mu = (a[0] + b[0]) / 2 + jit(r, cell * .12), mt = (a[1] + b[1]) / 2 + jit(r, cell * .12) / height;
      const q = [a, [mu, mt], b].map(([u, t]) => map(u, t));
      if (q.some(v => !v)) return;
      ctx.moveTo(q[0][0], q[0][1]); ctx.lineTo(q[1][0], q[1][1]); ctx.lineTo(q[2][0], q[2][1]);
    };
    ctx.strokeStyle = rgba(color, alpha); ctx.lineWidth = width; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let j = 0; j <= nt; j++) {
      for (let i = 0; i <= nu; i++) {
        if (i < nu && r() < .92) edge(pts[j][i], pts[j][i + 1]);
        if (j < nt) { if (r() < .6) edge(pts[j][i], pts[j + 1][i]); else if (i < nu) edge(pts[j][i], pts[j + 1][i + 1]); }
      }
    }
    ctx.stroke();
  }

  scene('ceramic', 'celadon-bowl', (ctx, P, r) => {
    const night = P.night;
    const E = .3, light = [-.62, .5, .6];
    const jade = P.blue;
    const ramp = (night
      ? [mixHex(P.darker_background, jade, .25), withL(jade, .3), withL(jade, .43), withL(mixHex(jade, P.green, .3), .57), withL(mixHex(jade, P.bright_green, .5), .72)]
      : [withL(jade, .42), withL(jade, .54), withL(mixHex(jade, P.green, .3), .66), withL(mixHex(jade, P.bright_green, .4), .78), withL(mixHex(jade, P.background, .5), .9)]).map(rgb);
    const hl = rgb(night ? P.bright_foreground : WHITE);
    const toHex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
    const glaze = (diff, spec, t, s) => {
      const v = clamp(diff * .9 + .12 - t * .1 + (s > .85 ? .08 : 0), 0, 1);
      const c = rampRGB(ramp, v), sp = spec ** 40 * .85 + spec ** 7 * .14;
      return toHex(c.map((x, k) => x + (hl[k] - x) * sp));
    };

    // The studio: a sweep of paper that curves into the floor.
    ctx.fillStyle = linear(ctx, 0, 0, 0, H, night
      ? [[0, mixHex(P.darker_background, P.background, .5)], [.6, P.background], [.66, mixHex(P.background, P.lighter_background, .6)], [1, P.dark_background]]
      : [[0, mixHex(P.dark_background, P.background, .5)], [.6, P.background], [.66, mixHex(P.background, WHITE, .4)], [1, mixHex(P.background, P.dark_background, .6)]]);
    ctx.fillRect(0, 0, W, H);
    // The light falls on the backdrop from the left.
    ctx.fillStyle = radial(ctx, 700, 420, 0, 1100, night
      ? [[0, rgba(P.green, .2)], [.5, rgba(P.green, .06)], [1, rgba(P.green, 0)]]
      : [[0, rgba(WHITE, .55)], [.6, rgba(WHITE, .12)], [1, rgba(WHITE, 0)]]);
    ctx.fillRect(0, 0, W, H);
    paper(ctx, P, Math.floor(r() * 1e9), night ? .5 : .55);

    // Objects: a meiping vase with a plum branch, and a wide bowl in front.
    // The vase outline through control points of t and radius.
    const vk = [[0, 31], [.04, 31], [.08, 26], [.13, 42], [.22, 120], [.33, 172], [.45, 184], [.6, 168], [.78, 128], [.93, 98], [1, 96]];
    const vR = t => {
      let i = 0; while (i < vk.length - 2 && vk[i + 1][0] < t) i++;
      const p0 = vk[Math.max(0, i - 1)][1], p1 = vk[i][1], p2 = vk[i + 1][1], p3 = vk[Math.min(vk.length - 1, i + 2)][1];
      const u = clamp((t - vk[i][0]) / (vk[i + 1][0] - vk[i][0]), 0, 1);
      return .5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
    };
    const vase = { cx: 1560, base: 905, prof: t => ({ R: vR(t), h: 12 + 548 * (1 - t) }) };
    const bowl = { cx: 1110, base: 985, prof: t => ({ R: 90 + 200 * (1 - t) ** .7, h: 12 + 190 * (1 - t) ** 1.2 }) };

    // Shadows: contact shadows and a long soft shadow away from the light.
    soft(ctx, x => {
      x.fillStyle = BLACK;
      x.beginPath(); ellipse(x, vase.cx + 190, vase.base + 10, 260, 40, 0); x.fill();
      x.beginPath(); ellipse(x, bowl.cx + 150, bowl.base + 14, 300, 52, 0); x.fill();
    }, 40, night ? .55 : .3, 'multiply');
    soft(ctx, x => {
      x.fillStyle = BLACK;
      x.beginPath(); ellipse(x, vase.cx, vase.base, 104, 26, 0); x.fill();
      x.beginPath(); ellipse(x, bowl.cx, bowl.base, 100, 24, 0); x.fill();
    }, 8, night ? .8 : .5, 'multiply');

    // A plum branch rises from the vase, with blossoms in peach bloom.
    const mouth = [vase.cx, vase.base - 560 * Math.sqrt(1 - E * E)];
    const branch = (x, y, a, len, w, depth) => {
      const pts = [[x, y]];
      for (let s = 0; s < len; s += 18) { a += jit(r, .32); x += Math.cos(a) * 18; y += Math.sin(a) * 18; pts.push([x, y]); }
      ctx.strokeStyle = night ? shade(P.brown, .2) : P.brown; ctx.lineWidth = w; ctx.lineCap = 'round';
      ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke();
      ctx.strokeStyle = rgba(WHITE, .12); ctx.lineWidth = w * .3; ctx.beginPath(); smoothPath(ctx, pts.map(p => [p[0] - w * .2, p[1] - w * .2])); ctx.stroke();
      pts.forEach((p, i) => {
        if (i > 1 && r() < .55) {
          const bl = night ? P.magenta : withL(P.magenta, .72), rad = 7 + r() * 6;
          for (let k = 0; k < 5; k++) { ctx.fillStyle = adjust(bl, { L: jit(r, .05) }); ctx.beginPath(); circle(ctx, p[0] + Math.cos(k * TAU / 5) * rad * .55 + jit(r, 3), p[1] + Math.sin(k * TAU / 5) * rad * .55 + jit(r, 3), rad * .55); ctx.fill(); }
          ctx.fillStyle = night ? P.bright_yellow : P.orange; ctx.beginPath(); circle(ctx, p[0] + jit(r, 4), p[1] + jit(r, 4), 2); ctx.fill();
        }
        if (depth < 2 && i > 2 && r() < .18) branch(p[0], p[1], a + (r() < .5 ? -.9 : .9), len * .45, w * .6, depth + 1);
      });
    };
    branch(mouth[0] - 6, mouth[1] + 6, -Math.PI / 2 - .5, 520, 9, 0);
    branch(mouth[0] + 8, mouth[1] + 6, -Math.PI / 2 + .35, 260, 6, 1);

    // The vase.
    const vat = lathe(ctx, vase.cx, vase.base, vase.prof, E, light, glaze);
    // The bowl: first its inside, seen over the rim.
    const rim = bowl.prof(0), rimY = bowl.base - rim.h * Math.sqrt(1 - E * E);
    ctx.save();
    ctx.beginPath(); ellipse(ctx, bowl.cx, rimY, rim.R, rim.R * E, 0); ctx.clip();
    // Lit from the left, so the inside of the right wall is bright and the left wall falls into shade.
    ctx.fillStyle = linear(ctx, bowl.cx - rim.R, 0, bowl.cx + rim.R, 0, [[0, toHex(rampRGB(ramp, .18))], [.5, toHex(rampRGB(ramp, .42))], [.85, toHex(rampRGB(ramp, .7))], [1, toHex(rampRGB(ramp, .55))]]);
    ctx.fillRect(bowl.cx - rim.R, rimY - rim.R * E, rim.R * 2, rim.R * E * 2);
    // The well of the bowl, and the shade under the near rim.
    ctx.fillStyle = radial(ctx, bowl.cx + 10, rimY + rim.R * E * .25, 10, rim.R * .55, [[0, rgba(BLACK, night ? .28 : .14)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(bowl.cx - rim.R, rimY - rim.R * E, rim.R * 2, rim.R * E * 2);
    ctx.fillStyle = linear(ctx, 0, rimY + rim.R * E, 0, rimY + rim.R * E * .4, [[0, rgba(BLACK, night ? .4 : .2)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(bowl.cx - rim.R, rimY - rim.R * E, rim.R * 2, rim.R * E * 2);
    // Crackle on the inside wall, foreshortened.
    const net = (cell, col, w, a) => {
      const k = Math.ceil(rim.R * 2 / cell) + 2, g = [];
      for (let j = 0; j <= k; j++) { g.push([]); for (let i = 0; i <= k; i++) g[j].push([bowl.cx - rim.R + (i + jit(r, .4)) * cell, rimY - rim.R * E + (j + jit(r, .4)) * cell * E]); }
      ctx.strokeStyle = rgba(col, a); ctx.lineWidth = w; ctx.beginPath();
      for (let j = 0; j <= k; j++) {
        for (let i = 0; i <= k; i++) {
          const p0 = g[j][i];
          if (i < k && r() < .92) { ctx.moveTo(p0[0], p0[1]); ctx.lineTo(g[j][i + 1][0], g[j][i + 1][1]); }
          if (j < k) { const q = r() < .6 ? g[j + 1][i] : g[j + 1][Math.min(k, i + 1)]; ctx.moveTo(p0[0], p0[1]); ctx.lineTo(q[0], q[1]); }
        }
      }
      ctx.stroke();
    };
    net(46, night ? mixHex(P.darker_background, P.brown, .4) : shade(P.brown, .2), .9, night ? .45 : .4);
    net(19, night ? P.yellow : withL(P.orange, .55), .45, night ? .22 : .28);
    ctx.restore();
    const bat = lathe(ctx, bowl.cx, bowl.base, bowl.prof, E, light, glaze);

    // Crackle on the outside: a wide network of dark lines and a fine one of golden lines.
    const iron = night ? mixHex(P.darker_background, P.brown, .4) : shade(P.brown, .2), gold = night ? P.yellow : withL(P.orange, .55);
    crackle(ctx, r, vase.prof, vat, 52, iron, 1.1, night ? .5 : .45, .1, .97, 560);
    crackle(ctx, r, vase.prof, vat, 21, gold, .55, night ? .28 : .32, .1, .97, 560);
    crackle(ctx, r, bowl.prof, bat, 46, iron, 1, night ? .5 : .45, 0, .97, 260);
    crackle(ctx, r, bowl.prof, bat, 19, gold, .5, night ? .28 : .32, 0, .97, 260);

    // Rims and feet: thin glaze at the lip shows the darker body, and the feet are bare clay.
    const lip = (cx, y, R, w) => {
      ctx.strokeStyle = rgba(night ? shade(P.brown, .3) : shade(P.brown, .1), .55); ctx.lineWidth = w;
      ctx.beginPath(); ellipse(ctx, cx, y, R, R * E, 0); ctx.stroke();
      ctx.strokeStyle = rgba(night ? P.bright_green : WHITE, night ? .35 : .7); ctx.lineWidth = w * .4;
      ctx.beginPath(); ctx.ellipse(cx, y - w * .3, R, R * E, 0, Math.PI * 1.05, Math.PI * 1.75); ctx.stroke();
    };
    lip(bowl.cx, rimY, rim.R, 5);
    const vm = vase.prof(0);
    ctx.fillStyle = night ? shade(jade, .75) : shade(jade, .55); ctx.beginPath(); ellipse(ctx, vase.cx, vase.base - vm.h * Math.sqrt(1 - E * E), vm.R - 4, (vm.R - 4) * E, 0); ctx.fill();
    lip(vase.cx, vase.base - vm.h * Math.sqrt(1 - E * E), vm.R, 4);
    // Bare clay feet under the glaze.
    [[vase, 90], [bowl, 84]].forEach(([o, R]) => {
      const top = o.base - 13 * Math.sqrt(1 - E * E), clay = night ? mixHex(P.brown, P.darker_background, .3) : P.brown;
      ctx.fillStyle = linear(ctx, o.cx - R, 0, o.cx + R, 0, [[0, tint(clay, .15)], [.5, clay], [1, shade(clay, .5)]]);
      ctx.beginPath(); ctx.ellipse(o.cx, o.base, R, R * E, 0, 0, Math.PI); ctx.lineTo(o.cx - R, top); ctx.ellipse(o.cx, top, R, R * E, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
    });

    // A soft reflection of the window on the glaze.
    soft(ctx, x => {
      x.strokeStyle = WHITE; x.lineCap = 'round';
      [[vase, vat, .24, .7, -.62, 22], [bowl, bat, .08, .55, -.78, 16]].forEach(([o, at, ta, tb, phi, w]) => {
        x.lineWidth = w; x.beginPath();
        for (let t = ta; t <= tb; t += .02) { const [px, py] = at(o.prof(t), phi); if (t === ta) x.moveTo(px, py); else x.lineTo(px, py); }
        x.stroke();
      });
    }, 6, night ? .22 : .45, 'screen');

    if (night) {
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, 1250, 560, 150, 1500, [[0, WHITE], [.45, mixHex(WHITE, P.background, .25)], [1, mixHex(P.background, BLACK, .3)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .16);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

  // ---------- ceramic/terracotta-pots ----------

  scene('ceramic', 'terracotta-pots', (ctx, P, r) => {
    const night = P.night;
    const E = .24, cosE = Math.sqrt(1 - E * E);
    const clay = night ? withL(P.blue, .52) : withL(P.blue, .62);
    const clays = [clay, adjust(clay, { L: -.04, h: -6 }), adjust(clay, { L: .03, h: 5 }), mixHex(clay, P.red, .3)];
    const groundY = 820, wallTop = 150;
    // At night a lantern stands on the gravel. In the day the sun is high on the left.
    const lantern = [1040, 1000];

    // Sky above the wall.
    skyGradient(ctx, night
      ? [[0, shade(P.cyan, .78)], [.1, shade(P.cyan, .55)], [.17, mixHex(shade(P.magenta, .3), P.cyan, .5)]]
      : [[0, tint(P.cyan, .45)], [.15, tint(P.cyan, .72)]], 0, wallTop + 20);
    if (night) stars(ctx, r, 60, [0, 0, W, wallTop - 30], [P.bright_foreground, P.bright_cyan], 1.5);
    const bulbs = [];
    // The plastered wall.
    const plaster = night ? withL(mixHex(P.cyan, P.foreground, .5), .4) : mixHex(P.background, P.bright_yellow, .12);
    ctx.fillStyle = linear(ctx, 0, wallTop, 0, groundY, [[0, plaster], [1, adjust(plaster, { L: -.07 })]]);
    ctx.fillRect(0, wallTop, W, groundY - wallTop);
    paper(ctx, P, Math.floor(r() * 1e9), 1.3);
    // Damp rises at the foot of the wall, and hairline cracks run through the plaster.
    ctx.fillStyle = linear(ctx, 0, groundY - 160, 0, groundY, [[0, rgba(P.brown, 0)], [1, rgba(night ? BLACK : P.brown, night ? .3 : .16)]]);
    ctx.fillRect(0, groundY - 160, W, 160);
    ctx.strokeStyle = rgba(night ? BLACK : P.brown, night ? .35 : .22); ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      let x = 100 + r() * 1700, y = wallTop + 20 + r() * 380, a = Math.PI / 2 + jit(r, .5);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = 0; k < 6 + r() * 8; k++) { a += jit(r, .35); x += Math.cos(a) * (10 + r() * 14); y += Math.sin(a) * (10 + r() * 14); ctx.lineTo(x, y); }
      ctx.stroke();
    }
    for (let x = -20; x < W; x += 120 + jit(r, 10)) {
      const c = adjust(night ? withL(P.muted, .34) : mixHex(P.muted, P.background, .45), { L: jit(r, .03) });
      ctx.fillStyle = linear(ctx, 0, wallTop - 24, 0, wallTop + 6, [[0, tint(c, .15)], [1, shade(c, .2)]]);
      ctx.beginPath(); ctx.roundRect(x, wallTop - 24, 118, 32, 4); ctx.fill();
    }
    ctx.fillStyle = linear(ctx, 0, wallTop + 8, 0, wallTop + 40, [[0, rgba(BLACK, night ? .4 : .25)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(0, wallTop + 8, W, 32);
    // At night a string of small bulbs hangs along the wall.
    if (night) {
      ctx.strokeStyle = rgba(BLACK, .7); ctx.lineWidth = 1.6; ctx.beginPath();
      for (let k = 0; k < 6; k++) {
        const x0 = -60 + k * 380, x1 = x0 + 380, sag = 46 + r() * 16;
        ctx.moveTo(x0, wallTop + 14); ctx.quadraticCurveTo((x0 + x1) / 2, wallTop + 14 + sag * 2, x1, wallTop + 14);
        for (let j = 1; j < 6; j++) { const t = j / 6, bx = lerp(x0, x1, t), by = wallTop + 14 + 4 * sag * t * (1 - t) + 10; bulbs.push([bx, by]); }
      }
      ctx.stroke();
      bulbs.forEach(([bx, by]) => {
        ctx.fillStyle = shade(P.brown, .5); ctx.fillRect(bx - 3, by - 12, 6, 7);
        ctx.fillStyle = radial(ctx, bx, by, 1, 9, [[0, P.bright_yellow], [.6, P.yellow], [1, P.orange]]);
        ctx.beginPath(); ellipse(ctx, bx, by, 6, 8, 0); ctx.fill();
      });
    }

    // Gravel.
    ctx.fillStyle = linear(ctx, 0, groundY, 0, H, night
      ? [[0, withL(mixHex(P.yellow, P.cyan, .3), .3)], [1, withL(mixHex(P.yellow, P.cyan, .3), .22)]]
      : [[0, withL(mixHex(P.yellow, P.background, .5), .83)], [1, withL(mixHex(P.yellow, P.background, .4), .75)]]);
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = linear(ctx, 0, groundY - 6, 0, groundY + 30, [[0, rgba(BLACK, night ? .5 : .3)], [1, rgba(BLACK, 0)]]);
    ctx.fillRect(0, groundY - 6, W, 36);
    for (let i = 0; i < 5200; i++) {
      const y = groundY + 4 + r() ** .8 * (H - groundY), k = (y - groundY) / (H - groundY), s = 1.2 + k * 4.5 * r();
      const c = adjust(night ? withL(pick(r, [P.yellow, P.muted, P.foreground]), .34) : withL(pick(r, [P.yellow, P.muted, P.foreground]), .78), { L: jit(r, .08) });
      ctx.fillStyle = c; ctx.beginPath(); ellipse(ctx, r() * W, y, s, s * .6, jit(r, .4)); ctx.fill();
    }
    // Dry grass at the foot of the wall.
    ctx.lineCap = 'round';
    for (let t = 0; t < 26; t++) {
      const gx = r() * W, gy = groundY + 6 + r() * 20;
      for (let i = 0; i < 18; i++) {
        const a = -Math.PI / 2 + jit(r, .7), l = 30 + r() * 60;
        ctx.strokeStyle = adjust(night ? withL(P.yellow, .45) : withL(P.yellow, .7), { L: jit(r, .08) }); ctx.lineWidth = 1.3;
        ctx.beginPath(); ctx.moveTo(gx, gy); ctx.quadraticCurveTo(gx + Math.cos(a) * l * .5, gy + Math.sin(a) * l * .5, gx + Math.cos(a + jit(r, .4)) * l, gy + Math.sin(a) * l); ctx.stroke();
      }
    }

    // The pots: x, base, height, top and bottom radius, upright or turned over.
    const pots = [];
    for (let i = 0; i < 5; i++) pots.push({ x: 330 + jit(r, 3), base: 900 - i * 34, h: 230, rt: 150, rb: 96, nest: i > 0 });
    for (let i = 0; i < 3; i++) pots.push({ x: 128 + jit(r, 3), base: 930 - i * 68, h: 110, rt: 80, rb: 52, up: false });
    pots.push({ x: 1460, base: 920, h: 330, rt: 168, rb: 112, soil: 'agave' });
    pots.push({ x: 1730, base: 905, h: 210, rt: 128, rb: 88, soil: 'rosemary' });
    pots.push({ x: 1240, base: 965, h: 96, rt: 150, rb: 120, soil: 'succulents' });
    const outline = (x, o) => {
      const top = o.base - o.h * cosE;
      x.moveTo(o.x - o.rt * 1.07, top); x.lineTo(o.x + o.rt * 1.07, top); x.lineTo(o.x + o.rb, o.base); x.lineTo(o.x - o.rb, o.base); x.closePath();
    };

    // Shadows. In the day the sun throws them to the right, onto the gravel and up the wall.
    if (!night) {
      soft(ctx, x => {
        x.fillStyle = BLACK;
        pots.forEach(o => {
          x.save(); x.translate(o.x, o.base); x.transform(1, 0, .55, .35, 0, 0); x.translate(-o.x, -o.base);
          x.beginPath(); outline(x, o); x.fill(); x.restore();
          // Where the shade reaches the wall it climbs it, in the shape of the pot.
          const wallH = o.h * cosE * .8 - (o.base - groundY) * .6;
          if (wallH > 0) {
            const sx = o.x + 60 + o.h * .3;
            x.beginPath(); x.moveTo(sx - o.rb, groundY + 2); x.lineTo(sx - o.rt * 1.07, groundY - wallH); x.lineTo(sx + o.rt * 1.07, groundY - wallH); x.lineTo(sx + o.rb, groundY + 2); x.closePath(); x.fill();
          }
        });
        x.beginPath(); ellipse(x, 1460 + 200, groundY - 330, 170, 120, 0); x.fill();
        x.beginPath(); ellipse(x, 1730 + 170, groundY - 170, 120, 100, 0); x.fill();
      }, 8, .3, 'multiply');
      // An olive tree out of the frame throws its shade on the wall.
      soft(ctx, x => {
        x.fillStyle = BLACK; x.strokeStyle = BLACK; x.lineCap = 'round';
        const twig = (bx, by, a, len, w, depth) => {
          let px = bx, py = by;
          for (let s2 = 0; s2 < len; s2 += 16) {
            a += jit(r, .25); const nx = px + Math.cos(a) * 16, ny = py + Math.sin(a) * 16;
            x.lineWidth = w; x.beginPath(); x.moveTo(px, py); x.lineTo(nx, ny); x.stroke(); px = nx; py = ny;
            for (let k = 0; k < 2; k++) { x.beginPath(); leaf(x, px, py, 26 + r() * 14, 5, a + (k ? 1 : -1) * (.6 + r() * .5)); x.fill(); }
            if (depth < 2 && r() < .14) twig(px, py, a + jit(r, 1), len * .5, w * .6, depth + 1);
          }
        };
        twig(W + 40, 110, Math.PI * .84, 1000, 7, 0);
        twig(W + 40, 330, Math.PI * .92, 650, 5, 1);
      }, 6, .26, 'multiply', 20, 30);
    } else {
      soft(ctx, x => {
        x.fillStyle = BLACK;
        pots.forEach(o => { const dir = Math.sign(o.x - lantern[0]) || 1; x.beginPath(); ellipse(x, o.x + dir * o.rb * .9, o.base + 6, o.rb * 2.2, o.rb * .35, 0); x.fill(); });
      }, 16, .55, 'multiply');
    }

    // Draws one pot. The light side faces the sun, or the lantern at night.
    const draw = o => {
      const { x, base, h, rt, rb } = o, up = o.up !== false, c = o.c, rimH = h * .17, rr = rt * 1.07;
      const top = base - h * cosE, body = new Path2D(), rim = new Path2D();
      if (up) {
        const y1 = top + rimH;
        body.moveTo(x - rt, y1); body.lineTo(x - rb, base); body.ellipse(x, base, rb, rb * E, 0, Math.PI, 0, true); body.lineTo(x + rt, y1); body.ellipse(x, y1, rt, rt * E, 0, 0, Math.PI); body.closePath();
        rim.moveTo(x - rr, top); rim.lineTo(x - rr, y1); rim.ellipse(x, y1, rr, rr * E, 0, Math.PI, 0, true); rim.lineTo(x + rr, top); rim.ellipse(x, top, rr, rr * E, 0, 0, Math.PI); rim.closePath();
      } else {
        const yb = base - rimH;
        body.moveTo(x - rb, top); body.lineTo(x - rt, yb); body.ellipse(x, yb, rt, rt * E, 0, Math.PI, 0, true); body.lineTo(x + rb, top); body.ellipse(x, top, rb, rb * E, 0, 0, Math.PI, true); body.closePath();
        rim.moveTo(x - rr, yb); rim.lineTo(x - rr, base); rim.ellipse(x, base, rr, rr * E, 0, Math.PI, 0, true); rim.lineTo(x + rr, yb); rim.ellipse(x, yb, rr, rr * E, 0, 0, Math.PI); rim.closePath();
      }
      const fromRight = night && x < lantern[0];
      const side = (w, cc) => {
        const st = [[0, shade(cc, .42)], [.14, tint(cc, .2)], [.3, tint(cc, .06)], [.7, shade(cc, .3)], [1, shade(cc, .6)]];
        return linear(ctx, fromRight ? x + w : x - w, 0, fromRight ? x - w : x + w, 0, st);
      };
      ctx.fillStyle = side(rt, c); ctx.fill(body);
      ctx.fillStyle = side(rr, adjust(c, { L: .02 })); ctx.fill(rim);
      ctx.save(); ctx.clip(body);
      for (let i = 0; i < h * 1.2; i++) { ctx.fillStyle = rgba(r() < .6 ? BLACK : WHITE, .08 + r() * .14); ctx.beginPath(); circle(ctx, x + jit(r, rt), top + r() * h, .5 + r() * 1.5); ctx.fill(); }
      // White mineral bloom where water dried, and a little moss at the foot.
      const by = up ? base - h * (.1 + r() * .3) : top + h * .3;
      ctx.fillStyle = radial(ctx, x + jit(r, rt * .4), by, 0, rt * 1.1, [[0, rgba(night ? P.foreground : WHITE, .3)], [1, rgba(WHITE, 0)]]);
      ctx.fillRect(x - rt * 1.5, top, rt * 3, h * 1.2);
      if (up && r() < .6) { ctx.fillStyle = linear(ctx, 0, base - h * .25, 0, base, [[0, rgba(P.green, 0)], [1, rgba(shade(P.green, .3), .45)]]); ctx.fillRect(x - rt * 1.5, base - h * .3, rt * 3, h * .35); }
      if (up) { ctx.fillStyle = linear(ctx, 0, top + rimH, 0, top + rimH + h * .12, [[0, rgba(BLACK, .4)], [1, rgba(BLACK, 0)]]); ctx.fillRect(x - rt * 1.5, top, rt * 3, h * .4); }
      ctx.restore();
      ctx.save(); ctx.clip(rim);
      for (let i = 0; i < 30; i++) { ctx.fillStyle = rgba(r() < .6 ? BLACK : WHITE, .08 + r() * .12); ctx.beginPath(); circle(ctx, x + jit(r, rr), (up ? top : base - rimH) + r() * rimH, .5 + r() * 1.3); ctx.fill(); }
      ctx.restore();
      o.top = top; o.rr = rr;
      if (up && !o.covered) {
        const inner = rr * .88;
        ctx.fillStyle = o.soil ? (night ? shade(P.brown, .5) : shade(P.brown, .1)) : shade(c, .6);
        ctx.beginPath(); ellipse(ctx, x, top, inner, inner * E, 0); ctx.fill();
        if (!o.soil) { ctx.fillStyle = linear(ctx, x - inner, 0, x + inner, 0, [[0, rgba(BLACK, .4)], [.6, rgba(BLACK, .1)], [1, rgba(c, .5)]]); ctx.fill(); }
        ctx.strokeStyle = rgba(tint(c, .3), .7); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(x, top, rr - 4, (rr - 4) * E, 0, Math.PI * .95, Math.PI * 2.05); ctx.stroke();
      }
    };
    pots.forEach(o => { o.c = pick(r, clays); });
    // The nested stack: each pot sits in the one below, so the lower rim hides its foot.
    let lower = null;
    pots.forEach((o, i) => {
      if (o.nest && lower) {
        const clip = new Path2D(); clip.rect(0, 0, W, lower.top); clip.ellipse(lower.x, lower.top, lower.rr * .88, lower.rr * .88 * E, 0, 0, TAU);
        ctx.save(); ctx.clip(clip); draw(o); ctx.restore();
      } else draw(o);
      if (i < 5) { if (pots[i + 1] && pots[i + 1].nest) o.covered = true; lower = o; }
    });

    // The plants.
    const green = night ? withL(mixHex(P.green, P.cyan, .45), .44) : withL(mixHex(P.green, P.cyan, .45), .58);
    const tall = pots.find(o => o.soil === 'agave'), mid = pots.find(o => o.soil === 'rosemary'), low = pots.find(o => o.soil === 'succulents');
    const leaves = [];
    for (let i = 0; i < 17; i++) { const a = -Math.PI / 2 + jit(r, 1.35), len = 170 + r() * 150; leaves.push([a, len]); }
    leaves.sort((a, b) => Math.abs(b[0] + Math.PI / 2) - Math.abs(a[0] + Math.PI / 2));
    leaves.forEach(([a, len]) => {
      const bx = tall.x + jit(r, 20), by = tall.top - 4, tx = bx + Math.cos(a) * len, ty = by + Math.sin(a) * len * .9 + (Math.abs(Math.cos(a)) > .7 ? len * .25 : 0);
      const w = 22 + r() * 8, nx = -Math.sin(a), ny = Math.cos(a), c = adjust(green, { L: jit(r, .05) });
      ctx.fillStyle = linear(ctx, bx + nx * w, by + ny * w, bx - nx * w, by - ny * w, [[0, tint(c, .2)], [.5, c], [1, shade(c, .35)]]);
      ctx.beginPath(); ctx.moveTo(bx + nx * w, by + ny * w);
      ctx.quadraticCurveTo((bx + tx) / 2 + nx * w * .7, (by + ty) / 2 + ny * w * .7, tx, ty);
      ctx.quadraticCurveTo((bx + tx) / 2 - nx * w * .7, (by + ty) / 2 - ny * w * .7, bx - nx * w, by - ny * w); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rgba(night ? P.bright_yellow : P.yellow, .5); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(bx + nx * w * .9, by + ny * w * .9); ctx.quadraticCurveTo((bx + tx) / 2 + nx * w * .65, (by + ty) / 2 + ny * w * .65, tx, ty); ctx.stroke();
      ctx.strokeStyle = shade(P.brown, .2); ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + Math.cos(a) * 9, ty + Math.sin(a) * 9); ctx.stroke();
    });
    for (let i = 0; i < 46; i++) {
      const a = -Math.PI / 2 + jit(r, 1.1), len = 80 + r() * 150, bx = mid.x + jit(r, 70), by = mid.top, pts = [[bx, by]];
      let px = bx, py = by, d = a;
      for (let s = 0; s < len; s += 14) { d += jit(r, .2); px += Math.cos(d) * 14; py += Math.sin(d) * 14; pts.push([px, py]); }
      ctx.strokeStyle = night ? shade(P.brown, .3) : P.brown; ctx.lineWidth = 1.6; ctx.beginPath(); smoothPath(ctx, pts); ctx.stroke();
      pts.forEach(([qx, qy], k) => {
        if (k === 0) return;
        for (let j = 0; j < 4; j++) {
          const na = d + (j % 2 ? 1 : -1) * (.7 + r() * .5);
          ctx.strokeStyle = adjust(night ? withL(P.green, .38) : withL(P.green, .45), { L: jit(r, .06) }); ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(qx, qy); ctx.lineTo(qx + Math.cos(na) * 11, qy + Math.sin(na) * 11); ctx.stroke();
        }
        if (r() < .12) { ctx.fillStyle = night ? P.bright_cyan : withL(P.cyan, .7); ctx.beginPath(); circle(ctx, qx + jit(r, 5), qy + jit(r, 5), 2.6); ctx.fill(); }
      });
    }
    [[-60, -2], [22, 8], [80, -6], [-15, 16], [52, 18]].forEach(([dx, dy]) => {
      const sx = low.x + dx, sy = low.top + dy - 8, R = 34 + r() * 14;
      for (let ring = 3; ring >= 0; ring--) {
        const k = 6 + ring * 2, rad = R * (.35 + ring * .22);
        for (let i = 0; i < k; i++) {
          const a = i / k * TAU + ring * .4, c = adjust(green, { L: .04 - ring * .02 + jit(r, .03) });
          ctx.fillStyle = linear(ctx, sx, sy, sx + Math.cos(a) * rad, sy + Math.sin(a) * rad * .55, [[0, tint(c, .15)], [.75, c], [1, mixHex(c, P.magenta, .55)]]);
          ctx.beginPath(); petal(ctx, sx, sy, rad, rad * .32, Math.atan2(Math.sin(a) * .55, Math.cos(a)), .55, .3); ctx.fill();
        }
      }
    });

    // Light.
    if (night) {
      const [lx, ly] = lantern;
      // A lantern of iron and glass with a candle inside.
      const iron = shade(P.brown, .55);
      ctx.fillStyle = rgba(BLACK, .5); ctx.beginPath(); ellipse(ctx, lx, ly + 4, 52, 11, 0); ctx.fill();
      ctx.save(); ctx.translate(lx, ly); ctx.scale(1.35, 1.35); ctx.translate(-lx, -ly);
      ctx.fillStyle = radial(ctx, lx, ly - 40, 2, 34, [[0, P.bright_yellow], [.35, P.yellow], [1, shade(P.orange, .2)]]);
      ctx.fillRect(lx - 24, ly - 78, 48, 70);
      ctx.fillStyle = iron;
      ctx.fillRect(lx - 30, ly - 10, 60, 10); ctx.fillRect(lx - 27, ly - 84, 54, 8);
      ctx.beginPath(); poly(ctx, [[lx - 22, ly - 84], [lx + 22, ly - 84], [lx + 8, ly - 104], [lx - 8, ly - 104]]); ctx.fill();
      [-26, -2, 22].forEach(dx => ctx.fillRect(lx + dx, ly - 80, 4, 72));
      ctx.strokeStyle = iron; ctx.lineWidth = 3.5; ctx.beginPath(); ctx.arc(lx, ly - 110, 11, Math.PI * .1, Math.PI * .9, true); ctx.stroke();
      ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = radial(ctx, lx, ly - 40, 60, 1900, [[0, WHITE], [.25, mixHex(WHITE, P.orange, .25)], [.6, mixHex(P.cyan, P.foreground, .4)], [1, mixHex(P.cyan, P.background, .55)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, lx, ly - 40, 0, 760, [[0, rgba(P.orange, .4)], [.35, rgba(P.orange, .14)], [1, rgba(P.orange, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
      soft(ctx, x => { x.fillStyle = P.yellow; x.fillRect(lx - 32, ly - 105, 64, 95); }, 60, .6, 'lighter');
      soft(ctx, x => { x.fillStyle = P.bright_yellow; x.beginPath(); ellipse(x, lx, ly - 60, 8, 16, 0); x.fill(); }, 9, .9, 'lighter');
      soft(ctx, x => { x.fillStyle = P.yellow; bulbs.forEach(([bx, by]) => { x.beginPath(); circle(x, bx, by, 16); x.fill(); }); }, 22, .7, 'lighter');
      soft(ctx, x => { x.fillStyle = P.orange; bulbs.forEach(([bx, by]) => { x.beginPath(); ellipse(x, bx, by + 60, 70, 90, 0); x.fill(); }); }, 60, .18, 'lighter');
    } else {
      ctx.save(); ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = radial(ctx, 300, 0, 0, 1700, [[0, rgba(tint(P.yellow, .7), .35)], [1, rgba(P.yellow, 0)]]);
      ctx.fillRect(0, 0, W, H); ctx.restore();
    }
    vignette(ctx, P, night ? .5 : .16);
    grain(ctx, Math.floor(r() * 1e9), night ? .045 : .035);
  });

})();
