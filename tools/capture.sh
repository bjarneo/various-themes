#!/bin/bash

# Applies each theme variant on this desktop and takes a screenshot of one
# workspace. The screenshots become:
#
#   <theme>/<variant>/preview.png               1920 wide, for the Omarchy theme menu
#   site/assets/shots/<theme>/<variant>.webp    1440 wide, for the site
#   .capture/<theme>/<variant>.png              the full screenshot
#   .capture/<theme>/<variant>.toml             the colors.toml that the screenshot shows
#
#   tools/capture.sh                       capture the variants that are missing or old
#   tools/capture.sh kyoto-moss fjord      capture the named themes
#   tools/capture.sh --variant day         capture only this variant
#   tools/capture.sh --force               capture again, even when a screenshot is new
#
# Environment:
#   WORKSPACE   workspace to capture (default 8)
#   DELAY       seconds to wait after each theme change (default 7)
#
# The screenshots show the first background of each variant, the Omarchy
# wordmark, because Omarchy applies it with the theme. A screenshot is old
# when its .toml copy differs from the colors.toml of its variant, so a
# stopped run continues where it stopped. The script turns on do not
# disturb and stay awake while it runs, so no notification or lock screen gets
# into a screenshot. It stops when another workspace becomes active. When it
# stops, it restores the theme, the workspace, do not disturb and stay awake,
# and it removes only the theme links that it added.

set -uo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
THEMES_DIR="$HOME/.config/omarchy/themes"
STATE_DIR="$HOME/.local/state/omarchy/theme-backgrounds"
WORKSPACE=${WORKSPACE:-8}
DELAY=${DELAY:-7}
RAW="$ROOT/.capture"

variants=""
force=0
slugs=()
while (( $# > 0 )); do
  case "$1" in
    --variant) variants="$2"; shift 2 ;;
    --force) force=1; shift ;;
    *) slugs+=("$1"); shift ;;
  esac
done

# One line per capture: <theme> <variant> <installed name>
mapfile -t jobs < <(cd "$ROOT" && VARIANT_LIST="$variants" node -e '
  import("./tools/palettes.mjs").then(({ themes, VARIANTS }) => {
    const only = process.env.VARIANT_LIST ? process.env.VARIANT_LIST.split(",") : VARIANTS.map(v => v.key);
    const names = process.argv.slice(1);
    for (const t of themes) {
      if (names.length && !names.includes(t.slug)) continue;
      for (const { key } of VARIANTS) if (only.includes(key)) console.log(t.slug, key, t.variants[key].install);
    }
  });' "${slugs[@]}")

# Keep only the variants whose screenshot shows other colors than colors.toml.
if (( ! force )); then
  todo=()
  for job in "${jobs[@]}"; do
    read -r slug variant _ <<<"$job"
    [[ -f $RAW/$slug/$variant.png ]] && cmp -s "$RAW/$slug/$variant.toml" "$ROOT/$slug/$variant/colors.toml" || todo+=("$job")
  done
  jobs=("${todo[@]}")
fi
if (( ${#jobs[@]} == 0 )); then
  echo "All screenshots are up to date. Use --force to capture again."
  exit 0
fi

original_theme=$(cat "$HOME/.local/state/omarchy/current/theme.name")
original_workspace=$(hyprctl activeworkspace -j | jq -r .id)
monitor=$(hyprctl monitors -j | jq -r '.[] | select(.focused) | .name')
original_dnd=$(omarchy-shell notifications isDnd 2>/dev/null || echo "")
original_idle=$(omarchy-toggle-idle status | jq -r .enabled)
created=()

# Hyprland with a Lua config takes Lua dispatchers. Older configs take the plain form.
focus_workspace() {
  hyprctl dispatch "hl.dsp.focus({ workspace = \"$1\" })" >/dev/null 2>&1 || hyprctl dispatch workspace "$1" >/dev/null 2>&1
}

restore() {
  wait
  echo "Restoring theme $original_theme and workspace $original_workspace"
  omarchy theme set "$original_theme" >/dev/null 2>&1
  focus_workspace "$original_workspace"
  [[ $original_dnd == "off" ]] && omarchy-shell -q notifications setDnd off
  [[ $original_idle == "false" ]] && omarchy-toggle-idle allow-idle >/dev/null
  for name in "${created[@]}"; do
    rm -f "$THEMES_DIR/$name" "$STATE_DIR/$name"
  done
}
trap restore EXIT

omarchy-shell -q notifications setDnd on
omarchy-toggle-idle stay-awake >/dev/null
focus_workspace "$WORKSPACE"

count=0
for job in "${jobs[@]}"; do
  read -r slug variant install <<<"$job"
  count=$((count + 1))
  src="$ROOT/$slug/$variant"

  # Use a different link name when another theme already has this name.
  name=$install
  if [[ -e $THEMES_DIR/$name && $(readlink -f "$THEMES_DIR/$name") != "$src" ]]; then
    name="$install-capture"
  fi
  if [[ ! -e $THEMES_DIR/$name ]]; then
    ln -s "$src" "$THEMES_DIR/$name"
    created+=("$name")
  fi

  echo "[$count/${#jobs[@]}] $slug $variant"
  omarchy theme set "$name" >/dev/null 2>&1
  focus_workspace "$WORKSPACE"
  sleep "$DELAY"

  # Stop when another workspace is visible, so no other window is captured.
  if [[ $(hyprctl activeworkspace -j | jq -r .id) != "$WORKSPACE" ]]; then
    echo "Workspace $WORKSPACE is not active. Stopping. Run the script again to continue." >&2
    exit 1
  fi
  mkdir -p "$RAW/$slug" "$ROOT/site/assets/shots/$slug"
  grim -o "$monitor" "$RAW/$slug/$variant.png"
  cp "$src/colors.toml" "$RAW/$slug/$variant.toml"

  # The conversions run in the background while the next theme loads.
  magick "$RAW/$slug/$variant.png" -resize 1920x -dither FloydSteinberg -colors 256 "PNG8:$src/preview.png" &
  magick "$RAW/$slug/$variant.png" -resize 1440x -quality 82 "$ROOT/site/assets/shots/$slug/$variant.webp" &
done
wait
