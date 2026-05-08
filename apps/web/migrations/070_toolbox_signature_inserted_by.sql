-- Migration 070: toolbox_talk_signatures.inserted_by — closes audit
-- gap surfaced in the second devjr pass.
--
-- The original schema (migration 069) recorded signer_user_id as
-- the foreign key into auth.users for self-signs and NULL for
-- coworker signs. Combined with signed_ip, that's enough to
-- distinguish "alice signed for herself" from "someone on alice's
-- network signed in as Bob," but not enough to tell WHICH
-- authenticated session was holding the tablet.
--
-- Real-world dispute scenario:
--   "There's a fake name on the toolbox-talk roster — who put it
--    there?"
--
-- Without this column we'd answer "an unspecified user from IP X
-- at time Y." With it: "user uuid-...-X at time Y." That's the
-- minimum needed to close the loop on a roster dispute.
--
-- The column is nullable to preserve compatibility with any rows
-- that may have been inserted between migration 069 and 070, but
-- the application code (the /sign API) always populates it from
-- gate.userId for both self and coworker inserts going forward.

begin;

alter table public.toolbox_talk_signatures
  add column if not exists inserted_by uuid references auth.users(id);

create index if not exists idx_toolbox_signatures_inserted_by
  on public.toolbox_talk_signatures(inserted_by)
  where inserted_by is not null;

comment on column public.toolbox_talk_signatures.inserted_by is
  'auth.uid of the session that POSTed the sign-in. For self-signs '
  'this equals signer_user_id; for coworker signs (signer_user_id '
  'IS NULL) this is the supervisor whose tablet captured the '
  'signature. Used by audit/dispute investigations.';

notify pgrst, 'reload schema';

commit;
