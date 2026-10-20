import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

// Sent to every tenant owner/admin when someone overrides the permit
// training gate. An override puts untrained people under a permit, so it
// must never be quiet: the email is the human half of the audit trail.
// Same no-throw posture as the other senders — the boolean drives the loop.

export interface PermitTrainingOverrideAlertArgs {
  to: string
  tenantId: string
  tenantName: string | null
  permitLabel: string
  permitUrl: string
  grantedByName: string
  workerNames: string[]
  reason: string
  triggeredBy: string
}

export async function sendPermitTrainingOverrideAlert(args: PermitTrainingOverrideAlertArgs): Promise<boolean> {
  const subject = `Training override on ${args.permitLabel}${args.tenantName ? ` · ${args.tenantName}` : ''}`
  const log = (status: 'sent' | 'failed' | 'skipped', extra: { errorText?: string; providerId?: string | null } = {}) =>
    logEmailSend({ kind: 'permit-training-override', to: args.to, subject, tenantId: args.tenantId, triggeredBy: args.triggeredBy, status, ...extra })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await log('skipped', { errorText: 'RESEND_API_KEY not set' })
    return false
  }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'

  const workers = args.workerNames.join(', ')
  const text = [
    `${args.grantedByName} issued an emergency training override on ${args.permitLabel}.`,
    '',
    `Workers without required training: ${workers}`,
    `Reason given: ${args.reason}`,
    '',
    `Review the permit: ${args.permitUrl}`,
    '',
    'Overrides are recorded in the audit log and cannot be edited or deleted.',
  ].join('\n')
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <p style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#b91c1c">Training gate override</p>
      <p><strong>${escapeHtml(args.grantedByName)}</strong> issued an emergency training override on <strong>${escapeHtml(args.permitLabel)}</strong>.</p>
      <p><strong>Workers without required training:</strong> ${escapeHtml(workers)}</p>
      <p><strong>Reason given:</strong> ${escapeHtml(args.reason)}</p>
      <p><a href="${escapeHtml(args.permitUrl)}" style="background:#1D3ECF;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600">Review the permit</a></p>
      <p style="color:#64748b;font-size:12px">Overrides are recorded in the audit log and cannot be edited or deleted.</p>
    </div>`

  try {
    const { data, error } = await new Resend(apiKey).emails.send({ from, to: args.to, subject, text, html })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendPermitTrainingOverrideAlert' } })
      await log('failed', { errorText: error.message })
      return false
    }
    await log('sent', { providerId: data?.id ?? null })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendPermitTrainingOverrideAlert' } })
    await log('failed', { errorText: err instanceof Error ? err.message : String(err) })
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
