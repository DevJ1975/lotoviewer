-- Migration 245: supporting indexes for the cross-module risk gather + windowed scorecard fetches.
--
-- The v2.0.0 incident-risk model (incidentRiskFeatures.ts) now reads leading
-- signal from inspections, BBS-v2 follow-ups, permits, and ECFA causal factors
-- in a recent 90-day window, and the scorecard is moving toward server-side
-- windowing. These indexes keep those tenant-scoped, date-windowed reads off
-- sequential scans as tenants accumulate history. Mirrors the scale-hardening
-- sweep in migration 241.
--
-- Idempotent: every statement is `create index if not exists`. Additive only —
-- no table/column/policy changes.

begin;

-- Inspections fail-rate over the recent window (tenant + date).
create index if not exists idx_inspections_tenant_created
  on public.inspections (tenant_id, created_at);

-- Open (required, not-completed) BBS-v2 follow-ups — a small hot subset, so a
-- partial index keeps it tiny and the overdue scan index-only.
create index if not exists idx_bbs_v2_open_followups
  on public.bbs_observations_v2 (tenant_id, created_at)
  where follow_up_required and follow_up_completed_at is null;

-- Permits started in the recent window (expired-without-close-out scan).
create index if not exists idx_cs_permits_tenant_started
  on public.loto_confined_space_permits (tenant_id, started_at);
create index if not exists idx_hw_permits_tenant_started
  on public.loto_hot_work_permits (tenant_id, started_at);

-- ECFA causal factors flagged in the recent window (weak-control share).
create index if not exists idx_ecfa_nodes_causal_recent
  on public.incident_ecfa_nodes (tenant_id, created_at)
  where is_causal_factor;

commit;
