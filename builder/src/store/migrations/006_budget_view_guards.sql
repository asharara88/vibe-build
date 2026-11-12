-- The budget view, guarded against events it did not expect (package 1.2, third review).
-- The gateway only ever writes a model.call event with a whole-number hold id of the same
-- project. An event written any other way must not make the budget unreadable, and must not
-- make "spent" smaller:
--   * a hold id that is not a whole number (12.5, 1e30, text) no longer stops the view;
--   * a cost is left out of "spent" only when it names an OPEN hold OF THE SAME PROJECT, which
--     is then counted in full under open holds instead. A cost naming a hold that does not
--     exist, or another project's hold, is counted as spent.

create or replace view project_budget as
  select p.id as project_id,
         p.cap_usd,
         coalesce((
           select sum((e.payload->>'cost_usd')::numeric)
             from events e
            where e.project_id = p.id
              and e.kind = 'model.call'
              and case when jsonb_typeof(e.payload->'cost_usd') = 'number'
                       then (e.payload->>'cost_usd')::numeric >= 0
                       else false end
              and not exists (
                    select 1 from holds h
                     where h.project_id = e.project_id
                       and h.state = 'open'
                       and h.id = case when jsonb_typeof(e.payload->'hold_id') = 'number'
                                        and (e.payload->>'hold_id') ~ '^[0-9]{1,18}$'
                                       then (e.payload->>'hold_id')::bigint end)
         ), 0) as spent_usd,
         coalesce((select sum(h.amount_usd) from holds h where h.project_id = p.id and h.state = 'open'), 0) as open_holds_usd,
         (select count(*) from holds h where h.project_id = p.id and h.state = 'open') as open_holds
    from projects p;
