#!/usr/bin/env bash
# Licence check (hard rule 2; build plan package 0.4). One rule for every package, shipped or
# development: a licence on the permitted list, or a package the owner approved by name for a
# named use. The rule and the names are in licence-rule.json; the code is in scripts/licence/,
# the same two files as in the builder. Every problem is listed; the exit code is 1 if there
# is any. Packages that only another machine would install are judged from the lock file.
#
# Before it, the lock-file check that keeps the image library sharp out (the owner's decision
# of 12 Nov 2026, docs/DECISIONS.md).
set -euo pipefail
cd "$(dirname "$0")/.."
echo "Lock file:"
node scripts/check-lock.mjs
exec npx tsx scripts/licence/check.ts "$@"
