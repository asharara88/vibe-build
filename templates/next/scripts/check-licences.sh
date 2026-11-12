#!/usr/bin/env bash
# Automated licence check (hard rule 2). Fails if any production dependency carries a licence
# outside the permitted list. Exceptions the owner approved in writing are listed by name.
set -euo pipefail
cd "$(dirname "$0")/.."
ALLOW="MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense"
# Owner-approved exceptions, each with the date and place of the written approval:
# - caniuse-lite (CC-BY-4.0): browser-support data that Next.js ships in every app. Approved by
#   name for generated apps by the owner on 12 Nov 2026, on conditions (docs/DECISIONS.md).
#   Entered here on 12 Nov 2026 with the version read that day, so the versions that follow are
#   refused until looked at. (The tool matches this entry by its leading text, not exactly: gap 43.)
#   The lock file check below fails if its licence changes.
# This list must never be empty: the tool reads an empty entry as "@" and then skips every
# package whose name begins with "@" (docs/KNOWN-GAPS.md, gap 43).
# Known limit of the tool: --onlyAllow accepts a licence if a permitted name appears anywhere in
# its text, so an expression such as "MIT AND <something else>" passes (gap 43; package 0.4).
EXCLUDE="caniuse-lite@1.0.30001823"
echo "Lock file:"
node scripts/check-lock.mjs
echo "Production dependencies:"
npx license-checker-rseidelsohn --production --onlyAllow "$ALLOW" --excludePackages "$EXCLUDE" --excludePrivatePackages --summary
# Development tools are not shipped to customers. They must still be free of strong copyleft, and any
# licence outside the permitted list is printed here so it is seen and recorded (docs/OPEN-DECISIONS.md).
FAIL_ON="GPL-1.0;GPL-2.0;GPL-3.0;AGPL-1.0;AGPL-3.0;LGPL-2.0;LGPL-2.1;LGPL-3.0;SSPL-1.0;BUSL-1.1;CC-BY-NC-4.0"
echo "All dependencies, development tools included (summary):"
npx license-checker-rseidelsohn --failOn "$FAIL_ON" --excludePackages "$EXCLUDE" --excludePrivatePackages --summary
echo "Development-only packages whose licence is outside the permitted list:"
npx license-checker-rseidelsohn --development --excludePackages "$EXCLUDE" --excludePrivatePackages --csv 2>/dev/null \
  | awk -F'","' 'NR>1 { gsub(/"/, "", $0); split($0, f, ","); print f[1] " | " f[2] }' \
  | grep -vE ' \| (MIT|Apache-2\.0|BSD-2-Clause|BSD-3-Clause|ISC|0BSD|BlueOak-1\.0\.0|CC0-1\.0|Python-2\.0|PostgreSQL|Unlicense)( OR .*)?$' \
  || echo "  none"
npx license-checker-rseidelsohn --excludePrivatePackages --csv --out licences.csv >/dev/null
echo "Licence report (every dependency) written to templates/next/licences.csv"
