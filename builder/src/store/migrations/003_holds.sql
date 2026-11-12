-- Holds: money set aside before a model call and settled afterwards. Design note, section 5.5.
-- A hold is a row here, not memory in the gateway, so it survives a restart and is seen by
-- every gateway process. Each change to a hold is also written to the append-only event log.

create table if not exists holds (
  id            bigserial primary key,
  project_id    text not null references projects(id),
  step          text,
  amount_usd    numeric(14,6) not null check (amount_usd >= 0),
  -- 'open' counts against the budget. 'settled' does not: its actual cost is in a model.call event.
  state         text not null default 'open' check (state in ('open', 'settled')),
  -- An open hold that passed its deadline. It stays open at its full amount.
  expired       boolean not null default false,
  -- An open hold whose true cost the gateway does not know. It stays open at its full amount
  -- until the owner records the actual cost (package 1.5 of the build plan).
  unreconciled  boolean not null default false,
  kept_reason   text,
  gateway       text not null,
  opened_at     timestamptz not null default now(),
  deadline_at   timestamptz not null,
  closed_at     timestamptz,
  actual_usd    numeric(14,6),
  check ((state = 'open' and closed_at is null and actual_usd is null) or (state = 'settled' and closed_at is not null and actual_usd is not null))
);
create index if not exists holds_project_open on holds(project_id) where state = 'open';

-- The three figures of the budget equation, per project:
--   spent (settled cost of finished calls) + open holds + this call's hold <= cap.
create or replace view project_budget as
  select p.id as project_id,
         p.cap_usd,
         coalesce((select sum((e.payload->>'cost_usd')::numeric) from events e where e.project_id = p.id and e.kind = 'model.call'), 0) as spent_usd,
         coalesce((select sum(h.amount_usd) from holds h where h.project_id = p.id and h.state = 'open'), 0) as open_holds_usd,
         (select count(*) from holds h where h.project_id = p.id and h.state = 'open') as open_holds
    from projects p;
