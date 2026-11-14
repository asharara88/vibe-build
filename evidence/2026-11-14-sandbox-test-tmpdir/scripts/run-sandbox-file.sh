#!/bin/bash
# Runs builder/test/sandbox.test.ts once with a fresh, empty TMPDIR of its own, under the shared live-tests lock,
# then lists what is left in that TMPDIR, with the size of each entry (du -sh), its owner and its mode.
# Usage: SCRATCH=<scratchpad> bash run-sandbox-file.sh <label> <output file>
# VITEST_CMD (optional) replaces the default 'npx vitest run', for example with 'node node_modules/vitest/vitest.mjs run',
# which starts vitest without npm (npm itself leaves node-compile-cache in TMPDIR: compile-cache-probe.txt).
# The scratchpad's path is written as <scratchpad> in the output.
set -u
S=${SCRATCH:?set SCRATCH to the session scratchpad}
LABEL=$1
OUT=$(realpath -m "$2")
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
T=$S/t${LABEL:0:1}
# Kept short (after the first attempt on 14 Nov 2026): tsx makes a socket at $TMPDIR/tsx-<uid>/<pid>.pipe, and Node
# keeps at most 108 bytes of a socket's path, cutting a longer one short without an error (socket-path-probe.js); with
# a TMPDIR of 102 bytes every such path was cut to the same 108 bytes and the suite's tsx scripts failed (EADDRINUSE).
# The guard leaves room for an 8-digit process number and keeps the whole path within 107 bytes.
if [ $(( ${#T} + ${#UID} + 19 )) -gt 107 ]; then echo "TMPDIR $T is too long for tsx's socket path; use a shorter one." >&2; exit 1; fi
rm -rf "$T" && mkdir -p "$T"
cd "$REPO/builder" || exit 1
export TMPDIR=$T BUILDER_BROWSER_CACHE=$S/browser-cache NO_COLOR=1 FORCE_COLOR=0
export VITEST_CMD=${VITEST_CMD:-npx vitest run}
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
{
echo "Run '$LABEL': $VITEST_CMD test/sandbox.test.ts --reporter=verbose, in builder/, on commit $(git rev-parse --short HEAD), test file blob $(git hash-object test/sandbox.test.ts), working tree: $(git status --porcelain | wc -l) changed files."
echo "TMPDIR=<scratchpad>/t${LABEL:0:1}, made new and empty; entries in it before the run: $(find "$T" -mindepth 1 | wc -l)."
echo "Free disk before (df -h /): $(df -h / | awk 'NR==2{print $4" free of "$2}')"
echo "Containers on this machine before (docker ps -aq, count): $(docker ps -aq | wc -l)"
echo "Waiting for the shared lock (flock <scratchpad>/live-tests.lock) from $(date -u +%H:%M:%S) UTC."
flock "$S/live-tests.lock" bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; $VITEST_CMD test/sandbox.test.ts --reporter=verbose; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -aq, count): $(docker ps -aq | wc -l)"
echo "Free disk after (df -h /): $(df -h / | awk 'NR==2{print $4" free of "$2}')"
echo
echo "What is left in TMPDIR after the run (entries directly in it: $(find "$T" -mindepth 1 -maxdepth 1 | wc -l); everything below it: $(find "$T" -mindepth 1 | wc -l)):"
if [ -n "$(ls -A "$T")" ]; then
  echo "du -sh of each entry:"
  (cd "$T" && du -sh -- * .[!.]* 2>/dev/null)
  echo "du -sh of TMPDIR as a whole: $(du -sh "$T" | cut -f1)"
  echo "Each entry's owner (uid:gid), mode and number of files below it:"
  for e in "$T"/* "$T"/.[!.]*; do [ -e "$e" ] || continue; echo "$(basename "$e")  $(stat -c '%u:%g %a' "$e")  files: $(find "$e" -type f | wc -l)"; done
  echo "Everything below TMPDIR (find, with owner and mode):"
  (cd "$T" && find . -mindepth 1 -printf '%u:%g %m %y %p\n' | sort -k4)
else
  echo "(nothing: TMPDIR is empty)"
fi
} > "$OUT" 2>&1
sed -i "s#$S#<scratchpad>#g" "$OUT"
