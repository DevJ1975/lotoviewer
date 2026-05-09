// Per-IP cooldown for the anonymous-report public endpoints.
//
// We never store raw IPs. ip_hash = sha256(ip || daily_salt) where
// daily_salt is derived once per UTC day from a server secret. This
// way a leak of anon_report_ip_attempts does not reveal which IPs
// hit the system, only sets-of-attempts grouped by hashed identity.
//
// Defaults: 5 attempts per 10 minutes from one IP triggers a soft
// throttle. The throttle response is HTTP 429 with a generic message
// — never an indication of WHY (don't help an attacker calibrate).
//
// The recordAttempt() helper is best-effort: if the insert fails we
// log to Sentry and let the request through. Better to over-accept
// during a transient DB hiccup than to drop a real safety report.

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import * as Sentry from '@sentry/nextjs'

const WINDOW_MS = 10 * 60 * 1000
const MAX_ATTEMPTS_PER_WINDOW = 5

type Outcome =
  | 'submit_ok' | 'submit_rate_limit' | 'submit_invalid' | 'submit_error'
  | 'verify_ok' | 'verify_invalid'
  | 'receipt_ok' | 'receipt_invalid'

// Header order matters: Vercel / Cloudflare set x-forwarded-for as
// "client, proxy1, proxy2"; the leftmost is the original client.
// Falls back to x-real-ip and finally cf-connecting-ip.
export function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return req.headers.get('cf-connecting-ip')
       ?? req.headers.get('x-real-ip')
       ?? '0.0.0.0'
}

const DEV_FALLBACK_SALT = 'dev-only-fallback-salt-do-not-use-in-prod'

function dailySalt(): string {
  // Mix the deploy-wide secret with today's UTC date. Rotates at
  // midnight UTC. Configure ANON_IP_SALT in Vercel.
  //
  // Production fail-closed: if ANON_IP_SALT is unset (or accidentally
  // left at the dev fallback) when NODE_ENV=production, the IP hash
  // becomes pre-computable for any given IP and date. An attacker
  // could build a rainbow table per day and evade the per-IP cap.
  // Throwing here trips the route's catch and returns a 500 instead
  // of silently degrading the rate limit.
  const base = process.env.ANON_IP_SALT
  if (!base || base === DEV_FALLBACK_SALT) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('ANON_IP_SALT must be set in production')
    }
    const day = new Date().toISOString().slice(0, 10)
    return `${DEV_FALLBACK_SALT}::${day}`
  }
  const day = new Date().toISOString().slice(0, 10)
  return `${base}::${day}`
}

export function hashIp(ip: string): string {
  return createHash('sha256').update(ip + '::' + dailySalt()).digest('hex')
}

// Returns true if THIS request should be rejected on rate-limit
// grounds. Does NOT count itself — call recordAttempt() afterwards.
export async function isOverIpLimit(ipHash: string): Promise<boolean> {
  const admin = supabaseAdmin()
  const sinceIso = new Date(Date.now() - WINDOW_MS).toISOString()
  const { count, error } = await admin
    .from('anon_report_ip_attempts')
    .select('id', { count: 'exact', head: true })
    .eq('ip_hash', ipHash)
    .gte('attempted_at', sinceIso)
  if (error) {
    Sentry.captureException(error, { tags: { module: 'ipThrottle', stage: 'count' } })
    return false
  }
  return (count ?? 0) >= MAX_ATTEMPTS_PER_WINDOW
}

export async function recordAttempt(
  ipHash: string,
  outcome: Outcome,
  tokenId: string | null = null,
): Promise<void> {
  try {
    const admin = supabaseAdmin()
    await admin.from('anon_report_ip_attempts').insert({
      ip_hash:   ipHash,
      outcome,
      token_id:  tokenId,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'ipThrottle', stage: 'record' } })
  }
}
