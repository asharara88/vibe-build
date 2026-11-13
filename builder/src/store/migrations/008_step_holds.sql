-- Step holds (build plan package 1.3; design note 5.5, "The pre-step check"; proof row B7).
-- Before a step starts, its whole budget (turns x the hold of one call at the step's model, output
-- ceiling and prompt limit) is reserved for it. The reserved part not yet drawn is the step's "room".
-- Each call the step makes draws its hold from that room; when the step ends, the room left is
-- released. The room counts in the budget equation beside open holds:
--     spent + open holds + room reserved for running steps + this call's or step's amount <= cap.
--
-- A NaN or negative figure here would switch off the whole project's cap (a NaN sum makes every
-- "> cap" test false; a negative room lowers the total), so every figure is checked in the database
-- as well as in the code (review of the 1.3 design, item 1). In PostgreSQL 'NaN' is greater than
-- every number, so "> 0" alone would let it in: each check names it.

create table if not exists step_holds (
  id                  bigserial primary key,
  project_id          text not null references projects(id),
  step_id             text not null,
  -- The limits the budget was worked out from. A call outside them is refused (holds.ts, openHold),
  -- so the step's turns always fit in its budget.
  model               text not null,
  max_tokens_ceiling  integer not null,
  prompt_tokens       integer not null,
  turns               integer not null,
  per_turn_usd        numeric(14,6) not null,
  budget_usd          numeric(14,6) not null,
  room_usd            numeric(14,6) not null,
  -- What a call cost above its own hold and above the room left at that moment (taken from nothing).
  overrun_not_covered_usd numeric(14,6) not null default 0,
  state               text not null default 'open',
  opened_at           timestamptz not null default now(),
  deadline_at         timestamptz not null,
  closed_at           timestamptz,
  closed_reason       text,
  -- The target of the two composite keys below: a token or a hold can name a step hold of its own project only.
  constraint step_holds_id_project unique (id, project_id),
  constraint step_holds_state check (state in ('open', 'closed')),
  constraint step_holds_limits check (max_tokens_ceiling > 0 and prompt_tokens >= 0 and turns > 0),
  constraint step_holds_per_turn_is_a_number check (per_turn_usd <> 'NaN'::numeric and per_turn_usd > 0),
  constraint step_holds_budget_is_a_number check (budget_usd <> 'NaN'::numeric and budget_usd > 0 and budget_usd = turns * per_turn_usd),
  constraint step_holds_room_is_a_number check (room_usd <> 'NaN'::numeric and room_usd >= 0 and room_usd <= budget_usd),
  constraint step_holds_overrun_is_a_number check (overrun_not_covered_usd <> 'NaN'::numeric and overrun_not_covered_usd >= 0),
  constraint step_holds_closed_has_no_room check (
    (state = 'open' and closed_at is null and closed_reason is null)
    or (state = 'closed' and closed_at is not null and closed_reason is not null and room_usd = 0)
  )
);
create index if not exists step_holds_project_open on step_holds(project_id) where state = 'open';

-- A step's token: issued when its hold opens (only its hash is stored, as for every project token),
-- revoked when it closes. Its calls draw from that step's room.
alter table project_tokens add column if not exists step_hold_id bigint;
alter table project_tokens drop constraint if exists project_tokens_step_hold;
alter table project_tokens add constraint project_tokens_step_hold foreign key (step_hold_id, project_id) references step_holds(id, project_id);

-- The step hold a call's hold was drawn from, if any.
alter table holds add column if not exists step_hold_id bigint;
alter table holds drop constraint if exists holds_step_hold;
alter table holds add constraint holds_step_hold foreign key (step_hold_id, project_id) references step_holds(id, project_id);
create index if not exists holds_step_hold on holds(step_hold_id) where step_hold_id is not null;

-- The budget view of migration 006, with the room reserved for running steps beside open holds.
-- `open_holds_usd` and `open_holds` keep their meaning (call holds only); the room is its own figure,
-- so every message can show the two apart.
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
         (select count(*) from holds h where h.project_id = p.id and h.state = 'open') as open_holds,
         coalesce((select sum(s.room_usd) from step_holds s where s.project_id = p.id and s.state = 'open'), 0) as step_room_usd,
         (select count(*) from step_holds s where s.project_id = p.id and s.state = 'open') as open_steps
    from projects p;
