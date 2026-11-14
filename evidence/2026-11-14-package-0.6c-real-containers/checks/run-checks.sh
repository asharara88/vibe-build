#!/bin/bash
# Package 0.6c, the run in real containers (14 Nov 2026): the checks, each kept as a file in this folder.
#
# Usage: WT=<worktree> COMMIT=<commit> SCRATCH=<scratchpad folder> DB=<test database name> run-checks.sh <step>...
# with TMPDIR, BUILDER_BROWSER_CACHE and NO_COLOR set as for every run of this change.
#
# Every step runs on a copy of COMMIT made by make-run-copy.sh (git archive, node_modules as real folders; why a
# copy: measurements/M0-why-a-copy.txt). Steps that start, build or remove containers or images hold the lock
# shared with other sessions (SCRATCH/live-tests.lock). The whole suite (`npm test` with no file) is NOT a step
# here: it is run once, later, by someone else.
#
# Steps: copy typecheck unit gate licences live isolation-full demo controls-kept controls-real
set -uo pipefail
: "${WT:?}" "${COMMIT:?}" "${SCRATCH:?}" "${DB:?}" "${TMPDIR:?}" "${BUILDER_BROWSER_CACHE:?}"
HERE=$(cd "$(dirname "$0")" && pwd)
E=$(dirname "$HERE")
COPY=$SCRATCH/run06c
LOCK=$SCRATCH/live-tests.lock
SHORT=$(git -C "$WT" rev-parse --short "$COMMIT")
export NO_COLOR=1 FORCE_COLOR=0 BUILDER_TEST_DATABASE_URL="postgres:///$DB?host=/var/run/postgresql"
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
VITEST="node node_modules/vitest/vitest.mjs run"
tidy() { sed -i "s#$SCRATCH#<scratchpad>#g" "$@"; }
head_of() { echo "$1"; echo "On a copy of commit $SHORT (git archive; node_modules as real folders), started $(date -u +%FT%TZ)."; echo "Command, from builder/: $2"; echo; }
locked() { flock "$LOCK" bash -c "echo \"Lock held from \$(date -u +%H:%M:%S) UTC.\"; $1; echo \"exit code: \$?\"; echo \"Lock released at \$(date -u +%H:%M:%S) UTC.\""; }
objects() { echo "$1: $(docker ps -aq | wc -l) containers; images: $(docker images --format '{{.Repository}}:{{.Tag}}' | sort | tr '\n' ' ')"; }

for step in "$@"; do
  cd "$COPY/builder" 2>/dev/null || true
  case "$step" in
    copy)
      "$HERE/make-run-copy.sh" "$WT" "$COMMIT" "$COPY" ;;
    typecheck)
      { head_of "The type check." "npm run typecheck; then scripts/demo-isolation.ts and the two measurement scripts, which the project's own settings do not cover, checked with the same options"
        npm run typecheck; echo "exit code: $?"
        echo; echo "scripts/demo-isolation.ts and the measurement scripts, directly:"
        npx tsc --ignoreConfig --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --esModuleInterop --skipLibCheck --types node --typeRoots ./node_modules/@types --allowImportingTsExtensions scripts/demo-isolation.ts ../evidence/2026-11-14-package-0.6c-real-containers/measurements/measure-first.mts ../evidence/2026-11-14-package-0.6c-real-containers/measurements/measure-seen.mts; echo "exit code: $?"
      } > "$HERE/run-typecheck.txt" 2>&1; tidy "$HERE/run-typecheck.txt" ;;
    unit)
      { head_of "The isolation unit tests (no container): every test of test/isolation.test.ts whose group is marked (unit), the seven new ones among them." "$VITEST test/isolation.test.ts -t unit --reporter=verbose"
        $VITEST test/isolation.test.ts -t unit --reporter=verbose; echo "exit code: $?"
      } > "$HERE/run-unit-tests.txt" 2>&1; tidy "$HERE/run-unit-tests.txt" ;;
    gate)
      { head_of "The gate's tests (package 3.1b), with the two new ones for the live isolation file. No container: Docker is pointed at an address where nothing listens." "$VITEST test/acceptance-gate.test.ts --reporter=verbose"
        $VITEST test/acceptance-gate.test.ts --reporter=verbose; echo "exit code: $?"
      } > "$HERE/run-acceptance-gate.txt" 2>&1; tidy "$HERE/run-acceptance-gate.txt" ;;
    licences)
      { head_of "The licence check. No dependency is added by this change." "npm run check:licences"
        npm run check:licences; echo "exit code: $?"
      } > "$HERE/run-licences.txt" 2>&1; tidy "$HERE/run-licences.txt" ;;
    live)
      { head_of "The new live file: the probe inside the real containers (L1 to L10). Under the shared lock." "flock <scratchpad>/live-tests.lock $VITEST test/isolation-real-live.test.ts --reporter=verbose"
        echo "Free disk before: $(df -h / | tail -1)"; objects "Before"
        locked "$VITEST test/isolation-real-live.test.ts --reporter=verbose"
        objects "After"; echo "Free disk after: $(df -h / | tail -1)"
      } > "$HERE/run-isolation-real-live.txt" 2>&1; tidy "$HERE/run-isolation-real-live.txt" ;;
    isolation-full)
      { head_of "test/isolation.test.ts in full: its unit tests and its existing live tests (0.6a's engine container; 0.6c's stand-in project of 13 Nov), which must pass unchanged. Under the shared lock." "flock <scratchpad>/live-tests.lock $VITEST test/isolation.test.ts --reporter=verbose"
        objects "Before"
        locked "$VITEST test/isolation.test.ts --reporter=verbose"
        objects "After"
      } > "$HERE/run-isolation-test-full.txt" 2>&1; tidy "$HERE/run-isolation-test-full.txt" ;;
    demo)
      mkdir -p "$E/demo"
      { head_of "The demonstration: part A in real containers, part B in stand-in images. Under the shared lock." "flock <scratchpad>/live-tests.lock npx tsx scripts/demo-isolation.ts <this evidence folder>/demo"
        locked "npx tsx scripts/demo-isolation.ts '$E/demo'"
      } > "$E/demo/demo-isolation.txt" 2>&1; tidy "$E/demo/"* ;;
    controls-kept)
      # The kept script, unchanged, run from the worktree (it finds its repository from its own place): it makes its own
      # copy of COMMIT with git archive. Its tests start no door, so the worktree's link to node_modules is enough.
      rm -rf "$SCRATCH/c06c-kept"; rm -f "$HERE/controls-kept-C1-C41.txt"
      { echo "The kept 0.6c controls (C1 to C41, C12b, and package 3.1b's five), through the existing script, unchanged:"
        echo "flock <scratchpad>/live-tests.lock python3 evidence/2026-11-13-package-0.6c/checks/controls-merge.py $SHORT <scratchpad>/c06c-kept <this folder>/controls-kept-C1-C41.txt $DB"
        echo "Started $(date -u +%FT%TZ)."
        (cd "$WT" && locked "python3 evidence/2026-11-13-package-0.6c/checks/controls-merge.py $COMMIT '$SCRATCH/c06c-kept' '$HERE/controls-kept-C1-C41.txt' $DB")
      } > "$HERE/controls-kept-C1-C41-console.txt" 2>&1
      tidy "$HERE/controls-kept-C1-C41.txt" "$HERE/controls-kept-C1-C41-console.txt"; rm -rf "$SCRATCH/c06c-kept" ;;
    controls-real)
      rm -rf "$SCRATCH/c06c-real"; rm -f "$HERE/controls-real-RC1-RC10.txt"
      { echo "The new controls RC1 to RC10: flock <scratchpad>/live-tests.lock python3 <this folder>/controls-real.py <worktree> $SHORT <scratchpad>/c06c-real <this folder>/controls-real-RC1-RC10.txt $DB"
        echo "Started $(date -u +%FT%TZ)."; objects "Before"
        locked "python3 '$HERE/controls-real.py' '$WT' $COMMIT '$SCRATCH/c06c-real' '$HERE/controls-real-RC1-RC10.txt' $DB"
        objects "After"
      } > "$HERE/controls-real-RC1-RC10-console.txt" 2>&1
      tidy "$HERE/controls-real-RC1-RC10.txt" "$HERE/controls-real-RC1-RC10-console.txt"; rm -rf "$SCRATCH/c06c-real" ;;
    *) echo "unknown step: $step" >&2; exit 2 ;;
  esac
  echo "step $step done at $(date -u +%H:%M:%S) UTC"
done
