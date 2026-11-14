#!/bin/bash
# Sign-off and the live app (after the review of 14787d8, known gap 161): the controls, then the whole suite (live tests
# included), each under the shared lock, as evidence/2026-11-13-journey-j3/after-bot/full-suite.sh runs it; then the
# typecheck and the licence check. Run from anywhere; writes next to this script.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-fix-signoff
D=$W/evidence/2026-11-14-fix-signoff-live
cd $W/builder || exit 1
export TMPDIR=$S/fxso-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fxso?host=/var/run/postgresql'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
# 1. The controls, every one, under the lock.
dropdb -h /var/run/postgresql --if-exists builder_test_fxso && createdb -h /var/run/postgresql builder_test_fxso
flock $S/live-tests.lock python3 ../evidence/2026-11-14-fix-signoff-live/controls.py $D/controls.txt
# 2. The whole suite, on a fresh database.
dropdb -h /var/run/postgresql --if-exists builder_test_fxso && createdb -h /var/run/postgresql builder_test_fxso
{
echo "Sign-off and the live app (after the review of 14787d8, known gap 161): the whole suite, live tests included, on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_fxso, fresh. TMPDIR <scratchpad>/fxso-tmp. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; echo "Containers on this machine with the lock held (docker ps -a, count): $(docker ps -aq | wc -l)"; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
echo "Free disk after: $(df -h / | tail -1)"
} > $D/run-tests-full.txt 2>&1
# 3. The typecheck and the licence check.
{ echo "Sign-off and the live app: npm run typecheck on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
{ echo "Sign-off and the live app: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 14787d8 (git diff --stat 14787d8 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 14787d8 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
sed -i "s#$S#<scratchpad>#g" $D/run-tests-full.txt $D/run-typecheck.txt $D/run-licences.txt $D/controls.txt
dropdb -h /var/run/postgresql --if-exists builder_test_fxso
echo all-done
