-- Migration 107: policy-uploads storage bucket for large policy files.
--
-- Vercel serverless functions cap request bodies at 4.5MB. The /api/
-- superadmin/policies/upload route was hitting 413 on large regulatory
-- documents (OSHA 29 CFR 1910 etc.) before the request even reached
-- the route. This migration adds a private Supabase Storage bucket
-- the browser uploads to FIRST; the route then downloads from the
-- bucket as service-role and runs the existing extract → chunk →
-- embed pipeline. Storage objects are processed once then deleted.
--
-- Bucket sizing:
--   - file_size_limit: 25MB (matches the route's MAX_BYTES — anything
--     larger is rejected at upload time before tokens are spent on
--     extraction).
--   - allowed_mime_types: same allowlist as the route's policyExtract
--     module. Wider types are rejected by the bucket; narrower types
--     by the route — defense in depth.
--   - public: false. Only superadmins can write (via RLS); only the
--     service-role server reads. Files are deleted post-ingestion.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'policy-uploads',
  'policy-uploads',
  false,
  26214400,  -- 25 MB
  array['text/markdown','text/x-markdown','text/plain','application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

-- ── RLS policies on storage.objects for the new bucket ───────────────────
-- Superadmins can insert + delete + read their own staged uploads.
-- (Read is needed when the browser wants to verify upload before posting
--  the path; delete supports operator-side cleanup if a route call fails.)
-- Service-role bypasses RLS so the upload route's download + cleanup is
-- unaffected.

drop policy if exists "policy_uploads_superadmin_insert" on storage.objects;
drop policy if exists "policy_uploads_superadmin_select" on storage.objects;
drop policy if exists "policy_uploads_superadmin_delete" on storage.objects;

create policy "policy_uploads_superadmin_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'policy-uploads' and public.is_superadmin());

create policy "policy_uploads_superadmin_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'policy-uploads' and public.is_superadmin());

create policy "policy_uploads_superadmin_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'policy-uploads' and public.is_superadmin());

commit;
