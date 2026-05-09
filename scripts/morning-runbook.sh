#!/usr/bin/env bash
# scripts/morning-runbook.sh
#
# One-shot script to finish what couldn't run from the sandboxed
# Claude Code session that built this branch. Runs in this order:
#
#   1. Cleanup stale claude/* branches (gh CLI)
#   2. Generate Federal OSHA 29 CFR Part 1910 master MD + ingest
#      (calls /api/superadmin/knowledge/seed-regulations which also
#      picks up the HazCom seed file — both ingest in this step)
#   3. Backfill the 7 published manuals into RAG
#      (POSTs /api/superadmin/manuals/sync-rag)
#
# Each step is independent — if one fails, the script continues with
# the rest and reports per-step status at the end.
#
# Usage:
#   export SOTERIA_BASE_URL=https://soteriafield.app
#   export SOTERIA_SUPERADMIN_TOKEN=<your superadmin Supabase JWT>
#   ./scripts/morning-runbook.sh
#
# The superadmin token is your Supabase auth.users JWT for an
# is_superadmin = true profile. Easiest path:
#   1. Sign in to soteriafield.app as a superadmin
#   2. DevTools → Network → any /api/superadmin/* request
#   3. Copy the `Authorization: Bearer <token>` header value
#
# To skip individual steps:
#   SKIP_BRANCHES=1 ./scripts/morning-runbook.sh   # skip step 1
#   SKIP_OSHA=1     ./scripts/morning-runbook.sh   # skip step 2
#   SKIP_MANUALS=1  ./scripts/morning-runbook.sh   # skip step 3

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ── status tracking ────────────────────────────────────────────────
declare -A status
declare -A detail
overall=0

step_ok()   { status["$1"]="✓ ok";    detail["$1"]="${2:-}"; }
step_skip() { status["$1"]="○ skip";  detail["$1"]="${2:-}"; }
step_fail() { status["$1"]="✗ fail";  detail["$1"]="${2:-}"; overall=1; }

# ── preflight ──────────────────────────────────────────────────────
echo "→ preflight checks"
need_token=false
if [ "${SKIP_OSHA:-}" != "1" ] || [ "${SKIP_MANUALS:-}" != "1" ]; then
  need_token=true
fi

if [ "$need_token" = true ]; then
  : "${SOTERIA_BASE_URL:?SOTERIA_BASE_URL is required (e.g. https://soteriafield.app)}"
  : "${SOTERIA_SUPERADMIN_TOKEN:?SOTERIA_SUPERADMIN_TOKEN is required}"
  echo "  base: $SOTERIA_BASE_URL"
fi
echo

# ── step 1: cleanup stale branches ─────────────────────────────────
if [ "${SKIP_BRANCHES:-}" = "1" ]; then
  step_skip branches "SKIP_BRANCHES=1"
  echo "→ step 1: cleanup branches  (skipped)"
else
  echo "→ step 1: cleanup stale claude/* branches"
  if ! command -v gh >/dev/null; then
    step_fail branches "gh CLI not installed"
  elif ! gh auth status >/dev/null 2>&1; then
    step_fail branches "gh CLI not authenticated"
  else
    if "$REPO_ROOT/scripts/cleanup-stale-branches.sh" --yes --force; then
      step_ok branches
    else
      step_fail branches "cleanup script returned non-zero"
    fi
  fi
fi
echo

# ── step 2: OSHA 1910 generate + ingest ────────────────────────────
if [ "${SKIP_OSHA:-}" = "1" ]; then
  step_skip osha "SKIP_OSHA=1"
  echo "→ step 2: OSHA 1910  (skipped)"
else
  echo "→ step 2: generate OSHA 29 CFR Part 1910 master + ingest"
  echo "  (also re-ingests the HazCom seed in the same POST)"
  if ! command -v node >/dev/null; then
    step_fail osha "node not installed"
  else
    if node "$REPO_ROOT/scripts/ingest-osha-1910.mjs" --ingest; then
      step_ok osha
    else
      step_fail osha "ingest-osha-1910 returned non-zero"
    fi
  fi
fi
echo

# ── step 3: manuals → RAG ──────────────────────────────────────────
if [ "${SKIP_MANUALS:-}" = "1" ]; then
  step_skip manuals "SKIP_MANUALS=1"
  echo "→ step 3: manuals to RAG  (skipped)"
else
  echo "→ step 3: POST /api/superadmin/manuals/sync-rag"
  body_file=$(mktemp)
  http=$(curl -sS -o "$body_file" -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $SOTERIA_SUPERADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    "$SOTERIA_BASE_URL/api/superadmin/manuals/sync-rag" || echo "000")

  if [ "$http" = "200" ] || [ "$http" = "201" ]; then
    summary=$(jq -r '"scanned=\(.scanned) errored=\(.errored) chunks=\(.total_chunks)"' < "$body_file" 2>/dev/null \
              || echo "(non-JSON body — see /tmp/sync-manuals-body)")
    cp "$body_file" /tmp/sync-manuals-body
    step_ok manuals "$summary"
  else
    body=$(head -c 400 < "$body_file")
    step_fail manuals "HTTP $http — $body"
  fi
  rm -f "$body_file"
fi
echo

# ── summary ────────────────────────────────────────────────────────
echo "════════════════════════════════════════════════════════════════"
echo "Summary"
echo "════════════════════════════════════════════════════════════════"
for key in branches osha manuals; do
  printf "  %-10s %s" "$key" "${status[$key]:-not run}"
  [ -n "${detail[$key]:-}" ] && printf "  — %s" "${detail[$key]}"
  printf "\n"
done
echo

if [ "$overall" -eq 0 ]; then
  echo "Done. Everything went through."
else
  echo "Some steps failed. Re-run individual steps with the SKIP_* env vars."
fi
exit "$overall"
