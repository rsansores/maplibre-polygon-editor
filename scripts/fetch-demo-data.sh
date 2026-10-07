#!/usr/bin/env bash
# Rebuilds the demo's self-contained basemap: a vector-tile extract of one city,
# plus the fonts and icons its style needs. Everything lands in demo/public/data
# and is committed, so the demo (and GitHub Pages) needs no tile server, no API
# key and no network service to show a map.
#
# Requires the `pmtiles` CLI: https://github.com/protomaps/go-pmtiles/releases
#
#   ./scripts/fetch-demo-data.sh            # latest daily build
#   BUILD=20261006 ./scripts/fetch-demo-data.sh
set -euo pipefail

cd "$(dirname "$0")/.."
out=demo/public/data
mkdir -p "$out/fonts" "$out/sprites"

# Querétaro, Mexico, with its rural edge: dense streets for snapping and open
# country for drawing where the map has nothing to snap to.
BBOX="${BBOX:--100.52,20.50,-100.28,20.70}"
MAXZOOM="${MAXZOOM:-15}"
ASSETS=https://protomaps.github.io/basemaps-assets

if [[ -z "${BUILD:-}" ]]; then
  # Daily builds are pruned after a while; walk back from today to the newest one.
  for days in 0 1 2 3 4 5 6 7; do
    candidate=$(date -u -d "-$days day" +%Y%m%d)
    if curl -sfI "https://build.protomaps.com/$candidate.pmtiles" >/dev/null; then
      BUILD=$candidate
      break
    fi
  done
fi
[[ -n "${BUILD:-}" ]] || { echo "no Protomaps daily build found in the last week" >&2; exit 1; }

echo "extracting $BBOX up to z$MAXZOOM from build $BUILD"
pmtiles extract "https://build.protomaps.com/$BUILD.pmtiles" "$out/demo.pmtiles" \
  --bbox="$BBOX" --maxzoom="$MAXZOOM"

# Latin ranges cover Spanish and English labels; anything else simply renders
# without a label rather than failing.
for font in "Noto Sans Regular" "Noto Sans Medium" "Noto Sans Italic"; do
  mkdir -p "$out/fonts/$font"
  for range in 0-255 256-511 8192-8447; do
    curl -sf "$ASSETS/fonts/${font// /%20}/$range.pbf" -o "$out/fonts/$font/$range.pbf"
  done
done

for flavor in light dark; do
  for suffix in .json .png @2x.json @2x.png; do
    curl -sf "$ASSETS/sprites/v4/$flavor$suffix" -o "$out/sprites/$flavor$suffix"
  done
done

echo "$BUILD" > "$out/BUILD"
du -sh "$out"
