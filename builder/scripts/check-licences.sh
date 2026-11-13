#!/usr/bin/env bash
# Licence check (hard rule 2; build plan package 0.4). One rule for every installed package,
# shipped or development: a licence on the permitted list, or a package the owner approved by
# name for a named use. The rule and the names are in licence-rule.json; the code is in
# src/licence/. Every problem is listed; the exit code is 1 if there is any. It checks two
# components: builder/ itself and builder/runner/.
set -euo pipefail
cd "$(dirname "$0")/.."
# The only argument taken is --write (rewrite the notices file and the report). The rule file and
# the folder are fixed here: this script always checks this component with its own rule.
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--write" ]; }; then
  echo "PROBLEM: this script takes no argument other than --write."
  echo "RESULT: FAILED"
  exit 1
fi
# This component first, then the acceptance runner's own packages (builder/runner/, package 3.1),
# which are installed into the runner image only: the same rule code, with the runner's own copy of
# the rule. Both are run whatever the first one's result, and the exit code is 1 if either fails.
status=0
npx tsx src/licence/check.ts "$@" || status=1
echo
npx tsx src/licence/check.ts --dir runner --rule runner/licence-rule.json || status=1
exit $status
