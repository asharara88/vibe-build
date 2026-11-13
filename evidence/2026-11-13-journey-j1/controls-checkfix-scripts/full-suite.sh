#!/bin/bash
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
OUT=$S/fixj1-ctl/run-tests-full-checkfix.txt
cd $S/wt-j1/builder || exit 1
export TMPDIR=$S/fixj1-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fixj1?host=/var/run/postgresql'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
dropdb -h /var/run/postgresql --if-exists builder_test_fixj1 && createdb -h /var/run/postgresql builder_test_fixj1
{
echo "The whole suite, live tests included, on $(git -C $S/wt-j1 rev-parse --short HEAD) (builder/ tree $(git -C $S/wt-j1 rev-parse --short HEAD:builder)), working tree clean: $(git -C $S/wt-j1 status --porcelain | wc -l) changed files. Database builder_test_fixj1, fresh. Command: flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache)."
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done > $S/fixj1-ctl/full.done
