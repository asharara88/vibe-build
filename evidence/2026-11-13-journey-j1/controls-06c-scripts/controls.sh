#!/bin/bash
# J1's controls again, on a copy of the code at f5618c9 (j1-06c/ctl-copy), with a database of their own. No container.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
OUT=$S/j1-06c/controls-out.txt
cd $S/j1-06c/ctl-copy/builder || exit 1
export TMPDIR=$S/j1-06c-tmp
mkdir -p $TMPDIR
dropdb -h /var/run/postgresql --if-exists builder_test_j106cctl && createdb -h /var/run/postgresql builder_test_j106cctl
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_j106cctl?host=/var/run/postgresql'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
{
echo "J1 on 0.6c's private networks, 13 Nov 2026: every safeguard removed in turn (exact replacements) on a copy of the code at f5618c9 (git archive of the commit, the evidence left out; node_modules linked), the test that guards it run, the file restored; then the copy compared with a fresh one. Database builder_test_j106cctl (fresh); no container. Scripts: the session's scratchpad, j1-06c/controls1.py to controls5.py (controls1 to 4 are J1's earlier ones, unchanged but for the copy's path, the database and the temporary folder). 85 controls: the 16 new ones (J1-C70 to J1-C85) and the 69 earlier ones."
echo
echo "Baseline, before any control: J1's three test files on the copy, unchanged ($(date -u +%H:%M:%S) UTC)."
npx vitest run test/journey.test.ts test/web.test.ts test/intake.test.ts 2>&1 | grep -E 'Test Files|Tests |×'
echo
echo "New, on 0.6c's networks and the checklist screen (controls5.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/j1-06c/controls5.py
echo
echo "After the merge with 1.4b, 1.4c and 3.1b (controls4.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/j1-06c/controls4.py
echo
echo "Part 1's 25 (controls1.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/j1-06c/controls1.py
echo
echo "Part 2's 23 (controls2.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/j1-06c/controls2.py
echo
echo "After the review's 8 (controls3.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/j1-06c/controls3.py
echo
rm -rf $S/j1-06c/pristine && mkdir -p $S/j1-06c/pristine && git -C $S/wt-j1 archive f5618c9 builder | tar -x -C $S/j1-06c/pristine && echo "After every control, the copy's builder/ compared with a fresh copy of f5618c9 (diff -rq, node_modules left out): $(diff -rq --exclude=node_modules $S/j1-06c/pristine/builder $S/j1-06c/ctl-copy/builder && echo no difference)"
echo "Finished $(date -u +%H:%M:%S) UTC."
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
dropdb -h /var/run/postgresql --if-exists builder_test_j106cctl
echo done > $S/j1-06c/controls.done
