#!/usr/bin/env bash
#
# Archive the live WordPress site before the domain cutover.
#
# Record-keeping only — nothing serves this output. Run it while
# ausdilaps.com.au still points at the WordPress host (139.180.173.43);
# once DNS moves to Vercel the old origin is unreachable.
#
#   scripts/mirror-wordpress.sh [output-dir]
#
# Default output is ~/Documents/AusDilaps-WP-Archive — deliberately OUTSIDE the
# repo, because the uploads folder alone is ~164MB and must never be committed.
#
# Idempotent: a file already on disk is skipped, so re-running fills gaps rather
# than starting over. Every fetch is appended to MANIFEST.tsv (url, status,
# bytes, local path) so a miss is visible instead of silent.

set -uo pipefail

SITE="https://ausdilaps.com.au"
OUT="${1:-$HOME/Documents/AusDilaps-WP-Archive}"
MANIFEST="$OUT/MANIFEST.tsv"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

mkdir -p "$OUT/pages" "$OUT/uploads"
[ -f "$MANIFEST" ] || printf 'url\tstatus\tbytes\tpath\n' > "$MANIFEST"

log() { printf '%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" >> "$MANIFEST"; }

# fetch <url> <destination>
fetch() {
  local url="$1" dest="$2" code
  [ -s "$dest" ] && return 0
  mkdir -p "$(dirname "$dest")"
  code=$(curl -sSL --max-time 180 -A "$UA" -w '%{http_code}' -o "$dest.part" "$url" 2>/dev/null) || code="000"
  if [ "$code" = "200" ] && [ -s "$dest.part" ]; then
    mv "$dest.part" "$dest"
    log "$url" "$code" "$(wc -c < "$dest" | tr -d ' ')" "${dest#"$OUT"/}"
  else
    rm -f "$dest.part"
    log "$url" "$code" 0 "-"
  fi
}

extract_locs() { grep -oE '<loc>[^<]+</loc>' | sed -E 's#</?loc>##g'; }

echo "==> Archiving $SITE into $OUT"

# ---------------------------------------------------------------- page URLs ---
URLS="$OUT/.urls"
: > "$URLS"

echo "==> Reading wp-sitemap.xml"
INDEX=$(curl -sSL --max-time 60 -A "$UA" "$SITE/wp-sitemap.xml" 2>/dev/null || true)
if printf '%s' "$INDEX" | grep -q '<loc>'; then
  # wp-sitemap.xml is an index of sub-sitemaps; anything not ending .xml is
  # already a page URL, so handle both shapes.
  printf '%s' "$INDEX" | extract_locs | while read -r loc; do
    case "$loc" in
      *.xml) curl -sSL --max-time 60 -A "$UA" "$loc" 2>/dev/null | extract_locs ;;
      *)     printf '%s\n' "$loc" ;;
    esac
  done >> "$URLS"
fi

# Fallback: no usable sitemap, so crawl the links on the homepage instead.
if [ ! -s "$URLS" ]; then
  echo "==> No sitemap found, crawling homepage links"
  curl -sSL --max-time 60 -A "$UA" "$SITE/" 2>/dev/null \
    | grep -oE 'href="(https?://(www\.)?ausdilaps\.com\.au)?/[^"#]*"' \
    | sed -E 's/^href="//; s/"$//' \
    | sed -E "s#^/#$SITE/#" \
    | grep -vE '\.(css|js|png|jpe?g|gif|svg|webp|woff2?)$' >> "$URLS"
  printf '%s/\n' "$SITE" >> "$URLS"
fi

sort -u "$URLS" -o "$URLS"
echo "==> $(wc -l < "$URLS" | tr -d ' ') page URLs to fetch"

while read -r u; do
  [ -z "$u" ] && continue
  p="${u#"$SITE"}"; p="${p%%\?*}"; p="${p%/}"
  [ -z "$p" ] && p="/index"
  fetch "$u" "$OUT/pages${p}.html"
done < "$URLS"

# ------------------------------------------------------------------ uploads ---
# Two sources: everything the archived pages reference, plus the sample-report
# PDFs the new site used to link. Those are seeded explicitly because several are
# not linked from any WordPress page — they were only referenced by the Next.js
# samples page fallback, which this change removes.
UPLOADS="$OUT/.uploads"
: > "$UPLOADS"

grep -rhoE 'https?://(www\.)?ausdilaps\.com\.au/wp-content/uploads/[^"'"'"' )>]+' "$OUT/pages" 2>/dev/null \
  | sed -E 's/[),.;]+$//' >> "$UPLOADS"

for seed in \
  2026/04/AusDilaps-Capability-Statement-FY25-26.pdf \
  2025/09/AusDilaps-Methodology-FY25-26.pdf \
  2025/07/AusDilaps-Sample-Access-Letter-2025.pdf \
  2025/04/AusDilaps-Sample-Commercial-Pre-Report.pdf \
  2025/04/AusDilaps-Sample-Commercial-Post.pdf \
  2025/04/AusDilaps-Sample-Residential-Pre.pdf \
  2023/10/AD-Residential-Sample-Report-POST-2020.pdf \
  2025/04/AusDilaps-Sample-Defect-Floor-Plan.pdf \
  2025/04/AusDilaps-Sample-GPS-External.pdf \
  2024/11/Sample-Council-Assets.pdf \
  2026/04/AusDilaps-Sample-2026-Video-Report.pdf \
  2023/04/AD-Rail-Corridor-Sample-Report-2020.pdf \
  2025/04/AusDilaps-Sample-Tunnel.pdf \
  2026/04/AusDilaps-Sample-2026-Train-Station-GPS.pdf \
  2025/04/AusDilaps-Sample-Drone-Rural.pdf \
  2025/07/AusDilaps-Sample-Culvert-2025.pdf \
  2025/09/AusDilaps-Sample-DOA-2025.pdf \
  2026/04/AusDilaps-Sample-2026-SIA.pdf \
  2025/04/AusDilaps-Sample-Defect-Comparison-Assessment-DCA.pdf
do
  printf '%s/wp-content/uploads/%s\n' "$SITE" "$seed" >> "$UPLOADS"
done

sort -u "$UPLOADS" -o "$UPLOADS"
echo "==> $(wc -l < "$UPLOADS" | tr -d ' ') upload assets to fetch"

while read -r u; do
  [ -z "$u" ] && continue
  rel="${u#*/wp-content/uploads/}"
  fetch "$u" "$OUT/uploads/$rel"
done < "$UPLOADS"

# ------------------------------------------------------------------ summary ---
echo
echo "==> Done. Archive at $OUT"
echo "    pages   : $(find "$OUT/pages" -type f -name '*.html' | wc -l | tr -d ' ')"
echo "    uploads : $(find "$OUT/uploads" -type f | wc -l | tr -d ' ')"
echo "    PDFs    : $(find "$OUT/uploads" -type f -iname '*.pdf' | wc -l | tr -d ' ')"
echo "    size    : $(du -sh "$OUT" | cut -f1)"
echo "    failures: $(awk -F'\t' 'NR>1 && $2!=200' "$MANIFEST" | wc -l | tr -d ' ') (see MANIFEST.tsv)"
