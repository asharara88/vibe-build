-- Package 1.4b brought up to date with 1.4c: the database's checks of the freeze kind 'journal_line_set_aside'
-- (migration 012), on a database that ran the whole chain from empty. Made-up rows only. psql runs each statement on
-- its own (autocommit), so one refused changes nothing; the error's code and the constraint that refused it are printed.
-- Run as: psql -X -d <that database> -f migration-checks-merge.sql
\set ON_ERROR_STOP 0
\set VERBOSITY verbose
insert into projects(id, name, cap_usd) values ('p_m14b_chain', 'made-up project', 5);
insert into holds(id, project_id, amount_usd, gateway, deadline_at) values (9001, 'p_m14b_chain', 0.009960, 'gw_made_up', now() + interval '1 hour');
\echo '--- 1. a set-aside freeze as journal-recovery.ts writes it: accepted'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000001', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000001","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
\echo '--- 2. a second set-aside freeze naming the same hold (another line): accepted, as on 1.4b'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000002', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000002","fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}');
\echo '--- 3. refused: no hold named'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', null, 'set-aside:sa_0000000000000003', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000003","fingerprint":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}');
\echo '--- 4. refused: no fingerprint'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000004', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000004"}');
\echo '--- 5. refused: a fingerprint that is not 64 hex digits'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000005', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000005","fingerprint":"not-a-fingerprint"}');
\echo '--- 6. refused: a journal id that is not set-aside: and its id'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'j_made_up_6', 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000006","fingerprint":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"}');
\echo '--- 7. refused: no journal id'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, null, 'gw_made_up', 'made up', now(), 0.009960,
          '{"set_aside_id":"sa_0000000000000007","fingerprint":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}');
\echo '--- 8. refused: a bill (what the call cost is not known)'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000008', 'gw_made_up', 'made up', now(), 0.009960, 0.02,
          '{"set_aside_id":"sa_0000000000000008","fingerprint":"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"}');
\echo '--- 9. refused: no hold amount'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, record)
  values ('p_m14b_chain', 'journal_line_set_aside', 9001, 'set-aside:sa_0000000000000009', 'gw_made_up', 'made up', now(), null,
          '{"set_aside_id":"sa_0000000000000009","fingerprint":"1111111111111111111111111111111111111111111111111111111111111111"}');
\echo '--- 10. 1.4c kept: a bill_above_hold whose bill is not above its hold is refused by its own check'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'bill_above_hold', 9001, null, 'gw_made_up', 'made up', now(), 0.009960, 0.009960, '{}');
\echo '--- 11. 1.4c kept: one kept_above_hold per hold (the first accepted, the second refused by the index)'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'kept_above_hold', 9001, null, 'gw_made_up', 'made up', now(), 0.009960, 0.012284, '{}');
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'kept_above_hold', 9001, null, 'gw_made_up', 'made up', now(), 0.009960, 0.012284, '{}');
\echo '--- 12. 1.4c kept: an unknown kind is refused'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'another_kind', 9001, null, 'gw_made_up', 'made up', now(), 0.009960, 0.012284, '{}');
\echo '--- 13. the ON CONFLICT clause freezes.ts uses (freezeAfterOverrunIn) still finds its index: the same kept_above_hold adds nothing'
insert into project_freezes(project_id, kind, hold_id, journal_id, gateway, reason, ended_at, hold_amount_usd, bill_usd, record)
  values ('p_m14b_chain', 'kept_above_hold', 9001, null, 'gw_made_up', 'made up', now(), 0.009960, 0.012284, '{}')
  on conflict (hold_id, kind) where kind not in ('unrecorded_ending', 'journal_line_set_aside') do nothing returning id;
\echo '--- the rows'
select id, kind, hold_id, journal_id, bill_usd from project_freezes order by id;
