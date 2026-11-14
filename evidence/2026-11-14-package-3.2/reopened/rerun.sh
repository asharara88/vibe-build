#!/bin/bash
# Package 3.2 reopens tested packages 2.1 and 0.5 (design section 6; build plan section 8, rule 8). Their evidence is
# run again on the 3.2 branch, under the shared lock, with the session's short TMPDIR and the browser cache read only:
#  - 2.1: its demonstration, scripts/demo-scripted.ts (now making the tables with drizzle-kit migrate and a drift check);
#  - 0.5: its "Done means" demonstration, scripts/demo-template.ts --guard (the stand-in seed step's environment check,
#    then the tables, now by migrate), and its tests in test/sandbox.test.ts named "package 0.5" and the live test of a
#    Docker client configuration that adds proxy settings.
# Usage: rerun.sh [2.1|0.5|all]
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
W=$S/wt-32
D=$W/evidence/2026-11-14-package-3.2/reopened
WHAT=${1:-all}
cd $W/builder || exit 1
export TMPDIR=$S/x3 BUILDER_BROWSER_CACHE=$S/p31-cache NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL BUILDER_DEMO_STEP_PAUSE_MS BUILDER_LIVE_PREVIEW
[ -z "$(git -C $W status --porcelain -- builder templates)" ] || { echo "builder/ or templates/ not clean"; exit 1; }
H=$(git -C $W rev-parse --short HEAD); T=$(git -C $W rev-parse --short HEAD:builder)
lists() { echo "containers $(docker ps -aq | wc -l), images $(docker images -q | wc -l), volumes $(docker volume ls -q | wc -l), networks $(docker network ls -q | wc -l)"; }
if [ "$WHAT" = 2.1 ] || [ "$WHAT" = all ]; then
  mkdir -p $D/package-2.1/screens
  { echo "Package 2.1's demonstration, run again for package 3.2 on $H (builder/ tree $T), $(date -u +%FT%TZ). Command, from builder/: flock <scratchpad>/live-tests.lock npx tsx scripts/demo-scripted.ts ../templates/next ../evidence/2026-11-14-package-3.2/reopened/package-2.1/screens"
    echo "Docker before: $(lists)"
    S0=$(date +%s)
    flock $S/live-tests.lock bash -c "echo \"Lock held from \$(date -u +%H:%M:%S) UTC.\"; npx tsx scripts/demo-scripted.ts ../templates/next $D/package-2.1/screens; echo \"exit code: \$?\"; echo \"Lock released at \$(date -u +%H:%M:%S) UTC.\""
    echo "Whole run: $(( $(date +%s) - S0 )) s"
    echo "Docker after: $(lists)"
  } > $D/package-2.1/run-demo-scripted.txt 2>&1
fi
if [ "$WHAT" = 0.5 ] || [ "$WHAT" = all ]; then
  mkdir -p $D/package-0.5/screens
  { echo "Package 0.5's \"Done means\" demonstration, run again for package 3.2 on $H (builder/ tree $T), $(date -u +%FT%TZ). Command, from builder/: flock <scratchpad>/live-tests.lock npx tsx scripts/demo-template.ts ../templates/next ../evidence/2026-11-14-package-3.2/reopened/package-0.5/screens --guard"
    echo "Docker before: $(lists)"
    S0=$(date +%s)
    flock $S/live-tests.lock bash -c "echo \"Lock held from \$(date -u +%H:%M:%S) UTC.\"; npx tsx scripts/demo-template.ts ../templates/next $D/package-0.5/screens --guard; echo \"exit code: \$?\"; echo \"Lock released at \$(date -u +%H:%M:%S) UTC.\""
    echo "Whole run: $(( $(date +%s) - S0 )) s"
    echo "Docker after: $(lists)"
  } > $D/package-0.5/run-demo-template.txt 2>&1
  { echo "Package 0.5's tests in test/sandbox.test.ts, run again for package 3.2 on $H (builder/ tree $T), $(date -u +%FT%TZ). Command, from builder/: flock <scratchpad>/live-tests.lock npx vitest run test/sandbox.test.ts -t 'package 0.5|does not reach the tools container|a tools container whose run was cut off'"
    flock $S/live-tests.lock npx vitest run test/sandbox.test.ts -t 'package 0.5|does not reach the tools container|a tools container whose run was cut off'
    echo "vitest exit code: $?"
  } > $D/package-0.5/run-tests-0.5.txt 2>&1
fi
sed -i "s#$W#<checkout>#g; s#$S#<scratchpad>#g" $D/package-*/run-*.txt 2>/dev/null
echo all-done
