import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrikeLearner, StrikeResult } from '@/lib/strike/attempts'
import { buildCertificatePdf } from '@/lib/strike/certificate'
import { loadCertificateRecord } from '@/lib/strike/certificateRecord'
import { sendStrikeCertificate } from '@/lib/email/sendStrikeCertificate'

// Download and email share one path from completion record to PDF, for the
// signed-in player and the no-login "Train now" kiosk alike.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** A learner-typed address, trimmed; null when it can't be an email. */
export function parseCertificateRecipient(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim()
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null
}

export async function renderCertificate(
  admin: SupabaseClient,
  learner: Pick<StrikeLearner, 'tenantId' | 'userId' | 'memberId'>,
  attemptId: string,
): Promise<StrikeResult<{ pdf: Uint8Array; filename: string }>> {
  const record = await loadCertificateRecord(admin, learner, attemptId)
  if (!record.ok) return record
  return { ok: true, value: { pdf: await buildCertificatePdf(record.value.data), filename: record.value.filename } }
}

export async function emailCertificate(
  admin: SupabaseClient,
  learner: Pick<StrikeLearner, 'tenantId' | 'userId' | 'memberId'>,
  attemptId: string,
  to: string,
): Promise<StrikeResult<{ sent: true }>> {
  const record = await loadCertificateRecord(admin, learner, attemptId)
  if (!record.ok) return record
  const { data, filename } = record.value
  const sent = await sendStrikeCertificate({
    to,
    tenantId: learner.tenantId,
    learnerName: data.learnerName,
    moduleTitle: data.moduleTitle,
    organization: data.organization,
    locale: data.locale,
    filename,
    pdf: await buildCertificatePdf(data),
  })
  return sent
    ? { ok: true, value: { sent: true } }
    : { ok: false, status: 502, message: 'We couldn’t send the email. Try again, or download the certificate instead.' }
}
