import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { STRIKE_OFFLINE_SYNC_MAX_BATCH } from '@soteria/core/strikeOfflineSync'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { authenticateOfflineCaller } from '@/lib/strike/offlineCaller'
import { syncOfflineAttempt, type OfflineSyncResult } from '@/lib/strike/offlineSync'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

// A tablet uploading what it recorded while offline. Each attempt is judged on
// its own and the answer says what the device should do with its copy:
// `synced` (delete it), `rejected` (it can never be accepted; delete it and
// tell the worker), `retry` (keep it and try again later).
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const attempts = body.attempts
  if (!Array.isArray(attempts) || attempts.length === 0 || attempts.length > STRIKE_OFFLINE_SYNC_MAX_BATCH) {
    return NextResponse.json({ error: `Send 1–${STRIKE_OFFLINE_SYNC_MAX_BATCH} attempts per request.` }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const auth = await authenticateOfflineCaller(admin, req)
    if (!auth.ok) return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status })

    // Sized for a crew's whole shift arriving at once, and per device, not per
    // IP: every tablet in a plant shares one address.
    const limit = checkMemoryRateLimit(`strike-offline-sync:${auth.rateKey}`, 60, 60_000)
    if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'retry-after': String(limit.retryAfterSec ?? 60) } })

    const results: OfflineSyncResult[] = []
    for (const raw of attempts) {
      try {
        results.push(await syncOfflineAttempt(admin, auth.caller, raw))
      } catch (e) {
        Sentry.captureException(e, { tags: { route: 'strike/offline/sync' } })
        const id = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).client_attempt_id : null
        results.push({ client_attempt_id: typeof id === 'string' ? id : '', status: 'retry' })
      }
    }
    return NextResponse.json({ results })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/offline/sync' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
