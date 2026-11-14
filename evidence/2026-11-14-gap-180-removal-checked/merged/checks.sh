#!/bin/bash
# Pull request #51, the checks on its final code (gap 180's fix merged, gap 185's helper): each output kept under <scratchpad>/final51/.
S=<scratchpad>
W=/home/user/vibe-build; D=$S/final51; LOCK=$S/live-tests.lock
rm -rf $D; mkdir -p $D/j2 $D/j1 $D/j3 $S/runs
cd $W/builder || exit 1
export TMPDIR=$S/t1 BUILDER_BROWSER_CACHE=$S/bcache NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW BUILDER_TEST_DATABASE_URL
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder evidence/2026-11-13-journey-j2)" ] || { echo "builder/ or the controls script is not as committed"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
ON="on commit $H (builder/ tree $T), builder/ as committed"
db() { dropdb -h /var/run/postgresql --if-exists "$1" 2>/dev/null; createdb -h /var/run/postgresql "$1"; }
dropall() { for x in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_f51%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$x"; done; }
{ echo "npm run typecheck, $ON, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
{ echo "npm run check:licences, $ON, $(date -u +%FT%TZ). No dependency file is changed."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
echo quick-done
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_f51?host=/var/run/postgresql'
db builder_test_f51
{ echo "Known gap 185's helper: its own tests (test/drop-test-db.test.ts), $ON, $(date -u +%FT%TZ). Needs PostgreSQL only."; npx vitest run test/drop-test-db.test.ts; echo "vitest exit code: $?"; } > $D/run-helper-tests.txt 2>&1
for f in web journey; do for i in 1 2 3; do
  db builder_test_f51
  { echo "test/$f.test.ts whole, run $i of 3, $ON. Database builder_test_f51, fresh. Under the shared lock. Each run is kept; none is replaced."
    flock $LOCK bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run test/'$f'.test.ts 2>&1 | grep -vE "^\s*(✓|·)" | tail -40; echo "vitest exit code: ${PIPESTATUS[0]}"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  } > $D/run-$f-whole-run-$i.txt 2>&1
  echo "$f run $i: $(grep -E 'Tests |Errors|vitest exit code' $D/run-$f-whole-run-$i.txt | tr -s ' ' | tr '\n' ' ')"
done; done
db builder_test_f51
flock $LOCK python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-output.txt > $D/controls-stdout.txt 2>&1
echo "controls: $(tail -3 $D/controls-output.txt | tr '\n' ' ')"
dropall; db builder_test_f51
{
echo "The whole suite, live tests included, $ON; working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files; builder/node_modules a real folder: $([ -L node_modules ] && echo NO, a link || echo yes). Database builder_test_f51, fresh. TMPDIR <scratchpad>/t1. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/bcache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
flock $LOCK bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, names): $(docker ps -a --format '{{.Names}}' | tr '\n' ' ')"
echo "Free disk after: $(df -h / | tail -1)"
} > $D/run-tests-full.txt 2>&1
echo "suite: $(grep -E 'Test Files|Tests |Errors|vitest exit code' $D/run-tests-full.txt | tr -s ' ' | tr '\n' ' ')"
dropall
unset BUILDER_TEST_DATABASE_URL
for r in "j2 demo-journey-j2.ts" "j1 demo-journey.ts" "j3 demo-journey-j3.ts"; do
  n=${r%% *}; f=${r#* }; R=$D/$n
  { echo "The run's lock lines (flock, then the run, then these), $ON; working tree of builder/: $(git status --porcelain -- . | wc -l) changed files:"
    flock $LOCK bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx tsx scripts/'$f' '$R' > '$S'/runs/final51-'$n'-stdout.txt 2>&1; echo "run exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  } > $R/lock-lines.txt 2>&1
  echo "$n done: $(tail -2 $R/lock-lines.txt | tr '\n' ' ')"
done
echo all-done
