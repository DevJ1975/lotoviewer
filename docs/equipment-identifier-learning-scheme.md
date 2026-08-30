# Equipment-Identifier Learning Scheme

> **Status: DEFERRED — do not implement before client go-live.**
> This is a design document only. It describes a data-capture foundation for a future
> equipment-identifier model. **No schema, route, or pipeline changes have been applied.**
> Execute the build in a **supervised learning session**, on a Supabase dev branch first.
> The client begins live use of the existing scanner immediately, so this work must wait
> until it can be applied and verified under supervision.

## Change Log

Append a dated row on every revision and at implementation. This table is the running
record of the scheme's evolution up to (and through) the supervised build session.

| Date       | Author | Change                                                              |
|------------|--------|---------------------------------------------------------------------|
| 2026-06-01 | jamil  | Initial scheme drafted. Decisions locked: build capture foundation; pool samples globally; capture confirm-vs-correct outcome; seamless + non-destructive; paired rollback. Implementation deferred to a supervised session (client go-live tomorrow). |

## Decisions locked (for the supervised session)

1. **Deliverable:** build the data-capture *foundation* now (when executed) — corpus +
   reward-signal tables, capture wiring, export. **Online retrieval / re-ranking is a later
   phase** and is out of scope here.
2. **Data governance:** **pool samples globally** for the future SaaS model from the start
   (no per-tenant opt-in gate this phase).
3. **Reward signal:** capture the **confirm-vs-correct outcome** (which candidate the human
   accepted), not a full per-field extraction diff.
4. **Constraints:** **seamless** (fire-and-forget capture; zero added latency / no new
   failure mode on any user-facing path) and **non-destructive** (append-only; never
   overwrite a label or delete a photo), with a **paired `*_rollback.sql`**.

---

## Context

**Why this is needed.** The client is about to re-photograph equipment across sites,
*replacing* existing photos. Today that campaign destroys value instead of capturing it, and
the equipment-identification "agent" has no learning loop:

- **`/api/assistant/scan-photo`** (`apps/web/app/api/assistant/scan-photo/route.ts`) is a
  *stateless* Claude Sonnet vision call. It extracts `{equipment_id, brand, model, serial,
  type, voltage, confidence, notes}`, `ilike`-matches `loto_equipment.equipment_id`, returns
  candidates — then **throws away the scanned image, the extraction, and which candidate the
  human actually confirmed.** Only token counts hit `ai_invocations` (migration 047). There
  is no reward signal.
- **Photo replacement loses labeled data.** Uploads land on a *timestamped* path
  (`packages/core/src/storagePaths.ts`, `upsert:false`), so old photo **bytes survive** in the
  `loto-photos` bucket — but `equip_photo_url`/`iso_photo_url` get overwritten and the DB
  pointer is lost. Every re-photograph is a **ground-truth labeled pair**
  (image → equipment_id / type / make / model / department / site) currently orphaned.

**Intended outcome.** A *capture foundation* so labeled data and a reward signal start
accumulating *before* the next site, ready to fine-tune a future SaaS equipment-identifier
model. This phase only *captures and curates* the dataset + reward signal, plus an export.

## Reuse (do not reinvent)

- pgvector + HNSW + RPC pattern: `apps/web/migrations/105_knowledge_base.sql` (mirror table +
  RLS shape; **no embedding column this phase** — retrieval is deferred).
- `ai_invocations` logging + `logAiInvocation`: `apps/web/lib/ai/rateLimit.ts`.
- Storage-path single-source-of-truth: `packages/core/src/storagePaths.ts`.
- Upload pipeline (single capture hook point): `packages/core/src/photoUpload.ts`.
- Tenant gate: `requireTenantMember` (`apps/web/lib/auth/tenantGate.ts`); admin client
  `supabaseAdmin()` (`apps/web/lib/supabaseAdmin.ts`).
- Export precedent: `apps/web/app/api/superadmin/tenants/[number]/export/route.ts`.
- Migration rollback convention: `*_rollback.sql` companions (see
  `scripts/check-migration-numbers.mjs`).
- `loto_equipment` already has uuid PK `id`, plus `facility_id` (migration 210) = the **site**
  label — samples get site partitioning for free.

> Migration number: `213` is the next free prefix as of 2026-06-01 (highest is
> `212_hazardous_waste_inspection_photos.sql`). **Re-check the next free prefix at
> implementation time** in case other migrations have merged.

## Schema — migration `213_equipment_training_corpus.sql` (additive only)

Two new tables. **No existing table or column is altered.**

### A. `equipment_photo_samples` — the labeled corpus (the flywheel)

Append-only; one row per captured photo of a *known* piece of equipment.

- `id uuid pk`, `tenant_id uuid not null → tenants`, `facility_id uuid → facilities` (site;
  nullable = shared).
- `equipment_pk uuid → loto_equipment(id)` (stable FK), `equipment_id text not null`
  (denormalized human id *at capture time*).
- `slot text not null check in ('EQUIP','ISO','SCAN')`, `storage_bucket text not null
  default 'loto-photos'`, `storage_path text not null`.
- Labels **frozen at capture time** (so later edits never rewrite history):
  `label_description`, `label_department`, `label_manufacturer`, `label_model`,
  `label_equipment_type` (all `text`).
- Provenance/curation: `label_source text not null check in
  ('admin_upload','scan_pending','scan_confirmed','curated')`, `captured_by uuid → profiles`,
  `captured_at timestamptz not null default now()`, `is_gold boolean not null default false`,
  `split text check in ('train','val','holdout')` (assigned at export), `superseded_at
  timestamptz` (set when a newer EQUIP/ISO sample becomes the row's current photo — **prior
  row is retained, never deleted**).
- `unique (storage_path)` → idempotent capture / safe re-runs.
- Indexes: `(tenant_id, equipment_pk, slot, captured_at desc)`, `(tenant_id, facility_id)`,
  partial `where is_gold`.

### B. `equipment_scan_feedback` — the reward signal (confirm vs. correct)

One row per scan inference + human decision.

- `id uuid pk`, `tenant_id uuid not null → tenants`, `user_id uuid not null → auth.users`.
- `ai_invocation_id bigint → ai_invocations(id)`, `sample_id uuid → equipment_photo_samples`
  (the SCAN image row).
- Prediction: `predicted_equipment_id text`, `predicted_confidence text`,
  `candidate_count int not null default 0`, `top_candidate_equipment_id text`.
- Decision (the reward): `resolved_equipment_id text` (ground truth; null if abandoned),
  `outcome text not null check in
  ('confirmed_top1','confirmed_other_candidate','manual_override','abandoned')`,
  `created_at timestamptz not null default now()`.
- Reward is **derived, not stored** (outcome is the source of truth) — a read-only view
  `equipment_identification_metrics` computes top-1 hit rate / correction rate / abandonment /
  corpus growth per tenant+facility+day for the dashboard. (KISS: "measure before optimizing.")

### RLS (additive; existing policies untouched)

- Tenant members `select`/`insert` rows for their own `tenant_id` (defense-in-depth);
  superadmin all. Server routes use `supabaseAdmin()` and bypass RLS.
- **Pooled globally**: the export/training reads cross-tenant via service role — no per-tenant
  opt-in gate this phase (per decision).

### Rollback — `213_equipment_training_corpus_rollback.sql` (paired companion)

```sql
begin;
drop view  if exists public.equipment_identification_metrics;
drop table if exists public.equipment_scan_feedback;
drop table if exists public.equipment_photo_samples;
notify pgrst, 'reload schema';
commit;
```

Drops only the objects `213` created; touches no pre-existing table. Storage objects written
by capture (the `scans/` prefix) are inert without the tables and can be left or pruned
manually.

## Capture wiring (seamless = fire-and-forget; non-destructive = append-only)

1. **Upload capture** — `packages/core/src/photoUpload.ts`. *After* the existing
   UPDATE + reconcile (user-facing success already returned), in a `try/catch that never
   rethrows`, insert an `equipment_photo_samples` row (`slot=EQUIP|ISO`,
   `label_source='admin_upload'`, `storage_path` = the already-timestamped path) and stamp the
   prior current-slot sample `superseded_at=now()` (retained). Extend the existing `current`
   select to also read `description, department, manufacturer, model` for the frozen labels.
   **Do not** change `upsert:false`, delete bytes, or touch existing columns. This is the
   goldmine: every re-photograph at a future site becomes a labeled sample automatically.

2. **Scan capture** — `app/api/assistant/scan-photo/route.ts`. Persist the scanned image
   (currently discarded) to a new non-destructive path via `supabaseAdmin().storage` — add
   `scanSamplePath(tenantId, ts)` → `<tenant>/scans/<ts>.jpg` to `storagePaths.ts`. Insert a
   `slot='SCAN'`, `label_source='scan_pending'` sample (labels null until resolved). Have
   `logAiInvocation` return the inserted `bigint` id (small additive change). Return new
   `sample_id` (and `scan_id`) in the JSON response. All wrapped so a capture failure cannot
   fail the scan.

3. **Feedback capture** — new `app/api/assistant/scan-feedback/route.ts` (POST, gated by
   `requireTenantMember`). Body `{ sample_id, resolved_equipment_id|null, outcome }`. Inserts
   `equipment_scan_feedback`; on a confirm/correct outcome, backfills the SCAN sample's frozen
   labels from the resolved `loto_equipment` row and flips `label_source='scan_confirmed'`,
   `is_gold=true`. Uses `supabaseAdmin()`.

4. **Client wiring (fire-and-forget; no spinner, no blocking).**
   - `components/EquipmentScanner.tsx`: thread optional `sample_id` from the scan-photo
     response onto `ScanResult`.
   - New tiny helper `apps/web/lib/equipmentScanFeedback.ts` → `reportScanOutcome(sample_id,
     resolved_equipment_id, outcome)` using `fetch(..., {keepalive:true})` (or
     `navigator.sendBeacon`), errors swallowed. (Rule of Three — 3 consumers.)
   - Call it from the three `ScanResult` consumers: `app/scan/page.tsx` (candidate pick →
     `confirmed_top1`/`confirmed_other_candidate`; single auto-resolve → `confirmed_top1`;
     manual entry → `manual_override`; "Scan again" without a pick → `abandoned`),
     `app/equipment-readiness/scan/page.tsx`, `components/AssistantDock.tsx`.

## Export (dataset for the future LLM)

`app/api/superadmin/equipment-corpus/export/route.ts` (superadmin-gated, mirrors the existing
tenant export). Emits a **versioned JSONL manifest**: a snapshot header `{generated_at, count,
filter}` then one line per gold/confirmed sample `{ image_url (signed), equipment_id,
equipment_type, manufacturer, model, department, facility_id, tenant_id, slot, split,
captured_at }`. **Split assignment is deterministic** — hash `equipment_pk` into
train/val/holdout so one piece of equipment never straddles splits (no leakage) and a whole
future *site* can be held out for the realistic cross-site generalization test.

## How this becomes the future equipment-identifier LLM

The corpus + reward tables are model-agnostic on purpose. Once enough gold samples
accumulate across sites, the supervised session can take any of these paths off the **same**
export, in increasing order of effort:

1. **Retrieval / nearest-neighbour (next phase).** Add a multimodal embedding column
   (e.g. `voyage-multimodal-3`) to `equipment_photo_samples`, mirror the `match_*` RPC from
   migration 105, and re-rank scan candidates by visual similarity to confirmed photos. This
   improves identification *without* training and is the natural first use of the data.
2. **Fine-tune a vision classifier** on `{image → equipment_type / manufacturer / model}`
   using the holdout-by-site split for an honest generalization number.
3. **Fine-tune / few-shot a Claude vision surface** for nameplate extraction, evaluated
   against the captured reward signal (top-1 hit rate before vs. after).

The reward signal (`equipment_scan_feedback`) is what makes each path *measurable*: the
`equipment_identification_metrics` view gives a before/after top-1 hit rate per site.

## Non-destructive / seamless guarantees (explicit)

- Two additive tables + one view; **zero** destructive `alter`; `upsert:false` unchanged; no
  storage object ever deleted; old photo bytes + the pre-existing pointer flow untouched.
- Every capture path is `try/catch` fire-and-forget — it can never fail an upload, a scan, or
  a confirm, and adds no synchronous latency to the user.
- All new RLS is additive; `unique(storage_path)` makes capture idempotent.
- Full paired `*_rollback.sql`.

## Files (when implemented)

- **New:** `apps/web/migrations/213_equipment_training_corpus.sql`,
  `apps/web/migrations/213_equipment_training_corpus_rollback.sql`,
  `apps/web/app/api/assistant/scan-feedback/route.ts`,
  `apps/web/app/api/superadmin/equipment-corpus/export/route.ts`,
  `apps/web/lib/equipmentScanFeedback.ts`.
- **Edit (additive):** `packages/core/src/storagePaths.ts` (+`scanSamplePath`),
  `packages/core/src/photoUpload.ts` (capture hook + widen select),
  `apps/web/app/api/assistant/scan-photo/route.ts` (persist image + sample + return id),
  `apps/web/lib/ai/rateLimit.ts` (`logAiInvocation` returns id),
  `apps/web/components/EquipmentScanner.tsx` (`sample_id` on `ScanResult`),
  `apps/web/app/scan/page.tsx`, `apps/web/app/equipment-readiness/scan/page.tsx`,
  `apps/web/components/AssistantDock.tsx` (call `reportScanOutcome`).

## Verification (at implementation)

- **Unit (Vitest, `npm test`):** sample insertion on upload with `current`-label freezing and
  prior-sample supersession (mock supabase); `outcome→is_gold/label_source` mapping in
  scan-feedback; deterministic split-hash (same `equipment_pk` → same split); export manifest
  shape. **Add a test asserting a thrown capture error does NOT propagate** out of
  `uploadPhotoForEquipment` (seamless guarantee).
- **Repo checks:** `npm run check:migrations` (confirm the chosen prefix is free; rollback
  companion recognized).
- **DB (Supabase MCP on a dev branch, NOT prod):** `create_branch` → `apply_migration` (213)
  → `list_tables` confirms both tables + view → `apply_migration` (rollback) confirms a clean
  drop → `merge_branch` only after review.
- **Manual end-to-end:** upload a photo → assert one `admin_upload` sample; scan → confirm a
  candidate → assert a `scan_confirmed` sample + a `confirmed_top1` feedback row; re-upload
  (replace) the same slot → assert the prior sample has `superseded_at` set and a new row was
  added (**both retained**); hit the export → assert JSONL with deterministic splits.
