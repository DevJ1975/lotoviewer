-- Migration 164: Tenant-level language preference for printed artifacts.
--
-- Module 3 introduces an i18n dictionary in @soteria/core/i18n with
-- three languages: en (default), es, fr. The placard PDF generator
-- and other printed surfaces honor the tenant's language preference
-- when rendering text that isn't user-authored.
--
-- The existing default_report_locale column (migration 083) is scoped
-- to the anonymous-report form and only supports en/es. We keep that
-- column as-is and add a new tenant-wide `language` column with the
-- expanded enum so the two surfaces don't drift.
--
-- Idempotent.

begin;

alter table public.tenants
  add column if not exists language text
    not null default 'en'
    check (language in ('en', 'es', 'fr'));

comment on column public.tenants.language is
  'Tenant-wide UI / printed-artifact language. Honored by the placard PDF generator and any other printed surface that uses the @soteria/core/i18n dictionary. The legacy default_report_locale column remains scoped to the anonymous-report form.';

notify pgrst, 'reload schema';

commit;
