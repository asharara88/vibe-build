#!/bin/bash
# J2 (c): the new tests (docs/design/journey-j2.md, section 6: C1 to C11 and C4b) on builder/src as at 14787d8, where
# they must fail (the regression guard C8 excepted), and on the change, where they must pass.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j2
OUT=$W/evidence/2026-11-13-journey-j2/new-tests-c-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/j2c-tmp NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_c?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS
mkdir -p $TMPDIR $(dirname $OUT)
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |^(AssertionError|TypeError|Error|JourneyRefused)" | cut -c1-400; }
CMD='npx vitest run test/journey.test.ts test/web.test.ts -t "J2 \(c\)" --reporter=verbose'
{
echo "J2 (c), the clean stop and restart: the new tests, $(date -u +%FT%TZ). Command (from builder/, test database builder_test_j2_c; each test makes and drops databases of its own named builder_test_j2_c_st_<hex> or _rs_<hex>; TMPDIR <scratchpad>/j2c-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, the first line of each failure, and the summary are kept below. Stand-in sandboxes only: no container, no model. C5 starts the real interface on ports the system gives (never 4020, 4022 or 4030 to 4034) and signals only the process it started."
echo
echo "1. BEFORE: builder/src as at 14787d8 (git checkout 14787d8 -- builder/src), the tests and builder/scripts as committed in $(git rev-parse --short HEAD). Expected: every new test fails, except the regression guard C8, which passes on both (section 6: scripts/ is not under src/)."
git checkout 14787d8 -- src
echo "   builder/src differs from 14787d8's: $(git diff 14787d8 --stat -- src | wc -l) lines of diff (0: none)"
flock -w 3600 $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
git checkout HEAD -- src
echo
echo "2. AFTER: the same command on $(git rev-parse --short HEAD) (git diff 14787d8 --stat -- src: $(git diff 14787d8 --stat -- src | tail -1))."
flock -w 3600 $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
echo
echo "Working tree after (git status --porcelain -- builder, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
