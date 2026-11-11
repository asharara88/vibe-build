#!/usr/bin/env bash
# Automated licence check (hard rule 2). Fails if any production dependency carries a licence
# outside the permitted list. Exceptions the owner approved in writing are listed by name.
set -euo pipefail
cd "$(dirname "$0")/.."
ALLOW="MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;BlueOak-1.0.0;CC0-1.0;Python-2.0;PostgreSQL;Unlicense"
# Owner-approved exceptions (docs/DECISIONS.md, 11 Nov 2026): the Claude Agent SDK is under
# Anthropic's Commercial Terms. Add it here when it is installed.
EXCLUDE="@anthropic-ai/claude-agent-sdk"
npx license-checker-rseidelsohn --production --onlyAllow "$ALLOW" --excludePackages "$EXCLUDE" --excludePrivatePackages --summary
npx license-checker-rseidelsohn --production --excludePrivatePackages --csv --out licences.csv >/dev/null
echo "Licence report written to builder/licences.csv"
