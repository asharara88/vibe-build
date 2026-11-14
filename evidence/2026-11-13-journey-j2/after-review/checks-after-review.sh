#!/bin/bash
# J2, after the review of 14 Nov 2026: the new tests before and after the fix, every control (the 42 earlier ones
# again and the fix's three), the whole suite (live tests included), the typecheck and the licence check.
# Written as ../full-checks.sh, writing into after-review/ so that the first checks' files stay as they were.
# Usage: checks-after-review.sh [newtests|controls|suite|static|all]
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j2
D=$W/evidence/2026-11-13-journey-j2/after-review
BEFORE=5ed7f04   # the commit the review read; builder/src as there is the code before the fix
WHAT=${1:-all}
cd $W/builder || exit 1
export TMPDIR=$S/j2rv-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR $D
[ -z "$(git -C $W status --porcelain -- builder)" ] || { echo "builder/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
dropdbs() { for db in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_j2\_$1%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$db"; done; }
keep() { grep -E "^ +(✓|×) |Test Files|^ +Tests |^(AssertionError|TypeError|Error)|^ ❯ test/[a-z.-]+:[0-9]+" | cut -c1-400; }
# 1. The new tests (A4b, A6b) on builder/src as at $BEFORE and on HEAD; then every J2 (a) test of both files on HEAD.
if [ "$WHAT" = newtests ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_rvnew?host=/var/run/postgresql'
  dropdbs rvnew; createdb -h /var/run/postgresql builder_test_j2_rvnew
  NEW='npx vitest run test/journey.test.ts -t "A4b|A6b" --reporter=verbose'
  ALLA='npx vitest run test/journey.test.ts test/web.test.ts -t "J2 \(a\)" --reporter=verbose'
  {
  echo "J2 after the review: the new tests, $(date -u +%FT%TZ). From builder/, database builder_test_j2_rvnew (fresh, dropped after), TMPDIR <scratchpad>/j2rv-tmp, each command under flock <scratchpad>/live-tests.lock. Only the tests run, the first line of each failure, and the summary are kept. Stand-in sandboxes only: no container, no model."
  echo
  echo "1. BEFORE: builder/src as at $BEFORE (git checkout $BEFORE -- src), the tests as committed in $H. Command: $NEW. Expected: A4b fails (a sandbox folder that is a link into builder/, or under one, before its change-set folder is made, was accepted); A6b passes (it guards a rule that was already there, which had no test that failed without it)."
  git checkout $BEFORE -- src
  echo "   builder/src differs from $BEFORE's: $(git diff $BEFORE --stat -- src | wc -l) lines of diff (0: none)"
  flock -w 3600 $S/live-tests.lock bash -c "$NEW" 2>&1 | keep
  git checkout HEAD -- src
  echo
  echo "2. AFTER: the same command on $H (git diff $BEFORE --stat -- src: $(git diff $BEFORE --stat -- src | tail -1))."
  flock -w 3600 $S/live-tests.lock bash -c "$NEW" 2>&1 | keep
  echo
  echo "3. AFTER, every J2 (a) test of both files (the target check is also used by A4's tests): $ALLA"
  flock -w 3600 $S/live-tests.lock bash -c "$ALLA" 2>&1 | grep -E "Test Files|^ +Tests |^ +× " | cut -c1-400
  echo
  echo "Working tree after (git status --porcelain -- builder, count): $(git -C $W status --porcelain -- builder | wc -l)"
  } > $D/new-tests-before-and-after.txt 2>&1
  dropdbs rvnew
fi
# 2. Every control, the 42 earlier ones again and J2-C43 to J2-C45 for the fix, under the lock.
if [ "$WHAT" = controls ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_rvctl?host=/var/run/postgresql'
  dropdbs rvctl; createdb -h /var/run/postgresql builder_test_j2_rvctl
  flock -w 3600 $S/live-tests.lock python3 ../evidence/2026-11-13-journey-j2/controls-scripts/controls.py $D/controls-after-review.txt
  left=$(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_rvctl\_%'" postgres)
  echo "Databases left by a control's test (builder_test_j2_rvctl_<..>), dropped now: $left" >> $D/controls-after-review.txt
  dropdbs rvctl
fi
# 3. The whole suite, on a fresh database.
if [ "$WHAT" = suite ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j2_rvfull?host=/var/run/postgresql'
  dropdbs rvfull; createdb -h /var/run/postgresql builder_test_j2_rvfull
  {
  echo "Package J2 after the review: the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_j2_rvfull, fresh (the J2 (c) tests make and drop databases of their own, builder_test_j2_rvfull_<..>). TMPDIR <scratchpad>/j2rv-tmp. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache, read only)."
  echo "Free disk before: $(df -h / | tail -1)"
  echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "The browser zip in the cache before (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
  flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
  echo "Databases builder_test_j2_rvfull_<..> left by the J2 (c) tests: $(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_j2\_rvfull\_%'" postgres)"
  echo "The browser zip in the cache after (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Free disk after: $(df -h / | tail -1)"
  } > $D/run-tests-full.txt 2>&1
  dropdbs rvfull
fi
# 4. The typecheck and the licence check.
if [ "$WHAT" = static ] || [ "$WHAT" = all ]; then
  { echo "Package J2 after the review: npm run typecheck on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "Package J2 after the review: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 14787d8 (git diff --stat 14787d8 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 14787d8 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
fi
sed -i "s#$S#<scratchpad>#g" $D/*.txt 2>/dev/null
echo all-done
