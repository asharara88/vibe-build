#!/bin/bash
# Own check after the review bot on af80dc9: the four new web tests on the source before the fix (builder/src as at
# 5c639cc, whose builder/ equals 4e41340's) and on the fixed source (HEAD). Run from anywhere; writes into after-bot/.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j3
OUT=$W/evidence/2026-11-13-journey-j3/after-bot/own-check-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/ownj3-tmp BUILDER_BROWSER_CACHE=$S/p31-cache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_ownj3?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
BEFORE=5c639cc
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |AssertionError|Test timed out" ; }
CMD='npx vitest run test/web.test.ts -t "own check after the review bot on af80dc9" --reporter=verbose'
{
echo "J3, own check after the review bot on af80dc9: the new tests, $(date -u +%FT%TZ). Command (from builder/, database builder_test_ownj3, TMPDIR <scratchpad>/ownj3-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, the failures' first lines, and the summary are kept below."
echo
echo "1. BEFORE the fix: builder/src as at $BEFORE (git checkout $BEFORE -- src; builder/ at $BEFORE equals 4e41340's: git diff 4e41340 $BEFORE --stat -- builder: '$(git diff 4e41340 $BEFORE --stat -- . | tail -1)' (empty: none)), the tests as committed in $(git rev-parse --short HEAD). Expected: the three new tests fail (a pass shown and a live session left open under a sign-in being ended; a live session left open under the second cookie value), the control passes."
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
