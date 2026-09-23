#!/bin/bash
# Removes Vector Iris on macOS. The saved API key
# (~/Library/Application Support/IrisCocreative/VectorIris) is left in place.
#
#   ./uninstall.sh                remove the plugin
#   ./uninstall.sh --reset-debug  also turn Adobe's PlayerDebugMode back off
#                                 (skip this if you use other unsigned panels)

set -euo pipefail

DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/com.iriscocreative.vectoriris"

if [ -L "$DEST" ]; then rm "$DEST"; echo "Removed $DEST"
elif [ -e "$DEST" ]; then rm -rf "$DEST"; echo "Removed $DEST"
else echo "Vector Iris is not installed."; fi

if [ "${1:-}" = "--reset-debug" ]; then
  for v in 9 10 11 12 13; do defaults delete "com.adobe.CSXS.$v" PlayerDebugMode 2>/dev/null || true; done
  killall cfprefsd 2>/dev/null || true
  echo "PlayerDebugMode reset."
fi
echo "Restart Illustrator to finish."
