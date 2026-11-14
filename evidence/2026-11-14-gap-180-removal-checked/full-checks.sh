#!/bin/bash
# Known gap 180's fix (a removal is recorded as done only when Docker lists nothing of the project): the checks, in order.
#   1. Its tests before and after: with the fixed files as on claude/stage-1, then as here.
#   2. Every control of the journey's list (58: the 53 of pull request #49 and five for this fix).
#   3. The whole suite, live tests included, on a fresh database.
#   4. The type check and the licence check.
# Each step that starts containers holds the shared lock. Run from anywhere; writes next to this script.
S=/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad
W=/home/user/vibe-build
D=$W/evidence/2026-11-14-gap-180-removal-checked
BASE=origin/claude/stage-1
FIXED="src/orchestrator/example-1-adapter.ts src/orchestrator/journey.ts src/web/pages.ts src/web/messages/en.json src/web/messages/ar.json"
cd $W/builder || exit 1
export TMPDIR=$S/t1 BUILDER_BROWSER_CACHE=$S/bcache NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder); B=$(git -C $W rev-parse --short $BASE)
db() { dropdb -h /var/run/postgresql --if-exists "$1" 2>/dev/null; createdb -h /var/run/postgresql "$1"; }
dropall() { for x in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_g180\_%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$x"; done; }
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_g180_new?host=/var/run/postgresql'
new_tests() {
  for t in "test/web.test.ts|C14 \(known gap 180's fix\)" "test/web.test.ts|C15 \(known gap 180's fix\)" "test/journey.test.ts|C16 \(known gap 180's fix\)"; do
    f=${t%%|*}; n=${t#*|}
    echo "$f -t \"$n\": $(flock $S/live-tests.lock npx vitest run $f -t "$n" 2>&1 | grep -E '^\s*(Tests|Test Files) ' | tr -s ' ' | tr '\n' ' ')"
  done
  echo "test/removal-live.test.ts (real Docker; all of it): $(flock $S/live-tests.lock npx vitest run test/removal-live.test.ts 2>&1 | grep -E '^\s*(Tests|Test Files) |Error: |SyntaxError|does not provide' | tr -s ' ' | head -3 | tr '\n' ' ')"
}
{
echo "Known gap 180's fix: its tests, on $H (builder/ tree $T). $(date -u +%FT%TZ)."
echo
echo "== BEFORE: the fixed files as on claude/stage-1 at $B (git checkout $BASE -- $FIXED); the test files as here"
db builder_test_g180_new; git checkout -q $BASE -- $FIXED; echo "files of builder/ differing from HEAD now: $(git status --porcelain -- . | wc -l)"
new_tests
git checkout -q HEAD -- $FIXED
echo
echo "== AFTER: everything as committed at $H (files of builder/ differing from HEAD: $(git status --porcelain -- . | wc -l))"
db builder_test_g180_new
new_tests
echo
echo "Left on the machine by the live test (containers named removal-test-holder-*, networks named builder_j1-*_front): $(docker ps -a --format '{{.Names}}' | grep -c removal-test-holder), $(docker network ls --format '{{.Name}}' | grep -c 'builder_j1-.*_front')"
} > $D/new-tests-before-and-after.txt 2>&1
dropall
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_g180_ctl?host=/var/run/postgresql'
db builder_test_g180_ctl
flock $S/live-tests.lock python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-output.txt > $S/runs/g180-controls-stdout.txt 2>&1
dropall
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_g180_full?host=/var/run/postgresql'
db builder_test_g180_full
{
echo "Known gap 180's fix: the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_g180_full, fresh. TMPDIR <scratchpad>/t1. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/bcache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, names): $(docker ps -a --format '{{.Names}}' | tr '\n' ' ')"
echo "Free disk after: $(df -h / | tail -1)"
} > $D/run-tests-full.txt 2>&1
dropall
{ echo "Known gap 180's fix: npm run typecheck on $H (builder/ tree $T), $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
{ echo "Known gap 180's fix: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). No dependency file is changed."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
sed -i "s#$S#<scratchpad>#g" $D/*.txt
echo all-done
