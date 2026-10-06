// Checks every theme variant against the contrast and distance rules, and
// prints the problems. It exits with 1 when a rule fails.
//
//   node tools/check.mjs              check all themes
//   node tools/check.mjs kyoto-moss   check the named themes
//   VERBOSE=1 node tools/check.mjs    also print the contrast of each slot

import { themes, VARIANTS, SLOTS, contrast, oklabDistance, MIN_DISTANCE, RED_GREEN_DISTANCE } from './palettes.mjs';

const wanted = process.argv.slice(2);
const list = wanted.length ? themes.filter(t => wanted.includes(t.slug)) : themes;
const BRIGHT = SLOTS.map(s => `bright_${s}`);

// Each rule: [key, other key or 'background', lowest ratio, highest ratio]
const RULES = [
  ['foreground', 'background', 9],
  ['light_foreground', 'background', 6.5],
  ['dark_foreground', 'background', 4.5],
  ['bright_foreground', 'background', 11],
  ['muted', 'background', 3, 4.6],
  ['orange', 'background', 4.5],
  ...SLOTS.map(s => [s, 'background', 4.5]),
  ...BRIGHT.map(s => [s, 'background', 4.5]),
  ['foreground', 'lighter_background', 7],
  ['foreground', 'dark_background', 9],
  ['bright_foreground', 'selection', 6],
  ['foreground', 'selection', 5],
];

let failures = 0, warnings = 0;
const lowest = {};
for (const t of list) {
  for (const { key } of VARIANTS) {
    const v = t.variants[key], c = v.colors, problems = [];
    for (const [a, b, lo, hi] of RULES) {
      const k = contrast(c[a], c[b]);
      if (b === 'background') lowest[`${key} ${a}`] = Math.min(lowest[`${key} ${a}`] ?? 99, k);
      if (k < lo - 1e-9 || (hi && k > hi + 1e-9)) problems.push(`${a} on ${b} is ${k.toFixed(2)}:1, wants ${hi ? `${lo} to ${hi}` : `at least ${lo}`}`);
    }
    if (c.accent !== c.blue) problems.push('accent differs from blue');
    const normal = SLOTS.map(s => c[s]);
    for (let j = 1; j < 6; j++) {
      for (let i = 0; i < j; i++) {
        const d = oklabDistance(normal[i], normal[j]);
        const need = i === 0 && j === 1 ? RED_GREEN_DISTANCE : MIN_DISTANCE;
        if (d < need - 1e-6) problems.push(`${SLOTS[i]} and ${SLOTS[j]} are ${d.toFixed(3)} apart, want ${need}`);
      }
    }
    if (process.env.VERBOSE) {
      console.log(`${v.install.padEnd(28)} ${SLOTS.map((s, i) => `${s.slice(0, 3)} ${contrast(normal[i], c.background).toFixed(1).padStart(4)}`).join('  ')}  fg ${contrast(c.foreground, c.background).toFixed(1)}  muted ${contrast(c.muted, c.background).toFixed(1)}`);
    }
    if (problems.length) {
      failures += problems.length;
      console.log(`${v.install}`);
      for (const p of problems) console.log(`  ${p}`);
    }
  }
}

console.log(`\nLowest contrast over ${list.length} themes:`);
for (const { key } of VARIANTS) {
  console.log(`  ${key.padEnd(5)} ${['foreground', 'dark_foreground', 'muted', ...SLOTS].map(s => `${s} ${lowest[`${key} ${s}`].toFixed(2)}`).join(', ')}`);
}
console.log(failures ? `\n${failures} problems` : '\nAll rules pass');
process.exit(failures ? 1 : 0);
