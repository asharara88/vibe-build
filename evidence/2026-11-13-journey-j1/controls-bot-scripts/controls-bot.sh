#!/bin/bash
# J1's controls after the review bot on defb9c4, on a copy of the code at 0f9563d (botj1-ctl/ctl-copy), with the
# database builder_test_botj1. Stand-in sandboxes and a made-up docker program: no container, no model.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
OUT=$S/botj1-ctl/controls-out.txt
C=0f9563d
rm -rf $S/botj1-ctl/ctl-copy && mkdir -p $S/botj1-ctl/ctl-copy
git -C $S/wt-j1 archive $C -- . ':!evidence' | tar -x -C $S/botj1-ctl/ctl-copy
ln -s $S/wt-j1/builder/node_modules $S/botj1-ctl/ctl-copy/builder/node_modules
cd $S/botj1-ctl/ctl-copy/builder || exit 1
{
echo "J1 after the review bot on defb9c4, 13 Nov 2026: each part of the two fixes removed in turn (exact replacements) on a copy of the code at $C (git archive of the commit, the evidence left out; node_modules linked), the tests that guard it run, the file restored; then the copy compared with a fresh one. Database builder_test_botj1; TMPDIR <scratchpad>/botj1-tmp; stand-in sandboxes and a made-up docker program, no container, no model. Scripts: controls-bot-scripts/. Controls J1-C92 to J1-C105."
echo "Started $(date -u +%H:%M:%S) UTC."
python3 -I $S/botj1-ctl/controls-bot.py
echo
rm -rf $S/botj1-ctl/pristine && mkdir -p $S/botj1-ctl/pristine && git -C $S/wt-j1 archive $C -- . ':!evidence' | tar -x -C $S/botj1-ctl/pristine && echo "After every control, the copy compared with a fresh copy of $C (diff -rq, node_modules left out): $(diff -rq --exclude=node_modules $S/botj1-ctl/pristine $S/botj1-ctl/ctl-copy && echo no difference)"
echo "Databases named builder_test_botj1* left: $(psql -h /var/run/postgresql -d postgres -Atc "select string_agg(datname, ', ') from pg_database where datname like 'builder_test_botj1%'"); interface processes left (pgrep -f src/web/main.ts): $(pgrep -fc 'src/web/main.ts'); made-up docker sleeps left (a 'sleep 30' whose parent is not this session's own monitoring loop, which also sleeps 30 s): $(n=0; for p in $(pgrep -x sleep); do a=$(tr '\0' ' ' < /proc/$p/cmdline); pp=$(awk '{print $4}' /proc/$p/stat); if [ "$a" = "sleep 30 " ] && ! tr '\0' ' ' < /proc/$pp/cmdline | grep -q journal.jsonl; then n=$((n+1)); fi; done; echo $n)"
echo "Finished $(date -u +%H:%M:%S) UTC."
} > $OUT 2>&1
sed -i "s#$S#<scratchpad>#g" $OUT
echo done > $S/botj1-ctl/controls.done
