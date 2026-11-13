#!/bin/bash
# J3 after the review: the whole suite, live tests included, under the shared lock. Run from anywhere; writes after-review/run-tests-full.txt.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-j3
OUT=$W/evidence/2026-11-13-journey-j3/after-review/run-tests-full.txt
cd $W/builder || exit 1
export TMPDIR=$S/j3fixfull-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j3fixfull?host=/var/run/postgresql'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
dropdb -h /var/run/postgresql --if-exists builder_test_j3fixfull && createdb -h /var/run/postgresql builder_test_j3fixfull
{
echo "Package J3 after the review: the whole suite, live tests included, on $(git -C $W rev-parse --short HEAD) (builder/ tree $(git -C $W rev-parse --short HEAD:builder)), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files. Database builder_test_j3fixfull, fresh. TMPDIR <scratchpad>/j3fixfull-tmp. Command: flock <scratchpad>/live-tests.lock npx vitest run --reporter=verbose (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Ports 13161 and 4041 before (listening on 127.0.0.1?): $(awk 'NR>1 && $4=="0A" {print $2}' /proc/net/tcp | grep -ciE ':(3369|0FC9)$') of 2 listening"
echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run --reporter=verbose; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Short folders of previews left in /tmp: $(ls /tmp | grep -cE '^bp[vc]-')"
echo "Free disk after: $(df -h / | tail -1)"
} > $OUT 2>&1
dropdb -h /var/run/postgresql --if-exists builder_test_j3fixfull
rm -rf $TMPDIR
sed -i "s#$S#<scratchpad>#g" $OUT
echo done
