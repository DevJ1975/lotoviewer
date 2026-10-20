-- Migration 298: LOTO Coach knowledge base and conversation surface.
--
-- 1. knowledge_source_type gains 'training': plain-language STRIKE
--    training guidance (lib/strike/kb/**), ingested as global documents by
--    /api/superadmin/strike/coach-kb so the LOTO Coach can cite it alongside
--    the 1910 regulation corpus.
--
--    ALTER TYPE ... ADD VALUE stays OUTSIDE the transaction below, as in
--    109: the new value must be committed before anything uses it.
--
-- 2. assistant_conversations gains `surface`, so LOTO Coach threads live
--    beside home-assistant threads without mixing into its history. The
--    coach reuses assistant_conversations / assistant_messages (103) rather
--    than a third copy of the same tables.
--
-- Idempotent.

alter type public.knowledge_source_type add value if not exists 'training';

begin;

alter table public.assistant_conversations
  add column if not exists surface text not null default 'assistant';

alter table public.assistant_conversations drop constraint if exists assistant_conversations_surface_ck;
alter table public.assistant_conversations
  add constraint assistant_conversations_surface_ck check (surface in ('assistant', 'strike_coach'));

create index if not exists assistant_conversations_user_surface_idx
  on public.assistant_conversations (user_id, surface, last_message_at desc);

comment on column public.assistant_conversations.surface is
  'Which AI surface owns the thread: the home assistant or the STRIKE LOTO Coach. Routes filter on it so histories never mix.';

notify pgrst, 'reload schema';

commit;
