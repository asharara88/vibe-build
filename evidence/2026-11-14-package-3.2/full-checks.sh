#!/bin/bash
# Package 3.2: the typecheck, the licence check and the whole suite (live tests included), on the branch's head, as
# evidence/2026-11-13-journey-j2/after-merge-e6bf03d/checks-after-merge.sh ran them: under the shared lock, the browser
# cache read only, a fresh database made and dropped, TMPDIR the session's short scratch folder (gap 175, point 2).
# Usage: full-checks.sh [static|suite|all]
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-32
D=$W/evidence/2026-11-14-package-3.2
WHAT=${1:-all}
cd $W/builder || exit 1
export TMPDIR=$S/x3 BUILDER_BROWSER_CACHE=$S/p31-cache
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
mkdir -p $TMPDIR $D
[ -z "$(git -C $W status --porcelain -- builder templates)" ] || { echo "builder/ or templates/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder); TT=$(git -C $W rev-parse --short HEAD:templates)
dropdbs() { for db in $(psql -h /var/run/postgresql -Atc "select datname from pg_database where datname like 'builder\_test\_x32full%'" postgres); do dropdb -h /var/run/postgresql --if-exists "$db"; done; }
# 1. The typecheck and the licence check.
if [ "$WHAT" = static ] || [ "$WHAT" = all ]; then
  { echo "Package 3.2: npm run typecheck on $H (builder/ tree $T, templates/ tree $TT), changed files in builder/ and templates/: $(git -C $W status --porcelain -- builder templates | wc -l), $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "Package 3.2: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 839be17 (git diff --stat 839be17 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 839be17 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
fi
# 2. The whole suite, on a fresh database.
if [ "$WHAT" = suite ] || [ "$WHAT" = all ]; then
  export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_x32full?host=/var/run/postgresql'
  dropdbs; createdb -h /var/run/postgresql builder_test_x32full
  {
  echo "Package 3.2: the whole suite, live tests included, on $H (builder/ tree $T, templates/ tree $TT), changed files in builder/ and templates/: $(git -C $W status --porcelain -- builder templates | wc -l). Database builder_test_x32full, fresh (tests that make databases of their own name them builder_test_x32full_<..>). TMPDIR <scratchpad>/x3. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache, read only)."
  echo "Free disk before: $(df -h / | tail -1)"
  echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "The browser zip in the cache before (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
  flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
  echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
  echo "Databases builder_test_x32full_<..> left by the tests: $(psql -h /var/run/postgresql -Atc "select count(*) from pg_database where datname like 'builder\_test\_x32full\_%'" postgres)"
  echo "The browser zip in the cache after (size, modified): $(stat -c '%s %y' $BUILDER_BROWSER_CACHE/chrome-headless-shell-linux64.zip)"
  echo "Free disk after: $(df -h / | tail -1)"
  } > $D/run-tests-full.txt 2>&1
  dropdbs
fi
sed -i "s#$S#<scratchpad>#g" $D/run-typecheck.txt $D/run-licences.txt $D/run-tests-full.txt 2>/dev/null
echo all-done
