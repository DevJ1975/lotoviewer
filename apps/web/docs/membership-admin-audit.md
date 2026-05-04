# Membership Admin — Audit & Improvement Plan

Snapshot of what exists today across `/superadmin/tenants/[number]`,
`/superadmin` (cross-tenant view), `/admin/users`, and the supporting
API routes — followed by concrete improvement ideas grouped by impact
+ effort.

---

## What exists today

### UI surfaces
| Where | Lines | Capabilities |
|---|---|---|
| `MembersSection` (per-tenant) | 345 | Invite, role change, remove from tenant, cancel invite, system-delete, status pill, last-sign-in |
| `AllMembersPanel` (`/superadmin`) | 199 | Cross-tenant table, filter by name/email/tenant, status pill, tenant chips |
| `/admin/users` (legacy single-tenant) | 297 | Invite, list, delete — predates multi-tenancy, still in production |

### API routes
- `GET  /api/superadmin/tenants/[number]/members` — enriched with last_sign_in_at + status
- `POST /api/superadmin/tenants/[number]/members` — invite (new or existing)
- `PATCH /api/superadmin/tenants/[number]/members/[user_id]` — role change
- `DELETE /api/superadmin/tenants/[number]/members/[user_id]` — remove (with `?cancel-invite=true` for cleanup)
- `GET  /api/superadmin/users` — flat cross-tenant list
- `DELETE /api/superadmin/users/[user_id]` — system-wide delete
- `POST /api/admin/users` — legacy single-tenant invite (still runs from `/admin/users`)

### What it does well
- Invite supports both new + existing users with the right email per case
- Status pill clearly distinguishes Invited from Active
- Optimistic UI removal so deletes feel snappy
- Last-owner protection on PATCH + DELETE
- Typed-confirmation on system-wide delete
- Cross-tenant view with badges shows the full picture

---

## What's missing — by category

Each item tagged: **impact** (low/med/high) · **effort** (S/M/L) · **type**.

### A. Visibility (high impact for a solo dev)

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Sort columns** on AllMembersPanel (joined date, last seen, role, name) | M | S | UX |
| **Role filter** chips on AllMembersPanel | M | S | UX |
| **Member detail page** — one click gives you their full picture: tenants, role per tenant, audit trail, permits signed | **H** | M | Feature |
| **Per-member audit feed** — "Jane was invited by Jamil on Apr 14, signed in Apr 16, role changed to admin on Apr 20, removed on Apr 22 by Jamil" | **H** | M | Feature |
| **Activity richer than binary**: "Active 7d", "Dormant 30d+", "Inactive — never opened" | M | S | UX |
| **Last-action timestamp** beside last-sign-in (last permit signed, last photo uploaded) | M | M | Feature |

### B. Invite UX

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Copy temp password** button (one-click, currently select-all) | L | S | UX |
| **Resend invite email** action for Invited rows | M | S | Feature |
| **Bulk CSV invite** — paste a list, role + tenant per row | M | M | Feature |
| **Custom invite message** field per invite | L | S | UX |
| **Invite expiry** + revoke before acceptance | M | M | Feature |
| **SSO / Google sign-in** — most users don't want yet another password | **H** | L | Feature |

### C. Tenant ↔ member ops

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Transfer ownership** macro — "make X the owner, demote current owner to admin" in one click | **H** | S | Feature |
| **Primary contact** designation per tenant (separate from role) | L | S | Feature |
| **Suspend** state — between active and deleted, blocks login but keeps history | M | M | Feature |
| **Move member** between tenants (remove from A + add to B) | L | S | UX (composes existing endpoints) |
| **Invite to multiple tenants** in one form | M | S | UX |

### D. Safety & destructive ops

| Item | Impact | Effort | Type |
|---|---|---|---|
| **30-second undo** on remove / system-delete (toast with Undo button) | **H** | M | Safety |
| **Audit row UI** showing WHO did the destructive action ("Removed by Jamil on Apr 14") | M | S | Compliance |
| **MFA per tenant** — owner can require MFA for everyone in their tenant | M | L | Security |
| **Session revocation** — force a user to re-login (e.g. after role demotion) | L | M | Security |
| **Sys-delete** is currently a tiny "Sys" link — too easy to misclick. Move to a kebab menu | M | S | UX |

### E. Bulk actions

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Multi-select rows** + bulk change role / remove | L | M | Feature |
| **Promote-all-members-to-admin** macro (rare, but devastating to do one-by-one) | L | S | Feature |
| **Export to CSV** (members of a tenant, or all members) | M | S | Feature |

### F. Lifecycle automation

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Notify on role change** — auto-email "You're now an admin of {tenant}" | M | S | Notification |
| **Notify on removal** — auto-email "Your access to {tenant} was removed" | M | S | Notification |
| **Reminder to dormant members** (30+ days no sign-in) — nudge or auto-disable | L | M | Notification |
| **Welcome flow for first-login** specifically when joining via tenant invite (different from a brand-new account) | L | M | UX |

### G. Compliance

| Item | Impact | Effort | Type |
|---|---|---|---|
| **GDPR export** for a single member (their permits, audit rows, photos) | L | L | Compliance |
| **Anonymize-instead-of-delete** option (replace email with hash, keep audit trail) | L | M | Compliance |
| **Reason-for-removal** field on remove (drop-down: left company / no longer needed / security incident) | L | S | Compliance |

### H. Cleanup of legacy surface

| Item | Impact | Effort | Type |
|---|---|---|---|
| **Retire `/admin/users`** — predates multi-tenancy, surfaces flat list ignoring tenants. Either remove or redirect to `/superadmin` | M | S | Cleanup |
| **Consolidate invite paths** — `/admin/users` and `/superadmin/.../members` use slightly different invite flows. Standardize on one | M | M | Cleanup |

---

## Recommended sequencing (for a solo dev)

If I were you, I'd ship in this order — each step compounds value:

### Round 1 — Quick wins (≈ ½ day, all S)
1. **A — Sort columns** on AllMembersPanel
2. **A — Role filter** on AllMembersPanel
3. **B — Copy-password** button
4. **B — Resend invite** action (composes existing POST + delete-old-membership)
5. **C — Transfer ownership** macro
6. **D — Move "Sys" to a kebab menu** so it's harder to misclick
7. **G — Reason-for-removal** dropdown

### Round 2 — Visibility (≈ 1 day)
8. **A — Member detail page** (`/superadmin/users/[user_id]`)
9. **A — Per-member audit feed** (queries `audit_log` filtered to actions about that user_id)
10. **D — Audit row in MembersSection** showing "Removed by X on Y" historically

### Round 3 — Productivity (≈ 1 day)
11. **B — Bulk CSV invite** (reuse the existing POST in a loop with progress)
12. **E — Export to CSV** (download from AllMembersPanel)
13. **D — 30-second undo** for remove + sys-delete (in-memory queue + cancel button)
14. **C — Move member** UX (compose existing endpoints behind one button)

### Round 4 — Lifecycle (≈ 1 day)
15. **F — Notify on role change** (extend `sendInviteEmail` with a "role-update" template)
16. **F — Notify on removal**
17. **C — Suspend state** (new column on `tenant_memberships`, RLS update, UI badge)

### Defer indefinitely
- SSO (worth it once you have 5+ tenants asking)
- MFA per tenant (B2B sales blocker — defer until a customer asks)
- GDPR export / anonymize (defer until you have a customer in EU)
- Multi-select bulk row UI (your current scale doesn't need it)

---

## My top 3 picks if you only have an afternoon

1. **Member detail page + per-member audit feed** (Round 2 #8 + #9). The single biggest "I want to know what's happening" win. You'll go from "who is this person?" requiring SQL queries to one click.
2. **Resend invite + Transfer ownership macros** (Round 1 #4 + #5). Tiny code changes that unblock the most painful repeating operations.
3. **30-second undo** on destructive ops (Round 3 #13). Single click of "Sys" delete is irreversible today; an undo toast removes the foot-cannon entirely.

Those three would change the daily-use feel of the admin without adding complexity that has to be maintained.

Tell me which round to start with (or which 1–3 items if you want to cherry-pick) and I'll plan + ship.
