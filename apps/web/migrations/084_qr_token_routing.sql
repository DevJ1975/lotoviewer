-- Migration 084: Auto-routing by QR token.
--
-- A token already knows its physical location ("Loading Dock B").
-- When an anonymous report comes in via that token, we should be
-- able to drop it directly onto the right person's queue without a
-- triage hop — the facility manager for Plant 1, the EHS lead for
-- the warehouse, etc.
--
-- Adds two columns to incident_anon_intake_tokens:
--
--   default_assigned_investigator  Sets incidents.assigned_investigator
--                                  on the new row at insert time.
--                                  Nullable. If null, no auto-route.
--
--   auto_route_enabled             Safety valve. Some token classes
--                                  (e.g. an "HR concerns" sign by
--                                  the breakroom) should never
--                                  auto-route, since the person
--                                  the report is about may BE the
--                                  assignee. Default true to match
--                                  the most common case.

begin;

alter table public.incident_anon_intake_tokens
  add column if not exists default_assigned_investigator uuid references auth.users(id);

alter table public.incident_anon_intake_tokens
  add column if not exists auto_route_enabled boolean not null default true;

create index if not exists idx_anon_tokens_default_investigator
  on public.incident_anon_intake_tokens(default_assigned_investigator)
  where default_assigned_investigator is not null;

notify pgrst, 'reload schema';

commit;
