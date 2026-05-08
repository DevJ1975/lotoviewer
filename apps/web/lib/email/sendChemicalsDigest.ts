import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'
import {
  digestSubjectSummary,
  type ChemicalsDigest,
} from '@soteria/core/chemicals'

// Weekly chemicals digest — fired by /api/cron/chemicals-weekly-digest.
//
// One email per (tenant, admin) pair. Mirrors sendTrainingExpiryReminder
// in shape so the operator can rate-limit at the Resend level when both
// crons fire on the same day.
//
// Returns:
//   { sent: true,  providerId: string }  — Resend accepted; providerId is the message id.
//   { sent: false, providerId: null }    — RESEND_API_KEY missing, send rejected, or network threw.

export interface ChemicalsDigestArgs {
  to:           string
  reviewerName: string
  digest:       ChemicalsDigest
  /** Public URL for /chemicals/review (RLS scopes the read). */
  reviewUrl:    string
  /** Public URL for /chemicals/approvals (RLS scopes the read). */
  approvalsUrl: string
  /** Public URL for /chemicals/drift. */
  driftUrl:     string
  /** Public URL for /chemicals/inventory?expiring=true. */
  expiringUrl:  string
}

export async function sendChemicalsDigest(
  args: ChemicalsDigestArgs,
): Promise<{ sent: boolean; providerId: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  const subjectSummary = digestSubjectSummary(args.digest)
  if (!subjectSummary) {
    // Nothing to send — caller should have filtered, but defend in depth.
    return { sent: false, providerId: null }
  }
  const subject = `Chemicals weekly: ${subjectSummary} — ${args.digest.tenant_name}`

  if (!apiKey) {
    console.warn('[chemicals-digest] RESEND_API_KEY not set — skipping send')
    await logEmailSend({
      kind: 'chemicals-digest', to: args.to, subject,
      tenantId: args.digest.tenant_id,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return { sent: false, providerId: null }
  }

  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <onboarding@resend.dev>'

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to:        args.to,
      subject,
      text:      renderText(args),
      html:      renderHtml(args),
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendChemicalsDigest', stage: 'resend' } })
      await logEmailSend({
        kind: 'chemicals-digest', to: args.to, subject,
        tenantId: args.digest.tenant_id,
        status: 'failed', errorText: error.message,
      })
      return { sent: false, providerId: null }
    }
    await logEmailSend({
      kind: 'chemicals-digest', to: args.to, subject,
      tenantId: args.digest.tenant_id,
      status: 'sent', providerId: data?.id ?? null,
    })
    return { sent: true, providerId: data?.id ?? null }
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendChemicalsDigest', stage: 'resend' } })
    await logEmailSend({
      kind: 'chemicals-digest', to: args.to, subject,
      tenantId: args.digest.tenant_id,
      status: 'failed',
      errorText: err instanceof Error ? err.message : String(err),
    })
    return { sent: false, providerId: null }
  }
}

// ── Rendering ──────────────────────────────────────────────────────────

function renderText(a: ChemicalsDigestArgs): string {
  const dispName = a.reviewerName?.trim() || a.to.split('@')[0] || 'there'
  const d = a.digest
  const lines: string[] = [`Hi ${dispName},`, '']
  lines.push(`Weekly chemicals digest for ${d.tenant_name}.`, '')

  if (d.pending_sds.length > 0) {
    lines.push(`PENDING SDS REVIEWS  (${a.reviewUrl})`)
    for (const r of d.pending_sds) {
      lines.push(`  - ${r.product_name}${r.manufacturer ? ` · ${r.manufacturer}` : ''}` +
        (r.revision_date ? `  rev ${r.revision_date}` : '') +
        `  parsed ${r.parsed_at.slice(0, 10)}`)
    }
    lines.push('')
  }

  if (d.pending_approvals.length > 0) {
    lines.push(`AWAITING APPROVAL  (${a.approvalsUrl})`)
    for (const r of d.pending_approvals) {
      lines.push(`  - ${r.product_name}  [${r.barcode}]` +
        (r.requester_name ? `  by ${r.requester_name}` : '') +
        `  ${r.age_days}d old`)
    }
    lines.push('')
  }

  if (d.drift_events.length > 0) {
    lines.push(`DRIFT EVENTS THIS WEEK  (${a.driftUrl})`)
    for (const r of d.drift_events) {
      lines.push(`  - ${r.product_name}  [${r.outcome}]  ${r.checked_at.slice(0, 10)}` +
        (r.notes ? `  ${r.notes.slice(0, 80)}` : ''))
    }
    lines.push('')
  }

  if (d.expiring_soon.length > 0) {
    lines.push(`EXPIRING WITHIN 30 DAYS  (${a.expiringUrl})`)
    for (const r of d.expiring_soon) {
      lines.push(`  - ${r.product_name}  [${r.barcode}]` +
        (r.location_path ? `  @ ${r.location_path}` : '') +
        `  ${r.days_remaining}d left  (${r.expiration_date ?? '—'})`)
    }
    lines.push('')
  }

  lines.push(
    'You can mute this digest from /settings/notifications.',
    '— SoteriaField',
  )
  return lines.join('\n')
}

function renderHtml(a: ChemicalsDigestArgs): string {
  const dispName = a.reviewerName?.trim() || a.to.split('@')[0] || 'there'
  const d = a.digest

  const section = (title: string, url: string, body: string) =>
    body
      ? `<h3 style="margin:24px 0 8px;font-size:14px;color:#0f172a;text-transform:uppercase;letter-spacing:0.05em">
           <a href="${escapeHtml(url)}" style="color:#4f46e5;text-decoration:none">${escapeHtml(title)} →</a>
         </h3>${body}`
      : ''

  const ul = (items: string[]) =>
    items.length === 0
      ? ''
      : `<ul style="margin:0 0 12px 0;padding-left:18px;color:#334155;font-size:13px;line-height:1.6">
          ${items.map(i => `<li>${i}</li>`).join('')}
        </ul>`

  const sdsItems = d.pending_sds.map(r =>
    `<strong>${escapeHtml(r.product_name)}</strong>` +
    (r.manufacturer ? ` <span style="color:#64748b">· ${escapeHtml(r.manufacturer)}</span>` : '') +
    (r.revision_date ? ` <span style="color:#64748b">rev ${escapeHtml(r.revision_date)}</span>` : '') +
    ` <span style="color:#94a3b8">parsed ${escapeHtml(r.parsed_at.slice(0, 10))}</span>`,
  )

  const apprItems = d.pending_approvals.map(r =>
    `<strong>${escapeHtml(r.product_name)}</strong> <code style="font-size:12px;color:#64748b">${escapeHtml(r.barcode)}</code>` +
    (r.requester_name ? ` <span style="color:#64748b">by ${escapeHtml(r.requester_name)}</span>` : '') +
    ` <span style="color:${r.age_days >= 7 ? '#b91c1c' : '#94a3b8'}">${r.age_days}d old</span>`,
  )

  const driftItems = d.drift_events.map(r => {
    const color = r.outcome === 'newer' ? '#4f46e5'
                : r.outcome === 'older' ? '#b45309'
                : '#b91c1c'
    return `<strong>${escapeHtml(r.product_name)}</strong>` +
      ` <span style="color:${color};text-transform:uppercase;font-size:11px;font-weight:600">${escapeHtml(r.outcome)}</span>` +
      ` <span style="color:#94a3b8">${escapeHtml(r.checked_at.slice(0, 10))}</span>` +
      (r.notes ? ` <span style="color:#64748b">— ${escapeHtml(r.notes.slice(0, 80))}</span>` : '')
  })

  const expItems = d.expiring_soon.map(r => {
    const color = r.days_remaining <= 7 ? '#b91c1c'
                : r.days_remaining <= 30 ? '#b45309'
                : '#0f766e'
    return `<strong>${escapeHtml(r.product_name)}</strong> <code style="font-size:12px;color:#64748b">${escapeHtml(r.barcode)}</code>` +
      (r.location_path ? ` <span style="color:#64748b">@ ${escapeHtml(r.location_path)}</span>` : '') +
      ` <span style="color:${color};font-weight:600">${r.days_remaining}d left</span>` +
      (r.expiration_date ? ` <span style="color:#94a3b8">(${escapeHtml(r.expiration_date)})</span>` : '')
  })

  return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;color:#0f172a;background:#f8fafc;padding:24px">
    <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px">
      <h1 style="margin:0 0 4px 0;font-size:18px">Hi ${escapeHtml(dispName)},</h1>
      <p style="margin:0 0 16px 0;color:#475569;font-size:13px">
        Weekly chemicals digest for <strong>${escapeHtml(d.tenant_name)}</strong>.
      </p>
      ${section('Pending SDS reviews',  a.reviewUrl,    ul(sdsItems))}
      ${section('Awaiting approval',    a.approvalsUrl, ul(apprItems))}
      ${section('Drift events this week', a.driftUrl,   ul(driftItems))}
      ${section('Expiring within 30 days', a.expiringUrl, ul(expItems))}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0">
      <p style="margin:0;color:#94a3b8;font-size:11px">
        Mute this digest from <a href="/settings/notifications" style="color:#94a3b8">notification settings</a>. — SoteriaField
      </p>
    </div>
  </body></html>`
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
