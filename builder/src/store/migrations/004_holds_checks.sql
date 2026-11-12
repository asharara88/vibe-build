-- Holds, second part (build plan package 1.2, after its first review).
-- 1. An amount must be a real, non-negative number. In PostgreSQL the special value NaN
--    compares as greater than every number, so "amount >= 0" alone would let it through.
-- 2. A hold found open when a gateway starts is noted once, not at every start.

-- A hold that an earlier version settled at an amount that is not a real, non-negative number
-- was never really settled: reopen it and keep it at its full amount.
update holds
   set state = 'open', closed_at = null, actual_usd = null,
       kept_reason = coalesce(kept_reason, 'settled at an invalid amount by an earlier version; reopened and kept')
 where state = 'settled' and (actual_usd = 'NaN'::numeric or actual_usd < 0);

alter table holds drop constraint if exists holds_amount_is_a_number;
alter table holds add constraint holds_amount_is_a_number check (amount_usd <> 'NaN'::numeric and amount_usd >= 0);
alter table holds drop constraint if exists holds_actual_is_a_number;
alter table holds add constraint holds_actual_is_a_number check (actual_usd is null or (actual_usd <> 'NaN'::numeric and actual_usd >= 0));
alter table holds add column if not exists seen_at_startup boolean not null default false;
