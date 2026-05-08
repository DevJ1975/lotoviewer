-- Migration 083: Per-tenant locale defaults + retaliation statement.
--
-- The hard-coded "OSHA 1904.35(b)(1)(iv)" line on the anonymous
-- report form is correct for US private-sector employers but wrong
-- for public sector, EU, or Canadian tenants. Make it a tenant
-- override with a sensible default.
--
-- Also: default locale for the public report page. The form will
-- additionally honour Accept-Language from the browser, but a
-- tenant in a region with predominantly Spanish-speaking workers
-- can pin to 'es'.

begin;

alter table public.tenants
  add column if not exists default_report_locale text
    not null default 'en'
    check (default_report_locale in ('en', 'es'));

-- NULL = use the bundled default text in the locale catalog.
-- Non-null = override that text for this tenant. Stored in the
-- raw locale of the tenant's choosing (we don't translate the
-- override). Length cap to keep the printed poster readable.
alter table public.tenants
  add column if not exists retaliation_statement_override text
    check (retaliation_statement_override is null
           or char_length(retaliation_statement_override) between 1 and 600);

notify pgrst, 'reload schema';

commit;
