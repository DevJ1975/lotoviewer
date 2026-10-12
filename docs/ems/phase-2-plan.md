# Phase 2 plan: permit vault and ownership-change workflow

- **Status:** Accepted. The product owner replied "go" on 2026-10-02, taking every decision and every lean in §2. Migrations 304–306 await approval before they are applied.
- **Branch:** `feat/ems-phase2-permits`, stacked on `chore/release-1.20.0` (#316), so its migrations start at 304.
- **Contract:** [EMS_IMPLEMENTATION_PLAN.md](./EMS_IMPLEMENTATION_PLAN.md), "Phase 2" and Lessons L8–L9, as adapted by [ADR 0001](./adr/0001-build-on-the-existing-environmental-module.md).
- **Ground truth:** [00-repo-map.md](./00-repo-map.md), and the two read-only discovery passes summarized in "What exists today".

**Goal (acceptance):**

- Creating an ownership or name change on the Northfield demo produces one transfer checklist for each permit.
- A permit whose renewal deadline is 29 days away shows the 30-day badge. Its owner has been told it is due.

---

## What exists today

Nothing in the repo records an agency-issued permit, and nothing records a management of change (MOC).

- **Permits.**
  - Every "permit" table is an internal permit to work: confined space, hot work, group LOTO and working at heights. Each is tied to a space or a person, capped at hours, and read by its own status board. None can hold an air or stormwater permit.
  - Agency permits appear only as free text in the obligations register: `regulatory_ref`, with `source_kind = 'permit'` (migration 298).
- **Change.** "MOC" exists only as an allowed value of `risks.source` and `risk_reviews.trigger` (migration 037). `environmental_aspect_scores.triggered_by` already expects `'moc:<id>'` (migration 297).
- **What Phase 2 can reuse:**

| Need | Reuse | Fit |
| --- | --- | --- |
| A condition that recurs ("sample the outfall every quarter") | An obligation row: `cadence`, `next_due_at`, owner, `advanceDueDate`, and the event log `compliance_calendar_events` | Good. It also puts every condition in the legal register (6.1.3) and in the evaluation of compliance (9.1.2) |
| Permit documents, and evidence for each transfer step | `ms_evidence` with the private `ms-evidence` bucket: append-only, server SHA-256, re-hashed on download | Good, once its subject list widens (today it accepts only `compliance_evaluation`) |
| Holder-of-record check | `ms_scope_statements.legal_entity` (the highest version is the scope in force) and the comparison inside `policySignatoryStale()` | Good |
| Nightly job and email | `api/cron/compliance-evaluations` (auth, `withCronLogging`, module filter, owner-or-admins fallback, `reminders` suppression) and `sendComplianceEvaluationDue` | Good, as a template |
| Renewal countdown | `daysUntilDue()` | Primitive only: no tiered helper exists, and no job remembers what it already sent |
| Change impact rows | The `subject_type` + `subject_id` pattern of `ms_evidence` and `nonconformities` | Pattern only: no table to extend |

---

## 1. Decisions this plan makes

Replying "go" accepts every row below. To change one, reply "go, but D4: …".

| # | Decision | Recommendation | Why |
| --- | --- | --- | --- |
| D1 | **The permit record** | New table `environmental_permits` (the name ADR 0001 Q7 fixed). It holds every permit, registration and plan: `program` (air, waste, wastewater, stormwater, SPCC, EPCRA, other), `instrument` (permit, registration, plan), agency, number, jurisdiction, **holder of record**, issue and expiry dates, `business_critical`, an owner, and the register's review dates. A permit is never deleted: it is **retired** with a reason, like a context issue. | One vault for the paperwork the auditor checks first (L8, L9). Keeping clear of the permit-to-work tables protects LOTO. |
| D2 | **A permit belongs to a site** | `facility_id` is required and defaults to the active facility. Creating a permit with no facility selected answers 400, "Select a facility", as aspects do. | Agencies issue permits to a site. A tenant with two plants sees each plant's permits under that plant. |
| D3 | **Conditions are obligations** | A condition is a row in the obligations register with `source_kind = 'permit'` and a new `permit_id` link. It inherits the permit's jurisdiction and site. The permit page adds and lists its conditions, and an existing obligation can be linked to its permit. **No `ems_permit_condition` table and no "materialize" step.** | A condition *is* a compliance obligation. This way it appears in the legal register, gets evaluated for compliance, and recurs through the cadence the calendar already has. A separate table would fork all three. |
| D4 | **Every condition has a due date** | The register requires `next_due_at`, so a condition with no deliverable, such as an emission limit, gets a periodic check date, for example "verify the opacity limit, annually". | Making `next_due_at` optional would change the admin compliance calendar, which sorts and colours by it. A limit nobody checks is the finding anyway. |
| D5 | **Doing a condition** | "Mark done" records an occurrence and moves the due date forward, through one database function, `ms_record_obligation_occurrence()`. The **obligation's owner** may record it, as well as an admin. Evidence (the sample result, the report) attaches to the logged occurrence. | The person who takes the quarterly sample is rarely an admin. One function keeps the event and the new due date in a single transaction. It runs as definer and checks the caller itself, so the audit log still names the person. |
| D6 | **Renewal deadline and tiers** | The countdown runs to the **renewal deadline**: the "renewal application due" date taken from the permit's own terms when one is entered, otherwise the expiry date. Tiers fall at 180, 90 and 30 days, then *passed*. The 180/90/30 thresholds are product policy, named in one constant, not regulation. Nothing computes a regulatory lead time. | Many permits require the renewal application months before expiry. Counting to expiry alone would warn too late. Taking the date from the permit text avoids inventing a threshold. |
| D7 | **The renewal "task"** | No task table (Phase 1 D5 again). The permit row is the task: its owner, its tier and its renewal state. **Renewal submitted on** quiets the countdown. **Record the renewed permit** (new dates, optional new number, new document) clears it. A permit past expiry with a renewal pending reads *Expired, renewal pending*, with the reminder to confirm with the agency whether it continues. | Without a "submitted" state the countdown would nag through a months-long agency review, and people learn to ignore it. Whether an expired permit continues during review depends on the program, so the platform says so rather than guessing. |
| D8 | **Who hears about a renewal** | The permit's owner while they are a member, otherwise the tenant's owners and admins. A **business-critical** permit also reaches whoever holds **Compliance obligations** on the Processes page. At 30 days and when the deadline has passed, it also reaches every owner and admin. One email per person per run, listing every permit and condition due. | The repo has no "site lead" role. The process owner is the closest named person, and owners and admins are top management's stand-in. |
| D9 | **Reminders for conditions** | The same nightly job reminds a condition's owner 14 days before its due date, and once more when it is overdue. Only permit conditions get these reminders in Phase 2. | Turning reminders on for every obligation would start emailing about calendar rows tenants already have, including OSHA ones. |
| D10 | **Remembering what was sent** | New table `ms_notification_log` with a unique `(tenant, subject, notice key)`. The key includes the deadline, for example `renewal:90:2027-03-01`. The job claims the key, then sends. Service role only. | One mechanism prevents both the daily re-send and the double send. A new expiry date makes new keys, so tiers reset without anyone remembering to clear a column. |
| D11 | **Holder-of-record mismatch** | Compare each active permit's holder with the legal entity of the scope in force (highest version). Both sides are lower-cased, with full stops and commas dropped and spaces collapsed. One shared `normalizeLegalEntity()` mirrors a SQL function, and `policySignatoryStale()` moves onto it too. A mismatch is a **red** badge on the card and turns the register red. With no scope recorded, the check says so instead of guessing. | L8: a permit still in a previous owner's name is a compliance exposure. Without the normalization, "Forge & Finish, LLC" vs "Forge & Finish LLC" would be noise. |
| D12 | **Management of change** | New shared tables `ms_changes` and `ms_change_impacts`, with `discipline`. Kinds: equipment, chemical, process, ownership or name, personnel, other. An ownership change records the **new legal entity**. Impacts are computed by a pure `changeImpacts()` in `packages/core` and inserted with the change in one transaction, through `ms_open_change()`. That function refuses a target outside the tenant. | Plain plural names follow the `ms_` tables Phase 1 shipped; the UI says "Management of change". Computing impacts in core keeps the rule testable. One transaction never leaves a change without its checklist. |
| D13 | **What a change touches** | **Ownership or name:**<br>• every active permit at the change's site, or at every site when the change covers the whole organization, as three steps: notify the agency, submit the transfer or update, confirm the holder of record is updated;<br>• the scope in force;<br>• the policy in force.<br>**Equipment and process:** every active aspect in the named process area.<br>**Chemical:** those aspects, plus active obligations in the air and waste categories.<br>**Personnel and other:** no automatic impacts.<br>**Discipline `ohs`:** throws `NotImplementedError`, as the seam requires.<br>Impacts are a snapshot taken when the change opens. | The plan's fan-out, plus the policy: a policy signed by the old owner is L3's finding. Phase 3 adds suggested actions and the in-place rescore for aspect impacts. |
| D14 | **Closing an impact** | The database enforces the checklist:<br>• **every transfer step needs evidence**;<br>• **"confirm holder" is refused until the permit's holder of record matches the new legal entity**;<br>• the scope impact closes only once the scope in force names the new entity;<br>• the policy impact closes only once the policy in force was signed after that scope change;<br>• any other impact needs a resolution note.<br>Resolved impacts are sealed. A change closes only when every impact is resolved. It can be cancelled with a reason at any time, keeping its impacts as history. | The checklist cannot be ticked with the old name still on the permit. That is the whole point of the workflow. |
| D15 | **Evidence subjects** | `ms_evidence` accepts four more subjects: `environmental_permit` (the permit document), `ms_change_impact` (transfer evidence), `compliance_calendar_event` (proof a condition was done), and `compliance_obligation` (the rule or permit text, the Phase 1 audit's 6.1.3 "access" improvement). The subject trigger checks each type: the subject exists in the same tenant; permit evidence is refused once the permit is retired; impact evidence is sealed once the impact is resolved. | Today the trigger looks only at evaluations, so any other subject would pass silently. |
| D16 | **Who writes** | Members read everything. Admins write permits, conditions and changes, and resolve impacts (Phase 1 D8). The one exception is D5: a condition's owner records its occurrence and attaches its evidence. | Same model as Phase 1, with one deliberate widening where the work is actually done. |
| D17 | **Register health and the hub** | **Permits light:**<br>• **red:** a permit is past its deadline with no renewal submitted, or a holder of record does not match;<br>• **amber:** a renewal is within 90 days, an expired permit's renewal is pending, a condition is overdue, or the register review is overdue;<br>• **green:** otherwise.<br>(For an empty register, see Q1.)<br>Hub cards for **Permits** (with the light) and **Management of change** (with the count of open changes). | Absence and danger are visible without anyone running a report (design principle 5). |
| D18 | **Report card** | **Clause 6.1.3** reads *attention* when an active permit has passed its deadline with no renewal pending, or names a holder other than the scope's legal entity. The clause map gains `environmental_permits` under 6.1.3, and `ms_changes` under 6.1.4 and 8.1 as places to look. 8.1 stays *not assessed*. | Expired permits and wrong holders are compliance-obligation findings. Change control is only part of 8.1, so a change record does not grade it. |
| D19 | **Mobile** | None (the master plan lists none for Phase 2). | |
| D20 | **Version** | No bump in this PR. Phase 2 ships in 1.21.0 through its own release PR. | Follows the versioning runbook. |

## 2. Open questions

Each has my lean. Reply "go" to take every lean, or answer the one you'd change.

- **Q1. An empty permits register.** My lean: **amber**, reading "No permits recorded. Record each permit, registration and plan the site holds." Phase 1 registers turn red when empty, but a small site may genuinely hold no environmental permit. The platform can't tell, and the 7.5/9.2 decision says not to call that a gap.
- **Q2. Files over 4 MB.** Vercel caps a request body at about 4.5 MB, and scanned permits are often 10–50 MB. My lean: **include direct-to-storage upload in Phase 2.**
  - The server issues a one-time signed upload URL into a `pending/` folder.
  - The browser uploads straight to the private bucket.
  - A finalize call then has the server read the file back, check its type and size (up to the bucket's 25 MiB), compute SHA-256 and file the evidence row.
  - A nightly sweep removes unfinalized uploads after 24 hours.
  - The hash is still computed only by the server.
  - Without this, Phase 2's main documents won't fit.
- **Q3. Export-controlled evidence.** From the Phase 1 audit: aerospace and defense customers will upload ITAR/EAR-adjacent drawings. My lean: **include it.**
  - An `export_controlled` flag is set at upload and never changed.
  - The file shows a badge.
  - Downloads are refused for anyone but owners and admins.
  - It is a label and an access rule, not a legal determination.
- **Q4. Business-critical recipients** (D8). My lean is as written: the holder of Compliance obligations, then every owner and admin at 30 days and when the deadline passes. The alternative is the holder of the 5.3 role "Ensuring the EMS conforms".
- **Q5. Condition reminder lead time** (D9). My lean: 14 days before, and once when overdue, for permit conditions only.

---

## 3. Files

### Migrations (`apps/web/migrations/`)

Each migration ships with an `NNN_rollback.sql`. All three are additive, so they are applied **before** the deploy. I apply nothing.

| File | What |
| --- | --- |
| `304_environmental_permits.sql` | `environmental_permits`; `compliance_calendar_obligations.permit_id`; `ms_advance_due_date()`; `ms_record_obligation_occurrence()`; `ms_notification_log` |
| `305_ms_changes.sql` | `ms_normalize_legal_entity()`; `ms_changes`; `ms_change_impacts`; their guard, seal and close triggers; `ms_open_change()` |
| `306_ms_evidence_subjects.sql` | Widen `ms_evidence.subject_type`; add `export_controlled` (Q3); add the per-type subject trigger |

### Shared domain logic (`packages/core/src/`)

- `environmentalPermit.ts` (new):
  - `PERMIT_PROGRAMS`, `PERMIT_INSTRUMENTS`, `RENEWAL_TIER_DAYS`;
  - `renewalDeadline`, `permitEscalation`, `permitStanding`, `holderOfRecordMismatch`, `permitsHealth`, `validatePermitInput`;
  - `renewalNoticesDue`, `conditionRemindersDue`.
- `managementOfChange.ts` (new): `CHANGE_KINDS`, `IMPACT_TARGET_TYPES`, `TRANSFER_STEPS`, `ownershipChangeChecklist`, `changeImpacts` (the plan's `mocFanOut`), `changeCloseGaps`, `impactResolutionGaps`, `validateChangeInput`.
- `managementSystem.ts` (extend): `normalizeLegalEntity`, `sameLegalEntity`. `policySignatoryStale` uses them.
- `iso14001Readiness.ts`, `iso14001.ts` (extend): the 6.1.3 rule and its two signals; clause-map sources.
- `features.ts` (extend): children `environmental-permits` and `environmental-changes`.
- **Tests:** `environmentalPermit.test.ts`, `managementOfChange.test.ts`; extend `managementSystem.test.ts` and `iso14001Readiness.test.ts`.

### API routes (`apps/web/app/api/environmental/`)

Every route uses the Phase 1 gates (`requireTenantModuleMember`, `requireTenantModuleAdmin`) and `gateFailure`.

| Route | Methods | Notes |
| --- | --- | --- |
| `permits` | GET, POST | Filters: program, standing, business-critical, holder mismatch. Rows carry standing, tier, renewal deadline, mismatch and condition count. POST needs a facility. |
| `permits/[id]` | GET, PATCH | GET adds conditions, documents and the change history. PATCH uses an allow-list; it cannot touch the renewal or retirement fields. |
| `permits/[id]/renewal` | POST | Either `{ action: 'submitted', submitted_on }`, or `{ action: 'renewed', issued_on, expires_on, renewal_application_due_on?, permit_number? }`. Recording a renewed permit clears "submitted". |
| `permits/[id]/retire` | POST | Requires a reason. |
| `permits/[id]/review` | POST | As for the other registers. |
| `permits/[id]/conditions` | GET, POST | POST creates the obligation (D3): `source_kind = 'permit'`, the permit's jurisdiction and site, `discipline = 'ems'`. |
| `obligations/[id]` | PATCH (extend) | Accepts `permit_id` (link or unlink). Linking requires `source_kind = 'permit'`. |
| `obligations/[id]/occurrences` | GET, POST | POST calls `ms_record_obligation_occurrence()` (owner or admin). GET returns the history with evidence. |
| `changes` | GET, POST | POST validates, reads the targets, runs `changeImpacts()`, then calls `ms_open_change()`. |
| `changes/[id]` | GET, PATCH | GET returns impacts with readable target labels and evidence. PATCH: edit while open, `close`, or `cancel` with a reason. |
| `changes/[id]/impacts/[impactId]/resolve` | POST | Takes a note. Database refusals map to 409 with the reason in plain words. |
| `evidence` | POST (extend) | Resolves the subject by type, with the permission rule for each type. Accepts `export_controlled` (Q3). |
| `evidence/[id]/download` | GET (extend) | Export-controlled evidence is limited to owners and admins (Q3). |
| `evidence/uploads`, `evidence/uploads/[id]/finalize` | POST | Direct-to-storage upload (Q2). |
| `registers/health` | GET (extend) | Adds `permits`. |
| `api/cron/environmental-permits` | GET, POST | Nightly at `15 14 * * *`: renewal notices (D6–D8), condition reminders (D9), and the pending-upload sweep (Q2). |

Supporting files:

- `apps/web/lib/email/sendPermitsDue.ts`: one digest per person, `reminders` suppression category.
- `apps/web/vercel.json`: the cron entry. `apps/web/app/api/superadmin/run-cron/route.ts`: the allowlist.
- `apps/web/lib/environmental/permits.ts`, `changes.ts`: input parsing.
- `apps/web/lib/environmental/client.ts`: client calls.
- `apps/web/lib/environmental/evidence.ts`: the subject list.
- `apps/web/lib/iso14001Signals.ts`: two new signals.

### Web UI (`apps/web/app/environmental/`)

| Page | What |
| --- | --- |
| `permits/page.tsx` (new) | **Health strip.** **Cards grouped by program**, each showing: holder of record (red "Holder mismatch" badge when it differs), agency, number, renewal countdown badge (180, 90, 30, passed, renewal submitted), business-critical flag, condition count and document link. Filters: program, standing, business-critical. An admin's "Add permit" form. |
| `permits/[id]/page.tsx` (new) | **Detail:**<br>• the permit's fields;<br>• documents, with upload;<br>• renewal actions;<br>• a **conditions table** (text, cadence, owner, last done, next due, "Mark done" with evidence);<br>• linked obligations;<br>• changes that touched it;<br>• the review stamp;<br>• retire. |
| `changes/page.tsx` (new) | List of changes (open first), with progress. A "New change" form: kind, title, description, process area, new legal entity for an ownership change, effective date. Before saving, it previews how many impacts the change will create. |
| `changes/[id]/page.tsx` (new) | **The impact checklist**, grouped by target, with a progress bar. An ownership change renders one transfer card for each permit with its three steps. Each step has its own evidence upload and "Resolve"; a refusal shows the database's reason in plain words. Close or cancel. |
| `obligations/page.tsx` (extend) | A permit chip on linked conditions, and a "Linked permit" field in the sheet. |
| `page.tsx` (hub) | Permits and Management of change cards. |
| `_components/EvidenceUpload.tsx` (extend) | Takes `subjectType`, and the direct upload (Q2) and the export-control tick box (Q3). |

Also updated: the wiki `iso-14001` page (`check:wiki` requires it), the `navigationCatalog.ts` keywords ("permit", "MOC", "management of change"), `docs/ems/USER_GUIDE.md` (two new sections), `00-repo-map.md` and `README.md`.

### Seeds and docs

`apps/web/migrations/seed_ems_northfield_demo.sql` is extended with invented records. Every permit number starts `DEMO-`, so none can match a real authorization:

- **Five permits:**
  - stormwater coverage, held in a fictional **prior owner's** name, "Northfield Metal Products Inc.", to show the mismatch;
  - the city wastewater discharge permit: business-critical, renewal application due 29 days after the seed runs;
  - the paint booth's permit-by-rule registration, with no expiry;
  - the SPCC plan, a plan;
  - the hazardous waste EPA ID registration.
- The existing stormwater, wastewater and paint-booth obligations become those permits' conditions.
- No change records: the presenter opens the ownership change live.

The hazardous waste EPA ID also lives in the site's hazardous-waste profile (`facilities.settings.hazardous_waste.epa_id_number`). Until Phase 5 links the two, the number is entered in both places, and the guide says so.

---

## 4. Migrations (SQL)

RLS templates **R1** (member read, admin write, facility-aware) and **R2** (append-only) are the ones written out in the [Phase 1 plan, §4](./phase-1-plan.md#rls-templates).

### 304_environmental_permits.sql

```sql
begin;

-- Permits, registrations and plans issued by or filed with an agency. Not
-- "permits": that name belongs to the permit-to-work tables (ADR 0001 Q7).
-- A permit is retired, never deleted.
create table if not exists public.environmental_permits (
  id                          uuid primary key default gen_random_uuid(),
  tenant_id                   uuid not null references public.tenants(id) on delete cascade,
  facility_id                 uuid not null default public.active_facility_id(),
  program                     text not null check (program in ('air','waste','wastewater','stormwater','spcc','epcra','other')),
  instrument                  text not null default 'permit' check (instrument in ('permit','registration','plan')),
  title                       text not null check (length(btrim(title)) between 1 and 200),
  agency                      text not null check (length(btrim(agency)) between 1 and 200),
  permit_number               text check (permit_number is null or length(btrim(permit_number)) between 1 and 100),
  jurisdiction                text not null check (jurisdiction ~ '^(federal|state:[A-Z]{2}|local:.+)$'),
  holder_of_record            text not null check (length(btrim(holder_of_record)) between 1 and 300),
  issued_on                   date,
  -- Null: no fixed term, such as a permit by rule.
  expires_on                  date,
  -- Taken from the permit's own terms, never computed: lead times differ by program.
  renewal_application_due_on  date,
  renewal_submitted_on        date,
  business_critical           boolean not null default false,
  owner_user_id               uuid,
  notes                       text check (notes is null or length(notes) <= 4000),
  retired_at                  timestamptz,
  retired_reason              text,
  last_reviewed_at            timestamptz,
  reviewed_by                 uuid references public.profiles(id) on delete set null,
  next_review_due             date not null default (current_date + 365),
  created_by                  uuid references public.profiles(id) on delete set null,
  updated_by                  uuid references public.profiles(id) on delete set null,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  unique (tenant_id, id),
  constraint environmental_permits_facility_fk foreign key (tenant_id, facility_id)
    references public.facilities (tenant_id, id),
  -- The owner is a member of this tenant; removing the membership clears only the owner (as migration 302).
  constraint environmental_permits_owner_member_fk foreign key (owner_user_id, tenant_id)
    references public.tenant_memberships (user_id, tenant_id) on delete set null (owner_user_id),
  constraint environmental_permits_term check (expires_on is null or issued_on is null or expires_on > issued_on),
  constraint environmental_permits_renewal_due check (
    renewal_application_due_on is null or (expires_on is not null and renewal_application_due_on <= expires_on)),
  constraint environmental_permits_retired_pair check ((retired_at is null) = (retired_reason is null)),
  constraint environmental_permits_retired_reason check (retired_reason is null or length(btrim(retired_reason)) > 0)
);

-- One active record per agency number; a renewal updates the row, it does not add one.
create unique index if not exists uq_environmental_permits_number
  on public.environmental_permits (tenant_id, lower(btrim(agency)), btrim(permit_number))
  where permit_number is not null and retired_at is null;
create index if not exists idx_environmental_permits_deadline
  on public.environmental_permits (tenant_id, coalesce(renewal_application_due_on, expires_on))
  where retired_at is null;

-- R1, plus: no client deletes (retire instead). The service role can still cascade.
--   environmental_permits_member_read, environmental_permits_admin_write
revoke delete on public.environmental_permits from authenticated, anon;
--   trg_environmental_permits_touch (touch_updated_at), trg_audit_environmental_permits (log_audit('id'))

-- ── Conditions are obligations (D3) ──────────────────────────────────────
alter table public.compliance_calendar_obligations add column if not exists permit_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_calendar_obligations_permit_fk') then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_permit_fk foreign key (tenant_id, permit_id)
        references public.environmental_permits (tenant_id, id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_calendar_obligations_permit_source') then
    alter table public.compliance_calendar_obligations
      add constraint compliance_calendar_obligations_permit_source check (permit_id is null or source_kind = 'permit');
  end if;
end $$;
create index if not exists idx_compliance_calendar_obligations_permit
  on public.compliance_calendar_obligations (permit_id) where permit_id is not null;

-- ── Doing a condition (D5) ───────────────────────────────────────────────
-- Mirrors advanceDueDate() in packages/core/src/complianceCalendar.ts, including
-- its month overflow (31 January + 1 month = 3 March). A PGlite test pins the two.
create or replace function public.ms_advance_due_date(p_current date, p_cadence text, p_cadence_days int)
returns date
language sql immutable
set search_path = pg_catalog
as $$
  select case p_cadence
    when 'once'        then p_current
    when 'custom_days' then p_current + greatest(coalesce(p_cadence_days, 1), 1)
    else (date_trunc('month', p_current) + make_interval(months => case p_cadence
            when 'monthly' then 1   when 'quarterly' then 3  when 'semiannual' then 6
            when 'annual' then 12   when 'biennial' then 24  when 'triennial' then 36
            when 'quinquennial' then 60 else 0 end))::date
         + (extract(day from p_current)::int - 1)
  end
$$;

-- An obligation's owner, or an admin, records that it was done. Definer, so the
-- owner can move the due date, which RLS keeps admin-only; the checks below
-- stand in for RLS, and log_audit() still records the caller (auth.uid()).
create or replace function public.ms_record_obligation_occurrence(p_obligation_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ob       public.compliance_calendar_obligations%rowtype;
  v_event_id uuid;
begin
  select * into v_ob from public.compliance_calendar_obligations where id = p_obligation_id for update;
  if not found
     or (public.active_tenant_id() is not null and v_ob.tenant_id <> public.active_tenant_id())
     or not (v_ob.tenant_id in (select public.current_user_admin_tenant_ids())
             or (v_ob.owner_user_id = auth.uid() and v_ob.tenant_id in (select public.current_user_tenant_ids()))
             or public.is_superadmin()) then
    raise exception 'obligation % not found', p_obligation_id using errcode = 'no_data_found';
  end if;
  if v_ob.status <> 'open' then
    raise exception 'obligation % is %, not open', v_ob.id, v_ob.status using errcode = 'check_violation';
  end if;

  insert into public.compliance_calendar_events (tenant_id, obligation_id, occurrence_at, completed_by, note)
  values (v_ob.tenant_id, v_ob.id, v_ob.next_due_at, auth.uid(), nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_event_id;

  update public.compliance_calendar_obligations
     set next_due_at = public.ms_advance_due_date(v_ob.next_due_at, v_ob.cadence, v_ob.cadence_days),
         status      = case when v_ob.cadence = 'once' then 'completed' else 'open' end,
         updated_at  = now()
   where id = v_ob.id;
  return v_event_id;
end $$;
revoke all on function public.ms_record_obligation_occurrence(uuid, text) from public, anon;
grant execute on function public.ms_record_obligation_occurrence(uuid, text) to authenticated;

-- ── What the nightly job already sent (D10) ──────────────────────────────
create table if not exists public.ms_notification_log (
  id            bigserial primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  subject_type  text not null check (subject_type in ('environmental_permit','compliance_obligation')),
  subject_id    uuid not null,
  -- e.g. 'renewal:90:2027-03-01' or 'condition:overdue:2026-12-31'. The date
  -- in the key makes a new deadline a new notice.
  notice_key    text not null check (length(notice_key) between 1 and 100),
  recipients    int not null default 0,
  sent_at       timestamptz not null default now(),
  unique (tenant_id, subject_type, subject_id, notice_key)
);
alter table public.ms_notification_log enable row level security;
revoke all on public.ms_notification_log from authenticated, anon;   -- the cron's service role only

notify pgrst, 'reload schema';
commit;
```

**Rollback 304:** drops `ms_notification_log`, both functions, the obligations index, constraints and column, then `environmental_permits`. It loses every permit and the record of sent notices; export them first. Revert the code before running it.

### 305_ms_changes.sql

```sql
begin;

-- Mirrors normalizeLegalEntity() in packages/core (a PGlite test pins the two):
-- lower case, full stops and commas dropped, spaces collapsed.
create or replace function public.ms_normalize_legal_entity(p text)
returns text
language sql immutable
set search_path = pg_catalog
as $$
  select btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')), '[.,]', '', 'g'), '\s+', ' ', 'g'))
$$;

-- Management of change (MOC): one change, the records it touches, and who resolved each.
create table if not exists public.ms_changes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  facility_id      uuid,   -- null = the whole organization, as an ownership change is
  discipline       text not null default 'ems' check (discipline in ('ems','ohs','integrated')),
  kind             text not null check (kind in ('equipment','chemical','process','ownership_name','personnel','other')),
  title            text not null check (length(btrim(title)) between 1 and 200),
  description      text not null check (length(btrim(description)) between 1 and 4000),
  process_area     text check (process_area is null or length(btrim(process_area)) between 1 and 100),
  new_legal_entity text check (new_legal_entity is null or length(btrim(new_legal_entity)) between 1 and 300),
  effective_on     date,
  status           text not null default 'open' check (status in ('open','closed','cancelled')),
  requested_by     uuid references public.profiles(id) on delete set null,
  opened_at        timestamptz not null default now(),
  ended_at         timestamptz,
  ended_by         uuid references public.profiles(id),
  cancelled_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, id),
  constraint ms_changes_facility_fk foreign key (tenant_id, facility_id)
    references public.facilities (tenant_id, id) on delete set null (facility_id),
  constraint ms_changes_new_entity_iff_ownership check ((kind = 'ownership_name') = (new_legal_entity is not null)),
  constraint ms_changes_area_for_site_changes check (kind not in ('equipment','process') or process_area is not null),
  constraint ms_changes_ended check ((status = 'open') = (ended_at is null) and (ended_at is null) = (ended_by is null)),
  constraint ms_changes_cancel_reason check (
    (status = 'cancelled') = (cancelled_reason is not null and length(btrim(cancelled_reason)) > 0))
);

create table if not exists public.ms_change_impacts (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  change_id       uuid not null,
  -- hazard, control and asset are the ISO 45001 and Phase 4 seams; nothing creates them yet.
  target_type     text not null check (target_type in
                    ('permit','scope','policy','aspect','obligation','objective','asset','hazard','control')),
  target_id       uuid not null,
  step            text check (step in ('notify_agency','submit_transfer','confirm_holder')),
  step_order      smallint not null default 0,
  action_required text not null check (length(btrim(action_required)) between 1 and 500),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles(id),
  resolution_note text check (resolution_note is null or length(resolution_note) <= 2000),
  created_at      timestamptz not null default now(),
  unique (tenant_id, id),
  unique nulls not distinct (change_id, target_type, target_id, step),
  constraint ms_change_impacts_change_fk foreign key (tenant_id, change_id)
    references public.ms_changes (tenant_id, id) on delete cascade,
  constraint ms_change_impacts_resolved check ((resolved_at is null) = (resolved_by is null)),
  constraint ms_change_impacts_steps_are_permits check (step is null or target_type = 'permit')
);
create index if not exists idx_ms_change_impacts_change on public.ms_change_impacts (change_id, step_order);
create index if not exists idx_ms_change_impacts_target on public.ms_change_impacts (tenant_id, target_type, target_id);

-- ── Guards ───────────────────────────────────────────────────────────────
-- ms_changes_guard (before update):
--   * an ended change (closed or cancelled) is sealed;
--   * status -> 'closed' raises check_violation while any impact is unresolved;
--   * stamps ended_at := now(), ended_by := auth.uid() when the status leaves 'open'.
--
-- ms_change_impacts_guard (before insert or update):
--   * insert only while the change is open;
--   * update may set resolved_at and resolution_note only, once (resolved rows are sealed),
--     and only while the change is open; stamps resolved_at := now(), resolved_by := auth.uid();
--   * on resolution (D14):
--       permit step            -> a current ms_evidence row with subject_type 'ms_change_impact';
--       step 'confirm_holder'  -> ms_normalize_legal_entity(permit.holder_of_record)
--                                 = ms_normalize_legal_entity(change.new_legal_entity);
--       target 'scope'         -> the highest scope version for the change's discipline names the new entity;
--       target 'policy'        -> the highest policy version was signed on or after the effective_from of that scope version;
--       any other target       -> resolution_note is not blank.
--   Refusals raise check_violation with a sentence the route shows as-is.

-- ── Opening a change with its impacts, in one transaction (D12) ─────────
-- Invoker, so RLS applies: only an admin can open one. The impacts come from
-- changeImpacts() in packages/core; every target must exist in the same tenant.
create or replace function public.ms_open_change(p_change jsonb, p_impacts jsonb)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$ /* insert ms_changes from p_change; for each element of p_impacts, verify
         target_id exists in the target table for the change's tenant (raise
         foreign_key_violation otherwise), then insert into ms_change_impacts */ $$;
revoke all on function public.ms_open_change(jsonb, jsonb) from public, anon;
grant execute on function public.ms_open_change(jsonb, jsonb) to authenticated;

-- RLS: ms_changes R1 (facility-aware; null facility = whole organization).
--      ms_change_impacts: member read through the tenant; admin insert and update; no delete.
revoke delete on public.ms_changes, public.ms_change_impacts from authenticated, anon;
-- touch_updated_at on ms_changes; log_audit('id') on both tables.

notify pgrst, 'reload schema';
commit;
```

**Rollback 305:** drops both tables and both functions. It loses every change record; export them first.

### 306_ms_evidence_subjects.sql

```sql
begin;

alter table public.ms_evidence drop constraint if exists ms_evidence_subject_type_check;
alter table public.ms_evidence add constraint ms_evidence_subject_type_check check (subject_type in (
  'compliance_evaluation', 'environmental_permit', 'ms_change_impact',
  'compliance_calendar_event', 'compliance_obligation'));

-- Q3: set at upload, never changed. Downloads of a flagged file are limited
-- to owners and admins by the download route.
alter table public.ms_evidence add column if not exists export_controlled boolean not null default false;
-- ms_evidence_append_only() is re-created with export_controlled in its fixed-column tuple.

-- The subject must be open to new evidence (D15). compliance_evaluation keeps
-- its Phase 1 rule exactly; every new type must exist in the same tenant.
create or replace function public.ms_evidence_subject_open()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  case new.subject_type
    when 'compliance_evaluation' then
      -- unchanged from 299: sealed once the evaluation is complete
      null;
    when 'environmental_permit' then
      -- must exist in the tenant; refused once the permit is retired
      null;
    when 'ms_change_impact' then
      -- must exist in the tenant; FOR SHARE; refused once resolved or once its change has ended
      null;
    when 'compliance_calendar_event', 'compliance_obligation' then
      -- must exist in the tenant
      null;
  end case;
  return new;
end $$;

notify pgrst, 'reload schema';
commit;
```

The bodies sketched as comments here are written in full in the migration file. Each branch has a PGlite test.

**Rollback 306:** restores the Phase 1 trigger. It restores the check as `not valid`, so evidence already filed under the new subjects survives. It keeps the `export_controlled` column, because dropping it would silently lift the access rule on flagged files.

---

## 5. Domain logic signatures (`packages/core`)

```ts
// environmentalPermit.ts
export const PERMIT_PROGRAMS: readonly ['air','waste','wastewater','stormwater','spcc','epcra','other']
export const PERMIT_INSTRUMENTS: readonly ['permit','registration','plan']
/** Product policy from the EMS plan, not regulation: when the countdown escalates. */
export const RENEWAL_TIER_DAYS: readonly [180, 90, 30]
export type RenewalTier = 'none' | 180 | 90 | 30 | 'passed'

/** The renewal application due date when the permit gives one, else the expiry date; null when neither exists. */
export function renewalDeadline(p: { renewalApplicationDueOn: string | null; expiresOn: string | null }): string | null
/**
 * The tier `today` falls in for a deadline, the days left (negative once passed),
 * and the date the next, more urgent tier starts (null at 'passed').
 * 181 days left -> 'none'; 180 -> 180; 90 -> 90; 30 -> 30; 0 -> 30; -1 -> 'passed'.
 */
export function permitEscalation(deadline: string, today: string):
  { tier: RenewalTier; daysLeft: number; nextTierOn: string | null }
export type PermitStanding =
  | 'retired' | 'no_expiry' | 'current' | 'renewal_due' | 'renewal_submitted'
  | 'expired' | 'expired_renewal_pending'
export function permitStanding(p: PermitForStanding, today: string): PermitStanding
/** True when the holder differs from the legal entity in force; null when no scope is recorded. */
export function holderOfRecordMismatch(holder: string, legalEntityInForce: string | null): boolean | null
/** D17 rules (Q1 decides the empty case). */
export function permitsHealth(input: {
  permits: readonly PermitForStanding[]; conditionsOverdue: number; reviewOverdue: number;
  legalEntityInForce: string | null; today: string }): RegisterHealth
export function validatePermitInput(input: PermitInput): FieldError[]
/** Notices the nightly job owes today, keyed for ms_notification_log (D10). Pure: `alreadySent` is the claimed keys. */
export function renewalNoticesDue(permits: readonly PermitForNotice[], today: string,
  alreadySent: ReadonlySet<string>): RenewalNotice[]
export function conditionRemindersDue(conditions: readonly ConditionForNotice[], today: string,
  alreadySent: ReadonlySet<string>, leadDays?: number /* 14, Q5 */): ConditionReminder[]

// managementOfChange.ts
export const CHANGE_KINDS: readonly ['equipment','chemical','process','ownership_name','personnel','other']
export const TRANSFER_STEPS: readonly ['notify_agency','submit_transfer','confirm_holder']
export interface ImpactDraft { targetType: ImpactTargetType; targetId: string; step: TransferStep | null;
  stepOrder: number; actionRequired: string }
/** One three-step transfer checklist per active permit, in permit order then step order. */
export function ownershipChangeChecklist(permits: readonly { id: string; title: string; agency: string }[]): ImpactDraft[]
/** The plan's mocFanOut (D13). Throws NotImplementedError for discipline 'ohs'. */
export function changeImpacts(change: ChangeForFanOut, context: FanOutContext): ImpactDraft[]
/** What still blocks closing a change: the unresolved impacts. Empty = closable. */
export function changeCloseGaps(impacts: readonly { resolvedAt: string | null }[]): string[]
/** Mirrors the database's resolution rules (D14), so the page can say why before the round trip. */
export function impactResolutionGaps(impact: ImpactForResolution, context: ResolutionContext): string[]
export function validateChangeInput(input: ChangeInput): FieldError[]

// managementSystem.ts
export function normalizeLegalEntity(name: string): string
export function sameLegalEntity(a: string, b: string): boolean
```

### Boundary tests

| Function | Cases |
| --- | --- |
| `permitEscalation` | 181, 180, 91, 90, 31, 30, 1, 0 and −1 days; `nextTierOn` at each tier; a leap day; a year boundary |
| `renewalDeadline` | application date given, expiry only, neither |
| `permitStanding` | every standing, including expired with a renewal pending and a retired permit with a past expiry |
| `normalizeLegalEntity` | case, commas, full stops, repeated spaces, `&` kept, an accented name; pinned to the SQL function |
| `holderOfRecordMismatch` | equal after normalizing, different, no scope (null) |
| `permitsHealth` | each red, amber and green rule; empty per Q1 |
| `renewalNoticesDue` | one notice per tier crossed; nothing re-sent; a new deadline makes new keys; renewal submitted stops notices; business-critical recipients flagged |
| `conditionRemindersDue` | 15 vs 14 days; due today; overdue once only; a condition advanced to its next date |
| `changeImpacts` | each kind; an inactive permit and an obsolete aspect skipped; the process-area match ignores case; `ohs` throws |
| `ownershipChangeChecklist` | zero, one and three permits; step order |
| `impactResolutionGaps` | each D14 rule |
| `ms_advance_due_date` (SQL) | equal to `advanceDueDate` for every cadence across 31 January, 29 February 2028, 30 April and 31 December |

---

## 6. Tests and acceptance

- **Unit:** §5, plus the 6.1.3 readiness rule and its two signals, plus `policySignatoryStale` on the shared normalizer.
- **Database (PGlite, `emsPhase2.db.test.ts`):**
  - RLS: a member reads, a viewer cannot write, an admin writes.
  - **Cross-tenant refusals:** linking an obligation to another tenant's permit; `ms_open_change()` with a target in another tenant.
  - `permit_id` requires `source_kind = 'permit'`.
  - Occurrences:
    - the owner may record one, another member may not, and an admin may;
    - the due date advances exactly as `advanceDueDate`;
    - a `once` obligation completes.
  - The notification-log key is unique.
  - Changes and impacts:
    - closing a change with an open impact is refused;
    - "confirm holder" is refused until the holder is updated;
    - a transfer step without evidence is refused;
    - resolved impacts and ended changes are sealed.
  - Every evidence subject rule; export-controlled is immutable.
  - Tenant deletion cascades.
  - Re-running 304–306 changes nothing; each rollback restores the previous shape.
- **API:** every route's gate, validation and tenant isolation (tenant B gets 404 and writes nothing), and the 409 messages for refusals.
- **Cron:**
  - each tier notifies once;
  - a departed owner falls back to the admins;
  - business-critical recipients follow D8;
  - condition reminders and suppression;
  - a failed send releases its claim;
  - the upload sweep (Q2).
- **End to end (route level, `emsPermits.e2e.test.ts`):**
  1. Create a permit whose deadline is 29 days away, and add a quarterly condition.
  2. Run the job: the owner gets one digest naming the 30-day permit; running it again sends nothing.
  3. Mark the condition done with evidence: the due date moves on one quarter.
  4. Open an ownership change: three steps per permit, plus the scope and policy impacts.
  5. "Confirm holder" is refused. Update the permit's holder of record, and it resolves.
  6. Closing is refused until the last impact is resolved, then it closes.
- **Pages:** permits list and detail, changes list and detail, and the hub cards (Testing Library), including the race guard on the checklist.
- **Acceptance on the Northfield demo:**
  - The permits register shows the stormwater permit's holder-mismatch badge and the wastewater permit's 30-day badge.
  - Opening an ownership change produces five transfer checklists plus the scope and policy impacts.

## 7. Implementation order (after "go")

Small commits, prefixed `ems(phase2):`. Lint, typecheck and the full suite run before each commit.

1. Domain logic and its tests.
2. Migrations 304–306 with rollbacks and the PGlite suite. **Printed for approval; not applied.**
3. Permit and condition routes, occurrences, evidence subjects (plus Q2 and Q3 if accepted), with tests.
4. Change routes and the fan-out, with tests.
5. The nightly job and the digest email.
6. The pages, hub cards, readiness rule, wiki and guide.
7. The Northfield seed, the e2e test, the repo map.
8. Adversarial review (database and security, ISO 14001, UI), fixes, the full CI-equivalent run, then the draft PR with the Definition-of-done checklist.

### Rollout (in the PR)

1. After the 1.20.0 stack is deployed, apply 304, 305 and 306. All three are additive, and the old code ignores them.
2. Deploy.
3. Optionally re-seed the Northfield demo.
4. Phase 2 reaches customers in 1.21.0, through its own release PR.

## 8. Deviations from the master plan

| Master plan | This plan | Why |
| --- | --- | --- |
| `ems_permit` | `environmental_permits` | ADR 0001 Q7 |
| `ems_permit_condition` and a "materialize" endpoint | Conditions are obligation rows with `permit_id` (D3) | Reuse: the register, evaluation and recurrence already exist |
| `ems_moc`, `ems_moc_impact` | `ms_changes`, `ms_change_impacts` | Shared core, with plural names like Phase 1's `ms_` tables |
| "Create a renewal task" | The permit row is the task, plus tiered notices (D7, D10) | There is no task model (Phase 1 D5) |
| "Notify the site lead role" | The Compliance obligations process holder, then owners and admins (D8) | No such role exists |
| Ownership change touches permits and scope | Adds the policy (D13) | Lesson L3 |
| Equipment change touches "SPCC-relevant assets" | Aspects only | Environmental asset profiles arrive in Phase 4 |
