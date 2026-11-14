-- Known gap 145, closed on the owner's instruction of 14 Nov 2026 ("Ensure a detected overrun blocks further
-- forwarding for that project before completion is exposed"; docs/DECISIONS.md).
--
-- A streamed call's usage figures arrive as the answer streams. When the figures read so far, priced as the gateway
-- prices a bill, already put the call above its hold, the gateway writes that here, on the call's own hold, before it
-- passes on any further byte of the answer (so before the provider's end-of-message marker reaches the caller). From
-- then on the project is stopped: `openHold` refuses it under the project's lock, as it refuses a frozen project, for
-- as long as that hold is open and the call's ending has not been recorded (`kept_reason` is null). Once the ending is
-- recorded, what package 1.4c already writes takes over: the settlement's freeze ('bill_above_hold'), or the keep's
-- ('kept_above_hold') when the figures it trusts still put the call above its hold. This is not a freeze row: the
-- freeze kinds and their reconciliation are as package 1.4c left them.
--
--   read_above_hold_usd  the call's cost as the figures read so far priced it, above the hold's amount
--   read_above_hold_at   when that was written (the database's clock)

alter table holds add column if not exists read_above_hold_usd numeric(14,6);
alter table holds add column if not exists read_above_hold_at timestamptz;

-- Both or neither; the cost is a real amount above the hold's. In PostgreSQL 'NaN' compares as greater than every
-- number, so it is named.
alter table holds drop constraint if exists holds_read_above_hold;
alter table holds add constraint holds_read_above_hold
  check ((read_above_hold_usd is null and read_above_hold_at is null)
         or (read_above_hold_usd is not null and read_above_hold_at is not null
             and read_above_hold_usd <> 'NaN'::numeric and read_above_hold_usd > amount_usd));
