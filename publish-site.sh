#!/usr/bin/env bash
# Publishes Coast to markhammond.me: copies the game from a commit of this repo into play/coast/ of the site's repo,
# with three.js and the fonts served from the site's own copies, commits that folder alone on the branch checked out
# there and pushes that branch to itself and to master, whose GitHub Action deploys the site to Cloudflare. Any other
# commits on that branch not yet on master go out with it.
#
#   ./publish-site.sh [commit]        default: HEAD
#
# The pre-push hook (.git/hooks/pre-push) runs this whenever main is pushed. Only committed files go out: the game is
# exported from the commit, never taken from the working tree. The testbenches and the source recordings in
# "village sounds/" are not published.
set -euo pipefail
cd "$(dirname "$0")"

REV="${1:-HEAD}"
SITE="${SITE_DIR:-$HOME/code/markhammond.me}"
DEST="$SITE/play/coast"
FILES=(index.html sounds.json sounds cat photo people)

SHA="$(git rev-parse --short "$REV")"
BUILD="$(git rev-list --count "$REV") ($SHA)"
[ -d "$DEST/vendor/three" ] && [ -f "$DEST/fonts/fonts.css" ] || { echo "publish-site: $DEST lacks vendor/three or fonts/" >&2; exit 1; }
# The site's work is done on the branch checked out there (gallery), which is pushed to its own branch and to master,
# from which the site deploys; master must only move forward.
BR="$(git -C "$SITE" branch --show-current)"
[ -n "$BR" ] || { echo "publish-site: $SITE is not on a branch" >&2; exit 1; }
git -C "$SITE" fetch -q origin
git -C "$SITE" merge-base --is-ancestor origin/master "$BR" || { echo "publish-site: $BR in $SITE does not contain origin/master" >&2; exit 1; }

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
chmod 755 "$tmp"   # mktemp's 700 would otherwise be copied onto play/coast
git archive "$REV" -- "${FILES[@]}" | tar -x -C "$tmp"

# the build number, and the three replacements that make the page load nothing from other sites
python3 - "$tmp/index.html" "$BUILD" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
# the build number shown in the About box: the number of commits, and the commit
if s.count("'__COAST_BUILD__'") != 1: sys.exit('publish-site: the build number placeholder in index.html is not as expected')
s = s.replace("'__COAST_BUILD__'", "'" + sys.argv[2] + "'")
fonts = ('<link rel="preconnect" href="https://fonts.googleapis.com">\n'
         '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
         '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus&family=Alegreya+Sans:ital,wght@0,400;0,500;0,700;1,400&display=swap">')
cdn = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js'
if s.count(fonts) != 1 or s.count(cdn) != 2:
    sys.exit('publish-site: the font links or the three.js address in index.html are not as expected; update this script')
s = s.replace(fonts, '<link rel="stylesheet" href="fonts/fonts.css">').replace(cdn, './vendor/three/build/three.module.js')
for host in ('fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net', 'unpkg.com'):
    if host in s: sys.exit('publish-site: index.html still refers to ' + host)
open(p, 'w').write(s)
PY

rsync -a --delete --exclude .DS_Store --exclude /vendor --exclude /fonts "$tmp/" "$DEST/"

if git -C "$SITE" diff --quiet -- play/coast && [ -z "$(git -C "$SITE" ls-files --others --exclude-standard -- play/coast)" ]; then
  echo "publish-site: play/coast already matches $SHA"; exit 0
fi

# the subjects of the commits since the last one published, for the site's commit message
last="$(git -C "$SITE" log -1 --format=%B --grep='^Coast commit [0-9a-f]\{7,\}' -- play/coast | sed -n 's/^Coast commit \([0-9a-f]*\).*/\1/p' | head -1)"
if [ -n "$last" ] && git cat-file -e "$last^{commit}" 2>/dev/null && git merge-base --is-ancestor "$last" "$REV"; then
  log="$(git log --reverse --format='- %s' "$last..$REV" -- "${FILES[@]}")"
else
  log="$(git log -1 --format='- %s' "$REV")"
fi

git -C "$SITE" add -A -- play/coast
git -C "$SITE" commit -q -m "Update Coast to commit $SHA of the village repository" -m "$log" -m "Coast commit $SHA" -- play/coast
git -C "$SITE" push -q origin "$BR" "$BR:master"
echo "publish-site: published Coast $SHA to markhammond.me from $BR (the site's Deploy action takes a minute or two)"
