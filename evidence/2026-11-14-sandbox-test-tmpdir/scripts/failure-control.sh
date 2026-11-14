#!/bin/bash
# The failure control: one test of builder/test/sandbox.test.ts ("writes YAML that Docker Compose accepts") is made to
# fail on purpose, after it has made its folder and written the sandbox into it; it is run alone, with a new, empty
# TMPDIR, and what is left there is listed. Done twice: on the fixed file (the folder should be gone) and on the file
# as it was before the fix (the folder should be left). The test file is put back as committed afterwards.
# vitest is started without npm, so that npm's own cache does not appear in TMPDIR (compile-cache-probe.txt).
# It starts no container (the test runs `docker compose config` only), so it is not run under the lock.
# Usage: SCRATCH=<scratchpad> bash failure-control.sh <fixed commit> <commit before the fix> <output file>
set -u
S=${SCRATCH:?set SCRATCH to the session scratchpad}
FIXED=$1
BEFORE=$2
OUT=$(realpath -m "$3")
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
cd "$REPO/builder" || exit 1
F=test/sandbox.test.ts
if [ -n "$(git status --porcelain -- $F)" ]; then echo "$F has uncommitted changes; stopping." >&2; exit 1; fi
LINE='    expect(existsSync(sb.composeFile)).toBe(true);'
export NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
{
for which in after before; do
  [ $which = after ] && C=$FIXED || C=$BEFORE
  T=$S/c${which:0:1}
  rm -rf "$T" && mkdir -p "$T"
  git show "$C:builder/$F" > $F
  cp $F "$S/control-original.ts"
  n=$(grep -c -F -x -- "$LINE" $F)
  # The failure added on purpose, right after the line above, in that one test.
  python3 - "$F" "$LINE" <<'EOF'
import sys
f, line = sys.argv[1], sys.argv[2]
s = open(f).read()
assert s.count(line + "\n") == 1, "the line must occur once"
s = s.replace(line + "\n", line + "\n" + '    expect("this control fails on purpose").toBe("a pass");\n')
open(f, "w").write(s)
EOF
  echo "== The test file of $C ($which the fix), with one failure added on purpose (the line it follows occurs $n time(s) in the file):"
  diff -U1 "$S/control-original.ts" $F | sed -n '3,$p'
  echo "TMPDIR=<scratchpad>/c${which:0:1}, made new and empty; entries before: $(find "$T" -mindepth 1 | wc -l)."
  echo "\$ node node_modules/vitest/vitest.mjs run $F -t 'writes YAML that Docker Compose accepts'"
  TMPDIR=$T node node_modules/vitest/vitest.mjs run $F -t 'writes YAML that Docker Compose accepts' 2>&1 | grep -E 'Test Files|Tests |AssertionError|Expected|Received| FAIL '
  echo "vitest exit code: ${PIPESTATUS[0]}"
  echo "Left in TMPDIR (entries directly in it: $(find "$T" -mindepth 1 -maxdepth 1 | wc -l)):"
  if [ -n "$(ls -A "$T")" ]; then (cd "$T" && du -sh -- * .[!.]* 2>/dev/null); else echo "(nothing: TMPDIR is empty)"; fi
  echo
done
git checkout -- $F
echo "The test file put back as committed: git status of it is '$(git status --porcelain -- $F)' (empty: unchanged), blob $(git hash-object $F)."
} > "$OUT" 2>&1
sed -i "s#$S#<scratchpad>#g" "$OUT"
