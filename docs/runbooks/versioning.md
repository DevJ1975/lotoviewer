# Versioning & Release Scheme

How SoteriaField is versioned, branched, committed, and released. This
formalizes the practices already encoded in the repo (`apps/web/lib/version.ts`,
the migration-numbering guard, the in-app release notes) into one scheme.

Companion docs: [git-github-housekeeping.md](./git-github-housekeeping.md) for
day-to-day git hygiene; [../security/POSTURE.md](../security/POSTURE.md) for the
security-review gate.

---

## 1. Semantic Versioning

The platform version is a single [SemVer](https://semver.org) string,
`MAJOR.MINOR.PATCH`, that describes the **deployed web app as a whole** (not
individual modules).

| Bump | When | Examples |
|------|------|----------|
| **MAJOR** | A breaking change to a public contract: the SCIM/public API, webhook payload shapes, an exported data format, or a migration that requires coordinated customer action. | Webhook event renamed/removed; OSHA export columns changed. |
| **MINOR** | A new, backward-compatible capability. Most feature work. | New module, new cron, new admin screen, a new optional field. |
| **PATCH** | Backward-compatible fixes and polish. | Bug fix, copy change, performance tweak, dependency bump. |

Rules of thumb:
- A new **database column that is nullable / defaulted** and a new **module
  defaulted off per-tenant** are MINOR — they don't break existing tenants.
- Removing or renaming anything an integration depends on is MAJOR.
- Pre-1.0 semantics do **not** apply; we are past 1.0, so MAJOR means MAJOR.

The version lives in **three places that must always agree** (enforced by
`npm run check:version`):
1. `package.json` (monorepo root)
2. `apps/web/package.json`
3. `apps/web/lib/version.ts` (`VERSION` — rendered in the footer + About tile)

---

## 2. Branching model

Trunk-based with short-lived branches off `main`.

- **`main`** is always releasable and is protected (see issue #82 for the
  GitHub settings checklist: required PR, required `Repo health` + `Wiki sync`
  checks, no force-push, no deletion).
- **Work branches** are short-lived and prefixed by intent:
  - `feat/<slug>` — new capability
  - `fix/<slug>` — bug fix
  - `chore/<slug>` — tooling, deps, docs
  - `security/<slug>` — security hardening
  - `claude/<slug>` — agent-authored branches (same rules apply)
- Every change reaches `main` through a **pull request** (open as **draft**
  until CI is green and the description is complete). Squash-merge to keep
  `main` history one-commit-per-change.
- Delete the branch after merge. `npm run doctor:git` and
  `scripts/cleanup-stale-branches.sh` help keep the remote tidy.

---

## 3. Commit conventions

[Conventional Commits](https://www.conventionalcommits.org): `type(scope):
summary`, summary in the imperative and focused on the **why**.

- **Types:** `feat`, `fix`, `chore`, `refactor`, `test`, `docs`, `perf`,
  `security`, `revert`.
- **Scopes** mirror modules/areas: `loto`, `incidents`, `chemicals`, `members`,
  `onboarding`, `risk`, `osha`, `bbs`, `superadmin`, `core`, … (lowercase).
- A breaking change is flagged with `!` after the scope (`feat(api)!: …`) and a
  `BREAKING CHANGE:` footer — this is what justifies a MAJOR bump at release.

The commit history since the last tag is the raw material for the changelog and
the version-bump decision.

---

## 4. Database migration versioning

Migrations are the schema's version history and follow their own rules
(guarded by `npm run check:migrations`):

- Files live in `apps/web/migrations/`, named `NNN_slug.sql` with a 3-digit,
  zero-padded, **sequential** prefix (next is the current max + 1). An optional
  single letter (`059b_…`) slots a follow-up between releases. Run
  **`npm run migration:next`** to print the next free prefix instead of eyeballing
  the directory (`npm run migration:next my_feature` prints the full filename).
- **Forward-only and idempotent:** `create table if not exists`,
  `drop policy if exists` before create, `create or replace function`. Re-runs
  must be safe.
- A reversible migration ships its companion `NNN_rollback.sql` (hand-applied
  in emergencies; excluded from the forward chain).
- Every domain table enables RLS with the standard tenant-scope policy
  (`active_tenant_id()` / `current_user_tenant_ids()` / `is_superadmin()`).
- Migration numbers are **independent of** the SemVer string — they only ever
  increase; they are never renumbered to match a release.

**Avoiding prefix collisions.** The guard above is a *detector*: it fails CI once a
duplicate prefix exists, which then blocks every PR repo-wide until renamed. Two
parallel branches can each pick the same "max + 1" and only clash on the second
merge. To prevent that:

- Allocate with `npm run migration:next` and rebase onto `main` right before
  opening/merging so the max you see is current.
- If a rebase across an in-flight migration transiently collides on a feature
  branch, set `ALLOW_MIGRATION_COLLISIONS=1` to unblock locally — but resolve it
  (rename to a fresh prefix) **before merge**.
- **Recommended branch protection (repo setting):** make `Repo health` a required
  check and enable *"Require branches to be up to date before merging"*. The
  second PR adding the same number is then forced to rebase and goes red **before**
  merge, so a duplicate can never reach `main`.

---

## 5. In-app version surfacing

- `apps/web/lib/version.ts` exports `VERSION`, `COMMIT` (short SHA from
  `VERCEL_GIT_COMMIT_SHA`, `dev` outside Vercel), and `VERSION_LINE`
  (`vX.Y.Z (sha)`).
- `VERSION_LINE` renders in the app footer and the superadmin About tile, so
  support can read the exact deployed build off any screen.
- Per-tenant, human-readable release notes are authored at
  `/superadmin/release-notes` and shown to tenants via the in-app banner.

---

## 6. Release process

1. **Decide the bump** from the commits since the last tag (§1, §3).
2. **Bump all three version sources** to the new number (§1). Keep them
   identical — `npm run check:version` fails the build otherwise.
3. **Update `CHANGELOG.md`:** move `[Unreleased]` items into a new
   `[X.Y.Z]` section dated today; refresh the compare links at the bottom.
4. **Author a release note** at `/superadmin/release-notes` for the
   customer-facing summary.
5. **Open a `chore/release-X.Y.Z` PR**, get CI green (`npm run check:repo`,
   `tsc --noEmit`, `vitest run`), and merge.
6. **Tag the merge commit** `vX.Y.Z` and push the tag:
   `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z`.
   Cut a GitHub Release from the tag, pasting the changelog section.
7. **Deploy:** Vercel builds `apps/web` from `main`; `COMMIT` is injected at
   build time, so the footer reflects the tagged build automatically.

Tags are the durable record of what shipped; `main` may move ahead of the
latest tag while the next release accumulates.

---

## 7. CI gates (what blocks a merge)

- `npm run check:repo` → `check:migrations` (numbering), `check:manuals`,
  `check:nav`, **`check:version`** (version drift), `check:deeplinks`.
- `tsc --noEmit` clean and `vitest run` green.
- `Repo health` and `Wiki sync` workflows required on `main`.
- Security-sensitive changes additionally follow `docs/security/POSTURE.md`.

---

## 8. Quick reference

```bash
# Are the three version sources in sync?
npm run check:version

# Full pre-merge repo checks
npm run check:repo

# Cut release vX.Y.Z (after bumping the 3 sources + CHANGELOG, merged to main)
git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z
```
