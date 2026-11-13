-- An operator's recovery of a journal line that could not be read (build plan package 1.4b; the third outside
-- review, item 1). A line of the gateway's journal that cannot be read keeps every gateway that reads it closed;
-- builder/scripts/journal-recover.ts sets it aside, and this row is the record of it: the line's exact bytes,
-- its fingerprint, who set it aside and why, and, when the operator named the hold the line may stand for, the
-- freeze written on that hold's project in the same transaction. The line is then moved out of the journal file
-- into the folder's set-aside file, and moved_at is set once that is done.

create table if not exists journal_set_asides (
  id                     bigserial primary key,
  -- One id per set-aside, written in the set-aside file's entry too.
  set_aside_id           text not null unique,
  -- The journal folder's own id (its file journal-folder-id).
  journal_folder_id      text not null,
  -- SHA-256 of the line's bytes, without its line end, in hex.
  fingerprint            text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  line_number            integer not null check (line_number >= 1),
  line_length            integer not null check (line_length >= 0),
  -- The line's exact bytes, as base64, and the line as text with control characters shown as spaces.
  line_base64            text not null,
  line_shown             text not null,
  why_unreadable         text not null,
  -- The journal file's SHA-256 before the line was moved out, and as it is to be after.
  pending_sha256_before  text not null,
  pending_sha256_after   text not null,
  -- The hold the operator named, its project and the freeze written on it; all three empty for a line set
  -- aside as concerning no open hold.
  project_id             text references projects(id),
  hold_id                bigint references holds(id),
  -- Not a foreign key: one would make "truncate project_freezes" fail on the key before that table's own
  -- trigger refuses it with its reason (B10 (6)). It is written in the same transaction as the freeze.
  freeze_id              bigint,
  set_aside_by           text not null,
  reason                 text not null,
  recorded_at            timestamptz not null default clock_timestamp(),
  -- When the line was moved out of the journal file; empty while the move is not done.
  moved_at               timestamptz,
  check ((project_id is null) = (hold_id is null) and (hold_id is null) = (freeze_id is null))
);
create index if not exists journal_set_asides_folder on journal_set_asides(journal_folder_id, fingerprint);

-- A set-aside is never deleted or rewritten. The one change allowed is setting moved_at once.
create or replace function journal_set_asides_kept() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    if old.moved_at is null
       and new.moved_at is not null
       and (to_jsonb(new) - 'moved_at') = (to_jsonb(old) - 'moved_at') then
      return new;
    end if;
    raise exception 'A journal set-aside can only be marked moved, once; nothing else in it changes.';
  end if;
  raise exception 'A journal set-aside is never deleted (% refused).', tg_op;
end $$;

drop trigger if exists journal_set_asides_no_update on journal_set_asides;
create trigger journal_set_asides_no_update before update on journal_set_asides
  for each row execute function journal_set_asides_kept();
drop trigger if exists journal_set_asides_no_delete on journal_set_asides;
create trigger journal_set_asides_no_delete before delete on journal_set_asides
  for each row execute function journal_set_asides_kept();
drop trigger if exists journal_set_asides_no_truncate on journal_set_asides;
create trigger journal_set_asides_no_truncate before truncate on journal_set_asides
  for each statement execute function journal_set_asides_kept();
