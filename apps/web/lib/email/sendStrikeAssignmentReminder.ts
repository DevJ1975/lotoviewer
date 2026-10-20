import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

// One email per learner per day at most, listing every STRIKE module that is
// due soon or overdue for them. Same no-throw posture as the other senders.

export interface StrikeReminderItem {
  title: string
  slug: string
  dueAt: string
  kind: 'due_soon' | 'overdue'
  minutes: number
}

export interface StrikeAssignmentReminderArgs {
  to: string
  recipientName: string | null
  tenantId: string
  tenantName: string | null
  appUrl: string
  items: StrikeReminderItem[]
  unsubscribeUrl: string | null
  unsubscribeHeaders?: Record<string, string>
}

export async function sendStrikeAssignmentReminder(args: StrikeAssignmentReminderArgs): Promise<boolean> {
  const overdue = args.items.filter(i => i.kind === 'overdue').length
  const subject = overdue > 0
    ? `${overdue} safety training module${overdue === 1 ? ' is' : 's are'} overdue`
    : `Safety training due soon: ${args.items[0]?.title ?? 'STRIKE'}`
  const log = (status: 'sent' | 'failed' | 'skipped', extra: { errorText?: string; providerId?: string | null } = {}) =>
    logEmailSend({ kind: 'strike-assignment-reminder', to: args.to, subject, tenantId: args.tenantId, triggeredBy: null, status, ...extra })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await log('skipped', { errorText: 'RESEND_API_KEY not set' })
    return false
  }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  const greeting = args.recipientName ? `Hi ${args.recipientName.split(' ')[0]},` : 'Hi,'
  const base = args.appUrl.replace(/\/$/, '')
  const line = (i: StrikeReminderItem) =>
    `${i.title} (${i.minutes} min) — ${i.kind === 'overdue' ? 'overdue since' : 'due'} ${new Date(i.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`

  const text = [
    greeting,
    '',
    'You have short safety training to finish:',
    ...args.items.map(i => `• ${line(i)}: ${base}/strike/${i.slug}`),
    '',
    'Required training must be current before you can be added to some permits.',
    ...(args.unsubscribeUrl ? ['', `Stop these reminders: ${args.unsubscribeUrl}`] : []),
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <p style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#1D3ECF">STRIKE training${args.tenantName ? ` · ${escapeHtml(args.tenantName)}` : ''}</p>
      <p>${escapeHtml(greeting)}</p>
      <p>You have short safety training to finish:</p>
      <ul style="padding-left:18px">
        ${args.items.map(i => `<li style="margin:6px 0"><a href="${escapeHtml(`${base}/strike/${i.slug}`)}" style="color:#1D3ECF;font-weight:600">${escapeHtml(i.title)}</a>
          <span style="color:${i.kind === 'overdue' ? '#b91c1c' : '#64748b'}"> · ${escapeHtml(line(i).split(' — ')[1] ?? '')}</span></li>`).join('')}
      </ul>
      <p style="color:#64748b;font-size:13px">Required training must be current before you can be added to some permits.</p>
      ${args.unsubscribeUrl ? `<p style="color:#94a3b8;font-size:12px"><a href="${escapeHtml(args.unsubscribeUrl)}" style="color:#94a3b8">Stop these reminders</a></p>` : ''}
    </div>`

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to: args.to, subject, text, html, headers: args.unsubscribeHeaders })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendStrikeAssignmentReminder' } })
      await log('failed', { errorText: error.message })
      return false
    }
    await log('sent', { providerId: data?.id ?? null })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendStrikeAssignmentReminder' } })
    await log('failed', { errorText: err instanceof Error ? err.message : String(err) })
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
