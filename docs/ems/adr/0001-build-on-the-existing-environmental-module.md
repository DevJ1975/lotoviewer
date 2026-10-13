# ADR 0001: Build the EMS on the existing `environmental` module

- **Status:** Accepted, 2026-10-01. The product owner replied "go", accepting every recommendation in the table below.
- **Date:** 2026-10-01
- **Phase:** 0 (discovery)

## Context

[EMS_IMPLEMENTATION_PLAN.md](../EMS_IMPLEMENTATION_PLAN.md) assumes no environmental
module exists. Phase 0 discovery ([00-repo-map.md](../00-repo-map.md), section 10)
found otherwise. The repo already ships:

- **Environmental (ISO 14001):** module id `environmental`, on by default.
  - Aspects (`environmental_aspects`, migration 204), objectives with readings (205),
    nonconformities with verified actions (206), and management reviews (207).
  - A 19-clause audit-readiness report card (`packages/core/src/iso14001Readiness.ts`).
- **Related modules:**
  - Hazardous waste: streams, containers, accumulation clocks, SAA/CAA weekly inspections, contingency plan.
  - Chemicals, with a Tier II view.
  - A generic inspection-template engine (migration 193) and a cadence scheduler (Hazard Hunt).
  - A compliance calendar (192), training records and matrix, and a trigger-driven `audit_log`.

The plan's guardrail "Reuse, don't fork" and its principle "Reuse the asset and
inspection model; do not build a parallel one" both rule out building a second ISO
14001 module beside the first.

Several of the plan's assumptions don't hold here:

- The repo has one shared package (`packages/core`), not separate domain, db and jobs packages.
- It uses raw SQL migrations with no down sections, and `facility_id` rather than `site_id`.
- Feature flags have no default-off option.
- The mobile app has no offline queue.
- There is no browser end-to-end framework.

## Options

1. **Greenfield, as written.** Create the `ms_*` and `ems_*` tables, a new `ems_module`
   flag and new route groups, and leave `environmental_*` in place.
   - Rejected: it forks the aspects, objectives, CAPA and management-review records.
     Auditors would see two aspects registers, and existing tenant data would strand.
2. **Greenfield, then migrate.** Build `ms_*` and `ems_*`, copy the existing rows across,
   and retire migrations 204–207.
   - The plan's naming lands cleanly, but every existing page, the readiness signals,
     the demo seed and the clause-evidence map must be rewritten in Phase 1.
     That is a large, risky first PR.
3. **Evolve in place (recommended).**
   - Extend the existing tables where they cover a plan entity.
   - Add new tables only where nothing exists.
   - Keep the plan's shapes as the contract and the plan's `ms_` / `discipline`
     seams for genuinely new shared tables.

## Decision

Option 3. Every recommendation below was accepted.

| # | Question | Recommendation |
| --- | --- | --- |
| Q1 | Evolve the existing `environmental` module, or build greenfield? | Evolve in place (Option 3) |
| Q2 | Feature flag: the plan wants `ems_module` off by default, but `environmental` is on for every tenant today and `isModuleVisible` has no default-off option | Add an optional `defaultEnabled: false` to `FeatureDef`, honored by `isModuleVisible`, and apply it to `environmental`. Backfill `tenants.modules.environmental = true` for tenants that already have `environmental_*` rows and no explicit override, so no current user loses access and no explicit `false` is overwritten. LOTO resolution is untouched |
| Q3 | Legal register: extend `compliance_calendar_obligations` (in repo, has UI), or formalize the production-only `legal_register` / `compliance_obligations` tables (no migration, no UI, 0 rows per the 2026-08-28 reconciliation)? | Extend the calendar: add `source_kind`, `jurisdiction`, `applicability_rationale` and review dates, plus a compliance-evaluation result. Leave the legacy tables to the drift cleanup and repoint the AI tool `compliance_obligations_due` |
| Q4 | CAPA: the repo has three corrective-action systems | `nonconformities` + `nonconformity_actions` become the plan's single EMS CAPA sink, gaining root cause, an effectiveness check and a typed source link. Incident CAPA consolidation stays in `docs/capa-consolidation-plan.md` |
| Q5 | Offline field rounds: mobile has no offline queue to "mirror" | Split Phase 4. 4a ships rounds on the web PWA, reusing the IndexedDB `uploadQueue`. 4b builds a shared offline outbox for mobile (the Tier 3 item in `docs/mobile-parity-plan.md`) with its own ADR |
| Q6 | End-to-end tests: there is no browser framework | Use the repo's route-level `apps/web/__tests__/e2e/*.e2e.test.ts` convention; no new dependency. Add Playwright only if you want browser e2e |
| Q7 | Table naming | Existing tables keep their names and gain `discipline` and `facility_id`. New shared tables use `ms_` plus `discipline`, as the plan says. New environmental-only tables follow their siblings (`environmental_*`, `hazardous_waste_*`). Environmental permits are named `environmental_permits`, to avoid the existing permit-to-work tables |

These adaptations need no decision; the plan delegates them ("adapt to repo layout"):

- **Code layout:**
  - Domain logic goes in flat `packages/core/src/*.ts` modules, not separate packages.
  - Web routes stay under flat `apps/web/app/environmental/*` folders, with no route groups.
  - APIs go under `apps/web/app/api/environmental/*`.
- **Migrations:**
  - Raw SQL `NNN_*.sql`, each with a hand-applied `NNN_rollback.sql` companion.
  - Never applied without approval.
- **Reuse:** `audit_log` and `log_audit()` instead of `ms_audit_log`. Vercel cron routes
  under `apps/web/app/api/cron/` for the plan's nightly jobs.
- **Demo seed:** an unnumbered `apps/web/migrations/seed_ems_northfield_demo.sql`
  (the repo's `seed_*.sql` convention) instead of `scripts/seed-ems-demo.ts`.

Adaptations made while building Phase 0:

- **Error name:** the OH&S placeholder error is `NotImplementedError`, not the plan's
  `NotImplemented`. Every error class in this repo ends in `Error`.
- **Deferred to Phase 8:** the `ohsms_module` flag and the OH&S placeholder page.
  A switch for a module with no screens would only add a dead menu entry.
  `docs/ohs/README.md` reserves the names.
- **Deferred to Phase 1:** the mobile navigation entry. Mobile has no EMS screen
  until Phase 1's read-only aspect lookup, and its tabs are not flag-driven yet.

## Consequences

- **Phase 1 shrinks to extension work** on registers that already exist:
  - aspect score rows per operating condition, a scoring method and review dates;
  - obligation fields and evaluation results;
  - `facility_id` on migrations 204–207, which migration 210 skipped.
  - Context, scope, policy and interested parties are the only wholly new Phase 1 records.
- **Existing pages keep working through every phase.** The readiness report card gains
  signals as records land: `policyApproved`, the drill age, and the internal-audit programme.
- **The `environmental` pages need API routes.** They write straight from the browser
  today, so server-side rules like "never trust a client-supplied score" need routes.
  Each phase moves the writes it touches behind `/api/environmental/*`.
- **The 45001 seams still apply** to every new `ms_` table.
- **Pre-existing defects found in discovery are fixed in separate PRs.** The most
  relevant is `log_audit()` never writing `tenant_id` (repo map section 11). Until it is
  fixed, tenant admins cannot read the EMS audit trail the plan requires.

### Phase 0 scaffold, if accepted

**Feature flag:**
- `packages/core/src/features.ts`: add optional `defaultEnabled` to `FeatureDef`.
- `packages/core/src/moduleVisibility.ts`: honor `defaultEnabled`, with tests.
- `apps/web/migrations/NNN_environmental_module_opt_in.sql`: the backfill from Q2, plus its `NNN_rollback.sql`.

**Domain stubs, each with a passing unit test:**
- `packages/core/src/managementSystem.ts`: the `Discipline` type and a `registerHealth` stub.
- `packages/core/src/ohsPlaceholder.ts`: exports `Discipline` and `NotImplemented` only.
- `packages/core/src/managementSystemTiles.ts`: a dashboard tile registry keyed by discipline.

**Health route:**
- `apps/web/app/api/environmental/health/route.ts`: `GET` returns `{ enabled }` for the active tenant.

**Seed and docs:**
- `apps/web/migrations/seed_ems_northfield_demo.sql`: the fictional tenant with the module enabled.
- `docs/ems/README.md`, `docs/ems/adr/`, `docs/ohs/README.md`, `docs/ohs/adr/`.

**Acceptance:**
- CI green, and the LOTO test suite unchanged.
- A tenant with no override sees no Environmental navigation and gets the `ModuleGuard` "not enabled" screen. That is the repo's equivalent of the plan's 404; its APIs return 403.
- A backfilled tenant sees exactly what it sees today.
