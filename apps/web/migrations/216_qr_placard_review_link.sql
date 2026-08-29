-- Migration 216: surface the active public review link from get_placard_by_qr.
--
-- The public placard view (/qr/{qr_token}) is read-only, but field workers
-- want a one-tap path to "update this photo." Photo replacement lives on the
-- tenant's public review portal (/review/{token}) — the same link already
-- printed on the verification-packet cover. So we return that link's token
-- from get_placard_by_qr (when an active, non-revoked, non-expired public
-- link exists) and the /qr page deep-links into the review flow for the
-- scanned equipment. No new exposure: the token is already public on the
-- packet, the public link cannot sign off, and staged photos still require
-- admin reconcile.
--
-- create-or-replace keeps the existing anon grant and signature; this only
-- adds the `review_link_token` key to the returned jsonb.

begin;

create or replace function public.get_placard_by_qr(
  p_token      text,
  p_ip         text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'extensions'
as $$
declare
  v_eq     public.loto_equipment%rowtype;
  v_result jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{16}$' then
    return null;
  end if;

  select * into v_eq
    from public.loto_equipment
   where qr_token = p_token
     and decommissioned = false
   limit 1;

  if not found then
    return null;
  end if;

  insert into public.loto_placard_scan_log (tenant_id, equipment_id, qr_token, ip, user_agent)
  values (v_eq.tenant_id, v_eq.equipment_id, p_token, nullif(p_ip, ''), nullif(p_user_agent, ''));

  select jsonb_build_object(
    'equipment_id',    v_eq.equipment_id,
    'description',     v_eq.description,
    'department',      v_eq.department,
    'iso_photo_url',   v_eq.iso_photo_url,
    'equip_photo_url', v_eq.equip_photo_url,
    'iso_annotations', coalesce(v_eq.iso_annotations, '[]'::jsonb),
    'verified',        v_eq.verified,
    'verified_date',   v_eq.verified_date,
    -- Active public review link for this tenant (one per tenant, enforced by
    -- idx_loto_review_links_one_public_per_tenant). NULL when none is live —
    -- the /qr page then hides the "update a photo" action.
    'review_link_token', (
      select l.token
        from public.loto_review_links l
       where l.tenant_id = v_eq.tenant_id
         and l.is_public = true
         and l.revoked_at is null
         and l.expires_at > now()
       order by l.created_at desc
       limit 1
    ),
    'energy_steps', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'energy_type',            s.energy_type,
          'tag_description',        s.tag_description,
          'isolation_procedure',    s.isolation_procedure,
          'method_of_verification', s.method_of_verification
        )
        order by s.sequence_order nulls last, s.step_number, s.energy_type
      )
      from public.loto_energy_steps s
      where s.tenant_id = v_eq.tenant_id
        and s.equipment_id = v_eq.equipment_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_placard_by_qr(text, text, text) from public;
grant execute on function public.get_placard_by_qr(text, text, text) to anon, authenticated, service_role;

commit;
