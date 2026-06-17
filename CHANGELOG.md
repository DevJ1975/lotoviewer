# Changelog

All notable, user-visible changes to SoteriaField are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/runbooks/versioning.md](docs/runbooks/versioning.md) for how versions
are decided, bumped, and released. Per-tenant release notes also surface in the
app at `/superadmin/release-notes`.

## [Unreleased]

### Added
- **AI-assisted root cause analysis (incident 5 Whys, rebuilt).** Acting on
  feedback that the old tool "is not a good tool," the 5 Whys editor now writes
  contextual prompts that chain each "why" to the answer above it, supports
  branching and **multiple** identified root causes, and shows an inline
  anti-blame guardrail that flags symptom-level / person-blaming answers
  (HOP / Safety-II aligned). An optional, **human-approved** Claude co-pilot
  suggests the next "why" and drafts a root cause + corrective actions — nothing
  is written until a person accepts it, and accepted AI text is badged. The
  investigation is unified: the RCA editor moved into the **Investigate & RCA**
  tab, identified roots pull into the narrative in one click and into tracked
  corrective actions (`incident_actions.source_rca_node_id`), and the old
  `/incidents/[id]/rca` tab redirects there. Migration 233 adds 5-Whys
  branching, multi-root support, and AI provenance; new wiki page at
  `/wiki/incident-investigation`.
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
