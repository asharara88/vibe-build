-- A bill above its hold freezes the project until the owner records it (build plan package 1.4c; the
-- owner's answer to question 17 on 13 Nov 2026, "(a) Yes, freeze (Recommended)"; docs/DECISIONS.md).
--
-- A freeze now has a kind:
--   'unrecorded_ending'       package 1.4: a call's ending could not be written to the event log. One per
--                             journal line; cleared by the owner's reconciliation of its hold (package 1.5).
--   'bill_above_hold'         package 1.4c: the gateway settled a call at a cost above its hold. Written in
--                             the same transaction as the settle and its hold.exceeded event; the hold is
--                             closed, so it is cleared by the owner's record of that bill (recordOverrun).
--   'late_answer_above_hold'  package 1.4c: an answer arrived for a hold already kept or expired, and its cost
--                             as read is above the hold. The hold stays open, so the owner's reconciliation of
--                             that hold clears it, as it clears a freeze of the first kind.
-- Every freeze written before this migration is of the first kind. A freeze of the two new kinds has no
-- journal line; it always names its hold, the hold's amount and the bill, which is above the amount.

alter table project_freezes add column if not exists kind text not null default 'unrecorded_ending';
alter table project_freezes add column if not exists bill_usd numeric(14,6);
alter table project_freezes alter column journal_id drop not null;

alter table project_freezes drop constraint if exists project_freezes_kind_known;
alter table project_freezes add constraint project_freezes_kind_known
  check (kind in ('unrecorded_ending', 'bill_above_hold', 'late_answer_above_hold'));
alter table project_freezes drop constraint if exists project_freezes_journal_line;
alter table project_freezes add constraint project_freezes_journal_line
  check (kind <> 'unrecorded_ending' or journal_id is not null);
-- In PostgreSQL 'NaN' compares as greater than every number, so it is named.
alter table project_freezes drop constraint if exists project_freezes_overrun_figures;
alter table project_freezes add constraint project_freezes_overrun_figures
  check (kind = 'unrecorded_ending'
         or (hold_id is not null and hold_amount_usd is not null and bill_usd is not null
             and bill_usd <> 'NaN'::numeric and hold_amount_usd <> 'NaN'::numeric and bill_usd > hold_amount_usd));
-- One freeze of each new kind per hold: writing it twice adds nothing.
create unique index if not exists project_freezes_one_overrun_per_hold
  on project_freezes(hold_id, kind) where kind <> 'unrecorded_ending';
