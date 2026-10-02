# Phase 1 plan: registers and compliance evaluation

- **Status:** Proposed. Awaiting the product owner's "go" before any application code or migration file is written.
- **Branch:** `feat/ems-phase1-registers`, stacked on `feat/ems-phase0-scaffold`.
- **Contract:** [EMS_IMPLEMENTATION_PLAN.md](./EMS_IMPLEMENTATION_PLAN.md), "Phase 1" and Lessons L1–L7, as adapted by [ADR 0001](./adr/0001-build-on-the-existing-environmental-module.md).
- **Ground truth:** [00-repo-map.md](./00-repo-map.md).

**Goal (acceptance):** an auditor opens `/environmental` and, within three clicks, sees three things:

- a dated aspects register with operating-condition coverage;
- a dated compliance-obligations register;
- the last evaluation result for each obligation, with its evidence.

Phase 1 mostly extends records that already exist: aspects (migration 204) and the compliance calendar (migration 192). The wholly new pieces are:

- context issues, interested parties, scope and policy;
- scoring methods;
- compliance evaluations;
- the evidence store.

---

## 1. Decisions this plan makes

Replying "go" accepts every row below. To change one, reply "go, but D4: …".

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | **Per-condition aspect scores.** Today an aspect has one `operating_condition` and a significance score computed in generated columns (5×5 scale, ≥12, hard-coded). | Add a score-history table, `environmental_aspect_scores`, with one row per scoring of one condition. Work out the score in a view from the scoring method, rather than storing it. | The plan requires normal, abnormal and emergency scoring (Lesson L4) with the method stored alongside the score. A computed score can't be forged by a client or drift from its method. |
| D2 | **Retire the legacy single-condition columns** | Expand, then contract. Migrations 295–300 add the new shapes and backfill one score per existing aspect, all **before** the deploy. Migration 301 drops the old columns **after** the deploy. It also scores any aspect created in between and rewrites the WLS demo seed function to write scores. | Five readers use the old columns today: the aspects, objectives and hub pages, the readiness signals, and the WLS seed. The two-step order keeps every one of them working at each step. |
| D3 | **Scoring method** | New table `ms_scoring_methods`. Each tenant gets one default method, "Severity × likelihood (5×5)" with threshold 12, matching today's behavior exactly. A method can't be changed once a score uses it; a new version is a new row. **No method editor in Phase 1.** | Keeps every existing aspect's significance exactly as it is today. The editor waits until someone needs a second matrix. |
| D4 | **Obligations register** | Extend `compliance_calendar_obligations` (ADR Q3) with the register fields. Its deadline fields (`cadence`, `next_due_at`) keep meaning "when it is due". A separate `evaluation_cadence_days` means "how often we check that we comply". | Two different questions, deliberately kept apart. The admin calendar page keeps working unchanged. |
| D5 | **Evaluation task.** There is no generic task model in the repo (repo map §4). | The task is an `ms_compliance_evaluations` row with `scheduled_for` and `assigned_to`. The nightly job creates it, and closing it means recording a result. The database refuses to complete it without evidence (a trigger), and allows only one open evaluation per obligation (a unique index). | Avoids inventing a task model. The evaluation record itself is the to-do. |
| D6 | **Noncompliant result** | Opens a `nonconformities` row (`source_type = 'compliance'`), linked from the evaluation. Phase 6 then grows nonconformities into the full CAPA workflow (ADR Q4). | Better than the plan's "store capa_id as null and write a TODO". The CAPA sink already exists. |
| D7 | **Evidence store** | New append-only table, `ms_evidence`, plus a new private bucket, `ms-evidence`, with no client storage policies, so only the server can reach it. Uploads go through a route that computes SHA-256 on the server. Downloads go through a route that re-hashes the file and refuses it on a mismatch. | Meets the plan's evidence-integrity and "hash verified on download" guardrails. `loto-photos` is public, so it is not suitable (repo map §4). |
| D8 | **Who writes registers** | Members can read; tenant **admins** write, enforced by RLS (`current_user_admin_tenant_ids()`) and by the route gate. Two exceptions: the assigned evaluator can complete their own evaluation, and evidence rows are written only by the server. | Matches today's admin-only aspects page. Writing through the user's own client keeps the audit trigger's actor. |
| D9 | **Calendar access** | Tighten `compliance_calendar_obligations` and `compliance_calendar_events` to member-read, admin-write, and add the facility predicate that migration 211 skipped. Events also get the audit trigger they lack. | Today any member, viewers included, can write these rows directly through PostgREST (only the API demands admin). They become legal-register records in this phase. |
| D10 | **Facility scoping** (ADR consequence) | Add `facility_id` to every EMS table from migrations 204–207, with the facility RLS predicate:<br>• **Aspects, objectives, nonconformities:** scoped to one facility, defaulting to the active facility. Existing rows are backfilled to the primary facility.<br>• **Management reviews, clause pins, and the new org-level records** (context, parties, scope, policy, methods): nullable, where null means "whole organization". | Aspects are facts about a site. A tenant with several facilities will now see each site's aspects under that site. |
| D11 | **Aspect lifecycle** | A required pair, `obsolete_at` + `obsolete_reason`, replaces deletion in the UI. Retired aspects stay in history and leave the active view. The existing `status` column (identified, controlled, monitored, closed) stays as the control status. | Lesson L4: obsolete rows must keep their history. |
| D12 | **Review dates** | Each register row gets `last_reviewed_at`, `reviewed_by` and a required `next_review_due`. Existing rows are backfilled as never reviewed, with the first review due one year after creation. **I don't invent review records.** Default cadence: 365 days. | The auditor's first check is "dated". Backfilling fake review dates would hide exactly what the register exists to show. |
| D13 | **Readiness report card** | Rewire it to the new records:<br>• 4.1 context issues; 5.2 the policy record (no longer gated on the absent documents register)<br>• 6.1.2 active aspects with condition coverage; 6.1.3 obligations-register health<br>• 9.1.2 the newest completed evaluation<br>• Add clauses 4.2 (interested parties) and 4.3 (scope). | The card should credit what Phase 1 builds. Clauses 4.2 and 4.3 now have records to assess. |
| D14 | **Mobile** | A read-only "Environmental aspects" screen, reached from a card on the Home tab (not a new tab). It is shown only when `isModuleVisible('environmental', tenant.modules)` is true. This is the app's first flag-aware code. | Meets the plan's supervisor walk-down lookup without restructuring the mobile tabs. |
| D15 | **Database tests** | Add `@electric-sql/pglite` (real Postgres in WebAssembly) as a web **devDependency**. It runs the Phase 1 migrations, rollbacks, triggers, views and key RLS policies in Vitest, in CI. | The plan's DoD requires tested down-migrations. Phase 0 proved the approach: 23 checks plus a mutation check. This is the only new dependency proposed. |

## 2. Open questions

These have no safe default, so please answer them, or reply "go" to take my lean.

- **Q1. Climate change (Amendment 1:2024).** My lean: the context register shows amber until the tenant records at least one `climate`-kind issue. That is the "climate change determination" the amendment requires.
- **Q2. Evidence file types.** My lean: PDF, JPEG, PNG and WebP. Each can be verified by its magic bytes, the same way `apps/web/lib/security/magicBytes.ts` verifies them today. CSV, XLSX and DOCX (lab spreadsheets, letters) would wait for a follow-up. Should they be allowed now?
- **Q3. Discipline of existing calendar rows.** My lean, for the new `discipline` column:
  - system rows `osha-300a-post` and `osha-ita-submit` → `ohs`
  - `epcra-tier-ii` → `ems`
  - every tenant-created row → `integrated` (shown in both registers)
- **Q4. Deleting an evaluated obligation.** My lean: refuse. The foreign key uses `no action` (so a tenant's cascade delete still works), and the calendar's existing DELETE route then answers 409 with "dismiss it instead". Evaluations are compliance records.

---

## 3. Files

### Migrations (`apps/web/migrations/`)

Each numbered migration ships with an `NNN_rollback.sql`. Nothing is applied by me. **Order:** apply 295–300 before the deploy, and 301 after it.

| File | When | What |
| --- | --- | --- |
| `295_ms_context_scope_policy.sql` | before deploy | `ms_context_issues`, `ms_interested_parties`, `ms_scope_statements`, `ms_policies` |
| `296_ms_scoring_methods.sql` | before deploy | `ms_scoring_methods`, `ms_method_score()`, and a default method for every tenant that has aspects |
| `297_environmental_aspects_register.sql` | before deploy | Aspect columns (`process_area`, obsolete pair, review dates, `facility_id`); `environmental_aspect_scores` plus its history and current views; `environmental_aspect_obligations`; backfill of one score per aspect |
| `298_compliance_obligations_register.sql` | before deploy | Calendar register columns; tighter RLS; events audit trigger; `ms_compliance_evaluations` |
| `299_ms_evidence.sql` | before deploy | `ms_evidence`, the evidence-on-completion trigger, and the private `ms-evidence` bucket |
| `300_ems_facility_scope.sql` | before deploy | `facility_id` and the facility RLS predicate on objectives, nonconformities, management reviews and clause pins |
| `301_environmental_aspects_contract.sql` | **after** deploy | Score any aspect created in the gap; replace `seed_wls_iso14001_demo()`; drop the legacy single-condition columns; aspects RLS becomes member-read and admin-write |

### Shared domain logic (`packages/core/src/`)

- `environmentalAspect.ts` (extend): `scoreAspect`, `aspectCompleteness`, `currentScoresByCondition`, `validateAspectInput`, `validateAspectScoreInput`.
- `scoringMethod.ts` (new): `ScoringMethod`, `DEFAULT_SCORING_METHOD`, `validateScoringMethod`.
- `managementSystem.ts` (extend): `nextReviewDue`, `policyIsComplete`, `REQUIRED_POLICY_COMMITMENTS`, `policySignatoryStale`, `contextRegisterHealth`.
- `complianceEvaluation.ts` (new): `EVALUATION_RESULTS`, `evaluationsToSchedule`, `evaluationCompletionGaps`, `validateObligationRegisterInput`, `parseJurisdiction`.
- `iso14001.ts`, `iso14001Readiness.ts` (extend): new clauses 4.2 and 4.3, new source tables, and the 5.2 rule now reads the policy record.
- **Tests:** `src/__tests__/environmentalAspect.test.ts`, `scoringMethod.test.ts`, `managementSystem.test.ts` (extend), `complianceEvaluation.test.ts`, `iso14001Readiness.test.ts` (extend; the WLS demo story still holds).

### API routes (`apps/web/app/api/`)

All new routes gate with `requireTenantModuleMember(req, 'environmental')`. Writes add an admin check through a new `requireTenantModuleAdmin` in `apps/web/lib/auth/tenantGate.ts`.

| Route | Methods | Notes |
| --- | --- | --- |
| `environmental/aspects` | GET, POST | Filters: `status` (active/obsolete), `process_area`, `significant`, `review_due`. POST stamps the gate facility; with no facility selected it answers 400 "Select a facility". |
| `environmental/aspects/[id]` | GET, PATCH | PATCH takes an allow-list of fields. The scoring fields are not patchable. |
| `environmental/aspects/[id]/scores` | POST | Requires `operating_condition`, `severity`, `likelihood` and `rationale`. The score comes back from the view, never from the client. |
| `environmental/aspects/[id]/obsolete` | POST | Requires a reason. Sets the obsolete pair. |
| `environmental/aspects/[id]/review` | POST | Stamps the review and advances `next_review_due`. |
| `environmental/aspects/[id]/obligations` | PUT | Replaces the set of linked obligations. |
| `environmental/obligations` | GET, POST | The register view of the calendar, filtered to discipline `ems` or `integrated`. Rows include the latest evaluation. |
| `environmental/obligations/[id]` | GET, PATCH | Register fields. |
| `environmental/obligations/[id]/review` | POST | As for aspects. |
| `environmental/obligations/[id]/evaluations` | GET, POST | POST either completes the open scheduled evaluation or creates and completes a manual one. A noncompliant result opens a nonconformity (D6). |
| `environmental/evidence` | POST | Multipart upload: size and type allow-list, magic-byte check, server SHA-256, private bucket, `ms_evidence` row. |
| `environmental/evidence/[id]/download` | GET | Re-hashes the stored bytes and streams the file. A mismatch answers 409 and is reported to Sentry. |
| `environmental/context-issues`, `.../[id]` | GET, POST, PATCH | Retire = the retired pair. |
| `environmental/interested-parties`, `.../[id]` | GET, POST, PATCH | Optional link to an obligation. |
| `environmental/scope` | GET, POST | POST adds a new version; versions are never edited. |
| `environmental/policy` | GET, POST | POST adds a new version and answers 422 unless `policyIsComplete`. |
| `environmental/registers/health` | GET | Health of context, scope and policy, aspects, and obligations, in one call. |
| `cron/compliance-evaluations` | GET, POST | Nightly. Schedules due evaluations and emails the owners. |

Supporting files:

- `apps/web/lib/email/sendComplianceEvaluationDue.ts`, using the `reminders` suppression category.
- `apps/web/vercel.json`: a cron entry, `30 13 * * *`.
- `apps/web/app/api/superadmin/run-cron/route.ts`: add the new cron to `ALLOWED_PATHS`.
- `apps/web/app/api/compliance/obligations/[id]/route.ts`: DELETE maps the foreign-key refusal (`23503`) to 409, "This obligation has evaluations on record; dismiss it instead" (Q4).

### Web UI (`apps/web/app/environmental/`)

| Page | What |
| --- | --- |
| `aspects/page.tsx` (rewrite) | **Health strip.** **Table:** aspect, process area, N/A/E coverage chips, highest current score, significant badge, last reviewed, next due. **Filters** (process area, significant, review due, obsolete). **Row sheet** (`components/ui/sheet`): scoring history, linked obligations, actions (score a condition, review, mark obsolete). **CSV import** with a downloadable template, following the `risk/import` pattern, one row per POST. |
| `obligations/page.tsx` (new) | **Health strip.** **Table:** title, source kind, citation, jurisdiction, owner, last result, next evaluation due. **Sheet:** applicability rationale, linked aspects, evaluation history with evidence links, an evaluate form with upload. |
| `context/page.tsx` (new) | Three tabs: issues, interested parties, scope and policy. The policy form refuses to save until all three Clause 5.2 commitments are ticked, and explains why in one sentence. Health strip. |
| `page.tsx` (hub) | Adds Obligations and Context cards. Counts move to the new views. |
| `objectives/page.tsx` | Reads significance from the current-scores view. |
| `_components/RegisterHealthStrip.tsx`, `_components/TermTooltip.tsx` | Shared pieces. Each term (aspect, impact, compliance obligation, operating condition) gets a one-sentence definition. |

Elsewhere on the web side:

- `packages/core/src/features.ts`: children `environmental-obligations` and `environmental-context`. Children inherit the parent's manual.
- `apps/web/lib/iso14001Signals.ts`: rewired as in D13.
- `apps/web/app/wiki/iso-14001/_content.ts`: updated, as `check:wiki` requires.

### Mobile (`apps/mobile/`)

- `app/environmental/aspects.tsx` (new): read-only, grouped by process area, significant aspects first, with coverage chips.
- `app/_layout.tsx`: registers the stack screen.
- `app/(tabs)/index.tsx`: an entry card, shown only when the module is visible.

### Seeds and docs

- `apps/web/migrations/seed_ems_northfield_demo.sql`, extended with invented records:
  - the default method;
  - 25 aspects across 5 process areas (some with abnormal and emergency scores, some deliberately without);
  - 15 obligations, one with a deliberately overdue review;
  - 6 evaluations (one noncompliant, which opens a nonconformity);
  - context issues including a climate determination, 4 interested parties, a scope and a policy.
- `docs/ems/00-repo-map.md`: updated. `docs/ems/USER_GUIDE.md`: one page for each of the three screens.

---

## 4. Migrations (SQL)

### RLS templates

Two templates are referenced below. Every new table gets one of them plus `touch_updated_at` (where it has `updated_at`) and `log_audit('id')`, following migrations 274, 276 and 229.

**R1: member read, admin write, facility-aware**

```sql
alter table public.<t> enable row level security;

create policy <t>_member_read on public.<t>
  for select to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  );

create policy <t>_admin_write on public.<t>
  for all to authenticated
  using (
    (public.active_tenant_id() is null or tenant_id = public.active_tenant_id())
    and (tenant_id in (select public.current_user_admin_tenant_ids()) or public.is_superadmin())
    and (public.active_facility_id() is null or facility_id is null or facility_id = public.active_facility_id())
  )
  with check ( /* same three clauses */ );
```

**R2: append-only.** R1 without `update` or `delete` for `authenticated`. It deliberately uses no delete-blocking trigger, because that would also block a tenant's cascade delete:

- `<t>_member_read` as in R1;
- `<t>_admin_insert` `for insert` with the admin `with check`;
- `revoke update, delete on public.<t> from authenticated, anon`.

The service role (Reset Demo, cascades) can still delete.

### 295_ms_context_scope_policy.sql

```sql
begin;

-- Shared management-system core (ISO 14001 now, ISO 45001 later): every row carries discipline.
create table if not exists public.ms_context_issues (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  facility_id      uuid references public.facilities(id) on delete set null,   -- null = whole organization
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  kind             text not null check (kind in ('internal','external','climate')),
  description      text not null check (length(btrim(description)) > 0),
  relevance        text,
  effect           text check (effect in ('risk','opportunity','both')),     -- clause 6.1.1 tag
  retired_at       timestamptz,
  retired_reason   text,
  last_reviewed_at timestamptz,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  next_review_due  date not null default (current_date + 365),
  created_by       uuid references public.profiles(id) on delete set null,
  updated_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check ((retired_at is null) = (retired_reason is null))
);
create index if not exists idx_ms_context_issues_tenant
  on public.ms_context_issues (tenant_id, discipline, facility_id) where retired_at is null;

create table if not exists public.ms_interested_parties (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  facility_id         uuid references public.facilities(id) on delete set null,
  discipline          text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  name                text not null check (length(btrim(name)) > 0),
  needs_expectations  text not null check (length(btrim(needs_expectations)) > 0),
  becomes_obligation  boolean not null default false,
  obligation_id       uuid references public.compliance_calendar_obligations(id) on delete set null,
  retired_at          timestamptz,
  retired_reason      text,
  last_reviewed_at    timestamptz,
  reviewed_by         uuid references public.profiles(id) on delete set null,
  next_review_due     date not null default (current_date + 365),
  created_by          uuid references public.profiles(id) on delete set null,
  updated_by          uuid references public.profiles(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check ((retired_at is null) = (retired_reason is null)),
  check (becomes_obligation or obligation_id is null)
);
create index if not exists idx_ms_interested_parties_tenant
  on public.ms_interested_parties (tenant_id, discipline) where retired_at is null;

-- Scope and policy are versioned and append-only: a change is a new version.
create table if not exists public.ms_scope_statements (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  discipline         text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  version            int  not null check (version >= 1),
  legal_entity       text not null check (length(btrim(legal_entity)) > 0),
  physical_boundary  text not null check (length(btrim(physical_boundary)) > 0),
  activities         text not null check (length(btrim(activities)) > 0),
  products_services  text not null check (length(btrim(products_services)) > 0),
  effective_from     date not null default current_date,
  next_review_due    date not null default (current_date + 365),
  approved_by        uuid references public.profiles(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (tenant_id, discipline, version)
);

create table if not exists public.ms_policies (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  version          int  not null check (version >= 1),
  body             text not null check (length(btrim(body)) > 0),
  -- Keyed by standard, e.g. {"ems.protect_environment":true,"ems.fulfil_obligations":true,"ems.continual_improvement":true}.
  -- 45001 keys (ohs.*) sit alongside with no schema change; policyIsComplete() decides per discipline.
  commitments      jsonb not null check (jsonb_typeof(commitments) = 'object'),
  signatory_name   text not null check (length(btrim(signatory_name)) > 0),
  signatory_title  text,
  signed_at        date not null,
  next_review_due  date not null default (current_date + 365),
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (tenant_id, discipline, version)
);

-- RLS: R1 on ms_context_issues and ms_interested_parties (plus touch and audit triggers);
-- R2 (append-only) on ms_scope_statements and ms_policies (audit trigger).
notify pgrst, 'reload schema';
commit;
```

Rollback: drop the four tables, children first.

### 296_ms_scoring_methods.sql

```sql
begin;

create table if not exists public.ms_scoring_methods (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references public.tenants(id) on delete cascade,
  discipline             text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  name                   text not null check (length(btrim(name)) > 0),
  version                int  not null default 1 check (version >= 1),
  severity_levels        int  not null default 5 check (severity_levels between 2 and 10),
  likelihood_levels      int  not null default 5 check (likelihood_levels between 2 and 10),
  -- null = severity × likelihood; otherwise matrix[severity-1][likelihood-1]. Shape is checked by validateScoringMethod().
  matrix                 jsonb check (matrix is null or jsonb_typeof(matrix) = 'array'),
  significance_threshold int  not null check (significance_threshold > 0),
  is_default             boolean not null default false,
  retired_at             timestamptz,
  created_by             uuid references public.profiles(id) on delete set null,
  created_at             timestamptz not null default now(),
  unique (tenant_id, discipline, name, version)
);
create unique index if not exists uq_ms_scoring_methods_default
  on public.ms_scoring_methods (tenant_id, discipline) where is_default and retired_at is null;

-- One scoring rule, used by every view; scoreAspect() in packages/core mirrors it, and a PGlite test pins the two together.
create or replace function public.ms_method_score(p_matrix jsonb, p_severity int, p_likelihood int)
returns int language sql immutable as $$
  select coalesce((p_matrix -> (p_severity - 1) ->> (p_likelihood - 1))::int, p_severity * p_likelihood)
$$;

-- A method a score depends on never changes its arithmetic; a new version is a new row.
-- Trigger trg_ms_scoring_methods_frozen: before update, raise if severity_levels,
-- likelihood_levels, matrix or significance_threshold changes.

-- Default method for every tenant that already has aspects: exactly today's rule (migration 204).
insert into public.ms_scoring_methods (tenant_id, name, significance_threshold, is_default)
select distinct a.tenant_id, 'Severity × likelihood (5×5)', 12, true
  from public.environmental_aspects a
on conflict do nothing;

-- RLS: R1 (no facility clause; methods are tenant-wide). Audit trigger.
notify pgrst, 'reload schema';
commit;
```

### 297_environmental_aspects_register.sql (expand)

```sql
begin;

alter table public.environmental_aspects
  add column if not exists process_area     text,
  add column if not exists obsolete_at      timestamptz,
  add column if not exists obsolete_reason  text,
  add column if not exists last_reviewed_at timestamptz,
  add column if not exists reviewed_by      uuid references auth.users(id) on delete set null,
  add column if not exists next_review_due  date,
  add column if not exists facility_id      uuid references public.facilities(id);

alter table public.environmental_aspects drop constraint if exists environmental_aspects_obsolete_pair;   -- re-runnable
alter table public.environmental_aspects
  add constraint environmental_aspects_obsolete_pair check ((obsolete_at is null) = (obsolete_reason is null));

-- Never reviewed yet: the first review falls due a year after the aspect was recorded (D12).
update public.environmental_aspects set next_review_due = (created_at::date + 365) where next_review_due is null;
alter table public.environmental_aspects
  alter column next_review_due set not null,
  alter column next_review_due set default (current_date + 365),
  alter column facility_id set default public.active_facility_id();

update public.environmental_aspects a
   set facility_id = f.id
  from public.facilities f
 where f.tenant_id = a.tenant_id and f.is_primary and a.facility_id is null;

create index if not exists idx_environmental_aspects_facility on public.environmental_aspects (facility_id);
create index if not exists idx_environmental_aspects_active
  on public.environmental_aspects (tenant_id, process_area) where obsolete_at is null;

-- One row per scoring of one operating condition. History is append-only (R2).
create table if not exists public.environmental_aspect_scores (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  aspect_id           uuid not null references public.environmental_aspects(id) on delete cascade,
  operating_condition text not null check (operating_condition in ('normal','abnormal','emergency')),
  severity            int  not null check (severity >= 1),
  likelihood          int  not null check (likelihood >= 1),
  method_id           uuid not null references public.ms_scoring_methods(id),   -- no action: a used method can't be deleted alone, but a tenant cascade still works
  rationale           text not null check (length(btrim(rationale)) > 0),
  triggered_by        text,          -- e.g. 'moc:<id>' or 'incident:<id>' (Phase 3); null for routine scoring
  scored_by           uuid references auth.users(id) on delete set null,
  scored_at           timestamptz not null default now()
);
create index if not exists idx_environmental_aspect_scores_aspect
  on public.environmental_aspect_scores (tenant_id, aspect_id, operating_condition, scored_at desc);
-- Trigger trg_environmental_aspect_scores_in_scale: before insert, raise unless
-- severity <= method.severity_levels and likelihood <= method.likelihood_levels.

create or replace view public.environmental_aspect_score_history with (security_invoker = true) as
select s.*,
       public.ms_method_score(m.matrix, s.severity, s.likelihood)                              as score,
       public.ms_method_score(m.matrix, s.severity, s.likelihood) >= m.significance_threshold as significant,
       m.name as method_name, m.version as method_version, m.significance_threshold
  from public.environmental_aspect_scores s
  join public.ms_scoring_methods m on m.id = s.method_id;

create or replace view public.environmental_aspect_current_scores with (security_invoker = true) as
select distinct on (h.aspect_id, h.operating_condition) h.*
  from public.environmental_aspect_score_history h
 order by h.aspect_id, h.operating_condition, h.scored_at desc, h.id desc;   -- id breaks timestamp ties

-- Backfill: the single legacy score becomes the first history row for its condition.
insert into public.environmental_aspect_scores
  (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_by, scored_at)
select a.tenant_id, a.id, a.operating_condition, a.severity, a.likelihood, m.id,
       'Carried over from the single-condition register when per-condition scoring was introduced (migration 297).',
       coalesce(a.updated_by, a.created_by), a.updated_at
  from public.environmental_aspects a
  join public.ms_scoring_methods m on m.tenant_id = a.tenant_id and m.is_default and m.retired_at is null and m.discipline = 'ems'
 where not exists (select 1 from public.environmental_aspect_scores s where s.aspect_id = a.id);

create table if not exists public.environmental_aspect_obligations (
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  aspect_id     uuid not null references public.environmental_aspects(id) on delete cascade,
  obligation_id uuid not null references public.compliance_calendar_obligations(id) on delete cascade,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  primary key (aspect_id, obligation_id)
);

-- RLS: aspects keep their 204 policy until 301 (the old pages still write directly); the
-- facility predicate is added now. Scores: R2. Links: R1 without a facility clause.
notify pgrst, 'reload schema';
commit;
```

### 298_compliance_obligations_register.sql

```sql
begin;

alter table public.compliance_calendar_obligations
  add column if not exists discipline              text not null default 'integrated'
                                                   check (discipline in ('ems','ohs','integrated')),
  add column if not exists source_kind             text check (source_kind in ('law','permit','contract','voluntary','internal')),
  add column if not exists jurisdiction            text check (jurisdiction ~ '^(federal|state:[A-Z]{2}|local:.+)$'),
  add column if not exists applicability_rationale text,
  add column if not exists evaluation_cadence_days int  check (evaluation_cadence_days > 0),
  add column if not exists last_reviewed_at        timestamptz,
  add column if not exists reviewed_by             uuid references public.profiles(id) on delete set null,
  add column if not exists next_review_due         date;

update public.compliance_calendar_obligations
   set discipline = case system_key when 'osha-300a-post' then 'ohs' when 'osha-ita-submit' then 'ohs'
                                    when 'epcra-tier-ii'  then 'ems' else 'integrated' end;      -- Q3
update public.compliance_calendar_obligations set next_review_due = created_at::date + 365 where next_review_due is null;
alter table public.compliance_calendar_obligations
  alter column next_review_due set not null,
  alter column next_review_due set default (current_date + 365);

-- 192 has no touch trigger; routes set updated_at by hand. Add trg_ccal_obligations_touch.
-- D9: replace ccal_obligations_tenant_scope and ccal_events_tenant_scope with R1 (facility_id
-- exists on obligations; events inherit through obligation_id, so they get no facility clause).
-- Add trg_audit_ccal_events.

create table if not exists public.ms_compliance_evaluations (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  facility_id      uuid references public.facilities(id) on delete set null,
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  obligation_id    uuid not null references public.compliance_calendar_obligations(id),   -- no action (Q4): refuses deleting an evaluated obligation, yet lets a tenant cascade
  scheduled_for    date not null,
  assigned_to      uuid references public.profiles(id) on delete set null,
  completed_at     timestamptz,
  evaluator_id     uuid references public.profiles(id) on delete set null,
  result           text check (result in ('compliant','noncompliant','not_applicable','undetermined')),
  notes            text,
  nonconformity_id uuid references public.nonconformities(id) on delete set null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A completed evaluation has a result and an evaluator; an open one has neither.
  check ((completed_at is null) = (result is null) and (completed_at is null) = (evaluator_id is null)),
  check (result is distinct from 'noncompliant' or nonconformity_id is not null),             -- D6
  check (result is distinct from 'not_applicable' or length(btrim(coalesce(notes,''))) > 0)
);
-- At most one open evaluation per obligation: the nightly job and a person can't double-book it.
create unique index if not exists uq_ms_compliance_evaluations_open
  on public.ms_compliance_evaluations (obligation_id) where completed_at is null;
create index if not exists idx_ms_compliance_evaluations_latest
  on public.ms_compliance_evaluations (tenant_id, obligation_id, completed_at desc);

-- Trigger trg_ms_compliance_evaluations_sealed: before update, raise when old.completed_at is not null
-- (a completed evaluation is a record, not a draft). Deletion is closed by RLS, not a trigger, so a
-- tenant's cascade delete still works.
-- RLS: member read; admin insert; update allowed to admins OR assigned_to = auth.uid(); no delete policy.
notify pgrst, 'reload schema';
commit;
```

### 299_ms_evidence.sql

```sql
begin;

create table if not exists public.ms_evidence (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id) on delete cascade,
  facility_id        uuid references public.facilities(id) on delete set null,
  subject_type       text not null check (subject_type in ('compliance_evaluation')),   -- grows per phase
  subject_id         uuid not null,
  kind               text not null check (kind in ('photo','document','sample_result','signature')),
  storage_path       text not null unique check (storage_path like tenant_id::text || '/%'),
  file_name          text not null,
  mime_type          text not null,
  file_size_bytes    int  not null check (file_size_bytes > 0),
  sha256             text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by        uuid not null references public.profiles(id),
  uploaded_at        timestamptz not null default now(),
  superseded_by      uuid references public.ms_evidence(id),
  superseded_at      timestamptz,
  superseded_reason  text,
  check ((superseded_by is null) = (superseded_at is null) and (superseded_at is null) = (superseded_reason is null)),
  unique (tenant_id, subject_type, subject_id, sha256)
);
create index if not exists idx_ms_evidence_subject on public.ms_evidence (tenant_id, subject_type, subject_id);

-- Written only by the server (the upload route computes the hash), so there is no insert, update or
-- delete policy for authenticated. Trigger trg_ms_evidence_append_only: before update, the only
-- permitted change sets the superseded triple once. Deletion is closed by RLS (and grants), not a
-- trigger, so a tenant's cascade delete still works.
-- RLS: member read only. Audit trigger.

-- D5, enforced in the database: completing a compliant or noncompliant evaluation needs evidence.
-- Trigger trg_ms_compliance_evaluations_evidence (before update of completed_at): raise unless
-- new.result in ('not_applicable','undetermined') or an unsuperseded ms_evidence row exists
-- for (subject_type 'compliance_evaluation', subject_id new.id).

-- Private bucket, no storage.objects policies (the 286 pattern): only the server reaches it.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ms-evidence', 'ms-evidence', false, 26214400,
        array['application/pdf','image/jpeg','image/png','image/webp']::text[])                -- Q2
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
commit;
```

### 300_ems_facility_scope.sql

`facility_id` and the facility predicate on the remaining 204–207 tables (D10):

- **Scoped to a facility,** with default `active_facility_id()` and existing rows backfilled to the primary facility: `environmental_objectives`, `nonconformities`.
- **Nullable,** where null means the whole organization: `management_reviews`, `iso14001_clause_evidence`.
- **Child tables** inherit through their parent and get no column: `environmental_objective_readings`, `nonconformity_actions`.
- Each `<t>_tenant_scope` policy is rewritten in the 211 three-clause form. These pages still write from the browser, so members keep write access; Phases 3 and 6 move those writes behind the API.

### 301_environmental_aspects_contract.sql (after the deploy)

```sql
begin;

-- 1. Score any aspect the old page created between 297 and the deploy.
insert into public.environmental_aspect_scores (tenant_id, aspect_id, operating_condition, severity, likelihood, method_id, rationale, scored_by, scored_at)
select a.tenant_id, a.id, a.operating_condition, a.severity, a.likelihood, m.id,
       'Carried over from the single-condition register (migration 301).', coalesce(a.updated_by, a.created_by), a.updated_at
  from public.environmental_aspects a
  join public.ms_scoring_methods m on m.tenant_id = a.tenant_id and m.is_default and m.retired_at is null and m.discipline = 'ems'
 where not exists (select 1 from public.environmental_aspect_scores s where s.aspect_id = a.id);
-- (A tenant whose first aspect arrived in the gap gets its default method inserted first, as in 296.)

-- 2. Replace seed_wls_iso14001_demo() so it writes environmental_aspect_scores rows (the same 14
--    aspects, the same five significant), not the legacy columns. Body = 256's with the aspect insert changed.

-- 3. Drop the legacy single-condition columns (the generated pair first; their index goes with them).
drop index if exists public.idx_environmental_aspects_significant;
alter table public.environmental_aspects
  drop column if exists is_significant,
  drop column if exists significance_score,
  drop column if exists severity,
  drop column if exists likelihood,
  drop column if exists operating_condition;

-- 4. Aspects become member-read, admin-write (R1), now that every write goes through the API.
notify pgrst, 'reload schema';
commit;
```

Rollback 301:

- re-add the five columns;
- repopulate severity, likelihood and condition from each aspect's highest current score;
- re-create the generated pair;
- restore 256's function body and 204's policy.

---

## 5. Domain logic signatures (`packages/core`)

```ts
// scoringMethod.ts
/** A significance rule. Immutable once any score references it; a new version is a new row. */
export interface ScoringMethod {
  id: string
  severityLevels: number          // 2..10
  likelihoodLevels: number        // 2..10
  /** null = severity × likelihood; else matrix[severity - 1][likelihood - 1]. */
  matrix: readonly (readonly number[])[] | null
  significanceThreshold: number
}
/** Today's rule (migration 204): 5 × 5, significant at 12. */
export const DEFAULT_SCORING_METHOD: Omit<ScoringMethod, 'id'>
/** Shape problems (matrix dimensions, non-positive cells, threshold reachable). Empty = valid. */
export function validateScoringMethod(method: Omit<ScoringMethod, 'id'>): FieldError[]

// environmentalAspect.ts
export type OperatingCondition = 'normal' | 'abnormal' | 'emergency'
export const OPERATING_CONDITIONS: readonly OperatingCondition[]
export interface AspectScore { score: number; significant: boolean }
/**
 * Score one condition of an aspect under a method. Mirrors public.ms_method_score() and the
 * significance column of environmental_aspect_score_history; a PGlite test pins the two together.
 * Precondition: 1 <= severity <= method.severityLevels, 1 <= likelihood <= method.likelihoodLevels
 * (validateAspectScoreInput checks this at the boundary).
 */
export function scoreAspect(severity: number, likelihood: number, method: ScoringMethod): AspectScore
/** Which operating conditions have at least one score (clause 6.1.2 asks for all three). */
export function aspectCompleteness(scores: readonly { operatingCondition: OperatingCondition }[]):
  { covered: OperatingCondition[]; missing: OperatingCondition[] }
/** Latest score per condition by scoredAt (ties: higher id), matching the environmental_aspect_current_scores view. */
export function currentScoresByCondition<T extends { operatingCondition: OperatingCondition; scoredAt: string }>(
  scores: readonly T[]): Partial<Record<OperatingCondition, T>>
export function validateAspectInput(input: AspectInput): FieldError[]
export function validateAspectScoreInput(input: AspectScoreInput, method: ScoringMethod): FieldError[]

// managementSystem.ts (registerHealth already exists)
/** ISO date `cadenceDays` after `reviewedOn`, in UTC calendar days. */
export function nextReviewDue(reviewedOn: string, cadenceDays: number): string
/** Commitments each standard requires its policy to state. 'integrated' requires both lists. */
export const REQUIRED_POLICY_COMMITMENTS: Readonly<Record<'ems' | 'ohs', readonly string[]>>
//   ems: ems.protect_environment, ems.fulfil_obligations, ems.continual_improvement (14001 clause 5.2)
//   ohs: ohs.safe_healthy_conditions, ohs.eliminate_hazards_reduce_risks, ohs.consultation_participation,
//        ohs.fulfil_obligations, ohs.continual_improvement (45001 clause 5.2)
/** Every required commitment true for the discipline, plus a signatory and a signing date. */
export function policyIsComplete(
  policy: { commitments: Readonly<Record<string, boolean>>; signatoryName: string | null; signedAt: string | null },
  discipline: Discipline): boolean
/** True when the scope's legal entity changed after the policy was signed (Lesson L3: "signed by a prior owner"). */
export function policySignatoryStale(policy: { signedAt: string }, scope: { effectiveFrom: string; legalEntityChanged: boolean }): boolean
/** registerHealth, then amber when no active issue of kind 'climate' exists (Q1). */
export function contextRegisterHealth(rows: readonly (RegisterRow & { kind: 'internal' | 'external' | 'climate' })[], today: string): RegisterHealth

// complianceEvaluation.ts
export const EVALUATION_RESULTS: readonly ['compliant', 'noncompliant', 'not_applicable', 'undetermined']
export type EvaluationResult = typeof EVALUATION_RESULTS[number]
/**
 * Obligations the nightly job must schedule today: each active obligation that has an
 * evaluation cadence, no open evaluation, and no evaluation completed within the last cadence window.
 */
export function evaluationsToSchedule(
  obligations: readonly { id: string; evaluationCadenceDays: number | null; active: boolean }[],
  evaluations: readonly { obligationId: string; completedAt: string | null }[],
  today: string,
): { obligationId: string; scheduledFor: string }[]
/** What still blocks closing an evaluation (result, evidence, notes for not_applicable). Empty = closable. */
export function evaluationCompletionGaps(input: { result: EvaluationResult | null; evidenceCount: number; notes: string | null }): string[]
/** 'federal' | 'state:TX' | 'local:<name>'; null when malformed. */
export function parseJurisdiction(raw: string): Jurisdiction | null
export function validateObligationRegisterInput(input: ObligationRegisterInput): FieldError[]
```

### Boundary tests

| Function | Cases |
| --- | --- |
| `scoreAspect` | default 3×4=12 → significant, 11 → not, 13 → significant; matrix override (corner cells, threshold equal to a cell); 1×1 and 5×5 edges |
| `aspectCompleteness` | each of the 8 condition subsets; duplicates collapse |
| `currentScoresByCondition` | latest wins; equal timestamps resolve to the higher id, exactly like the view |
| `registerHealth` | already pinned (due today vs. yesterday, year boundary, retired rows) |
| `nextReviewDue` | month end, leap day (2028-02-29), year rollover |
| `policyIsComplete` | each missing ems commitment; missing signatory or date; `ohs` keys; `integrated` needs the union |
| `contextRegisterHealth` | climate present, absent, retired |
| `evaluationsToSchedule` | due exactly today; one day early; open evaluation blocks; no cadence; inactive obligation; window boundary |
| `evaluationCompletionGaps` | each result, 0 vs. 1 evidence, `not_applicable` without notes |
| `parseJurisdiction` | `state:tx` rejected (must be upper case), `local:` with an empty name rejected |
| `validateScoringMethod` | wrong matrix size, a negative cell, a threshold no cell reaches |

---

## 6. Tests and acceptance

### Unit tests

The core tests in §5, plus the readiness clause rules with their new signals. The WLS demo story stays green.

### API tests

Every new route:

- passes gate failures through (401, 403, module off → 403);
- validates input with field errors;
- filters on the gate tenant;
- proves **tenant isolation**: using the e2e harness's filtering store, seed a tenant-A row, call as tenant B, get 404, and confirm nothing is written.

### Database tests (PGlite, D15)

- Apply 295–301 over the 027/029/209 DDL subset.
- Prove five things:
  - the view's score matches `scoreAspect` across the full 5×5 grid and a matrix method;
  - an append-only table refuses `update` and `delete` from `authenticated`;
  - a completed evaluation is sealed;
  - completing without evidence raises;
  - each rollback restores the prior shape.

### End-to-end (route-level, `apps/web/__tests__/e2e/emsRegisters.e2e.test.ts`)

1. Create an aspect.
2. Score it under normal and emergency; coverage shows N and E, missing A.
3. Create an obligation with an evaluation cadence; the nightly job schedules it.
4. Upload evidence, then complete the evaluation as compliant.
5. Check register health along the way: red (empty), then amber (review overdue), then green.

### Mobile and readiness

- **Mobile:** typecheck. There is no mobile test runner.
- **Readiness:** a report-card snapshot on the Northfield seed.

### Acceptance on the Northfield demo tenant

- `/environmental` reaches all three registers in one click each.
- The aspects register shows dates and N/A/E coverage chips.
- Every obligation shows its last result, with evidence that downloads with a verified hash.
- The noncompliant evaluation's nonconformity is linked.

### Performance

The aspects and obligations lists render under 500 ms at 2,000 rows. Supporting indexes are above; lists are filtered on the server and paged at 200.

---

## 7. Implementation order (after "go")

Small commits, prefixed `ems(phase1):`. Lint, typecheck and the full suite run before each commit.

1. Domain logic and its tests (no I/O).
2. Migrations 295–301 with rollbacks, plus the PGlite harness and database tests.
3. `requireTenantModuleAdmin`, then the context, scope and policy routes with their tests.
4. The aspects routes with their tests.
5. The obligations, evaluation and evidence routes with their tests; the cron job and email.
6. The web pages (aspects rewrite, obligations, context, hub), then the readiness rewiring and the wiki.
7. The mobile screen.
8. The extended Northfield seed, the e2e test, `USER_GUIDE.md` and the repo map.
9. An adversarial review, fixes, the full CI-equivalent run, then the PR with the Definition-of-done checklist.

### Rollout (in the PR)

1. Apply 295–300.
2. Deploy.
3. Re-run 294 per Phase 0, then apply 301.
4. Optionally, hand-apply the Northfield seed to a demo database.
