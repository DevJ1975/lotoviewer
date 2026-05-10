# Competitive EHS SaaS Design Spec

Working design and implementation brief for Codex, Claude, and future contributors.

## Purpose

SoteriaField should compete as an AI-native, field-first EHS command center for high-risk operations. The product should feel faster and more practical than legacy EHS suites, while still preserving enterprise-grade tenant isolation, auditability, role controls, and compliance evidence.

This spec turns the current competitive analysis into a concrete roadmap. It is not a marketing document. It is the working plan for product, design, data, AI, and engineering additions.

## Product Positioning

### Sharp Position

SoteriaField is the AI-native field command center for high-risk EHS operations.

### Buyer Promise

Help safety, operations, and compliance teams see what needs attention now, capture trustworthy evidence from the field, and produce audit-ready records without forcing frontline workers through slow enterprise software.

### Ideal Customers

- Mid-market manufacturing sites
- Construction and contractor-heavy environments
- Energy, utilities, and industrial maintenance teams
- Warehousing, food production, and facilities teams
- Organizations that need LOTO, permits, incidents, inspections, SDS, corrective actions, and audit evidence in one operational system

### Competitive Wedge

Large EHS platforms are deep but often heavy. Lightweight field apps are easy but often weak on compliance traceability. SoteriaField should win by combining:

- 30-second frontline workflows
- Tenant-aware EHS AI with citations and guardrails
- Live operational risk command center
- Audit-ready evidence bundles
- Offline-capable field capture
- Configurable modules without sacrificing safety-critical invariants

## Competitive Principles

1. Field users must be able to complete the common action quickly.
   Hazard reports, near misses, permit checks, LOTO photos, and corrective action updates should be possible with minimal typing.

2. Safety-critical AI must assist, not decide.
   AI can summarize, draft, classify, search, compare, and flag risk. It must not silently approve, certify, sign, or close regulated work.

3. Every record must preserve provenance.
   Important objects need tenant, site, user, timestamp, source, status, version, and attachment lineage where relevant.

4. The system should surface priorities before reports.
   The first dashboard question is not "what can I open?" It is "what needs attention now?"

5. Offline and low-connectivity behavior are product requirements.
   Field EHS often happens in plants, confined areas, remote yards, and mechanical spaces. Core capture should degrade gracefully.

6. Configuration must not break compliance states.
   Tenants can customize forms, labels, module visibility, and notifications, but regulated state machines should remain explicit and testable.

## Proven Systems To Encode

SoteriaField should not invent safety management from scratch. The strongest product pattern is to encode proven EHS operating systems into simple workflows that customers already trust.

### OSHA Safety Program Practices

OSHA's recommended safety and health program model emphasizes management leadership, worker participation, hazard identification, hazard prevention and control, education, program evaluation, and continuous improvement. SoteriaField should make those practices visible in the product instead of hiding them in reports.

Product implications:

- Show worker participation through hazard reports, observations, comments, acknowledgements, and review history.
- Make hazard identification a daily field workflow, not an annual form.
- Tie each hazard, incident, and audit finding to prevention and control actions.
- Include program evaluation signals on dashboards: open hazards, aging CAPAs, recurring categories, stale reviews, and overdue verification.
- Treat nonroutine work such as confined space, hot work, and LOTO as higher-risk workflows with stronger prompts and evidence capture.

### NIOSH Hierarchy Of Controls

Corrective actions and risk controls should be ranked by control strength:

1. Elimination
2. Substitution
3. Engineering controls
4. Administrative controls
5. PPE

Product implications:

- CAPA and risk-control forms should include a `controlLevel` field.
- AI suggestions should prefer stronger controls and explain when a suggestion relies only on training, signage, or PPE.
- Dashboards should flag weak-control patterns, such as repeated incidents closed with only "retrain employee."
- Audit bundles should show the selected control level and verification evidence.

### ISO 45001 And PDCA

ISO 45001-style programs use a Plan-Do-Check-Act cycle, leadership accountability, worker participation, risk-based planning, documented information, performance evaluation, and improvement. SoteriaField should support that management-system loop without forcing every customer into formal certification.

Product implications:

- Plan: risk registers, inspections, permit planning, controls, training needs, and assigned owners.
- Do: field execution, permits, LOTO steps, observations, incidents, and corrective actions.
- Check: inspections, audits, evidence readiness, analytics, control verification, and trend review.
- Act: CAPA closure, management review notes, policy updates, retraining, and workflow improvements.
- Leadership users should see executive summaries and accountability views, not only raw records.

### Root Cause And CAPA Discipline

Incident and near-miss workflows should move customers away from blame and toward system correction.

Product implications:

- Investigations should separate immediate cause, contributing factors, root cause, and corrective/preventive actions.
- Include structured methods such as 5 Whys, cause mapping, and barrier failure prompts for significant incidents.
- Require CAPAs to link back to root causes for higher-severity events.
- Require verification before high-severity CAPAs are considered fully effective.
- Preserve original field reports separately from investigator-edited summaries.

### Barrier And Bowtie Thinking

High-risk operations benefit from barrier-based thinking: threats, top event, consequences, preventive controls, recovery controls, and escalation factors.

Product implications:

- Risk register and permit workflows should be able to show expected controls before work starts.
- Incident investigations should ask which barrier failed, was missing, or was bypassed.
- Command center signals should include failed or overdue critical controls.
- Future analytics can show repeated barrier failures across sites.

### Management Of Change

Many serious events happen after process, equipment, chemical, staffing, or procedure changes. SoteriaField should eventually include lightweight management-of-change behavior where it intersects with EHS workflows.

Product implications:

- Flag changes to equipment, chemicals, procedures, permit templates, and critical controls.
- Require review for changes affecting LOTO steps, confined space classification, hot work controls, SDS hazards, or PPE requirements.
- Preserve before/after versions and approver history.
- Surface "recent changes" in evidence bundles and investigations.

## Client-Valued SaaS Patterns

These patterns make the product easier to buy, deploy, and keep. They should be designed into the app, not added as customer-success paperwork later.

### Fast Time-To-Value

Customers should see real value during the first session.

Product implications:

- First-run setup should guide a tenant to one meaningful outcome: invite a user, create first site, add first equipment, generate first QR, or submit first hazard.
- Demo tenants should include realistic sample data, not empty dashboards.
- The app should offer starter templates by vertical: manufacturing, construction, facilities, energy, and warehousing.
- Keep setup progressive. Do not require full enterprise configuration before showing value.

### Role-Based Onboarding

Different users need different first experiences.

Product implications:

- Frontline worker: report hazard, scan QR, complete action, upload evidence.
- Supervisor: triage reports, assign CAPAs, review permits.
- Safety manager: command center, analytics, audit bundles, configuration.
- Executive: trend summary, risk exposure, overdue accountability, audit readiness.
- Superadmin: tenant health, module usage, support escalation, demo reset.

### Guided Implementation

Enterprise customers often need migration, rollout, training, and adoption tracking.

Product implications:

- Add an implementation checklist per tenant.
- Track setup completeness: sites, users, modules, roles, templates, notifications, branding, and sample records removed.
- Add import templates and validation reports for equipment, users, chemicals, and training records.
- Provide a customer-facing readiness score before go-live.
- Preserve implementation decisions as tenant configuration history.

### Customer Success Health

SoteriaField should know whether a tenant is adopting the product.

Product implications:

- Track activation milestones: first hazard, first CAPA closed, first permit completed, first bundle generated, first assistant citation-backed answer.
- Track usage by module, site, and role.
- Surface adoption gaps to tenant admins and superadmins.
- Add "stuck tenant" signals: no invited users, no field reports, no closed CAPAs, failed imports, unresolved support tickets.

### Executive And Board-Ready Reporting

Clients like tools that help them communicate upward.

Product implications:

- Add a monthly EHS executive summary export.
- Include leading indicators, overdue accountability, severe incidents, audit readiness, and improvement actions.
- Keep drilldowns available for safety managers while giving executives a concise view.
- Avoid vanity metrics. Every metric should connect to risk, compliance, productivity, or accountability.

### Integration-Friendly Enterprise Basics

Enterprise buyers expect the product to fit their environment.

Product implications:

- Plan for SSO/SAML or OIDC when enterprise readiness becomes a priority.
- Keep role and permission boundaries explicit.
- Support CSV import/export before deep integrations.
- Preserve stable IDs and audit logs so future HRIS, LMS, ERP, CMMS, or document-system integrations are possible.
- Treat notification integrations such as email, Teams, Slack, and SMS as configurable channels, not hard-coded assumptions.

## Federal Government And Military Readiness

SoteriaField should be designed so it can credibly pursue federal, VA, and DoD opportunities as an SDVOSB-led SaaS. This is not only a sales motion. It changes product architecture, security operations, documentation, accessibility, deployment, support, and evidence generation.

Do not claim FedRAMP, CMMC, DoD Impact Level, Section 508, or VA/DoD readiness until the required assessments, artifacts, and authorizations exist. The product can be "federal-ready by design" before it is certified.

### Federal Buyer Targets

Likely early targets:

- VA facilities and safety/compliance teams
- DoD installations, depots, shipyards, maintenance, logistics, and training environments
- Federal facility management teams
- Federal contractors that need field safety, LOTO, permits, incidents, SDS, inspections, and audit evidence
- Prime contractors that need an SDVOSB SaaS partner or subcontractor for safety operations

### Procurement And SDVOSB Readiness

Business artifacts to prepare alongside the product:

- SBA VetCert / SDVOSB status reflected correctly in SAM.gov
- Capability statement focused on EHS SaaS, AI guardrails, field safety, and compliance evidence
- NAICS and PSC mapping for software, EHS, safety, compliance, IT, and professional support opportunities
- Past performance narrative, even if starting with commercial pilots
- Pricing model suitable for government purchase cards, purchase orders, annual subscriptions, and task orders
- Terms covering data rights, government data ownership, export controls, security incident notification, records, and termination assistance
- Partner strategy for prime contractors, 3PAOs, C3PAOs, FedRAMP advisors, and government cloud hosting

### FedRAMP And Federal Cloud Path

If federal agencies will use SoteriaField as a cloud service, plan for FedRAMP. As of the 2026 FedRAMP modernization direction, cloud providers should expect NIST SP 800-53 Rev. 5 baselines, continuous monitoring, reusable authorization packages, and increasing use of machine-readable authorization artifacts such as OSCAL.

Product and platform implications:

- Define the FedRAMP authorization boundary early.
- Separate commercial and government environments.
- Host federal environments only on FedRAMP-authorized infrastructure and services that fit the target baseline.
- Document every external service inside or connected to the boundary: auth, database, object storage, email, AI providers, logging, analytics, monitoring, error tracking, CDN, and support tools.
- Build a System Security Plan (SSP), control implementation statements, data flow diagrams, inventory, ports/protocols/services list, incident response plan, configuration management plan, vulnerability management plan, contingency plan, and POA&M process.
- Implement continuous monitoring evidence generation: vulnerability scans, dependency scans, patch status, configuration drift, audit logs, incident metrics, user access reviews, and change records.
- Prefer deterministic evidence exports over manually written narratives where possible.

Near-term build requirements:

- Security evidence dashboard for internal admins.
- Asset/service inventory for production dependencies.
- Control mapping registry for NIST 800-53, NIST 800-171, CMMC, and Section 508.
- Audit log export with filters and immutable retention options.
- Change management records linked to deploys, migrations, and feature flags.
- Vulnerability and dependency scan reporting in CI.

### CMMC, FCI, And CUI Readiness

For DoD work, CMMC may apply to the company systems used to perform contracts, especially when handling Federal Contract Information (FCI) or Controlled Unclassified Information (CUI). CMMC requirements are now being phased into DoD contracts, with Phase 1 running from November 10, 2025 through November 9, 2026 and focused primarily on Level 1 and Level 2 self-assessments.

Product and company implications:

- Treat federal contract data, support tickets, exports, uploaded files, logs, and AI prompts as possible FCI/CUI until classified by contract/data owner.
- Add data marking support: Public, Internal, FCI, CUI, export-controlled, and customer-defined markings.
- Add tenant-level data handling policy flags.
- Prevent CUI from being sent to non-approved third-party AI, logging, analytics, or support systems.
- Build an SSP and POA&M for company systems that process contract data.
- Prepare for annual affirmations and SPRS reporting when required by contract.
- For CMMC Level 2 opportunities, map implementation to NIST SP 800-171 controls and preserve evidence.

Near-term build requirements:

- CUI/FCI data classification fields on documents, attachments, support tickets, AI conversations, exports, and tenant settings.
- AI data egress controls that block or route sensitive prompts away from non-approved models.
- Admin policy to disable AI features per tenant or per data class.
- Evidence export for access control, audit logs, incident response, configuration changes, vulnerability scans, and user training.
- Data retention and legal hold controls for federal tenants.

### DoD Cloud And Impact Level Path

Military use may require alignment with the DoD Cloud Computing Security Requirements Guide and a DoD Provisional Authorization at the appropriate Impact Level. DoD cloud impact levels commonly include IL2, IL4, IL5, and IL6; IL4/IL5 expectations are materially different from commercial SaaS.

Product and platform implications:

- Decide whether the first military path is IL2-style public/low-risk unclassified use, IL4 CUI use, or IL5 mission/business-critical CUI/NSS-adjacent use.
- Plan for a dedicated government deployment rather than mixing DoD tenants into commercial production.
- Support CAC/PIV authentication and federation with government identity providers.
- Support agency-controlled retention, export, and deletion processes.
- Prepare ports/protocols/services documentation and network boundary diagrams.
- Plan for STIG/SRG-aligned hardening of operating systems, containers, databases, web servers, and application components.

Near-term build requirements:

- Environment separation: commercial, federal sandbox, federal production.
- Government identity integration strategy: SAML/OIDC now, CAC/PIV support when needed.
- Tenant-level network and integration allowlists.
- Per-tenant data residency and backup region controls.
- Break-glass admin workflow with approval, reason, time limit, and audit trail.

### Section 508 And Accessibility

Federal software procurements require accessibility. Web application design should be ready for Section 508 conformance and a VPAT/ACR.

Product implications:

- Target WCAG AA behavior across the web app.
- Ensure keyboard navigation for all workflows.
- Ensure screen-reader labels, focus states, error messages, and form associations.
- Avoid color-only severity indicators.
- Test mobile and desktop accessibility for command center, forms, tables, modals, upload controls, and chat/assistant flows.
- Prepare a Voluntary Product Accessibility Template / Accessibility Conformance Report.

Near-term build requirements:

- Accessibility test checklist for every new feature.
- Automated checks in CI where practical.
- Manual keyboard and screen-reader smoke tests for core workflows.
- Design-system guidance for severity, icons, modals, tables, and forms.

### Federal Security Features

Federal buyers will expect these baseline capabilities:

- Strong MFA and phishing-resistant authentication options where feasible
- SSO with SAML/OIDC
- CAC/PIV roadmap
- Fine-grained RBAC and least privilege
- Site/installation-level authorization boundaries
- Session timeout and reauthentication for sensitive actions
- Full audit logs for read/write/admin/export/AI actions
- Tamper-resistant retention for regulated records
- Customer-managed retention policies
- Encryption in transit and at rest with FIPS-validated cryptography where required
- Key management plan, with customer-managed keys as a future enterprise option
- Secure file handling: malware scanning, content type validation, size limits, and quarantine
- SIEM export via API, webhook, or syslog-compatible path
- Incident response workflow and customer notification SLAs
- Backup, restore, disaster recovery, and tested business continuity procedures

### Federal AI Governance

AI can be a differentiator in federal EHS only if it is controlled.

Product implications:

- Tenants must be able to disable AI entirely.
- Tenants must be able to restrict AI by data class.
- AI responses must cite approved tenant/federal sources for policy or procedure questions.
- AI prompts and completions involving federal data need retention, redaction, and export controls.
- No CUI, export-controlled, sensitive personnel, or mission data should leave approved boundaries.
- Human approval remains required for permits, LOTO certification, CAPA closure, incident determinations, and regulatory filings.

Near-term build requirements:

- AI policy controls at tenant/module/data-class level.
- Model/provider allowlist per deployment boundary.
- Prompt logging with sensitive-data minimization.
- Source citation evidence for AI answers.
- Admin review queue for AI escalations, refusals, and accepted suggestions.

## Cross-Module Architecture Discovery

The current app already has meaningful cross-module behavior, but it is mostly point-to-point rather than a deliberate data fabric.

Observed current patterns:

- The feature catalog in `packages/core/src/features.ts` is the navigation and module-visibility source of truth.
- The home metrics layer aggregates multiple modules into dashboard signals.
- Incidents can directly reference related hot work permits, confined space permits, LOTO-like permits, and JHAs.
- Near-miss, risk, and JHA share severity and hazard taxonomy concepts.
- Incident scorecards aggregate incidents, classifications, actions, care records, and related RCA data.
- Chat, safety boards, manuals, AI support, and notifications create collaboration surfaces around module records.
- LOTO equipment and photo evidence already have shared helper patterns for storage, tenant scoping, and offline upload.

Main architecture gap:

Modules can share data, but there is no canonical cross-module relationship layer, event stream, shared action model, or evidence graph. As the app grows, hard-coded fields such as `related_hot_work_permit_id` and module-specific action tables will become brittle. The product needs a controlled way for modules to communicate while preserving tenant isolation, permissions, auditability, and module-level autonomy.

### Target Cross-Module Model

Use a shared EHS operating graph. Each module remains responsible for its own regulated workflow, but shared context is available through common entities, links, events, actions, and evidence.

Canonical shared entities:

- Tenant
- Site or installation
- Department or work area
- Worker, profile, role, and authorization
- Equipment or asset
- Chemical product and SDS
- Job, task, or JHA
- Permit or work authorization
- Hazard or risk
- Incident, near miss, observation, or anonymous report
- Corrective/preventive action
- Training record
- Document, attachment, photo, signature, or generated PDF
- Discussion, comment, notification, or acknowledgement

### Module Ownership Rules

Each module owns its authoritative state:

- LOTO owns equipment lockout steps, placards, photo evidence, and LOTO-specific review states.
- Confined spaces owns space inventory, permit-required classification, atmospheric test records, entry permits, attendants, entrants, and permit cancellation/expiration.
- Hot work owns hot work permits, fire watch, area checks, and permit expiration.
- Incidents owns incident reports, investigations, OSHA classification, people, RCA, care records, and incident-originated CAPAs.
- Risk/JHA owns hazard identification, risk scoring, controls, and job/task hazard context.
- Chemicals owns SDS, chemical inventory, approvals, labels, MAQ, Tier II, and restricted chemical controls.
- BBS/observations owns behavior observations, coaching, and leading-indicator participation records.
- Chat/safety boards/manuals own collaboration and knowledge records, not regulated workflow state.

Cross-module features should link to module-owned records rather than copying regulated state into another module.

### Entity Relationship Registry

Add a general relationship registry for cross-module links that are broader than a single hard-coded foreign key.

Recommended table concept: `entity_links`.

Fields:

- `id`
- `tenant_id`
- `source_type`
- `source_id`
- `target_type`
- `target_id`
- `relationship_type`
- `relationship_strength`: `direct | inferred | suggested`
- `source_module`
- `target_module`
- `created_by`
- `created_at`
- `deleted_at`
- `metadata`

Recommended relationship types:

- `related_to`
- `caused_by`
- `contributed_to`
- `mitigated_by`
- `verified_by`
- `evidence_for`
- `generated_from`
- `supersedes`
- `requires_training`
- `performed_under`
- `occurred_at`
- `involves_asset`
- `involves_chemical`
- `created_action`
- `blocked_by`
- `duplicate_of`

Rules:

- Strong workflow-critical relationships can still use explicit foreign keys.
- The registry handles flexible cross-module context, audit bundles, AI retrieval, search, timelines, and dashboards.
- Links must always include `tenant_id`.
- Link resolvers must enforce target permissions before exposing target details.
- Disabled modules should not leak sensitive target details through relationship previews.
- AI-suggested links must remain suggestions until accepted by an authorized human or safe system rule.

### Domain Event Outbox

Add an append-only event layer so modules can communicate without calling each other directly.

Recommended table concept: `domain_events`.

Fields:

- `id`
- `tenant_id`
- `module`
- `event_type`
- `entity_type`
- `entity_id`
- `actor_user_id`
- `occurred_at`
- `summary`
- `payload`
- `correlation_id`
- `causation_id`
- `visibility`: `internal | tenant_admin | user_visible`

Initial event types:

- `entity.created`
- `entity.updated`
- `status.changed`
- `evidence.uploaded`
- `action.assigned`
- `action.completed`
- `action.verified`
- `permit.started`
- `permit.expired`
- `incident.reported`
- `incident.triaged`
- `risk.reviewed`
- `chemical.sds_updated`
- `training.expiring`
- `ai.suggestion.accepted`
- `export.generated`

Consumers:

- Command center signals
- Notification routing
- Audit bundles
- Record timelines
- Executive reporting
- AI context packs
- Customer success/adoption health
- Federal evidence exports

Rules:

- Events are facts, not commands.
- Events should not replace module-owned tables.
- Events should be append-only except for retention/legal purge processes.
- Do not put large blobs or sensitive raw attachments in event payloads.
- Payloads must avoid cross-tenant identifiers and should use stable object references.

### Unified Safety Actions

The app already has incident actions/CAPA. For competitive EHS workflows, actions should become cross-module while preserving incident-specific detail.

Recommended future concept: `safety_actions`.

Core fields:

- `tenant_id`
- `source_type`
- `source_id`
- `action_type`: `corrective | preventive | interim | verification | follow_up`
- `owner_user_id`
- `due_at`
- `status`
- `control_level`
- `description`
- `verification_required`
- `verified_at`
- `verified_by`
- `verification_evidence_id`

Migration path:

- Keep `incident_actions` as the authoritative incident CAPA table for now.
- Introduce cross-module action views or adapters first.
- Only consolidate into `safety_actions` when risk, JHA, audits, permits, chemicals, and incidents need the same lifecycle.
- Do not duplicate open-action dashboard logic across modules.

### Evidence Graph

Evidence should be reusable across records without losing provenance.

Recommended concept: a shared evidence registry over attachments, photos, signatures, generated PDFs, exports, and AI-supported drafts.

Fields:

- `tenant_id`
- `evidence_type`
- `storage_path` or generated artifact reference
- `source_module`
- `source_type`
- `source_id`
- `captured_by`
- `captured_at`
- `hash`
- `classification`
- `retention_policy`
- `metadata`

Uses:

- Audit bundles
- Permit packages
- Incident investigations
- OSHA records
- LOTO equipment evidence
- SDS evidence
- Federal evidence exports
- AI citation/source tracking

Rules:

- Evidence can be linked to many records through `entity_links`.
- Evidence must keep original capture metadata.
- Generated documents should record the source record versions used to create them.

### Shared Record Context API

Add a server-side resolver that can build a safe context pack for any module-owned record.

Recommended function shape:

- Input: `tenantId`, `viewerUserId`, `entityType`, `entityId`, `purpose`
- Output: allowed summary, related links, evidence, actions, timeline events, permission flags, and redacted fields

Purposes:

- UI related-record panels
- AI assistant grounding
- Audit bundle preview
- Command center drilldown
- Search result expansion
- Notification detail

Rules:

- The resolver must check tenant, role, module visibility, record permission, and data classification.
- The resolver should return redacted summaries when full detail is not allowed.
- The resolver should be server-side for sensitive contexts.

### Cross-Module UX Patterns

Every major record detail page should eventually have the same context affordances:

- Related records
- Evidence
- Actions
- Timeline
- Discussions
- AI assistant
- Audit/export
- Permissions/classification

Examples:

- An incident links to the JHA, equipment, chemical, permit, training record, photos, witness statements, RCA nodes, CAPAs, and final evidence bundle.
- A hot work permit links to related equipment, area, JHA, fire watch evidence, incident reports, and corrective actions.
- A chemical links to SDS, inventory locations, JHAs, incidents/spills, approvals, labels, and Tier II reporting.
- A LOTO asset links to energy steps, placards, photo evidence, JHAs, incidents, reviews, training, and decommission history.

### Architecture Acceptance Criteria

- A module can link to another module's record without adding a bespoke column every time.
- Command center can consume event and relationship data without scanning every module table directly.
- Audit bundles can discover related evidence across modules.
- AI context packs can retrieve related records safely and cite sources.
- Permissions prevent cross-module links from leaking restricted records.
- Tenant isolation is enforced on every link, event, action, and evidence query.
- Existing module-owned workflows continue to work without a disruptive rewrite.

### Suggested First Cross-Module Slice

Start small:

1. Add a pure TypeScript relationship model in `@soteria/core`.
2. Add an `entity_links` migration with RLS and indexes.
3. Add helper functions for creating and resolving links.
4. Backfill or write links for incident relationships that already exist as explicit fields.
5. Add a related-records panel to incident detail.
6. Add tests for tenant isolation, permission-filtered previews, duplicate link prevention, and link deletion.

This gives the app a durable integration layer without forcing an immediate rewrite of existing modules.

## Existing Strengths To Preserve

- Multi-tenant architecture with active tenant context and Supabase RLS expectations
- Broad EHS module coverage: LOTO, confined spaces, hot work, risk, incidents, chemicals/SDS, BBS, toolbox talks, safety boards, chat, support, manuals, notifications, and superadmin operations
- Existing support bot and broader assistant concepts
- Existing module visibility model through tenant modules
- Existing offline upload queue pattern for LOTO photos
- Existing generated documents and compliance surfaces such as permits, placards, OSHA forms, and labels
- Existing home metrics and emerging command center component
- Existing point-to-point cross-module patterns, especially incident links to permits/JHA, shared risk/near-miss/JHA taxonomy, scorecard aggregation, chat/safety-board collaboration, and support/assistant knowledge surfaces

## Target Experience

### Home Screen

The home dashboard becomes a command center, not a menu.

It should answer:

- What is critical right now?
- What is expiring soon?
- What work is waiting on me?
- Which sites or modules are trending worse?
- What evidence is missing before an audit?
- What can I safely do next?

Primary home sections:

- EHS Command Center
- My Field Actions
- Permit Pulse
- Incident and CAPA Pulse
- Evidence Readiness
- AI Safety Assistant
- Recent Activity

### Mobile Field Mode

Mobile should prioritize capture and action:

- Report hazard
- Report near miss
- Start or continue permit
- Capture LOTO photo
- Scan QR
- Complete corrective action
- Ask assistant
- Upload evidence

Mobile field mode should avoid dense dashboard layouts. It should use large touch targets, predictable flows, draft recovery, and offline indicators.

### Admin And Safety Manager Mode

Safety managers need triage, review, assignment, export, and configuration:

- Command center drilldowns
- CAPA assignment and aging
- Permit review and exception handling
- Audit bundle generation
- Module configuration
- Site/team filters
- AI usage and escalation review
- Trend analytics

## Major Additions

## 1. EHS Command Center

### Goal

Create a live operational risk pulse that prioritizes urgent work across modules.

### Current Starting Point

The app has home metrics and an initial `CommandCenterPanel` concept. Expand this into a reusable command center model.

### Signals

Initial signals:

- Expired confined space permits
- Confined space permits expiring soon
- Hot work permits expiring soon
- Stale permit drafts
- Active fire watch
- Low LOTO photo evidence coverage
- Open corrective actions assigned to current user
- Overdue CAPAs
- Recent severe incidents
- Open anonymous reports awaiting triage
- SDS drift or missing SDS records
- Expiring training or missing authorization for active work
- Offline uploads pending sync

### Signal Model

Each signal should have:

- `id`
- `tenantId`
- `siteId` when available
- `module`
- `severity`: `critical | warning | attention | ok`
- `status`: `open | acknowledged | resolved | suppressed`
- `title`
- `detail`
- `primaryHref`
- `ownerUserId` when available
- `sourceObjectType`
- `sourceObjectId`
- `createdAt`
- `expiresAt` or `dueAt` when relevant

### UX Requirements

- Show the highest-priority items first.
- Make every card actionable.
- Avoid generic alerts that do not explain what to do.
- Allow filters by site, module, assigned-to-me, and severity.
- Provide an all-clear state that is useful, not decorative.
- Include loading, unavailable, and partial-data states.

### Engineering Notes

- Start with derived signals from existing metrics before creating new tables.
- Move pure signal derivation into a non-client helper when tests require it.
- Keep tenant scope explicit in every query.
- Add focused unit tests for signal priority, thresholds, empty states, and source links.

### Acceptance Criteria

- A safety manager can open the dashboard and immediately see the top 3 operational risks.
- A frontline user sees only actions relevant to them and their accessible modules.
- Signal derivation is covered by tests.
- Missing metrics show an understandable degraded state.

## 2. Field-First 30-Second Workflows

### Goal

Make common safety capture faster than legacy EHS systems.

### Workflows

Prioritize these:

- Report hazard
- Report near miss
- Capture LOTO evidence
- Complete assigned corrective action
- Start confined space permit draft
- Start hot work permit draft
- Upload SDS or chemical evidence
- Submit anonymous QR report

### UX Pattern

Each workflow should have:

- One primary action per screen
- Minimal required fields at first capture
- Photo/audio/QR support where useful
- Save-as-draft behavior
- Offline queue where feasible
- Clear sync status
- Human review step for regulated or high-risk outcomes

### Data Requirements

Capture provenance:

- Tenant
- Site or location
- User or anonymous source
- Timestamp
- Device/client source when available
- Attachments
- Original submitted text
- AI-normalized text when used
- Review status

### Acceptance Criteria

- A user can submit a basic hazard with photo in under 30 seconds on mobile.
- Drafts are recoverable after navigation or refresh.
- Offline pending items cannot sync into the wrong tenant.
- Review queues preserve original submission text.

## 3. AI Safety Assistant With Guardrails

### Goal

Make AI useful for EHS without creating unsafe authority or compliance risk.

### Assistant Jobs

The assistant should help with:

- Searching company policy, manuals, SDSs, procedures, and past incidents
- Explaining how to use SoteriaField
- Drafting incident summaries from structured facts
- Suggesting CAPA candidates for human review
- Classifying hazard reports
- Finding related equipment, chemicals, permits, and documents
- Creating audit bundle checklists
- Translating field reports
- Escalating uncertain or high-risk questions to a human

### Non-Negotiable Guardrails

The assistant must not:

- Approve permits
- Certify LOTO completion
- Sign documents
- Close CAPAs without human action
- Invent policy or regulatory citations
- Answer high-risk procedural questions without grounded sources or escalation
- Cross tenant boundaries

### Response Requirements

For EHS knowledge answers:

- Cite source documents or records when possible.
- Show confidence or uncertainty.
- Separate company policy from general guidance.
- Provide an escalation path.
- Preserve conversation and AI invocation logs where appropriate.

### AI Architecture

Prefer a retrieval-first flow:

1. Identify tenant, user, role, module context, and active object.
2. Retrieve relevant KB, manuals, SDSs, permits, incidents, equipment, and policies.
3. Generate answer with citations.
4. Apply safety/compliance refusal and escalation rules.
5. Log invocation, sources, model, token use, and outcome.

### Implementation Slices

- Expand support bot knowledge grounding.
- Add cross-module assistant context packs.
- Add "ask about this record" buttons on permits, incidents, SDSs, equipment, and CAPAs.
- Add AI draft suggestions for incident summaries and corrective actions.
- Add AI review queue for suggested classifications.

### Acceptance Criteria

- AI answers cite tenant-scoped sources for policy/SDS/procedure questions.
- The assistant refuses or escalates unsafe approval/certification requests.
- AI-generated suggestions are visually labeled as suggestions.
- Human actions remain auditable and distinct from AI output.

## 4. Audit-Ready Evidence Bundles

### Goal

Turn compliance evidence into a first-class workflow.

### Bundle Types

Initial bundle types:

- OSHA incident package
- Confined space permit package
- Hot work permit package
- LOTO equipment evidence package
- Chemical/SDS compliance package
- CAPA closure package
- Site audit package

### Bundle Contents

Depending on bundle type:

- Record summary
- Status history
- User actions and timestamps
- Photos and attachments
- Signatures or acknowledgements
- Related permits, incidents, CAPAs, and equipment
- Source documents and versions
- AI suggestions used, if any
- Export timestamp and exporting user

### UX Requirements

- "Generate evidence bundle" should be available from relevant records.
- Show what will be included before generation.
- Allow date/site/module filters for site audit bundles.
- Include missing-evidence warnings before export.
- Produce stable PDFs or ZIP packages.

### Engineering Notes

- Treat generated bundles as durable artifacts.
- Store bundle metadata and source object references.
- Avoid regenerating silently different output without versioning.
- Tenant scope and permissions must be checked server-side.

### Acceptance Criteria

- A safety manager can generate a permit or incident bundle from a record detail page.
- The bundle lists included sources and missing evidence.
- The export action is auditable.
- Unauthorized users cannot generate or access bundles.

## 5. Virtual User Simulation

### Goal

Use simulated users to find workflow friction, permission gaps, and implementation regressions before real customers do.

### Simulation Types

- New tenant admin setup
- Frontline worker hazard report
- Supervisor CAPA review
- Safety manager permit audit
- Superadmin tenant support
- Offline photo capture and sync
- Disabled module direct navigation
- Role downgrade during active session

### Outputs

Each simulation should produce:

- Journey name
- Persona and permissions
- Steps attempted
- Expected result
- Actual result
- Friction score
- Bugs or product gaps
- Suggested fix

### Implementation Path

- Start as documented manual scenarios.
- Convert high-value scenarios to Playwright or browser automation tests.
- Add seeded demo tenant data for repeatable runs.
- Later, allow AI to propose new journey variants, but keep execution deterministic.

### Acceptance Criteria

- Core journeys are documented and repeatable.
- At least the highest-risk journeys become automated tests.
- Failures produce actionable output for engineering.

## 6. Configurable Enterprise Workflows

### Goal

Let tenants adapt the product without turning safety-critical state into untestable custom logic.

### Configurable Areas

- Module visibility
- Site and department labels
- Required fields by workflow
- Notification rules
- CAPA categories and due date defaults
- Hazard categories
- Inspection templates
- Audit bundle templates
- Branding and logos

### Protected Areas

These should remain controlled and explicit:

- Permit approval and expiration states
- LOTO completion evidence
- OSHA recordkeeping fields
- Signature and acknowledgement semantics
- Tenant isolation and role boundaries
- Generated document provenance

### Acceptance Criteria

- Admins can configure non-regulated workflow labels and required fields.
- Regulated status transitions remain explicit, tested, and auditable.
- Config changes have audit logs.

## 7. Offline And Performance Improvements

### Goal

Make the app reliable in field conditions and fast under real SaaS usage.

### Priorities

- Expand IndexedDB/offline queue beyond LOTO photos for hazard reports and CAPA evidence.
- Keep large image compression off the main thread.
- Add upload progress and retry state.
- Use bounded queries and pagination for operational lists.
- Avoid loading heavy module bundles on the home screen.
- Prefer derived summary queries or RPCs for command center metrics when data grows.
- Add performance budgets for dashboard and mobile capture flows.

### Browser/Chrome Verification Opportunities

Use browser automation for:

- Mobile viewport smoke tests
- Offline mode simulation
- File/photo upload behavior
- PWA install/update banners
- Dashboard layout and text overlap checks
- Command center drilldown paths
- Core journeys from virtual user simulation

### Acceptance Criteria

- Mobile capture remains responsive during image attachment.
- Offline pending items show clear status and retry.
- Dashboard does not require loading every module's full UI code.
- Browser tests cover at least one mobile field workflow and one dashboard workflow.

## 8. Analytics And Safety Intelligence

### Goal

Help customers move from recordkeeping to prevention.

### Analytics

- Leading indicators: hazards, near misses, overdue CAPAs, open permits, missing evidence
- Lagging indicators: incidents, severity, OSHA recordability, lost time
- Operational indicators: response time, close time, permit cycle time, stale drafts
- Evidence indicators: photo coverage, missing signatures, missing SDS, expired training
- AI indicators: usage, escalations, refusal rate, source coverage

### UX

- Keep analytics actionable.
- Every chart should answer a decision question.
- Provide drilldowns from chart to records.
- Avoid vanity metrics without workflow implications.

### Acceptance Criteria

- Safety managers can identify the worst site/module trend quickly.
- Analytics drill down to source records.
- AI usage reports show governance-relevant details.

## 9. Tenant Onboarding And Adoption System

### Goal

Make implementation and adoption measurable. This is a buyer-facing differentiator because EHS SaaS fails when setup takes too long, users do not adopt it, or customer success cannot see where a tenant is stuck.

### Onboarding Objects

Each tenant should eventually have:

- Implementation stage: `trial | setup | pilot | live | expanding | at_risk | archived`
- Target go-live date
- Primary champion
- Executive sponsor
- Enabled modules
- Required setup checklist
- Import jobs and validation results
- Training completion summary
- Activation milestones
- Customer-success notes

### Setup Checklist

Recommended initial checklist:

- Add sites/departments
- Invite admins and supervisors
- Invite frontline users or generate QR access
- Configure enabled modules
- Upload logo and basic branding
- Import equipment
- Import chemicals/SDS records when relevant
- Import training or authorization records when relevant
- Configure notification rules
- Complete first field workflow
- Generate first report or evidence bundle

### Adoption Signals

Signals for tenant admins and superadmins:

- No active users in 7 days
- Invites not accepted
- Module enabled but unused
- Drafts created but not submitted
- CAPAs created but not closed
- Hazards reported but not reviewed
- Imports failing validation
- AI assistant questions escalating frequently
- Support tickets unresolved

### Acceptance Criteria

- A new tenant admin can see exactly what remains before go-live.
- Superadmins can identify stuck tenants without manually inspecting records.
- Activation milestones are tied to real product usage, not page visits.
- Import failures produce actionable validation messages.

## 10. Client-Preferred Templates And Playbooks

### Goal

Give customers proven starting points that reduce blank-page setup and make the app feel immediately useful.

### Template Library

Initial template categories:

- Manufacturing starter
- Construction starter
- Facilities starter
- Warehouse starter
- Energy/utilities starter
- Confined space program starter
- Hot work program starter
- LOTO equipment review starter
- Incident investigation starter
- CAPA verification starter
- Chemical/SDS starter

### Playbooks

Each playbook should include:

- Recommended modules
- Starter fields and categories
- Default severity matrix
- Notification defaults
- Example inspections or checklists
- Example dashboard goals
- Suggested evidence bundle types
- Known regulatory caveats

### Acceptance Criteria

- A tenant can apply a starter template during setup.
- Templates are versioned.
- Applying a template creates auditable configuration changes.
- Templates never override regulated state transitions without explicit review.

## 11. Federal And Military Readiness Backlog

### Goal

Prepare SoteriaField for federal and military buyers by building the features, artifacts, and operating practices that support FedRAMP, CMMC, DoD cloud authorization, Section 508, and government procurement expectations.

### Readiness Levels

Use internal readiness levels so the team avoids premature claims:

- `commercial`: normal commercial SaaS operation
- `federal-ready-design`: architecture and records are being built with federal controls in mind
- `federal-sandbox`: isolated federal test environment, not production-authorized
- `fedramp-in-progress`: authorization boundary, SSP, controls, and 3PAO/advisor work underway
- `fedramp-authorized`: authorization achieved for the defined boundary
- `dod-il-in-progress`: DoD impact-level authorization work underway
- `dod-il-authorized`: DoD provisional authorization achieved for the defined impact level

### Product Features To Add

Identity and access:

- SAML/OIDC SSO
- Government identity provider support
- CAC/PIV roadmap and architecture
- Strong MFA controls
- Session timeout policies per tenant
- Sensitive-action reauthentication
- Break-glass access with approval and expiration
- Privileged access review reports

Data governance:

- Tenant-level data classification policy
- Record-level data markings for Public, Internal, FCI, CUI, export-controlled, and custom labels
- Retention policies by tenant, module, and record type
- Legal hold support
- Export package manifest with classification markings
- Data deletion and termination assistance workflow
- Customer data ownership statement in exports and admin screens

Audit and evidence:

- Immutable or tamper-evident audit log strategy
- Exportable audit logs for read/write/admin/export/AI/security events
- Evidence dashboard mapped to NIST 800-53, NIST 800-171, CMMC, and Section 508
- Control implementation registry
- POA&M tracking module for security/compliance gaps
- Machine-readable control/evidence export path, ideally OSCAL-compatible later

Security operations:

- Vulnerability scan ingestion and status reporting
- Dependency and container scan reporting
- Security incident workflow with severity, customer notification, artifacts, and closure
- SIEM export
- Malware scanning for uploads
- File quarantine and admin review
- Admin-visible backup/restore status
- Disaster recovery test evidence
- Change management log linked to deployments and migrations

Federal AI controls:

- Tenant AI disable switch
- Data-class AI restrictions
- Approved model/provider allowlist by environment
- Prompt/completion retention policy
- Redaction/minimization before AI calls
- AI egress blocking for CUI/FCI when provider/boundary is not approved
- AI source citation evidence
- AI governance report for admins

Accessibility:

- Section 508 feature checklist
- VPAT/ACR working document
- Keyboard navigation test coverage for core flows
- Screen-reader labels for command center, forms, modals, tables, upload flows, chat, and assistant
- Color-independent severity states

Government deployment:

- Dedicated federal deployment boundary
- Government-cloud hosting plan
- Separate secrets, storage, database, logs, monitoring, and support tooling from commercial production
- Federal environment runbooks
- Government-region backup policy
- Ports/protocols/services inventory
- Network diagrams and data flow diagrams
- STIG/SRG hardening checklist for infrastructure components

### Operational Artifacts To Create

Minimum package for serious federal pursuit:

- System Security Plan
- Architecture and data flow diagrams
- Authorization boundary definition
- Asset inventory
- Software bill of materials
- Secure software development lifecycle policy
- Configuration management plan
- Vulnerability management plan
- Incident response plan
- Contingency and disaster recovery plan
- Access control policy
- Audit and accountability policy
- Media protection and sanitization policy
- Supply chain risk management plan
- Privacy impact analysis when PII is involved
- Section 508 VPAT/ACR
- Customer responsibility matrix
- Subprocessor list
- Support and incident notification SLA
- POA&M

### SDVOSB Capture Support Inside The Product

The product should support the sales story without creating marketing-only features.

Useful additions:

- Demo tenant configured for federal facility safety workflows.
- Federal command center demo with LOTO, hot work, confined space, incident, SDS, CAPA, audit bundle, and AI guardrail examples.
- One-click sanitized demo reset.
- Exportable sample evidence bundle that looks like a government evaluation artifact.
- Admin screen showing security, accessibility, and audit capabilities.
- Proposal appendix generator for product capabilities, modules, security features, accessibility status, and support model.

### Acceptance Criteria

- The team can explain the federal authorization boundary in one diagram.
- The app can isolate a federal tenant from commercial tenants operationally and technically.
- Tenant admins can classify data and restrict AI by classification.
- Security/admin users can export audit and evidence logs.
- Core workflows pass accessibility smoke tests.
- The product has a credible artifact package for agency security review, even before formal authorization.

## 12. Cross-Module Data Fabric

### Goal

Let modules communicate and share context through deliberate shared primitives instead of one-off integrations.

This section operationalizes the architecture discovery above. It should be treated as foundational infrastructure for command center, AI, evidence bundles, analytics, customer health, and federal evidence.

### Shared Primitives

Build these in order:

- `entity_links`: flexible relationship registry
- `domain_events`: append-only module event outbox
- `safety_actions`: eventual cross-module action model or adapter layer
- `evidence_registry`: shared evidence/provenance layer
- `record_context_resolver`: safe server-side context API
- `record_timeline`: common read model over events, links, evidence, comments, and actions

### First Records To Connect

Prioritize records that already need cross-module context:

- Incident to JHA
- Incident to hot work permit
- Incident to confined space permit
- Incident to LOTO equipment
- Incident to chemical/SDS
- Incident to CAPA/action
- Risk/JHA to control library
- Chemical/SDS to JHA and incident
- LOTO equipment to JHA, training, and incident
- Permit to evidence, training, and incident

### API/Helper Requirements

Add helpers instead of hand-written link queries in each module:

- `createEntityLink()`
- `deleteEntityLink()`
- `listEntityLinksForRecord()`
- `listBacklinksForRecord()`
- `emitDomainEvent()`
- `listRecordTimeline()`
- `resolveRecordContext()`
- `assertCanReadLinkedRecord()`

### Acceptance Criteria

- New modules can create links and events without knowing another module's table shape.
- Related-record panels can be added consistently to detail pages.
- Command center can consume normalized events/signals.
- Evidence bundles can include linked records and evidence without bespoke module logic.
- AI assistant can use safe relationship context with citations.
- Cross-module link and event helpers have tenant isolation tests.

## Data And Architecture Guidelines

### Module Communication

Use the cross-module data fabric for new integrations.

Rules:

- Prefer explicit module-owned APIs for commands that change regulated workflow state.
- Prefer `domain_events` for broadcasting facts after state changes.
- Prefer `entity_links` for flexible relationships between records.
- Prefer `evidence_registry` for reusable attachments and generated artifacts.
- Prefer `record_context_resolver` for AI, search, audit bundles, notifications, and related-record UI.
- Avoid direct module-to-module imports that bypass permissions, tenant scope, or domain rules.
- Avoid duplicating another module's regulated state unless creating a deliberate read model.

### Tenant Isolation

Every new table, query, route, export, AI retrieval, upload, and background job must enforce tenant isolation.

Required checks:

- `tenant_id` on tenant-owned records
- RLS policy where data lives in Supabase
- App-side tenant filter for readability and defense in depth
- Server-side permission check for exports and AI retrieval
- Storage path includes tenant scope where files are tenant-owned

### Auditability

Create audit events for:

- Status transitions
- Signature or acknowledgement actions
- Export generation
- AI-assisted draft acceptance
- Config changes
- Permission changes
- Destructive actions

### AI Records

AI invocation logs should include:

- Tenant
- User
- Module
- Source object when applicable
- Model
- Prompt class or tool name
- Retrieved sources
- Token usage when available
- Result type: answered, refused, escalated, failed

### Performance

For command center and analytics:

- Avoid unbounded client-side scans.
- Prefer summary helpers, indexed filters, and server-side aggregation.
- Introduce materialized summaries only when live queries become costly.
- Add tests around threshold logic separate from UI rendering.

## Design System Direction

### Tone

Operational, calm, trustworthy, and fast. The app should feel like a professional safety operations tool, not a marketing site.

### UI Guidelines

- Prioritize dense but readable layouts for managers.
- Prioritize large touch targets and simple steps for field mode.
- Use clear severity colors sparingly and consistently.
- Do not bury critical actions in decorative cards.
- Every alert should explain the next action.
- Keep empty states useful.
- Make degraded states visible.

### Accessibility

- Keyboard-accessible workflows
- Clear focus states
- Sufficient contrast for severity states
- Do not rely on color alone
- Mobile-safe tap targets
- Text must not overflow controls

## Phased Roadmap

## Phase 0: Cross-Module Data Fabric Foundation

Goal: Give modules a safe way to share context before cross-module features multiply.

Tasks:

- Add a typed entity/relationship model in `@soteria/core`.
- Add `entity_links` migration with RLS, tenant indexes, and duplicate prevention.
- Add link helper functions and tests.
- Backfill links for existing incident relationships to permits/JHA where possible.
- Add a related-records panel to incident detail.
- Draft `domain_events` schema and event taxonomy.
- Document permission behavior for linked records from disabled or restricted modules.

Exit criteria:

- Existing point-to-point incident relationships can be viewed through the relationship layer.
- Link helpers enforce tenant isolation.
- The command center, AI assistant, and evidence bundle roadmap have a shared integration primitive.

## Phase 1: Command Center MVP

Goal: Make the dashboard immediately useful.

Tasks:

- Expand command center signals from existing metrics.
- Add assigned-to-me action summary.
- Add overdue CAPA and recent severe incident signal if data is available.
- Add weak-control and evidence-readiness signals where existing data supports them.
- Add unit tests for signal priority and thresholds.
- Add mobile layout verification.

Exit criteria:

- Dashboard shows clear critical/warning/attention states.
- Users can click from each signal to the relevant operational page.

## Phase 2: Field Capture Speed

Goal: Make frontline capture excellent.

Tasks:

- Create quick hazard report flow.
- Add photo-first capture.
- Add draft recovery.
- Add offline queue for hazard/CAPA evidence.
- Add browser/mobile smoke test.

Exit criteria:

- A basic hazard report with photo can be submitted in under 30 seconds.
- Offline pending state is visible and tenant-safe.

## Phase 3: AI Guardrails And Context

Goal: Make assistant useful and trusted.

Tasks:

- Add tenant-scoped context packs by module.
- Add cited answers for policies/manuals/SDSs.
- Add refusal/escalation rules for approval/certification requests.
- Add AI invocation log review surface for admins.

Exit criteria:

- AI answers are source-grounded for knowledge questions.
- Safety-critical decisions remain human-controlled.

## Phase 4: Evidence Bundles

Goal: Make audit preparation a product strength.

Tasks:

- Implement one record-level evidence bundle, preferably incident or permit.
- Add preview of included/missing evidence.
- Store bundle metadata.
- Add permission and tenant tests.

Exit criteria:

- Safety manager can generate and retrieve an auditable evidence package.

## Phase 5: Simulation And Workflow QA

Goal: Continuously test the product like real users.

Tasks:

- Convert key virtual user scenarios into automated browser tests.
- Add seeded data for repeatable journeys.
- Produce journey reports.
- Add regression checks for tenant switching, module disabling, and offline upload.

Exit criteria:

- Core journeys can be run before release and produce actionable failures.

## Phase 6: Configurable Enterprise Workflows

Goal: Improve saleability without compromising compliance.

Tasks:

- Add configurable field requirements for selected low-risk workflows.
- Add notification rule configuration.
- Add audit logs for config changes.
- Add admin UX for configuration.

Exit criteria:

- Tenants can adapt workflow labels/rules while regulated state remains controlled.

## Phase 7: Onboarding, Templates, And Customer Health

Goal: Reduce implementation friction and make adoption measurable.

Tasks:

- Add tenant implementation checklist.
- Add activation milestones.
- Add vertical starter templates.
- Add import validation reports.
- Add superadmin tenant health signals.

Exit criteria:

- New tenants can reach first value without a full manual implementation process.
- Superadmins can identify and help stuck tenants.

## Phase 8: Federal/Military Readiness Foundation

Goal: Build the foundation needed for SDVOSB federal bids and future FedRAMP/CMMC/DoD authorization work.

Tasks:

- Define the federal authorization boundary and target first path: FedRAMP Low/Moderate, DoD IL2, DoD IL4, or contractor CMMC support.
- Add data classification and AI restriction controls.
- Add SSO/MFA/session policy roadmap and implement the first enterprise identity slice.
- Add security evidence registry and audit log export.
- Add Section 508 checklist and start accessibility remediation on core workflows.
- Create a federal demo tenant and sanitized evidence bundle demo.
- Create initial SSP, boundary diagram, data flow diagram, subprocessor list, and customer responsibility matrix.

Exit criteria:

- The product can be shown credibly to federal buyers without claiming authorization it does not yet have.
- The engineering team has a concrete control/evidence map for FedRAMP, CMMC, Section 508, and DoD cloud conversations.
- AI can be disabled or restricted for sensitive data classes.
- Core security and accessibility artifacts exist in draft form.

## Agent Working Rules

Codex and Claude should use this section as the coordination contract.

### Before Editing

- Read `apps/web/docs/codex-repo-memory.md`.
- Read this spec.
- Read the specific domain doc if one exists, such as AI support, virtual simulation, confined spaces, or tenancy.
- If changing Next.js APIs, read the relevant installed Next docs under `node_modules/next/dist/docs/`.

### Implementation Discipline

- Keep changes small and reviewable.
- Preserve existing tenant and auth patterns.
- Use the cross-module data fabric for new module-to-module relationships, events, evidence, and timelines.
- Put shared logic in `@soteria/core` only when it genuinely crosses boundaries.
- Put pure derivation logic in testable helpers.
- Avoid duplicating storage path, validation, or superadmin auth helpers.
- Do not let AI output perform final safety/compliance actions.

### Testing Expectations

Add tests for:

- Signal threshold and priority logic
- Tenant/permission boundaries
- Offline queue tenant safety
- Regulated status transitions
- Evidence bundle authorization
- AI refusal/escalation behavior

Use targeted tests first. If Vitest or build hangs in the shared monorepo, document the exact command and observed behavior.

### Handoff Format

When an agent completes a slice, update the relevant section with:

- Files changed
- Behavior shipped
- Tests run
- Known gaps
- Next recommended slice

## Open Product Questions

- Which vertical should the first public positioning target: manufacturing, construction, facilities, or industrial maintenance?
- Should command center be user-personalized first or site-manager focused first?
- Which evidence bundle should ship first: incident, confined space permit, hot work permit, or LOTO equipment?
- Which workflows must be fully offline for the first paid deployment?
- Should AI assistant be branded as support, safety copilot, or command center assistant?
- What permission levels should be allowed to view AI usage and source logs?
- Which vertical starter template should ship first?
- What activation milestone defines a successful pilot?
- Which customer-success signals should be visible to customers versus only superadmins?
- Which first federal path matters most: VA commercial SaaS, civilian FedRAMP, DoD IL2/IL4, or defense contractor CMMC support?
- Will federal tenants process CUI, PII, PHI, export-controlled data, or only low-risk operational safety records?
- Which cloud provider and services can support the target authorization boundary?
- Which AI features should be disabled by default for federal tenants?
- Who owns the SSP, POA&M, VPAT/ACR, incident response, and customer responsibility matrix?
- Should `incident_actions` evolve into a shared `safety_actions` table, or should it remain incident-owned with a cross-module adapter first?
- Which relationship types are allowed to be AI-suggested versus human-created only?
- Which records require strong foreign keys instead of flexible `entity_links`?
- Which module detail page should receive the first related-records panel after incidents?

## Suggested First Implementation Slice

Build on the existing command center work:

1. Move command center signal derivation into a pure helper if it is not already easy to test.
2. Add CAPA/open action signal support using existing home metrics or a narrow new query.
3. Add evidence readiness signal for missing LOTO photos and expiring permits.
4. Add tests for severity ordering and empty/error states.
5. Verify dashboard layout in mobile and desktop browser viewports.

This slice is low-risk, high-visibility, and strengthens the product story immediately.

## Reference Basis

This spec intentionally borrows from established EHS and SaaS operating patterns:

- OSHA Recommended Practices for Safety and Health Programs: hazard identification, prevention/control, worker participation, and program evaluation.
- OSHA incident investigation guidance: investigate incidents and close calls to identify root causes and corrective actions, not blame.
- NIOSH hierarchy of controls: prefer elimination, substitution, and engineering controls over administrative controls and PPE.
- ISO 45001-style management systems: leadership, worker participation, risk-based planning, documented information, performance evaluation, and continuous improvement through PDCA.
- Common EHS risk methods: 5 Whys, cause mapping, CAPA verification, barrier management, bowtie thinking, and management of change.
- Enterprise SaaS adoption practice: fast time-to-value, role-based onboarding, guided implementation, customer health signals, imports, templates, and executive reporting.
- FedRAMP Rev5/20x direction: NIST SP 800-53 Rev. 5 controls, authorization boundary discipline, continuous monitoring, reusable authorization packages, and machine-readable evidence trends.
- NIST SP 800-171 and CMMC: protection of FCI/CUI in contractor systems, assessment evidence, SPRS reporting where required, POA&M discipline, and annual affirmations.
- DoD Cloud Computing Security Requirements Guide: cloud impact-level thinking, DoD provisional authorization path, and STIG/SRG-aligned hardening expectations.
- Section 508: accessible federal software procurement expectations and VPAT/ACR readiness.
- SDVOSB federal contracting practice: SBA certification, SAM status, set-aside/sole-source positioning, capability statements, and prime/subcontractor readiness.
- Architecture discovery in this repo: current modules have useful point-to-point links, but need shared relationship, event, action, evidence, and context primitives before cross-module workflows scale.

Useful official references:

- FedRAMP Rev5 documentation: https://www.fedramp.gov/docs/rev5/
- FedRAMP 2026 certification preview: https://www.fedramp.gov/preview/2026/certification/
- NIST SP 800-53 Rev. 5: https://csrc.nist.gov/Pubs/sp/800/53/r5/upd1/Final
- NIST SP 800-171 Rev. 3: https://csrc.nist.gov/pubs/sp/800/171/r3/final
- NIST OSCAL: https://pages.nist.gov/OSCAL/
- DoD CMMC resources: https://dodcio.defense.gov/CMMC/Resources-Documentation/
- DoD CMMC overview: https://dodcio.defense.gov/CMMC/About/
- DFARS CMMC subpart 204.75: https://www.acq.osd.mil/dpap/dars/dfars/html/current/204_75.htm
- FAR 52.204-21 basic safeguarding: https://www.acquisition.gov/far/52.204-21
- DFARS 252.204-7012 safeguarding covered defense information: https://www.acquisition.gov/dfars/252.204-7012-safeguarding-covered-defense-information-and-cyber-incident-reporting.
- DoD Cloud Computing Security: https://public.cyber.mil/dccs/
- Section 508 software guidance: https://www.section508.gov/test/software/
- SBA veteran contracting assistance: https://www.sba.gov/federal-contracting/contracting-assistance-programs/veteran-contracting-assistance-programs
- FAR 52.219-27 SDVOSB clause: https://www.acquisition.gov/far/52.219-27
