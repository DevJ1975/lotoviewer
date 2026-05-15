# PR housekeeping — 2026-05-15

Snapshot of all open pull requests against `main` (`0c81d17`), with the
ancestry / conflict state observed at the time of writing and the
maintenance actions taken on `claude/github-pr-maintenance-5p4DR`.

## Headline findings

1. **Three open PRs collide on migration `139_*.sql`.** `main` already
   ships `139_loto_review_signoff_drop_readiness_gate.sql`, plus 140 and
   141. PRs #86, #87, #88 each propose a *different* `139_*.sql` file —
   they will all fail the duplicate-migration-prefix prebuild guard and
   conflict with each other.
2. **PR #88 may be effectively superseded by main.** `main`'s migration
   `141_enable_hazardous_waste_module.sql` appears to do the per-tenant
   activation step PR #88 describes. Worth diffing before any further
   work on the branch.
3. **No open PR is yet reachable from `origin/main`** by SHA ancestry,
   so no "auto-close because merged" candidates exist today.
4. **Five PRs cannot be auto-rebased** — GitHub's `update-branch` API
   returned `422 merge conflict`: #79, #80, #83, #85, #91. Each needs a
   manual rebase.

## Per-PR status

| PR  | Head merge-base | Ahead | Behind | `update-branch` | Notes |
|-----|-----------------|-------|--------|------------------|-------|
| #95 | 0c81d17 (tip)   | 31    | 0      | not attempted    | `mergeable_state: dirty`. Author explicitly says "do not merge yet — mid-build." Leave alone. |
| #94 | a5ddf840        | 2     | 2      | ✅ in progress    | Trivial behind-main; rebased automatically. |
| #91 | 956c6f0b        | 2     | 3      | ❌ conflict       | `package.json`/lock collisions likely. Manual rebase. |
| #89 | 956c6f0b        | 1     | 3      | ✅ in progress    | Docs-only PR; rebased automatically. |
| #88 | 956c6f0b        | 6     | 3      | not attempted    | Migration-139 collision. **May be superseded by main's `141_*.sql`.** |
| #87 | 956c6f0b        | 2     | 3      | not attempted    | Migration-139 collision. Rebase + renumber to `142_` or higher. |
| #86 | 956c6f0b        | 1     | 3      | not attempted    | Migration-139 collision. Rebase + renumber to `142_` or higher. |
| #85 | 956c6f0b        | 1     | 3      | ❌ conflict       | `navigationCatalog.ts` likely conflicts with #88's drawer change. Manual rebase. |
| #84 | 956c6f0b        | 1     | 3      | ✅ in progress    | Single-file fix; rebased automatically. |
| #83 | c7d58d85        | 4     | 5      | ❌ conflict       | Touches `loto_review_links` — collides with main's `139_loto_review_signoff_drop_readiness_gate.sql`. Manual rebase + reconcile. |
| #81 | 5f4fb3dc        | 6     | 20     | ✅ in progress    | STRIKE quiz maker; rebase attempted automatically. |
| #80 | 5f4fb3dc        | 6     | 20     | ❌ conflict       | Daily bug-hunt routine. `c7d58d8 Harden LOTO tenant isolation` already partially addresses this PR's defense-in-depth fix on main — diff before rebasing. |
| #79 | 5f4fb3dc        | 2     | 20     | ❌ conflict       | Member-delete error surfacing. Manual rebase. |

## Actions taken this session

- Posted housekeeping comments on **#79, #80, #83, #85, #86, #87, #88, #91**
  explaining the specific blocker for each.
- Triggered `update-branch` on **#81, #84, #89, #94** — GitHub will fast-forward
  them onto current `main`.
- **#95** left untouched per author's "do not merge yet" directive.

## Recommended next actions (for a follow-up session)

1. **Resolve the migration-139 collision.** Pick a canonical ordering for
   the three pending hazardous-waste / compliance migrations and renumber
   #86, #87, #88 against current main's 142 high-water mark. If #88 is
   indeed superseded by main's 141, close #88 with a "superseded by"
   reference to PR #90.
2. **Walk through the five rebase-blocked PRs** (#79, #80, #83, #85, #91)
   locally; each is small enough (1-6 commits) to rebase by hand.
3. **Audit stale remote branches.** Several `claude/*` branches are
   already reachable from `main` (via the `Merge remote-tracking branch
   ...` commit pattern earlier in the log) and could be pruned in a
   follow-up housekeeping pass — out of scope for this session.

## Methodology

- `git fetch origin 'refs/pull/*/head:refs/remotes/origin/pr/*'` to pull
  every open PR's head into the local clone.
- `git merge-base --is-ancestor <pr_sha> origin/main` to detect
  already-merged PRs (none today).
- `git rev-list --count` for ahead/behind counts; `git merge-base` for
  divergence points.
- GitHub MCP `update_pull_request_branch` for non-destructive
  fast-forward attempts (errors safely on real conflicts).
