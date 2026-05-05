-- Migration 046: support_messages feedback + language columns
--
-- Two small additions to support Phase 4 polish:
--   • Per-assistant-turn helpfulness feedback so we can prioritise KB
--     edits against the answers users actually flagged. Stored on the
--     row itself rather than a side table — feedback is a 1-to-1 with
--     the assistant turn and we don't need history.
--   • Conversation language so the daily digest can break out Spanish
--     vs. English usage and the chat route doesn't have to re-detect on
--     every turn.
--
-- Both columns are nullable; older rows simply have NULLs.

alter table public.support_messages
  add column if not exists helpful    boolean,
  add column if not exists helpful_at timestamptz;

-- Sparse index — only the rows that received explicit feedback. Keeps
-- the index small even if the table grows large.
create index if not exists idx_support_messages_helpful
  on public.support_messages (helpful, helpful_at desc)
  where helpful is not null;

alter table public.support_conversations
  add column if not exists language text;

-- Author-the-row policy: the conversation owner is the only person
-- who can set helpfulness on its assistant rows. Superadmin reads
-- already work via the existing superadmin_read policy. We do NOT
-- expose updates to non-owners (no helpful-vote brigading).
drop policy if exists "support_messages_owner_update_helpful" on public.support_messages;
create policy "support_messages_owner_update_helpful" on public.support_messages
  for update to authenticated
  using (
    exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.support_conversations c
      where c.id = conversation_id and c.user_id = auth.uid()
    )
  );

notify pgrst, 'reload schema';
