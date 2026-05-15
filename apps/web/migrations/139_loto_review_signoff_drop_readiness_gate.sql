-- Migration 139: Allow reviewer signoff regardless of department readiness.
--
-- Mirrors the send-side change in commit a5ddf84 ("allow sending review
-- invites regardless of department readiness"). Reviewers see the
-- department as-is, so blocking their signoff when photos or placards
-- are incomplete left customers stuck reviewing a snapshot they cannot
-- approve. Drop the readiness check from signoff_loto_review_link and
-- keep only the snapshot-exists + every-placard-reviewed requirements.

begin;

create or replace function public.signoff_loto_review_link(
  p_review_link_id uuid,
  p_approved boolean,
  p_typed_name text,
  p_signature text,
  p_notes text,
  p_ip text default null,
  p_user_agent text default null
)
returns table(review_link_id uuid)
language plpgsql
set search_path = pg_catalog, public, extensions
as $$
declare
  v_link public.loto_review_links%rowtype;
  v_snapshot_count integer;
  v_reviewed_count integer;
begin
  select *
    into v_link
    from public.loto_review_links
   where id = p_review_link_id
   for update;

  if not found then
    raise exception 'review link not found';
  end if;
  if v_link.signed_off_at is not null then
    raise exception 'review already signed off';
  end if;

  select count(*)
    into v_snapshot_count
    from public.loto_review_link_equipment
   where review_link_id = p_review_link_id;

  if v_snapshot_count = 0 then
    raise exception 'review batch has no equipment';
  end if;

  select count(distinct r.equipment_id)
    into v_reviewed_count
    from public.loto_placard_reviews r
    join public.loto_review_link_equipment e
      on e.review_link_id = r.review_link_id
     and e.equipment_id = r.equipment_id
   where r.review_link_id = p_review_link_id;

  if v_reviewed_count < v_snapshot_count then
    raise exception 'all placards must be reviewed before signoff';
  end if;

  update public.loto_review_links
     set signed_off_at = now(),
         signoff_approved = p_approved,
         signoff_signature = p_signature,
         signoff_typed_name = btrim(p_typed_name),
         signoff_notes = nullif(btrim(coalesce(p_notes, '')), ''),
         signoff_ip = p_ip,
         signoff_user_agent = p_user_agent
   where public.loto_review_links.id = p_review_link_id
   returning public.loto_review_links.id into review_link_id;

  return next;
end;
$$;

notify pgrst, 'reload schema';

commit;
