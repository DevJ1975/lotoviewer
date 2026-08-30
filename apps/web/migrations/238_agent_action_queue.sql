-- Migration 238: Operator Console — the agent action approval queue (Slice 5).
--
-- The Operator Console lets an AI agent operate the SaaS hands-free, with one
-- exception: the regulated, life-safety carve-outs in
-- @soteria/core/operatorActions (LOTO zero-energy certification, confined-space
-- & hot-work authorization, OSHA 300A certification + ITA submission, high-
-- severity CAPA closure) may NEVER be finalized by the agent. The agent does the
-- prep, then STAGES the action here; a named, qualified human applies it with one
-- tap (or rejects it). A reversible applied action can later be rolled back.
--
-- This table is the ledger for that lifecycle. Writes go through the engine
-- service (apps/web/lib/ai/operator/actionQueue.ts) on the admin client, which
-- re-proves the actor holds the action's authorizing role before anything takes
-- effect — the RLS policies below exist for triage + future client-direct reads,
-- mirroring operator_conversations (migration 237).
--
-- Lifecycle (see canTransition in @soteria/core/operatorActions):
--   pending  → applied      a qualified human approved; the mutation ran
--   pending  → rejected     a qualified human declined (rejection_reason set)
--   applied  → rolled_back  a reversible applied action was reversed
--
-- Idempotent (if not exists / drop ... if exists).

begin;

create table if not exists public.agent_action_queue (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  -- The operator conversation that staged this action, for traceability back to
  -- the transcript. Null-on-delete so a staged action outlives its chat.
  conversation_id   uuid references public.operator_conversations(id) on delete set null,
  -- The regulated action, from @soteria/core CARVE_OUT_ACTIONS. Constrained so a
  -- typo or a removed action can never be staged.
  action            text not null check (action in (
                      'loto_zero_energy_cert','permit_confined_space_auth','permit_hot_work_auth',
                      'osha_300a_cert','osha_ita_submit','capa_high_severity_close')),
  status            text not null default 'pending' check (status in (
                      'pending','applied','rejected','rolled_back')),
  -- Snapshot of the action's spec at stage time (from CARVE_OUT_ACTIONS) so the
  -- queue stays self-describing even if the registry later changes: who may
  -- approve, and whether an applied action can be undone.
  authorizing_role  text not null check (authorizing_role in ('admin','owner')),
  reversible        boolean not null,
  -- The validated tool input the apply step replays (e.g. { "permit_id": "..." }).
  payload           jsonb not null default '{}'::jsonb,
  -- One-line human summary rendered on the approval card.
  summary           text not null check (length(summary) between 1 and 500),
  -- Who the agent staged this for (the operator user). The approver is a separate
  -- column so the audit trail never conflates the request with the approval.
  requested_by      uuid not null references public.profiles(id) on delete restrict,
  requested_at      timestamptz not null default now(),
  -- The human who applied or rejected it, and when.
  decided_by        uuid references public.profiles(id) on delete restrict,
  decided_at        timestamptz,
  rejection_reason  text,
  -- The applier's output: { summary, prevState }. prevState is the exact prior
  -- state a rollback restores. Null until applied.
  apply_result      jsonb,
  rolled_back_by    uuid references public.profiles(id) on delete restrict,
  rolled_back_at    timestamptz,
  -- Last apply/rollback failure detail, for triage. Cleared on success.
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- ── Status / stamp consistency — keep the ledger honest at the boundary ────
  constraint agent_action_rejected_has_reason
    check (status <> 'rejected' or rejection_reason is not null),
  constraint agent_action_decided_has_actor
    check (status not in ('applied','rejected') or (decided_by is not null and decided_at is not null)),
  constraint agent_action_applied_has_result
    check (status <> 'applied' or apply_result is not null),
  constraint agent_action_rolledback_has_actor
    check (status <> 'rolled_back' or (rolled_back_by is not null and rolled_back_at is not null)),
  -- A rolled-back action must have been reversible in the first place.
  constraint agent_action_rollback_reversible
    check (status <> 'rolled_back' or reversible)
);

-- The approval inbox: pending actions for a tenant, newest first.
create index if not exists idx_agent_action_queue_pending
  on public.agent_action_queue (tenant_id, requested_at desc)
  where status = 'pending';

-- The full queue view (history + status filters).
create index if not exists idx_agent_action_queue_tenant_status
  on public.agent_action_queue (tenant_id, status, requested_at desc);

comment on table public.agent_action_queue is
  'Staged regulated carve-out actions awaiting one-tap human approval. The agent stages; a qualified human applies or rejects. Never hard-delete — this is the authorization audit trail.';

-- ── updated_at touch ────────────────────────────────────────────────────────
-- Self-contained so the column is trustworthy even for writes that bypass the
-- engine service.
create or replace function public.agent_action_queue_touch()
  returns trigger
  language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_agent_action_queue_touch on public.agent_action_queue;
create trigger trg_agent_action_queue_touch
  before update on public.agent_action_queue
  for each row execute function public.agent_action_queue_touch();

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- The engine writes via supabaseAdmin (RLS bypassed); these read policies exist
-- for triage + any future client-direct reads, mirroring migration 237.
alter table public.agent_action_queue enable row level security;

drop policy if exists "agent_action_queue_requester_read"  on public.agent_action_queue;
drop policy if exists "agent_action_queue_authorizer_read" on public.agent_action_queue;
drop policy if exists "agent_action_queue_superadmin_read" on public.agent_action_queue;

-- The operator who staged an action can see it.
create policy "agent_action_queue_requester_read" on public.agent_action_queue
  for select to authenticated
  using (requested_by = auth.uid());

-- Tenant owner/admins see the whole tenant queue — the approver inbox.
create policy "agent_action_queue_authorizer_read" on public.agent_action_queue
  for select to authenticated
  using (
    tenant_id in (select public.current_user_tenant_ids())
    and exists (
      select 1 from public.tenant_memberships m
      where m.user_id = auth.uid()
        and m.tenant_id = agent_action_queue.tenant_id
        and m.role in ('owner','admin')
    )
  );

create policy "agent_action_queue_superadmin_read" on public.agent_action_queue
  for select to authenticated
  using (public.is_superadmin());

notify pgrst, 'reload schema';

commit;
