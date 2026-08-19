-- Migration 257: Predictive Safety Intelligence — vision hazard sweep +
-- LLM regulatory document drafts.
--
-- Two independent subsystems, one migration because they share the same
-- staging-and-human-accept posture and land together:
--
--   1. The vision hazard sweep reads photos already stored against BBS
--      observations, incident attachments, hot-work permits, and hazwaste
--      inspections, and emits taxonomy-constrained hazard SIGNALS. It never
--      creates an incident and never notifies anyone. A human confirms or
--      dismisses each signal.
--
--   2. document_drafts holds LLM first drafts of regulatory documents (risk
--      assessments, method statements, JSA checklists, incident reports).
--      Accepting a draft happens through the target module's own reviewed
--      write path — nothing here writes those tables.
--
-- FOUR DECISIONS WORTH THE READING TIME
--
-- a) NO PHOTO URL IS STORED. `loto-photos` is a public bucket (migration 005 +
--    125) and `bbs_observations_v2.photo_url` is written by a direct browser
--    PostgREST insert into an unconstrained `text` column. A service-role sweep
--    doing fetch(photo_url) on tenant-controlled input is server-side request
--    forgery. The work row therefore carries a storage KEY, and the engine
--    downloads it with the service role (the storagePhotoSearch.ts pattern).
--    The bucket is fixed and checked, and the key must sit under the tenant's
--    own prefix.
--
-- b) SIGNAL IDENTITY IS CONTENT-ADDRESSED. The natural key is
--    (tenant_id, source_kind, source_id, photo_sha256, hazard_code) — NOT the
--    run. A sweep is resumable and re-runnable, so keying on the run would let
--    one hazard land N times. Content hash rather than URL because storage URLs
--    get cache-busted and swapped in place.
--
-- c) RLS CARRIES THE FACILITY CLAUSE EXPLICITLY. Migration 211 auto-scopes only
--    the generated <table>_tenant_scope policies; hand-written policies are
--    skipped. Copying an older hand-written policy verbatim would leave a
--    signal from one facility readable by a user scoped to another.
--
-- d) `not_assessable` IS A FIRST-CLASS OUTCOME. "We looked and could not tell"
--    is not "clean". An auditor asking what the sweep covered must be able to
--    separate the two, so it is a terminal state on the work row, not a silent
--    zero-findings result.
--
-- Idempotent: guarded with `if not exists`.

begin;

-- ── 1. Sweep runs ─────────────────────────────────────────────────────────
-- One row per sweep. The nightly cron OPENS a run and enqueues work; a
-- separate resume cron drains it across as many invocations as it takes. Same
-- shape as loto_audit_runs, for the same reason: the serverless function
-- ceiling is 300s and a tenant's photo backlog is not bounded by it.
create table if not exists public.vision_sweep_runs (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  facility_id    uuid        references public.facilities(id) on delete set null,

  status         text        not null default 'running'
                   check (status in ('running','completed','failed','canceled')),
  -- Only photos newer than this were enqueued. Carried forward from the prior
  -- successful run so a nightly sweep re-reads nothing.
  since          timestamptz not null,

  photos_queued  int         not null default 0,
  photos_done    int         not null default 0,
  photos_skipped int         not null default 0,
  signals_found  int         not null default 0,
  -- Findings the deterministic gate threw away, by reason. A run discarding
  -- most of what the model proposed is a prompt bug, and that is only visible
  -- if the counts survive.
  gate_rejections jsonb      not null default '{}'::jsonb,

  -- Token spend for this run. Sweep calls are made by a cron with no human
  -- behind them, and ai_invocations.user_id is `uuid not null references
  -- auth.users` — there is no honest value to put there. Rather than fabricate
  -- a user or silently drop the row (logAiInvocation swallows insert failures),
  -- cron-driven spend is accumulated here where it stays visible. A run a
  -- person triggered still logs to ai_invocations under their id.
  input_tokens   bigint      not null default 0,
  output_tokens  bigint      not null default 0,

  model          text        not null,
  last_error     text,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  created_by     uuid        references auth.users(id)
);

create index if not exists idx_vision_sweep_runs_tenant
  on public.vision_sweep_runs(tenant_id, started_at desc);
create index if not exists idx_vision_sweep_runs_status
  on public.vision_sweep_runs(status, started_at);

alter table public.vision_sweep_runs enable row level security;

drop policy if exists vision_sweep_runs_tenant_scope on public.vision_sweep_runs;
create policy vision_sweep_runs_tenant_scope on public.vision_sweep_runs
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── 2. Claimable work rows ────────────────────────────────────────────────
-- One row per photo to examine. State is the concurrency control: a worker
-- claims by transitioning queued → claimed in a single conditional update, so
-- two overlapping resume ticks cannot process the same photo.
--
-- storage_bucket + storage_key, never a URL — see decision (a) in the header.
create table if not exists public.vision_sweep_photos (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  run_id         uuid        not null references public.vision_sweep_runs(id) on delete cascade,
  facility_id    uuid        references public.facilities(id) on delete set null,

  source_kind    text        not null check (source_kind in (
                   'bbs_observation','incident_attachment','hot_work_permit','hazwaste_inspection')),
  -- Polymorphic by design: four unrelated parents, and a nullable FK per kind
  -- would be four columns that must stay mutually exclusive. The trade is no
  -- referential integrity, so the engine re-reads the parent before use and
  -- the orphan sweep in the resume cron clears rows whose parent is gone.
  source_id      uuid        not null,

  storage_bucket text        not null,
  storage_key    text        not null,

  state          text        not null default 'queued'
                   check (state in ('queued','claimed','done','not_assessable','failed')),
  claimed_at     timestamptz,
  attempts       int         not null default 0,
  last_error     text,

  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

-- One work row per photo per run. A re-enqueue of the same photo inside one run
-- is a bug, not a retry — retries bump `attempts` on the existing row.
create unique index if not exists uq_vision_sweep_photos_run_source
  on public.vision_sweep_photos(run_id, source_kind, source_id, storage_key);
-- The claim query: oldest queued rows for a run.
create index if not exists idx_vision_sweep_photos_claimable
  on public.vision_sweep_photos(run_id, state, created_at);
create index if not exists idx_vision_sweep_photos_tenant
  on public.vision_sweep_photos(tenant_id);
-- Stall detection: rows claimed but never finished.
create index if not exists idx_vision_sweep_photos_stalled
  on public.vision_sweep_photos(state, claimed_at);

alter table public.vision_sweep_photos enable row level security;

drop policy if exists vision_sweep_photos_tenant_scope on public.vision_sweep_photos;
create policy vision_sweep_photos_tenant_scope on public.vision_sweep_photos
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── 3. Hazard signals ─────────────────────────────────────────────────────
-- What the sweep found, after the deterministic gate. Advisory only: a signal
-- is never an incident, never a clearance, and does not feed the incident-risk
-- score until per-code precision has been measured against a gold set.
create table if not exists public.vision_hazard_signals (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  facility_id    uuid        references public.facilities(id) on delete set null,
  -- Provenance, not identity — see decision (b) in the header.
  run_id         uuid        references public.vision_sweep_runs(id) on delete set null,

  source_kind    text        not null check (source_kind in (
                   'bbs_observation','incident_attachment','hot_work_permit','hazwaste_inspection')),
  source_id      uuid        not null,
  -- sha256 of the image bytes. The photo itself is NOT copied here; the
  -- reviewer reaches it through the source record, which carries its own RLS.
  photo_sha256   text        not null check (photo_sha256 ~ '^[0-9a-f]{64}$'),

  hazard_code    text        not null check (hazard_code in (
                   'ppe_head','ppe_eye','ppe_hand','ppe_foot','ppe_hi_vis','ppe_fall_arrest',
                   'guard_removed','egress_blocked','housekeeping','spill_leak',
                   'damaged_equipment','signage_missing','electrical_exposed',
                   'working_at_height_unprotected')),
  -- Ordinal, matching the LOTO audit's vision agents. Deliberately not a
  -- numeric probability: a self-reported 0..1 from an LLM is not calibrated,
  -- so a threshold on it means something different for every hazard class.
  confidence     text        not null check (confidence in ('high','medium','low')),
  -- The model's one-line justification, capped and whitespace-collapsed by the
  -- core sanitizer. Partly originates in the photo (signage, labels), so it is
  -- untrusted display-only text and is never re-fed to another prompt.
  evidence       text        not null default '' check (length(evidence) <= 240),
  severity_weight int        not null default 1 check (severity_weight between 1 and 3),

  status         text        not null default 'pending'
                   check (status in ('pending','confirmed','dismissed')),
  reviewed_by    uuid        references auth.users(id),
  reviewed_at    timestamptz,
  review_note    text,

  model          text        not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The natural key. Makes the sweep idempotent across resumes and re-runs: the
-- same hazard in the same photo is one row forever, however many times it is
-- seen. Without this a resume double-counts.
create unique index if not exists uq_vision_hazard_signals_identity
  on public.vision_hazard_signals(tenant_id, source_kind, source_id, photo_sha256, hazard_code);
create index if not exists idx_vision_hazard_signals_review_queue
  on public.vision_hazard_signals(tenant_id, status, created_at desc);
create index if not exists idx_vision_hazard_signals_facility
  on public.vision_hazard_signals(facility_id);
create index if not exists idx_vision_hazard_signals_run
  on public.vision_hazard_signals(run_id);

drop trigger if exists trg_vision_hazard_signals_touch on public.vision_hazard_signals;
create trigger trg_vision_hazard_signals_touch
  before update on public.vision_hazard_signals
  for each row
  execute function public.touch_updated_at();

alter table public.vision_hazard_signals enable row level security;

drop policy if exists vision_hazard_signals_tenant_scope on public.vision_hazard_signals;
create policy vision_hazard_signals_tenant_scope on public.vision_hazard_signals
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

-- ── 4. Document drafts ────────────────────────────────────────────────────
-- LLM first drafts, staged for human review. Accepting one writes to the
-- target module through its own reviewed POST — accepted_entity_id records
-- where it landed so a draft and its live record can be reconciled.
create table if not exists public.document_drafts (
  id             uuid        primary key default gen_random_uuid(),
  tenant_id      uuid        not null references public.tenants(id) on delete cascade,
  facility_id    uuid        references public.facilities(id) on delete set null,

  kind           text        not null check (kind in (
                   'risk_assessment','method_statement','jsa_checklist','incident_report')),
  title          text        not null check (length(btrim(title)) between 1 and 300),
  -- Required, never inferred by the model: a Cal/OSHA method statement and a
  -- UK RAMS are different documents with different mandatory sections.
  jurisdiction   text        not null check (length(btrim(jurisdiction)) > 0),

  -- The draft body. Typed by validateDraftPayload() in @soteria/core on read
  -- as well as write — a draft written by an older prompt version is still in
  -- this table when the format moves, and a reviewer opening it must get a
  -- clear explanation rather than a half-rendered document.
  payload        jsonb       not null,
  payload_version int        not null default 1,

  -- Retrieved knowledge chunks the draft was grounded on. Every citation in
  -- the payload resolves to one of these; anything else was stripped before a
  -- human saw it. Empty array means the draft is ungrounded, which the
  -- reviewer is told explicitly.
  citation_chunk_ids uuid[]  not null default '{}',
  -- Citations the model claimed that did not resolve. Surfaced to the reviewer
  -- rather than swallowed: a reader who knows the model invented two
  -- references reads the rest differently.
  fabricated_citation_count int not null default 0 check (fabricated_citation_count >= 0),

  status         text        not null default 'draft'
                   check (status in ('draft','accepted','discarded')),
  -- Set when a human accepts; points at the row created in the target module.
  accepted_entity_id uuid,
  accepted_by    uuid        references auth.users(id),
  accepted_at    timestamptz,
  -- True when the reviewer changed the draft before accepting. Mirrors the
  -- ai_origin / ai_edited pair on the ECFA and RCA tables.
  ai_edited      boolean     not null default false,

  model          text        not null,
  prompt_version text        not null default 'v1',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid        references auth.users(id)
);

create index if not exists idx_document_drafts_queue
  on public.document_drafts(tenant_id, status, created_at desc);
create index if not exists idx_document_drafts_kind
  on public.document_drafts(tenant_id, kind, created_at desc);
create index if not exists idx_document_drafts_facility
  on public.document_drafts(facility_id);

drop trigger if exists trg_document_drafts_touch on public.document_drafts;
create trigger trg_document_drafts_touch
  before update on public.document_drafts
  for each row
  execute function public.touch_updated_at();

alter table public.document_drafts enable row level security;

drop policy if exists document_drafts_tenant_scope on public.document_drafts;
create policy document_drafts_tenant_scope on public.document_drafts
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  )
  with check (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
  );

notify pgrst, 'reload schema';

commit;
