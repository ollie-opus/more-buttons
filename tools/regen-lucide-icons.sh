#!/usr/bin/env bash
# Regenerate config/lucideIcons.json from the lucide icon set bundled with the
# zensical install in the opus-knowledge-base repo. Run after a zensical
# upgrade so the picker offers exactly the icons the site build can resolve.
#
# Usage: tools/regen-lucide-icons.sh [path-to-lucide-icons-dir]
set -euo pipefail

DEFAULT_DIR="$HOME/Desktop/stuff/opus-knowledge-base/.venv/lib/python3.14/site-packages/zensical/templates/.icons/lucide"
ICONS_DIR="${1:-$DEFAULT_DIR}"
OUT="$(cd "$(dirname "$0")/.." && pwd)/config/lucideIcons.json"

ls "$ICONS_DIR" | grep '\.svg$' | sed 's/\.svg$//' | sort | python3 -c '
import json, sys
names = [line.strip() for line in sys.stdin if line.strip()]
if not names:
    sys.exit(f"No icon names read — refusing to overwrite {sys.argv[1]}")
json.dump(names, open(sys.argv[1], "w"))
print(f"Wrote {len(names)} icon names")
' "$OUT"
echo "→ $OUT"
