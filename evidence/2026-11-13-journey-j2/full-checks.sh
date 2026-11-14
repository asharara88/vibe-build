#!/bin/bash
# J2: the controls of design section 6 (and of the safeguards the builders added), then the whole suite (live tests
# included), each under the shared lock; then the typecheck and the licence check. Written as J3's
# evidence/2026-11-13-journey-j3/after-bot/full-suite.sh. Run from anywhere; writes into evidence/2026-11-13-journey-j2/.
# Usage: full-checks.sh [controls|suite|static|all]
S=/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad
W=/home/user/vibe-build
D=$W/evidence/2026-11-13-journey-j2
WHAT=${1:-all}
cd $W/builder || exit 1
export TMPDIR=$S/t1 BUILDER_BROWSER_CACHE=$S/bcache
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
dropj2() { for db in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_j2\_$1%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$db"; done; }
# 1. The controls, every one, under the lock, on a database of their own (each C test makes and drops its own, named after it).
if [ "$WHAT" = controls ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_ctl?host=/var/run/postgresql'
  dropj2 ctl; createdb -h /var/run/postgresql builder_test_j2_ctl
  flock $S/live-tests.lock python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-output.txt
  # A control whose test ran into its time limit leaves that test's own database; dropped here.
  left=$(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_ctl\_%'" postgres)
  echo "Databases left by a control's test cut off at its time limit (builder_test_j2_ctl_<..>), dropped now: $left" >> $D/controls-output.txt
  dropj2 ctl
fi
# 2. The whole suite, on a fresh database.
if [ "$WHAT" = suite ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_full?host=/var/run/postgresql'
  dropj2 full; createdb -h /var/run/postgresql builder_test_j2_full
  {
  echo "Package J2: the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_j2_full, fresh (the J2 (c) tests make and drop databases of their own, builder_test_j2_full_<..>). TMPDIR <scratchpad>/j2full-tmp. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache)."
  echo "Free disk before: $(df -h / | tail -1)"
  echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
  flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
  echo "Databases builder_test_j2_full_<..> left by the J2 (c) tests: $(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_full\_%'" postgres)"
  echo "Free disk after: $(df -h / | tail -1)"
  } > $D/run-tests-full.txt 2>&1
  dropj2 full
fi
# 3. The typecheck and the licence check.
if [ "$WHAT" = static ] || [ "$WHAT" = all ]; then
  { echo "Package J2: npm run typecheck on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "Package J2: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 14787d8 (git diff --stat 14787d8 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 14787d8 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
fi
sed -i "s#$S#<scratchpad>#g" $D/controls-output.txt $D/run-tests-full.txt $D/run-typecheck.txt $D/run-licences.txt 2>/dev/null
echo all-done
