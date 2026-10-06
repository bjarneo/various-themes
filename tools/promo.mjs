// Renders site/assets/promo.mp4: an intro, then 2 beats for each theme, then
// the outro. In the first beat the desktop of a theme comes in at night. In
// the second beat it turns to day. The transitions follow the pattern of each
// theme. The desktops are the real screenshots from tools/capture.sh.
//
//   node tools/promo.mjs <song.mp3>
//
// Environment:
//   BPM         tempo of the song (default 69, the tempo of Late Night Color Mixing)
//   FIRST_BEAT  time of the first beat in seconds (default 0.816)
//   URL         text on the outro card
//   STILLS=dir  write 5 frames of each named theme to dir instead of a video,
//               for a look at the transitions: node tools/promo.mjs song.mp3 kelp sumi
//
// Run tools/capture.sh and tools/assets.mjs first. Needs
// `chromium` and `ffmpeg`.

import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { themes, PATTERNS } from './palettes.mjs';
import { launch, logoPaths } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const [SONG, ...ONLY] = process.argv.slice(2);
if (!SONG) { console.error('Usage: node tools/promo.mjs <song.mp3> [themes for STILLS]'); process.exit(1); }

const FPS = 30;
const BEAT = 60 / Number(process.env.BPM || 69);
const FIRST_BEAT = Number(process.env.FIRST_BEAT || .816);
const URL_TEXT = process.env.URL || 'bjarneo.github.io/various-themes';
const STILLS = process.env.STILLS;
const OUT = join(ROOT, 'site', 'assets', 'promo.mp4');
const file = (...p) => pathToFileURL(join(ROOT, ...p)).href;

const songSeconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', SONG]).toString().trim());
const frameAt = beat => Math.round((FIRST_BEAT + beat * BEAT) * FPS);
const hero = themes.find(t => t.slug === 'kyoto-moss');
const pick = (t, key) => ({ colors: t.variants[key].colors, ansi: t.variants[key].ansi, border: t.variants[key].border });
const patternKeys = Object.keys(PATTERNS);

const clips = themes.map((t, j) => ({
  name: t.name, index: t.index, pattern: t.pattern,
  patternLabel: PATTERNS[t.pattern].label, patternDesc: PATTERNS[t.pattern].desc, patternIndex: patternKeys.indexOf(t.pattern) + 1,
  first: j === 0 || themes[j - 1].pattern !== t.pattern,
  src: { night: file('.capture', t.slug, 'night.png'), day: file('.capture', t.slug, 'day.png') },
  night: pick(t, 'night'), day: pick(t, 'day'),
}));

// The intro takes 4 beats, each theme 2 beats, and the outro runs to the end of the song.
const segments = [{ kind: 'intro', from: 0, to: frameAt(4) }];
clips.forEach((_, j) => segments.push({ kind: 'theme', index: j, from: frameAt(4 + 2 * j), to: frameAt(6 + 2 * j) }));
segments.push({ kind: 'outro', from: frameAt(4 + 2 * clips.length), to: Math.floor(songSeconds * FPS) });
const total = segments[segments.length - 1].to;
const seconds = total / FPS;
if (segments[segments.length - 1].to - segments[segments.length - 1].from < FPS * 3) throw new Error('The song is too short for the outro.');

const browser = await launch();
const page = await browser.open(pathToFileURL(join(ROOT, 'tools/promo.html')).href);
await page.evaluate(`setup(${JSON.stringify({
  logo: logoPaths(readFileSync('/usr/share/omarchy/logo.svg', 'utf8')),
  wall: file('site', 'assets', 'mosaic.jpg'),
  url: URL_TEXT, count: themes.length,
  intro: pick(hero, 'night'),
  clips,
})})`);

if (STILLS) {
  mkdirSync(STILLS, { recursive: true });
  for (const slug of ONLY) {
    const j = themes.findIndex(t => t.slug === slug), seg = segments.find(s => s.kind === 'theme' && s.index === j);
    await page.evaluate(`prepare(${Math.max(0, j - 1)})`);
    await page.evaluate(`prepare(${j})`);
    const n = seg.to - seg.from;
    for (const at of [.12, .22, .45, .7, .78, .98]) {
      const f = Math.floor(at * n);
      const url = await page.evaluate(`frame(${JSON.stringify(seg)}, ${f}, ${n}, .85)`);
      writeFileSync(join(STILLS, `${slug}-${String(Math.round(at * 100)).padStart(2, '0')}.jpg`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    }
  }
  console.log(`wrote stills to ${STILLS}`);
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  const ffmpeg = spawn('ffmpeg', [
    '-v', 'error', '-y',
    '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-i', SONG,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-af', `afade=t=out:st=${(seconds - 4).toFixed(2)}:d=4`,
    '-t', seconds.toFixed(3), '-movflags', '+faststart', OUT,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });

  let written = 0;
  for (const seg of segments) {
    if (seg.kind === 'theme') await page.evaluate(`prepare(${seg.index})`);
    if (seg.kind === 'outro') await page.evaluate(`prepare(${clips.length - 1})`);
    const n = seg.to - seg.from;
    for (let f = 0; f < n; f++) {
      const url = await page.evaluate(`frame(${JSON.stringify(seg)}, ${f}, ${n})`);
      const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
      if (!ffmpeg.stdin.write(buf)) await new Promise(r => ffmpeg.stdin.once('drain', r));
      written++;
    }
    process.stdout.write(`\r${written}/${total} frames`);
  }
  ffmpeg.stdin.end();
  await new Promise(r => ffmpeg.on('close', r));
  process.stdout.write(`\nwrote ${OUT} (${seconds.toFixed(1)}s)\n`);
}
page.close();
await browser.close();
