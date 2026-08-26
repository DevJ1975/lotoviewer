import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { withCronLogging } from '@/lib/cronInstrumentation'
import { sendInviteReminder } from '@/lib/email/sendInviteReminder'
import { buildInviteUrl, issueInviteToken, supersedeInviteTokens } from '@/lib/invites/tokens'
import {
  planInviteAction,
  INVITE_MAX_REMINDERS,
  type InviteReminderState,
} from '@soteria/core/inviteReminderPlan'

// Daily invite-reminder cron.
//
// Finds tenant memberships whose invite has not been acted on — the
// invitee has not signed in since it was issued — and runs each through
// planInviteAction():
//   - send_reminder → email reminder #N (weekly), advance the counter
//   - cancel        → soft-cancel the invite (stamp invite_cancelled_at;
//                     the row is retained and an admin can reactivate it)
//
// Nothing is ever deleted. The weekly cadence comes from the 7-day gates
// in planInviteAction(); running daily just lets the gate fire promptly.
//
// Auth: Bearer CRON_SECRET (Vercel) OR x-internal-secret
//       INTERNAL_PUSH_SECRET (manual curl) — same posture as sibling crons.

export const runtime = 'nodejs'

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return mismatch === 0
}

function authorize(req: Request): boolean {
  const auth     = req.headers.get('authorization') ?? ''
  const internal = req.headers.get('x-internal-secret') ?? ''
  const bearer   = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  const cronSecret     = process.env.CRON_SECRET ?? ''
  const internalSecret = process.env.INTERNAL_PUSH_SECRET ?? ''
  if (cronSecret     && bearer   && safeEqual(bearer,   cronSecret))     return true
  if (internalSecret && internal && safeEqual(internal, internalSecret)) return true
  if (internalSecret && bearer   && safeEqual(bearer,   internalSecret)) return true
  return false
}

function publicAppUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

export async function GET(req: Request)  {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}
export async function POST(req: Request) {
  if (!authorize(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return withCronLogging(req, () => runCron(req))
}

interface PendingMembership {
  user_id:                  string
  tenant_id:                string
  created_at:               string
  invite_reminders_sent:    number
  invite_last_reminder_at:  string | null
}

async function runCron(req: Request): Promise<NextResponse> {
  const admin = supabaseAdmin()
  const appUrl = publicAppUrl(req)
  const now = new Date()

  try {
    // 1. Un-cancelled memberships + their reminder bookkeeping.
    const { data: rows, error: mErr } = await admin
      .from('tenant_memberships')
      .select('user_id, tenant_id, created_at, invite_reminders_sent, invite_last_reminder_at')
      .is('invite_cancelled_at', null)
    if (mErr) {
      Sentry.captureException(mErr, { tags: { route: '/api/cron/invite-reminders', stage: 'memberships' } })
      return NextResponse.json({ error: mErr.message }, { status: 500 })
    }
    const memberships = (rows ?? []) as PendingMembership[]
    if (memberships.length === 0) {
      return NextResponse.json({ scanned: 0, reminders_sent: 0, invites_cancelled: 0 })
    }

    // 2. Map user_id → last_sign_in_at via the admin auth API (paged).
    //    Bounded at 50 pages (10k users), mirroring the members route.
    const lastSignInByUserId = new Map<string, string | null>()
    const PAGE_SIZE = 200
    const MAX_PAGES = 50
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data: authData, error: aErr } =
        await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE })
      if (aErr) {
        Sentry.captureException(aErr, { tags: { route: '/api/cron/invite-reminders', stage: 'list-users' } })
        return NextResponse.json({ error: aErr.message }, { status: 500 })
      }
      const users = authData?.users ?? []
      for (const u of users) lastSignInByUserId.set(u.id, u.last_sign_in_at ?? null)
      if (users.length < PAGE_SIZE) break
    }

    // 3. Newest invite issuance per user. THIS is what the cadence is
    //    anchored to, not the membership row: an access reset mints a fresh
    //    invite for someone who joined months ago, and the reminders have to
    //    follow the reset's clock rather than the day they first joined.
    //    Memberships predating invite tokens keep the old anchor.
    const invitedAtByUserId = new Map<string, string>()
    const { data: tokenRows, error: tErr } = await admin
      .from('invite_tokens')
      .select('user_id, created_at')
      .in('user_id', memberships.map(m => m.user_id))
      .order('created_at', { ascending: false })
    if (tErr) {
      Sentry.captureException(tErr, { tags: { route: '/api/cron/invite-reminders', stage: 'invite-tokens' } })
      return NextResponse.json({ error: tErr.message }, { status: 500 })
    }
    for (const t of (tokenRows ?? []) as Array<{ user_id: string; created_at: string }>) {
      // Rows arrive newest-first, so the first one seen per user is the one.
      if (!invitedAtByUserId.has(t.user_id)) invitedAtByUserId.set(t.user_id, t.created_at)
    }

    // 4. Decide an action for each membership.
    const toRemind: Array<{ m: PendingMembership; reminderNumber: number }> = []
    const toCancel: PendingMembership[] = []
    for (const m of memberships) {
      const state: InviteReminderState = {
        invitedAt:      invitedAtByUserId.get(m.user_id) ?? m.created_at,
        lastSignInAt:   lastSignInByUserId.get(m.user_id) ?? null,
        remindersSent:  m.invite_reminders_sent ?? 0,
        lastReminderAt: m.invite_last_reminder_at,
        cancelledAt:    null,
      }
      const action = planInviteAction(state, now)
      if (action.kind === 'send_reminder') toRemind.push({ m, reminderNumber: action.reminderNumber })
      else if (action.kind === 'cancel')   toCancel.push(m)
    }

    // 5. Soft-cancel expired invites (no email; the 4th reminder was the
    //    final notice). Retained + reversible.
    let cancelled = 0
    const nowIso = now.toISOString()
    for (const m of toCancel) {
      const { error } = await admin
        .from('tenant_memberships')
        .update({ invite_cancelled_at: nowIso, invite_cancelled_reason: 'no_signup_after_max_reminders' })
        .eq('user_id', m.user_id)
        .eq('tenant_id', m.tenant_id)
        .is('invite_cancelled_at', null)
      if (error) {
        Sentry.captureException(error, { tags: { route: '/api/cron/invite-reminders', stage: 'cancel' } })
        continue
      }

      // Retire any link still outstanding for this person. The 4th reminder
      // mints a fresh 14-day token on day 28 but the cancel lands on day 35,
      // so without this there is a week in which the invitee holds a link
      // that looks live, that we emailed them, and that dies on arrival.
      // Superseding makes the token agree with the membership: they land on
      // the "expired or replaced" screen rather than a link that verifies as
      // 'valid' and is then refused downstream.
      await supersedeInviteTokens(admin, { userId: m.user_id })

      cancelled++
    }

    if (toRemind.length === 0) {
      return NextResponse.json({ scanned: memberships.length, reminders_sent: 0, invites_cancelled: cancelled })
    }

    // 6. Resolve emails + tenant names for the invitees we're reminding.
    const userIds   = Array.from(new Set(toRemind.map(r => r.m.user_id)))
    const tenantIds = Array.from(new Set(toRemind.map(r => r.m.tenant_id)))

    const { data: profiles } = await admin
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds)
    const profileById = new Map<string, { email: string | null; full_name: string | null }>()
    for (const p of profiles ?? []) {
      profileById.set(p.id as string, { email: p.email as string | null, full_name: p.full_name as string | null })
    }

    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name')
      .in('id', tenantIds)
    const tenantNameById = new Map<string, string>()
    for (const t of tenants ?? []) tenantNameById.set(t.id as string, t.name as string)

    // 7. Send reminders. Promise.allSettled so one failure can't sink the
    //    batch; only advance the counter when the email actually went out.
    //    Each reminder mints a fresh invite link (superseding older ones)
    //    so the invitee can always act on the newest email; a mint failure
    //    degrades to a linkless reminder rather than skipping the send.
    //    NEVER rotate passwords here — that would brick in-flight invites
    //    whose temp password an admin shared manually.
    const sendResults = await Promise.allSettled(
      toRemind.map(async ({ m, reminderNumber }) => {
        const prof = profileById.get(m.user_id)
        if (!prof?.email) return { m, reminderNumber, sent: false }

        let inviteUrl: string | undefined
        const issued = await issueInviteToken(admin, {
          userId:    m.user_id,
          tenantId:  m.tenant_id,
          email:     prof.email,
          createdBy: null,
        })
        if (issued.ok) {
          inviteUrl = buildInviteUrl(appUrl, issued.raw)
        } else {
          Sentry.captureException(new Error(issued.error.message), {
            tags: { route: '/api/cron/invite-reminders', stage: 'invite-token' },
          })
        }

        const res = await sendInviteReminder({
          to:             prof.email,
          fullName:       prof.full_name ?? '',
          loginUrl:       appUrl,
          inviteUrl,
          tenantName:     tenantNameById.get(m.tenant_id),
          reminderNumber,
          maxReminders:   INVITE_MAX_REMINDERS,
          tenantId:       m.tenant_id,
        })
        return { m, reminderNumber, sent: res.sent }
      }),
    )

    let remindersSent = 0
    for (const r of sendResults) {
      if (r.status !== 'fulfilled' || !r.value.sent) continue
      const { m, reminderNumber } = r.value
      const { error } = await admin
        .from('tenant_memberships')
        .update({ invite_reminders_sent: reminderNumber, invite_last_reminder_at: nowIso })
        .eq('user_id', m.user_id)
        .eq('tenant_id', m.tenant_id)
      if (error) {
        Sentry.captureException(error, { tags: { route: '/api/cron/invite-reminders', stage: 'advance-counter' } })
        continue
      }
      remindersSent++
    }

    return NextResponse.json({
      scanned:           memberships.length,
      reminders_sent:    remindersSent,
      invites_cancelled: cancelled,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/cron/invite-reminders' } })
    return NextResponse.json({ error: 'Cron failed' }, { status: 500 })
  }
}
