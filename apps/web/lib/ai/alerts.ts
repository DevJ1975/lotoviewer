import * as Sentry from '@sentry/nextjs'
import { Resend } from 'resend'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dispatchPushToProfiles } from '@/lib/notifications/pushFanout'

// Multi-channel alert dispatch for the assistant_tasks executor
// (PR3 cron). Three independent channels — push, email, in-app — so
// one failing doesn't sink the others.
//
// Audience resolution (tenant-scoped):
//   'all'         → every tenant_memberships row
//   'admins'      → tenant_memberships where role in ('owner','admin')
//   'department'  → memberships joined to profiles.default_department
//                   (best-effort; tenants without per-department profile
//                   wiring fall back to 'all' for that department)

export type AlertAudience = 'all' | 'admins' | 'department' | 'self'
export type AlertChannel  = 'web-push' | 'email' | 'in-app'

interface AlertArgs {
  tenantId:       string
  /** Who to notify. 'self' is used for schedule_followup with audience=self
   *  and resolves to just the requesting user. */
  audience:       AlertAudience
  /** Required when audience === 'department'. */
  departmentName?: string | null
  message:        string
  channels:       AlertChannel[]
  /** The user who originated the alert (assistant_tasks.user_id).
   *  Used as the 'self' audience target. */
  requesterId:    string
}

export interface AlertResult {
  recipients: number
  channels: {
    'web-push'?:  { sent: number; failed: number }
    'email'?:     { sent: number; failed: number }
    'in-app'?:    { sent: number; failed: number }
  }
  errors: string[]
}

/**
 * Dispatch a multi-channel alert. Each channel succeeds/fails
 * independently — a missing VAPID key takes out push but not email.
 * Returns counts so the cron executor can log them on the
 * assistant_tasks row.
 */
export async function sendAlert(args: AlertArgs): Promise<AlertResult> {
  const result: AlertResult = { recipients: 0, channels: {}, errors: [] }
  const recipients = await resolveAudience(args)
  result.recipients = recipients.profileIds.length
  if (recipients.profileIds.length === 0) {
    result.errors.push('No recipients matched the audience.')
    return result
  }

  const tasks: Array<Promise<void>> = []

  if (args.channels.includes('web-push')) {
    tasks.push((async () => {
      try {
        const r = await dispatchPushToProfiles({
          payload: {
            title:  'Soteria alert',
            body:   args.message.slice(0, 500),
            tag:    'soteria-alert',
            url:    '/',
          },
          profileIds: recipients.profileIds,
          source:     'assistant-alert',
        })
        result.channels['web-push'] = { sent: r.sent, failed: r.failed }
      } catch (err) {
        Sentry.captureException(err, { tags: { source: 'alerts.web-push', tenant_id: args.tenantId } })
        result.errors.push(`web-push: ${err instanceof Error ? err.message : 'failed'}`)
      }
    })())
  }

  if (args.channels.includes('email')) {
    tasks.push((async () => {
      try {
        const r = await sendEmailAlert(recipients.emails, args.message)
        result.channels.email = r
      } catch (err) {
        Sentry.captureException(err, { tags: { source: 'alerts.email', tenant_id: args.tenantId } })
        result.errors.push(`email: ${err instanceof Error ? err.message : 'failed'}`)
      }
    })())
  }

  if (args.channels.includes('in-app')) {
    tasks.push((async () => {
      try {
        const r = await insertNotifications(args.tenantId, recipients.profileIds, args.message)
        result.channels['in-app'] = r
      } catch (err) {
        Sentry.captureException(err, { tags: { source: 'alerts.in-app', tenant_id: args.tenantId } })
        result.errors.push(`in-app: ${err instanceof Error ? err.message : 'failed'}`)
      }
    })())
  }

  await Promise.all(tasks)
  return result
}

interface ResolvedAudience {
  profileIds: string[]
  emails:     string[]
}

async function resolveAudience(args: AlertArgs): Promise<ResolvedAudience> {
  const admin = supabaseAdmin()

  if (args.audience === 'self') {
    const { data } = await admin
      .from('profiles')
      .select('id, email')
      .eq('id', args.requesterId)
      .maybeSingle()
    if (!data) return { profileIds: [], emails: [] }
    const row = data as { id: string; email: string | null }
    return {
      profileIds: [row.id],
      emails:     row.email ? [row.email] : [],
    }
  }

  // Pull memberships for the tenant.
  let q = admin
    .from('tenant_memberships')
    .select('user_id, role')
    .eq('tenant_id', args.tenantId)
  if (args.audience === 'admins') q = q.in('role', ['owner', 'admin'])

  const { data: members } = await q
  const userIds = [...new Set((members ?? []).map(m => (m as { user_id: string }).user_id))]
  if (userIds.length === 0) return { profileIds: [], emails: [] }

  // Fetch profile emails in one query. profiles doesn't yet carry a
  // department column, so audience='department' currently degrades to
  // 'all members of this tenant' — when a future migration adds
  // profiles.department or a dept_memberships table, this is the
  // single point to add the filter.
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', userIds)
  const rows = (profiles ?? []) as Array<{ id: string; email: string | null }>
  return {
    profileIds: rows.map(r => r.id),
    emails:     rows.map(r => r.email).filter((e): e is string => !!e),
  }
}

interface ChannelStats { sent: number; failed: number }

async function sendEmailAlert(emails: string[], message: string): Promise<ChannelStats> {
  if (emails.length === 0) return { sent: 0, failed: 0 }
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    Sentry.captureMessage('RESEND_API_KEY not configured — skipping email alert',
      { level: 'warning', tags: { source: 'alerts.email' } })
    return { sent: 0, failed: emails.length }
  }
  const from = process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <onboarding@resend.dev>'
  const subject = `Soteria alert: ${message.slice(0, 80)}`
  const text = message
  const html = `<p style="font-family: ui-sans-serif; font-size: 14px;">${escapeHtml(message)}</p>`

  const resend = new Resend(apiKey)
  let sent = 0, failed = 0
  // Send individually so a single bad address doesn't fail the batch.
  // For larger audiences a future change can switch to bcc-style send.
  await Promise.all(emails.map(async to => {
    try {
      const r = await resend.emails.send({ from, to, subject, text, html })
      if (r.error) { failed++ } else { sent++ }
    } catch {
      failed++
    }
  }))
  return { sent, failed }
}

async function insertNotifications(
  tenantId:   string,
  profileIds: string[],
  message:    string,
): Promise<ChannelStats> {
  if (profileIds.length === 0) return { sent: 0, failed: 0 }
  const admin = supabaseAdmin()
  const rows = profileIds.map(uid => ({
    tenant_id: tenantId,
    user_id:   uid,
    title:     'Soteria alert',
    body:      message.slice(0, 4000),
  }))
  const { error, count } = await admin.from('notifications').insert(rows, { count: 'exact' })
  if (error) return { sent: 0, failed: profileIds.length }
  return { sent: count ?? profileIds.length, failed: 0 }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
