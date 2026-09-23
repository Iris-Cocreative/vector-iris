#!/bin/bash
# Installs Vector Iris for Illustrator on macOS (current user only).
#
#   ./install.sh          copy the plugin into Adobe's extensions folder
#   ./install.sh --link   symlink it instead, so edits here show up after reopening the panel
#
# Unsigned panels only load when Adobe's "PlayerDebugMode" is on, so this also
# sets that flag for the CEP versions Illustrator 2021 and later use.
# Your Quiver API key is entered in the panel itself, not here.

set -euo pipefail

ID="com.iriscocreative.vectoriris"
SRC="$(cd "$(dirname "$0")" && pwd)"
ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DEST="$ROOT/$ID"

mkdir -p "$ROOT"

# Remove an earlier install. A symlink is removed as a link only, never its target.
if [ -L "$DEST" ]; then rm "$DEST"; elif [ -e "$DEST" ]; then rm -rf "$DEST"; fi

if [ "${1:-}" = "--link" ]; then
  ln -s "$SRC" "$DEST"
  echo "Linked  $DEST  ->  $SRC"
else
  mkdir -p "$DEST"
  for part in CSXS css js jsx index.html LICENSE NOTICE; do
    [ -e "$SRC/$part" ] && cp -R "$SRC/$part" "$DEST/"
  done
  echo "Copied to  $DEST"
fi

# Files downloaded from the web carry a quarantine flag that can stop the panel loading.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

for v in 9 10 11 12 13; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done
# macOS caches preferences; restart the cache so Illustrator sees the new flag.
killall cfprefsd 2>/dev/null || true
echo "Enabled unsigned panels (PlayerDebugMode = 1 for CSXS 9-13)."
echo ""
echo "Done. Quit Illustrator completely (Cmd+Q), reopen it, then Window > Extensions > Vector Iris."
