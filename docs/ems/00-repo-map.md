# EMS repo map (Phase 0 discovery)

This file answers the nine Phase 0 discovery questions in
[EMS_IMPLEMENTATION_PLAN.md](./EMS_IMPLEMENTATION_PLAN.md) with file paths and one
excerpt each, then inventories the ISO 14001 features the repo already ships.
Keep it current: every phase updates it when it learns something new.

**As of:** 2026-10-01, `main` at `7c26827` (v1.19.0).

**The one finding that changes the plan:** the plan assumes a greenfield EMS, but the
repo already has an `environmental` (ISO 14001) module plus hazardous waste,
chemicals, a generic inspection engine, a compliance calendar, training, and an
audit log. Section 10 maps each plan entity to what exists.
[ADR 0001](./adr/0001-build-on-the-existing-environmental-module.md) proposes how to
reconcile them, and nothing is scaffolded until it is decided.

---

## 1. Database, ORM, migrations

- **Database:** Supabase Postgres (project `zwtnpyjifbdytlektxlc`, per `.mcp.json`).
- **No ORM.** Queries use `@supabase/supabase-js` directly.
  - Client factory: `packages/core/src/supabase.ts`.
  - Service-role client: `apps/web/lib/supabaseAdmin.ts`.
  - Query helpers: `packages/core/src/queries/*.ts`.
- **Generated types:** `packages/core/src/database.types.ts`, from
  `npm --workspace web run db:types`. Nothing imports them, and they are stale:
  they lack the hazard-hunt and contingency-plan tables.
- **Migrations** are raw SQL in `apps/web/migrations/NNN[a-z]?_slug.sql`.
  - The latest is `293_release_note_v1_19_0.sql`.
  - `seed_*.sql` and `data_hygiene_*.sql` are unnumbered and applied by hand.

| Action | Command |
| --- | --- |
| Next number | `npm run migration:next <slug>` (`scripts/next-migration-number.mjs`) |
| Validate numbering | `npm run check:migrations` (`scripts/check-migration-numbers.mjs`, part of `check:repo` and CI) |
| Apply | By hand, with no CI step. Use Supabase MCP `apply_migration` or `supabase migration up` so the ledger records it; a SQL Editor paste leaves no record (`docs/audits/migration-reconciliation-2026-08-28.md` §6) |
| Roll back | No down sections. A reversible change ships a separate hand-applied `NNN_rollback.sql` (e.g. `029_rollback.sql`, `249_rollback.sql`) |
| Drift check | `SUPABASE_DB_URL=… node scripts/check-migration-drift.mjs` (opt-in, not in CI) |

House rules (`docs/runbooks/versioning.md` §4):

- Migrations are forward-only and idempotent: `create table if not exists`, and `drop policy if exists` before `create`.
- Each runs inside `begin; … commit;` and ends with `notify pgrst, 'reload schema';`.
- Every domain table gets RLS plus `touch_updated_at` and `log_audit('id')` triggers.

```js
// scripts/check-migration-numbers.mjs:34-41
const numbered = files.filter(n => /^\d/.test(n) && !/_rollback\.sql$/.test(n))
const PREFIX_RE = /^(\d{3}[a-z]?)_[a-z0-9_]+\.sql$/
const malformed = numbered.filter(n => !PREFIX_RE.test(n))
```

**Plan impact:** "every migration has a down migration" becomes a companion
`NNN_rollback.sql` per EMS migration.

## 2. Tenant and site keys

- **Tenant:** every domain table has `tenant_id uuid not null references tenants(id)`.
  - Migrations 027–029 add it; since 052 it defaults to `public.active_tenant_id()`.
  - `tenants.tenant_number` (`'0001'`) is a display id only.
- **Site:** `facilities` (`209_facilities.sql`). Domain tables carry a nullable
  `facility_id` that defaults to `public.active_facility_id()` (migrations 210/211).
  There is no `site_id`.
  - `department` is free text on `loto_equipment`, not a table.
- **Injection:** the client fetch wrapper sends `x-active-tenant` and `x-active-facility`
  headers (`packages/core/src/supabase.ts:107-118`). SECURITY DEFINER helpers then
  scope rows: `current_user_tenant_ids()`, `active_tenant_id()`, `active_facility_id()`
  and `is_superadmin()`.
  - App code also adds an explicit `.eq('tenant_id', …)`.
  - There is no JWT tenant claim.
- **API authorization:** routes call one of three gates in `apps/web/lib/auth/tenantGate.ts`.
  - `requireTenantMember` (line 176), `requireTenantAdmin` (180), `requireTenantModuleMember` (184).
  - Each returns `{ tenantId, facilityId, role, authedClient }`.
  - Routes that switch to `supabaseAdmin()` rely on the gate plus `.eq('tenant_id', gate.tenantId)`.

```ts
// packages/core/src/queries/equipment.ts:29-37 (LOTO repository function)
export async function loadAllEquipment(tenantId: string): Promise<Equipment[]> {
  const activeTenantId = requireTenantId(tenantId, 'loadAllEquipment')
  const result = await supabase
    .from('loto_equipment')
    .select('*')
    .eq('tenant_id', activeTenantId)
    .order('equipment_id', { ascending: true })
  return unwrap(result as { data: Equipment[] | null; error: { message: string } | null }, 'loadAllEquipment')
}
```

The standard RLS policy is generated per table in `211_facility_rls_scope.sql:61-73`:
tenant match, membership or superadmin, and facility match or null.

**Plan impact:** the plan's `site_id` is `facility_id`. The existing EMS tables
from migrations 204–207 have **no** `facility_id`; migration 210 skipped them.

## 3. Asset model

- **Table:** `loto_equipment` is the only asset register. No migration in the repo
  creates it; it predates the chain.
  - Live columns are listed in `packages/core/src/database.types.ts`.
  - The TypeScript shape is `packages/core/src/types.ts` (`Equipment`).
- **Keys:** `id uuid` and natural key `equipment_id text`. Code addresses rows as `(tenant_id, equipment_id)`.
- **Type discriminator:** `equipment_family`, default `'general'` (`118_equipment_readiness.sql:13`).
- **QR:** `qr_token text not null unique`, auto-generated (`106_equipment_qr.sql`).
  - Public scans go through `get_placard_by_qr` (migration 215).
- **Location:** `department` and `facility_id`. No area or coordinates in repo migrations.
- **Inspections:** Equipment Readiness tables FK `equipment_record_id → loto_equipment(id)`
  (migrations 118/121). LOTO periodic and walkdown records key on `equipment_id text`.
- **Photos:** URL columns on the row (`equip_photo_url`, `iso_photo_url`) in the
  `loto-photos` bucket.
- **Precedent:** Equipment Readiness already treats `loto_equipment` as a general
  asset identity. That is the hook for the plan's `ems_asset_env_profile`.

```sql
-- apps/web/migrations/118_equipment_readiness.sql:3-13
-- The existing loto_equipment table remains the asset identity source; these tables
-- add readiness, versioned checklist templates, inspection records, evidence, ...
alter table public.loto_equipment
  add column if not exists equipment_family text not null default 'general'
```

## 4. Inspection, evidence, document, task, notification, incident, audit-log models

| Model | Tables (migration) | Service code | Mobile? |
| --- | --- | --- | --- |
| Inspections, generic | `inspection_templates`, `inspection_template_items`, `inspections`, `inspection_responses` (193). `subject_type`/`subject_id` is a soft text link | `packages/core/src/inspectionScoring.ts`; `apps/web/app/api/inspections/**` | No |
| Inspections, scheduled | `hazard_hunt_schedules` (275, daily/weekly/monthly), `hazard_hunt_findings` (276) | `packages/core/src/hazardHunt.ts`; cron `apps/web/app/api/cron/hazard-hunt-generate` | No |
| Inspections, other | `equipment_inspections` (118), `hazardous_waste_inspections` (142), `loto_periodic_inspections` (148), `fleet_vehicle_inspections` (203), `wah_inspections` (188) | per module | No |
| Evidence / photos | No unified table. `equipment_evidence` (118, polymorphic), `incident_attachments` (061), `photo_urls[]` columns. SHA-256 only on `loto_signed_pdf_artifacts` (150), `em385_document_files` (231), `chemical_sds_documents` (089) | `packages/core/src/photoUpload.ts`, `storagePaths.ts`, `signedArtifactHash.ts` | LOTO photos only |
| Documents | No controlled-document register (`apps/web/lib/iso14001Signals.ts:23`: `DOCUMENTS_REGISTER_LIVE = false`). Nearest pattern: `em385_register_items` + `em385_document_files` | `packages/core/src/em385.ts` | No |
| Tasks / actions | No unified task table. Per module: `incident_actions` (063), `incident_capas` (152), `nonconformity_actions` (206), `equipment_defects` (118) | `incidentAction.ts`, `incidentCapa.ts`, `nonconformity.ts` | No |
| Notifications | Push: `loto_push_subscriptions` (016) via `apps/web/lib/notifications/pushFanout.ts`. Email: Resend via `apps/web/lib/email/*`. In-app `notifications` (106) has no reader UI | `dispatchPushToProfiles`, `send*.ts` | No |
| Incidents | `incidents` (059), with `incident_type` including `'environmental'` and spill fields, plus about 25 `incident_*` child tables | `packages/core/src/incident*.ts`; `apps/web/app/api/incidents/**` | Legacy `near_misses` only |
| Audit log | `audit_log` (003, `tenant_id` added in 027), written by the `log_audit(pk)` trigger. 96 `trg_audit_*` triggers in repo migrations, including all of 204–207 | readers: `apps/web/app/admin/evidence/audit/page.tsx`, `apps/web/app/api/admin/audit-summary/route.ts` | Server-side triggers |
| Scheduled jobs | Vercel crons in `apps/web/vercel.json` (25 registered) → `apps/web/app/api/cron/*` (32 routes). Bearer `CRON_SECRET` auth, wrapped in `withCronLogging`. Plus `pg_cron` prune jobs (242) | `apps/web/lib/cronInstrumentation.ts` | n/a |

```sql
-- apps/web/migrations/193_inspection_templates.sql:48-56
create table if not exists public.inspections (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  template_id      uuid not null references public.inspection_templates(id) on delete restrict,
  template_version int not null,
  title            text not null,
  subject_type     text,
  subject_id       text,
```

**Plan impact:**

- Reuse `audit_log`; do not add `ms_audit_log`.
- `ms_evidence` (append-only, hashed) is genuinely new.
- Inspection templates should extend the migration 193 engine, which needs cadence, an asset subject, and photo upload.

## 5. API convention

- **Style:** Next.js App Router route handlers only. There are 359 `apps/web/app/api/**/route.ts`
  files, no tRPC, and no server actions.
- **Validation:** hand-rolled coercion in the route, then a pure validator in
  `packages/core` that returns `FieldError[]`. zod is installed but no route uses it.
- **Error shape:** `NextResponse.json({ error: string }, { status })`. Newer routes use
  `apps/web/lib/security/sanitizeError.ts` so raw database messages don't leak.
- **Middleware:** `apps/web/proxy.ts` (Next 16) only checks Origin against Host on mutating
  `/api/*` calls. Auth is the per-route gate (Q2).
- **Disabled module:** `requireTenantModuleMember` returns **403**
  `"Module is not enabled for this tenant"`, not 404.
- **Split:** the existing `environmental` pages have **no API routes**. They write through
  the browser Supabase client under RLS. Hazardous waste and chemicals go through `/api`.

Template route, `apps/web/app/api/hazardous-waste/streams/route.ts` (abbreviated):

```ts
export async function POST(req: Request) {
  const gate = await requireTenantModuleMember(req, 'hazardous-waste')
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  // ...hand-coerce into HazardousWasteStreamInput
  const errors = validateHazardousWasteStreamInput(input)          // @soteria/core
  if (errors.length > 0) return NextResponse.json({
    error: errors.map(e => `${e.field}: ${e.message}`).join('; ') }, { status: 400 })
  const { data, error } = await supabaseAdmin().from('hazardous_waste_streams')
    .insert({ tenant_id: gate.tenantId, created_by: gate.userId, updated_by: gate.userId, ...input })
    .select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ stream: data }, { status: 201 })
}
```

## 6. Mobile offline mechanism

**The mobile app has no offline queue.** It has no outbox, sync loop, SQLite, MMKV or
NetInfo.

- **LOTO photo capture is online-only.** `apps/mobile/components/PhotoCaptureSheet.tsx`
  uploads through `uploadPhotoForEquipment`.
  - It retries 3 times in memory (1s, 2s, 4s; `packages/core/src/photoUpload.ts:7-24`).
  - If all three fail, it shows an alert and drops the photo.
- **Conflicts:** none are handled. Writes are last-writer-wins on the `loto_equipment`
  URL columns, with no idempotency keys.
- **Only local storage:** an AsyncStorage draft on `apps/mobile/app/(tabs)/hazardous-waste.tsx`.
  It is never uploaded.
- **The real offline queue is on the web PWA:**
  - `apps/web/lib/uploadQueue.ts` is an IndexedDB store with client-generated ids.
  - `apps/web/components/UploadQueueProvider.tsx` drains it on `online`, `focus` and `visibilitychange`.
- **Known gap:** `docs/mobile-parity-plan.md` lists this as Tier 3: "Offline-first foundation".

```ts
// apps/web/lib/uploadQueue.ts:53
export async function enqueueUpload(entry: Omit<QueuedUpload, 'id' | 'createdAt'>): Promise<string> {
```

**Plan impact:**

- The "Offline parity with LOTO" guardrail and Phase 4's "mirror LOTO field capture exactly" assume a mobile mechanism that does not exist.
- Phase 4 either builds the offline foundation first or starts from the web PWA queue (ADR 0001, question Q5).

## 7. Feature flags

- **Catalog:** `FEATURES` in `packages/core/src/features.ts`, with fields
  `id, href, parent, enabled, comingSoon, internal`.
- **Per-tenant override:** `tenants.modules jsonb` (027). Superadmins write it through
  `PATCH /api/superadmin/tenants/[number]` and `POST /api/superadmin/tenants/bulk-modules`.
  - The `tenant_features` table the header comment mentions was never built.
  - `resolveFeatureFlags` is a stub.
- **Resolver:** `isModuleVisible` in `packages/core/src/moduleVisibility.ts`.
  - A module with no override uses its default: visible, unless `FeatureDef.defaultEnabled`
    is `false` (opt-in; added in Phase 0, ADR 0001 Q2).
  - `isVisibleByDefault(def)` is that default. The superadmin form seeds its checkboxes with it.
  - Children inherit their parent's resolution.
- **Guards:**
  - Pages: `apps/web/components/ModuleGuard.tsx` (client-side "not enabled" screen) in each module `layout.tsx`.
  - APIs: `requireTenantModuleMember`.
  - Nav: `apps/web/lib/navigationCatalog.ts` → `AppDrawer.tsx`, `CommandPalette.tsx`.
- **Mobile ignores flags.** Its tabs are hard-coded.
- **The EMS flag:** module id `environmental` ("Environmental (ISO 14001)"). It is opt-in
  since Phase 0. Migration `294_environmental_module_opt_in.sql` kept it on for tenants
  that already had environmental records. `GET /api/environmental/health` reports it.

```ts
// packages/core/src/moduleVisibility.ts:17-33
export function isModuleVisible(featureId: string, tenantModules: Record<string, boolean> | null | undefined): boolean {
  const def = getFeature(featureId)
  if (!def) return false
  if (!def.enabled) return false  // hard global disable
  if (def.parent) return isModuleVisible(def.parent, tenantModules)
  if (tenantModules && featureId in tenantModules) {
    return tenantModules[featureId] === true
  }
  return true
}
```

**Plan impact:** resolved in Phase 0. `environmental` is the plan's `ems_module`, and it is
off by default.

## 8. Tests, CI, lint, format

| What | Where / command |
| --- | --- |
| Runner | Vitest 4 only. No Jest, and **no Playwright or browser e2e** |
| Web tests | `apps/web/__tests__/**` (~380 files; config `apps/web/vitest.config.ts`, jsdom). `npm test` |
| Core tests | `packages/core/src/__tests__/**`. `npm run test:core` |
| "e2e" tests | `apps/web/__tests__/e2e/*.e2e.test.ts(x)`: route-level Vitest with mocked Supabase |
| Mobile | No tests. `npm run typecheck --workspace mobile` |
| Typecheck | `npm --workspace web exec -- tsc --noEmit` |
| Lint | `npm run lint` (ESLint flat config `apps/web/eslint.config.mjs`) |
| Format | No Prettier, Biome, or pre-commit hooks |
| Repo checks | `npm run check:repo` (migrations, manuals, nav, version, deeplinks), plus `npm run check:wiki` |
| CI | `.github/workflows/repo-health.yml`. Job `checks`: `check:repo`, mobile typecheck, `check:wiki`. Job `verify`: typecheck, lint, `npm test`, `test:core`, build. CI applies no migrations |

```yaml
# .github/workflows/repo-health.yml:65-75
      - name: Typecheck
        run: npm --workspace web exec -- tsc --noEmit
      - name: Lint
        run: npm run lint
      - name: Test
        run: npm test
      - name: Test packages/core
        run: npm run test:core
```

**Plan impact:** the per-phase "end-to-end test" maps to this repo's route-level
`*.e2e.test.ts` convention unless a browser framework is added (ADR 0001, question Q6).

## 9. Design system and navigation

- **Web components:** shadcn (`apps/web/components.json`, style `base-nova`, on `@base-ui/react`).
  - A migration to Adobe Spectrum tokens and React Aria is in progress.
- **Web libraries:** Tailwind v4 (no config file) and lucide icons.
  - Charts: **recharts**. PDFs: **pdf-lib** (`apps/web/lib/pdf*.ts`). Spreadsheets: exceljs.
- **Web routes:** flat module folders, e.g. `apps/web/app/environmental/{aspects,objectives,…}`.
  - **There are no route groups.** The plan's `(ms)`, `(ems)` and `(ohs)` groups would be the first.
  - Each module's `layout.tsx` wraps `ModuleGuard` and `ModuleHeaderAccent`.
- **Web nav:** `FEATURES` → `apps/web/lib/navigationCatalog.ts` (`getNavigationGroups`,
  hand-kept `MODULE_GROUPS`) → `apps/web/components/AppDrawer.tsx`.
- **Mobile:** expo-router (SDK 57) with a bottom `Tabs` bar of 8 hard-coded screens
  (`apps/mobile/app/(tabs)/_layout.tsx`). There is no UI kit and no `features/` folder;
  modules are not driven by `features.ts`.

```ts
// apps/web/app/environmental/layout.tsx
export default function EnvironmentalLayout({ children }: { children: ReactNode }) {
  return (
    <ModuleGuard moduleId="environmental">
      <ModuleHeaderAccent moduleId="environmental" />
      {children}
    </ModuleGuard>
  )
}
```

---

## 10. What already exists, mapped to plan entities

"Extend" means the table exists and needs columns or a child table; "New" means no
equivalent exists.

| Plan entity | Existing (migration) | Verdict and main gap |
| --- | --- | --- |
| `ems_aspect`, `ems_aspect_score` | `environmental_aspects` (204) | Extend. There is one `operating_condition` column per aspect, and the 5×5 scale and ≥12 threshold are hard-coded in generated columns. Missing: per-condition score history, review dates, obsolete state, `facility_id` |
| `ms_scoring_method` | None | New |
| `ms_objective`, `_progress` | `environmental_objectives`, `environmental_objective_readings` (205) | Extend: single aspect link, no evidence on readings, no edit UI |
| `ms_capa` | `nonconformities` + `nonconformity_actions` (206). Two incident-only CAPA systems also exist (`incident_capas` 152, `incident_actions` 063) | Extend: add root cause, effectiveness check, typed source link (ADR Q4) |
| `ms_mgmt_review` | `management_reviews` (207) | Extend: inputs are free text, with no snapshot |
| Readiness dashboard | `packages/core/src/iso14001Readiness.ts`, `/environmental/report-card` | Extend: already scores 19 clauses with signal flags |
| `ms_obligation`, `ms_compliance_eval` | `compliance_calendar_obligations` and `_events` (192). Production also holds an out-of-band `legal_register` / `compliance_obligations` with no repo migration | Extend the calendar, or formalize the legacy legal register (ADR Q3) |
| `ms_inspection_template`, `ms_inspection` | Generic engine (193); hazard-hunt scheduler (275) | Extend: add cadence (quarterly), asset subject, photo upload, fail → CAPA |
| `ems_asset_env_profile` | `loto_equipment` (via Equipment Readiness precedent); `hazardous_waste_areas` (142) for SAA/CAA | New profile table on `loto_equipment` |
| `ems_waste_stream`, `ems_waste_container` | `hazardous_waste_streams`, `hazardous_waste_containers` (140, 269, 272) with accumulation clocks in `packages/core/src/hazardousWaste.ts` | Extend: no generation log, no `labeled`, no asset link |
| Generator status | Manual, in `facilities.settings.hazardous_waste` | New: derive it from a monthly generation log |
| `ems_manifest` | None (`packages/core/src/ldrNotice.ts:8`) | New |
| `ms_chemical` (Tier II / TRI) | `chemical_products`, `chemical_inventory_items` (089/091), `v_chemical_tier_two` (093/271) | Extend: no EHS/TPQ flag, threshold check, TRI category or pounds conversion |
| `ms_training_*` | `loto_training_records` (017), `training_courses` (240), `v_training_matrix` | Extend: no environmental roles, no citation, no evidence link |
| `ms_evidence` | Fragments only (see Q4) | New |
| `ms_audit_log` | `audit_log` (003) | Reuse |
| `ms_context_issue`, `ms_interested_party`, `ms_scope`, `ms_policy` | None (`risks` is a 4.1 proxy; readiness hard-codes `policyApproved: false`) | New |
| `ms_moc`, `ms_moc_impact` | None (only `'moc'` enum values on `risks` / `risk_reviews`) | New |
| `ems_permit`, `ems_permit_condition` | None. "Permit" already means permit-to-work here (`loto_hot_work_permits`, `loto_confined_space_permits`, `loto_group_permits`, `wah_permits`) | New: name it to avoid the collision |
| `ms_internal_audit`, `_finding` | None (`AUDIT_PROGRAMME_LIVE = false`); NCs carry `source_type='internal_audit'` | New |
| `ms_drill` | None (`wah_rescue_plans` drill dates only) | New |
| `discipline` column | None anywhere | New, per the plan's 45001 seams |

The plan's `ohs_*` placeholders also have partial equivalents already: `risks`, `jhas`,
`risk_controls`/`controls_library`, `loto_contractor_companies`, `vendor_prequalifications`
and `iso45001_clause_evidence` (154). Phase 8 should start from those.

## 11. Pre-existing defects noticed during discovery (not fixed here)

These sit outside EMS scope. They are recorded so they don't get lost; each deserves
its own PR.

1. **`log_audit()` never writes `tenant_id`.** The only definition is in
   `003_auth_profiles_audit.sql`, and it inserts without the column. Tenant admins
   therefore see an empty audit trail. This undercuts the plan's audit-trail
   guardrail. Already noted in `docs/audits/auth-security-sweep-2026-08-28.md`.
2. **The Hazard Hunt generator cron is not registered.**
   `apps/web/app/api/cron/hazard-hunt-generate/route.ts:15` says "Schedule (vercel.json):
   daily", but `apps/web/vercel.json` has no entry for it, so scheduled hunts never generate.
3. **The AI tool reads the wrong table.** `compliance_obligations_due`
   (`apps/web/lib/ai/tools/index.ts`) reads the out-of-band legacy `compliance_obligations`
   table, not the `compliance_calendar_*` tables the UI writes.
4. **Some LOTO routes skip `ModuleGuard`:** `/equipment/[id]`, `/departments`,
   `/status` and `/print`.

Live-database state can differ from the repo because of known migration drift
(`docs/audits/migration-reconciliation-2026-08-28.md`). Items 1 and 3 were checked
against the repo only.
