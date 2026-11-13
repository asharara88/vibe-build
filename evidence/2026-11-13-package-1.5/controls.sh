#!/usr/bin/env bash
# Package 1.5 controls: each removes one safeguard, runs the named test, expects it to FAIL, then restores the file from git.
# Kept as evidence. SCRATCHPAD is the session's scratch folder; run from builder/ as: SCRATCHPAD=<folder> bash <this file> "$PWD"
set -uo pipefail
cd "$1"
export TMPDIR=${SCRATCHPAD}/p15-tmp
export BUILDER_TEST_DATABASE_URL="postgres:///builder_test_pkg15?host=/var/run/postgresql"
LOCK=${SCRATCHPAD}/live-tests.lock
R=src/store/reconcile.ts
pass=0; fail=0
control() { # id, test pattern, file, perl substitution, what is removed[, second file, its substitution]
  local id="$1" pat="$2" file="$3" sub="$4" what="$5" file2="${6:-}" sub2="${7:-}"
  echo "=== $id: $what"
  echo "    file: $file${file2:+ and $file2}; test: $pat"
  local before; before=$(sha1sum "$file")
  perl -0pi -e "$sub" "$file"
  if [ "$(sha1sum "$file")" = "$before" ]; then echo "    NOT APPLIED: the substitution changed nothing"; git checkout -q -- "$file"; fail=$((fail+1)); return; fi
  if [ -n "$file2" ]; then
    local before2; before2=$(sha1sum "$file2")
    perl -0pi -e "$sub2" "$file2"
    if [ "$(sha1sum "$file2")" = "$before2" ]; then echo "    NOT APPLIED: the second substitution changed nothing"; git checkout -q -- "$file" "$file2"; fail=$((fail+1)); return; fi
  fi
  git diff --unified=0 -- "$file" $file2 | grep '^[-+][^-+]' | sed 's/^/    /'
  local out; out=$(timeout 300 flock "$LOCK" npx vitest run test/reconcile.test.ts -t "$pat" 2>&1)
  local code=$?
  git checkout -q -- "$file" $file2
  echo "$out" | grep -E "^ +(×|✓)|AssertionError|Error:|ReconcileRefused|expected|Tests +[0-9]" | head -6 | sed 's/^/    | /'
  if [ $code -ne 0 ] && [[ "$out" =~ Tests\ +[0-9]+\ failed ]]; then echo "    RESULT: the test FAILED, as it should (exit $code)"; pass=$((pass+1)); else echo "    RESULT: the test did NOT fail (exit $code)"; fail=$((fail+1)); fi
}
control X1 'B14 \(1\)' $R "s/(const KEPT_SQL = \"state = 'open' and \()unreconciled or expired or kept_reason is not null or (deadline_at <= \\\$1\)\")/\${1}expired or \${2}/" "the list's selection keeps only expired holds"
control X2 'B14 \(1\)' $R 's/  if \(ERROR_ANSWER\.has\(reason\)\) return "error answer";\n//' "the error-answer kind"
control X3 'B14 \(2\)' $R 's/where project_id = \$1 and hold_id = \$2 and cleared_at is null returning/where false and project_id = \$1 and hold_id = \$2 and cleared_at is null returning/' "the freeze cleared with the reconciliation"
control X4 'B14 \(2\)' test/invariants.ts 's/      case "hold\.reconciled": \{/      {/' "the invariant checker's reading of hold.reconciled"
control X5 'B14 \(3\)' $R "s/\"update holds set state = 'settled', closed_at = now\(\), actual_usd = \\\$2 where id = \\\$1\"/\"update holds set closed_at = closed_at where id = \\\$1 and \\\$2::numeric is not null\"/" "the hold closed at the actual cost"
control X6 'B14 \(3\)' $R 's/if \(aboveHold\) await event\(/if (false \&\& aboveHold) await event(/' "hold.exceeded when the actual cost is above the hold"
control X7 'B14 \(4\)' $R 's/if \(!hold\.unreconciled && !hold\.expired && hold\.kept_reason === null\) \{/if (false) {/' "the refusal of a hold that is not kept (a call in flight)"
control X8 'B14 \(4\)' $R 's/if \(\(already\.rowCount \?\? 0\) > 0\) \{/if (false) {/' "the refusal of a hold whose cost is already recorded"
control X9 'B14 \(4\)' $R 's/const evidence = checkText\("evidence", p\.evidence, MAX_EVIDENCE\);/const evidence = String(p.evidence);/' "the check of the evidence"
control X10 'B14 \(5\)' src/store/tx.ts 's/    await client\.query\("select id from projects where id = \$1 for update", \[projectId\]\);\n//' "the project's lock (tx.ts) and the hold's row lock (reconcile.ts)" $R 's/"select \* from holds where id = \$1 and project_id = \$2 for update"/"select * from holds where id = \$1 and project_id = \$2"/'
control X11 'B14 \(6\)' $R 's/where project_id = \$1 and hold_id = \$2 and cleared_at is null returning/where project_id = \$1 and (hold_id = \$2 or true) and cleared_at is null returning/' "clearing only the freezes this hold caused"
control X12 'B14 \(6\)' $R 's/    const now = new Date\(\);\n    await expireHoldsIn\(c, p\.projectId, now\);\n/    const now = new Date();\n/' "marking holds past their deadline before the hold is read"
control X13 'B14 \(6\)' $R 's/const step = await returnToStepIn\(c, hold, actual\);/const step = null;/' "giving back to a running step's room"
control X14 'B14 \(6\)' $R "s/deadline_at <= \\\$1\)\";/deadline_at <= \\\$1 - interval '100 years')\";/" "listing a hold past its deadline that the sweep has not marked"
control X15 'B14 \(7\)' scripts/reconcile.ts 's/console\.log\(`Database: \$\{db\.rows\[0\]!\.name\}/console.log(`Database: \${process.env.BUILDER_DATABASE_URL} \${db.rows[0]!.name}/' "printing the database's name only"
control X16 'still written' $R 's/"the provider answered with a server error",/"the provider answered with a server error (renamed)",/' "the kinds table matching what the gateway writes"
echo "=== controls that failed as they should: $pass; that did not: $fail"
git status --short
