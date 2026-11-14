#!/bin/bash
# Sign-off and the live app (after the review of 14787d8, known gap 161): the seven new web tests on the source before
# the fix (builder/src as at 14787d8) and on the fixed source (HEAD), each run under the shared lock. Run from anywhere;
# writes new-tests-before-and-after.txt next to this script.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-fix-signoff
OUT=$W/evidence/2026-11-14-fix-signoff-live/new-tests-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/fxso-tmp BUILDER_BROWSER_CACHE=$S/p31-cache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fxso?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
BEFORE=14787d8
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |AssertionError|Test timed out" ; }
CMD='npx vitest run test/web.test.ts -t "after the review of 14787d8" --reporter=verbose'
dropdb -h /var/run/postgresql --if-exists builder_test_fxso && createdb -h /var/run/postgresql builder_test_fxso
{
echo "Sign-off and the live app (after the review of 14787d8, known gap 161): the new tests, $(date -u +%FT%TZ). Command (from builder/, database builder_test_fxso made fresh, TMPDIR <scratchpad>/fxso-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, the failures' first lines, and the summary are kept below."
echo
echo "1. BEFORE the fix: builder/src as at $BEFORE (git checkout $BEFORE -- src), the tests as committed in $(git rev-parse --short HEAD). Expected: the six new tests fail (the open button offered and a POST opening after sign-off; a live session left open after sign-off, with no close recorded before it; a pass that still enters; an open asked for during the sign-off made; the sign-off recorded before a close under way), the control passes."
git checkout $BEFORE -- src
echo "   builder/src differs from $BEFORE's: $(git diff $BEFORE --stat -- src | wc -l) lines of diff (0: none); from HEAD's: $(git diff HEAD --stat -- src | tail -1)"
flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
git checkout HEAD -- src
echo
echo "2. AFTER the fix: the same command on $(git rev-parse --short HEAD) (git diff $BEFORE --stat -- src: $(git diff $BEFORE --stat -- src | tail -1))."
echo "   builder/src differs from HEAD's: $(git diff HEAD --stat -- src | wc -l) lines of diff (0: none)"
flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
echo
echo "Working tree of builder/ after (git status --porcelain, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
