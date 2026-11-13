#!/bin/bash
# The reproductions before the fix: the tests exactly as committed in 0f9563d, with builder/src/ exactly as at defb9c4,
# on a copy (botj1-ctl/before-copy). Database builder_test_botj1; stand-in sandboxes and a made-up docker program only.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
OUT=$S/botj1-ev/run-repro-before-bot.txt
rm -rf $S/botj1-ctl/before-copy && mkdir -p $S/botj1-ctl/before-copy
git -C $S/wt-j1 archive 0f9563d -- . ':!evidence' | tar -x -C $S/botj1-ctl/before-copy
rm -rf $S/botj1-ctl/before-copy/builder/src
git -C $S/wt-j1 archive defb9c4 -- builder/src | tar -x -C $S/botj1-ctl/before-copy
ln -s $S/wt-j1/builder/node_modules $S/botj1-ctl/before-copy/builder/node_modules
mkdir -p $S/botj1-ctl/ref && rm -rf $S/botj1-ctl/ref/* && git -C $S/wt-j1 archive defb9c4 -- builder/src | tar -x -C $S/botj1-ctl/ref && mkdir -p $S/botj1-ctl/ref/t && git -C $S/wt-j1 archive 0f9563d -- builder/test | tar -x -C $S/botj1-ctl/ref/t
cd $S/botj1-ctl/before-copy/builder || exit 1
export TMPDIR=$S/botj1-tmp BUILDER_BROWSER_CACHE=$S/p31-cache BUILDER_TEST_DATABASE_URL='postgres:///builder_test_botj1?host=/var/run/postgresql' NO_COLOR=1 FORCE_COLOR=0
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
{
echo "J1, 13 Nov 2026, the review bot's two findings on defb9c4: the new tests exactly as committed in 0f9563d, run with builder/src/ exactly as at defb9c4, on a copy (git archive; the evidence left out; node_modules linked). Expected: the three reproductions (two of finding 1, one of finding 2) FAIL on their assertions; the four tests of the fix's parts FAIL because what they call does not exist yet."
echo "Development machine (a cloud session). Test database builder_test_botj1 over the local socket (peer authentication, no password); the real-interface test makes a database of its own next to it and drops it. Stand-in sandboxes and a made-up docker program, no container, no model; made-up data only. $(date -u '+%Y-%m-%d %H:%M:%S') UTC."
echo "The copy's builder/src/ compared with defb9c4's (diff -r): $(diff -r $S/botj1-ctl/ref/builder/src src && echo identical)"
echo "The copy's builder/test/ compared with 0f9563d's (diff -r): $(diff -r $S/botj1-ctl/ref/t/builder/test test && echo identical)"
echo "\$ flock <scratchpad>/live-tests.lock npx vitest run test/journey.test.ts test/web.test.ts -t 'review bot on defb9c4'"
flock $S/live-tests.lock npx vitest run test/journey.test.ts test/web.test.ts -t 'review bot on defb9c4'; echo "vitest exit code: $?"
echo "Databases named builder_test_botj1* left: $(psql -h /var/run/postgresql -d postgres -Atc "select string_agg(datname, ', ') from pg_database where datname like 'builder_test_botj1%'"); interface processes left (pgrep -f src/web/main.ts): $(pgrep -fc 'src/web/main.ts')"
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done > $S/botj1-ctl/before.done
