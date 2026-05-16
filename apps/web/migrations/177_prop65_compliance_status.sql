-- Migration 177: Per-site Prop 65 compliance rollup view.
--
-- The /admin/prop65 dashboard reads this view to render the
-- per-site status tiles: how many confirmed-linked chemicals, how
-- many signed exposure assessments, how many currently-posted
-- warnings, how many UNSAFE-HARBOR chemicals lack an active warning
-- (the "gap count" — the legally meaningful number).
--
-- security_invoker = true is mandatory (AGENTS.md): without it the
-- view runs with owner privileges and bypasses tenant RLS.
--
-- Idempotent.

begin;

create or replace view public.prop65_compliance_status
  with (security_invoker = true)
  as
  with confirmed_links as (
    select tenant_id, count(*)::int as confirmed_count
    from public.prop65_chemical_links
    where confidence = 'confirmed'
    group by tenant_id
  ),
  signed_assessments as (
    select tenant_id, site_id, count(*)::int as signed_count
    from public.prop65_exposure_assessments
    where signed = true
    group by tenant_id, site_id
  ),
  active_warnings as (
    select tenant_id, site_id, count(*)::int as active_count
    from public.prop65_warnings
    where removed_at is null
    group by tenant_id, site_id
  ),
  -- A "gap" is an exposure_assessment with below_safe_harbor=false
  -- (i.e. above safe harbor) at this site, where no active warning
  -- mentions any of the assessment's chemical's linked P65 entries.
  -- We approximate at the site level rather than the chemical level
  -- because a single sign can name multiple chemicals; the admin UI
  -- drills into the per-chemical detail.
  site_gaps as (
    select
      a.tenant_id,
      a.site_id,
      count(*) filter (
        where a.below_safe_harbor = false
          and not exists (
            select 1
            from public.prop65_warnings w,
                 public.prop65_chemical_links l
            where w.site_id   = a.site_id
              and w.removed_at is null
              and l.chemical_inventory_id = a.chemical_inventory_id
              and l.prop65_chemical_id    = any (w.prop65_chemical_ids)
          )
      )::int as gap_count
    from public.prop65_exposure_assessments a
    group by a.tenant_id, a.site_id
  ),
  latest_review as (
    select distinct on (tenant_id)
      tenant_id, reviewed_at, next_due_at
    from public.prop65_annual_reviews
    order by tenant_id, reviewed_at desc
  )
  select
    s.tenant_id,
    s.id                                       as site_id,
    s.name                                     as site_name,
    s.public_slug,
    coalesce(cl.confirmed_count, 0)            as confirmed_links_count,
    coalesce(sa.signed_count,    0)            as signed_assessments_count,
    coalesce(aw.active_count,    0)            as active_warnings_count,
    coalesce(sg.gap_count,       0)            as gap_count,
    lr.reviewed_at                              as latest_review_at,
    lr.next_due_at                              as annual_review_due_at
  from public.prop65_sites      s
  left join confirmed_links     cl on cl.tenant_id = s.tenant_id
  left join signed_assessments  sa on sa.tenant_id = s.tenant_id and sa.site_id = s.id
  left join active_warnings     aw on aw.tenant_id = s.tenant_id and aw.site_id = s.id
  left join site_gaps           sg on sg.tenant_id = s.tenant_id and sg.site_id = s.id
  left join latest_review       lr on lr.tenant_id = s.tenant_id;

comment on view public.prop65_compliance_status is
  'Per-site Prop 65 compliance rollup. security_invoker = true so reads respect prop65_sites RLS.';

notify pgrst, 'reload schema';

commit;
