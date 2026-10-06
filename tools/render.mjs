// Renders the backgrounds of each theme variant with headless Chromium.
// tools/render.html draws them on a canvas:
//
//   <theme>/<variant>/backgrounds/0-omarchy-wordmark.jpg   the Omarchy wordmark
//   <theme>/<variant>/backgrounds/1-<scene>.jpg            a picture of the theme subject
//   <theme>/<variant>/backgrounds/2-palette-card.jpg       the slots and ramps
//
//   node tools/render.mjs                          render all themes and variants
//   node tools/render.mjs kyoto-moss fjord         render the named themes
//   KINDS=wordmark node tools/render.mjs           render only these kinds: wordmark, scene, card
//   VARIANTS=day node tools/render.mjs             render only these variants
//   MOTIF=garden node tools/render.mjs             render only the themes with this motif
//   PREVIEW=1 OUT=/tmp/x node tools/render.mjs fjord
//                                                  write small JPEGs to $OUT
//   SIZE=3840x2160 node tools/render.mjs           render at another 16:9 size
//
// Needs `chromium` and `magick` on PATH.

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { themes, VARIANTS, PATTERNS, SLOTS, SLOT_HUES, contrast, colorName, hexOklch } from './palettes.mjs';
import { launch, logoPaths } from './cdp.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PREVIEW = !!process.env.PREVIEW;
const OUT = process.env.OUT || ROOT;
const WORKERS = Number(process.env.WORKERS || 4);
const LOGO_SVG = process.env.LOGO_SVG || '/usr/share/omarchy/logo.svg';
// Output size. 6144x3456 is 6K at 16:9.
const SIZE = (process.env.SIZE || (PREVIEW ? '960x540' : '6144x3456')).split('x').map(Number);
const ONLY = process.env.VARIANTS ? process.env.VARIANTS.split(',') : VARIANTS.map(v => v.key);
const KINDS = process.env.KINDS ? process.env.KINDS.split(',') : ['wordmark', 'scene', 'card'];

export const fileOf = (t, kind) => kind === 'wordmark' ? '0-omarchy-wordmark' : kind === 'scene' ? `1-${t.scene}` : '2-palette-card';

const hueDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);

// The object that tools/render.html draws from.
export function renderTheme(t, v) {
  const c = v.colors, bg = c.background, ratio = hex => contrast(hex, bg).toFixed(1);
  const p = PATTERNS[t.pattern];
  return {
    index: t.index, total: themes.length, name: v.name, base: t.name, label: v.label, slug: v.install, theme: t.slug, variant: v.variant,
    pattern: t.pattern, patternLabel: p.label, patternDesc: p.desc, desc: t.desc, motif: t.motif, scene: t.scene,
    icons: v.icons, border: v.border, colors: c, ansi: v.ansi, ratios: v.ansi.map((h, i) => (i === 0 ? '—' : ratio(h))),
    slots: SLOTS.map(key => {
      const o = hexOklch(c[key]);
      return { key, hex: c[key], name: colorName(c[key]), moved: o.C >= .03 && hueDist(o.h, SLOT_HUES[key]) > 50 };
    }),
    textRamp: [['dark_fg', c.dark_foreground], ['light_fg', c.light_foreground], ['foreground', c.foreground], ['bright_fg', c.bright_foreground]].map(([n, h]) => [n, h, ratio(h)]),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wanted = process.argv.slice(2);
  let list = wanted.length ? themes.filter(t => wanted.includes(t.slug)) : themes;
  if (process.env.MOTIF) list = list.filter(t => process.env.MOTIF.split(',').includes(t.motif));
  const logo = logoPaths(readFileSync(LOGO_SVG, 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'theme-render-'));
  const browser = await launch();

  const queue = [];
  for (const kind of KINDS) {
    for (const t of list) {
      for (const { key } of VARIANTS.filter(v => ONLY.includes(v.key))) {
        const dir = PREVIEW ? OUT : join(OUT, t.slug, key, 'backgrounds');
        mkdirSync(dir, { recursive: true });
        if (!PREVIEW && kind === 'scene') {
          // A renamed scene leaves its old file behind. Remove it.
          for (const f of readdirSync(dir)) if (f.startsWith('1-') && f !== `${fileOf(t, kind)}.jpg`) rmSync(join(dir, f));
        }
        const file = PREVIEW ? join(dir, `${t.slug}-${key}-${kind}.jpg`) : join(dir, `${fileOf(t, kind)}.jpg`);
        queue.push([renderTheme(t, t.variants[key]), kind, file]);
      }
    }
  }

  let done = 0;
  const total = queue.length, started = Date.now();
  await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, async (_, w) => {
    const page = await browser.open(pathToFileURL(join(ROOT, 'tools/render.html')).href);
    await page.evaluate(`setLogo(${JSON.stringify(logo)})`);
    while (queue.length) {
      const [theme, kind, file] = queue.shift();
      const [width, height] = SIZE;
      const url = await page.evaluate(`renderImage(${JSON.stringify(theme)}, ${JSON.stringify(kind)}, ${width}, ${height}, 'image/png')`);
      const png = join(scratch, `${w}.png`);
      writeFileSync(png, Buffer.from(url.split(',')[1], 'base64'));
      // ImageMagick keeps the full color resolution, so small text and thin lines stay sharp.
      await run('magick', [png, '-sampling-factor', '4:4:4', '-quality', PREVIEW ? '86' : '90', '-strip', file]);
      done++;
      process.stdout.write(`\r${done}/${total} backgrounds, ${((Date.now() - started) / 1000).toFixed(0)}s   `);
    }
    page.close();
  }));
  process.stdout.write('\n');
  await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
