// The single Resend send path. Every sender funnels through sendEmail() so
// from-address resolution, the Resend client, transient-failure retry,
// optional rate-limit pacing, List-Unsubscribe headers, idempotency, and the
// email_log write are configured ONCE instead of being copy-pasted into each
// of the ~20 send*.ts helpers.
//
// Posture is unchanged from the per-sender code it replaces: fail-soft. We
// never throw — the boolean in the result drives the caller's fan-out loop,
// and every outcome (skip / failed / sent) lands in email_log.

import { Resend } from 'resend'
import type { CreateEmailOptions, ErrorResponse } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { logEmailSend, type EmailKind } from '@/lib/email/instrument'
import { unsubscribeHeaders } from '@/lib/email/unsubscribe'

export type { EmailKind }

export interface SendEmailArgs {
  kind:          EmailKind
  to:            string
  subject:       string
  text:          string
  html?:         string
  /** From-address override. Defaults to the INVITE→SUPPORT→brand ladder;
   *  pass this only when a sender needs a different precedence (e.g. the
   *  superadmin reports, which prefer SUPPORT_FROM_EMAIL). */
  from?:         string
  /** Reply-To, when the email invites a direct reply (e.g. review links). */
  replyTo?:      string
  /** Tenant scope for email_log. NULL for cross-tenant (superadmin) mail. */
  tenantId?:     string | null
  /** Triggering user for email_log. NULL for cron-driven sends. */
  triggeredBy?:  string | null
  /** When set, attaches the RFC 8058 List-Unsubscribe headers. */
  unsubscribeUrl?: string | null
  /** Opt-in idempotency. When set, a unique claim row in email_log makes the
   *  send fire at most once for this key — so a cron re-run or double-fire
   *  can't re-mail the recipient. Omit for transactional mail. */
  dedupeKey?:    string | null
}

export interface SendEmailResult {
  sent:       boolean
  providerId: string | null
}

// ── Configuration knobs (env-overridable; sensible zero-config defaults) ──────

// Max send attempts before giving up on a transient failure.
const MAX_ATTEMPTS = 3

// Backoff base for retries. Real delay in production; 0 in dev/test so suites
// don't sleep. Exponential with jitter on top.
function retryBaseMs(): number {
  const raw = process.env.RESEND_RETRY_BASE_MS
  if (raw != null) return Number(raw) || 0
  return process.env.NODE_ENV === 'production' ? 400 : 0
}

// Proactive inter-send pacing. OFF by default: retry already absorbs the
// occasional 429, and a forced global gap would risk cron-function timeouts on
// large batches that send fine today. Set RESEND_PACE_MS=500 (≈2/s, Resend's
// default tier) only if email_log shows sustained rate-limit drops.
function paceMs(): number {
  return Number(process.env.RESEND_PACE_MS ?? 0) || 0
}

// Resend error codes worth retrying — rate limits and server-side faults.
// Quota-exceeded is intentionally excluded: it won't clear within a retry
// window. Anything else (validation, bad from-address, …) is permanent.
const TRANSIENT_CODES = new Set<ErrorResponse['name']>([
  'rate_limit_exceeded',
  'internal_server_error',
  'application_error',
])

function isTransient(error: ErrorResponse): boolean {
  if (error.statusCode != null && (error.statusCode === 429 || error.statusCode >= 500)) return true
  return TRANSIENT_CODES.has(error.name)
}

function fromAddress(): string {
  return process.env.INVITE_FROM_EMAIL
      ?? process.env.SUPPORT_FROM_EMAIL
      ?? 'SoteriaField <invites@soteriafield.app>'
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// ── Resend client (lazily cached; rebuilt only if the key changes) ───────────

let clientCache: { key: string; client: Resend } | null = null
function resendClient(key: string): Resend {
  if (clientCache?.key === key) return clientCache.client
  clientCache = { key, client: new Resend(key) }
  return clientCache.client
}

// ── Pacing limiter (per-instance; effective for single-cron-loop / fan-out) ──

let nextSlotAt = 0
async function pace(): Promise<void> {
  const gap = paceMs()
  if (gap <= 0) return
  const now = Date.now()
  const wait = Math.max(0, nextSlotAt - now)
  nextSlotAt = Math.max(now, nextSlotAt) + gap
  if (wait > 0) await sleep(wait)
}

// ── Idempotency claim (opt-in via dedupeKey) ─────────────────────────────────

type Claim =
  | { outcome: 'won'; rowId: string } // we own the send; update this row on finish
  | { outcome: 'lost' }               // a prior/concurrent run owns it; skip
  | { outcome: 'untracked' }          // claim couldn't be written; fail-open

// Insert a 'sending' email_log row keyed on dedupe_key. The partial unique
// index on dedupe_key makes this the at-most-once gate: a second insert with
// the same key raises 23505, which we read as "already claimed → skip".
async function claimDedupe(args: SendEmailArgs): Promise<Claim> {
  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('email_log')
      .insert({
        kind:         args.kind,
        to_email:     args.to,
        subject:      args.subject,
        tenant_id:    args.tenantId ?? null,
        triggered_by: args.triggeredBy ?? null,
        dedupe_key:   args.dedupeKey,
        status:       'sending',
      })
      .select('id')
      .single()
    if (error) {
      if (error.code === '23505') return { outcome: 'lost' } // unique_violation
      throw new Error(error.message)
    }
    return data?.id != null ? { outcome: 'won', rowId: String(data.id) } : { outcome: 'untracked' }
  } catch (e) {
    // Fail-open: a DB hiccup must not silence the email. Worst case is a
    // duplicate, which is strictly better than a dropped safety notification.
    Sentry.captureException(e, { tags: { module: 'sendEmail', kind: args.kind, stage: 'dedupe-claim' } })
    return { outcome: 'untracked' }
  }
}

// Record the terminal outcome: update the claimed row in place, or (no claim)
// insert a fresh email_log row exactly as the per-sender code used to.
async function record(
  args:   SendEmailArgs,
  claim:  Claim | null,
  status: 'sent' | 'failed',
  providerId: string | null,
  errorText:  string | null,
): Promise<void> {
  if (claim?.outcome === 'won') {
    try {
      const admin = supabaseAdmin()
      if (status === 'sent') {
        // Keep the claim row as the permanent 'sent' record — its unique
        // dedupe_key is what blocks a re-run from re-sending this email.
        await admin.from('email_log')
          .update({ status, provider_id: providerId, error_text: errorText })
          .eq('id', claim.rowId)
        return
      }
      // Failure: release the key (delete the claim) so a later run CAN retry,
      // then fall through to log a keyless 'failed' row for the audit trail.
      await admin.from('email_log').delete().eq('id', claim.rowId)
    } catch (e) {
      Sentry.captureException(e, { tags: { module: 'sendEmail', kind: args.kind, stage: 'dedupe-finalize' } })
      return
    }
  }
  await logEmailSend({
    kind: args.kind, to: args.to, subject: args.subject,
    tenantId: args.tenantId ?? null, triggeredBy: args.triggeredBy ?? null,
    status, providerId, errorText,
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await logEmailSend({
      kind: args.kind, to: args.to, subject: args.subject,
      tenantId: args.tenantId ?? null, triggeredBy: args.triggeredBy ?? null,
      status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return { sent: false, providerId: null }
  }

  let claim: Claim | null = null
  if (args.dedupeKey) {
    claim = await claimDedupe(args)
    if (claim.outcome === 'lost') return { sent: false, providerId: null }
  }

  const payload: CreateEmailOptions = {
    from:    args.from ?? fromAddress(),
    to:      args.to,
    subject: args.subject,
    text:    args.text,
    ...(args.html ? { html: args.html } : {}),
    ...(args.replyTo ? { replyTo: args.replyTo } : {}),
    ...(args.unsubscribeUrl ? { headers: unsubscribeHeaders(args.unsubscribeUrl) } : {}),
  }
  const client = resendClient(apiKey)

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const isLast = attempt === MAX_ATTEMPTS - 1
    await pace()
    try {
      const { data, error } = await client.emails.send(payload)
      if (!error) {
        const providerId = data?.id ?? null
        await record(args, claim, 'sent', providerId, null)
        return { sent: true, providerId }
      }
      if (!isTransient(error) || isLast) {
        Sentry.captureException(new Error(error.message), {
          tags: { module: 'sendEmail', kind: args.kind, stage: 'resend' },
        })
        await record(args, claim, 'failed', null, error.message)
        return { sent: false, providerId: null }
      }
    } catch (err) {
      if (isLast) {
        Sentry.captureException(err, { tags: { module: 'sendEmail', kind: args.kind, stage: 'resend' } })
        await record(args, claim, 'failed', null, err instanceof Error ? err.message : String(err))
        return { sent: false, providerId: null }
      }
      // A thrown error is a network/transport fault — always transient.
    }
    const backoff = retryBaseMs()
    if (backoff > 0) await sleep(backoff * 2 ** attempt + Math.floor(Math.random() * backoff))
  }

  // Loop always returns on the last attempt; this satisfies the type checker.
  return { sent: false, providerId: null }
}
