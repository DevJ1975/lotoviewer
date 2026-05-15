# Git And GitHub Housekeeping

This runbook keeps the local checkout, GitHub repository, and Vercel deploy flow predictable.

## Routine Checks

Run before high-risk merges and after any interrupted git operation:

```bash
npm run doctor:git
```

Run with remote branch pruning when the dry-run output is expected:

```bash
npm run doctor:git -- --prune
```

The doctor checks for stale `.git` lock files, conflict-copy files inside `.git`, unfinished merge or rebase state, remote-prune candidates, migration numbering, manual coverage, and deeplink placeholder policy.

## Local Git Cleanup

Use this order when git commands hang or behave oddly:

1. Stop background `git status` processes from editors.
2. Remove `.git/index.lock` only after confirming no active git command owns it.
3. Run `npm run doctor:git`.
4. Run `git remote prune origin --dry-run`.
5. Apply pruning with `npm run doctor:git -- --prune` if the dry-run output is expected.

Do not use `git reset --hard` or force-push as cleanup tools. They solve a different problem and can discard work.

## Branch Policy

Recommended GitHub settings for `main`:

- Require a pull request before merging.
- Require the `Repo health` and `Wiki sync` checks.
- Require branches to be up to date before merge.
- Block force pushes.
- Block branch deletion.
- Require CODEOWNERS review when more than one trusted maintainer is active.

Direct pushes to `main` should be reserved for production recovery, and the deployed SHA should be verified afterward:

```bash
vercel list lotoviewer --format json --no-color
vercel inspect <deployment-url> --no-color
```

## Deployment Notes

Before a production deploy:

1. Apply required database migrations.
2. Confirm `npm run check:repo` passes.
3. Confirm the Vercel deployment is `READY`.
4. Record the commit SHA and deployment URL in the PR or incident issue.
