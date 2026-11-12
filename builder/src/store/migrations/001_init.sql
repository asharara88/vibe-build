-- Project store and append-only event log. Design note, section 2.1.
-- Events are never updated or deleted: triggers below refuse both.

create table if not exists projects (
  id          text primary key,
  name        text not null,
  profile     text not null default 'standard',
  cap_usd     numeric(12,4) not null check (cap_usd >= 0),
  created_at  timestamptz not null default now()
);

-- A project token is what the engine's container holds instead of the real model key.
-- Only its hash is stored. The gateway maps a presented token to its project.
create table if not exists project_tokens (
  token_hash  text primary key,
  project_id  text not null references projects(id),
  label       text not null default 'engine',
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

create table if not exists events (
  id          bigserial primary key,
  project_id  text not null references projects(id),
  at          timestamptz not null default now(),
  kind        text not null,
  step        text,
  payload     jsonb not null default '{}'::jsonb
);
create index if not exists events_project_at on events(project_id, at);
create index if not exists events_project_kind on events(project_id, kind);

create or replace function events_are_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'The event log is append-only. Events cannot be % .', tg_op;
end $$;

drop trigger if exists events_no_update on events;
create trigger events_no_update before update on events
  for each row execute function events_are_append_only();
drop trigger if exists events_no_delete on events;
create trigger events_no_delete before delete on events
  for each row execute function events_are_append_only();

-- Spend per project, read straight from the model.call events the gateway writes.
create or replace view project_spend as
  select p.id as project_id,
         p.cap_usd,
         coalesce(sum((e.payload->>'cost_usd')::numeric), 0) as spent_usd,
         count(e.id) filter (where e.kind = 'model.call') as model_calls
    from projects p
    left join events e on e.project_id = p.id and e.kind = 'model.call'
   group by p.id, p.cap_usd;
