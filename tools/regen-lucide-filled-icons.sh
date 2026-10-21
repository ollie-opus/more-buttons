#!/usr/bin/env bash
# Regenerate the bundled FILLED lucide bodies from a checkout of
# applifted/lucide-extended (ISC + MIT; not affiliated with Lucide), so the
# extension's own chrome can show solid glyphs where one exists and fall back
# to the stock lucide outline where it doesn't. Emits:
#
#   config/lucideFilledBodies.json         {name: innerSVG} — filled bodies only
#   config/lucideFilledBodies.LICENSE.txt  upstream LICENSE + NOTICE + source sha
#
# Only names that exist in config/lucideIcons.json are kept, so every filled
# icon has an outline twin (the KB can render it, the icon-name lint holds, and
# the painter always has a fallback). The source files are normalised:
# `fill="black"` → `fill="currentColor"`, inline `style=""` dropped, whitespace
# collapsed, coordinates rounded to 2 decimals. The envelope is asserted so an upstream format change fails loudly.
#
# Usage: tools/regen-lucide-filled-icons.sh [path-to-lucide-extended-checkout]
#   git clone --depth 1 https://github.com/applifted/lucide-extended.git
set -euo pipefail

DEFAULT_DIR="$HOME/Desktop/stuff/lucide-extended"
SRC_DIR="${1:-$DEFAULT_DIR}"
CONFIG_DIR="$(cd "$(dirname "$0")/.." && pwd)/config"
SHA="$(git -C "$SRC_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"

python3 -I - "$SRC_DIR" "$CONFIG_DIR" "$SHA" <<'PY'
import json, os, re, sys

src_dir, config_dir, sha = sys.argv[1:4]
icons_dir = os.path.join(src_dir, "svg", "filled")
names_in = os.path.join(config_dir, "lucideIcons.json")
bodies_out = os.path.join(config_dir, "lucideFilledBodies.json")
license_out = os.path.join(config_dir, "lucideFilledBodies.LICENSE.txt")

ENVELOPE = re.compile(
    r'^<svg width="24" height="24" viewBox="0 0 24 24" fill="none" '
    r'xmlns="http://www\.w3\.org/2000/svg">(?P<body>.*)</svg>\s*$', re.S)
PATH = re.compile(r'<path\b[^>]*/>')

with open(names_in, encoding="utf-8") as f:
    wanted = set(json.load(f))

bodies, skipped = {}, 0
for fname in sorted(os.listdir(icons_dir)):
    if not fname.endswith(".svg"):
        continue
    name = fname[:-4]
    if name not in wanted:
        skipped += 1
        continue
    with open(os.path.join(icons_dir, fname), encoding="utf-8") as f:
        svg = f.read()
    m = ENVELOPE.match(svg)
    if not m:
        sys.exit(f"{fname}: unexpected SVG envelope — refusing to write. First 200 chars:\n{svg[:200]}")
    body = m.group("body")
    body = re.sub(r'\s*style="[^"]*"', "", body)
    body = body.replace('fill="black"', 'fill="currentColor"')
    body = re.sub(r"\s+", " ", body).strip()
    body = re.sub(r">\s+<", "><", body)
    # Upstream exports 5-decimal coordinates; 2 decimals is invisible on a
    # 24-unit viewBox and roughly halves the bundle.
    body = re.sub(r"-?\d+\.\d{3,}", lambda m: f"{float(m.group(0)):.2f}".rstrip("0").rstrip("."), body)
    paths = PATH.findall(body)
    if not paths or "".join(paths) != body:
        sys.exit(f"{fname}: body is not purely <path/> elements — refusing to write:\n{body[:200]}")
    if "black" in body or "stroke" in body or "style=" in body or 'fill="currentColor"' not in body:
        sys.exit(f"{fname}: normalisation failed:\n{body[:200]}")
    bodies[name] = body

if not bodies:
    sys.exit(f"No icons read from {icons_dir} — refusing to overwrite {bodies_out}")

with open(bodies_out, "w", encoding="utf-8") as f:
    json.dump(bodies, f, indent=0, sort_keys=True)
    f.write("\n")

parts = [f"Filled icon bodies in lucideFilledBodies.json are generated from\n"
         f"https://github.com/applifted/lucide-extended (commit {sha})\n"
         f"by tools/regen-lucide-filled-icons.sh. Upstream LICENSE and NOTICE follow.\n"]
for fn in ("LICENSE", "NOTICE"):
    p = os.path.join(src_dir, fn)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            parts.append(f"\n==== {fn} ====\n\n" + f.read())
with open(license_out, "w", encoding="utf-8") as f:
    f.write("".join(parts))

print(f"wrote {len(bodies)} filled bodies to {bodies_out} ({skipped} upstream names not in lucideIcons.json skipped)")
print(f"wrote {license_out}")
PY
