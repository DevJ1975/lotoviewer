import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

// A learner's completion certificate, as a PDF attachment, to whatever
// address they choose (personal or work). Same no-throw posture as the
// other senders: the caller reports failure, the learner can retry.

export interface StrikeCertificateEmailArgs {
  to: string
  tenantId: string
  learnerName: string
  moduleTitle: string
  organization: string
  locale: 'en' | 'es'
  filename: string
  pdf: Uint8Array
}

const COPY = {
  en: {
    subject: (module: string) => `Your certificate: ${module}`,
    hello: (name: string) => `Hi ${name},`,
    body: (module: string, org: string) => `Your certificate of completion for “${module}”${org ? ` at ${org}` : ''} is attached as a PDF. Keep it for your records.`,
    note: 'Sent from Soteria Field because you asked for a copy of your certificate.',
  },
  es: {
    subject: (module: string) => `Su certificado: ${module}`,
    hello: (name: string) => `Hola ${name}:`,
    body: (module: string, org: string) => `Adjuntamos en PDF su certificado de finalización de “${module}”${org ? ` en ${org}` : ''}. Guárdelo para sus registros.`,
    note: 'Enviado desde Soteria Field porque usted pidió una copia de su certificado.',
  },
} as const

export async function sendStrikeCertificate(args: StrikeCertificateEmailArgs): Promise<boolean> {
  const copy = COPY[args.locale]
  const subject = copy.subject(args.moduleTitle)
  const log = (status: 'sent' | 'failed' | 'skipped', extra: { errorText?: string; providerId?: string | null } = {}) =>
    logEmailSend({ kind: 'strike-certificate', to: args.to, subject, tenantId: args.tenantId, triggeredBy: null, status, ...extra })

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await log('skipped', { errorText: 'RESEND_API_KEY not set' })
    return false
  }
  const from = process.env.INVITE_FROM_EMAIL ?? process.env.SUPPORT_FROM_EMAIL ?? 'SoteriaField <invites@soteriafield.app>'
  const firstName = args.learnerName.split(' ')[0] || args.learnerName
  const text = [copy.hello(firstName), '', copy.body(args.moduleTitle, args.organization), '', copy.note].join('\n')
  const html = `
    <div style="font-family:system-ui,sans-serif;max-width:560px">
      <p style="font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#1D3ECF">STRIKE</p>
      <p>${escapeHtml(copy.hello(firstName))}</p>
      <p>${escapeHtml(copy.body(args.moduleTitle, args.organization))}</p>
      <p style="color:#64748b;font-size:13px">${escapeHtml(copy.note)}</p>
    </div>`

  try {
    const { data, error } = await new Resend(apiKey).emails.send({
      from,
      to: args.to,
      subject,
      text,
      html,
      attachments: [{ filename: args.filename, content: Buffer.from(args.pdf) }],
    })
    if (error) {
      Sentry.captureException(error, { tags: { module: 'sendStrikeCertificate' } })
      await log('failed', { errorText: error.message })
      return false
    }
    await log('sent', { providerId: data?.id ?? null })
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { module: 'sendStrikeCertificate' } })
    await log('failed', { errorText: err instanceof Error ? err.message : String(err) })
    return false
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}
