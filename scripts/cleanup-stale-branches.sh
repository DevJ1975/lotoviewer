#!/usr/bin/env bash
# cleanup-stale-branches.sh
#
# Bulk-deletes stale claude/* branches on the remote repo. Defensive:
#   1. Dry-run by default — prints what it would do, deletes nothing
#   2. Skips any branch with an open PR (so an in-flight review never
#      gets clobbered)
#   3. Skips main, master, develop, and any non-claude/ prefix
#   4. Requires explicit --yes to actually delete
#   5. Confirms once interactively before the destructive pass
#
# Usage:
#   ./scripts/cleanup-stale-branches.sh                # dry-run
#   ./scripts/cleanup-stale-branches.sh --yes          # actually delete
#   ./scripts/cleanup-stale-branches.sh --yes --force  # skip the prompt
#
# Requirements: gh CLI authenticated against devj1975/lotoviewer.

set -euo pipefail

REPO="devj1975/lotoviewer"
PREFIX="claude/"

# ── arg parse ──────────────────────────────────────────────────────────────
APPLY=false
SKIP_CONFIRM=false
for arg in "$@"; do
  case "$arg" in
    --yes|-y)         APPLY=true ;;
    --force|-f)       SKIP_CONFIRM=true ;;
    --help|-h)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

# ── preflight ──────────────────────────────────────────────────────────────
if ! command -v gh >/dev/null; then
  echo "error: gh CLI is not installed" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh CLI is not authenticated. Run: gh auth login" >&2
  exit 1
fi

echo "Repo:    $REPO"
echo "Prefix:  $PREFIX"
echo "Mode:    $([ "$APPLY" = true ] && echo APPLY || echo DRY-RUN)"
echo

# ── gather: branches with open PRs (skip these) ────────────────────────────
echo "→ fetching open-PR head branches…"
mapfile -t protected_branches < <(
  gh api "repos/$REPO/pulls?state=open&per_page=100" --paginate \
    --jq '.[].head.ref'
)
if [ "${#protected_branches[@]}" -gt 0 ]; then
  echo "  ${#protected_branches[@]} branch(es) protected by an open PR — will skip:"
  printf '    %s\n' "${protected_branches[@]}"
else
  echo "  no open PRs."
fi
echo

# ── gather: every remote branch ────────────────────────────────────────────
echo "→ fetching remote branches…"
mapfile -t all_branches < <(
  gh api "repos/$REPO/branches?per_page=100" --paginate --jq '.[].name'
)
echo "  ${#all_branches[@]} branch(es) on remote."
echo

# ── filter: claude/* AND not protected AND not main/master/develop ─────────
candidates=()
for b in "${all_branches[@]}"; do
  case "$b" in
    main|master|develop|HEAD) continue ;;
  esac
  if [[ "$b" != "$PREFIX"* ]]; then continue; fi
  skip=false
  for p in "${protected_branches[@]:-}"; do
    if [ "$b" = "$p" ]; then skip=true; break; fi
  done
  if [ "$skip" = true ]; then continue; fi
  candidates+=("$b")
done

if [ "${#candidates[@]}" -eq 0 ]; then
  echo "Nothing to delete. ✓"
  exit 0
fi

echo "→ ${#candidates[@]} branch(es) to delete:"
printf '    %s\n' "${candidates[@]}"
echo

# ── dry-run exit ───────────────────────────────────────────────────────────
if [ "$APPLY" != true ]; then
  echo "Dry-run complete. Re-run with --yes to actually delete."
  exit 0
fi

# ── confirmation prompt ────────────────────────────────────────────────────
if [ "$SKIP_CONFIRM" != true ]; then
  if [ ! -t 0 ]; then
    echo "error: refusing to delete non-interactively without --force" >&2
    exit 3
  fi
  printf 'Type DELETE to confirm: '
  read -r answer
  if [ "$answer" != "DELETE" ]; then
    echo "Aborted."
    exit 4
  fi
fi

# ── delete ────────────────────────────────────────────────────────────────
ok=0
fail=0
for b in "${candidates[@]}"; do
  if gh api -X DELETE "repos/$REPO/git/refs/heads/$b" >/dev/null 2>&1; then
    echo "  ✓ $b"
    ok=$((ok + 1))
  else
    echo "  ✗ $b — delete failed (already gone? permissions?)" >&2
    fail=$((fail + 1))
  fi
done

echo
echo "Done. deleted=$ok failed=$fail"
[ "$fail" -eq 0 ]
