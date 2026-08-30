# EM-385 Compliance — manual smoke test

Drive this against a real browser (and an iPad for field views) after deploying the
`claude/fervent-goodall-7xubw8` preview. It covers what the automated suite can't:
real auth, RLS across tenants, storage uploads, and the linked-module deep links.

**Prereqts:** a tenant with the `em385` module enabled, one **admin** user and one
**member** (read-only) user, and a second tenant for the isolation check. Migrations
227–231 applied to the target DB.

## 1. Module gate & navigation
- [ ] `em385` appears in the nav for a member of a tenant with the module enabled.
- [ ] A tenant **without** the module sees no nav entry and `/em385` is blocked by `ModuleGuard`.
- [ ] The module manual entry renders (seed_module_manuals → `em385`).

## 2. Create a contract (`/em385/new`, admin)
- [ ] Submit with a blank contract number / title → client validation blocks (no request sent).
- [ ] Set end date before start date → "End date cannot be before start date".
- [ ] Create a **2024** contract → lands on its dashboard; the register is **seeded** with the
      2024 default-required catalog items.
- [ ] Create a **2014** contract → seeded with 2014 rows only (no 2024 rows leak in).
- [ ] `project_number` shows as `CTR-YYYY-NNNN` (trigger-assigned).
- [ ] A **member** cannot reach `/em385/new` mutation (POST returns 403).

## 3. Dashboard (`/em385/[projectId]`)
- [ ] Readiness tile = accepted / in-scope (N/A excluded). All-N/A contract shows **0%**, not NaN.
- [ ] Overdue / Expiring-soon tiles match the register (set a past due date and an expiry ~2 weeks out).
- [ ] Register groups by category; empty categories are hidden.

## 4. Item detail (`/em385/[projectId]/items/[itemId]`)
- [ ] Walk a status `not_started → in_progress → submitted → accepted`; `submitted_at` / `accepted_at`
      stamp server-side; leaving `accepted` clears the acceptance stamp.
- [ ] Set status `not_applicable` **without** a justification → blocked (client message; DB CHECK is the backstop).
      Add a justification → saves.
- [ ] Set a linked module + record id, save, then click through — the deep link resolves to that module.
- [ ] History/audit timeline appends an entry per change.
- [ ] A **member** can view the item but the Save (PATCH) is 403.

## 5. Evidence files
- [ ] Upload a PDF → appears in the list with a `sha256:` stamp; open it (signed URL opens in a new tab).
- [ ] Try a file > 50 MB → friendly client message "File must be 50 MB or smaller." (no server round-trip).
- [ ] Upload a file whose name has spaces / unicode (e.g. `O₂ Plan.pdf`) → succeeds; stored object key is
      sanitised and tenant-prefixed.

## 6. IDOR / tenant isolation (the security checks)
- [ ] Note an item id from **Project A**, then open
      `/em385/<Project-B-id>/items/<A-item-id>` (same tenant) → **404** (project/item linkage enforced).
- [ ] As **Tenant 2**, hit `/api/em385/projects/<Tenant-1-project>` and `.../items/<Tenant-1-item>` →
      403/404, never another tenant's data (RLS + gate).
- [ ] `/api/em385/requirements?edition=2024` returns the catalog for any authenticated member, but no
      member can write to it.

## 7. Regression sanity
- [ ] `npm run check:repo` green; `npm test --workspace web` green; `npm run test:core` green.
