# Pending tasks

Quick capture of things to come back to. Newest first.

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
