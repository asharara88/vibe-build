#!/bin/bash
# J2 (a): the new tests (docs/design/journey-j2.md, section 6: A1, A1b, A2, A2b, A3 to A9, A8b) on builder/src as at
# 14787d8, where they must fail (the regression guards A1 and A1b excepted), and on the change, where they must pass.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j2
OUT=$W/evidence/2026-11-13-journey-j2/new-tests-a-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/j2a-tmp NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_a?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR $(dirname $OUT)
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |^(AssertionError|TypeError|Error)" | cut -c1-400; }
CMD='npx vitest run test/journey.test.ts test/web.test.ts -t "J2 \(a\)" --reporter=verbose'
{
echo "J2 (a), the broken copy rejected: the new tests, $(date -u +%FT%TZ). Command (from builder/, database builder_test_j2_a, TMPDIR <scratchpad>/j2a-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, the first line of each failure, and the summary are kept below. Stand-in sandboxes only: no container, no model."
echo
echo "1. BEFORE: builder/src and builder/camera as at 14787d8 (git checkout 14787d8 -- builder/src builder/camera; the app camera's script, which A8b reads, is outside src), the tests as committed in $(git rev-parse --short HEAD). Expected: every new test fails, except the regression guards A1 and A1b, which pass on both (section 6). A2b fails as a whole: its extra-field part is a guard, its name refusal is new."
git checkout 14787d8 -- src camera
echo "   builder/src and builder/camera differ from 14787d8's: $(git diff 14787d8 --stat -- src camera | wc -l) lines of diff (0: none)"
flock -w 1800 $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
git checkout HEAD -- src camera
echo
echo "2. AFTER: the same command on $(git rev-parse --short HEAD) (git diff 14787d8 --stat -- src camera: $(git diff 14787d8 --stat -- src camera | tail -1))."
flock -w 1800 $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
echo
echo "Working tree after (git status --porcelain -- builder, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
