# EM-385 Compliance Module — Handoff & Collision Map

> **Status:** Implemented on branch `claude/fervent-goodall-7xubw8` → **PR #214** (open, CI green,
> Vercel deployed). Read this before touching anything EM-385-related or adding a migration.

## TL;DR for the next agent

A new **EM-385 Compliance** module (USACE EM 385-1-1 document/records register & tracker) has been
added — a **register & tracker**, not a document generator. A global, edition-tagged catalog of
required documents/records drives a per-contract register with status / owner / dates / version /
evidence files, and links to existing modules (LOTO, confined spaces, hot work, incidents, JHA) as
the system-of-record. ~2,810 insertions across 28 files. **Do not re-implement it, and do not reuse
the reserved names/numbers below.**

## Reserved namespaces — DO NOT REUSE

| Kind | Reserved |
|---|---|
| **DB tables** | `em385_requirements`, `em385_projects`, `em385_register_items`, `em385_document_files` (+ `em385_project_number_sequences`, `em385_register_item_audit_log`) |
| **Migration numbers** | `227`–`231` (EM-385). Next free = **232**. |
| **UI routes** | `/em385`, `/em385/new`, `/em385/[projectId]`, `/em385/[projectId]/items/[itemId]` |
| **API routes** | everything under `/api/em385/**` |
| **core modules** | `packages/core/src/em385.ts`, `em385Metrics.ts`, `em385Seeding.ts` (re-exported from `index.ts`) |
| **Storage prefix** | `loto-photos/<tenant_uuid>/em385/<register_item_id>/...` via `em385DocumentPath()` in `packages/core/src/storagePaths.ts` |
| **Nav item ids** | `em385`, `em385-new` (in `packages/core/src/features.ts`) |
| **Module manual key** | `em385` (in `apps/web/migrations/seed_module_manuals.sql`) |

## ⚠️ Migration-numbering note (important)

This branch originally carried `225`–`229` for EM-385, but `main` advanced (PR #213) and took `225`
(`225_strike_vimeo_only.sql`) and `226` (`226_regulation_update_checks.sql`, main's own `222→226`
fix). To keep prefixes unique on merge, the EM-385 block was **shifted to `227`–`231`** (relative
order preserved). The original `222` duplicate is resolved on `main` (→ `226`); this branch no longer
renames it.

**Consequences for you:**
- EM-385 owns `227`–`231`. **The next free prefix is `232`** — confirm with `npm run migration:next`.
- Run `node scripts/check-migration-numbers.mjs` (or `npm run check:repo`) before pushing any migration,
  and rebase onto the latest `main` first: the guard only catches a collision once both numbers exist
  in the same tree (see `docs/runbooks/versioning.md` §4).

## Files added / changed (28 files)

**Migrations** (`apps/web/migrations/`)
- `227_em385_requirements_catalog.sql` — global, non-tenant catalog (read-only to tenants)
- `228_em385_requirements_seed.sql` — seeds the catalog for the 2024 + 2014 editions
- `229_em385_projects.sql` — tenant-scoped USACE contract entity (+ number-sequence trigger + audit)
- `230_em385_register_items.sql` — per-project instantiation of catalog items (+ status audit trio)
- `231_em385_document_files.sql` — evidence-file metadata (SHA-256 hash pattern)
- `seed_module_manuals.sql` — added the `em385` module-manual row

**core** (`packages/core/src/`)
- added: `em385.ts`, `em385Metrics.ts`, `em385Seeding.ts` (+ `__tests__/em385*.test.ts`)
- edited: `features.ts` (nav), `index.ts` (exports), `storagePaths.ts` (`em385DocumentPath`)

**API** (`apps/web/app/api/em385/`)
- `requirements/route.ts`; `projects/route.ts`; `projects/[projectId]/route.ts`;
  `projects/[projectId]/items/route.ts`; `.../items/[itemId]/route.ts`; `.../items/[itemId]/files/route.ts`

**UI** (`apps/web/app/em385/`)
- `page.tsx` (list), `new/page.tsx`, `[projectId]/page.tsx` (register/dashboard),
  `[projectId]/items/[itemId]/page.tsx`, `layout.tsx`, `_components/client.ts`

**Tests**
- `packages/core/src/__tests__/em385.test.ts`, `em385Metrics.test.ts`, `em385Seeding.test.ts`;
  `apps/web/__tests__/lib/features.test.ts` (extended)

## Conventions this module follows (reuse, don't reinvent)

- Tenant tables: `tenant_id ... references public.tenants(id) on delete cascade`, RLS via
  `active_tenant_id()` / `current_user_tenant_ids()` / `is_superadmin()`, `touch_updated_at()` trigger.
- Enums are **`text CHECK`**, never `CREATE TYPE` (repo convention).
- `em385_requirements` is **global** (no `tenant_id`): `for select to authenticated using (true)`,
  no write policy for `authenticated`. Applying the standard tenant predicate returns zero rows.
- Files use the existing `loto-photos` bucket; tenant-uuid-first paths so migration 033 RLS gates writes.

## Not done yet / safe to pick up

- No bulk import/export of register items (CSV).
- No automated due-date reminders / Compliance-Calendar tie-in; no nightly `expired`-status cron.
- `links_module` pointers exist, but deep two-way linking UI to host records is minimal.
- Changing a project's edition after creation does not re-seed the register.

## Verify

```bash
npm run check:repo          # migration-number guard + repo health
npm run -w @loto/core test  # core unit tests incl. em385*
npx tsc -p apps/web --noEmit
```
