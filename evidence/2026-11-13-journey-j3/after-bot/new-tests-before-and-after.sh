#!/bin/bash
# After the review bot on af80dc9: the new tests on the source as at af80dc9 and on the fixed source; and a scratch
# measurement (copied into test/ for the run, removed after) of how long a cut-short answer stays open at the browser.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j3
OUT=$W/evidence/2026-11-13-journey-j3/after-bot/new-tests-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/botj3-tmp BUILDER_BROWSER_CACHE=$S/p31-cache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_botj3?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR $(dirname $OUT)
[ -z "$(git -C $W status --porcelain)" ] || { echo "tree not clean"; exit 1; }
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |MEASURED|AssertionError|TypeError: (t\.)?p\.beginOpen|TypeError: relayAnswer|Test timed out" | sed 's/^stdout.*//' ; }
CMD='npx vitest run test/preview.test.ts test/web.test.ts test/journey.test.ts -t af80dc9 --reporter=verbose'
{
echo "J3, after the review bot on af80dc9: the new tests, $(date -u +%FT%TZ). Command (from builder/, database builder_test_botj3, TMPDIR <scratchpad>/botj3-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, the first line of each failure, and the summary are kept below."
echo
echo "1. BEFORE the fixes: builder/src as at af80dc9 (git checkout af80dc9 -- builder/src), the tests as committed in $(git rev-parse --short HEAD). Expected: every new test fails but the control (another sign-in session's sign-out does not cancel the open), which passes on both."
git checkout af80dc9 -- src
echo "   builder/src differs from af80dc9's: $(git diff af80dc9 --stat -- src | wc -l) lines of diff (0: none)"
flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
cp $W/evidence/2026-11-13-journey-j3/after-bot/measure-cut-short.test.ts test/zz-botj3-measure.test.ts
echo
echo "   The scratch measurement on the same source (a copy of a stand-in app that says Content-Length: 100, sends 5 bytes, and is gone 100 ms later; through the real forked front; not committed):"
flock $S/live-tests.lock npx vitest run test/zz-botj3-measure.test.ts --reporter=verbose 2>&1 | keep
rm -f test/zz-botj3-measure.test.ts
git checkout HEAD -- src
echo
echo "2. AFTER the fixes: the same command on $(git rev-parse --short HEAD) (git diff af80dc9 --stat -- src: $(git diff af80dc9 --stat -- src | tail -1))."
flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
cp $W/evidence/2026-11-13-journey-j3/after-bot/measure-cut-short.test.ts test/zz-botj3-measure.test.ts
echo
echo "   The scratch measurement on the fixed source:"
flock $S/live-tests.lock npx vitest run test/zz-botj3-measure.test.ts --reporter=verbose 2>&1 | keep
rm -f test/zz-botj3-measure.test.ts
echo
echo "Working tree after (git status --porcelain, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
