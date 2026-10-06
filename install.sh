#!/bin/bash

# Installs various themes from this repo into ~/.config/omarchy/themes.
# Each theme has 2 variants: night and day.
#
# Usage:
#   install.sh [options] <theme>...
#   install.sh [options] --all
#
# Options:
#   --variant <list>  install only these variants, for example day
#   --all             install all 100 themes
#   --list            list the theme names
#   --set             apply the last named theme after the install
#   --link            link to this clone instead of copying the files
#   --force           replace a theme with the same name that this script did not install
#   --update          install again every theme that this script installed
#   --remove          remove the named themes that this script installed
#   -h, --help        show this help
#
# Installed names: kyoto-moss-night and kyoto-moss-day.
#
# Examples:
#   ./install.sh kyoto-moss --variant night --set
#   ./install.sh --all --variant day
#   curl -fsSL https://bjarneo.github.io/various-themes/install.sh | bash -s -- kyoto-moss --set
#
# Without a clone, the script downloads only the themes that you name.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/bjarneo/various-themes}"
THEMES_DIR="${OMARCHY_THEMES_DIR:-$HOME/.config/omarchy/themes}"
MARKER=".various-themes"
ORDER=(night day)
declare -A SUFFIX=([night]="-night" [day]="-day")

usage() {
  sed -n '3,28p' "${BASH_SOURCE[0]:-}" 2>/dev/null | sed 's/^# \{0,1\}//' && return
  echo "Usage: install.sh [--variant <list>] [--all | --list | --update | --remove] [--set] [--link] [--force] <theme>..."
}

say() { printf '%s\n' "$*"; }
warn() { printf '%s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }

# Theme names are folder names. Anything else never reaches a path.
valid_slug() { [[ $1 =~ ^[a-z0-9][a-z0-9-]*$ ]]; }

mode=install
all=0 set=0 link=0 force=0
slugs=()
variants=("${ORDER[@]}")

while (( $# > 0 )); do
  case "$1" in
    --variant)
      [[ -n ${2:-} ]] || die "--variant needs a list, for example day"
      IFS=',' read -ra variants <<<"$2"
      for v in "${variants[@]}"; do [[ -n ${SUFFIX[$v]+x} ]] || die "Unknown variant: $v. Use ${ORDER[*]}."; done
      shift ;;
    --all) all=1 ;;
    --list) mode=list ;;
    --update) mode=update ;;
    --remove) mode=remove ;;
    --set) set=1 ;;
    --link) link=1 ;;
    --force) force=1 ;;
    -h | --help) usage; exit 0 ;;
    -*) die "Unknown option: $1. Run install.sh --help." ;;
    *) valid_slug "$1" || die "Not a theme name: $1"; slugs+=("$1") ;;
  esac
  shift
done

# Use this clone when the script runs from one. Otherwise download the repo.
SOURCE=""
script_dir=""
if [[ -n ${BASH_SOURCE[0]:-} && -f ${BASH_SOURCE[0]} ]]; then
  script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
fi
if [[ -n $script_dir ]] && compgen -G "$script_dir/*/night/colors.toml" >/dev/null; then
  SOURCE=$script_dir
fi

tmp=""
# An if keeps the exit code at 0 when there is no temporary clone.
cleanup() { if [[ -n $tmp ]]; then rm -rf "$tmp"; fi; }
trap cleanup EXIT

# Lists the themes in the source, one name per line.
available() {
  if [[ -n $SOURCE ]]; then
    for file in "$SOURCE"/*/night/colors.toml; do
      dir=${file%/night/colors.toml}
      printf '%s\n' "${dir##*/}"
    done
  else
    git -C "$tmp" ls-tree -r --name-only HEAD | sed -n 's#^\([a-z0-9-]*\)/night/colors.toml$#\1#p'
  fi
}

# Clones the repo without file contents when the script has no clone.
clone() {
  [[ -n $SOURCE ]] && return
  command -v git >/dev/null || die "git is not installed. Install git, then run the script again."
  tmp=$(mktemp -d)
  warn "Downloading from $REPO_URL"
  git clone --quiet --depth 1 --filter=blob:none --sparse "$REPO_URL" "$tmp/repo"
  tmp="$tmp/repo"
}

# Downloads only the given <theme>/<variant> folders into the clone.
checkout() {
  [[ -n $SOURCE ]] && return
  (( $# > 0 )) && git -C "$tmp" sparse-checkout set "$@"
  return 0
}

# True when this script installed the theme: a copy with the marker file,
# or a link into a clone of this repo.
installed_by_us() {
  local target="$THEMES_DIR/$1" real
  [[ -f $target/$MARKER ]] && return 0
  [[ -L $target ]] || return 1
  real=$(readlink -f "$target")
  [[ -f $real/colors.toml && -f ${real%/*/*}/install.sh ]]
}

install_one() {
  local name="$1" src="$2" slug="$3" variant="$4" target="$THEMES_DIR/$1"

  if [[ -e $target || -L $target ]]; then
    if ! installed_by_us "$name" && (( ! force )); then
      warn "Skip $name: $target already exists. Use --force to replace it."
      return 1
    fi
  fi

  mkdir -p "$THEMES_DIR"

  if (( link )); then
    [[ -n $SOURCE ]] || die "--link needs a clone. Clone $REPO_URL, then run ./install.sh --link."
    rm -rf "${target:?}"
    ln -s "$src" "$target"
    say "Linked $name"
    return 0
  fi

  # Copy to a temporary folder first, so a failed copy never leaves half a theme.
  local staging="$THEMES_DIR/.$name.installing"
  rm -rf "${staging:?}"
  mkdir -p "$staging"
  cp -r "$src"/. "$staging"/
  printf 'Installed by install.sh from %s\ntheme=%s\nvariant=%s\n' "$REPO_URL" "$slug" "$variant" >"$staging/$MARKER"
  rm -rf "${target:?}"
  mv "$staging" "$target"
  say "Installed $name"
}

# Each job is one <theme>/<variant> pair.
jobs=()

case $mode in
  list)
    clone
    available
    exit 0
    ;;

  remove)
    (( ${#slugs[@]} > 0 )) || die "Name the themes to remove. Example: install.sh --remove kyoto-moss"
    for slug in "${slugs[@]}"; do
      for v in "${variants[@]}"; do
        name="$slug${SUFFIX[$v]}"
        target="$THEMES_DIR/$name"
        if [[ ! -e $target && ! -L $target ]]; then
          continue
        elif installed_by_us "$name"; then
          rm -rf "${target:?}"
          say "Removed $name"
        else
          warn "Skip $name: this script did not install $target"
        fi
      done
    done
    exit 0
    ;;

  update)
    # Each marker names its theme and variant.
    for marker in "$THEMES_DIR"/*/"$MARKER"; do
      [[ -f $marker ]] || continue
      theme=$(sed -n 's/^theme=//p' "$marker")
      variant=$(sed -n 's/^variant=//p' "$marker")
      valid_slug "$theme" && [[ -n ${SUFFIX[$variant]+x} ]] || continue
      jobs+=("$theme/$variant")
    done
    (( ${#jobs[@]} > 0 )) || die "No themes from this repo are installed in $THEMES_DIR"
    clone
    ;;

  install)
    clone
    if (( all )); then
      mapfile -t slugs < <(available)
    fi
    (( ${#slugs[@]} > 0 )) || { usage; exit 1; }
    for slug in "${slugs[@]}"; do for v in "${variants[@]}"; do jobs+=("$slug/$v"); done; done
    ;;
esac

checkout "${jobs[@]}"
root=${SOURCE:-$tmp}
count=0
last=""
declare -A found=() missing=()
for job in "${jobs[@]}"; do
  slug=${job%/*} v=${job#*/}
  if [[ ! -f $root/$slug/$v/colors.toml ]]; then
    missing[$slug]=1
    continue
  fi
  found[$slug]=1
  name="$slug${SUFFIX[$v]}"
  if install_one "$name" "$root/$slug/$v" "$slug" "$v"; then
    count=$((count + 1))
    # --set applies the first installed variant of the last theme.
    if [[ ${last_slug:-} != "$slug" ]]; then last=$name; last_slug=$slug; fi
  fi
done
for slug in "${!missing[@]}"; do
  [[ -n ${found[$slug]:-} ]] || warn "Skip $slug: no such theme. Run install.sh --list to see the names."
done

say "$count theme(s) in $THEMES_DIR"

if (( set )) && [[ -n $last ]]; then
  if command -v omarchy >/dev/null; then
    omarchy theme set "$last"
  else
    warn "The omarchy command is not available. Run: omarchy theme set $last"
  fi
elif [[ -n $last ]]; then
  say "Apply one with: omarchy theme set $last"
fi
