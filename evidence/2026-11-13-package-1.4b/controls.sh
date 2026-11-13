#!/usr/bin/env bash
# Package 1.4b controls: each removes one safeguard in a scratch copy of the commit (git archive), runs the named
# test of test/journal-recovery.test.ts there, expects it to FAIL, then puts the file back from the commit.
# Kept as evidence. Run from the repository's root as:
#   SCRATCHPAD=<scratch folder> bash evidence/2026-11-13-package-1.4b/controls.sh <commit>
# ONLY=<id> (for example ONLY=X3) runs that one control alone. The working tree is never changed.
set -uo pipefail
COMMIT="$1"
REPO=$(pwd)
CTL=${SCRATCHPAD}/p14b-ctl
export TMPDIR=${SCRATCHPAD}/p14b-tmp
export BUILDER_TEST_DATABASE_URL="postgres:///builder_test_p14b?host=/var/run/postgresql"
rm -rf "$CTL" && mkdir -p "$CTL" "$TMPDIR"
git -C "$REPO" archive "$COMMIT" builder | tar -x -C "$CTL"
ln -s "$REPO/builder/node_modules" "$CTL/builder/node_modules"
cd "$CTL/builder"
echo "Scratch copy: git archive $(git -C "$REPO" rev-parse --short "$COMMIT") builder, with the checkout's node_modules linked in"
J=src/gateway/journal.ts
R=src/gateway/journal-recovery.ts
T=test/journal-recovery.test.ts
pass=0; fail=0
control() { # id, test pattern, file, perl substitution, what is removed
  local id="$1" pat="$2" file="$3" sub="$4" what="$5"
  if [ -n "${ONLY:-}" ] && [ "$ONLY" != "$id" ]; then return; fi
  echo "=== $id: $what"
  echo "    file: $file; test: $pat"
  local before; before=$(sha1sum "$file")
  perl -0pi -e "$sub" "$file"
  if [ "$(sha1sum "$file")" = "$before" ]; then echo "    NOT APPLIED: the substitution changed nothing"; fail=$((fail+1)); return; fi
  diff -U0 <(git -C "$REPO" show "$COMMIT:builder/$file") "$file" | grep '^[-+][^-+]' | sed 's/^/    /'
  local out; out=$(timeout 600 npx vitest run "$T" -t "$pat" 2>&1)
  local code=$?
  git -C "$REPO" show "$COMMIT:builder/$file" > "$file"
  echo "$out" | grep -E "^ +(×|✓)|AssertionError|Error:|expected|Tests +[0-9]" | head -6 | sed 's/^/    | /'
  if [ $code -ne 0 ] && [[ "$out" =~ Tests\ +[0-9]+\ failed ]]; then echo "    RESULT: the test FAILED, as it should (exit $code)"; pass=$((pass+1)); else echo "    RESULT: the test did NOT fail (exit $code)"; fail=$((fail+1)); fi
}
control X1 '\(a\) the review' $J 's/    if \(unreadable\.length > 0\) this\.unreadable = unreadable; \/\/ before anything else is awaited\n//' "the start-up block: unreadable lines found by the replay keep the gate closed"
control X2 '\(c\) markDone' $J 's/await this\.rewrite\(lines\.filter\(\(l\) => !isIt\(l\)\)\);/await this.rewrite(lines.filter((l) => !isIt(l) \&\& readLine(l).kind === "record"));/' "markDone keeping the lines it does not move (here: keeping only readable records)"
control X3 '\(e\) the script' $R 's/    if \(!got\) \{\n      throw new RecoveryRefused\(\n        "folder_in_use",/    if (false) {\n      throw new RecoveryRefused(\n        "folder_in_use",/' "the set-aside's refusal while a gateway holds the folder's lock"
control X4 '\(a2\) the same refusal' src/gateway/app.ts 's/gate\.unreadableLines\(\)\.length > 0 \? "journal" : gate\.closed\(\)/false ? "journal" : gate.closed()/' "the journal's own refusal at the re-checks before each forward (the gate's closed state alone would answer gateway_unrecorded)"
control X5 '\(f\) a journal file' $J 's/if \(\(err as \{ code\?: string \}\)\.code === "ENOENT"\) return \{ lines: \[\]/if (true) return { lines: []/' "start-up stopping on a journal file that cannot be read (here: read as empty)"
control X6 '\(b2\) each kind' $J 's/  const text = \(x: unknown\) =>/  if (typeof v["journal_id"] === "string" \&\& typeof v["project_id"] === "string") return true;\n  const text = (x: unknown) =>/' "the record's shape check (here: back to package 1.4's, journal_id and project_id only)"
control X7 '\(b2\) each kind' $J 's/  if \(!l\.ended\) return \{ kind: "unreadable", why: "torn: the file ends inside it, with no line end" \};\n//' "a last line with no line end never taken as read"
control X8 '\(c\) markDone' $J 's/\(await endsInsideALine\(this\.file\)\) \? "\\n" \+ line : line/line/' "an append after a last line with no line end starting on a line of its own"
control X9 '\(e\) the script' $R 's/if \(before\.length > 0 && unreadableWith\(lines, fingerprint\)\.length === 0\) \{/if (false \&\& before.length > 0) {/' "a second set-aside of the same line recognised by its fingerprint"
control X10 '\(e\) the script' $R 's/      if \(h\.state !== "open"\) \{/      if (false) {/' "the refusal of a hold that is not open"
control X11 '\(e2\) a set-aside cut short' $R 's/where journal_folder_id = \$1 and moved_at is null order by id/where journal_folder_id = \$1 and moved_at is null and false order by id/' "finishing a set-aside cut short, instead of recording it again"
control X12 '\(f\) a journal file' src/store/liveness.ts 's/    if \(o\.journalFolderId !== undefined\) \{/    if (false) {/' "the gateway's lock on its journal folder (a second gateway on the same folder)"
control X13 '\(g\) the folder' $J 's/    if \(!this\.mayWrite\(\)\) throw/    if (false) throw/' "the journal writing nothing while the gateway does not hold its folder's lock"
control X14 '\(b\) a line that is not JSON' $J 's/for \(const rec of records\) if \(!this\.waiting/for (const rec of unreadable.length > 0 ? [] : records) if (!this.waiting/' "readable lines replayed beside an unreadable one"
echo "=== controls that failed as they should: $pass; that did not: $fail"
cd / && rm -rf "$CTL"
