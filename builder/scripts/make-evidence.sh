#!/usr/bin/env bash
# Writes the evidence file for an increment: the cap demonstration, the test run and the licence check.
# Usage (from builder/): bash scripts/make-evidence.sh ../evidence/<date>-<name>/gateway-cap.md
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$1"
mkdir -p "$(dirname "$OUT")"
TODAY="$(date -u +%Y-%m-%d)"
echo "# Evidence: gateway meters calls and stops at the cap" > "$OUT"
echo >> "$OUT"
echo "Run on $TODAY on the development machine, against a stand-in model provider (no real key, no real spend). Command: npx tsx builder/scripts/demo-cap.ts" >> "$OUT"
echo >> "$OUT"
echo '```' >> "$OUT"
npx tsx scripts/demo-cap.ts >> "$OUT" 2>&1
echo '```' >> "$OUT"
echo >> "$OUT"
echo "## Test run (npm test)" >> "$OUT"
echo >> "$OUT"
echo '```' >> "$OUT"
npx vitest run 2>&1 | grep -vE '^\s*$' >> "$OUT"
echo '```' >> "$OUT"
echo >> "$OUT"
echo "## Licence check (npm run check:licences)" >> "$OUT"
echo >> "$OUT"
echo '```' >> "$OUT"
bash scripts/check-licences.sh >> "$OUT" 2>&1
echo '```' >> "$OUT"
echo "Evidence written to $OUT"
