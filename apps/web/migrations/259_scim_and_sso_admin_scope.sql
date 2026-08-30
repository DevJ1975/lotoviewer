-- Restrict scim_tokens and tenant_sso_configurations to tenant admins.
--
-- Migration 160 scoped both tables with current_user_tenant_ids() — ANY
-- membership, including 'viewer' — and wrote the policy `for all`, so the
-- grant covered INSERT/UPDATE/DELETE, not just SELECT. current_user_tenant_ids()
-- carries no role predicate (see 190); current_user_admin_tenant_ids(), defined
-- immediately below it there, is the one that does. Migration 194 already uses
-- the admin helper for notification_channels, which is the convention this
-- restores.
--
-- WHY IT MATTERS — scim_tokens is a credential table.
--
-- /api/scim/v2/Users authenticates by looking up ONLY the sha256 of the
-- presented bearer token and checking revoked_at, then serves every request
-- through supabaseAdmin(), which bypasses RLS entirely:
--
--     const { data: row } = await admin.from('scim_tokens')
--       .select('id, tenant_id, revoked_at').eq('token_hash', tokenHash)...
--
-- So a viewer of tenant T could compute sha256 of a string of their choosing,
-- INSERT {tenant_id: T, token_hash: <that digest>} straight through PostgREST
-- with the anon key and their own JWT, and then call the SCIM endpoints with
-- that string as a bearer token. That is full create/rename/deactivate access
-- to loto_workers — which loto_workers' own policy (051) reserves for
-- owner/admin — reached without ever touching /api/admin/scim-tokens and its
-- requireTenantAdmin gate.
--
-- Two further consequences of the same hole: the credential is
-- session-independent and never re-checked against membership, so it kept
-- working after the person was removed from the tenant; and the identical
-- policy allowed `update scim_tokens set revoked_at = now()`, letting any
-- member kill the tenant's production IdP integration in one request.
--
-- tenant_sso_configurations has the same policy shape and no API route at all
-- — the admin page writes it directly through the RLS-scoped client and gates
-- only on a client-side is_admin check — so RLS is its entire access control.
-- A member could enable federation or point idp_metadata_url at an IdP they
-- control, which is the row a superadmin reviews when finalising SSO.
--
-- Also revokes the direct write grants on scim_tokens: issuance and revocation
-- should only ever happen through the audited API route, so RLS is not the
-- last line of defence for a credential. Reads stay open to the tenant's
-- admins because the admin page lists tokens through PostgREST.

begin;

drop policy if exists "scim_tokens_tenant_scope" on public.scim_tokens;
create policy "scim_tokens_admin_scope"
  on public.scim_tokens
  for all to authenticated
  using (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  );

drop policy if exists "tenant_sso_configurations_tenant_scope"
  on public.tenant_sso_configurations;
create policy "tenant_sso_configurations_admin_scope"
  on public.tenant_sso_configurations
  for all to authenticated
  using (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  )
  with check (
    tenant_id in (select public.current_user_admin_tenant_ids())
    or public.is_superadmin()
  );

-- Defence in depth: even a future policy mistake must not let a token be
-- minted or silently revoked from the browser. The service-role client used
-- by /api/admin/scim-tokens is unaffected by these grants.
revoke insert, update, delete on public.scim_tokens from authenticated;

commit;
