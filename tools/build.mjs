// Writes colors.toml and icons.theme for every theme and variant, and the
// theme data for the site.
//
//   node tools/build.mjs

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes, VARIANTS, PATTERNS, colorsToml } from './palettes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// The credits of the wallpapers from Wikimedia Commons, from tools/wallpapers.mjs fetch.
const CREDITS = join(ROOT, 'tools', 'wallpapers', 'credits.json');
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {};

// Writes a file only when its content changes, so the time stamps stay.
function write(file, content) {
  if (existsSync(file) && readFileSync(file, 'utf8') === content) return;
  writeFileSync(file, content);
}

for (const t of themes) {
  for (const { key } of VARIANTS) {
    const v = t.variants[key];
    const dir = join(ROOT, t.slug, key);
    mkdirSync(join(dir, 'backgrounds'), { recursive: true });
    write(join(dir, 'colors.toml'), colorsToml(v));
    write(join(dir, 'icons.theme'), `${v.icons}\n`);
  }
}

// Theme data for site/index.html.
const data = {
  variants: VARIANTS.map(({ key, label, suffix }) => ({ key, label, suffix })),
  patterns: Object.entries(PATTERNS).map(([key, p]) => ({ key, ...p })),
  themes: themes.map(t => ({
    index: t.index, name: t.name, slug: t.slug, pattern: t.pattern, desc: t.desc, moved: t.moved, motif: t.motif, scene: t.scene,
    variants: Object.fromEntries(VARIANTS.map(({ key }) => {
      const v = t.variants[key];
      const walls = (credits[t.slug]?.[key] || []).map(c => ({ file: c.file.replace(/\.jpg$/, ''), title: c.title, artist: c.artist, license: c.license, licenseUrl: c.licenseUrl, source: c.source }));
      return [key, { install: v.install, name: v.name, icons: v.icons, colors: v.colors, ansi: v.ansi, border: v.border, walls }];
    })),
  })),
};
mkdirSync(join(ROOT, 'site', 'assets'), { recursive: true });
write(join(ROOT, 'site', 'assets', 'themes.js'), `window.THEMES = ${JSON.stringify(data)};\n`);

console.log(`wrote ${themes.length} themes x ${VARIANTS.length} variants`);
