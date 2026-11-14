#!/bin/bash
# Known gap 145: the new tests (builder/test/overrun-stop.test.ts) on the source as at 14787d8 (the commit the review
# read) and on the fixed source, each on a fresh database, each under the shared lock. Run from anywhere.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-fix-145
OUT=$W/evidence/2026-11-14-fix-overrun-freeze/new-tests-before-and-after.txt
cd $W/builder || exit 1
export TMPDIR=$S/fx145-tmp NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |MEASURED|AssertionError|TypeError|Error: timed out" | sed 's/known gap 145: a streamed call read above its hold stops its project before the end marker reaches the caller (against a stand-in provider) > //'; }
CMD='npx vitest run test/overrun-stop.test.ts --reporter=verbose'
fresh() { dropdb -h /var/run/postgresql --if-exists $1 && createdb -h /var/run/postgresql $1; }
{
echo "Known gap 145: the new tests, $(date -u +%FT%TZ). Command (from builder/, TMPDIR <scratchpad>/fx145-tmp): flock <scratchpad>/live-tests.lock $CMD; only the tests run, their measurements, the first line of each failure and the summary are kept below."
echo
echo "1. BEFORE the fix: builder/src as at 14787d8 (git checkout 14787d8 -- src, and the migration added since removed), the tests as committed in $(git rev-parse --short HEAD). Database builder_test_fx145_before, fresh. Expected: every test fails but the arithmetic check and the control (4), which pass on both."
git checkout 14787d8 -- src
for f in $(git diff --name-only --diff-filter=A 14787d8 HEAD -- src); do rm -f "../$f"; done
echo "   builder/src differs from 14787d8's: $(git diff 14787d8 --stat -- src | wc -l) lines of diff, $(git status --porcelain -- src | grep -c '^??') files not in 14787d8 (0 and 0: none)"
fresh builder_test_fx145_before
BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fx145_before?host=/var/run/postgresql' flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
git checkout HEAD -- src
echo
echo "2. AFTER the fix: the same command on $(git rev-parse --short HEAD) (git diff 14787d8 --stat -- src: $(git diff 14787d8 --stat -- src | tail -1)). Database builder_test_fx145_after, fresh."
fresh builder_test_fx145_after
BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fx145_after?host=/var/run/postgresql' flock $S/live-tests.lock bash -c "$CMD" 2>&1 | keep
echo
echo "Working tree of builder/ after (git status --porcelain, count): $(git -C $W status --porcelain -- builder | wc -l)"
} > $OUT 2>&1
dropdb -h /var/run/postgresql --if-exists builder_test_fx145_before; dropdb -h /var/run/postgresql --if-exists builder_test_fx145_after
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
