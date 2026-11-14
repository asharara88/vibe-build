#!/bin/bash
# The phone test's decision after the review of 14787d8: (1) the report as a command on two made-up logs, with the
# script as at 14787d8 and as fixed; (2) the new test file on the decision before the fix and after it. No page is
# served (nothing listens; ports 4032 to 4034 are not touched); no container or database is used. Run from anywhere;
# writes into the evidence folder.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-fix-phone
E=$W/evidence/2026-11-14-fix-phone-decision
cd $W/builder || exit 1
export TMPDIR=$S/fxphone-tmp NO_COLOR=1 FORCE_COLOR=0
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
REVIEWED=14787d8   # the commit the review read
GUARD=6c3bdd5      # 14787d8's decision, with only the guard that lets a test import the file
H=$(git rev-parse --short HEAD)
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |AssertionError" ; }
OLD=$TMPDIR/probe-phone-$REVIEWED.ts
git show $REVIEWED:builder/scripts/probe-phone.ts > $OLD
{
echo "The phone test's decision after the review of $REVIEWED: before and after, $(date -u +%FT%TZ), on $H. Made-up logs in made-up-logs/ (reserved .test addresses, a made-up browser name)."
echo
echo "1. The report as a command (npx tsx <script> --report <log> [answers])."
echo
echo "1a. BEFORE: the script as at $REVIEWED (git show $REVIEWED:builder/scripts/probe-phone.ts), on two-pages.jsonl (each page opened once, no step pressed):"
npx tsx $OLD --report $E/made-up-logs/two-pages.jsonl 2>&1 | sed 's/^/    /'
echo "    exit code: ${PIPESTATUS[0]}"
echo
echo "1b. AFTER: the script as at $H, on the same log:"
npx tsx scripts/probe-phone.ts --report $E/made-up-logs/two-pages.jsonl 2>&1 | sed 's/^/    /'
echo "    exit code: ${PIPESTATUS[0]}"
echo
echo "1c. AFTER, on whole-run.jsonl (every step of both pages, step 5 reaching nothing, the cached page twice), without the owner's answers:"
npx tsx scripts/probe-phone.ts --report $E/made-up-logs/whole-run.jsonl 2>&1 | grep -E "MISSING|answers|DECISION" | sed 's/^/    /'
echo
echo "1d. AFTER, on whole-run.jsonl with the owner's answers --port-4034=did-not-open --signed-out=could-not-try:"
npx tsx scripts/probe-phone.ts --report $E/made-up-logs/whole-run.jsonl --port-4034=did-not-open --signed-out=could-not-try 2>&1 | sed 's/^/    /'
echo "    exit code: ${PIPESTATUS[0]}"
echo
echo "1e. AFTER, an answer that is not one of its words (--signed-out=maybe):"
npx tsx scripts/probe-phone.ts --report $E/made-up-logs/whole-run.jsonl --signed-out=maybe 2>&1 | sed 's/^/    /'
echo "    exit code: ${PIPESTATUS[0]}"
echo
CMD="npx vitest run test/probe-phone.test.ts --reporter=verbose"
echo "2. The new tests (test/probe-phone.test.ts as committed in $H). Command, from builder/: $CMD; only the tests run, the failures' first lines and the summary are kept."
echo
echo "2a. BEFORE the fix: builder/scripts/probe-phone.ts as at $GUARD (git checkout $GUARD -- scripts/probe-phone.ts), which is $REVIEWED's with only the guard added (git diff $REVIEWED $GUARD --stat: '$(git diff $REVIEWED $GUARD --stat -- . | tail -1)'). Expected: the regression tests and the new STOP and answer tests fail; the 8 behaviour controls (the three GO ON rows on a whole run, the STOP rows, a page never opened, an unreported port that answered) pass."
git checkout $GUARD -- scripts/probe-phone.ts
echo "    builder/scripts/probe-phone.ts differs from $GUARD's: $(git diff $GUARD --stat -- scripts/probe-phone.ts | wc -l) lines of diff (0: none)"
$CMD 2>&1 | keep
git checkout HEAD -- scripts/probe-phone.ts
echo
echo "2b. AFTER the fix: the same command on $H (builder/scripts/probe-phone.ts differs from HEAD's: $(git diff HEAD --stat -- scripts/probe-phone.ts | wc -l) lines of diff (0: none))."
$CMD 2>&1 | keep
echo
echo "Working tree of builder/ after (git status --porcelain, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $E/before-and-after.txt 2>&1
rm -f $OLD
sed -i "s#$S#<scratchpad>#g" $E/before-and-after.txt
echo done
