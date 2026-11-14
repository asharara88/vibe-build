#!/bin/bash
# J2 brought up to date with the integration branch at c4f198b (14 Nov 2026): the typecheck, the licence check, J2's
# 45 controls, the sign-off fix's 8 controls (evidence/2026-11-14-fix-signoff-live/controls.py) and the whole suite
# (live tests included), on the merged head. Written as ../after-review/checks-after-review.sh, writing into
# after-merge/ so that the earlier checks' files stay as they were. Each test run under the shared lock, on a fresh
# database dropped after, TMPDIR in the session's scratch folder.
# Usage: checks-after-merge.sh [static|controls|signoff|suite|all]
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j2
D=$W/evidence/2026-11-13-journey-j2/after-merge
WHAT=${1:-all}
cd $W/builder || exit 1
export TMPDIR=$S/j2mg-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR $D
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
dropdbs() { for db in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_j2\_$1%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$db"; done; }
# 1. The typecheck and the licence check.
if [ "$WHAT" = static ] || [ "$WHAT" = all ]; then
  { echo "J2 after merging c4f198b: npm run typecheck on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "J2 after merging c4f198b: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 14787d8 (git diff --stat 14787d8 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 14787d8 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
fi
# 2. J2's controls, every one (J2-C01 to J2-C45), under the lock.
if [ "$WHAT" = controls ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_mgctl?host=/var/run/postgresql'
  dropdbs mgctl; createdb -h /var/run/postgresql builder_test_j2_mgctl
  flock -w 3600 $S/live-tests.lock python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-j2-after-merge.txt
  left=$(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_mgctl\_%'" postgres)
  echo "Databases left by a control's test (builder_test_j2_mgctl_<..>), dropped now: $left" >> $D/controls-j2-after-merge.txt
  dropdbs mgctl
fi
# 3. The sign-off fix's controls (SO-C01 to SO-C08), under the lock.
if [ "$WHAT" = signoff ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_mgso?host=/var/run/postgresql'
  dropdbs mgso; createdb -h /var/run/postgresql builder_test_j2_mgso
  flock -w 3600 $S/live-tests.lock python3 ../evidence/2026-11-14-fix-signoff-live/controls.py $D/controls-signoff-after-merge.txt
  left=$(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_mgso\_%'" postgres)
  echo "Databases left by a control's test (builder_test_j2_mgso_<..>), dropped now: $left" >> $D/controls-signoff-after-merge.txt
  dropdbs mgso
fi
# 4. The whole suite, on a fresh database.
if [ "$WHAT" = suite ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_mgfull?host=/var/run/postgresql'
  dropdbs mgfull; createdb -h /var/run/postgresql builder_test_j2_mgfull
  {
  echo "J2 after merging c4f198b: the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_j2_mgfull, fresh (the J2 (c) tests make and drop databases of their own, builder_test_j2_mgfull_<..>). TMPDIR <scratchpad>/j2mg-tmp. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache, read only)."
  echo "Free disk before: $(df -h / | tail -1)"
  echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "The browser zip in the cache before (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
  flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
  echo "Databases builder_test_j2_mgfull_<..> left by the J2 (c) tests: $(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_mgfull\_%'" postgres)"
  echo "The browser zip in the cache after (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Free disk after: $(df -h / | tail -1)"
  } > $D/run-tests-full.txt 2>&1
  dropdbs mgfull
fi
sed -i "s#$S#<scratchpad>#g" $D/*.txt 2>/dev/null
echo all-done
