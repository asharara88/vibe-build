#!/bin/bash
# Own check after the review bot on af80dc9: the order in which a sign-out during the record of an opening lands in the project's record.
S=/tmp/claude-0/-home-user-vibe-build/1f0c18f2-22e7-56d9-a04f-5fb87e17b90b/scratchpad
cd $S/wt-j3/builder || exit 1
export TMPDIR=$S/ownj3-tmp BUILDER_BROWSER_CACHE=$S/p31-cache NO_COLOR=1 FORCE_COLOR=0
export BUILDER_TEST_DATABASE_URL='postgres:///builder_test_ownj3_order?host=/var/run/postgresql'
unset BUILDER_DATA_DIR BUILDER_MODEL_API_KEY BUILDER_UI_PASSWORD BUILDER_DATABASE_URL
mkdir -p $TMPDIR
dropdb -h /var/run/postgresql --if-exists builder_test_ownj3_order && createdb -h /var/run/postgresql builder_test_ownj3_order
flock $S/live-tests.lock npx vitest run test/journey.test.ts -t "a sign-out while live_opened is being written" 2>&1 | grep -E "Test Files|Tests "
psql -h /var/run/postgresql -d builder_test_ownj3_order -Atc "
with p as (select project_id from events where kind='journey.preview.live_closed' and payload->>'reason'='sign_out')
select id, kind, coalesce(payload->>'reason',''), coalesce(payload->>'session','') from events where project_id in (select project_id from p)
and (kind like 'journey.preview.live_%' or kind like 'journey.job.%') order by id"
dropdb -h /var/run/postgresql --if-exists builder_test_ownj3_order
