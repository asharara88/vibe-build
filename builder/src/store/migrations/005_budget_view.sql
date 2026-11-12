-- The budget's "spent" figure counts only what can be a real charge (package 1.2, second review):
-- a model.call event whose cost is a real number that is not negative, and whose hold, if it
-- names one, is settled. An event that names a hold which is open again is not money spent:
-- that hold is counted in full under open holds instead, never both.

create or replace view project_budget as
  select p.id as project_id,
         p.cap_usd,
         coalesce((
           select sum((e.payload->>'cost_usd')::numeric)
             from events e
            where e.project_id = p.id
              and e.kind = 'model.call'
              and jsonb_typeof(e.payload->'cost_usd') = 'number'
              and (e.payload->>'cost_usd')::numeric >= 0
              and (e.payload->'hold_id' is null
                   or jsonb_typeof(e.payload->'hold_id') <> 'number'
                   or exists (select 1 from holds h where h.id = (e.payload->>'hold_id')::bigint and h.state = 'settled'))
         ), 0) as spent_usd,
         coalesce((select sum(h.amount_usd) from holds h where h.project_id = p.id and h.state = 'open'), 0) as open_holds_usd,
         (select count(*) from holds h where h.project_id = p.id and h.state = 'open') as open_holds
    from projects p;

-- Migration 004 reopened holds that an earlier version had settled at an invalid amount, without
-- writing that down. Every change to a hold belongs in the event log: write it now, once.
insert into events(project_id, kind, step, payload)
select h.project_id, 'hold.reopened', h.step,
       jsonb_build_object('hold_id', h.id, 'amount_usd', h.amount_usd, 'reason', h.kept_reason, 'kept', true, 'still_open', true)
  from holds h
 where h.state = 'open'
   and h.kept_reason like 'settled at an invalid amount%'
   and not exists (select 1 from events e where e.project_id = h.project_id and e.kind = 'hold.reopened' and (e.payload->>'hold_id')::bigint = h.id);
