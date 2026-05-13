#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  npm run doctor:git
  npm run doctor:git -- --prune

Checks the local repository for stale git locks, invalid conflict-copy files,
basic ref health, and the fast repo guards used by CI.

Options:
  --prune   Run `git remote prune origin` after the dry-run inventory.
  --help    Show this help.
USAGE
}

apply_prune=false
for arg in "$@"; do
  case "$arg" in
    --prune) apply_prune=true ;;
    --help|-h) usage; exit 0 ;;
    *) echo "unknown arg: $arg" >&2; usage; exit 2 ;;
  esac
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

failures=0

check_empty() {
  local label=$1
  local output=$2
  if [[ -n "$output" ]]; then
    echo "FAIL: $label"
    printf '%s\n' "$output" | sed 's/^/  /'
    failures=$((failures + 1))
  else
    echo "OK: $label"
  fi
}

echo "Repository: $repo_root"
echo "Branch:     $(git branch --show-current 2>/dev/null || echo detached)"
echo "HEAD:       $(git rev-parse --short HEAD)"
echo

git cat-file -e HEAD^{commit}
git show-ref --verify --quiet refs/heads/main || {
  echo "FAIL: local main ref is missing"
  failures=$((failures + 1))
}
git show-ref --verify --quiet refs/remotes/origin/main || {
  echo "FAIL: origin/main ref is missing; run git fetch origin"
  failures=$((failures + 1))
}

locks=$(find .git -type f -name '*.lock' -print | sort)
check_empty "no stale .git lock files" "$locks"

conflict_copies=$(find .git -maxdepth 4 \( -name '* [0-9]' -o -name '* [0-9].lock' \) -print | sort)
check_empty "no conflict-copy files inside .git" "$conflict_copies"

active_state=$(find .git -maxdepth 2 \( -name MERGE_HEAD -o -name CHERRY_PICK_HEAD -o -name REVERT_HEAD -o -name rebase-merge -o -name rebase-apply \) -print | sort)
check_empty "no unfinished merge/rebase/cherry-pick state" "$active_state"

echo
echo "Remote prune dry-run:"
git remote prune origin --dry-run || {
  echo "FAIL: remote prune dry-run failed"
  failures=$((failures + 1))
}

if [[ "$apply_prune" == true ]]; then
  echo
  echo "Applying remote prune:"
  git remote prune origin
fi

echo
echo "Fast repo checks:"
npm run check:repo

echo
if [[ "$failures" -gt 0 ]]; then
  echo "Repo doctor found $failures issue(s)."
  exit 1
fi

echo "Repo doctor passed."
