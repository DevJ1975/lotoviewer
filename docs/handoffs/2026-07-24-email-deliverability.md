# Email deliverability runbook — invite emails landing in junk

**Date:** 2026-07-24
**Scope:** DNS + Resend + Vercel-env changes that pair with the code-side fix
(invite links instead of emailed passwords, `Reply-To`, migrations 247/248).
Everything in this doc is a MANUAL step outside the repo — DNS registrar,
Resend dashboard, Vercel project settings.

## Where things stood (live `dig`, 2026-07-24)

| Record | State | Verdict |
|---|---|---|
| `soteriafield.app` TXT (SPF) | **none** | add |
| `soteriafield.app` MX | **none** — domain cannot receive mail; replies to `invites@` bounce | fix (or rely on Reply-To) |
| `_dmarc.soteriafield.app` | `v=DMARC1; p=none;` — no `rua`, no enforcement | upgrade |
| `resend._domainkey` TXT (DKIM) | present, valid | keep |
| `send.soteriafield.app` TXT | `v=spf1 include:amazonses.com ~all` (Resend MAIL FROM) | keep |
| `send.soteriafield.app` MX | `feedback-smtp.us-east-1.amazonses.com` (bounce handling) | keep |
| `s1._domainkey` / `s2._domainkey` | CNAMEs to `u108217477.wl228.sendgrid.net` — stale SendGrid setup | remove |

The content-level causes (plaintext password in the body, no `Reply-To`)
are fixed in code as of this change; the records below are the remaining
~half of the spam score.

## DNS changes (registrar / DNS host)

1. **DMARC — visibility now, enforcement later.** The `_dmarc` TXT is
   published (done): `v=DMARC1; p=none; rua=mailto:jamil@trainovations.com; fo=1`.

   ⚠ **REPORTS ARE NOT FLOWING YET — one record still required.** The `rua`
   address is on `trainovations.com`, a *different* org domain than the
   record (`soteriafield.app`). Per RFC 7489 §7.1, receivers (Gmail/Yahoo/
   Microsoft) will **silently refuse** to send aggregate reports cross-org
   unless the destination domain authorizes it. `trainovations.com` is on
   **Bluehost** (not Vercel), so add this in the Bluehost DNS panel:

   ```
   Host:  soteriafield.app._report._dmarc          (Bluehost appends .trainovations.com)
   Type:  TXT
   Value: v=DMARC1;
   ```

   Until this exists, the p=none monitoring window collects **zero data**
   and the enforcement ramp below is blocked. After adding it, send a test
   invite and confirm reports from google.com / yahoo.com / outlook.com
   arrive within 24–72h (validate the external auth with dmarcian or
   MXToolbox). `fo=1` is inert without a `ruf=` destination — harmless, can
   be dropped.

   **Enforcement ramp (gated on reports actually flowing):** hold `p=none`
   ≥3–4 weeks to capture a full sending cycle and confirm ~100% of
   legitimate volume shows DMARC=pass aligned; then `p=quarantine; pct=25`
   → `50` → `100` over ~2–3 weeks; then `p=reject` only after quarantine at
   pct=100 runs clean. Realistic total ~6–10 weeks after reports begin.
   Do **not** tighten before then — premature enforcement quarantines
   legitimate mail.

2. **Apex SPF — anti-spoofing.** Nothing sends envelope-from the apex
   (Resend's MAIL FROM is `send.soteriafield.app`), so publish a deny-all:

   ```
   soteriafield.app  TXT  "v=spf1 -all"
   ```

3. **Remove the stale SendGrid DKIM CNAMEs** (`s1._domainkey`,
   `s2._domainkey`). They're leftovers from an old setup; dangling
   provider records are a hijack surface and clutter audits.

4. **Inbound mail for the apex (recommended).** A From-domain with no MX
   is a spam signal, and "reply to this email" only works because of the
   code-side Reply-To. Cloudflare Email Routing (free) or an equivalent
   forwarder fixes both: add its MX records to `soteriafield.app` and
   forward `invites@` + `support@` → `jamil@trainovations.com`.
   ⚠ Do NOT touch `send.soteriafield.app`'s MX — that's Resend's bounce
   handling. And per the 2026-05-05 handoff: no Amazon CAA at the apex.

## Resend dashboard

- Confirm domain `soteriafield.app` still shows **Verified** for SPF +
  DKIM + MX after the changes above.
- **Highest-value remaining improvement (own PR).** Move all ~19 bulk /
  recurring digests + reminders to a dedicated `notify.soteriafield.app`
  (a separate Resend domain with its own DKIM + DMARC), and keep cold
  invites / password / critical alerts on a clean transactional identity
  (`invites@soteriafield.app`). This firewalls the must-deliver
  first-contact invite from the complaint-prone bulk stream that today
  shares one `d=soteriafield.app` reputation bucket. Cheap now while volume
  is thin; a damaged apex reputation later takes invites down with it.
  Needs: verify the subdomain in Resend (dashboard + DNS records), add a
  `BULK_FROM_EMAIL` env, route digests/reminders through it.
- **Reputation + hygiene (from the deliverability audit):**
  - Enroll in Google Postmaster Tools + Microsoft SNDS/JMRP to watch
    complaint rate (target <0.10%, hard cap 0.30%).
  - Bounce/complaint suppression is currently **dead code**
    (`recordSuppression('bounce'|'complaint')` is never invoked; no
    Resend/SES webhook; the reminder cron never calls
    `loadSuppressedEmails()`). Add a Resend webhook route that feeds
    `recordSuppression()`, and skip suppressed addresses before the
    invite-reminder cron.
  - Add RFC 8058 one-click `List-Unsubscribe` to the recurring **reminder**
    (keep it off the first invite) to convert would-be spam complaints
    into harmless opt-outs.
- **Optional / cosmetic (do not expect a spam-score change):** rotate the
  Resend DKIM key from 1024-bit to 2048-bit (all major receivers already
  accept 1024 as pass — security hardening only); soften the "Final
  reminder" subject line.

## Vercel env (production)

| Var | Check |
|---|---|
| `INVITE_FROM_EMAIL` | Set, on the verified domain (e.g. `SoteriaField <invites@soteriafield.app>`). If unset AND `SUPPORT_FROM_EMAIL` is the `onboarding@resend.dev` sandbox, invites are near-guaranteed spam. |
| `SUPPORT_FROM_EMAIL` | Not `onboarding@resend.dev` in production. |
| `INVITE_REPLY_TO_EMAIL` | Optional; defaults to `jamil@trainovations.com` in code. |
| `INVITE_LINK_TTL_DAYS` | Optional; defaults to 14. |
| `NEXT_PUBLIC_APP_URL` | `https://soteriafield.app` (no trailing slash) — invite links embed it. |

## Known limitations / follow-ups (from the pre-ship review)

Surfaced by the adversarial review of the invite change and deliberately
left as follow-ups — none block the ship:

- **Per-user token supersede (multi-tenant invitees).** Tokens are one
  active row per user; inviting the same person to tenant A then tenant B
  supersedes A's emailed link. No access is lost (both memberships are
  created at invite time and accepting either link activates the account),
  but the older email's link is dead — the recipient uses "email me a
  fresh link". A per-(user,tenant) token model would remove the confusion.
- **In-memory rate limiter is per-serverless-instance and keys off the
  (spoofable) leftmost `x-forwarded-for`.** This is the app-wide
  `lib/rateLimit/memory.ts` pattern, not specific to invites; limits are
  advisory. The invite endpoints' real safety comes from the token being
  a 256-bit credential plus the single-use/already-active guards. A shared
  store (Upstash/DB) with a trusted client-IP source would make the limits
  hard. Track as a platform-wide hardening item.
- **Membership hard-delete vs. a live token.** Removing a membership hard-
  deletes the row; validate/accept treat "membership row missing" as
  non-cancelled, so a still-live token could set a password on an account
  whose tenant access was removed. Low impact (the account is the user's
  own and has no tenant access), but worth tightening to require an active
  membership when the token carries a `tenant_id`.

## Verify afterwards

1. `dig +short TXT soteriafield.app`, `dig +short TXT _dmarc.soteriafield.app`,
   `dig +short MX soteriafield.app` — confirm the records above.
2. Send a test invite to a Gmail and an Outlook address; confirm inbox
   placement and that **Show original** reports SPF `pass`, DKIM `pass`,
   DMARC `pass`.
3. mail-tester.com: send an invite to the throwaway address it gives you;
   target ≥ 9/10.
4. Reply to a test invite; confirm it arrives at jamil@trainovations.com.
