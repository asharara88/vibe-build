-- The stop after a fault (build plan package 1.4; design note 5.5 step 5, amendment e; proof row B10).
-- When the write that records a model call's ending fails, the gateway keeps the call's record in a
-- journal file of its own and writes one row here once the database takes it. A project with a row here
-- whose cleared_at is empty is frozen: no hold opens, no step starts and nothing is forwarded for it.
-- Only the owner's recorded action clears it (package 1.5). Nothing here reads the cap, so a cap raise
-- does not reopen a frozen project.

create table if not exists project_freezes (
  id               bigserial primary key,
  project_id       text not null references projects(id),
  -- The hold of the call whose ending could not be written. Kept open at its full amount.
  hold_id          bigint references holds(id),
  -- One id per journal line: writing the same line twice (a replay after a crash) adds nothing.
  journal_id       text not null unique,
  gateway          text not null,
  reason           text not null,
  -- When the call ended, by the gateway's clock.
  ended_at         timestamptz not null,
  hold_amount_usd  numeric(14,6),
  -- The call's record as the gateway kept it (already cleaned of the model key).
  record           jsonb not null,
  frozen_at        timestamptz not null default now(),
  cleared_at       timestamptz
);
create index if not exists project_freezes_active on project_freezes(project_id) where cleared_at is null;

-- A freeze is never deleted or rewritten: deleting the row would reopen the project with no record.
-- The one change allowed is setting cleared_at once (package 1.5 does it, with an event).
create or replace function project_freezes_kept() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.cleared_at is null
       and new.cleared_at is not null
       and (to_jsonb(new) - 'cleared_at') = (to_jsonb(old) - 'cleared_at') then
      return new;
    end if;
    raise exception 'A project''s freeze can only be cleared, once; nothing else in it changes.';
  end if;
  raise exception 'A project''s freeze is never deleted (% refused). It is cleared by the owner''s recorded action.', tg_op;
end $$;

drop trigger if exists project_freezes_no_update on project_freezes;
create trigger project_freezes_no_update before update on project_freezes
  for each row execute function project_freezes_kept();
drop trigger if exists project_freezes_no_delete on project_freezes;
create trigger project_freezes_no_delete before delete on project_freezes
  for each row execute function project_freezes_kept();
drop trigger if exists project_freezes_no_truncate on project_freezes;
create trigger project_freezes_no_truncate before truncate on project_freezes
  for each statement execute function project_freezes_kept();
