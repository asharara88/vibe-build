#!/bin/bash
# The whole suite, live tests included, once, with a fresh, empty TMPDIR and a fresh test database of its own, under
# the shared live-tests lock; then what is left in that TMPDIR, with the size of each entry (du -sh).
# Usage: SCRATCH=<scratchpad> bash run-full-suite.sh <label> <output file>
# The scratchpad's path is written as <scratchpad> in the output.
set -u
S=${SCRATCH:?set SCRATCH to the session scratchpad}
LABEL=$1
OUT=$(realpath -m "$2")
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
T=$S/f${LABEL:0:1}
# Kept short (after the first attempt on 14 Nov 2026): tsx makes a socket at $TMPDIR/tsx-<uid>/<pid>.pipe, and Linux
# takes at most 107 bytes for a socket's path; a longer TMPDIR made the suite's tsx scripts fail (EADDRINUSE).
if [ $(( ${#T} + ${#UID} + 19 )) -gt 107 ]; then echo "TMPDIR $T is too long for tsx's socket path; use a shorter one." >&2; exit 1; fi
DB=builder_test_tmpdir_$LABEL
rm -rf "$T" && mkdir -p "$T"
cd "$REPO/builder" || exit 1
export TMPDIR=$T BUILDER_BROWSER_CACHE=$S/browser-cache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL="postgres:///$DB?host=/var/run/postgresql"
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
dropdb -h /var/run/postgresql --if-exists "$DB" && createdb -h /var/run/postgresql "$DB"
{
echo "Run '$LABEL': the whole suite, live tests included (npx vitest run), in builder/, on commit $(git rev-parse --short HEAD), builder/ tree $(git rev-parse --short HEAD:builder), working tree: $(git status --porcelain | wc -l) changed files ($(git status --porcelain | awk '{print $2}' | tr '\n' ' '))."
echo "Test database $DB, made new. TMPDIR=<scratchpad>/f${LABEL:0:1}, made new and empty; entries in it before the run: $(find "$T" -mindepth 1 | wc -l). BUILDER_BROWSER_CACHE=<scratchpad>/browser-cache."
echo "Free disk before (df -h /): $(df -h / | awk 'NR==2{print $4" free of "$2}')"
echo "Containers on this machine before (docker ps -aq, count): $(docker ps -aq | wc -l)"
echo "Waiting for the shared lock (flock <scratchpad>/live-tests.lock) from $(date -u +%H:%M:%S) UTC."
flock "$S/live-tests.lock" bash -c 'echo "Lock held from $(date -u +%H:%M:%S) UTC."; npx vitest run; echo "vitest exit code: $?"; echo "Lock released at $(date -u +%H:%M:%S) UTC."'
echo "Containers on this machine after (docker ps -aq, count): $(docker ps -aq | wc -l)"
echo "Free disk after (df -h /): $(df -h / | awk 'NR==2{print $4" free of "$2}')"
echo
echo "What is left in TMPDIR after the run (entries directly in it: $(find "$T" -mindepth 1 -maxdepth 1 | wc -l); everything below it: $(find "$T" -mindepth 1 | wc -l)):"
if [ -n "$(ls -A "$T")" ]; then
  echo "du -sh of each entry, largest first:"
  (cd "$T" && du -sh -- * .[!.]* 2>/dev/null | sort -rh)
  echo "du -sh of TMPDIR as a whole: $(du -sh "$T" | cut -f1)"
  echo "Entries by name, with the part after the last '-' dropped (count):"
  (cd "$T" && ls -A | sed -E 's/-[^-]*$/-*/' | sort | uniq -c)
else
  echo "(nothing: TMPDIR is empty)"
fi
} > "$OUT" 2>&1
sed -i "s#$S#<scratchpad>#g" "$OUT"
