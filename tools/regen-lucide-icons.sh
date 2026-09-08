#!/usr/bin/env bash
# Regenerate the bundled lucide icon set from the zensical install in the
# opus-knowledge-base repo, so the picker offers — and previews — exactly the
# icons the site build renders. Emits two artifacts from one directory pass:
#
#   config/lucideIcons.json       string[] of names   (small, loaded eagerly)
#   config/lucideIconBodies.json  {name: innerSVG}    (~340 KB, loaded lazily)
#
# Names and art come from the same files, so they cannot disagree. Both are
# written one key per line (indent=0, sorted) so a zensical bump diffs as
# named adds/removes/changes rather than one rewritten blob.
#
# Run after a zensical upgrade: bump the pin in the KB's requirements.txt,
# `pip install -r requirements.txt` there, then run this script.
#
# Usage: tools/regen-lucide-icons.sh [path-to-lucide-icons-dir]
set -euo pipefail

DEFAULT_DIR="$HOME/Desktop/stuff/opus-knowledge-base/.venv/lib/python3.14/site-packages/zensical/templates/.icons/lucide"
ICONS_DIR="${1:-$DEFAULT_DIR}"
CONFIG_DIR="$(cd "$(dirname "$0")/.." && pwd)/config"

python3 - "$ICONS_DIR" "$CONFIG_DIR" <<'PY'
import json, os, re, sys

icons_dir, config_dir = sys.argv[1], sys.argv[2]
names_out = os.path.join(config_dir, "lucideIcons.json")
bodies_out = os.path.join(config_dir, "lucideIconBodies.json")

# Every zensical lucide SVG shares this exact envelope; iconPicker.js rebuilds
# it around the stored body. If a future zensical changes its minification
# this assertion fails loudly instead of writing bodies the picker can't wrap.
ENVELOPE = re.compile(
    r'^<svg xmlns="http://www\.w3\.org/2000/svg" fill="none" stroke="currentColor" '
    r'stroke-linecap="round" stroke-linejoin="round" stroke-width="2" '
    r'class="lucide lucide-(?P<name>[a-z0-9-]+)" viewBox="0 0 24 24">(?P<body>.*)</svg>\s*$',
    re.S,
)

bodies = {}
for fname in sorted(os.listdir(icons_dir)):
    if not fname.endswith(".svg"):
        continue
    name = fname[:-4]
    with open(os.path.join(icons_dir, fname), encoding="utf-8") as f:
        svg = f.read()
    m = ENVELOPE.match(svg)
    if not m:
        sys.exit(f"{fname}: unexpected SVG envelope — refusing to write. First 200 chars:\n{svg[:200]}")
    if m.group("name") != name:
        sys.exit(f"{fname}: class says lucide-{m.group('name')} — refusing to write")
    bodies[name] = m.group("body")

if not bodies:
    sys.exit(f"No icons read from {icons_dir} — refusing to overwrite {names_out}")

with open(names_out, "w", encoding="utf-8") as f:
    json.dump(sorted(bodies), f, indent=0)
    f.write("\n")
with open(bodies_out, "w", encoding="utf-8") as f:
    json.dump(bodies, f, indent=0, sort_keys=True)
    f.write("\n")

print(f"Wrote {len(bodies)} icon names → {names_out}")
print(f"Wrote {len(bodies)} icon bodies → {bodies_out}")
PY
