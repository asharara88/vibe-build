-- A project's cap must be a real number (build plan package 1.2b, 13 Nov 2026).
-- In PostgreSQL the special value NaN ("not a number") compares as greater than every number, so
-- the check "cap_usd >= 0" in 001 lets it through. A NaN cap would refuse no call: the gateway reads
-- it as NaN, and its admission test (spent + open holds + this hold > cap) is then never true.
-- Holds got the same check in 004.
--
-- A project that already has a NaN cap stops this migration, with a message naming it. Nothing is
-- repaired automatically: an engineer sets that cap by hand, records it in docs/DECISIONS.md, and runs
-- the migrations again. (Adding the constraint would also refuse such a row; this says which one.)
-- Adding a constraint locks the projects table while the existing rows are checked.
do $$
declare
  bad text;
begin
  select string_agg(id, ', ' order by id) into bad from projects where cap_usd = 'NaN'::numeric;
  if bad is not null then
    raise exception 'Projects whose cap is not a number (NaN): %. Set each cap by hand, record it, then run the migrations again.', bad;
  end if;
end $$;

alter table projects drop constraint if exists projects_cap_is_a_number;
alter table projects add constraint projects_cap_is_a_number check (cap_usd <> 'NaN'::numeric and cap_usd >= 0);
