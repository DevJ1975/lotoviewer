-- Rollback for migration 315: compliance calendar v2.
--
-- DESTRUCTIVE: obligations created from the library or by AI (source 'library' or
-- 'ai') are DELETED, because the restored source check only allows 'system' and
-- 'tenant'. The added columns (program, library and checklist links, due_anchor,
-- lead_days, last_reminded_on) are dropped, losing reminder state.
--
-- Policies are NOT touched: access to the obligations register is the register's
-- (migration 298), and this migration never changed it.
--
-- Idempotent.

begin;

delete from public.compliance_calendar_obligations where source in ('library', 'ai');

alter table public.compliance_calendar_obligations drop constraint if exists compliance_calendar_obligations_source_check;
alter table public.compliance_calendar_obligations
  add constraint compliance_calendar_obligations_source_check check (source in ('system', 'tenant'));

drop function if exists public.env_complete_obligation(uuid, date, text, text, uuid);
drop function if exists public.env_advance_due_date(date, text, int, boolean);

drop index if exists public.idx_ccal_obligation_facility_due;

alter table public.compliance_calendar_obligations
  drop column if exists program,
  drop column if exists legal_register_id,
  drop column if exists checklist_template_id,
  drop column if exists library_key,
  drop column if exists due_anchor,
  drop column if exists lead_days,
  drop column if exists last_reminded_on;

notify pgrst, 'reload schema';

commit;
