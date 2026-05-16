#!/usr/bin/env bash
# Build a clean .zip of the extension for Chrome Web Store submission.
#
# Usage: ./scripts/package.sh
# Output: dist/highlighter-<version>.zip

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Pull version from manifest.json without requiring jq
VERSION=$(grep -E '"version"\s*:' manifest.json | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/')
if [ -z "$VERSION" ]; then
  echo "Could not read version from manifest.json" >&2
  exit 1
fi

OUT_DIR="dist"
OUT_FILE="$OUT_DIR/highlighter-$VERSION.zip"

mkdir -p "$OUT_DIR"
rm -f "$OUT_FILE"

# Files / folders that ship in the extension.
# Everything not listed here (docs/, scripts/, .git/, README.md, .gitignore,
# dist/, .DS_Store) is intentionally excluded from the Web Store package.
INCLUDE=(
  manifest.json
  background.js
  content.js
  content.css
  drawing.js
  drawing.css
  popup.html
  popup.js
  library.html
  library.js
  options.html
  options.js
  tabs.js
  welcome.html
  welcome.js
  icons
)

# Verify every required file/folder exists before zipping
for path in "${INCLUDE[@]}"; do
  if [ ! -e "$path" ]; then
    echo "Missing required file: $path" >&2
    exit 1
  fi
done

# Build the zip
zip -rq "$OUT_FILE" "${INCLUDE[@]}" -x '*.DS_Store' -x '__MACOSX/*'

# Report size + contents
SIZE=$(du -h "$OUT_FILE" | cut -f1)
COUNT=$(unzip -l "$OUT_FILE" | tail -1 | awk '{print $2}')

echo "✓ Built $OUT_FILE ($SIZE, $COUNT files)"
echo ""
echo "Contents:"
zipinfo -1 "$OUT_FILE" | sed 's/^/  /'
echo ""
echo "Next steps:"
echo "  1. Open https://chrome.google.com/webstore/devconsole"
echo "  2. Click 'New Item' → upload $OUT_FILE"
echo "  3. Fill in store listing (title, description, screenshots, category)"
echo "  4. Privacy policy URL: https://finnjclancy.github.io/highlighter/privacy.html"
echo "  5. Submit for review"
