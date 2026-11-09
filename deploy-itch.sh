#!/usr/bin/env bash
# Publishes Coast to itch.io (https://invertedworld.itch.io/coast) with butler.
#
#   ./deploy-itch.sh [commit] [version]       defaults: HEAD, and a UTC timestamp as the version shown on itch
#
# The game is exported from the commit, never taken from the working tree: index.html, sounds.json, sounds/ and
# cat/. As on markhammond.me, the page is pointed at local copies of three.js and of its fonts, so that it loads
# nothing from other sites; those copies are taken from the site's repository (play/coast/vendor and fonts). The
# folder is pushed to the html5 channel of invertedworld/coast. The testbenches and the source recordings in
# "village sounds/" are not published.
#
# One-time setup: butler login (the itch app's own copy of butler is used if butler is not on PATH). The project's
# page on itch must be set to "HTML" with this upload marked "This file will be played in the browser".
set -euo pipefail
cd "$(dirname "$0")"

REV="${1:-HEAD}"
VERSION="${2:-$(date -u +%Y.%m.%d-%H%M)}"
TARGET="invertedworld/coast:html5"
SITE="${SITE_DIR:-$HOME/code/markhammond.me}/play/coast"

BUTLER="${BUTLER:-butler}"
if ! command -v "$BUTLER" >/dev/null 2>&1; then
  BUTLER="$HOME/Library/Application Support/itch/apps/butler/butler"
  [ -x "$BUTLER" ] || { echo "deploy-itch: butler not found; install it and run butler login" >&2; exit 1; }
fi
[ -d "$SITE/vendor/three" ] && [ -f "$SITE/fonts/fonts.css" ] || { echo "deploy-itch: $SITE lacks vendor/three or fonts/" >&2; exit 1; }

build="$(mktemp -d)"; trap 'rm -rf "$build"' EXIT
chmod 755 "$build"
git archive "$REV" -- index.html sounds.json sounds cat photo | tar -x -C "$build"
cp -R "$SITE/vendor" "$SITE/fonts" "$build/"

# the same replacements as publish-site.sh: the build number, and the fonts and three.js from the local copies
BUILD="$(git rev-list --count "$REV") ($(git rev-parse --short "$REV"))"
python3 - "$build/index.html" "$BUILD" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
# the build number shown in the About box: the number of commits, and the commit
if s.count("'__COAST_BUILD__'") != 1: sys.exit('deploy-itch: the build number placeholder in index.html is not as expected')
s = s.replace("'__COAST_BUILD__'", "'" + sys.argv[2] + "'")
fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap">')
cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
if s.count(fonts) != 1 or s.count(cdn) != 2:
    sys.exit('deploy-itch: the font links or the three.js address in index.html are not as expected; update this script')
s = s.replace(fonts, '<link rel="stylesheet" href="fonts/fonts.css">').replace(cdn, './vendor/three/build/three.module.js')
for host in ('fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com'):
    if host in s: sys.exit('deploy-itch: index.html still refers to ' + host)
open(p, 'w').write(s)
PY
find "$build" -name .DS_Store -delete

echo "deploy-itch: pushing $(git rev-parse --short "$REV") to $TARGET as version $VERSION"
"$BUTLER" push "$build" "$TARGET" --userversion "$VERSION"
echo "deploy-itch: done; check processing with: \"$BUTLER\" status $TARGET"
