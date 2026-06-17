# Changelog

All notable, user-visible changes to SoteriaField are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/runbooks/versioning.md](docs/runbooks/versioning.md) for how versions
are decided, bumped, and released. Per-tenant release notes also surface in the
app at `/superadmin/release-notes`.

## [Unreleased]

### Added
- **BBS coaching upgrade (Workplace Learning System methodology)** — the BBS v2
  observation surface (`/bbs/observe`) gains a structured safe-behavior checklist
  (PPE, line of fire, tools, procedures, housekeeping, ergonomics), C.A.R.E.S.
  coaching notes on the in-the-moment feedback conversation, and a one-tap
  *recognize* toggle for safe behaviors. Critical unsafe observations are
  auto-flagged for a non-punitive **24-hour "Hot Seat" rapid review** (due/overdue
  tracking). New **Safety Action Teams** (tenant-scoped lookup, managed inline on
  the dashboard) let follow-ups group by team. The admin dashboard
  (`/admin/observations/bbs/dashboard`) adds rapid-review, safe-behavior-trend,
  recognition-feed, and follow-ups-by-team sections; the BBS scorecard
  (`/bbs/scorecard`) surfaces the v2 leading indicators. Additive migration
  (`234_bbs_v2_coaching_teams.sql`) — existing rows and flows are unchanged.
  Documented in a dedicated wiki page at `/wiki/bbs`.
- **Public QR placard view** (`/qr/{qr_token}`) — scanning a printed placard QR
  opens a read-only, no-login view of that machine's isolation photo (with
  annotation markers), ordered energy-control steps, and verified badge. Reads
  flow through a `SECURITY DEFINER` RPC granted to anon (the service key never
  reaches the browser; RLS unchanged); each resolved scan is logged.
- **Reviewer photo staging + admin reconcile** — on the public review portal,
  replacing an ISO/EQUIP photo now *stages* the upload with a "pending
  reconcile" badge instead of writing the placard live. An admin applies or
  rejects each one from `/admin/loto/public-review-link` → "Photo
  replacements" (side-by-side old vs new, Apply / Reject / Apply all);
  applying swaps the photo, clears the stale placard for re-render, and writes
  audit + hygiene-log rows. Idempotent — re-running never double-applies.
- **"Update photo" deep-link** — the public placard view links into the review
  portal *focused on that one machine* (`?equipment=<id>`), so a field worker
  can replace a photo from a single scan without loading the full floor-walk
  batch page.
- Weekly reminder emails for invitees who haven't signed up, with reversible
  soft-cancel after four reminders (daily `/api/cron/invite-reminders`).
- First-login onboarding instruction walkthrough for new users.
- Version-control scheme: `check:version` drift guard, this changelog, and the
  versioning runbook.

### Notes
- **Planned — LOTO verification-packet report generator.** The printed packet's
  per-placard QR codes were repointed to the new `/qr/{qr_token}` convention
  (cover/sign-off QR → the public `/review` link) out-of-band via a PyMuPDF +
  `qrcode` script. This packet assembly + QR-stamping pipeline is the
  groundwork for an in-app **report generator** that builds and refreshes the
  verification packet from live equipment data.

## [1.9.0]

Baseline release. Earlier history is tracked in git and in the in-app release
notes (`/superadmin/release-notes`); this changelog starts the forward record
from 1.9.0.

[Unreleased]: https://github.com/devj1975/lotoviewer/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/devj1975/lotoviewer/releases/tag/v1.9.0
