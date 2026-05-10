# STRIKE Microlearning Implementation Spec

Working implementation brief for Codex, Claude, and future contributors.

## Product Definition

STRIKE stands for Safety Training & Rapid Instruction for Knowledge Execution. It is the SoteriaField microlearning and task-readiness module for short safety videos, quizzes, field instructions, assignments, and high-risk work readiness checks.

Tagline: Train at the speed of risk.

STRIKE does not replace a customer's enterprise LMS. It complements it by moving practical training closer to the work: before a high-risk task, during a field question, after a corrective action, or when a supervisor needs a short refresher.

## Phase 0: Architecture And Product Groundwork

Phase 0 is the design-control phase. No broad CRUD should be built until these decisions are kept visible:

- Global STRIKE Library is Trainovate-controlled content available across tenants.
- Tenant STRIKE Library is customer-specific content for their site, equipment, hazards, procedures, and onboarding.
- STRIKE Studio is Trainovate's service layer for filming and producing site-specific modules.
- STRIKE content must be versioned. Completions should bind to the exact module version the worker completed.
- STRIKE must integrate with existing SoteriaField workflows instead of living as a detached LMS clone.
- AI may draft quizzes, summaries, scenarios, and toolbox variants, but Trainovate or an authorized tenant admin must approve before publication.
- Tenant isolation, RLS, storage path discipline, auditability, and federal evidence readiness are mandatory from the first schema.

Phase 0 deliverables:

- Feature catalog entry and route shell.
- Core database model for modules, versions, quiz questions, assignments, attempts, completions, requirements, readiness checks, tenant settings, and STRIKE Studio requests.
- Shared domain helpers for readiness and status calculation.
- Implementation roadmap, permissions model, and integration map in this document.

## Phase 1: Core MVP

Phase 1 proves the operational value without trying to build a full authoring suite yet.

Build:

- STRIKE landing page with published module library.
- Video metadata and playback-ready storage paths.
- Quiz schema for multiple choice, true/false, select-all, and acknowledgement checks.
- Assignment schema for tenant, site, department, role, and user targets.
- Attempt and completion tracking with score, pass/fail, timestamps, and expiration.
- High-risk task requirements that can link modules to LOTO, confined spaces, hot work, JHA, chemicals, BBS, incidents, and corrective actions.
- Task readiness check log that records whether required training was valid before work proceeded.
- Basic leading indicators: completion rate, overdue count, average score, failed attempts, pre-task readiness rate, voluntary completions, and most failed questions.

Explicitly defer:

- Hard blocking high-risk work until the requirement engine is validated in real tenant data.
- Drag-and-drop, hotspots, branching, adaptive paths, certificates, and AI publishing automation.
- Dedicated video streaming/CDN decisions beyond private Supabase Storage paths.

## Module Communication Map

STRIKE should share data with existing modules through explicit link tables and typed source references.

| Source module | STRIKE connection |
| --- | --- |
| LOTO | Require LOTO verification refreshers before device issue, lockout execution, or permit sign-on. |
| Confined Spaces | Require entry, attendant, supervisor, rescue, or atmospheric testing refreshers before permit work. |
| Hot Work | Require hot work operator and fire watch refreshers before permit authorization. |
| JHA | Recommend training based on hazards, controls, PPE, and nonroutine task steps. |
| Chemicals | Require HazCom or chemical-specific modules when handling products with training requirements. |
| Incidents | Assign retraining after injury, near miss, spill, investigation, or action item closure. |
| BBS | Provide observation how-to videos and assign coaching modules after repeated unsafe behavior. |
| Safety Boards | Link discussions to training modules and spawn corrective actions or refresher assignments. |
| Employee/Admin profiles | Show completions, expirations, quiz scores, badges, and task-readiness history. |
| EHS Scorecard | Add STRIKE leading indicators beside permit, incident, BBS, and chemical metrics. |

The database should preserve source object IDs where a requirement or check came from, but STRIKE should not directly mutate the source module in Phase 1. Source modules should call STRIKE readiness APIs once those APIs exist.

## Permissions Model

- Superadmin can create, update, publish, archive, and version global modules.
- Superadmin can create or manage tenant modules when delivering STRIKE Studio work.
- Tenant admins can assign modules, request STRIKE Studio content, and manage tenant-specific modules when permission is enabled.
- Workers can view published modules assigned or available to their tenant, complete modules, and see their own completion status.
- Supervisors/admins can view team completion, overdue, and readiness dashboards.
- RLS is the hard boundary. API routes may add narrower role checks for authoring and dashboard views.

## Federal And Military Readiness Requirements

STRIKE should support federal use cases from the start:

- Keep training completions durable, version-bound, timestamped, and exportable.
- Preserve the source of each requirement: policy, task, permit, JHA, incident, corrective action, or supervisor assignment.
- Store media, transcripts, captions, quiz data, and reference attachments with tenant-aware storage paths.
- Capture human approvals for AI-assisted content before publication.
- Support Section 508 direction with captions, transcripts, keyboard-accessible quizzes, visible focus states, and no video-only instruction.
- Prepare for FedRAMP/CMMC evidence by preserving audit logs, access controls, configuration history, retention settings, and exportable training records.
- Do not claim compliance certifications until assessments and authorizations are completed.

## Data Model Notes

Core tables:

- `strike_modules`
- `strike_module_versions`
- `strike_quiz_questions`
- `strike_quiz_answers`
- `strike_assignments`
- `strike_attempts`
- `strike_completions`
- `strike_training_requirements`
- `strike_task_checks`
- `strike_tenant_settings`
- `strike_studio_requests`

Design invariants:

- Global modules have `library_scope = 'global'` and `tenant_id is null`.
- Tenant modules have `library_scope = 'tenant'` and a non-null `tenant_id`.
- Completions store both `module_id` and `module_version_id`.
- Requirement checks store the source module/type/object ID and the evaluated readiness status.
- Storage path convention is `strike-media/global/...` for Trainovate global media and `strike-media/{tenant_id}/...` for tenant-specific media.

## Roadmap After Phase 1

Implementation status:

- Phase 1 foundation is implemented in migration 114, shared core helpers, and `/strike`.
- Phase 2 management surfaces are implemented in `/strike`: tenant module publishing, quiz question authoring, assignments, Studio requests, QR launch cards, and recurring-assignment cron support.
- Phase 3 integration hooks are implemented through source-linked requirements, readiness checks, and `/api/strike/assign-from-source`.
- Learner playback, transcript display, quiz submission, server-side scoring, attempts, and version-bound completions are implemented at `/strike/[slug]` and `/api/strike/[moduleId]/submit`.

Phase 2:

- Authoring UI in superadmin.
- Tenant-specific custom library management.
- STRIKE Studio request workflow.
- Recurring assignments and expiration automation.
- QR-code launch links.
- AI-assisted quiz generation from transcript/SOP with human approval.

Phase 3:

- Incident-triggered retraining.
- Observation-triggered coaching.
- Corrective-action-linked module assignment.
- Adaptive learning paths.
- Cross-tenant superadmin analytics.
- Dedicated video streaming/CDN if Supabase Storage becomes a performance or cost bottleneck.
