-- 251_member_access_reset_event.sql
--
-- Admin-initiated access resets (re-invite / rotate password) need their
-- own audit event. Reusing 'login_granted' would be a lie: the login
-- already existed, and an auditor reading the trail could not tell a
-- first-time grant apart from a credential rotation on a live account.
--
-- 184_member_merge.sql last rewrote this constraint; we restate the full
-- allowed set rather than trying to ALTER it in place, because a CHECK
-- constraint has no additive form.

alter table public.member_status_events
  drop constraint if exists member_status_events_event_type_check;

alter table public.member_status_events
  add constraint member_status_events_event_type_check
  check (event_type in (
    'created','updated','status_changed','role_changed','readiness_changed',
    'login_granted','login_revoked','imported','merged','access_reset'
  ));
