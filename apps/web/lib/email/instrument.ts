// Best-effort email_log writer. Each sender calls this once after
// the Resend round-trip (or skip path) so the superadmin dashboard
// can show "did this email actually go out?" without scraping the
// Resend console.
//
// Writes use supabaseAdmin (RLS-bypassing). Logging failure is
// Sentry-reported but never propagates — a logging glitch must
// not block the actual email.

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'

export interface LogEmailArgs {
  /** Logical sender. Examples: 'invite', 'training-expiry', 'risk-review',
   *  'review-link', 'support-ticket'. */
  kind:           string
  to:             string
  subject?:       string
  /** Tenant scope when the email is about tenant data. NULL OK. */
  tenantId?:      string | null
  /** User who triggered the send, if user-action driven. NULL for cron. */
  triggeredBy?:   string | null
  /** Resend message id when status='sent'. */
  providerId?:    string | null
  status:         'sent' | 'failed' | 'skipped'
  /** Failure reason or 'RESEND_API_KEY missing' on skip. */
  errorText?:     string | null
}

export async function logEmailSend(args: LogEmailArgs): Promise<void> {
  try {
    const admin = supabaseAdmin()
    await admin.from('email_log').insert({
      kind:         args.kind,
      to_email:     args.to,
      subject:      args.subject ?? null,
      tenant_id:    args.tenantId ?? null,
      triggered_by: args.triggeredBy ?? null,
      provider_id:  args.providerId ?? null,
      status:       args.status,
      error_text:   args.errorText ?? null,
    })
  } catch (e) {
    Sentry.captureException(e, {
      tags: { source: 'email-instrument', kind: args.kind, status: args.status },
    })
  }
}
