// Drawing helpers for the backgrounds. tools/render.html loads this file
// first, then every file in tools/scenes/. All drawing uses a logical canvas
// of 1920x1080 units. The renderer scales it to the output size, so a preview
// and a 6K render show the same picture.
//
// Globals:
//   W, H        logical size, 1920 and 1080
//   S           output pixels per logical unit, for pixel-based effects
//   SCENES      the scene registry, filled by scene() calls
//   LOGO        the paths of the Omarchy wordmark, 1215x285 units

/* exported W H S SCENES LOGO scene rng hashSeed rgb rgba mixHex oklch toOklch adjust withL readable
   makeNoise fbm layer blurPx bloom vignette grain paper smoothPath poly circle ellipse
   linear radial skyGradient ridgePoints fillRidge petal leaf drawLogo logoBox stars clamp lerp smooth fit */

const W = 1920, H = 1080;
let S = 1;
const SCENES = {};
let LOGO = [];

// Registers a scene. motif and variant match the scene field of the theme
// table, for example scene('garden', 'poppy', fn). fn(ctx, P, r) draws the
// whole picture in logical units: P is the palette, r a seeded random number
// generator.
function scene(motif, variant, fn) { SCENES[`${motif}/${variant}`] = fn; }

// ---------- numbers ----------

function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
// Maps v from [a, b] to [c, d].
const fit = (v, a, b, c, d) => c + (d - c) * clamp((v - a) / (b - a), 0, 1);

// ---------- color ----------

function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
function rgba(hex, a) { const [r, g, b] = rgb(hex); return `rgba(${r},${g},${b},${a})`; }
// Mix in sRGB, like Omarchy does. t = 0 gives a, t = 1 gives b.
function mixHex(a, b, t) {
  const pa = rgb(a), pb = rgb(b);
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function lin(L, C, h) {
  h *= Math.PI / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + .2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s, -.0041960863 * l - .7034186147 * m + 1.707614701 * s];
}
// OKLCH to hex. Chroma drops until the color fits in sRGB.
function oklch(L, C, h) {
  L = clamp(L, 0, 1);
  let c = Math.max(0, C), v = lin(L, c, h);
  while (c > 0 && v.some(x => x < -.0005 || x > 1.0005)) { c = Math.max(0, c - .003); v = lin(L, c, h); }
  return '#' + v.map(x => { x = clamp(x, 0, 1); x = x <= .0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - .055; return Math.round(x * 255).toString(16).padStart(2, '0'); }).join('');
}
function toOklch(hex) {
  const [r, g, b] = rgb(hex).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .7936177850 * m - .0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
  const B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360 };
}
// Changes a color in OKLCH. Each field is added: adjust(hex, { L: .1 }) is lighter.
function adjust(hex, { L = 0, C = 0, h = 0, Cx = 1 } = {}) {
  const o = toOklch(hex);
  return oklch(o.L + L, Math.max(0, o.C * Cx + C), o.h + h);
}
// The same hue and chroma at another OKLCH lightness.
function withL(hex, L) { const o = toOklch(hex); return oklch(L, o.C, o.h); }
// Black or white, whichever reads better on the color.
function readable(hex) { return toOklch(hex).L > .62 ? '#000000' : '#ffffff'; }

// ---------- noise ----------

// 2D gradient noise in [-1, 1].
function makeNoise(seed) {
  const r = rng(seed), p = new Uint8Array(512), g = [];
  const perm = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
  for (let i = 0; i < 512; i++) p[i] = perm[i & 255];
  for (let i = 0; i < 256; i++) { const a = r() * Math.PI * 2; g.push([Math.cos(a), Math.sin(a)]); }
  const dot = (ix, iy, x, y) => { const v = g[p[p[ix & 255] + (iy & 255)]]; return v[0] * (x - ix) + v[1] * (y - iy); };
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), sx = fade(x - x0), sy = fade(y - y0);
    const a = lerp(dot(x0, y0, x, y), dot(x0 + 1, y0, x, y), sx);
    const b = lerp(dot(x0, y0 + 1, x, y), dot(x0 + 1, y0 + 1, x, y), sx);
    return lerp(a, b, sy) * 1.414;
  };
}
// Fractal noise: octaves of noise, each at twice the frequency and half the amplitude.
function fbm(n, x, y, octaves = 4) {
  let v = 0, a = .5, f = 1;
  for (let i = 0; i < octaves; i++) { v += a * n(x * f, y * f); f *= 2; a *= .5; }
  return v;
}

// ---------- canvas ----------

// An offscreen canvas at output resolution with the logical transform applied.
function layer() {
  const c = document.createElement('canvas');
  c.width = Math.round(W * S); c.height = Math.round(H * S);
  const x = c.getContext('2d');
  x.scale(S, S);
  return [c, x];
}
// A blur filter in logical units.
function blurPx(px) { return `blur(${(px * S).toFixed(2)}px)`; }
// Draws the shapes of draw(ctx) blurred on top, for a glow.
function bloom(ctx, draw, radii = [60, 18], strength = [.7, .8]) {
  const [c, x] = layer();
  draw(x);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  radii.forEach((rad, i) => { ctx.globalAlpha = strength[i]; ctx.filter = blurPx(rad); ctx.drawImage(c, 0, 0); });
  ctx.restore();
}
// Darkens or lightens the edges toward the background.
function vignette(ctx, P, amount = .45) {
  const g = ctx.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, W * .72);
  const edge = P.night ? '#000000' : P.darker_background;
  g.addColorStop(0, rgba(edge, 0));
  g.addColorStop(1, rgba(edge, amount));
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
// Film grain. A tile of noise at output resolution, laid over the picture.
function grain(ctx, seed, alpha = .045) {
  const size = 512, c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d'), img = x.createImageData(size, size), r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
  x.putImageData(img, 0, 0);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = ctx.createPattern(c, 'repeat');
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
}
// A soft paper or plaster texture: low-frequency blotches and fine fibers.
function paper(ctx, P, seed, strength = 1) {
  const n = makeNoise(seed), cols = 240, rows = 135, c = document.createElement('canvas');
  c.width = cols; c.height = rows;
  const x = c.getContext('2d'), img = x.createImageData(cols, rows);
  const dark = P.night ? '#000000' : P.darker_background, [dr, dg, db] = rgb(dark);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const v = fbm(n, i / 40, j / 40, 5), k = (j * cols + i) * 4;
    img.data[k] = dr; img.data[k + 1] = dg; img.data[k + 2] = db;
    img.data[k + 3] = clamp((v * .5 + .5) * 70 * strength, 0, 255);
  }
  x.putImageData(img, 0, 0);
  ctx.save();
  ctx.imageSmoothingQuality = 'high';
  ctx.globalAlpha = P.night ? .55 : .35;
  ctx.drawImage(c, 0, 0, W, H);
  ctx.restore();
}

// ---------- shapes ----------

// A smooth curve through the points, as Catmull-Rom splines.
function smoothPath(ctx, pts, closed = false, tension = .5) {
  if (pts.length < 2) return;
  const p = closed ? [pts[pts.length - 1], ...pts, pts[0], pts[1]] : [pts[0], ...pts, pts[pts.length - 1]];
  ctx.moveTo(p[1][0], p[1][1]);
  for (let i = 1; i < p.length - 2; i++) {
    const [x0, y0] = p[i - 1], [x1, y1] = p[i], [x2, y2] = p[i + 1], [x3, y3] = p[i + 2];
    const t = tension / 3;
    ctx.bezierCurveTo(x1 + (x2 - x0) * t, y1 + (y2 - y0) * t, x2 - (x3 - x1) * t, y2 - (y3 - y1) * t, x2, y2);
  }
  if (closed) ctx.closePath();
}
function poly(ctx, pts) { ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.closePath(); }
function circle(ctx, x, y, r) { ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); }
function ellipse(ctx, x, y, rx, ry, rot = 0) { ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot)); ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); }
function linear(ctx, x0, y0, x1, y1, stops) { const g = ctx.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
function radial(ctx, x, y, r0, r1, stops) { const g = ctx.createRadialGradient(x, y, r0, x, y, r1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }
// Fills the canvas with a vertical gradient.
function skyGradient(ctx, stops, y0 = 0, y1 = H) { ctx.fillStyle = linear(ctx, 0, y0, 0, y1, stops); ctx.fillRect(0, 0, W, H); }
// Points of a ridge line from fractal noise, left to right.
function ridgePoints(n, base, amp, freq, seedShift = 0, step = 8, octaves = 5) {
  const pts = [];
  for (let x = -20; x <= W + 20; x += step) pts.push([x, base - (fbm(n, x * freq + seedShift, seedShift * .37, octaves) * .5 + .5) * amp]);
  return pts;
}
// Fills the area below a ridge.
function fillRidge(ctx, pts, fill) {
  ctx.beginPath(); ctx.moveTo(pts[0][0], H + 10);
  pts.forEach(p => ctx.lineTo(p[0], p[1]));
  ctx.lineTo(pts[pts.length - 1][0], H + 10); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
}
// A petal from (x, y) along angle a: length len, widest width wid at the
// fraction belly of its length.
function petal(ctx, x, y, len, wid, a, belly = .55, tip = 0) {
  const cos = Math.cos(a), sin = Math.sin(a);
  const at = (u, v) => [x + cos * u - sin * v, y + sin * u + cos * v];
  const [bx, by] = at(len * belly, 0);
  const [tx, ty] = at(len, 0);
  const l1 = at(len * belly * .45, -wid * .9), l2 = at(len * (belly + (1 - belly) * .55), -wid * (.95 - tip));
  const r1 = at(len * belly * .45, wid * .9), r2 = at(len * (belly + (1 - belly) * .55), wid * (.95 - tip));
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(l1[0], l1[1], l2[0], l2[1], tx, ty);
  ctx.bezierCurveTo(r2[0], r2[1], r1[0], r1[1], x, y);
  void bx; void by;
}
// A leaf with a pointed tip, as petal() with a sharper tip.
function leaf(ctx, x, y, len, wid, a) { petal(ctx, x, y, len, wid, a, .45, .55); }

// ---------- the Omarchy wordmark ----------

function setLogo(paths) { LOGO = paths.map(p => ({ path: new Path2D(p.d), rule: p.evenodd ? 'evenodd' : 'nonzero' })); }
// Draws the wordmark with its top left corner at (x, y), scale times its size of 1215x285.
function drawLogo(ctx, x, y, scale, fill) {
  ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  LOGO.forEach(p => ctx.fill(p.path, p.rule));
  ctx.restore();
}
// The box of a wordmark of width w centered at (cx, cy).
function logoBox(cx, cy, w) { const scale = w / 1215, h = 285 * scale; return { x: cx - w / 2, y: cy - h / 2, w, h, scale }; }

// Stars: count dots, brighter ones larger.
function stars(ctx, r, count, area, colors, maxSize = 2.4) {
  const [x0, y0, x1, y1] = area;
  for (let i = 0; i < count; i++) {
    const b = r() ** 3, x = lerp(x0, x1, r()), y = lerp(y0, y1, r());
    ctx.globalAlpha = .25 + b * .75;
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.beginPath(); circle(ctx, x, y, .4 + b * maxSize); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
