-- Migration 213: restricted `medical-records` storage bucket (PHI).
--
-- Migration 201 added incident_medical_documents (file metadata) and noted the
-- medical files themselves live in a RESTRICTED `medical-records` bucket,
-- "created via the Supabase dashboard". This migration creates that bucket in
-- SQL instead, so it is reproducible across environments (staging, branch
-- databases) rather than a hand-made, prod-only artifact.
--
-- POSTURE — private + default-deny:
--   * public = false — no object is reachable via a public URL; every read is
--     an RLS-checked request or a short-lived signed URL.
--   * NO storage.objects policies are added. storage.objects has RLS enabled
--     and every existing policy is scoped to a specific bucket_id, so a bucket
--     with no matching policy is default-deny for both `authenticated` and
--     `anon`. The only accessor is the service-role client, which bypasses RLS
--     — the same path migration 201's care API already uses for PHI. Reads are
--     served via signed URLs minted server-side after can_view_care_phi() has
--     authorized the caller.
--
-- This is deliberately stricter than the tenant-wide storage policies on the
-- non-PHI buckets (fleet-docs 202, loto-photos 033): medical files never need
-- direct authenticated bucket access, so none is granted. If a future feature
-- needs it, add can_view_care_phi()-gated policies (parsing the incident_id
-- from the 2nd path segment) at that point — not speculatively now.
--
-- Path convention (migration 201): {tenant_id}/{incident_id}/{uuid}.{ext}
--
-- Idempotent.

begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'medical-records',
  'medical-records',
  false,
  26214400,  -- 25 MB
  array['image/jpeg','image/png','image/webp','image/heic','application/pdf']::text[]
)
on conflict (id) do update set
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types,
  public             = excluded.public;

commit;
