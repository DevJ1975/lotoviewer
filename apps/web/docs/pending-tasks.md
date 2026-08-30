# Pending tasks

Quick capture of things to come back to. Newest first.

---

## 2026-06-14 — STRIKE quiz submit: make attempt + completion atomic

**Status:** deferred — documenting the contract. The real fix changes the write
path, so it needs a product call rather than a silent drive-by.

**What's wrong:** `app/api/strike/[moduleId]/submit/route.ts` inserts the
`strike_attempts` row, then — on a pass — inserts the `strike_completions` row
as a *separate* statement with no surrounding transaction. If the completion
insert throws (a transient DB error, or a future unique constraint), the route's
catch returns 500 while the **passed attempt is already persisted**. Two
user-visible consequences:

1. When `version.retake_limit` is set, the orphaned passed attempt counts toward
   the limit (it has `submitted_at`), so a retry can burn a retake.
2. The learner sees "Something went wrong" and retries — ending up with two
   passed attempts and one completion, or (if at the retake cap) locked out
   despite having passed.

**Options (need a product call):**
- Move both inserts into a Postgres function / RPC so they commit atomically
  (preferred — keeps `attempt.id` as the completion FK).
- Or make the completion insert best-effort (Sentry on failure, still return
  201) like `recordAccess` in the media route — but then a learner can pass with
  no completion row, which is worse for an evidence-of-training product.

**Why deferred:** no data loss on the happy path, low probability (a same-DB
second insert), and the correct fix alters the write contract. Tracked here so
the audit trail is preserved.

**Related code:**
- `app/api/strike/[moduleId]/submit/route.ts` — attempt insert (~L167), completion insert (~L190)

---

## 2026-05-04 — Verify member-invite email delivery

**Status:** waiting on user to test in the deployed app.

**What to do:**

1. Open https://soteriafield.app, sign in as `jamil@trainovations.com`.
2. Drawer (☰) → **Superadmin** → **Tenants** → click **Snak King (#0001)** (or **WLS Demo (#0002)**).
3. Scroll to **Members** → click **+ Invite member**.
4. Email: `jamiljones@mac.com`. Role: `member`. **Send invite**.
5. Note what the green confirmation panel says:
   - `✉ Invite emailed. The temp password is in the email.` → success, check `jamiljones@mac.com` inbox + spam.
   - `⚠ Email not sent (Resend not configured or send failed). Copy the password below to share manually.` → `RESEND_API_KEY` missing in Vercel env. Fix:
     1. Sign up at https://resend.com if needed.
     2. API key → set `RESEND_API_KEY` in Vercel (Production + Preview).
     3. Optional: set `INVITE_FROM_EMAIL` once a domain is verified in Resend (otherwise the invite ships from `onboarding@resend.dev` which works but lands in spam more often).
     4. Redeploy.
   - `409 already a member` → tenant already includes that email; pick a fresh one to test.

**Why this is open:** the route's been verified by 1077 unit tests but a real Resend send hasn't been smoke-tested in production. If `RESEND_API_KEY` is unset (likely — never confirmed during the multi-tenancy rollout), no member invites will deliver.

**Related code:**
- `lib/email/sendInvite.ts` — Resend integration
- `app/api/superadmin/tenants/[number]/members/route.ts` — invite POST
- `app/superadmin/tenants/[number]/_components/MembersSection.tsx` — UI panel
