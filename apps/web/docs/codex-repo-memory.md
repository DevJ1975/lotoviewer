# Codex repo memory

Working orientation for future Codex sessions in this workspace. This is not user-facing product documentation; it is a compact engineering map of what matters when changing the app.

## Product identity

SoteriaField is a multi-tenant EHS SaaS/PWA for production teams. It began as a LOTO placard/photo workflow and has grown into a broader field-safety platform: LOTO, confined spaces, hot work, risk, incidents/OSHA, BBS, chemicals/SDS, toolbox talks, safety boards, chat, manuals, support, notifications, and superadmin tenant operations.

The codebase should be treated as safety/compliance software. Tenant isolation, auditability, status transitions, generated PDFs, signatures, timestamps, and notification flows are not decorative; they are compliance evidence.

## Stack and repo shape

- Monorepo with `apps/web` and `packages/core`.
- Web app uses Next `16.2.4`, React `19.2.4`, Tailwind 4, Supabase, Sentry, Resend, Anthropic, pdf-lib, Vitest.
- `AGENTS.md` warns that this is a changed Next version. Before coding against Next APIs, read the relevant guide under `node_modules/next/dist/docs/`.
- Current scale snapshot from orientation pass: about 126 page files, 191 API route files, 121 SQL migration/seed files, and 147 test files.
- Production gates: `npm --workspace web run build` runs deeplink placeholder, migration-number, and manual-coverage checks before `next build`.

## Core architecture

- Auth is provided by `components/AuthProvider.tsx`. It loads Supabase auth session plus `profiles`, exposes `useAuth()`, and stores a last-login hint for the login screen.
- Active tenant is provided by `components/TenantProvider.tsx`. It loads `tenant_memberships`, chooses the active tenant from `sessionStorage`, allows superadmin to view non-member tenants, and reloads on tenant switch to avoid stale in-flight requests.
- The active tenant key is `soteria.activeTenantId`, exported as `ACTIVE_TENANT_KEY`.
- Browser Supabase client is `apps/web/lib/supabase.ts`, backed by `packages/core/src/supabase.ts`. The shared client injects `x-active-tenant` on every request when the sessionStorage value is a valid UUID.
- RLS and app code both matter. RLS is the hard isolation boundary; app-side tenant filtering keeps behavior understandable and safer if a query is changed later.
- Superadmin access is double-gated in `apps/web/lib/auth/superadmin.ts`: valid bearer token, email in `SUPERADMIN_EMAILS`, and `profiles.is_superadmin = true`.
- Client superadmin API calls should use `apps/web/lib/superadminFetch.ts` / `superadminJson()` rather than hand-rolling bearer-token plumbing.

## Navigation and module flags

- Feature catalog lives in `packages/core/src/features.ts`.
- Tenant module visibility lives in `packages/core/src/moduleVisibility.ts`.
- `components/AppDrawer.tsx` renders top-level modules and children from the feature catalog, filtered through `tenants.modules`.
- `components/ModuleGuard.tsx` protects direct navigation to disabled modules with a friendly screen. It optimistically renders children while tenant state loads because RLS still protects data.
- `components/AppChrome.tsx` owns the app shell: drawer, logo, tenant pill, global search, help, chat, user menu, PWA/update/offline/storage banners, support bot, assistant dock, and footer version.

## Major domains

- LOTO: equipment, photos, energy steps, placards, reviews, print queue, imports, departments, decommissioning, LOTO devices.
- Confined spaces: OSHA 1910.146 inventory, permits, atmospheric tests, status board, PDF permits, training records.
- Hot work: OSHA/NFPA permit workflow and status board.
- Risk: ISO/IIPP risk register, heat map, controls.
- Incidents: unified reporting for injuries, near misses, property damage, spills, investigations, action items, care cases, OSHA 300/300A/301, anonymous QR reporting.
- BBS: QR-driven observations, leaderboard, scorecard.
- Chemicals: product catalog, SDS upload/parse/drift, inventory, locations, labels, approvals, MAQ, Tier II.
- Safety boards and internal chat: threaded collaboration, acknowledgements, attachments, reactions, subscriptions, related discussions.
- Support and AI assistant: KB-grounded support chat with escalation to email ticket; cross-module assistant with AI usage tracking.
- Manuals/RAG: module manuals, policy uploads, knowledge base, embeddings/vector search.

## Shared patterns

- Use `@soteria/core` for shared business logic and types when a pattern crosses web/native or multiple web surfaces.
- Keep validation centralized. Tenant/member validation is in `packages/core/src/validation/tenants.ts` and re-exported from `apps/web/lib/validation/tenants.ts`.
- Storage paths should be helper-driven. LOTO photo uploads use `packages/core/src/photoUpload.ts` and storage path helpers rather than duplicating path strings.
- Offline upload queue is IndexedDB-backed in `apps/web/lib/uploadQueue.ts`; queue items require `tenantId` so queued uploads cannot drain into the wrong tenant.
- Prefer module-specific query helpers in `apps/web/lib/queries/*` when present.
- AI model selection is centralized in `apps/web/lib/ai/models.ts`. Anthropic client construction and error mapping live in `apps/web/lib/ai/client.ts`.

## Notes read and how they map to current code

- `multi-tenant-plan.md`: original phased plan for row-level shared-schema tenancy. Core ideas shipped: tenants, memberships, tenant_id scoping, active tenant context, storage tenant prefixing, onboarding/superadmin, tests.
- `multi-tenancy-saas-plan.md`: product SaaS layer. Shipped concepts include tenant numbers, Snak King #0001, WLS Demo #0002, `is_demo`, `modules`, tenant logo, superadmin, tenant switcher, reset demo.
- `multi-tenancy-audit-plan.md`: cleanup backlog after multi-tenancy. Several Round 1 items are now done: `superadminFetch`, centralized tenant validation, storage path helpers, required queue tenantId, split tenant detail components. Remaining themes: superadmin route tests, provider tests, logo cleanup edge cases, listUsers pagination, disabled-tenant UX, observability consistency.
- `membership-admin-audit.md`: member/admin capabilities and sequencing. Current implementation includes tenant members, invite existing/new users, status, resend, ownership transfer, undo flow, system delete, and audit concerns. Keep last-owner protection and destructive-operation safety in mind.
- `virtual-user-simulation.md`: journey walkthrough for invites, tenant switching, role changes, reset demo, logo upload, module toggles, bug reporting. Important known/past bugs: invite race UX, resend-invite no-email status, orphan logo formats, role/removal notifications missing.
- `ai-support-bot-plan.md`: support assistant architecture. Current code has support conversations/messages/tickets, KB resolver, support widget scoped to `/support`, non-streaming chat route, escalation tool, Resend ticket/user emails, language support, rate limiting, Sentry/AI invocation logging.
- `confined-spaces-plan.md`: OSHA 1910.146 design basis. Current app has the broader confined-space module; preserve the 15 permit fields, atmospheric testing order, thresholds, cancellation/retention logic, and human-review posture for AI suggestions.
- `pending-tasks.md`: production smoke test still open for member-invite email delivery and Resend env readiness.
- `react-patterns-cheatsheet.md`: local teaching/reference style. Many components include explanatory comments for React concepts; keep comments educational only when they clarify real local patterns.

## Current engineering posture

- Treat tenant isolation and active tenant propagation as first-order invariants. Any new query, insert, upload, cron, export, PDF, or AI route must be checked for tenant scope.
- Treat superadmin as powerful but still gated by bearer token, env allowlist, DB flag, and route-level checks.
- Treat AI output as draft/support, not authority. Escalate safety/compliance decisions to humans.
- Treat uploaded/generated artifacts as records: photos, permits, placards, OSHA forms, labels, signatures, QR reports, and PDFs need stable provenance.
- Prefer focused tests around workflow invariants over broad snapshots.

## Known risks and follow-up targets

- Build/test commands may be slow or hang in the local shell; when blocked, report exactly what was attempted.
- `next build` may stop before compilation on deeplink placeholders unless `ALLOW_DEEPLINK_PLACEHOLDERS=1` is set for local verification.
- Support chat is currently non-streaming despite the original plan including SSE in Phase 2.
- SupportBot is intentionally scoped to `/support`; AssistantDock covers broader app questions.
- Feature resolver in `packages/core/src/features.ts` still has an older comment saying multi-tenant resolver is a passthrough, while runtime visibility is actually handled by `tenants.modules` plus `moduleVisibility`.
- Logo storage cleanup, listUsers pagination over 200 users, disabled-tenant mid-session UX, provider/superadmin route tests, and observability tag consistency remain useful hardening targets.
- The app contains legacy/transition surfaces such as legacy near-miss beside unified incidents, and `/admin/users` history from pre-multi-tenancy. Avoid removing these without checking current routes/tests.

## Coding rules for future work

- Read relevant local docs and nearby code before editing.
- For Next-specific work, read the installed Next docs first.
- Use existing helpers before adding new abstractions.
- Keep edits small and tenant-aware.
- Add or update tests for changed behavior, especially permissions, tenant scope, safety/compliance state transitions, offline queues, storage paths, PDFs, and AI escalation.
- Verify with the narrowest meaningful command first; escalate to build/lint/test as needed.
