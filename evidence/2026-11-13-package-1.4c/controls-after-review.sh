#!/usr/bin/env bash
# Package 1.4c, after its review (13 Nov 2026): the controls of the safeguards added for the review's blocking item
# and its notes. As controls.sh: each one removes one safeguard in a SCRATCH COPY of the committed code (git archive
# of the commit named by REV, default HEAD, extracted into the scratch folder; the worktree is never edited), runs the
# named test of test/overrun.test.ts in that copy, and expects it to FAIL. The copy is then deleted ("restored": the
# next control starts from a fresh extract).
# Controls Z8 to Z10 change a migration. Migrations are applied once per database, by name, so each of those runs
# on a database of its own, made empty for it and dropped after (builder_test_f14c_ctl); the others run on this
# fix's test database (builder_test_f14c).
# Kept as evidence. Run as: SCRATCHPAD=<scratch folder> WORKTREE=<worktree> bash <this file>; ONLY=<id> runs one control.
set -uo pipefail
S=${SCRATCHPAD:?}
WT=${WORKTREE:?}
REV=${REV:-HEAD}
export TMPDIR=$S/f14c-tmp
MAIN_DB="postgres:///builder_test_f14c?host=/var/run/postgresql"
CTL_DB_NAME=builder_test_f14c_ctl
BASE=$S/f14c-ctl
rm -rf "$BASE"; mkdir -p "$BASE/pristine" "$TMPDIR"
git -C "$WT" archive "$REV" builder | tar -x -C "$BASE/pristine"
echo "Controls of package 1.4c after its review, on a copy of commit $(git -C "$WT" rev-parse --short "$REV") (git archive), $(date -u +%FT%TZ)"
H=src/store/holds.ts
F=src/store/freezes.ts
R=src/store/reconcile.ts
A=src/gateway/app.ts
M10=src/store/migrations/010_overrun_freezes.sql
pass=0; fail=0
control() { # id, test pattern, file, perl substitution, what is removed, how many tests must fail, [fresh: a database of its own]
  local id="$1" pat="$2" file="$3" sub="$4" what="$5" want="$6" fresh="${7:-}"
  if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$id" ]; then return; fi
  echo "=== $id: $what"
  echo "    file: $file; tests: $pat (all $want must fail)${fresh:+; on a database of its own, made empty for it}"
  local work="$BASE/work-$id"
  rm -rf "$work"; cp -a "$BASE/pristine" "$work"
  ln -s "$WT/builder/node_modules" "$work/builder/node_modules"
  local before; before=$(sha1sum "$work/builder/$file" | cut -d' ' -f1)
  perl -0pi -e "$sub" "$work/builder/$file"
  if [ "$(sha1sum "$work/builder/$file" | cut -d' ' -f1)" = "$before" ]; then echo "    NOT APPLIED: the substitution changed nothing"; rm -rf "$work"; fail=$((fail+1)); return; fi
  diff -U0 "$BASE/pristine/builder/$file" "$work/builder/$file" | grep '^[-+][^-+]' | cut -c1-300 | sed 's/^/    /'
  local db="$MAIN_DB"
  if [ -n "$fresh" ]; then
    dropdb --if-exists -h /var/run/postgresql "$CTL_DB_NAME"; createdb -h /var/run/postgresql "$CTL_DB_NAME"
    db="postgres:///$CTL_DB_NAME?host=/var/run/postgresql"
  fi
  local out; out=$(cd "$work/builder" && BUILDER_TEST_DATABASE_URL="$db" timeout 300 npx vitest run test/overrun.test.ts -t "$pat" 2>&1)
  local code=$?
  rm -rf "$work"
  if [ -n "$fresh" ]; then dropdb --if-exists -h /var/run/postgresql "$CTL_DB_NAME"; fi
  # The first failure's message, then the count line.
  echo "$out" | grep -E "AssertionError|TypeError|Error:|error:|ReconcileRefused|expected" | grep -v "time limit reached" | head -3 | cut -c1-300 | sed 's/^/    | /'
  echo "$out" | grep -E "^ +Tests +[0-9]" | sed 's/^ */    | /'
  if [ $code -ne 0 ] && [[ "$out" =~ Tests\ +$want\ failed ]]; then echo "    RESULT: all $want FAILED, as they should (exit $code)"; pass=$((pass+1)); else echo "    RESULT: NOT all $want failed (exit $code)"; fail=$((fail+1)); fi
}
E='1.4c \(e[1-5]\)'
E1='1.4c \(e1\)'
E6='1.4c \(e6\)'
FF='1.4c \(f\)'
G='1.4c \(g\)'
# The blocking item: a kept call whose figures as read price it above its hold freezes its project (holds.ts, keepHold).
control Z1 "$E" $H 's/const above = read !== null && Number\.isFinite\(read\.usd\) && read\.usd >= 0 && read\.usd < 1e8 && micro\(read\.usd\) > micro\(amountUsd\) \? read : null;/const above = null as typeof read;/' "the freeze written when a kept call's figures as read are above its hold (streamed endings)" 5
control Z2 "$FF" $H 's/const above = read !== null && Number\.isFinite\(read\.usd\) && read\.usd >= 0 && read\.usd < 1e8 && micro\(read\.usd\) > micro\(amountUsd\) \? read : null;/const above = null as typeof read;/' "the same, for a plain answer that does not state the speed" 1
# The freeze in the keep's own transaction: moved to a transaction of its own, after the keep commits.
MOVE='s/(freeze: Freeze \| null \}> \{\n)  return inTransaction\(pool, p\.projectId, async \(c\) => \{\n    const r = await c\.query<Hold>\("select \* from holds where id = \$1 and project_id = \$2 for update", \[p\.holdId, p\.projectId\]\);\n    const hold = r\.rows\[0\];\n    if \(!hold \|\| hold\.state !== "open"\) return \{ kept: false/${1}  let after: any = null;\n  const out = await inTransaction(pool, p.projectId, async (c) => {\n    const r = await c.query<Hold>("select * from holds where id = \$1 and project_id = \$2 for update", [p.holdId, p.projectId]);\n    const hold = r.rows[0];\n    if (!hold || hold.state !== "open") return { kept: false/; s/    const freeze = await freezeAfterOverrunIn\(c, \{\n      kind: "kept_above_hold",/    after = {\n      kind: "kept_above_hold",/; s/(usage_as_read: above\.usage \},\n)    \}\);\n    return \{ kept: true, amountUsd, freeze \};\n  \}\);\n\}/${1}    };\n    return { kept: true, amountUsd, freeze: null as Freeze | null };\n  });\n  if (after) out.freeze = await inTransaction(pool, p.projectId, (c2) => freezeAfterOverrunIn(c2, after));\n  return out;\n}/'
control Z3 "$E" $H "$MOVE" "the freeze in the keep's own transaction (moved to a transaction of its own, after the keep commits)" 5
# The gateway: what it passes to the keep (app.ts).
control Z4 "$E" $A 's/const trusted = \(\) => \(sawInput && !sawUnreadable \? \{ usage, itemised \} : null\);/const trusted = () => null;/' "a streamed call's figures as read, passed to the keep" 5
control Z5 "$E6" $A 's/const trusted = \(\) => \(sawInput && !sawUnreadable \? \{ usage, itemised \} : null\);/const trusted = () => (sawInput ? { usage, itemised } : null);/' "the condition that the figures can be trusted (no figure fell, no frame unreadable)" 1
control Z6 "$FF" $A 's/\n        readNotSettled = \{ usage: u, itemised: itemisedCacheWrites\(j\.usage\) \};//' "a plain answer's figures as read, passed to the keep" 1
# The comparison with the hold: without it, a kept call below its hold is offered to the freeze too.
control Z7 "$E6" $H 's/ && micro\(read\.usd\) > micro\(amountUsd\) \? read : null;/ ? read : null;/' "the comparison of the cost as read with the hold" 1
# Migration 010's checks (the review's note 5: written, and exercised by no test until now).
control Z8 "$G" $M10 "s/\n             and bill_usd <> 'NaN'::numeric and hold_amount_usd <> 'NaN'::numeric and bill_usd > hold_amount_usd\)\);/));/" "the database's check that a freeze's bill is a number above its hold's amount" 1 fresh
control Z9 "$G" $M10 "s/ and bill_usd <> 'NaN'::numeric and hold_amount_usd <> 'NaN'::numeric and bill_usd > hold_amount_usd/ and bill_usd > hold_amount_usd/" "the same check's refusal of 'NaN' (which PostgreSQL ranks above every number)" 1 fresh
control Z10 "$G" $M10 's/create unique index if not exists project_freezes_one_overrun_per_hold/create index if not exists project_freezes_one_overrun_per_hold/' "one freeze per hold and kind (the index made not unique)" 1 fresh
# What the owner and the caller see.
control Z11 "$E" $F 's/    if \(f\.kind === "kept_above_hold"\) \{/    if (false) {/' "the refusal's message for this kind (the cost as read, the hold and the difference)" 5
control Z12 "$E1" $R 's/\n    if \(freezes\.some\(\(f\) => f\.kind === "kept_above_hold"\)\) add\("kept above its hold"\);//' "the list's kind for such a hold" 1
echo "=== controls that failed as they should: $pass; that did not: $fail"
rm -rf "$BASE"
echo "The worktree, untouched: $(git -C "$WT" status --short | wc -l) changed or new files"
