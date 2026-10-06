// Palette source for all themes in this repo. Each theme has a night variant
// and a day variant. The table sets the character of each theme: its pattern,
// its background, its foreground, and the hue, chroma and contrast of each of
// the 6 ANSI slots. The math under the table turns each row into 2 complete
// Omarchy palettes. It changes the OKLCH lightness of each color until the
// color reaches its contrast target against the background.
//
// The rules:
//   - The blue slot carries the identity color, and accent equals blue.
//   - A slot can leave its usual hue, so yellow can hold a green and blue
//     can hold a jade.
//   - dark_background and darker_background sit 25% and 50% toward black.
//   - lighter_background sits a little above the background. In a light
//     theme it sits below, because it marks a raised surface.

// The 8 patterns.
export const PATTERNS = {
  family: {
    label: 'Family and pops', short: 'Family',
    desc: 'Most slots come from 1 hue family. Red and 1 or 2 other slots stay as pops. The brights of the family slots turn into pale tints.',
  },
  mono: {
    label: 'Monochrome', short: 'Mono',
    desc: 'All 6 slots stay inside 1 hue band. A lightness ladder keeps the slots apart, and the brights are pale tints.',
  },
  duotone: {
    label: 'Duotone and triad', short: 'Duotone',
    desc: '2 or 3 hue families share the 6 slots. The window border is a gradient between 2 of them.',
  },
  analogous: {
    label: 'Analogous', short: 'Analogous',
    desc: 'The 6 slots spread along 1 arc of the color wheel. No slot takes the opposite hue.',
  },
  earth: {
    label: 'Earth', short: 'Earth',
    desc: 'Chroma stays low. Earth hues fill all slots, so cyan can be gold and blue can be olive.',
  },
  signal: {
    label: 'Grey and signal', short: 'Signal',
    desc: 'Most slots are neutral greys. 1 or 2 slots carry a signal color.',
  },
  spectrum: {
    label: 'Tuned spectrum', short: 'Spectrum',
    desc: 'All 6 hues stay in their usual slots. 1 chroma and lightness mood ties them together.',
  },
  pastel: {
    label: 'Pastel', short: 'Pastel',
    desc: 'The normal colors keep a mid chroma. The brights turn into near-white tints, and the foreground takes a contrasting hue.',
  },
};

// How each pattern makes its bright colors, and how far the day contrast
// spreads compared to night. A day color with a high contrast turns muddy, so
// most patterns use half of the night spread.
const PATTERN_RULES = {
  family: { bright: 'auto', dayFactor: .5 },
  mono: { bright: 'tint', dayFactor: 1 },
  duotone: { bright: 'lift', dayFactor: .5 },
  analogous: { bright: 'lift', dayFactor: .5 },
  earth: { bright: 'soft', dayFactor: .5 },
  signal: { bright: 'grey', dayFactor: 1 },
  spectrum: { bright: 'lift', dayFactor: .5 },
  pastel: { bright: 'tint', dayFactor: .5 },
};

// ---------- the table ----------
//
// Each row: [name, pattern, description, options]
//   bg      night background as OKLCH [lightness, chroma, hue]
//   fg      foreground as [hue, chroma] or [hue, chroma, contrast]
//   slots   'hue chroma contrast' for red, green, yellow, blue, magenta and
//           cyan, in ANSI order. The contrast is the night target against the
//           background. The blue slot is also the accent.
//   bright  how the brights follow the normal colors: lift, tint, soft or
//           same, for all slots or 1 word per slot. A slot can also take its
//           own 'hue chroma contrast'.
//   orange  'hue chroma contrast'. The default sits between red and yellow.
//   border  the 2 slots of the window border gradient
//   day     changes for the day variant: bg as OKLCH, fg as [hue, chroma]
//   scene   the native background as [motif, variant]

const TABLE = [
  // Family and pops
  ['Flamingo', 'family', 'A flock of flamingos in a shallow lagoon. Coral and flamingo pinks fill 4 slots. The lagoon teal stays in green and cyan.',
    { bg: [.19, .035, 5], fg: [35, .03], slots: '22 .17 5.4, 180 .1 7.6, 50 .12 9.4, 8 .15 6.4, 345 .15 6, 195 .07 8.6', border: ['blue', 'green'], scene: ['birds', 'flamingos'] }],
  ['Oxblood', 'family', 'Burgundy leather with brass studs. Deep reds fill 4 slots. Brass and a patina teal stay as pops.',
    { bg: [.16, .03, 18], fg: [65, .03], slots: '24 .16 5.2, 180 .07 7.2, 82 .11 9.2, 12 .12 6.4, 355 .11 5.8, 35 .07 8.4', border: ['blue', 'yellow'], scene: ['textile', 'tufted-leather'] }],
  ['Poppy Field', 'family', 'Red poppies in a green field. Poppy reds fill 4 slots. Stem green and sage stay as pops.',
    { bg: [.18, .03, 28], fg: [70, .02], slots: '24 .19 5.2, 140 .11 7.2, 52 .14 9.2, 36 .17 6.6, 355 .13 5.8, 150 .05 8.4', day: { bg: [.972, .012, 70] }, border: ['blue', 'green'], scene: ['garden', 'poppies'] }],
  ['Brickwork', 'family', 'An old brick wall with ivy. Brick oranges fill 4 slots. Ivy green and slate blue stay as pops.',
    { bg: [.19, .022, 40], fg: [75, .022], slots: '30 .15 5.2, 140 .1 7.2, 68 .1 9.2, 44 .13 6.4, 16 .1 6, 240 .05 8.2', border: ['blue', 'green'], scene: ['tiles', 'brick-wall'] }],
  ['Persimmon', 'family', 'Ripe persimmons on a bare branch. Persimmon oranges fill 4 slots. Leaf green and dusk violet stay as pops.',
    { bg: [.18, .03, 50], fg: [80, .03], slots: '32 .16 5.4, 130 .11 7.4, 72 .13 9.6, 54 .15 6.6, 290 .1 6, 82 .07 8.6', border: ['blue', 'magenta'], scene: ['fruit', 'persimmons'] }],
  ['Marigold', 'family', 'Marigold garlands in the sun. Golds and oranges fill 4 slots. Maroon and leaf green stay as pops.',
    { bg: [.18, .03, 68], fg: [88, .03], slots: '15 .13 5.2, 138 .1 7.2, 88 .14 9.8, 70 .15 6.8, 48 .14 6, 105 .07 8.2', day: { bg: [.972, .02, 88] }, border: ['blue', 'red'], scene: ['garden', 'marigolds'] }],
  ['Honeycomb', 'family', 'Wax cells full of honey. Ambers and golds fill 4 slots. Clover pink and sky blue stay as pops.',
    { bg: [.15, .035, 60], fg: [90, .04], slots: '355 .13 5.4, 230 .08 7.2, 92 .14 9.8, 76 .14 6.8, 55 .12 6, 100 .06 8.8', border: ['blue', 'green'], scene: ['fruit', 'honeycomb'] }],
  ['Mimosa', 'family', 'Mimosa blossoms on silver leaves. Yellows fill 3 slots. Silver green, rose and a pale sky stay as pops.',
    { bg: [.19, .02, 110], fg: [100, .03], slots: '12 .12 5.4, 150 .05 7.4, 100 .14 9.8, 96 .13 7.2, 80 .1 6.2, 175 .04 8.4', border: ['blue', 'green'], scene: ['garden', 'mimosa'] }],
  ['Mangrove', 'family', 'Mangrove roots in brackish water. Olives fill 4 slots. Crab red and water teal stay as pops.',
    { bg: [.17, .025, 115], fg: [100, .025], slots: '30 .15 5.4, 128 .1 7.2, 95 .1 9.2, 112 .09 6.6, 70 .07 6, 195 .07 8.2', border: ['blue', 'cyan'], scene: ['landscape', 'mangrove'] }],
  ['Absinthe', 'family', 'A glass of absinthe with a sugar cube. Chartreuse greens fill 4 slots. Bitter red and wormwood violet stay as pops.',
    { bg: [.16, .03, 125], fg: [105, .02], slots: '25 .16 5.4, 142 .14 7.8, 112 .15 9.8, 122 .16 6.4, 305 .12 6, 150 .09 8.6', border: ['blue', 'magenta'], scene: ['glass', 'absinthe'] }],
  ['Pistachio', 'family', 'Shelled pistachios on a warm brown board. Pistachio greens fill 3 slots. The red skin and the tan shell stay as pops.',
    { bg: [.19, .022, 70], fg: [95, .03], slots: '12 .13 5.4, 138 .11 7.6, 78 .07 9.2, 120 .11 6.4, 340 .1 6, 145 .06 8.8', day: { bg: [.97, .018, 105] }, border: ['blue', 'red'], scene: ['fruit', 'pistachios'] }],
  ['Kyoto Moss', 'family', 'A moss garden at a temple in Kyoto. Moss greens fill 4 slots. Torii vermilion and plum blossom stay as pops.',
    { bg: [.19, .025, 150], fg: [95, .035], slots: '35 .17 5.4, 140 .12 7.4, 112 .11 9.4, 150 .1 6.2, 350 .12 6, 168 .07 8.4', bright: 'lift, tint, 95 .13 12, tint, lift, tint', border: ['blue', 'red'], scene: ['landscape', 'moss-garden'] }],
  ['Celadon', 'family', 'A celadon bowl with a crackled glaze. Grey greens fill 3 slots. Iron red, peach bloom and cobalt stay as pops.',
    { bg: [.21, .02, 165], fg: [150, .015], slots: '30 .12 5.4, 148 .07 7.6, 118 .06 9.2, 168 .075 6.2, 355 .07 6, 255 .08 8.2', day: { bg: [.965, .014, 160] }, border: ['blue', 'cyan'], scene: ['ceramic', 'celadon-bowl'] }],
  ['Spruce', 'family', 'A spruce forest in fresh snow. Conifer blue greens fill 4 slots. Berry red and lingonberry pink stay as pops.',
    { bg: [.17, .03, 172], fg: [220, .01], slots: '18 .16 5.4, 155 .1 7.4, 125 .08 9.2, 172 .1 6.2, 340 .1 6, 192 .07 8.6', border: ['blue', 'red'], scene: ['landscape', 'spruce-forest'] }],
  ['Verdigris', 'family', 'Copper roofs with a green patina. Patina teals fill 3 slots. Copper, brass and rust stay as pops.',
    { bg: [.19, .03, 190], fg: [170, .02], slots: '42 .14 5.4, 160 .1 7.6, 85 .11 9.2, 184 .1 6.4, 22 .09 6, 198 .06 8.8', border: ['blue', 'red'], scene: ['metal', 'patina'] }],
  ['Seaglass', 'family', 'Frosted glass pebbles on a sandy beach. Soft aquas fill 3 slots. Coral, shell pink and driftwood stay as pops.',
    { bg: [.21, .025, 205], fg: [195, .02], slots: '25 .13 5.4, 168 .08 7.4, 72 .07 9.2, 196 .08 6.6, 345 .08 6, 212 .06 8.6', day: { bg: [.965, .016, 85] }, border: ['blue', 'red'], scene: ['water', 'sea-glass'] }],
  ['Peacock', 'family', 'The eye of a peacock feather. Peacock blues and greens fill 3 slots. Gold, violet and copper stay as pops.',
    { bg: [.16, .04, 225], fg: [200, .02], slots: '28 .15 5.4, 162 .12 7.4, 90 .13 9.6, 215 .12 6.6, 295 .13 6.2, 192 .1 8.4', border: ['blue', 'green'], scene: ['birds', 'peacock-feather'] }],
  ['Kingfisher', 'family', 'A kingfisher over a river. Cyan blues fill 4 slots. Its rufous orange breast stays as the pop.',
    { bg: [.17, .035, 238], fg: [220, .015], slots: '40 .15 5.4, 185 .1 7.4, 62 .12 9.4, 228 .13 6.6, 262 .1 6, 205 .11 8.6', border: ['blue', 'yellow'], scene: ['birds', 'kingfisher'] }],
  ['Fjord', 'family', 'A Norwegian fjord in winter. Slate blues fill 4 slots on a lighter base. Falu red and aurora green stay as pops.',
    { bg: [.27, .025, 245], fg: [235, .015, 11], slots: '25 .14 4.9, 155 .1 6.4, 220 .05 8.4, 245 .07 5.6, 290 .07 5, 210 .06 7.2', border: ['blue', 'green'], scene: ['landscape', 'fjord'] }],
  ['Delft', 'family', 'Blue and white tiles from Delft. Cobalt blues fill 4 slots, on glaze white in the day variant. Iron red and copper green stay as pops.',
    { bg: [.18, .04, 262], fg: [250, .015], slots: '28 .15 5.4, 150 .1 7.2, 250 .05 9.8, 264 .15 6.6, 290 .1 6, 225 .1 8', day: { bg: [.975, .008, 250], fg: [262, .06] }, border: ['blue', 'cyan'], scene: ['tiles', 'delft-tiles'] }],
  ['Shibori', 'family', 'Indigo cloth dyed with folds and ties. Indigo blues fill 4 slots. Madder red and weld yellow stay as pops.',
    { bg: [.15, .035, 270], fg: [80, .02], slots: '25 .14 5.4, 205 .06 7.2, 95 .12 9.4, 270 .11 6.4, 292 .08 6, 245 .07 8.4', border: ['blue', 'yellow'], scene: ['textile', 'shibori'] }],
  ['Iris', 'family', 'Bearded irises in bloom. Violets fill 4 slots. The gold and orange of the beards stay as pops.',
    { bg: [.18, .04, 290], fg: [300, .015], slots: '38 .15 5.4, 272 .1 7.4, 88 .14 9.6, 288 .14 6.4, 312 .12 6, 262 .07 8.6', border: ['blue', 'yellow'], scene: ['garden', 'irises'] }],
  ['Wisteria', 'family', 'Wisteria hanging from a pergola. Lavenders fill 4 slots. Leaf green and blush pink stay as pops.',
    { bg: [.2, .03, 305], fg: [305, .015], slots: '0 .13 5.4, 138 .1 7.2, 320 .06 9.4, 305 .11 6.6, 330 .11 5.8, 285 .07 8.4', day: { bg: [.97, .012, 305] }, border: ['blue', 'green'], scene: ['garden', 'wisteria'] }],
  ['Aubergine', 'family', 'Glossy aubergines with green calyxes. Eggplant purples fill 3 slots. Calyx green, the cream flesh and a red stay as pops.',
    { bg: [.16, .04, 315], fg: [320, .015], slots: '10 .14 5.4, 145 .11 7.4, 88 .08 9.4, 315 .12 6.6, 335 .13 6, 295 .08 8.4', border: ['blue', 'green'], scene: ['fruit', 'aubergines'] }],
  ['Bougainvillea', 'family', 'Bougainvillea over a white wall. Hot magentas fill 4 slots. Leaf green and terracotta stay as pops.',
    { bg: [.18, .04, 340], fg: [90, .01], slots: '18 .17 5.4, 140 .12 7.4, 48 .1 9.2, 340 .17 6.6, 318 .14 6, 355 .07 8.6', border: ['blue', 'green'], scene: ['garden', 'bougainvillea'] }],
  ['Peony', 'family', 'Peonies in full bloom. Peony pinks fill 4 slots. Leaf green and stamen gold stay as pops.',
    { bg: [.19, .03, 355], fg: [10, .015], slots: '18 .15 5.2, 135 .09 7.2, 92 .13 9.6, 355 .14 6.6, 335 .12 6, 10 .06 8.6', day: { bg: [.975, .012, 0] }, border: ['blue', 'green'], scene: ['garden', 'peonies'] }],

  // Monochrome
  ['Darkroom', 'mono', 'A photo darkroom under a red safelight. Every slot is a red, and a lightness ladder keeps the slots apart.',
    { bg: [.13, .02, 25], fg: [28, .05, 11.5], slots: '25 .2 4.8, 40 .15 6.6, 52 .12 9.6, 20 .18 5.8, 8 .14 7.8, 35 .07 11', border: ['blue', 'yellow'], scene: ['light', 'darkroom'] }],
  ['Oxide', 'mono', 'Iron oxide on old steel. Every slot is a rust orange.',
    { bg: [.17, .028, 45], fg: [55, .035], slots: '32 .15 4.8, 58 .12 6.6, 72 .1 9.6, 44 .14 5.8, 22 .11 7.8, 62 .06 11', border: ['blue', 'yellow'], scene: ['metal', 'rust'] }],
  ['Sepia', 'mono', 'An old photograph in sepia tones. Every slot is a brown, on aged paper in the day variant.',
    { bg: [.17, .02, 65], fg: [72, .03], slots: '42 .1 4.8, 76 .07 6.6, 86 .08 9.6, 60 .09 5.8, 30 .07 7.8, 70 .04 11', day: { bg: [.945, .03, 80] }, border: ['blue', 'yellow'], scene: ['paper', 'old-photo'] }],
  ['Brass', 'mono', 'Polished brass on smoked black. Every slot is a brass yellow.',
    { bg: [.15, .015, 90], fg: [95, .04], slots: '70 .12 4.8, 102 .11 6.6, 95 .13 9.6, 86 .12 5.8, 78 .09 7.8, 108 .06 11', border: ['blue', 'cyan'], scene: ['metal', 'brass'] }],
  ['Bottle Glass', 'mono', 'Old green bottles on a windowsill. Every slot is a bottle green.',
    { bg: [.16, .03, 152], fg: [150, .03], slots: '138 .11 4.8, 152 .13 6.6, 125 .1 9.6, 158 .11 5.8, 168 .09 7.8, 145 .05 11', border: ['blue', 'yellow'], scene: ['glass', 'bottles'] }],
  ['Viridian', 'mono', 'Viridian pigment ground in oil. Every slot is a blue green.',
    { bg: [.18, .03, 172], fg: [172, .025], slots: '162 .12 4.8, 178 .12 6.6, 158 .1 9.6, 170 .12 5.8, 186 .09 7.8, 168 .05 11', border: ['blue', 'yellow'], scene: ['paint', 'oil-paint'] }],
  ['Seafoam', 'mono', 'Sea foam on a pale shore. Every slot is an aqua, on white in the day variant.',
    { bg: [.2, .03, 195], fg: [192, .02], slots: '186 .1 4.8, 198 .1 6.6, 178 .09 9.6, 194 .11 5.8, 208 .08 7.8, 190 .05 11', day: { bg: [.97, .015, 190] }, border: ['blue', 'yellow'], scene: ['water', 'sea-foam'] }],
  ['Petrol', 'mono', 'Petrol blue, deep and cool. Every slot is a blue teal.',
    { bg: [.17, .035, 222], fg: [215, .02], slots: '210 .1 4.8, 226 .1 6.6, 204 .08 9.6, 218 .11 5.8, 234 .09 7.8, 212 .05 11', border: ['blue', 'yellow'], scene: ['paint', 'marbling'] }],
  ['Blueprint', 'mono', 'A technical drawing on blueprint paper. Every slot is a pale blue on a saturated blue background.',
    { bg: [.32, .12, 258], fg: [250, .02, 11], slots: '258 .1 4.6, 245 .08 5.6, 250 .05 8, 262 .09 5, 270 .08 6.6, 240 .04 9.5', day: { bg: [.975, .01, 255], fg: [258, .1] }, border: ['blue', 'cyan'], scene: ['paper', 'blueprint'] }],
  ['Heliotrope', 'mono', 'Heliotrope flowers in late summer. Every slot is a violet.',
    { bg: [.16, .04, 300], fg: [300, .025], slots: '318 .13 4.8, 292 .12 6.6, 284 .09 9.6, 302 .14 5.8, 325 .11 7.8, 296 .06 11', border: ['blue', 'magenta'], scene: ['garden', 'heliotrope'] }],
  ['Mauve', 'mono', 'Dusty mauve, the color of the first aniline dye. Every slot is a muted mauve.',
    { bg: [.19, .025, 335], fg: [335, .02], slots: '348 .1 4.8, 322 .08 6.6, 352 .07 9.6, 332 .09 5.8, 315 .09 7.8, 340 .04 11', border: ['blue', 'magenta'], scene: ['textile', 'silk'] }],
  ['Bordeaux', 'mono', 'Red wine from Bordeaux. Every slot is a wine red.',
    { bg: [.15, .035, 5], fg: [10, .03], slots: '12 .15 4.8, 355 .12 6.6, 22 .1 9.6, 2 .14 5.8, 345 .12 7.8, 15 .05 11', border: ['blue', 'magenta'], scene: ['glass', 'wine'] }],

  // Duotone and triad
  ['Anaglyph', 'duotone', 'Red and cyan 3D glasses. Reds fill 3 slots and cyans fill 3 slots.',
    { bg: [.14, .01, 250], fg: [250, .01], slots: '25 .19 5.4, 195 .1 7.6, 42 .13 9.4, 202 .12 6.6, 12 .16 6, 210 .07 8.8', border: ['red', 'blue'], scene: ['light', 'anaglyph'] }],
  ['Byzantine', 'duotone', 'A gold mosaic under a blue dome. Ultramarine fills 3 slots and gold fills 2. Porphyry red marks errors.',
    { bg: [.14, .045, 268], fg: [82, .035], slots: '25 .15 5.4, 255 .1 7.2, 90 .14 9.6, 268 .17 6.4, 72 .12 6.2, 245 .08 8.6', border: ['blue', 'yellow'], scene: ['tiles', 'mosaic'] }],
  ['Regatta', 'duotone', 'Sailboats at a regatta. Navy blues fill 3 slots and signal oranges fill 3 slots.',
    { bg: [.17, .04, 255], fg: [240, .015], slots: '30 .17 5.4, 232 .08 7.2, 58 .15 9.4, 255 .13 6.4, 18 .14 6, 242 .06 8.8', day: { bg: [.975, .006, 240], fg: [255, .07] }, border: ['blue', 'yellow'], scene: ['water', 'regatta'] }],
  ['Poolside', 'duotone', 'A pool in the sun with pink tiles and palms. Pool blues fill 3 slots. Pinks fill 2 and palm green fills 1.',
    { bg: [.2, .035, 228], fg: [220, .015], slots: '0 .14 5.4, 150 .1 7.2, 30 .12 9.4, 228 .12 6.4, 340 .12 6, 212 .09 8.6', day: { bg: [.97, .015, 210] }, border: ['blue', 'red'], scene: ['water', 'pool'] }],
  ['Reading Room', 'duotone', 'A library with green desk lamps and brass rails. Lamp greens fill 3 slots. Brass and mahogany fill 3 slots.',
    { bg: [.16, .02, 55], fg: [85, .035], slots: '30 .13 5.4, 145 .12 7.6, 86 .12 9.4, 158 .11 6, 48 .1 6.2, 170 .07 8.8', border: ['blue', 'yellow'], scene: ['interior', 'reading-room'] }],
  ['Infrared', 'duotone', 'Infrared photographs turn leaves pink and skies dark. Pinks fill 3 slots and red marks errors. The teal sky fills 2.',
    { bg: [.15, .03, 225], fg: [350, .02], slots: '28 .17 5.4, 340 .14 7.4, 15 .1 9.4, 205 .11 6.4, 320 .14 6, 195 .08 8.6', border: ['magenta', 'blue'], scene: ['landscape', 'infrared'] }],
  ['Cross Process', 'duotone', 'Slide film developed in the wrong chemicals. Cyan greens fill 3 slots and acid yellow fills 1. Magenta and red casts fill 2.',
    { bg: [.16, .03, 190], fg: [105, .04], slots: '22 .14 5.4, 168 .13 7.2, 105 .16 9.8, 186 .12 6.4, 345 .13 6, 200 .09 8.6', border: ['blue', 'yellow'], scene: ['light', 'cross-process'] }],
  ['Lava Lamp', 'duotone', 'Wax rising in a lava lamp. Oranges fill 3 slots and magentas fill 3 slots.',
    { bg: [.14, .04, 330], fg: [50, .03], slots: '22 .17 5.4, 58 .15 7.4, 78 .14 9.6, 345 .17 6.4, 320 .15 6, 0 .09 8.6', border: ['blue', 'green'], scene: ['glass', 'lava-lamp'] }],
  ['Koi Pond', 'duotone', 'Koi under lily pads in a dark pond. Koi oranges and reds fill 3 slots. Pond greens fill 3 slots.',
    { bg: [.16, .03, 175], fg: [100, .015], slots: '30 .16 5.4, 150 .1 7.2, 62 .15 9.4, 172 .09 6.4, 15 .12 6, 188 .07 8.6', border: ['blue', 'yellow'], scene: ['water', 'koi-pond'] }],
  ['Bauhaus', 'duotone', 'Primary shapes on a Bauhaus poster. Red, yellow and blue fill all 6 slots, on off-white in the day variant.',
    { bg: [.16, .005, 90], fg: [90, .006], slots: '28 .19 5.4, 248 .12 7.4, 95 .17 9.8, 265 .17 6.2, 45 .16 6.6, 230 .08 8.8', day: { bg: [.955, .012, 90] }, border: ['blue', 'red'], scene: ['tiles', 'bauhaus'] }],
  ['Nightshade', 'duotone', 'Purple nightshade flowers with yellow centers. Purples fill 3 slots. Yellow greens fill 2, and a berry red marks errors.',
    { bg: [.15, .04, 300], fg: [110, .025], slots: '355 .15 5.4, 125 .15 7.6, 105 .14 9.6, 300 .15 6.4, 320 .14 6, 285 .08 8.6', border: ['blue', 'green'], scene: ['garden', 'nightshade'] }],
  ['Strawberry Mint', 'duotone', 'Strawberries with fresh mint. Strawberry pinks fill 3 slots and mint fills 2. The seeds add a yellow.',
    { bg: [.18, .03, 352], fg: [350, .015], slots: '15 .17 5.4, 165 .12 7.4, 95 .11 9.4, 352 .15 6.4, 332 .12 6, 175 .08 8.6', day: { bg: [.975, .01, 350] }, border: ['blue', 'green'], scene: ['fruit', 'strawberries'] }],
  ['Aperitivo', 'duotone', 'A bitter orange aperitivo with green olives. Bitter reds and oranges fill 4 slots. Olive fills 2.',
    { bg: [.16, .025, 35], fg: [80, .03], slots: '24 .18 5.4, 118 .11 7.2, 62 .15 9.4, 38 .16 6.4, 5 .13 6.2, 128 .06 8.6', border: ['blue', 'green'], scene: ['glass', 'aperitivo'] }],
  ['Mid Century', 'duotone', 'A walnut sideboard with teal and mustard. Teals fill 3 slots. Mustard, burnt orange and rust fill 3 slots.',
    { bg: [.18, .025, 55], fg: [85, .03], slots: '40 .15 5.4, 180 .09 7.6, 86 .13 9.4, 200 .1 6.2, 25 .12 6, 212 .07 8.8', border: ['blue', 'yellow'], scene: ['tiles', 'atomic'] }],
  ['Rhubarb Custard', 'duotone', 'Pink rhubarb with yellow custard. Rhubarb pinks fill 3 slots and custard yellows fill 2. Leaf green fills 1.',
    { bg: [.17, .03, 10], fg: [95, .03], slots: '18 .16 5.4, 130 .1 7.2, 95 .14 9.6, 355 .14 6.4, 338 .12 6, 88 .07 8.8', border: ['blue', 'yellow'], scene: ['fruit', 'rhubarb'] }],

  // Analogous
  ['Hydrangea', 'analogous', 'Hydrangea heads from blue to pink. The slots run from blue through violet to pink.',
    { bg: [.18, .035, 280], fg: [280, .02], slots: '350 .15 5.4, 250 .11 7.4, 322 .09 9.4, 270 .13 6.4, 308 .14 6, 236 .08 8.6', border: ['blue', 'red'], scene: ['garden', 'hydrangea'] }],
  ['Forge', 'analogous', 'A blacksmith forge with hot iron. The slots run from red through orange to yellow, and the brights glow white hot.',
    { bg: [.14, .015, 40], fg: [70, .025], slots: '25 .19 5.4, 88 .14 7.6, 98 .15 10, 52 .17 6.6, 15 .16 5.8, 75 .09 8.8', bright: 'tint', border: ['blue', 'red'], scene: ['fire', 'forge'] }],
  ['Jewel Beetle', 'analogous', 'The shell of a jewel beetle. The slots run from green through teal and blue to violet.',
    { bg: [.14, .04, 200], fg: [180, .02], slots: '292 .14 5.4, 150 .15 7.6, 122 .12 9.6, 205 .13 6.6, 265 .14 6, 178 .1 8.6', border: ['green', 'magenta'], scene: ['birds', 'beetle'] }],
  ['Thermal', 'analogous', 'A heat map from a thermal camera. The slots run from violet through magenta and red to yellow.',
    { bg: [.13, .03, 290], fg: [80, .02], slots: '18 .18 5.2, 55 .16 7.6, 95 .16 10, 332 .16 6.2, 300 .14 5.6, 75 .09 9', border: ['magenta', 'yellow'], scene: ['light', 'thermal'] }],
  ['Meadow', 'analogous', 'A summer meadow in the sun. The slots run from gold through green to teal.',
    { bg: [.19, .03, 140], fg: [100, .02], slots: '72 .14 5.4, 140 .13 7.4, 102 .14 9.6, 160 .1 6.4, 122 .1 6, 178 .08 8.6', day: { bg: [.97, .02, 110] }, border: ['blue', 'red'], scene: ['landscape', 'meadow'] }],
  ['Kelp', 'analogous', 'A kelp forest under the sea. The slots run from brown through olive to sea green.',
    { bg: [.14, .03, 170], fg: [150, .02], slots: '55 .1 5.4, 128 .11 7.4, 92 .11 9.4, 152 .09 6.4, 76 .09 6, 174 .07 8.6', border: ['blue', 'red'], scene: ['water', 'kelp-forest'] }],
  ['Grapefruit', 'analogous', 'Pink grapefruit cut in half. The slots run from magenta through pink and coral to orange.',
    { bg: [.19, .03, 15], fg: [40, .02], slots: '10 .16 5.4, 62 .13 7.6, 75 .13 9.8, 30 .15 6.4, 340 .14 6, 50 .08 8.8', day: { bg: [.975, .012, 40] }, border: ['blue', 'magenta'], scene: ['fruit', 'grapefruit'] }],
  ['Mariana', 'analogous', 'The deep sea, where light comes from animals. The slots run from teal through blue to indigo, and the brights glow cyan.',
    { bg: [.12, .04, 250], fg: [215, .02], slots: '280 .14 5.4, 178 .12 7.2, 210 .07 10.2, 238 .14 6.4, 262 .13 6, 196 .12 8.6', bright: 'lift, 180 .14 11, 205 .1 13, lift, lift, 192 .14 12.5', border: ['blue', 'green'], scene: ['water', 'deep-sea'] }],
  ['Bramble', 'analogous', 'Blackberries on a thorny bramble. The slots run from violet through magenta to berry red.',
    { bg: [.15, .035, 330], fg: [340, .02], slots: '15 .16 5.4, 298 .13 7.4, 350 .09 9.6, 330 .15 6.4, 310 .14 5.6, 285 .08 8.6', border: ['blue', 'red'], scene: ['fruit', 'blackberries'] }],
  ['Ice Cave', 'analogous', 'Light through the walls of an ice cave. The slots run from cyan through blue to violet.',
    { bg: [.18, .03, 235], fg: [220, .015], slots: '285 .12 5.4, 190 .1 7.2, 220 .06 10, 242 .12 6.4, 265 .11 6, 205 .09 8.6', day: { bg: [.98, .008, 220] }, border: ['blue', 'green'], scene: ['ice', 'ice-cave'] }],

  // Earth
  ['Peat', 'earth', 'A peat bog after rain. Bog browns, sphagnum green and dark water fill the slots.',
    { bg: [.16, .015, 70], fg: [85, .025], slots: '40 .08 5, 125 .07 6.8, 86 .07 8.8, 68 .07 6.2, 355 .05 5.8, 165 .04 7.8', border: ['blue', 'green'], scene: ['landscape', 'peat-bog'] }],
  ['Terracotta', 'earth', 'Clay pots in a dry garden. Clay reds, olive and a faded sky fill the slots.',
    { bg: [.19, .02, 45], fg: [70, .025], slots: '30 .1 5.2, 115 .07 7.2, 78 .08 9, 42 .1 6.4, 5 .07 6, 230 .04 8.4', border: ['blue', 'green'], scene: ['ceramic', 'terracotta-pots'] }],
  ['Tweed', 'earth', 'A tweed jacket up close. Wool brown with flecks of rust, moss, mustard, heather and slate.',
    { bg: [.2, .012, 60], fg: [70, .02], slots: '35 .09 5.4, 130 .06 7.2, 82 .07 9, 240 .045 6.4, 340 .05 6, 200 .035 8.4', border: ['blue', 'red'], scene: ['textile', 'tweed'] }],
  ['Driftwood', 'earth', 'Bleached driftwood with sea glass. Grey browns sit with soft sea glass greens and blues.',
    { bg: [.2, .01, 70], fg: [75, .015], slots: '30 .07 5.4, 165 .05 7.2, 80 .05 9, 200 .045 6.4, 15 .045 6, 190 .035 8.8', day: { bg: [.955, .012, 80] }, border: ['blue', 'green'], scene: ['texture', 'driftwood'] }],
  ['Olive Grove', 'earth', 'An olive grove on a dry hillside. Olive greens, silver leaves and red soil fill the slots.',
    { bg: [.19, .02, 105], fg: [100, .025], slots: '40 .09 5.4, 130 .08 7.6, 95 .08 9.2, 110 .08 6, 350 .05 6, 150 .035 8.6', border: ['blue', 'red'], scene: ['landscape', 'olive-grove'] }],
  ['Eucalyptus', 'earth', 'Eucalyptus leaves and gum nuts. Silver blue greens fill most slots, and a gum nut red marks errors.',
    { bg: [.2, .018, 175], fg: [170, .015], slots: '30 .1 5.4, 158 .06 7.2, 110 .06 9, 186 .055 6.4, 12 .06 6, 202 .04 8.4', border: ['blue', 'red'], scene: ['garden', 'eucalyptus'] }],
  ['Lichen', 'earth', 'Lichen on grey stone. Stone greys, sage, and lichen oranges and yellows fill the slots.',
    { bg: [.21, .01, 120], fg: [110, .015], slots: '42 .11 5.4, 140 .06 7.2, 92 .08 9, 75 .09 6.4, 25 .07 6, 170 .035 8.4', day: { bg: [.95, .01, 100] }, border: ['blue', 'green'], scene: ['texture', 'lichen'] }],
  ['Herbarium', 'earth', 'Pressed plants on an old herbarium sheet. Faded greens and browns sit on paper in the day variant.',
    { bg: [.19, .015, 85], fg: [88, .02], slots: '35 .08 5.4, 120 .07 7.6, 80 .07 9, 148 .06 6.2, 355 .05 6, 165 .04 8.6', day: { bg: [.955, .022, 88] }, border: ['blue', 'red'], scene: ['paper', 'herbarium'] }],
  ['Antique Map', 'earth', 'An antique map on parchment. Faded red, green, ochre and sea blue inks fill the slots.',
    { bg: [.18, .02, 75], fg: [85, .03], slots: '30 .1 5.4, 135 .06 7.2, 80 .08 9, 235 .06 6.4, 350 .06 6, 205 .045 8.4', day: { bg: [.935, .035, 85] }, border: ['blue', 'red'], scene: ['paper', 'old-map'] }],
  ['Bracken', 'earth', 'Bracken ferns in autumn. Rust browns and dried golds fill the slots.',
    { bg: [.17, .025, 50], fg: [75, .03], slots: '32 .1 5.4, 100 .07 7.2, 88 .09 9.2, 72 .09 6.4, 20 .07 6, 125 .04 8.4', border: ['blue', 'red'], scene: ['garden', 'bracken'] }],
  ['Adobe', 'earth', 'An adobe house with turquoise trim. Sun baked clay, sage and turquoise fill the slots.',
    { bg: [.2, .02, 55], fg: [70, .025], slots: '35 .1 5.4, 140 .06 7.2, 75 .08 9, 195 .07 6.4, 10 .06 6, 180 .05 8.4', day: { bg: [.95, .02, 65] }, border: ['blue', 'red'], scene: ['interior', 'adobe'] }],
  ['Moorland', 'earth', 'A moor with heather and bracken. Muted heather, rust, moss and a grey sky fill the slots.',
    { bg: [.18, .02, 330], fg: [330, .015], slots: '35 .09 5.4, 125 .06 7.2, 85 .07 9, 325 .06 6.4, 290 .055 5.4, 210 .035 8.4', border: ['blue', 'red'], scene: ['landscape', 'moor'] }],

  // Grey and signal
  ['Sumi', 'signal', 'Sumi ink on rice paper with a red seal. Ink greys fill 5 slots, and vermilion fills red.',
    { bg: [.16, .004, 80], fg: [80, .006], slots: '30 .18 5.6, 85 .006 7.6, 85 .008 10.8, 260 .012 6.2, 60 .006 4.8, 85 .005 9', day: { bg: [.96, .01, 85] }, border: ['red', 'blue'], scene: ['paper', 'ink-wash'] }],
  ['Newsprint', 'signal', 'A newspaper page with the blue pencil of an editor. Ink greys fill 4 slots. Blue pencil fills blue, and a faded red marks errors.',
    { bg: [.18, .006, 250], fg: [90, .005], slots: '25 .1 5.4, 90 .005 7.6, 90 .007 10.8, 255 .15 6.2, 90 .004 4.8, 245 .05 9', day: { bg: [.93, .008, 90] }, border: ['blue', 'yellow'], scene: ['paper', 'newsprint'] }],
  ['Brutalist', 'signal', 'Raw concrete with a safety orange sign. Concrete greys fill 4 slots. Safety orange fills blue, and a muted red marks errors.',
    { bg: [.2, .004, 90], fg: [90, .004], slots: '22 .1 5.2, 90 .004 7.6, 90 .006 10.8, 55 .18 6.6, 90 .003 4.8, 90 .005 9', border: ['blue', 'yellow'], scene: ['interior', 'concrete'] }],
  ['Gunmetal', 'signal', 'Machined gunmetal with a cyan readout. Blue grey steel fills 4 slots, and cyan fills blue.',
    { bg: [.2, .012, 250], fg: [240, .01], slots: '20 .1 5.4, 250 .012 7.6, 250 .014 10.8, 205 .14 6.6, 250 .01 4.8, 245 .016 9', border: ['blue', 'yellow'], scene: ['metal', 'machined'] }],
  ['Nitrate', 'signal', 'Silver nitrate film in a projector beam. Silver greys fill 4 slots, and projector amber fills blue.',
    { bg: [.15, .006, 70], fg: [70, .01], slots: '25 .1 5.4, 70 .006 7.6, 70 .008 10.8, 72 .14 6.6, 70 .005 4.8, 70 .007 9', border: ['blue', 'yellow'], scene: ['light', 'film-reel'] }],
  ['Chalkboard', 'signal', 'Chalk on a green slate board. Chalk greys fill 3 slots. Yellow, pink and red chalk fill the rest.',
    { bg: [.26, .025, 165], fg: [100, .01, 11], slots: '25 .13 5, 165 .02 6.4, 95 .12 8.4, 345 .1 5.6, 165 .015 4.6, 200 .04 7.6', border: ['blue', 'yellow'], scene: ['paper', 'chalkboard'] }],
  ['Overcast', 'signal', 'A grey sky with a break of sun. Cloud greys fill 4 slots. Sun yellow fills blue, and a muted red marks errors.',
    { bg: [.22, .008, 240], fg: [240, .008], slots: '22 .1 5.4, 240 .008 7.6, 240 .01 10.8, 90 .14 7.6, 240 .006 4.8, 240 .012 9', day: { bg: [.95, .006, 240] }, border: ['blue', 'yellow'], scene: ['sky', 'overcast'] }],
  ['Carbon', 'signal', 'Carbon fiber with a lime signal. Carbon greys fill 4 slots. Lime fills blue, and a muted red marks errors.',
    { bg: [.13, .004, 250], fg: [250, .005], slots: '22 .11 5.4, 250 .004 7.6, 250 .006 10.8, 128 .2 7.6, 250 .003 4.8, 250 .005 9', border: ['blue', 'yellow'], scene: ['metal', 'carbon-fiber'] }],

  // Tuned spectrum
  ['Stained Glass', 'spectrum', 'Light through a stained glass window. Ruby, emerald, amber, sapphire, amethyst and aqua fill their usual slots.',
    { bg: [.14, .01, 270], fg: [80, .02], slots: '20 .2 5.4, 152 .17 7.6, 78 .16 9.4, 264 .18 6.4, 318 .18 6.2, 205 .13 8.6', border: ['blue', 'magenta'], scene: ['tiles', 'stained-glass'] }],
  ['Gouache', 'spectrum', 'Matte gouache paint on a warm grey board. Mid chroma pigments fill their usual slots.',
    { bg: [.23, .012, 65], fg: [80, .02], slots: '28 .14 5, 140 .11 6.6, 86 .12 8.6, 248 .11 5.6, 345 .11 5.4, 195 .08 7.2', bright: 'same', border: ['blue', 'red'], scene: ['paint', 'gouache'] }],
  ['Tapestry', 'spectrum', 'A woven tapestry in old plant dyes. Faded madder, weld and woad fill their usual slots.',
    { bg: [.18, .02, 55], fg: [80, .03], slots: '30 .12 5.4, 128 .08 7.2, 86 .1 9.2, 250 .08 6.4, 348 .08 6, 212 .06 8.4', bright: 'soft', border: ['blue', 'red'], scene: ['textile', 'tapestry'] }],
  ['Harbor', 'spectrum', 'A harbor at night. Port red and starboard green are bright, and sodium lamps add a yellow.',
    { bg: [.16, .035, 250], fg: [230, .015], slots: '25 .18 5.6, 150 .16 7.6, 85 .13 9.6, 242 .1 6.4, 320 .1 6, 200 .08 8.4', border: ['red', 'green'], scene: ['water', 'harbor'] }],
  ['Resistor', 'spectrum', 'Resistors on a green circuit board. The resistor band colors fill their usual slots, and gold fills blue.',
    { bg: [.2, .05, 160], fg: [100, .02], slots: '28 .17 5.4, 140 .14 7.6, 98 .15 9.8, 82 .13 6.6, 300 .14 6, 255 .12 7.4', orange: '50 .15 7.8', border: ['blue', 'red'], scene: ['circuit', 'circuit-board'] }],
  ['Planetarium', 'spectrum', 'Stars on the dome of a planetarium. Star colors run from blue white to red, with nebula green and pink.',
    { bg: [.12, .03, 265], fg: [250, .01], slots: '32 .15 5.6, 160 .09 7.4, 88 .1 9.8, 255 .12 6.6, 330 .1 6, 220 .07 8.8', border: ['blue', 'red'], scene: ['sky', 'planetarium'] }],
  ['Night Garden', 'spectrum', 'A garden by moonlight. Rose, leaf, primrose, moonflower and phlox colors fill their usual slots.',
    { bg: [.15, .025, 155], fg: [120, .015], slots: '15 .13 5.4, 140 .1 7.2, 95 .11 9.4, 275 .11 6.4, 330 .12 6, 200 .07 8.4', border: ['blue', 'magenta'], scene: ['garden', 'moonlit-garden'] }],
  ['Pebble', 'spectrum', 'River pebbles on a warm grey base. Soft mid tones fill their usual slots.',
    { bg: [.29, .01, 75], fg: [80, .02, 10.5], slots: '25 .09 4.6, 135 .07 5.6, 85 .08 7.2, 222 .06 5, 345 .065 4.8, 185 .05 6.2', bright: 'same', border: ['blue', 'green'], scene: ['texture', 'pebbles'] }],
  ['Fresco', 'spectrum', 'A fresco on lime plaster. Earth pigments fill their usual slots: sinopia red, green earth, ochre and azurite.',
    { bg: [.2, .012, 70], fg: [80, .02], slots: '35 .1 5.2, 150 .07 6.8, 80 .09 8.8, 245 .08 6, 355 .07 5.6, 200 .06 7.6', bright: 'soft', day: { bg: [.94, .018, 80] }, border: ['blue', 'red'], scene: ['paint', 'fresco'] }],
  ['Tin Toy', 'spectrum', 'A tin toy in bright lithograph colors. Vivid primaries fill their usual slots, on cream in the day variant.',
    { bg: [.18, .02, 255], fg: [90, .015], slots: '30 .19 5.4, 140 .16 7.4, 95 .16 9.8, 260 .17 6.4, 345 .17 6, 215 .12 8.4', day: { bg: [.965, .02, 90] }, border: ['blue', 'red'], scene: ['tiles', 'tin-litho'] }],
  ['Watercolor', 'spectrum', 'Watercolor washes on white paper. Soft clear colors fill their usual slots.',
    { bg: [.19, .015, 260], fg: [250, .015], slots: '15 .12 5.2, 155 .09 7, 85 .1 9, 250 .1 6, 330 .1 5.8, 210 .08 7.8', day: { bg: [.975, .006, 90] }, border: ['blue', 'magenta'], scene: ['paint', 'watercolor'] }],

  // Pastel
  ['Nacre', 'pastel', 'The inside of a pearl shell. Pearl tints sit on deep sea navy, and the text has a soft pearl pink.',
    { bg: [.15, .035, 240], fg: [350, .02], slots: '15 .12 5.6, 165 .08 7.4, 85 .09 9.4, 270 .1 6.4, 330 .1 6.2, 205 .07 8.6', border: ['blue', 'magenta'], scene: ['texture', 'nacre'] }],
  ['Sherbet', 'pastel', 'Orange, raspberry and lime sherbet. Soft pastels sit on charcoal.',
    { bg: [.2, .008, 300], fg: [60, .03], slots: '12 .14 5.6, 130 .12 7.4, 78 .11 9.4, 48 .13 6.4, 350 .12 6.2, 175 .08 8.6', border: ['blue', 'red'], scene: ['glass', 'sherbet'] }],
  ['Gelato', 'pastel', 'Gelato in a shop window. Pistachio, strawberry and vanilla pastels sit on espresso brown.',
    { bg: [.18, .02, 50], fg: [90, .035], slots: '15 .13 5.6, 130 .09 7.4, 92 .08 9.6, 72 .1 6.4, 350 .1 6.2, 190 .06 8.6', border: ['blue', 'green'], scene: ['glass', 'gelato'] }],
  ['Rosewater', 'pastel', 'Rose petals in rosewater. Rose and peach pastels sit on plum black.',
    { bg: [.16, .03, 340], fg: [30, .04], slots: '10 .13 5.6, 150 .07 7.4, 70 .08 9.4, 332 .1 6.4, 305 .1 6.2, 220 .06 8.6', border: ['blue', 'yellow'], scene: ['garden', 'rose-petals'] }],
  ['Pastel Goth', 'pastel', 'Pink, lilac and mint on black. Pastel colors sit on a near black background.',
    { bg: [.13, .006, 300], fg: [320, .03], slots: '355 .13 5.6, 168 .1 7.4, 95 .08 9.6, 300 .1 6.4, 330 .12 6.2, 205 .08 8.6', border: ['blue', 'red'], scene: ['night', 'moon-charms'] }],
  ['Mochi', 'pastel', 'Soft mochi in pastel colors. Sakura pink, matcha and kinako sit on rice white in the day variant.',
    { bg: [.19, .015, 20], fg: [60, .02], slots: '20 .13 5.4, 135 .09 7.4, 88 .09 9.4, 355 .1 6.4, 320 .09 6.2, 200 .06 8.6', day: { bg: [.975, .008, 60] }, border: ['blue', 'green'], scene: ['fruit', 'mochi'] }],
];

// ---------- color math ----------

// OKLCH to linear sRGB.
function lin(L, C, h) {
  h *= Math.PI / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + .3963377774 * a + .2158037573 * b) ** 3;
  const m = (L - .1055613458 * a - .0638541728 * b) ** 3;
  const s = (L - .0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + .2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - .3413193965 * s,
    -.0041960863 * l - .7034186147 * m + 1.707614701 * s,
  ];
}

// OKLCH to hex. Chroma drops until the color fits in sRGB.
export function oklchHex(L, C, h) {
  L = Math.min(1, Math.max(0, L));
  let c = Math.max(0, C), r = lin(L, c, h);
  while (c > 0 && r.some(v => v < -.0005 || v > 1.0005)) { c = Math.max(0, c - .002); r = lin(L, c, h); }
  return '#' + r.map(v => {
    v = Math.min(1, Math.max(0, v));
    v = v <= .0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - .055;
    return Math.round(v * 255).toString(16).padStart(2, '0');
  }).join('');
}

const toLinear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const channels = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

// Hex to OKLCH.
export function hexOklch(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  const l = Math.cbrt(.4122214708 * r + .5363325363 * g + .0514459929 * b);
  const m = Math.cbrt(.2119034982 * r + .6806995451 * g + .1073969566 * b);
  const s = Math.cbrt(.0883024619 * r + .2817188376 * g + .6299787005 * b);
  const L = .2104542553 * l + .7936177850 * m - .0040720468 * s;
  const A = 1.9779984951 * l - 2.4285922050 * m + .4505937099 * s;
  const B = .0259040371 * l + .7827717662 * m - .8086757660 * s;
  return { L, C: Math.hypot(A, B), h: (Math.atan2(B, A) * 180 / Math.PI + 360) % 360, A, B };
}

// Linear sRGB mix, the same math that Omarchy uses for derived shades.
export function mix(a, b, t) {
  const pa = channels(a), pb = channels(b);
  return '#' + pa.map((v, i) => Math.floor(v * (1 - t) + pb[i] * t + .5).toString(16).padStart(2, '0')).join('');
}

// WCAG contrast ratio of two hex colors.
export function contrast(a, b) {
  const lum = hex => { const [r, g, bl] = channels(hex).map(toLinear); return .2126 * r + .7152 * g + .0722 * bl; };
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

// Distance of 2 colors in OKLab. 0.02 is about the smallest step that people see.
export function oklabDistance(a, b) {
  const p = hexOklch(a), q = hexOklch(b);
  return Math.hypot(p.L - q.L, p.A - q.A, p.B - q.B);
}

// The color with this hue and chroma that reaches the target contrast. A
// night color gets lighter than the background, and a day color gets darker.
function solve(C, h, bg, target, dir) {
  const bgL = hexOklch(bg).L;
  let lo = dir > 0 ? bgL : 0, hi = dir > 0 ? 1 : bgL;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2, k = contrast(oklchHex(mid, C, h), bg);
    if (dir > 0) { if (k < target) lo = mid; else hi = mid; } else { if (k < target) hi = mid; else lo = mid; }
  }
  return oklchHex(dir > 0 ? hi : lo, C, h);
}

const hueDist = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
const hueDelta = (from, to) => ((to - from) % 360 + 540) % 360 - 180;

export function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// A plain name for a color, for the palette card.
export function colorName(hex) {
  const { L, C, h } = hexOklch(hex);
  if (C < .03) {
    const grey = L < .3 ? 'charcoal' : L < .55 ? 'grey' : L < .8 ? 'silver' : 'white';
    return C < .012 ? grey : `${h > 40 && h < 120 ? 'warm' : h > 180 && h < 300 ? 'cool' : 'tinted'} ${grey}`;
  }
  const names = [[12, 'red'], [40, 'red'], [58, 'orange'], [75, 'amber'], [100, 'yellow'], [125, 'chartreuse'], [160, 'green'], [185, 'teal'], [215, 'cyan'], [245, 'sky blue'], [275, 'blue'], [300, 'violet'], [325, 'purple'], [350, 'magenta'], [361, 'pink']];
  let name = names.find(([max]) => h < max)[1];
  if (h >= 350 || h < 12) name = L > .72 ? 'pink' : L > .6 ? 'rose' : 'crimson';
  if (h >= 40 && h < 100 && L < .62 && C < .13) name = h < 75 ? 'brown' : 'olive';
  if (h >= 325 && h < 350 && L > .62) name = L > .75 ? 'pink' : 'rose';
  const tone = L > .86 ? 'pale ' : L < .45 ? 'deep ' : C < .06 ? 'muted ' : '';
  return tone + name;
}

// Usual hue of each slot, to tell when a theme moves a slot to another hue.
export const SLOT_HUES = { red: 25, green: 145, yellow: 95, blue: 260, magenta: 330, cyan: 200 };

// Yaru icon themes that ship with Omarchy, keyed by OKLCH hue.
const YARU = [
  [15, 'Yaru-red'], [45, 'Yaru'], [85, 'Yaru-yellow'], [115, 'Yaru-olive'],
  [150, 'Yaru-sage'], [200, 'Yaru-prussiangreen'], [255, 'Yaru-blue'],
  [300, 'Yaru-purple'], [345, 'Yaru-magenta'], [375, 'Yaru-red'],
];

// The icon theme follows the hue of the accent in the table, so the night and
// day variants of a theme get the same icons. A grey accent hands over to the
// most colorful slot, so Sumi gets red icons for its seal.
function iconTheme(list) {
  let pick = list[3];
  if (pick.c < .03) {
    pick = [...list].sort((a, b) => b.c - a.c)[0];
    if (pick.c < .03) return 'Yaru';
  }
  let best = YARU[0], dist = Infinity;
  for (const entry of YARU) {
    const d = Math.min(Math.abs(entry[0] - pick.h), Math.abs(entry[0] - (pick.h + 360)));
    if (d < dist) { dist = d; best = entry; }
  }
  return best[1];
}

// ---------- palette generator ----------

export const SLOTS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];

// Contrast targets that do not depend on the theme.
const TARGET = {
  night: { fg: 12.5, light: .7, dark: 5, muted: 3.6, min: 4.5 },
  day: { fg: 13, light: 8.5, dark: 5.2, muted: 3.6, min: 4.5, bright: 17 },
};

// 2 slots closer than this in OKLab look like the same color.
export const MIN_DISTANCE = .045;
// Red and green mark removed and added lines in a diff, so they need more room.
export const RED_GREEN_DISTANCE = .08;

const spec = s => { const [h, c, k] = s.trim().split(/\s+/).map(Number); return { h, c, k }; };

// Day contrast for a night contrast.
const dayTarget = (k, f) => TARGET.day.min + .1 + Math.max(0, k - 4.6) * f;

function brightRules(t, list) {
  const rule = t.bright || PATTERN_RULES[t.pattern].bright;
  const words = rule.split(',').map(x => x.trim());
  if (words.length === 6) return words.map(w => (/^[a-z]+$/.test(w) ? w : spec(w)));
  const accent = list[3];
  return list.map(s => {
    if (rule === 'auto') return hueDist(s.h, accent.h) <= 45 ? 'tint' : 'lift';
    if (rule === 'grey') return s.c < .03 ? 'tint' : 'lift';
    return rule;
  });
}

// The normal colors of 1 variant. When 2 slots look the same, they move apart
// in contrast: the one with more contrast gets more, and the other one gets
// less, but never less than the minimum.
function normals(list, bg, mode, f) {
  const dir = mode === 'night' ? 1 : -1;
  const floor = TARGET[mode].min + .05;
  const target = list.map(s => Math.max(floor, mode === 'night' ? s.k : dayTarget(s.k, f)));
  const chroma = s => (mode === 'night' ? s.c : s.c * 1.06);
  const step = mode === 'night' ? .35 : .25;
  let out = [];
  for (let round = 0; round < 40; round++) {
    out = list.map((s, i) => solve(chroma(s), s.h, bg, target[i], dir));
    let moved = false;
    for (let j = 1; j < out.length; j++) {
      for (let i = 0; i < j; i++) {
        const need = (i === 0 && j === 1) ? RED_GREEN_DISTANCE : MIN_DISTANCE;
        if (oklabDistance(out[i], out[j]) >= need) continue;
        const [hi, lo] = target[i] >= target[j] ? [i, j] : [j, i];
        target[hi] += step;
        if (target[lo] - step >= floor) target[lo] -= step; else target[hi] += step;
        moved = true;
      }
    }
    if (!moved) break;
  }
  return out;
}

function brights(list, normal, rules, bg, mode, f) {
  return list.map((s, i) => {
    const r = rules[i], dir = mode === 'night' ? 1 : -1;
    const k = contrast(normal[i], bg);
    if (r === 'same') return normal[i];
    if (typeof r === 'object') return solve(mode === 'night' ? r.c : r.c * 1.06, r.h, bg, mode === 'night' ? r.k : dayTarget(r.k, f) + .6, dir);
    if (mode === 'night') {
      if (r === 'tint') return solve(s.c * .45, s.h, bg, Math.max(k + 3.5, 11), 1);
      if (r === 'soft') return solve(s.c, s.h, bg, k + 1.3, 1);
      return solve(s.c * .9, s.h, bg, k + 2.2, 1);
    }
    if (r === 'tint') return solve(s.c * .8, s.h, bg, k + 2.4, -1);
    if (r === 'soft') return solve(s.c * 1.05, s.h, bg, k + .8, -1);
    return solve(s.c * 1.08, s.h, bg, k + 1.3, -1);
  });
}

// Orange sits between the red and yellow hues of the palette, unless the
// theme sets its own.
function orangeOf(t, list, bg, mode, f) {
  const dir = mode === 'night' ? 1 : -1;
  const o = t.orange ? spec(t.orange) : (() => {
    const r = list[0], y = list[2];
    return { h: (r.h + hueDelta(r.h, y.h) / 2 + 360) % 360, c: (r.c + y.c) / 2, k: (r.k + y.k) / 2 };
  })();
  return solve(mode === 'night' ? o.c : o.c * 1.06, o.h, bg, mode === 'night' ? o.k : dayTarget(o.k, f), dir);
}

function palette(t, mode) {
  const f = PATTERN_RULES[t.pattern].dayFactor;
  const list = t.slots.split(',').map(spec);
  const [bl, bc, bh] = mode === 'night' ? t.bg : (t.day?.bg || [.965, Math.min(Math.max(t.bg[1] * .45, .005), .024), t.bg[2]]);
  const bg = oklchHex(bl, bc, bh);
  const dir = mode === 'night' ? 1 : -1;
  const T = TARGET[mode];

  const normal = normals(list, bg, mode, f);
  const bright = brights(list, normal, brightRules(t, list), bg, mode, f);
  const accent = normal[3];

  const [fh, fc, fk] = t.fg;
  let fg, light, brightFg;
  if (mode === 'night') {
    const k = fk || T.fg;
    fg = solve(fc, fh, bg, k, 1);
    light = solve(fc * .9, fh, bg, Math.max(7.5, k * T.light), 1);
    brightFg = solve(fc * .5, fh, bg, k + 4, 1);
  } else {
    // Day text takes the hue of the day background. A row can set its own.
    const dh = t.day?.fg ? t.day.fg[0] : bh;
    const dc = t.day?.fg ? t.day.fg[1] : Math.min(t.bg[1] * .8 + .008, .045);
    fg = solve(dc, dh, bg, T.fg, -1);
    light = solve(dc * .9, dh, bg, T.light, -1);
    brightFg = solve(dc * .7, dh, bg, T.bright, -1);
  }
  const tint = Math.min(bc + .015, .05);
  const darkFg = solve(tint, bh, bg, T.dark, dir);
  const muted = solve(Math.min(bc * 1.1 + .015, .06), bh, bg, T.muted, dir);

  let lighter, dark, darker, selection;
  if (mode === 'night') {
    lighter = oklchHex(bl + .055, Math.min(bc * 1.35 + .004, .09), bh);
    dark = mix(bg, '#000000', .25);
    darker = mix(bg, '#000000', .5);
    selection = mix(bg, accent, .28);
  } else {
    lighter = oklchHex(bl - .045, Math.min(bc * 1.5 + .004, .04), bh);
    dark = oklchHex(bl - .03, bc * 1.2, bh);
    darker = oklchHex(bl - .07, bc * 1.35, bh);
    selection = mix(bg, accent, .22);
  }
  const orange = orangeOf(t, list, bg, mode, f);
  const [red, green, yellow, blue, magenta, cyan] = normal;
  const colors = {
    mode: mode === 'night' ? 'dark' : 'light',
    accent, selection, muted,
    background: bg, dark_background: dark, darker_background: darker, lighter_background: lighter,
    foreground: fg, dark_foreground: darkFg, light_foreground: light, bright_foreground: brightFg,
    red, yellow, orange, green, cyan, blue, magenta,
    brown: mix(orange, '#000000', .5),
    bright_red: bright[0], bright_yellow: bright[2], bright_green: bright[1], bright_cyan: bright[5], bright_blue: bright[3], bright_magenta: bright[4],
  };
  // The 16 terminal colors in the order that the Omarchy templates write them.
  const ansi = [bg, ...normal, fg, muted, ...bright, brightFg];
  const [b1, b2] = (t.border || ['blue', 'cyan']).map(k => colors[k]);
  return { colors, ansi, border: [b1, b2], icons: iconTheme(list) };
}

// Variant order, labels, and the suffix of the installed theme name.
export const VARIANTS = [
  { key: 'night', label: 'Night', suffix: '-night', mode: 'dark' },
  { key: 'day', label: 'Day', suffix: '-day', mode: 'light' },
];

export const themes = TABLE.map(([name, pattern, desc, o], i) => {
  const slug = slugify(name);
  const t = { pattern, ...o };
  const make = key => {
    const v = VARIANTS.find(x => x.key === key);
    const p = palette(t, key);
    return { variant: key, label: v.label, install: `${slug}${v.suffix}`, name: `${name} ${v.label}`, ansi: p.ansi, border: p.border, icons: p.icons, colors: p.colors };
  };
  const slots = t.slots.split(',').map(spec);
  return {
    index: i + 1, name, slug, pattern, desc,
    motif: o.scene[0], scene: o.scene[1],
    // The slots that sit far from their usual hue.
    moved: SLOTS.filter((k, j) => slots[j].c >= .03 && hueDist(slots[j].h, SLOT_HUES[k]) > 50),
    variants: { night: make('night'), day: make('day') },
  };
});

export function colorsToml(v) {
  const k = v.colors;
  const [a, b] = v.border;
  const border = a === b ? `rgba(${a.slice(1)}ee)` : `rgba(${a.slice(1)}ee) rgba(${b.slice(1)}ee) 45deg`;
  return `mode = "${k.mode}"

accent = "${k.accent}"
selection = "${k.selection}"
muted = "${k.muted}"

background = "${k.background}"
dark_background = "${k.dark_background}"
darker_background = "${k.darker_background}"
lighter_background = "${k.lighter_background}"

foreground = "${k.foreground}"
dark_foreground = "${k.dark_foreground}"
light_foreground = "${k.light_foreground}"
bright_foreground = "${k.bright_foreground}"

hyprland_active_border = "${border}"
hyprland_inactive_border = "rgba(${k.muted.slice(1)}aa)"

red = "${k.red}"
yellow = "${k.yellow}"
orange = "${k.orange}"
green = "${k.green}"
cyan = "${k.cyan}"
blue = "${k.blue}"
magenta = "${k.magenta}"
brown = "${k.brown}"

bright_red = "${k.bright_red}"
bright_yellow = "${k.bright_yellow}"
bright_green = "${k.bright_green}"
bright_cyan = "${k.bright_cyan}"
bright_blue = "${k.bright_blue}"
bright_magenta = "${k.bright_magenta}"
`;
}

export { TABLE };
