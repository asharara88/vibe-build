#!/bin/bash
# J1's controls after the independent check of b228d94, on a copy of the code at 9c2da4d (fixj1-ctl/ctl-copy),
# with the database builder_test_fixj1. No container (`docker compose config` reads a file only).
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
OUT=$S/fixj1-ctl/controls-out.txt
cd $S/fixj1-ctl/ctl-copy/builder || exit 1
export TMPDIR=$S/fixj1-tmp
mkdir -p $TMPDIR
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_fixj1?host=/var/run/postgresql'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
{
echo "J1 after the independent check of b228d94, 13 Nov 2026: each new safeguard removed in turn (exact replacements) on a copy of the code at 9c2da4d (git archive of the commit, the evidence left out; node_modules linked), the tests that guard it run, the file restored; then the copy compared with a fresh one. Database builder_test_fixj1; no container. Scripts: controls-checkfix-scripts/. Points 3 and 4 of the check: J1-C86 to J1-C91."
echo "Before any control: /runner on this machine: $(ls -d /runner 2>&1)"
echo
echo "Baseline, before any control: the three tests on the copy, unchanged ($(date -u +%H:%M:%S) UTC)."
npx vitest run test/journey.test.ts -t "the camera's network check: only a service on the project's front network|a journey sandbox puts the app on the project's private networks|the app camera loads its browser only for" 2>&1 | grep -E 'Test Files|Tests |×|✓'
echo
echo "The controls (controls-checkfix.py), $(date -u +%H:%M:%S) UTC:"
python3 -I $S/fixj1-ctl/controls-checkfix.py
echo
echo "J1-C89 also by the typecheck (the option's name typed against 0.6c's PROJECT_NETWORK), $(date -u +%H:%M:%S) UTC:"
F=src/orchestrator/example-1-adapter.ts
cp $F $TMPDIR/adapter.saved
python3 -I - "$F" <<'PY'
import sys
p = sys.argv[1]; s = open(p).read()
old = 'const GATEWAY_MODE_OPTION = "com.docker.network.bridge.gateway_mode_ipv4" satisfies'
assert s.count(old) == 1
open(p, "w").write(s.replace(old, 'const GATEWAY_MODE_OPTION = "com.docker.network.bridge.gateway_mode_ipv6" satisfies'))
PY
npx tsc --noEmit 2>&1 | grep -E 'error TS' | head -3; echo "tsc exit code: ${PIPESTATUS[0]}"
cp $TMPDIR/adapter.saved $F && rm $TMPDIR/adapter.saved
echo
echo "After the controls: /runner on this machine: $(ls -d /runner 2>&1)"
rm -rf $S/fixj1-ctl/pristine && mkdir -p $S/fixj1-ctl/pristine && git -C $S/wt-j1 archive 9c2da4d -- . ':!evidence' | tar -x -C $S/fixj1-ctl/pristine && echo "After every control, the copy compared with a fresh copy of 9c2da4d (diff -rq, node_modules left out): $(diff -rq --exclude=node_modules $S/fixj1-ctl/pristine $S/fixj1-ctl/ctl-copy && echo no difference)"
echo "Finished $(date -u +%H:%M:%S) UTC."
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done > $S/fixj1-ctl/controls.done
