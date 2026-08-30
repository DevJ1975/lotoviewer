# Auth & security sweep — 2026-08-28

Findings from an exhaustive sweep of the authentication surface: 18,530
combinatorial edge cases plus a parallel defect hunt across twelve auth
surfaces, with every finding put through two independent refuters
(reachability and code-accuracy) before being accepted. 57 candidates were
raised; **33 were refuted** and are not listed here. The 24 that survived
both refuters are below.

Ten were fixed on `claude/auth-edge-case-testing-4edwzr`. The rest are
recorded here rather than rushed: five need database migrations, and one
touches ~71 route handlers. Each entry states the trigger and the impact so
it can be picked up without re-deriving the analysis.

Severity is about consequence, not exploit difficulty. "Critical" means
cross-tenant data exposure or account takeover.

---

## Fixed on this branch

| Severity | Location | Defect |
| --- | --- | --- |
| Critical | `lib/inspectorToken.ts`, `api/inspector/{sign,lookup,bundle}` | Token carried no tenant and both consuming queries ran service-role with a date filter only — one customer's inspection returned every customer's permits |
| Critical | `api/anonymous-report/attach/route.ts` | Cleanup filtered the delete list by tenant prefix rather than the report's own prefix, so an unauthenticated caller could delete any object in the tenant's bucket |
| Critical | `api/admin/users`, `api/admin/members/[id]/grant-login` | Raw invite link returned to the caller for a *reused* account — takeover of anyone holding a pending invite elsewhere |
| Critical | `api/admin/members/[id]/reset-access` | Rank compared a tenant-local caller against a global target, so an owner of A could reset an admin of B |
| Critical | `api/admin/review-links/*`, `api/admin/loto/review-queue` | Five private copies of `requireTenantAdmin` never got the revocation hardening; a revoked admin kept full access |
| High | `api/invites/{accept,validate,refresh}` | Three guards discarded their own lookup error and failed open — a leaked token became a password-reset primitive during an outage |
| High | `api/superadmin/.../resend-invite` | Same fail-open on `must_change_password`, the signal authorizing the password rotation |
| High | `lib/email/sendInvite.ts` | `computeLoginUrl` trusted the caller-supplied `Origin` for an emailed invite link |
| Medium | `packages/core/src/inviteReminderPlan.ts` | `NaN` reminder counter fell through to `cancel` — an RLS-level access revocation |
| — | `__tests__/lib/adminCatalog`, `__tests__/regression/sessionFixes` | Two stale assertions predating `MOVED_ADMIN_ROUTES` (#279), failing on `main` |

---

## Open — needs a database migration

### 1. `tenant_memberships` write policy is row-scoped only — CRITICAL
`migrations/049_fix_tenant_memberships_recursion.sql:56`

The policy's `USING` and `WITH CHECK` constrain `tenant_id` and nothing else.
Postgres UPDATE policies are row-scoped, not column-scoped, so an
authenticated admin of tenant T can call PostgREST directly from the browser
(the anon key and their own JWT — the same client the app already uses to read
this table) and run `update({role:'owner'}).eq('tenant_id',T).eq('user_id',
<self>)`, then demote or delete the real owner.

This is the same class migration 249 fixed for `profiles.is_superadmin`; the
equivalent guard was never applied here, and there is no BEFORE UPDATE trigger.

*Fix:* a `BEFORE INSERT OR UPDATE` trigger modelled on
`profiles_guard_privileged_columns()` — for `authenticated`/`anon` JWT roles,
reject any statement where `NEW.role` or `OLD.role` is `owner` unless the
caller is already an owner of that tenant.

### 2. `current_user_owner_tenant_ids()` missing the revocation gate — MEDIUM
`migrations/031_fix_membership_recursion.sql:74`

Migration 190 added `and m.invite_cancelled_at is null` to
`current_user_tenant_ids()` and `current_user_admin_tenant_ids()` so a
soft-cancelled invite stops granting access. The third function of the same
family — the sole predicate of `tenants_owner_update` — never got it. A
soft-cancelled owner can still sign in (only tenant access is revoked, the
account is deliberately retained) and update their tenant row, including
`disabled_at`.

*Fix:* add the same predicate to `current_user_owner_tenant_ids()` and
`current_user_visible_profile_ids()`. Separately, `tenants_owner_update`
should not expose `disabled_at` / `status` / `tenant_number` / `modules` —
those belong to the superadmin PATCH route.

### 3. `bug_reports` / `support_tickets` / `support_conversations` INSERT policies have no tenant predicate — MEDIUM
`migrations/034_bug_reports.sql:55`, `045:80`, `045:121`

These tables were created *after* migration 029's generated-policy loop ran,
so they never received a `*_tenant_scope` policy. Their only INSERT policies
check `auth.uid() is not null` (or `user_id = auth.uid()`), so any
authenticated user can insert rows carrying an arbitrary `tenant_id`.

*Fix:* AND `tenant_id in (select public.current_user_tenant_ids())` onto each
`WITH CHECK`.

### 4. `log_audit()` never populates `audit_log.tenant_id` — MEDIUM
`migrations/003_auth_profiles_audit.sql:98`

`tenant_id` was added nullable by 027 and excluded from the NOT NULL pass
(029) and the default pass (052). The SECURITY DEFINER trigger attached to
~90 tables does not list it in its INSERT columns, so every audit row ever
written has `tenant_id IS NULL` — and `audit_log_tenant_or_superadmin_read`
returns zero rows for every non-superadmin. `/admin/evidence/audit` and
`/api/admin/audit-summary` are both always empty.

*Fix:* derive the tenant from the audited row in `log_audit()` and include it;
backfill where recoverable. NULL stays correct for genuinely cross-tenant
superadmin actions.

### 5. Contractor prequalification portal token never expires — MEDIUM
`api/contractor-prequal/[token]/route.ts:62`, `migrations/163`

`vendor_prequalifications` has no token-expiry column, and no cron flips
status to `expired`. A token from a cycle closed years ago still returns the
contractor's portal for status `invited` / `in_progress` / `approved`.

*Fix:* add `portal_token_expires_at` and `portal_token_revoked_at`, defaulted
by the trigger that mints the token, and enforce both in `lookup()` the way
`lookupLink()` already does for `loto_review_links`.

---

## Open — application code

### 6. No write-tier authorization gate: `viewer` can mutate — HIGH
`lib/auth/tenantGate.ts:142` and ~71 call sites

`requireTenantMember`'s `requireRole: 'member'` is inert *by design* — the
docblock describes it as "any non-superadmin role … used for read endpoints".
The defect is at the call sites: roughly 71 non-GET handlers gate mutations
with that read-tier gate and never consult `gate.role`. A `viewer` can
therefore archive chemical products, edit incident fields, create
hazardous-waste records and submit inspections. RLS is no backstop —
`current_user_tenant_ids()` is role-agnostic, and these handlers write through
the service-role client anyway.

The product does model viewer as read-only elsewhere (`lib/ai/operator`
treats it as a read-only tier), so the REST surface is the outlier.

*Fix:* introduce a genuine write tier that excludes `viewer`, re-point the
mutation handlers at it, and update `authGateMatrix.test.ts`, which currently
asserts the present behaviour. Sizeable but mechanical; worth its own PR.

### 7. `cancel-invite` hard-deletes an account that has a working password — HIGH
`api/superadmin/tenants/[number]/members/[user_id]/route.ts:138`

`/api/invites/accept` sets the password and clears `must_change_password` but
deliberately does not create a session, so `last_sign_in_at` stays null until
the follow-up sign-in lands. Cancel-invite keys `alsoDeleteUser` on
`last_sign_in_at` alone, so a user who accepted and closed the tab is
permanently deleted — account, profile and audit linkage.

*Fix:* use the same two-signal predicate the sibling resend-invite route
documents as authoritative. Better, extract one `hasOwnCredential()` helper
so the two routes cannot drift again.

### 8. `releaseInviteToken` resurrects a superseded token — HIGH
`lib/invites/tokens.ts:160`

`issueInviteToken`'s supersede sweep filters `.is('used_at', null)`, so it
skips a token that is mid-claim. If the claim's password write then fails,
`releaseInviteToken` clears `used_at` with no predicate at all — the token
comes back fully live alongside its replacement, breaking the module's stated
"only the newest link works" invariant for the rest of the 14-day TTL.

*Fix:* drop `.is('used_at', null)` from the supersede filters (stamping
`superseded_at` on a used token is harmless), or make the release conditional
on `superseded_at IS NULL`.

### 9. `grant-login` always fails with `PROFILE_ALREADY_LINKED` — HIGH
`api/admin/members/[memberId]/grant-login/route.ts:112`

`ensureTenantMembership` inserts the membership; the `trg_sync_membership_to_members`
trigger (migration 180) immediately inserts a *separate* members row carrying
`(tenant_id, profile_id)`; the route's next statement then updates the
original row to the same pair and violates `unique (tenant_id, profile_id)`
(migration 131). Every call fails — including the happy path — and leaves an
un-rolled-back auth user and a live membership behind.

*Fix:* link the members row before inserting the membership (the trigger's
`on conflict do nothing` then no-ops), or fold the trigger-created row into
`memberId` on 23505. Either way, add a rollback path.

### 10. Reminder cron: soft-cancel supersedes tokens in every other tenant — HIGH
`api/cron/invite-reminders/route.ts:275`

`supersedeInviteTokens` filters on `user_id` only. Cancelling a stale invite
in tenant A therefore kills a live, admin-issued token in tenant B.
`invite_tokens` already carries `tenant_id` (migration 247).

*Fix:* require a `tenantId` and add `.eq('tenant_id', …)`.

### 11. Reminder cron: cadence anchor keyed by user, not membership — HIGH
`api/cron/invite-reminders/route.ts:220`

`invitedAtByUserId` is keyed by `user_id` alone and populated from an
`invite_tokens` query with no tenant filter. An access reset in tenant A
therefore becomes the cadence anchor for the same person's membership in
tenant B — and because `must_change_password` is global and now true, the
`credential_already_set` guard does not save them. Tenant B's long-standing
active member is driven to `cancel`, which is an RLS-level revocation.

*Fix:* key the map on `user_id|tenant_id`, falling back to the per-user newest
only for legacy `tenant_id IS NULL` rows.

### 12. Reminder cron: counter write-back has no concurrency guard — MEDIUM
`api/cron/invite-reminders/route.ts:349`

The write-back is unconditional, so it can land on top of an admin's
`restartInviteLifecycle` and restore `invite_reminders_sent = 4` over a
freshly restarted invite — which the next weekly run then cancels.

*Fix:* make it a compare-and-set (`.eq('invite_reminders_sent', n - 1)` and
`.is('invite_cancelled_at', null)`), treating zero rows as "the lifecycle
changed under us".

### 13. Anonymous-report IP throttle counts successes — HIGH
`lib/anonReport/ipThrottle.ts:68`

`isOverIpLimit` counts every row for the `ip_hash` with no filter on
`outcome`, and the cap is 5 per 10 minutes. Loading the page records
`verify_ok`; submitting records `submit_ok`; attaching a photo records
another. Two complete reports exhaust the budget for an entire NATed site,
and every subsequent worker gets a 429 on the anonymous hazard-reporting
path — the one channel meant to always be open.

*Fix:* count failure outcomes only, and stop recording `verify_ok` on mount.

### 14. Anonymous-report IP throttle is read-then-write — MEDIUM
`lib/anonReport/ipThrottle.ts:64`

The check does not count the request it is gating and the count-then-insert
pair is not atomic, so a concurrent burst all observes `count = 0`. The
effective cap under concurrency is unbounded.

*Fix:* one atomic Postgres function that inserts and returns the in-window
count.

### 15. Placard QR page hands out the tenant-wide review token — HIGH
`app/qr/[token]/page.tsx:119`, `migrations/216:61-70`

`get_placard_by_qr` returns the tenant's single active public review-link
token to any anonymous scanner. That token is far broader than the one
placard scanned: dropping the `?equipment=` narrowing renders every
non-decommissioned equipment row and every energy step in the tenant, with
write access.

*Fix:* do not return the raw tenant-wide token. Mint a per-equipment,
short-lived token (or an HMAC of `qr_token + equipment_id + exp`) that
`/api/review/[token]` pins to that one equipment row.

### 16. Review token ignores link kind and batch membership — MEDIUM
`api/review/[token]/route.ts:219`

**Re-verified by hand — the original finding overstated this.** Its second
refuter (the code-accuracy lens) died on an API error, so it reached the
confirmed list on a single vote. Two of its three claims hold; one does not.

Real:

- `lookupLink()` selects `id, tenant_id, department, is_public, expires_at,
  revoked_at, first_viewed_at, signed_off_at` — never `kind`, and never
  filters it. Migration 218:135 added `kind in ('placard_walk','audit')`, and
  `/api/admin/loto/audit/[runId]/review-link:52` mints `kind: 'audit'`. So an
  audit token is accepted by the placard-review *write* endpoint, crossing the
  invariant the audit route documents for itself — that deciding a change
  never writes to the live LOTO tables.
- `mark-for-review` and `unmark-for-review` scope only by `tenant_id`. For a
  **non-public** link — one narrowed to a batch via
  `loto_review_link_equipment` — that lets a per-reviewer link flag or clear
  equipment outside its own batch, which the sibling actions (`submit-note`,
  `replace-photo`) do enforce because they route through RPCs that raise
  `equipment not in batch`.

Not a defect:

- A **public** link clearing any flagged row in the tenant. The handler says
  so explicitly and gives the reasoning: "The link is the only auth here;
  tying clear-permissions to a typed-in name would be a paper boundary, not
  real security." Deliberate, and correct for that link type.

Downgraded from HIGH to MEDIUM accordingly: the exposure is bounded by
holding a valid, unexpired, unrevoked link for the tenant already.

*Fix:* reject `kind !== 'placard_walk'` in `lookupLink()`, and require a
`loto_review_link_equipment` row when `is_public` is false — leaving the
public-link behaviour as documented.

### 17. `signOut()` discards its error, leaving the session in localStorage — HIGH
`components/AuthProvider.tsx:131`

auth-js returns early on a non-4xx error *without* calling `_removeSession()`,
so tokens stay in localStorage and no `SIGNED_OUT` event fires. AuthProvider
ignores the returned error, clears React state, and the UI reports the user as
signed out while a usable session remains on the device — the failure mode
that matters most on a shared tablet or after the idle timer fires offline.

*Fix:* capture the error and fall back to a local-only teardown
(`signOut({ scope: 'local' })` plus explicit storage removal), and surface the
failure.

### 18. TenantProvider reads superadmin status before the profile loads — MEDIUM
`components/TenantProvider.tsx:116`

`onAuthStateChange` sets `userId` synchronously and fires `fetchProfile`
without awaiting, and `loading` is never set back to true — so
`isSuperadmin` is false during the window. A genuine superadmin signing in
with a stored tenant they are not a member of gets an alert, a forced
sign-out and a redirect.

*Fix:* gate the effect on the profile being resolved for the current
`userId`; never take an irreversible sign-out decision from a possibly-stale
profile.

### 19. `reset-access` sends an invite link that `accept` always rejects — MEDIUM
`api/admin/members/[memberId]/reset-access/route.ts:138`

The route passes `emailMode: 'invite_link'` unconditionally, but its primary
population has signed in before — so `/api/invites/accept` rejects the emailed
token with `already_active` and the user is told their account is already set
up. The link is dead on arrival for exactly the people it is sent to.

*Fix:* select `emailMode` from a resolved `last_sign_in_at`, and send a
password-rotation email rather than an accept-invite link for accounts that
already have a credential.

---

## Method

The sweep is reproducible: `.claude/skills/programtesting/SKILL.md` documents
it. Two points worth keeping when this is repeated.

**Refute before believing.** 33 of 57 candidates were wrong — misread control
flow, a guard supplied by a caller, or a comment describing an already-fixed
bug read as a live one. Findings that skip adversarial verification are mostly
noise.

**Fail-open is the dominant pattern.** Four separate defects here were the
same shape: a guard that discards the error from its own lookup, so it holds
while the system is healthy and lets go the moment it is not. `grep` for a
destructured `data` with no `error` beside it.

**One verifier died, and it mattered.** 126 of 127 agents completed; the
code-accuracy refuter for finding #16 failed on an API error, so that finding
reached this list on one vote instead of two. Re-verified by hand, it turned
out to be part right and part wrong — it had swept up behaviour the handler
documents as deliberate, which is exactly what that lens exists to catch. Its
severity is now MEDIUM rather than HIGH.

The lesson for the harness: treat a finding whose verification did not
complete as unverified, not as confirmed. `parallel()` resolves a failed agent
to `null`, so a survivor test of "no refuter objected" silently passes a
finding that only one refuter ever saw. Count the votes and require the full
panel before promoting anything.
