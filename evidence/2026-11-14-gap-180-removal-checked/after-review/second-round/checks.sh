#!/bin/bash
# Known gap 180's fix, second review round: the checks, each kept in a file next to this script.
#   checks.sh quick     the type check, the licence check, the gap's tests by name, the two whole test files (no container is started)
#   checks.sh again F   one whole test file once more (F: web or journey), kept beside the first run, which is never replaced
#   checks.sh controls  every control whose tests start no container (80 of the 87), with the controls script's own machinery
#   checks.sh docker    under the machine's shared lock: test/removal-live.test.ts, then the seven controls that need real Docker
# Run them one after the other, never at once: the controls change source files while they run, and restore them.
# The whole suite is NOT run here. Paths: S is the session's scratch folder, W the working copy.
S=${S:-/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad}
W=${W:-$S/wt180}
D=$W/evidence/2026-11-14-gap-180-removal-checked/after-review/second-round
LOCK=$S/live-tests.lock
CONTROLS=../evidence/2026-11-13-journey-j2/controls-scripts/controls.py
DOCKER_CONTROLS="J2-C54 J2-C59 J2-C61 J2-C62 J2-C63 J2-C78 J2-C82"
cd $W/builder || exit 1
export TMPDIR=$S/t2 BUILDER_BROWSER_CACHE=$S/bcache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_g180fix?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
[ -z "$(git -C $W status --porcelain -- builder evidence/2026-11-13-journey-j2)" ] || { echo "builder/ or the controls script is not as committed"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
ON="on commit $H (builder/ tree $T), working tree as committed, $(date -u +%FT%TZ)"
clean() { sed -i "s#$S#<scratchpad>#g" "$@"; }
leftovers() { echo "containers named removal-test-*: $(docker ps -a --format "{{.Names}}" | grep -c "^removal-test-"); networks named removal-test-* or builder_j1-*: $(docker network ls --format "{{.Name}}" | grep -c "removal-test-\|builder_j1-"); volumes named removal-test-*: $(docker volume ls -q | grep -c "^removal-test-")"; }
export -f leftovers
case "$1" in
quick)
  { echo "Known gap 180, second review round: npm run typecheck, $ON."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "Known gap 180, second review round: npm run check:licences, $ON. No dependency file is changed."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
  { echo "Known gap 180, second review round: the gap's tests by name filter, $ON. No container is started by these tests (stand-in sandboxes, or a made-up docker program). Database builder_test_g180fix. TMPDIR <scratchpad>/t2."
    echo
    echo "== test/web.test.ts -t \"C1[4-9] \\(known gap 180\": C14, C15, C17, C18, C19"
    npx vitest run test/web.test.ts -t "C1[4-9] \(known gap 180" --reporter=verbose; echo "vitest exit code: $?"
    echo
    echo "== test/journey.test.ts -t \"C(16|2[0-5]) \\(known gap 180\": C16, C20 to C25"
    npx vitest run test/journey.test.ts -t "C(16|2[0-5]) \(known gap 180" --reporter=verbose; echo "vitest exit code: $?"
  } > $D/run-named-tests.txt 2>&1
  { echo "Known gap 180, second review round: the whole of test/web.test.ts, first run, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/web.test.ts; echo "vitest exit code: $?"; } > $D/run-web-whole-run-1.txt 2>&1
  { echo "Known gap 180, second review round: the whole of test/journey.test.ts, first run, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/journey.test.ts; echo "vitest exit code: $?"; } > $D/run-journey-whole-run-1.txt 2>&1
  clean $D/run-typecheck.txt $D/run-licences.txt $D/run-named-tests.txt $D/run-web-whole-run-1.txt $D/run-journey-whole-run-1.txt
  ;;
again)
  # One whole test file once more. The earlier runs are kept: the new file takes the next free number.
  n=2; while [ -e $D/run-$2-whole-run-$n.txt ]; do n=$((n+1)); done
  { echo "Known gap 180, second review round: the whole of test/$2.test.ts, run $n, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/$2.test.ts; echo "vitest exit code: $?"; } > $D/run-$2-whole-run-$n.txt 2>&1
  clean $D/run-$2-whole-run-$n.txt
  ;;
controls)
  IDS=$(python3 - <<PY
import re
src = open("$CONTROLS").read()
print(" ".join(i for i in re.findall(r'^ \("(J2-C\d+)"', src, re.M) if i not in "$DOCKER_CONTROLS".split()))
PY
)
  python3 $CONTROLS $D/controls-output-no-container.txt $IDS > $D/controls-stdout-no-container.txt 2>&1
  echo "controls script exit code: $?" >> $D/controls-stdout-no-container.txt
  clean $D/controls-output-no-container.txt $D/controls-stdout-no-container.txt
  ;;
docker)
  { echo "Known gap 180, second review round: test/removal-live.test.ts on real Docker, all of it, $ON. Command: flock <scratchpad>/live-tests.lock npx vitest run test/removal-live.test.ts --reporter=verbose. Database builder_test_g180fix (not used by this file). TMPDIR <scratchpad>/t2."
    echo "Waiting for the lock from $(date -u +%H:%M:%S) UTC."
    flock $LOCK bash -c '
      echo "Lock held from $(date -u +%H:%M:%S) UTC."
      echo "Before: $(leftovers)"
      npx vitest run test/removal-live.test.ts --reporter=verbose; echo "vitest exit code: $?"
      echo "After: $(leftovers)"
      python3 '$CONTROLS' '$D'/controls-output-real-docker.txt '"$DOCKER_CONTROLS"' > '$D'/controls-stdout-real-docker.txt 2>&1
      echo "controls script exit code: $?" >> '$D'/controls-stdout-real-docker.txt
      echo "After the seven controls: $(leftovers)"
      echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  } > $D/run-removal-live.txt 2>&1
  clean $D/run-removal-live.txt $D/controls-output-real-docker.txt $D/controls-stdout-real-docker.txt
  ;;
*) echo "usage: checks.sh quick|again web|again journey|controls|docker"; exit 2;;
esac
echo "done: $1 $2"
