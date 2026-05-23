# Changelog

All notable, user-visible changes to SoteriaField are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
See [docs/runbooks/versioning.md](docs/runbooks/versioning.md) for how versions
are decided, bumped, and released. Per-tenant release notes also surface in the
app at `/superadmin/release-notes`.

## [Unreleased]

### Added
- Weekly reminder emails for invitees who haven't signed up, with reversible
  soft-cancel after four reminders (daily `/api/cron/invite-reminders`).
- First-login onboarding instruction walkthrough for new users.
- Version-control scheme: `check:version` drift guard, this changelog, and the
  versioning runbook.

## [1.9.0]

Baseline release. Earlier history is tracked in git and in the in-app release
notes (`/superadmin/release-notes`); this changelog starts the forward record
from 1.9.0.

[Unreleased]: https://github.com/devj1975/lotoviewer/compare/v1.9.0...HEAD
[1.9.0]: https://github.com/devj1975/lotoviewer/releases/tag/v1.9.0
