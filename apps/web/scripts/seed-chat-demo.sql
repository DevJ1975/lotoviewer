-- Seed chat demo data for the WLS Demo tenant (tenant 0002).
--
-- Not auto-applied. Run manually when prepping a demo and the chat
-- module needs realistic content to click through. Idempotent — re-
-- runs are safe (channel uniqueness on (tenant_id, slug); members on
-- PK; messages guarded by per-channel emptiness; reactions on PK).
--
-- Seeds:
--   - 4 channels: #general, #safety, #field-ops, #compliance
--   - 1 DM between the two demo accounts
--   - ~5 messages per channel (realistic EHS chatter)
--   - 4 reactions across the most representative messages
--
-- Re-run safety: each idempotency guard is on a natural key, so
-- running this multiple times produces no duplicates.
--
-- Apply via Supabase SQL Editor or:
--   psql "$DATABASE_URL" -f apps/web/scripts/seed-chat-demo.sql
--
-- Tenant id is hardcoded — wls-demo lives at
-- ddddbce8-c7ab-4855-8bcd-821d080617ee on the Soteria Main Project.
-- The two member ids are likewise specific to that tenant. If demo
-- ownership changes, update the v_admin / v_member declarations.

do $$
declare
  v_tenant     uuid := 'ddddbce8-c7ab-4855-8bcd-821d080617ee';
  v_admin      uuid := '46eb5c05-cb1d-49d8-ba46-2cbf902fb624';  -- Jamil Jones (admin)
  v_member     uuid := '4442050f-e88e-4a22-b0a2-a085a8e70d0e';  -- Jamil (member)
  v_general    uuid;
  v_safety     uuid;
  v_field      uuid;
  v_compliance uuid;
  v_dm         uuid;
  v_msg        uuid;
begin
  -- ── Channels ───────────────────────────────────────────────────────────
  insert into public.chat_channels (tenant_id, kind, name, slug, description, created_by, created_at)
  values (v_tenant, 'channel', 'General', 'general', 'Company-wide announcements and water cooler', v_admin, now() - interval '6 days')
  on conflict (tenant_id, slug) do nothing;
  select id into v_general from public.chat_channels where tenant_id = v_tenant and slug = 'general';

  insert into public.chat_channels (tenant_id, kind, name, slug, description, created_by, created_at)
  values (v_tenant, 'channel', 'Safety Alerts', 'safety', 'Near-miss reports, hazard alerts, training reminders', v_admin, now() - interval '6 days')
  on conflict (tenant_id, slug) do nothing;
  select id into v_safety from public.chat_channels where tenant_id = v_tenant and slug = 'safety';

  insert into public.chat_channels (tenant_id, kind, name, slug, description, created_by, created_at)
  values (v_tenant, 'channel', 'Field Operations', 'field-ops', 'Day-to-day shop floor coordination', v_admin, now() - interval '5 days')
  on conflict (tenant_id, slug) do nothing;
  select id into v_field from public.chat_channels where tenant_id = v_tenant and slug = 'field-ops';

  insert into public.chat_channels (tenant_id, kind, name, slug, description, created_by, created_at)
  values (v_tenant, 'channel', 'Compliance', 'compliance', 'Audit prep, training certs, regulatory talk', v_admin, now() - interval '5 days')
  on conflict (tenant_id, slug) do nothing;
  select id into v_compliance from public.chat_channels where tenant_id = v_tenant and slug = 'compliance';

  -- DM (no slug, idempotent via membership lookup)
  select c.id into v_dm
    from public.chat_channels c
   where c.tenant_id = v_tenant and c.kind = 'dm'
     and exists (select 1 from public.chat_channel_members where channel_id = c.id and user_id = v_admin)
     and exists (select 1 from public.chat_channel_members where channel_id = c.id and user_id = v_member)
   limit 1;
  if v_dm is null then
    insert into public.chat_channels (tenant_id, kind, name, slug, description, created_by, created_at)
    values (v_tenant, 'dm', null, null, null, v_admin, now() - interval '4 days')
    returning id into v_dm;
  end if;

  -- ── Members ────────────────────────────────────────────────────────────
  insert into public.chat_channel_members (channel_id, user_id, tenant_id, role, joined_at) values
    (v_general,    v_admin,  v_tenant, 'admin',  now() - interval '6 days'),
    (v_general,    v_member, v_tenant, 'member', now() - interval '6 days'),
    (v_safety,     v_admin,  v_tenant, 'admin',  now() - interval '6 days'),
    (v_safety,     v_member, v_tenant, 'member', now() - interval '6 days'),
    (v_field,      v_admin,  v_tenant, 'admin',  now() - interval '5 days'),
    (v_field,      v_member, v_tenant, 'member', now() - interval '5 days'),
    (v_compliance, v_admin,  v_tenant, 'admin',  now() - interval '5 days'),
    (v_compliance, v_member, v_tenant, 'member', now() - interval '5 days'),
    (v_dm,         v_admin,  v_tenant, 'member', now() - interval '4 days'),
    (v_dm,         v_member, v_tenant, 'member', now() - interval '4 days')
  on conflict (channel_id, user_id) do nothing;

  -- ── Messages (only seed if channel is empty) ───────────────────────────
  if not exists (select 1 from public.chat_messages where channel_id = v_general) then
    insert into public.chat_messages (tenant_id, channel_id, author_user_id, body, created_at) values
      (v_tenant, v_general, v_admin,  'Welcome to Soteria FIELD! Use this space for company-wide announcements.', now() - interval '6 days'),
      (v_tenant, v_general, v_member, 'Finally a single place for all the LOTO chatter — thanks 👍', now() - interval '6 days' + interval '12 minutes'),
      (v_tenant, v_general, v_admin,  'TestFlight build going out tomorrow morning — iPad-first. If you don''t see it by 9am, ping me here.', now() - interval '4 days'),
      (v_tenant, v_general, v_admin,  'Reminder: monthly toolbox talk Friday 7am in the breakroom. Topic this week is hand-injury prevention.', now() - interval '2 days'),
      (v_tenant, v_general, v_member, 'Got it — bringing the contractors too.', now() - interval '2 days' + interval '8 minutes');
  end if;

  if not exists (select 1 from public.chat_messages where channel_id = v_safety) then
    insert into public.chat_messages (tenant_id, channel_id, author_user_id, body, created_at) values
      (v_tenant, v_safety, v_admin,  '🚨 Near-miss reported at Bay 14 — pump enclosure missing guard. Contained, fixed by EOD. Logged in /near-miss.', now() - interval '5 days'),
      (v_tenant, v_safety, v_member, 'Saw that — was the lock-out signed off before maintenance started?', now() - interval '5 days' + interval '6 minutes'),
      (v_tenant, v_safety, v_admin,  'Yes, confirmed §1910.147. Adding to next month''s audit review packet.', now() - interval '5 days' + interval '14 minutes'),
      (v_tenant, v_safety, v_member, 'PPE-alone control showed up on the new tank-cleaning JHA. Bumping to engineering control + documenting justification.', now() - interval '3 days'),
      (v_tenant, v_safety, v_admin,  'Good catch. ISO 45001 8.1.2 will reject PPE-alone for confined-space work — the trigger should have flagged it but explicit is better.', now() - interval '3 days' + interval '5 minutes'),
      (v_tenant, v_safety, v_member, 'Confined-space training certs expire next week for two of the contractors. Flagged in /admin/training.', now() - interval '1 day');
  end if;

  if not exists (select 1 from public.chat_messages where channel_id = v_field) then
    insert into public.chat_messages (tenant_id, channel_id, author_user_id, body, created_at) values
      (v_tenant, v_field, v_admin,  'Heads up — generator GEN-04 is offline for maintenance through Thursday. Bay 8 on backup until Friday.', now() - interval '4 days'),
      (v_tenant, v_field, v_member, 'Copy. Routing the 3am shift to Bay 12 instead.', now() - interval '4 days' + interval '11 minutes'),
      (v_tenant, v_field, v_admin,  'Need photos of every isolation point before you sign off — the placards generate from those. Use the camera tab in the app.', now() - interval '4 days' + interval '20 minutes'),
      (v_tenant, v_field, v_member, 'On it. Bay 12 has 6 isolation points, will batch the captures tonight.', now() - interval '4 days' + interval '25 minutes'),
      (v_tenant, v_field, v_admin,  'Snak King demo is 2pm Friday — make sure all open near-misses are triaged before then.', now() - interval '1 day');
  end if;

  if not exists (select 1 from public.chat_messages where channel_id = v_compliance) then
    insert into public.chat_messages (tenant_id, channel_id, author_user_id, body, created_at) values
      (v_tenant, v_compliance, v_admin,  'Q2 audit prep — every open risk needs to be re-reviewed by 2026-06-30. Pull the list from /risk and triage by Friday.', now() - interval '3 days'),
      (v_tenant, v_compliance, v_member, 'Pulling the report now. 14 open, 3 stale (>180 days). Want me to escalate the stale ones to you directly?', now() - interval '3 days' + interval '7 minutes'),
      (v_tenant, v_compliance, v_admin,  'Yes please — can''t walk into the audit with 180-day stragglers. Tag them with the trigger ''external_audit'' so the dashboard groups them.', now() - interval '3 days' + interval '15 minutes'),
      (v_tenant, v_compliance, v_member, 'Done. Two of them are PPE-alone justification gaps. Will sync with safety on those.', now() - interval '2 days');
  end if;

  if not exists (select 1 from public.chat_messages where channel_id = v_dm) then
    insert into public.chat_messages (tenant_id, channel_id, author_user_id, body, created_at) values
      (v_tenant, v_dm, v_admin,  'Quick one — can you grab the SDS for the new degreaser before Thursday''s hot-work permit? I want to make sure the flammability rating is in the chemicals module.', now() - interval '2 days'),
      (v_tenant, v_dm, v_member, 'On it. Should be in /chemicals by EOD.', now() - interval '2 days' + interval '14 minutes'),
      (v_tenant, v_dm, v_admin,  'Thanks 🙏', now() - interval '2 days' + interval '15 minutes');
  end if;

  -- ── Reactions ──────────────────────────────────────────────────────────
  select id into v_msg from public.chat_messages where channel_id = v_safety and author_user_id = v_admin and body ilike '%Bay 14%' limit 1;
  if v_msg is not null then
    insert into public.chat_message_reactions (message_id, user_id, tenant_id, emoji)
    values (v_msg, v_member, v_tenant, '🚨') on conflict (message_id, user_id, emoji) do nothing;
  end if;

  select id into v_msg from public.chat_messages where channel_id = v_field and author_user_id = v_member and body ilike '%Bay 12 has 6%' limit 1;
  if v_msg is not null then
    insert into public.chat_message_reactions (message_id, user_id, tenant_id, emoji)
    values (v_msg, v_admin, v_tenant, '👍') on conflict (message_id, user_id, emoji) do nothing;
  end if;

  select id into v_msg from public.chat_messages where channel_id = v_compliance and author_user_id = v_member and body ilike '%PPE-alone justification%' limit 1;
  if v_msg is not null then
    insert into public.chat_message_reactions (message_id, user_id, tenant_id, emoji)
    values (v_msg, v_admin, v_tenant, '💯') on conflict (message_id, user_id, emoji) do nothing;
  end if;

  select id into v_msg from public.chat_messages where channel_id = v_general and author_user_id = v_admin and body ilike 'Welcome%' limit 1;
  if v_msg is not null then
    insert into public.chat_message_reactions (message_id, user_id, tenant_id, emoji)
    values (v_msg, v_member, v_tenant, '👍') on conflict (message_id, user_id, emoji) do nothing;
  end if;

  raise notice 'chat demo seed complete for tenant %', v_tenant;
end $$;
