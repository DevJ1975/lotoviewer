#!/usr/bin/env bash
# Backfill the release tags that were never cut.
#
# Only v1.8.0 exists on the remote. v1.9.0 through v1.17.0 shipped untagged
# because the documented bump ritual in apps/web/lib/version.ts had four steps
# and none of them was tagging (step 5 now exists).
#
# Every commit below was verified three ways: it is an ancestor of main, it sets
# exactly its own version in apps/web/lib/version.ts, and its subject names that
# version. v1.12.0 and v1.14.0 are absent because they were never released —
# VERSION never held either value.
#
# Run this yourself: pushing tags needs credentials an agent session does not
# have (branch pushes succeed, tag pushes return 403).
#
#   bash scripts/backfill-version-tags.sh          # create + push
#   DRY_RUN=1 bash scripts/backfill-version-tags.sh # print only
set -euo pipefail

TAGS="
v1.9.0  193d03a
v1.10.0 742e6a0
v1.11.0 5f39bfd
v1.11.1 6239abc
v1.13.0 6c8bd79
v1.15.0 eb735cd
v1.16.0 64d05a2
v1.17.0 457015a
"

git fetch origin main --tags --quiet

echo "$TAGS" | while read -r tag sha; do
  [ -z "$tag" ] && continue

  if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
    echo "skip   $tag — already exists locally"
    continue
  fi

  # Refuse to tag a commit that is not on main, rather than creating a tag
  # that points into an abandoned branch.
  if ! git merge-base --is-ancestor "$sha" origin/main 2>/dev/null; then
    echo "SKIP   $tag — $sha is not an ancestor of origin/main; verify before tagging" >&2
    continue
  fi

  if [ "${DRY_RUN:-}" = "1" ]; then
    echo "would  git tag -a $tag $sha -m \"$tag\" && git push origin $tag"
  else
    git tag -a "$tag" "$sha" -m "$tag"
    git push origin "$tag"
    echo "tagged $tag -> $sha"
  fi
done

echo
echo "Remote tags now:"
git ls-remote --tags origin | awk '{print "  " $2}' | grep -v '\^{}' || true
