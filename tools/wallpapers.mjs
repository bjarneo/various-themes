// Finds, records and fetches the wallpapers of each theme variant. The
// wallpapers are photographs and artworks from Wikimedia Commons with a free
// license: public domain, CC0, CC BY or CC BY-SA. The picks live in
// tools/wallpapers/*.json, 1 file per group of themes.
//
//   node tools/wallpapers.mjs search <theme> <night|day> <query> [--quality] [--featured] [--limit 40]
//       Searches Commons, scores each result against the palette of the
//       variant, and writes a numbered contact sheet. Prints the results.
//   node tools/wallpapers.mjs fetch [themes...]
//       Downloads the picked originals, crops them to 16:9, scales them to at
//       most 6144x3456, and writes <theme>/<variant>/backgrounds/<n>-<name>.jpg.
//       The wallpapers come after the drawn backgrounds, so n starts at 3.
//       The wordmark, the scene and the palette card stay.
//   node tools/wallpapers.mjs preview [themes...]
//       Applies the crop and the grade of each pick to a 1920 pixel copy and
//       writes 1 contact sheet per theme to $OUT. It writes nothing in the repo.
//   node tools/wallpapers.mjs review [themes...]
//       Writes a contact sheet of the fetched wallpapers of each theme.
//   node tools/wallpapers.mjs check
//       Checks that every variant has 2 picks, that no file is used twice, and
//       that every license is allowed.
//   node tools/wallpapers.mjs credits
//       Cleans the titles and the author names in tools/wallpapers/credits.json.
//       Fetch does the same for new files.
//
// A pick in tools/wallpapers/<group>.json:
//   { "<theme>": { "night": [pick, pick], "day": [pick, pick] } }
//   pick = { name, file, crop?, grade? }
//     name   short slug for the file name, for example "saihoji-moss"
//     file   the Commons file title, for example "File:Saihoji Temple moss gardens.jpg"
//     crop   the center of the 16:9 crop as [x, y] fractions. Default [0.5, 0.5].
//     grade  0 to 1. Blends a gradient map of the variant palette over the image.
//            Use 0 for most photos, up to 0.3 for a gentle tint, and more only
//            for monochrome themes.
//
// The fetch step adds the title, author, license and source of each file from
// the Commons API, and writes them to tools/wallpapers/credits.json.
// Needs `magick` on PATH.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes, hexOklch } from './palettes.mjs';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PICKS = join(ROOT, 'tools', 'wallpapers');
const CACHE = join(ROOT, '.capture', 'wallpapers');
const SCRATCH = process.env.OUT || join(CACHE, 'sheets');
const UA = 'various-themes/1.0 (https://github.com/bjarneo/various-themes; wallpaper search for Omarchy themes)';
const MIN_WIDTH = 3840, MAX = [6144, 3456];
// The first number of a wallpaper file. 0, 1 and 2 are the drawn backgrounds.
const FIRST = 3;

// Free licenses that allow copies and changes. NC and ND licenses stay out.
export function allowedLicense(name = '') {
  const n = name.toLowerCase();
  if (/\bnc\b|non-?commercial|\bnd\b|no ?deriv|fair use|copyrighted(?! free use)/.test(n)) return false;
  return /^(cc0|cc-zero|public domain|pd\b|pd-|cc by(-sa)? ?\d|cc-by(-sa)?-\d|attribution|no restrictions|copyrighted free use)/.test(n);
}

const strip = html => String(html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

async function api(params) {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  Object.entries({ format: 'json', ...params }).forEach(([k, v]) => u.searchParams.set(k, v));
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    await new Promise(res => setTimeout(res, 1500 * (attempt + 1)));
  }
  throw new Error(`Commons API failed for ${u}`);
}

const IIPROP = { prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit|ImageDescription|Restrictions|AttributionRequired|ObjectName' };

function infoOf(page) {
  const ii = page.imageinfo?.[0] || {}, m = ii.extmetadata || {};
  return {
    file: page.title, width: ii.width, height: ii.height, mime: ii.mime, url: ii.url, thumb: ii.thumburl, page: ii.descriptionurl,
    license: m.LicenseShortName?.value || '', licenseUrl: m.LicenseUrl?.value || '', artist: strip(m.Artist?.value), credit: strip(m.Credit?.value),
    title: strip(m.ObjectName?.value) || page.title.replace(/^File:/, '').replace(/\.[a-z]+$/i, ''),
    restrictions: m.Restrictions?.value || '',
  };
}

// ---------- palette fit ----------

function oklab([r, g, b]) {
  const f = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
  const [R, G, B] = [f(r), f(g), f(b)];
  const l = Math.cbrt(.4122214708 * R + .5363325363 * G + .0514459929 * B), m = Math.cbrt(.2119034982 * R + .6806995451 * G + .1073969566 * B), s = Math.cbrt(.0883024619 * R + .2817188376 * G + .6299787005 * B);
  return [.2104542553 * l + .7936177850 * m - .0040720468 * s, 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s, .0259040371 * l + .7827717662 * m - .8086757660 * s];
}
const hexLab = hex => oklab([1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)));

// How well an image fits a palette, from a tiny copy of it. Every pixel finds
// its nearest palette color in OKLab. The fit is the mean distance, plus a
// penalty when the image is too light for night or too dark for day.
async function fitOf(file, colors, night) {
  const { stdout } = await run('magick', [file, '-resize', '48x27!', '-depth', '8', 'rgb:-'], { encoding: 'buffer', maxBuffer: 1 << 20 });
  const keys = ['background', 'dark_background', 'darker_background', 'lighter_background', 'selection', 'muted', 'foreground', 'accent', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'orange', 'brown', 'bright_red', 'bright_green', 'bright_yellow', 'bright_blue', 'bright_magenta', 'bright_cyan'];
  const pal = keys.map(k => hexLab(colors[k]));
  let dist = 0, L = 0, n = 0, chroma = 0;
  for (let i = 0; i + 2 < stdout.length; i += 3) {
    const p = oklab([stdout[i], stdout[i + 1], stdout[i + 2]]);
    let best = 9;
    for (const q of pal) best = Math.min(best, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]));
    dist += best; L += p[0]; chroma += Math.hypot(p[1], p[2]); n++;
  }
  dist /= n; L /= n; chroma /= n;
  const penalty = night ? Math.max(0, L - .42) : Math.max(0, .62 - L);
  return { fit: Math.round(Math.max(0, 100 - dist * 400 - penalty * 220)), meanL: +L.toFixed(2), dist: +dist.toFixed(3), chroma: +chroma.toFixed(3) };
}

// ---------- commands ----------

async function search(slug, variant, query, opts) {
  const t = themes.find(x => x.slug === slug);
  if (!t) throw new Error(`No theme named ${slug}`);
  const v = t.variants[variant];
  let q = `${query} filew:>${MIN_WIDTH - 1} filetype:bitmap`;
  if (opts.quality) q += ' incategory:Quality_images';
  if (opts.featured) q += ' incategory:Featured_pictures_on_Wikimedia_Commons';
  const j = await api({ action: 'query', generator: 'search', gsrsearch: q, gsrnamespace: 6, gsrlimit: opts.limit, ...IIPROP, iiurlwidth: 640 });
  const pages = Object.values(j.query?.pages || {}).sort((a, b) => a.index - b.index);
  const used = usedFiles();
  const out = [];
  mkdirSync(join(CACHE, 'thumbs'), { recursive: true });
  for (const p of pages) {
    const x = infoOf(p);
    if (!x.width || x.width < MIN_WIDTH || x.width / x.height < 1.25 || !/jpeg|png|tiff/.test(x.mime || '')) continue;
    if (!allowedLicense(x.license)) continue;
    const thumb = join(CACHE, 'thumbs', `${createHash('sha1').update(x.file).digest('hex').slice(0, 16)}.jpg`);
    if (!existsSync(thumb)) {
      const r = await fetch(x.thumb, { headers: { 'User-Agent': UA } });
      if (!r.ok) continue;
      writeFileSync(thumb, Buffer.from(await r.arrayBuffer()));
    }
    out.push({ ...x, thumbFile: thumb, ...(await fitOf(thumb, v.colors, variant === 'night')), used: used.get(x.file) || '' });
  }
  out.sort((a, b) => b.fit - a.fit);
  mkdirSync(SCRATCH, { recursive: true });
  const sheet = join(SCRATCH, `${slug}-${variant}-${query.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.jpg`);
  if (out.length) {
    const args = ['montage', '-background', '#222', '-fill', '#eee', '-pointsize', '15', '-font', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf'];
    out.forEach((x, i) => args.push('-label', `#${i} fit ${x.fit} L${x.meanL} ${x.width}x${x.height}${x.used ? ' USED' : ''}`, x.thumbFile));
    args.push('-tile', '4x', '-geometry', '420x236+6+6', sheet);
    await run('magick', args);
  }
  out.forEach((x, i) => console.log(`#${i} fit ${String(x.fit).padStart(3)} L ${x.meanL} ${x.width}x${x.height} ${x.license} | ${x.file}${x.used ? `  [used by ${x.used}]` : ''}${x.restrictions ? `  [restrictions: ${x.restrictions}]` : ''}`));
  console.log(out.length ? `sheet: ${sheet}` : 'no results');
}

function loadPicks() {
  const all = {};
  if (!existsSync(PICKS)) return all;
  for (const f of readdirSync(PICKS).filter(f => f.endsWith('.json') && f !== 'credits.json')) {
    // Another process can be in the middle of a write, so a file that does not parse is skipped.
    let data;
    try { data = JSON.parse(readFileSync(join(PICKS, f), 'utf8')); } catch { console.error(`skipped ${f}: it does not parse`); continue; }
    for (const [slug, v] of Object.entries(data)) all[slug] = { ...v, group: f.replace(/\.json$/, '') };
  }
  return all;
}

function usedFiles() {
  const m = new Map();
  for (const [slug, v] of Object.entries(loadPicks())) for (const key of ['night', 'day']) for (const p of v[key] || []) m.set(p.file, `${slug} ${key}`);
  return m;
}

// The info of many files, 40 titles per API call.
async function infos(files) {
  const out = {};
  for (let i = 0; i < files.length; i += 40) {
    const j = await api({ action: 'query', titles: files.slice(i, i + 40).join('|'), ...IIPROP });
    const norm = Object.fromEntries((j.query?.normalized || []).map(n => [n.to, n.from]));
    for (const p of Object.values(j.query?.pages || {})) {
      const x = infoOf(p);
      out[norm[p.title] || p.title] = x;
      out[p.title] = x;
    }
  }
  return out;
}

// A gradient map from the darkest to the lightest color of the variant, through the accent.
async function clutFor(v, file) {
  const c = v.colors, night = c.mode === 'dark';
  const stops = night ? [c.darker_background, c.background, c.accent, c.bright_blue, c.bright_foreground] : [c.foreground, c.dark_foreground, c.accent, c.lighter_background, c.background];
  const sorted = [...stops].sort((a, b) => hexOklch(a).L - hexOklch(b).L);
  await run('magick', ['-size', '1x256', `gradient:${sorted[0]}-${sorted[1]}`, `gradient:${sorted[1]}-${sorted[2]}`, `gradient:${sorted[2]}-${sorted[3]}`, `gradient:${sorted[3]}-${sorted[4]}`, '-append', '-resize', '1x256!', file]);
}

// The author field of Commons is free text. Keep the name only: no usage
// notes, no talk links, and no place after the name of a Flickr account.
function cleanArtist(a) {
  let s = String(a || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
  const d = s.match(/^\S+\.(?:jpe?g|png|tiff?): (.+?) derivative work: (.+)$/i);
  if (d) s = `${d[1]} and ${d[2]}`;
  // "This photo was taken by Timothy A. Gonsalves. Feel free ..." keeps the name with its initials.
  const by = s.match(/(?:[Tt]aken|[Uu]ploaded) by ((?:[A-Z]\.\s|[^.,;])+)/);
  if (by) s = by[1];
  s = s.replace(/ \/ thank you.*$/i, '').replace(/\s*(?:→\s*)?\((?:talk|Δ)\)/gi, '').replace(/ from [A-Z][^]*$/u, '').trim();
  return s || 'Unknown';
}

// The title field can hold Wikidata labels in many languages, such as
// 'Irises title QS:P1476,en:"Irises "label QS:Les,"Lirios"'. Keep the English
// label, else the original title. Shorten a long title at a word.
const LANGUAGES = 'German|Dutch|English|French|Italian|Spanish|Portuguese|Swedish|Norwegian|Danish|Finnish|Polish|Czech|Russian|Japanese|Chinese|Korean|multiple languages';
function cleanTitle(t) {
  let s = String(t || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, ' ').trim();
  if (/(?:title|label) QS:/.test(s)) {
    const pick = s.match(/label QS:Len,"([^"]+)"/) || s.match(/title QS:P1476,en:"([^"]+)"/) || s.match(/title QS:P1476,[a-z-]+:"([^"]+)"/);
    s = pick ? pick[1] : s.split(/(?:title|label) QS:/)[0];
  }
  s = s.replace(new RegExp(`^(?:${LANGUAGES}): `), '').trim();
  if (s.length > 90) s = `${s.slice(0, 88).replace(/\s+\S*$/, '').replace(/[\s,.;:-]+$/, '')}…`;
  return s || 'Untitled';
}

async function fetchAll(only) {
  const picks = loadPicks(), list = Object.entries(picks).filter(([s]) => !only.length || only.includes(s));
  const files = [...new Set(list.flatMap(([, v]) => ['night', 'day'].flatMap(k => (v[k] || []).map(p => p.file))))];
  const info = await infos(files);
  mkdirSync(join(CACHE, 'originals'), { recursive: true });
  // Check every pick before the first download.
  const jobs = [], made = {};
  for (const [slug, v] of list) {
    made[slug] = { night: [], day: [] };
    for (const key of ['night', 'day']) {
      for (const [i, p] of (v[key] || []).entries()) {
        const x = info[p.file];
        if (!x?.url) throw new Error(`${slug} ${key}: no file ${p.file}`);
        if (!allowedLicense(x.license)) throw new Error(`${slug} ${key}: license ${x.license} of ${p.file} is not allowed`);
        jobs.push({ slug, key, i, p, x });
      }
    }
  }
  let done = 0;
  async function make({ slug, key, i, p, x }) {
    const t = themes.find(y => y.slug === slug), dir = join(ROOT, slug, key, 'backgrounds');
    const ext = (x.url.match(/\.(jpe?g|png|tiff?)$/i) || ['.jpg'])[0];
    const orig = join(CACHE, 'originals', `${createHash('sha1').update(p.file).digest('hex').slice(0, 16)}${ext}`);
    if (!existsSync(orig)) {
      const r = await fetch(x.url, { headers: { 'User-Agent': UA } });
      if (!r.ok) throw new Error(`download failed: ${x.url}`);
      writeFileSync(orig, Buffer.from(await r.arrayBuffer()));
    }
    // The largest 16:9 window around the crop center.
    const [cx, cy] = p.crop || [.5, .5];
    let w = x.width, h = Math.round(w * 9 / 16);
    if (h > x.height) { h = x.height; w = Math.round(h * 16 / 9); }
    const left = Math.round(Math.min(Math.max(cx * x.width - w / 2, 0), x.width - w));
    const top = Math.round(Math.min(Math.max(cy * x.height - h / 2, 0), x.height - h));
    if (w < MIN_WIDTH) throw new Error(`${slug} ${key}: ${p.file} is only ${w} pixels wide after the 16:9 crop`);
    const name = `${i + FIRST}-${p.name}.jpg`, out = join(dir, name);
    const args = [`${orig}[0]`, '-auto-orient', '-colorspace', 'sRGB', '-crop', `${w}x${h}+${left}+${top}`, '+repage', '-resize', `${MAX[0]}x${MAX[1]}>`];
    if (p.grade) {
      const clut = join(CACHE, `clut-${slug}-${key}-${i}.png`);
      await clutFor(t.variants[key], clut);
      args.push('(', '+clone', '-colorspace', 'gray', clut, '-clut', ')', '-compose', 'blend', '-define', `compose:args=${Math.round(p.grade * 100)}`, '-composite');
    }
    args.push('-quality', '90', '-sampling-factor', '4:2:0', '-strip', out);
    await run('magick', args, { maxBuffer: 1 << 26 });
    made[slug][key][i] = { file: name, title: cleanTitle(x.title), artist: cleanArtist(x.artist || x.credit), license: x.license, licenseUrl: x.licenseUrl, source: x.page, changes: p.grade ? 'cropped, scaled and tinted with the theme palette' : 'cropped and scaled' };
    process.stdout.write(`\r${++done} of ${jobs.length} wallpapers`);
  }
  // A few downloads and conversions run at the same time. FETCH_JOBS sets how many.
  // A job that fails gets 2 more tries, after 10 and 20 seconds. A theme with a
  // failed job keeps its old files and credits, and the other themes go on.
  const queue = [...jobs], failed = new Map();
  await Promise.all(Array.from({ length: Math.max(1, Number(process.env.FETCH_JOBS) || 3) }, async () => {
    while (queue.length) {
      const job = queue.shift();
      for (let attempt = 1; ; attempt++) {
        try { await make(job); break; } catch (e) {
          if (attempt === 3) { failed.set(job.slug, `${job.slug} ${job.key} ${job.p.file}: ${String(e.message || e).split('\n')[0]}`); break; }
          await new Promise(r => setTimeout(r, attempt * 10000));
        }
      }
    }
  }));
  process.stdout.write('\n');
  for (const msg of failed.values()) console.error(`failed: ${msg}`);
  for (const slug of failed.keys()) delete made[slug];
  // A changed pick leaves its old file behind. The drawn backgrounds 0, 1 and 2 stay.
  for (const slug of Object.keys(made)) {
    for (const key of ['night', 'day']) {
      const dir = join(ROOT, slug, key, 'backgrounds'), keep = made[slug][key].map(c => c.file);
      for (const f of readdirSync(dir)) if (/^[3-9]-/.test(f) && !keep.includes(f)) rmSync(join(dir, f));
    }
  }
  // Read the credits again just before the write, so runs for other themes keep their credits.
  const file = join(PICKS, 'credits.json');
  const credits = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  Object.assign(credits, made);
  writeFileSync(file, JSON.stringify(credits, null, 1) + '\n');
  if (failed.size) { console.error(`${failed.size} themes failed. Run fetch again for them.`); process.exitCode = 1; }
}

async function preview(only) {
  const picks = loadPicks(), list = Object.entries(picks).filter(([s]) => !only.length || only.includes(s));
  const files = [...new Set(list.flatMap(([, v]) => ['night', 'day'].flatMap(k => (v[k] || []).map(p => p.file))))];
  const info = {};
  for (let i = 0; i < files.length; i += 40) {
    const j = await api({ action: 'query', titles: files.slice(i, i + 40).join('|'), ...IIPROP, iiurlwidth: 1920 });
    const norm = Object.fromEntries((j.query?.normalized || []).map(n => [n.to, n.from]));
    for (const pg of Object.values(j.query?.pages || {})) { const x = infoOf(pg); info[norm[pg.title] || pg.title] = x; info[pg.title] = x; }
  }
  mkdirSync(join(CACHE, 'previews'), { recursive: true });
  mkdirSync(SCRATCH, { recursive: true });
  for (const [slug, v] of list) {
    const t = themes.find(x => x.slug === slug), tiles = [];
    for (const key of ['night', 'day']) {
      for (const [i, p] of (v[key] || []).entries()) {
        const x = info[p.file];
        if (!x?.thumb) { console.log(`${slug} ${key}: no file ${p.file}`); continue; }
        const src = join(CACHE, 'previews', `${createHash('sha1').update(p.file).digest('hex').slice(0, 16)}.jpg`);
        if (!existsSync(src)) { const r = await fetch(x.thumb, { headers: { 'User-Agent': UA } }); writeFileSync(src, Buffer.from(await r.arrayBuffer())); }
        const { stdout } = await run('magick', ['identify', '-format', '%w %h', `${src}[0]`]);
        const [tw, th] = stdout.trim().split(' ').map(Number);
        const [cx, cy] = p.crop || [.5, .5];
        let w = tw, h = Math.round(w * 9 / 16);
        if (h > th) { h = th; w = Math.round(h * 16 / 9); }
        const left = Math.round(Math.min(Math.max(cx * tw - w / 2, 0), tw - w)), top = Math.round(Math.min(Math.max(cy * th - h / 2, 0), th - h));
        const out = join(SCRATCH, `preview-${slug}-${key}-${i + FIRST}.jpg`);
        const args = [`${src}[0]`, '-auto-orient', '-colorspace', 'sRGB', '-crop', `${w}x${h}+${left}+${top}`, '+repage', '-resize', '1280x720'];
        if (p.grade) {
          const clut = join(CACHE, `clut-${slug}-${key}.png`);
          await clutFor(t.variants[key], clut);
          args.push('(', '+clone', '-colorspace', 'gray', clut, '-clut', ')', '-compose', 'blend', '-define', `compose:args=${Math.round(p.grade * 100)}`, '-composite');
        }
        args.push('-quality', '85', out);
        await run('magick', args);
        tiles.push([`${key} ${i + FIRST}  ${x.width}x${x.height}  ${x.license}`, out]);
      }
    }
    if (!tiles.length) continue;
    const sheet = join(SCRATCH, `preview-${slug}.jpg`), args = ['montage', '-background', '#222', '-fill', '#eee', '-pointsize', '16', '-font', '/usr/share/fonts/liberation/LiberationSans-Regular.ttf'];
    tiles.forEach(([label, f]) => args.push('-label', label, f));
    args.push('-tile', '2x', '-geometry', '640x360+6+6', sheet);
    await run('magick', args);
    console.log(sheet);
  }
}

async function review(only) {
  const picks = loadPicks();
  mkdirSync(SCRATCH, { recursive: true });
  for (const [slug, v] of Object.entries(picks).filter(([s]) => !only.length || only.includes(s))) {
    const files = ['night', 'day'].flatMap(k => (v[k] || []).map((p, i) => [k, i, join(ROOT, slug, k, 'backgrounds', `${i + FIRST}-${p.name}.jpg`)])).filter(([, , f]) => existsSync(f));
    if (!files.length) continue;
    const args = ['montage', '-background', '#222', '-fill', '#eee', '-pointsize', '16'];
    files.forEach(([k, i, f]) => args.push('-label', `${slug} ${k} ${i + 1}`, f));
    const sheet = join(SCRATCH, `review-${slug}.jpg`);
    args.push('-tile', '2x', '-geometry', '640x360+6+6', sheet);
    await run('magick', args);
    console.log(sheet);
  }
}

function check() {
  const picks = loadPicks(), seen = new Map(), problems = [];
  for (const t of themes) {
    const v = picks[t.slug];
    if (!v) { problems.push(`${t.slug}: no picks`); continue; }
    for (const key of ['night', 'day']) {
      const list = v[key] || [];
      if (list.length !== 2) problems.push(`${t.slug} ${key}: ${list.length} picks, want 2`);
      for (const p of list) {
        if (seen.has(p.file)) problems.push(`${t.slug} ${key}: ${p.file} is also used by ${seen.get(p.file)}`);
        seen.set(p.file, `${t.slug} ${key}`);
        if (!/^[a-z0-9-]+$/.test(p.name || '')) problems.push(`${t.slug} ${key}: name ${p.name} is not a slug`);
      }
    }
  }
  console.log(problems.length ? problems.join('\n') : `All ${themes.length} themes have 2 picks per variant, and no file is used twice.`);
  return problems.length;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'search') {
  const opts = { quality: rest.includes('--quality'), featured: rest.includes('--featured'), limit: 40 };
  const li = rest.indexOf('--limit');
  if (li >= 0) { opts.limit = Number(rest[li + 1]); rest.splice(li, 2); }
  const words = rest.filter(x => !x.startsWith('--'));
  await search(words[0], words[1], words.slice(2).join(' '), opts);
} else if (cmd === 'fetch') {
  await fetchAll(rest);
} else if (cmd === 'preview') {
  await preview(rest);
} else if (cmd === 'review') {
  await review(rest);
} else if (cmd === 'check') {
  process.exit(check() ? 1 : 0);
} else if (cmd === 'credits') {
  const file = join(PICKS, 'credits.json'), credits = JSON.parse(readFileSync(file, 'utf8'));
  for (const v of Object.values(credits)) for (const c of [...v.night, ...v.day]) { c.title = cleanTitle(c.title); c.artist = cleanArtist(c.artist); }
  writeFileSync(file, JSON.stringify(credits, null, 1) + '\n');
} else if (cmd) {
  console.log('Commands: search, preview, fetch, review, check, credits');
}
