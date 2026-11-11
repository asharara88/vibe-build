-- The row-level triggers in 001 refuse UPDATE and DELETE. TRUNCATE fires neither, so it needs a
-- statement-level trigger of its own.
drop trigger if exists events_no_truncate on events;
create trigger events_no_truncate before truncate on events
  for each statement execute function events_are_append_only();
