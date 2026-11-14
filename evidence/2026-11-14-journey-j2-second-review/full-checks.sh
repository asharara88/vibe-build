#!/bin/bash
# J2, second review (pull request #49): the checks on the final code, in this order.
#   1. The new tests before and after: with the fixed files as on claude/stage-1 (pull request #48 merged), then as here.
#   2. Every control of J2's list (53: #48's 45, two of them given the text as it now stands, and eight for these fixes).
#   3. The whole suite, live tests included, on a fresh database.
#   4. The type check and the licence check.
#   5. J2's automated run (scripts/demo-journey-j2.ts), into a folder outside the repository; its text files and the six
#      screenshots these fixes change are then copied here.
# Each step that starts containers holds the shared lock. Run from anywhere; writes next to this script.
S=/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad
W=/home/user/vibe-build
D=$W/evidence/2026-11-14-journey-j2-second-review
BASE=origin/claude/stage-1
FIXED="src/orchestrator/journey.ts src/web/main.ts src/web/pages.ts src/web/messages/en.json src/web/messages/ar.json scripts/journey-restart-checks.ts scripts/example-1-sandbox.ts"
cd $W/builder || exit 1
export TMPDIR=$S/t1 BUILDER_BROWSER_CACHE=$S/bcache NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder); B=$(git -C $W rev-parse --short $BASE)
db() { dropdb -h /var/run/postgresql --if-exists "$1" 2>/dev/null; createdb -h /var/run/postgresql "$1"; }
dropall() { for x in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_j2r\_%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$x"; done; }
# 1. The new tests, before and after.
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2r_new?host=/var/run/postgresql'
new_tests() {
  for t in "test/journey.test.ts|A4c \(after J2's second review\)" "test/journey.test.ts|C8 \(regression guard\)" "test/web.test.ts|C12 \(after J2's second review\)" "test/web.test.ts|C13 \(after the review of pull request #49\)" "test/web.test.ts|A2 and A8:" "test/web.test.ts|A8: the broken copy through the screens" "test/web.test.ts|C7: the interrupted panel"; do
    f=${t%%|*}; n=${t#*|}
    echo "$f -t \"$n\": $(flock $S/live-tests.lock npx vitest run $f -t "$n" 2>&1 | grep -E '^\s*Tests ' | tr -s ' ')"
  done
}
{
echo "J2, second review: the tests these fixes add or extend, on $H (builder/ tree $T). $(date -u +%FT%TZ)."
echo
echo "== BEFORE: the fixed files as on claude/stage-1 at $B (git checkout $BASE -- $FIXED); the test files as here"
db builder_test_j2r_new; git checkout -q $BASE -- $FIXED; echo "files of builder/ differing from HEAD now: $(git status --porcelain -- . | wc -l)"
new_tests
git checkout -q HEAD -- $FIXED
echo
echo "== AFTER: everything as committed at $H (files of builder/ differing from HEAD: $(git status --porcelain -- . | wc -l))"
db builder_test_j2r_new
new_tests
} > $D/new-tests-before-and-after.txt 2>&1
dropall
# 2. The controls.
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2r_ctl?host=/var/run/postgresql'
db builder_test_j2r_ctl
flock $S/live-tests.lock python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-output.txt > $S/runs/j2r-controls-stdout.txt 2>&1
dropall
# 3. The whole suite.
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2r_full?host=/var/run/postgresql'
db builder_test_j2r_full
{
echo "J2, second review: the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_j2r_full, fresh. TMPDIR <scratchpad>/t1. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/bcache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Folders left in TMPDIR: $(ls $TMPDIR | tr '\n' ' ')"
echo "Free disk after: $(df -h / | tail -1)"
} > $D/run-tests-full.txt 2>&1
dropall
# 4. The type check and the licence check.
{ echo "J2, second review: npm run typecheck on $H (builder/ tree $T), $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
{ echo "J2, second review: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). No dependency file is changed by these fixes."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
# 5. The automated run.
R=$S/j2r-run; rm -rf $R; mkdir -p $R
unset BUILDER_TEST_DATABASE_URL
{ echo "The run's lock lines (the wrapper's output around the run: flock, then the run, then these), on $H (builder/ tree $T):"
  flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx tsx scripts/demo-journey-j2.ts '$R' > '$S'/runs/j2r-demo-stdout.txt 2>&1; echo "run exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
} > $D/lock-lines.txt 2>&1
cp $R/run-demo.txt $R/events.json $R/camera-lines.jsonl $R/interface-log.txt $D/ 2>/dev/null
mkdir -p $D/screens; cp $R/screens/01-projects-*.png $R/screens/07-checklist-*.png $D/screens/ 2>/dev/null
echo "Screenshots the run made: $(ls $R/screens 2>/dev/null | wc -l); copied here: $(ls $D/screens | wc -l) (the Projects screen and the checklist screen, which these fixes change)." >> $D/lock-lines.txt
sed -i "s#$S#<scratchpad>#g" $D/*.txt
echo all-done
