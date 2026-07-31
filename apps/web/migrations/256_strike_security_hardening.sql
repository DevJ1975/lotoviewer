-- Migration 256: Close the STRIKE answer-key leak and tighten media reads.
--
-- Three independent findings, all verified against the code:
--
-- 1. THE QUIZ ANSWER KEY IS READABLE BY EVERY LEARNER.
--    `strike_answers_read` (migration 114) is a plain row-level `for select
--    to authenticated` policy. Postgres RLS has no column filtering, and no
--    column grant has ever been applied to these tables. The learner page
--    politely selects only id/question_id/answer_text/sort_order, but the
--    browser holds a Supabase client and nothing stops:
--
--      GET /rest/v1/strike_quiz_answers?select=question_id,is_correct
--
--    Question banks, shuffling, retry-incorrect and review mode are all
--    theater until this closes.
--
--    Same treatment for strike_quiz_questions.explanation: explanations
--    routinely read "Correct, because ..." and are therefore a soft copy of
--    the key. It moves into the submit response, which is where feedback
--    belongs anyway (it was previously rendered BEFORE the learner answered).
--
-- 2. `global/` STORAGE OBJECTS LEAK CROSS-TENANT.
--    Migration 223 restricted video extensions under `global/` to
--    superadmins and left `else true` for everything else, so any
--    authenticated user of any tenant can list and download every
--    non-video object under `global/`. That is tolerable for thumbnails
--    and becomes an IP-exfiltration path for the whole Trainovate global
--    library the moment narration audio lands there (migration 260).
--
-- 3. `video_provider` HAS HAD NO CHECK CONSTRAINT SINCE MIGRATION 225.
--    It is NOT NULL DEFAULT 'vimeo' with an unbounded domain, so a typo'd
--    'Vimeo' passes silently. Vimeo is the only supported provider.
--
-- Safe to apply before any code ships: nothing in the app reads the revoked
-- columns from the browser (the one caller that read `explanation` is fixed
-- in the same change), and no audio objects exist yet.
--
-- Idempotent. Re-runs revoke + re-grant to the same final state.

begin;

-- ────────────────────────────────────────────────────────────────────
-- 1. Column grants on the quiz tables
-- ────────────────────────────────────────────────────────────────────
-- PostgREST honours column privileges when serializing rows and refuses
-- requests naming a column the caller can't see, so after this a learner
-- asking for is_correct gets a 401 instead of the key.
--
-- We strip the base grant first and re-grant explicitly, so a column added
-- later is NOT readable until someone deliberately grants it. That is the
-- fail-safe direction and it is why migration 258 must extend these grants
-- when it adds block_key/graded/bank_tag.
--
-- service_role is untouched — supabaseAdmin() does the grading and the
-- authoring writes, and it needs both columns.

revoke select on public.strike_quiz_answers from authenticated, anon;
grant  select (id, question_id, tenant_id, library_scope, answer_text, sort_order, created_at)
  on public.strike_quiz_answers to authenticated;

revoke select on public.strike_quiz_questions from authenticated, anon;
grant  select (id, module_version_id, tenant_id, library_scope, question_type,
               prompt, sort_order, required, points, created_at)
  on public.strike_quiz_questions to authenticated;

comment on column public.strike_quiz_answers.is_correct is
  'ANSWER KEY. Revoked from `authenticated` in migration 256 — readable only by service_role. Grading happens server-side in /api/strike/[moduleId]/submit. Never grant this to a browser-facing role.';
comment on column public.strike_quiz_questions.explanation is
  'Soft copy of the answer key. Revoked from `authenticated` in migration 256 — returned to the learner in the submit response after grading, never before.';

-- ────────────────────────────────────────────────────────────────────
-- 2. storage.objects — audio joins video behind the signed-URL route
-- ────────────────────────────────────────────────────────────────────
-- Same shape as migration 223, with the protected-extension list extended
-- to cover narration audio. Learners reach these through
-- /api/strike/[moduleId]/media, which signs URLs with the service role
-- (bypassing RLS) and writes a strike_media_access audit row.
--
-- Residual, deliberately accepted: captions and thumbnails under `global/`
-- stay readable by any authenticated user, including those belonging to an
-- unpublished draft. Storage paths don't carry publication status, and
-- parsing a version id out of the path to join strike_module_versions is
-- more fragile than the exposure is worth. Revisit if draft thumbnails ever
-- carry sensitive content.

drop policy if exists strike_media_read on storage.objects;
create policy strike_media_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'strike-media'
    and case
      when split_part(name, '/', 1) = 'global' then
        case
          when lower(substring(name from '\.([^./]+)$'))
               in ('mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'opus')
            then public.is_superadmin()
          else true
        end
      when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        case
          when lower(substring(name from '\.([^./]+)$'))
               in ('mp4', 'm4v', 'mov', 'webm', 'mp3', 'm4a', 'm4b', 'aac', 'wav', 'ogg', 'opus')
            then (split_part(name, '/', 1))::uuid in (select public.current_user_admin_tenant_ids())
              or public.is_superadmin()
          else (split_part(name, '/', 1))::uuid in (select public.current_user_tenant_ids())
            or public.is_superadmin()
        end
      else false
    end
  );

-- ────────────────────────────────────────────────────────────────────
-- 3. video_provider domain restored
-- ────────────────────────────────────────────────────────────────────
-- Migration 225 dropped the provider checks when the storage/Cloudflare
-- pipeline was retired and never re-added one for the Vimeo-only world.
-- Existing rows all default to 'vimeo'; the update below normalizes any
-- legacy value so the constraint can be added without a manual cleanup.

update public.strike_module_versions
   set video_provider = 'vimeo'
 where video_provider is distinct from 'vimeo';

alter table public.strike_module_versions
  drop constraint if exists strike_versions_provider_ck;
alter table public.strike_module_versions
  add constraint strike_versions_provider_ck
    check (video_provider = 'vimeo');

-- ────────────────────────────────────────────────────────────────────
-- 4. Label the dead columns (dropped in migration 263, after a soak)
-- ────────────────────────────────────────────────────────────────────
comment on column public.strike_module_versions.video_path is
  'DEAD since migration 225 (Vimeo-only). Nothing reads it. Dropped in 263.';
comment on column public.strike_module_versions.video_ready is
  'DEAD since migration 225. Written for human readability only; nothing reads it. Dropped in 263.';
comment on column public.strike_module_versions.captions_path is
  'Dormant since 225. Retained deliberately: WCAG 1.2.2 needs a caption fallback for tenant-authored video that is not hosted on Vimeo.';

notify pgrst, 'reload schema';

commit;
