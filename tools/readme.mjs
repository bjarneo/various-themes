// Writes README.md from the theme data.
//
//   node tools/readme.mjs

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes, VARIANTS, PATTERNS, SLOTS, contrast } from './palettes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'https://github.com/bjarneo/various-themes';
const SITE = 'https://bjarneo.github.io/various-themes';
const N = themes.length, NV = N * VARIANTS.length;
// The wallpapers from Wikimedia Commons, from tools/wallpapers.mjs fetch.
const CREDITS = join(ROOT, 'tools', 'wallpapers', 'credits.json');
const credits = existsSync(CREDITS) ? JSON.parse(readFileSync(CREDITS, 'utf8')) : {};
const NW = Object.values(credits).reduce((a, v) => a + (v.night?.length || 0) + (v.day?.length || 0), 0);
const md = s => String(s).replace(/([\[\]|*_<>])/g, '\\$1');
const creditLine = c => `[${md(c.title)}](${c.source}) by ${md(c.artist)}, ${c.licenseUrl ? `[${c.license}](${c.licenseUrl})` : c.license}`;

// Lowest contrast of the 6 normal ANSI colors and the text, per variant.
function stats(key) {
  let normal = 99, text = 99, muted = 99;
  for (const t of themes) {
    const c = t.variants[key].colors, bg = c.background;
    SLOTS.forEach(s => { normal = Math.min(normal, contrast(c[s], bg), contrast(c[`bright_${s}`], bg)); });
    text = Math.min(text, contrast(c.foreground, bg));
    muted = Math.min(muted, contrast(c.muted, bg));
  }
  return { normal: normal.toFixed(1), text: text.toFixed(1), muted: muted.toFixed(1) };
}

const anchor = s => s.toLowerCase().replace(/[^a-z0-9\- ]/g, '').replace(/ /g, '-');
const pad = n => String(n).padStart(3, '0');
const sizeMb = Math.round(Number(execFileSync('du', ['-sm', '--exclude=.git', '--exclude=.capture', ROOT]).toString().split('\t')[0]) / 10) * 10;
const sceneLabel = t => t.scene.replace(/-/g, ' ');

const USE = {
  night: 'A dark background in the hue of the theme. For the evening and dim rooms.',
  day: 'A light background with the same hues. For bright rooms and daylight.',
};

const variantTable = VARIANTS.map(v => {
  const s = stats(v.key);
  return `| ${v.label} | \`kyoto-moss${v.suffix}\` | ${USE[v.key]} | ${s.normal}:1 | ${s.muted}:1 | ${s.text}:1 |`;
}).join('\n');

const patternTable = Object.entries(PATTERNS).map(([key, p]) => {
  const list = themes.filter(t => t.pattern === key);
  return `| [${p.label}](#${anchor(p.label)}) | ${list.length} | ${p.desc} |`;
}).join('\n');

const moved = themes.filter(t => t.moved.length).length;

const sections = Object.entries(PATTERNS).map(([key, p]) => {
  const list = themes.filter(t => t.pattern === key);
  return `## ${p.label}

${p.desc}

${list.map(t => {
    const rows = VARIANTS.map(v => {
      const tv = t.variants[v.key], c = tv.colors;
      return `| ${v.label} | [\`${tv.install}\`](${t.slug}/${v.key}/) | \`${c.background}\` | \`${c.foreground}\` | \`${c.accent}\` | \`${tv.icons}\` |`;
    }).join('\n');
    const colors = VARIANTS.map(v => {
      const a = t.variants[v.key].ansi;
      return `| ${v.label} | ${a.slice(0, 8).map(h => `\`${h}\``).join(' ')} | ${a.slice(8).map(h => `\`${h}\``).join(' ')} |`;
    }).join('\n');
    const movedLine = t.moved.length ? ` Slots that leave their usual hue: ${t.moved.map(s => `\`${s}\``).join(', ')}.` : '';
    const walls = VARIANTS.flatMap(v => (credits[t.slug]?.[v.key] || []).map(c => `- ${v.label}, \`${c.file}\`: ${creditLine(c)}`));
    const wallBlock = walls.length ? `\n<details>\n<summary>Wallpaper credits</summary>\n\n${walls.join('\n')}\n\n</details>\n` : '';
    return `### ${t.name}

[![${t.name} at night and in the day](site/assets/shots/${t.slug}/pair.webp)](${SITE}/#${t.slug})

\`${pad(t.index)}\` · Folder: [\`${t.slug}/\`](${t.slug}/) · Scene: ${sceneLabel(t)} · [Open on the site](${SITE}/#${t.slug})

${t.desc}${movedLine}

| Variant | Theme name | \`background\` | \`foreground\` | \`accent\` | Icons |
| --- | --- | --- | --- | --- | --- |
${rows}

<details>
<summary>All 16 ANSI colors of each variant</summary>

| Variant | Normal, 0 to 7 | Bright, 8 to 15 |
| --- | --- | --- |
${colors}

</details>
${wallBlock}
\`\`\`bash
curl -fsSL ${SITE}/install.sh | bash -s -- ${t.slug} --set
\`\`\`
`;
  }).join('\n')}`;
}).join('\n');

const menu = Object.entries(PATTERNS).map(([key, p]) => {
  const list = themes.filter(t => t.pattern === key);
  return `| ${p.label} | ${list.map(t => `[${t.name}](#${anchor(t.name)})`).join(', ')} |`;
}).join('\n');

const readme = `# Various themes for Omarchy

[![All ${NV} themes, from the darkest night to the lightest day.](site/assets/mosaic.jpg)](${SITE})

This repo has ${N} themes for [Omarchy](https://omarchy.org). A slot can leave its usual hue: the yellow of Delft is a pale cobalt, and the blue of Kyoto Moss is a moss green. Each theme has a night variant and a day variant. That makes ${NV} Omarchy themes. Each variant has a 16-color ANSI palette and ${NW ? `${3 + Math.round(NW / NV)} backgrounds: 3 drawn at 6K, the Omarchy wordmark, a scene and a palette card, and ${Math.round(NW / NV)} wallpapers from Wikimedia Commons between 4K and 6K` : '3 backgrounds at 6K: the Omarchy wordmark, a drawn scene and a palette card'}.

- Site: [${SITE.replace('https://', '')}](${SITE})
- Screenshots: real captures of an Omarchy desktop with each variant applied
- Promo video: [\`site/assets/promo.mp4\`](site/assets/promo.mp4), all 100 themes, 2 beats each, with a transition for each pattern
- Backgrounds: ${NV * 3} drawn images at 6K, 6144×3456${NW ? `, and ${NW} wallpapers from Wikimedia Commons` : ''}

## Variants

| Variant | Theme name | What it is | Lowest ANSI contrast | Lowest muted contrast | Lowest text contrast |
| --- | --- | --- | --- | --- | --- |
${variantTable}

The contrast columns show the lowest WCAG contrast ratio against the background, over all ${N} themes. The 6 main ANSI colors and their brights reach at least 4.5:1, the WCAG AA level. The muted color reaches 3.6:1, because Neovim and Helix use it for comments and line numbers. Each variant is a complete Omarchy theme with its own folder, so you can install any mix of them.

## Patterns

Each theme follows 1 of 8 patterns. In every theme, \`accent\` equals the \`blue\` slot, and ${moved} of the ${N} themes move at least 1 slot away from its usual hue.

| Pattern | Themes | Rule |
| --- | --- | --- |
${patternTable}

## Backgrounds

Each variant has ${NW ? 3 + Math.round(NW / NV) : 3} backgrounds. Omarchy shows them in this order. To show the next one, run \`omarchy theme bg next\`.

| File | What it shows |
| --- | --- |
| \`0-omarchy-wordmark.jpg\` | The Omarchy wordmark in the colors of the variant. The treatment follows the pattern: a lightness ladder for Monochrome, a print out of register for Duotone, a pressed wordmark for Earth, and so on. |
| \`1-<scene>.jpg\` | A drawn scene of the theme subject: a moss garden for Kyoto Moss, a fjord for Fjord, a circuit board for Resistor. |
| \`2-palette-card.jpg\` | A data card: the 16 ANSI colors with their contrast, the slots that left their usual hue, and the background and text ramps. |${NW ? `
| \`3-<name>.jpg\`, \`4-<name>.jpg\` | Photographs and artworks from Wikimedia Commons that fit the subject and the colors of the variant: dark images at night and light images in the day. They are between 3840 and 6144 pixels wide, cropped to 16:9. Each theme section lists their credits. |` : ''}

## Install

\`install.sh\` copies themes into \`~/.config/omarchy/themes\`. Each theme variant becomes a normal Omarchy theme folder. The script installs the night and day variants of a theme unless you name one with \`--variant\`.

### Install one theme without a clone

The script downloads only the themes that you name:

\`\`\`bash
curl -fsSL ${SITE}/install.sh | bash -s -- kyoto-moss --set
\`\`\`

To install one variant only, add \`--variant\`:

\`\`\`bash
curl -fsSL ${SITE}/install.sh | bash -s -- kyoto-moss fjord --variant day
\`\`\`

\`--set\` applies the first installed variant of the last theme.

### Install from a clone

\`\`\`bash
git clone --depth 1 ${REPO} ~/.local/share/various-themes
cd ~/.local/share/various-themes
./install.sh --all
omarchy theme set kyoto-moss-night
\`\`\`

The full repo is about ${sizeMb} MB because it has ${NV * 3} backgrounds at 6K. To download less, use the \`curl\` command above. It downloads only the folders that you name.

### Options

| Command | Result |
| --- | --- |
| \`install.sh kyoto-moss fjord\` | Installs the night and day variants of the named themes |
| \`install.sh kyoto-moss --variant day\` | Installs only this variant |
| \`install.sh --all\` | Installs all ${NV} themes |
| \`install.sh --list\` | Lists the ${N} theme names |
| \`install.sh kyoto-moss --set\` | Installs the theme, then applies its night variant |
| \`install.sh --update\` | Installs again every theme variant that the script installed |
| \`install.sh --remove kyoto-moss\` | Removes the variants of a theme that the script installed |
| \`install.sh --link kyoto-moss\` | Links to the clone instead of copying. Run \`git pull\` in the clone to update. |
| \`install.sh --force kyoto-moss\` | Replaces a theme with the same name that the script did not install |

The variant names are \`night\` and \`day\`. The script writes a \`.various-themes\` marker file in each theme that it copies. \`--update\` and \`--remove\` use this file, so they never change a theme that you made.

### Apply with Aether

[Aether](https://github.com/omacom/aether) can apply a theme straight from the [site](${SITE}). Select a theme, pick a variant and a background, and select 1 of these buttons:

| Button | Result |
| --- | --- |
| Apply with Aether | Aether loads the palette and the background, then applies them at once through its own theme. |
| Install as Omarchy theme | Aether adds the variant to \`~/.config/omarchy/themes\` and activates it at once. This stops if a theme with the same name exists, for example after \`install.sh\`. |
| Open in editor | Aether opens the palette in its editor. Nothing changes until you select Apply. |

Aether stops a download after 60 seconds. On a slow connection, a 6K background can take longer, so the links download a 3840×2160 copy from \`site/assets/aether/\`. GitHub does not render \`aether://\` links, so use the site or build a link yourself:

\`\`\`text
aether://apply?colors=${SITE}/kyoto-moss/night/colors.toml&wallpaper=${SITE}/assets/aether/kyoto-moss/night/1-moss-garden.jpg&silent=true
\`\`\`

Add \`&as_omarchy_theme=kyoto-moss-night\` to install the variant. Use \`&edit=true\` instead of \`&silent=true\` to open the editor.

### Name conflicts

All theme names end in \`-night\` or \`-day\`, so they do not collide with the themes that ship with Omarchy. The names also differ from the themes of [100-themes](https://github.com/bjarneo/100-themes), [coffee-themes](https://github.com/bjarneo/coffee-themes) and [mineral-themes](https://github.com/bjarneo/mineral-themes). The script does not replace a theme that it did not install. If \`~/.config/omarchy/themes/kyoto-moss-night\` exists, the script skips it and tells you. Rename your theme, or use \`--force\` to replace it.

\`omarchy theme install <url>\` does not work with this repo. That command expects one theme at the root of a repo.

## Switch themes and backgrounds

\`\`\`bash
omarchy theme set kyoto-moss-night   # apply a theme
omarchy theme set kyoto-moss-day     # the same theme in daylight
omarchy theme bg next                # show the next background of the current theme
\`\`\`

## The collection

| Pattern | Themes |
| --- | --- |
${menu}

${sections}
`;

writeFileSync(join(ROOT, 'README.md'), readme);
console.log(`wrote README.md (${themes.length} themes)`);
