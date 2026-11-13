#!/usr/bin/env bash
# Package 1.4c controls. Each one removes one safeguard in a SCRATCH COPY of the committed code (git archive of
# HEAD, extracted into the scratch folder; the worktree is never edited), runs the named test of
# test/overrun.test.ts in that copy on this package's own test database, and expects the test to FAIL. The copy
# is then deleted ("restored": the next control starts from a fresh extract).
# Kept as evidence. Run as: SCRATCHPAD=<scratch folder> WORKTREE=<worktree> bash <this file>; ONLY=<id> runs one control.
set -uo pipefail
S=${SCRATCHPAD:?}
WT=${WORKTREE:?}
export TMPDIR=$S/p14c-tmp
export BUILDER_TEST_DATABASE_URL="postgres:///builder_test_p14c?host=/var/run/postgresql"
BASE=$S/p14c-ctl
rm -rf "$BASE"; mkdir -p "$BASE/pristine"
git -C "$WT" archive HEAD builder | tar -x -C "$BASE/pristine"
echo "Controls of package 1.4c, on a copy of commit $(git -C "$WT" rev-parse --short HEAD) (git archive), $(date -u +%FT%TZ)"
H=src/store/holds.ts
F=src/store/freezes.ts
R=src/store/reconcile.ts
I=test/invariants.ts
pass=0; fail=0
control() { # id, test pattern, file, perl substitution, what is removed
  local id="$1" pat="$2" file="$3" sub="$4" what="$5"
  if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$id" ]; then return; fi
  echo "=== $id: $what"
  echo "    file: $file; test: $pat"
  local work="$BASE/work-$id"
  rm -rf "$work"; cp -a "$BASE/pristine" "$work"
  ln -s "$WT/builder/node_modules" "$work/builder/node_modules"
  local before; before=$(sha1sum "$work/builder/$file" | cut -d' ' -f1)
  perl -0pi -e "$sub" "$work/builder/$file"
  if [ "$(sha1sum "$work/builder/$file" | cut -d' ' -f1)" = "$before" ]; then echo "    NOT APPLIED: the substitution changed nothing"; rm -rf "$work"; fail=$((fail+1)); return; fi
  diff -U0 "$BASE/pristine/builder/$file" "$work/builder/$file" | grep '^[-+][^-+]' | sed 's/^/    /'
  local out; out=$(cd "$work/builder" && timeout 300 npx vitest run test/overrun.test.ts -t "$pat" 2>&1)
  local code=$?
  rm -rf "$work"
  echo "$out" | grep -E "^ +(×|✓)|AssertionError|TypeError|Error:|ReconcileRefused|expected|Tests +[0-9]" | head -6 | cut -c1-400 | sed 's/^/    | /'
  if [ $code -ne 0 ] && [[ "$out" =~ Tests\ +[0-9]+\ failed ]]; then echo "    RESULT: the test FAILED, as it should (exit $code)"; pass=$((pass+1)); else echo "    RESULT: the test did NOT fail (exit $code)"; fail=$((fail+1)); fi
}
# The freeze written with the settle (holds.ts, settleHold).
control Y1 '1.4c \(a1\)' $H 's/\n      freeze = await freezeAfterOverrunIn\(c, overrunOf\("bill_above_hold"\)\);//' "the freeze written by a settlement above its hold (not streamed)"
control Y2 '1.4c \(a2\)' $H 's/\n      freeze = await freezeAfterOverrunIn\(c, overrunOf\("bill_above_hold"\)\);//' "the same, for a streamed call"
control Y3 '1.4c \(b\)' $H 's/\n      freeze = await freezeAfterOverrunIn\(c, overrunOf\("bill_above_hold"\)\);//' "the same, for a step-held call"
# The freeze moved out of the settle's transaction: written after it commits, in a transaction of its own.
MOVE='s/(freeze: Freeze \| null \}> \{\n)  return inTransaction\(pool, p\.projectId, async \(c\) => \{/${1}  let after: any = null;\n  const out = await inTransaction(pool, p.projectId, async (c) => {/; s/      freeze = await freezeAfterOverrunIn\(c, overrunOf\("bill_above_hold"\)\);\n    \}\n    return \{ settled: true, exceeded, amountUsd, freeze \};\n  \}\);\n\}/      after = overrunOf("bill_above_hold");\n    }\n    return { settled: true, exceeded, amountUsd, freeze };\n  });\n  if (after) out.freeze = await inTransaction(pool, p.projectId, (c2) => freezeAfterOverrunIn(c2, after));\n  return out;\n}/'
control Y4 '1.4c \(a3\)' $H "$MOVE" "the freeze in the settle's own transaction (moved to a transaction of its own, after the settle commits): the atomicity test"
control Y5 '1.4c \(a1\)' $H "$MOVE" "the same move: the test that reads each row's transaction id"
# The late answer above its hold.
control Y6 '1.4c \(late\)' $H 's/\? freezeAfterOverrunIn\(c, overrunOf\("late_answer_above_hold"\)\) : null\)/? null : null)/' "the freeze after a late answer above its hold"
# The refusal's wording for a freeze of the new kinds.
control Y7 '1.4c \(a1\)' $F 's/if \(f\.kind === "bill_above_hold" \|\| f\.kind === "late_answer_above_hold"\) \{/if (false) {/' "the refusal's message naming the bill, the hold and the difference"
# The owner's record of the bill (reconcile.ts, recordOverrun): its refusals and what it clears.
control Y8 '1.4c \(c2\)' $R 's/const overrun = freezes\.find\(\(f\) => f\.kind === "bill_above_hold"\);/const overrun = freezes.find((f) => f.cleared_at === null) ?? freezes[0];/' "the refusal of a freeze of another kind, or of a hold with none"
control Y9 '1.4c \(c2\)' $R 's/if \(overrun\.cleared_at !== null\) \{/if (false) {/' "the refusal of a record already made"
control Y10 '1.4c \(c2\)' $R 's/(export async function recordOverrun[\s\S]*?)const evidence = checkText\("evidence", p\.evidence, MAX_EVIDENCE\);/${1}const evidence = String(p.evidence ?? "");/' "the check of the evidence (missing, too long, not storable)"
control Y11 '1.4c \(c2\)' $R 's/"select \* from holds where id = \$1 and project_id = \$2", \[p\.holdId, p\.projectId\]\)\)\.rows\[0\];\n    if \(!hold\) throw new ReconcileRefused\("unknown_hold"/"select * from holds where id = \$1 and \$2::text is not null", [p.holdId, p.projectId])).rows[0];\n    if (!hold) throw new ReconcileRefused("unknown_hold"/' "the refusal of another project's hold"
control Y12 '1.4c \(c3\)' $R 's/"update project_freezes set cleared_at = clock_timestamp\(\) where id = \$1 and cleared_at is null returning \*"/"update project_freezes set cleared_at = clock_timestamp() where project_id = (select project_id from project_freezes where id = \$1) and cleared_at is null returning *"/' "clearing only the freeze this record names"
control Y13 '1.4c \(c3\)' $R "s/where f\.cleared_at is null and f\.kind = 'bill_above_hold' and/where false and f.cleared_at is null and f.kind = 'bill_above_hold' and/" "the list's section of projects frozen after a bill above its hold"
control Y14 '1.4c \(c4\)' scripts/reconcile.ts 's/  if \(v\.actual !== undefined\) misuse\("--overrun takes no --actual: the bill was charged in full when the call was settled"\);\n//' "the script's refusal of --actual with --overrun"
# The invariant checker's two new rules.
control Y15 '1.4c \(d\)' $I 's/if \(!freeze\) violations\.push\(\{ rule: "3:/if (false) violations.push({ rule: "3:/' "rule 3 (a settlement's hold.exceeded needs its freeze)"
control Y16 '1.4c \(d\)' $I 's/\(e\.tx === undefined \|\| f\.tx === e\.tx\)/true/' "rule 3's condition that the freeze is in the same transaction"
control Y17 '1.4c \(d\)' $I 's/if \(frozen\.size > 0\) violations\.push/if (false) violations.push/' "rule 4 (nothing opens while a freeze is not cleared)"
echo "=== controls that failed as they should: $pass; that did not: $fail"
rm -rf "$BASE"
echo "The worktree, untouched: $(git -C "$WT" status --short | wc -l) changed or new files"
