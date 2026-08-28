-- Rollback for migration 260.
--
-- Hand-applied in an emergency only. Restores the pre-260 state:
-- whole-row select on the quiz tables, the migration 223 storage policy
-- body verbatim, and no video_provider domain.
--
-- Note what this gives back: reverting section 1 re-opens the answer-key
-- leak to every learner. Only run it if the column grants are actively
-- breaking a read path, and re-apply 260 as soon as that path is fixed.

begin;

-- 1. Restore whole-row select (RE-OPENS THE ANSWER-KEY LEAK).
grant select on public.strike_quiz_answers   to authenticated;
grant select on public.strike_quiz_questions to authenticated;

-- 2. Restore the migration 223 policy body verbatim (video extensions only).
drop policy if exists strike_media_read on storage.objects;
create policy strike_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then
        case
          when lower(substring(name from '\.([^./]+)$')) in ('mp4', 'm4v', 'mov', 'webm')
            then public.is_superadmin()
          else true
        end
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        case
          when lower(substring(name from '\.([^./]+)$')) in ('mp4', 'm4v', 'mov', 'webm')
            then (split_part(name, '/', 1))::uuid in (select public.current_user_admin_tenant_ids())
              or public.is_superadmin()
          else (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
            or public.is_superadmin()
        end
      else false
    end
  );

-- 3. Drop the provider domain. The normalizing UPDATE in 260 is not undone —
--    it only ever wrote 'vimeo', which is the column default.
alter table public.strike_module_versions
  drop constraint if exists strike_versions_provider_ck;

notify pgrst, 'reload schema';

commit;
