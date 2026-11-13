-- Package 1.4c, after its review (13 Nov 2026): a call the gateway KEEPS (it ended without a bill the gateway
-- could settle: the time limit, the caller leaving, an error inside the stream, no end marker, a dropped
-- connection, a usage that does not state the speed) whose usage figures, as read before it ended, already price
-- it above its hold, freezes its project in the same transaction as its `hold.kept` event.
--
--   'kept_above_hold'  the hold stays open at its full amount, so the owner's reconciliation of that hold clears
--                      it, as it clears 'unrecorded_ending' and 'late_answer_above_hold'. Its bill_usd is the
--                      cost as read: a floor under the bill, since the figures in a usage block only grow.
--
-- Migration 010's other checks already cover it: a freeze of any kind but 'unrecorded_ending' names its hold,
-- the hold's amount and a bill above that amount, neither of them 'NaN', and there is one per hold and kind.

alter table project_freezes drop constraint if exists project_freezes_kind_known;
alter table project_freezes add constraint project_freezes_kind_known
  check (kind in ('unrecorded_ending', 'bill_above_hold', 'late_answer_above_hold', 'kept_above_hold'));
