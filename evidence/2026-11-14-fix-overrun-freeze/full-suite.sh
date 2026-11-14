#!/bin/bash
# Known gap 145: the 13 controls, then the whole suite (live tests included), each under the shared lock; then the
# typecheck and the licence check. As evidence/2026-11-13-journey-j3/after-bot/full-suite.sh runs them, with one
# difference: the whole suite runs in a fresh local clone of this branch's HEAD (in the scratchpad), with a full copy of
# this worktree's installed packages as its node_modules. At 03:29 UTC on 14 Nov this worktree's node_modules link was replaced,
# not by this work, with a folder named node_modules.real, which vitest and the image scan do not skip (they skip only
# folders named node_modules); the run in the worktree is kept as run-tests-full-in-worktree.txt. A first clone used links
# to those packages instead of a copy: the live tests' containers mount the builder folder and could not follow a link
# pointing outside it (run-tests-full-in-clone-with-links.txt). Run from anywhere.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-fix-145
D=$W/evidence/2026-11-14-fix-overrun-freeze
cd $W/builder || exit 1
export TMPDIR=$S/fx145-tmp BUILDER_BROWSER_CACHE=$S/p31-cache
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
# 1. The controls, every one, under the lock, on a fresh database.
dropdb -h /var/run/postgresql --if-exists builder_test_fx145_ctl && createdb -h /var/run/postgresql builder_test_fx145_ctl
BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fx145_ctl?host=/var/run/postgresql' flock $S/live-tests.lock python3 $D/controls.py $D/controls.txt
dropdb -h /var/run/postgresql --if-exists builder_test_fx145_ctl
# 2. The whole suite, on a fresh database, in a fresh clone of HEAD.
C=$S/fx145-suite
rm -rf $C && git clone -q --branch claude/fix-overrun-freeze-timing --single-branch /home/user/vibe-build $C
[ "$(git -C $C rev-parse HEAD)" = "$(git -C $W rev-parse HEAD)" ] || { echo "the clone is not at this worktree's HEAD"; exit 1; }
cp -a $W/builder/node_modules.real $C/builder/node_modules
cp -a $W/builder/runner/node_modules.real $C/builder/runner/node_modules
printf 'builder/node_modules\nbuilder/runner/node_modules\n' >> $C/.git/info/exclude
cd $C/builder || exit 1
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fx145_full?host=/var/run/postgresql'
dropdb -h /var/run/postgresql --if-exists builder_test_fx145_full && createdb -h /var/run/postgresql builder_test_fx145_full
{
echo "Known gap 145: the whole suite, live tests included, on $H (builder/ tree $T), in a fresh clone of the branch at <scratchpad>/fx145-suite (HEAD $(git -C $C rev-parse --short HEAD), builder/ tree $(git -C $C rev-parse --short HEAD:builder), git status --porcelain: $(git -C $C status --porcelain | wc -l) lines), node_modules a full copy of the worktree's installed packages (cp -a). Database builder_test_fx145_full, fresh. TMPDIR <scratchpad>/fx145-tmp. Command (from the clone's builder/): flock <scratchpad>/live-tests.lock npx vitest run (BUILDER_BROWSER_CACHE=<scratchpad>/p31-cache)."
echo "Free disk before: $(df -h / | tail -1)"
echo "Containers on this machine before (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Waiting for the shared lock from $(date -u +%H:%M:%S) UTC."
flock $S/live-tests.lock bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -a, count): $(docker ps -aq | wc -l)"
echo "Free disk after: $(df -h / | tail -1)"
} > $D/run-tests-full.txt 2>&1
dropdb -h /var/run/postgresql --if-exists builder_test_fx145_full
cd $W/builder && rm -rf $C
# 3. The typecheck and the licence check, in the worktree.
{ echo "Known gap 145: npm run typecheck on $H (builder/ tree $T), working tree of builder/: $(git -C $W status --porcelain -- builder | wc -l) changed files, $(date -u +%FT%TZ)."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
{ echo "Known gap 145: npm run check:licences on $H (builder/ tree $T), $(date -u +%FT%TZ). Dependency files and the image list changed since 14787d8 (git diff --stat 14787d8 over package.json, package-lock.json, runner/package*.json, approved-images.json, licences.csv, licence-rule.json): '$(git diff --stat 14787d8 -- package.json package-lock.json runner/package.json runner/package-lock.json approved-images.json licences.csv licence-rule.json)' (empty: none)."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
sed -i "s#$S#<scratchpad>#g" $D/run-tests-full.txt $D/run-typecheck.txt $D/run-licences.txt $D/controls.txt
echo all-done
