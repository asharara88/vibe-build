#!/bin/bash
# Known gap 180's fix, after its review: the checks, each kept in a file next to this script.
#   checks.sh quick     the type check, the licence check, the named tests, the two whole test files (no container is started)
#   checks.sh web-again the whole of test/web.test.ts once more (its first whole run failed in one test's own clean-up; kept)
#   checks.sh controls  every control whose tests start no container (73 of the 79), with the controls script's own machinery
#   checks.sh docker    under the machine's shared lock: test/removal-live.test.ts, then the six controls that need real Docker
# Run the three one after the other, never at once: the controls change source files while they run, and restore them.
# The whole suite is NOT run here. Paths: S is the session's scratch folder, W the working copy.
S=${S:-/tmp/claude-0/-home-user-vibe-build/121da6b0-2980-566b-82d7-1563934e4c7d/scratchpad}
W=${W:-$S/wt180}
D=$W/evidence/2026-11-14-gap-180-removal-checked/after-review
LOCK=$S/live-tests.lock
CONTROLS=../evidence/2026-11-13-journey-j2/controls-scripts/controls.py
DOCKER_CONTROLS="J2-C54 J2-C59 J2-C61 J2-C62 J2-C63 J2-C78"
cd $W/builder || exit 1
export TMPDIR=$S/t2 BUILDER_BROWSER_CACHE=$S/bcache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_g180fix?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
[ -z "$(git -C $W status --porcelain -- builder evidence/2026-11-13-journey-j2)" ] || { echo "builder/ or the controls script is not as committed"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
ON="on commit $H (builder/ tree $T), working tree as committed, $(date -u +%FT%TZ)"
clean() { sed -i "s#$S#<scratchpad>#g" "$@"; }
case "$1" in
quick)
  { echo "Known gap 180, after its review: npm run typecheck, $ON."; npm run typecheck; echo "exit code: $?"; } > $D/run-typecheck.txt 2>&1
  { echo "Known gap 180, after its review: npm run check:licences, $ON. No dependency file is changed."; npm run check:licences; echo "exit code: $?"; } > $D/run-licences.txt 2>&1
  { echo "Known gap 180, after its review: the tests of the stop, the close and the removal, by name filter, $ON. No container is started by these tests (stand-in sandboxes, or a made-up docker program); C5 starts the real interface process with no project. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."
    echo
    echo "== test/web.test.ts -t \"J2 \\(c\\) interface|C17 \\(known gap 180, after its review\\)\": C1 to C4, C4b, C5 to C7, C9, C11 to C15, C18, C19, and C17"
    npx vitest run test/web.test.ts -t "J2 \(c\) interface|C17 \(known gap 180, after its review\)" --reporter=verbose; echo "vitest exit code: $?"
    echo
    echo "== test/journey.test.ts -t \"J2 \\(c\\): the clean stop and restart\": C6, C8, C10, C16, C20, C21, C22 and the record checks of the broken copy"
    npx vitest run test/journey.test.ts -t "J2 \(c\): the clean stop and restart" --reporter=verbose; echo "vitest exit code: $?"
  } > $D/run-named-tests.txt 2>&1
  { echo "Known gap 180, after its review: the whole of test/web.test.ts, once, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/web.test.ts; echo "vitest exit code: $?"; } > $D/run-web-whole.txt 2>&1  # kept since as run-web-whole-first-run-1-failed.txt
  { echo "Known gap 180, after its review: the whole of test/journey.test.ts, once, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/journey.test.ts; echo "vitest exit code: $?"; } > $D/run-journey-whole.txt 2>&1
  clean $D/run-typecheck.txt $D/run-licences.txt $D/run-named-tests.txt $D/run-web-whole.txt $D/run-journey-whole.txt
  ;;
web-again)
  # The whole of test/web.test.ts once more (the first whole run is kept as run-web-whole-first-run-1-failed.txt).
  { echo "Known gap 180, after its review: the whole of test/web.test.ts, second run, $ON. Database builder_test_g180fix. TMPDIR <scratchpad>/t2."; npx vitest run test/web.test.ts; echo "vitest exit code: $?"; } > $D/run-web-whole-second-run.txt 2>&1
  clean $D/run-web-whole-second-run.txt
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
  { echo "Known gap 180, after its review: test/removal-live.test.ts on real Docker, all of it, $ON. Command: flock <scratchpad>/live-tests.lock npx vitest run test/removal-live.test.ts --reporter=verbose. Database builder_test_g180fix (not used by this file). TMPDIR <scratchpad>/t2."
    echo "Waiting for the lock from $(date -u +%H:%M:%S) UTC."
    flock $LOCK bash -c '
      echo "Lock held from $(date -u +%H:%M:%S) UTC."
      echo "Before: containers named removal-test-*: $(docker ps -a --format "{{.Names}}" | grep -c "^removal-test-"); networks named removal-test-* or builder_j1-*: $(docker network ls --format "{{.Name}}" | grep -c "removal-test-\|builder_j1-"); volumes named removal-test-*: $(docker volume ls -q | grep -c "^removal-test-")"
      npx vitest run test/removal-live.test.ts --reporter=verbose; echo "vitest exit code: $?"
      echo "After: containers named removal-test-*: $(docker ps -a --format "{{.Names}}" | grep -c "^removal-test-"); networks named removal-test-* or builder_j1-*: $(docker network ls --format "{{.Name}}" | grep -c "removal-test-\|builder_j1-"); volumes named removal-test-*: $(docker volume ls -q | grep -c "^removal-test-")"
      python3 '$CONTROLS' '$D'/controls-output-real-docker.txt '"$DOCKER_CONTROLS"' > '$D'/controls-stdout-real-docker.txt 2>&1
      echo "controls script exit code: $?" >> '$D'/controls-stdout-real-docker.txt
      echo "After the six controls: containers named removal-test-*: $(docker ps -a --format "{{.Names}}" | grep -c "^removal-test-"); networks named removal-test-* or builder_j1-*: $(docker network ls --format "{{.Name}}" | grep -c "removal-test-\|builder_j1-"); volumes named removal-test-*: $(docker volume ls -q | grep -c "^removal-test-")"
      echo "Lock released at $(date -u +%H:%M:%S) UTC."'
  } > $D/run-removal-live.txt 2>&1
  clean $D/run-removal-live.txt $D/controls-output-real-docker.txt $D/controls-stdout-real-docker.txt
  ;;
*) echo "usage: checks.sh quick|web-again|controls|docker"; exit 2;;
esac
echo "done: $1"
