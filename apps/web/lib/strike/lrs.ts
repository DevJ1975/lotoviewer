import type { SupabaseClient } from '@supabase/supabase-js'
import { XAPI_VERSION } from '@soteria/core/strikeXapi'
import { publicFetch, publicHostStatus, resolvesPublicly } from '@/lib/security/publicHost'

// The delivery half of LMS sync: POST queued xAPI statements to each
// tenant's LRS. Runs from /api/cron/strike-xapi-sync. Safe to overlap with
// itself: statement ids are deterministic, and an LRS must accept a
// statement it already holds unchanged.

export const MAX_TRIES = 8
const BATCH_SIZE = 50
const SCAN_LIMIT = 1000
const SENT_RETENTION_DAYS = 90
const TIMEOUT_MS = 15_000

export interface LrsCredentials {
  endpoint: string
  auth_username: string
  auth_password: string
}

/** How a request reaches the LRS; publicFetch in production, a stub in tests. */
export type LrsTransport = (url: URL, init: RequestInit) => Promise<Response>

export type LrsResult =
  | { ok: true; status: number }
  | { ok: false; retry: boolean; error: string; status?: number }

/** Minutes double per try, capped at a day: 2, 4, 8 … 1440. */
export function retryDelayMs(tries: number): number {
  return Math.min(24 * 60 * 60_000, 2 ** tries * 60_000)
}

/**
 * The statements resource. LMSs hand out the xAPI base ("…/xapi/"); some
 * admins paste the statements URL itself. Accept both.
 */
export function statementsUrl(endpoint: string): URL {
  const url = new URL(endpoint)
  if (/\/statements\/?$/.test(url.pathname)) return url
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/statements`
  return url
}

/** Boundary check for an admin-entered endpoint. Null when acceptable. */
export async function lrsEndpointProblem(endpoint: string): Promise<string | null> {
  let url: URL
  try { url = new URL(endpoint) }
  catch { return 'Enter the full endpoint URL, starting with https://.' }
  if (url.protocol !== 'https:') return 'The endpoint must use https.'
  if (url.username || url.password) return 'Put the key and secret in their own fields, not in the URL.'
  if (endpoint.length > 500) return 'The endpoint URL is too long.'
  if (!(await resolvesPublicly(url.hostname))) return 'That host does not resolve to a public address.'
  return null
}

async function lrsRequest(
  creds: LrsCredentials,
  url: URL,
  init: { method: 'GET' | 'POST'; body?: string },
  fetchImpl: LrsTransport,
): Promise<LrsResult> {
  // Re-checked on every send: DNS can change after the endpoint was saved.
  // The default transport (publicFetch) enforces this again at connect time;
  // checking here first gives the admin a readable reason.
  const host = await publicHostStatus(url.hostname)
  if (host === 'unresolved') return { ok: false, retry: true, error: `Could not look up ${url.hostname}.` }
  if (host === 'private') return { ok: false, retry: false, error: 'The endpoint host no longer resolves to a public address.' }
  try {
    const res = await fetchImpl(url, {
      method: init.method,
      // A redirect could point anywhere, including inside our network.
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'x-experience-api-version': XAPI_VERSION,
        authorization: `Basic ${Buffer.from(`${creds.auth_username}:${creds.auth_password}`).toString('base64')}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: init.body,
    })
    if (res.ok) return { ok: true, status: res.status }
    const detail = (await res.text().catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200)
    return {
      ok: false,
      retry: res.status >= 500 || res.status === 408 || res.status === 429,
      error: `The LRS answered ${res.status}${detail ? `: ${detail}` : ''}`,
      status: res.status,
    }
  } catch (e) {
    return { ok: false, retry: true, error: e instanceof Error ? e.message : String(e) }
  }
}

export function postStatements(creds: LrsCredentials, statements: unknown[], fetchImpl: LrsTransport = publicFetch): Promise<LrsResult> {
  return lrsRequest(creds, statementsUrl(creds.endpoint), { method: 'POST', body: JSON.stringify(statements) }, fetchImpl)
}

/**
 * Connection test without writing anything: reading one statement needs
 * valid credentials. Many LMSs issue write-only keys, so 403 (authenticated,
 * not allowed to read) still proves the key works.
 */
export async function testLrsConnection(creds: LrsCredentials, fetchImpl: LrsTransport = publicFetch): Promise<{ ok: boolean; message: string }> {
  const url = statementsUrl(creds.endpoint)
  url.searchParams.set('limit', '1')
  const result = await lrsRequest(creds, url, { method: 'GET' }, fetchImpl)
  if (result.ok) return { ok: true, message: 'Connected. The LRS accepted these credentials.' }
  if (result.error.startsWith('The LRS answered 403')) return { ok: true, message: 'Connected. The key is write-only, which is all STRIKE needs.' }
  if (result.error.startsWith('The LRS answered 401')) return { ok: false, message: 'The LRS rejected the key or secret.' }
  return { ok: false, message: result.error }
}

interface DueRow {
  id: string
  tenant_id: string
  statement: unknown
  tries: number
}

export interface FlushSummary {
  tenants: number
  sent: number
  failed: number
}

export async function flushStrikeXapiOutbox(
  admin: SupabaseClient,
  now: Date,
  fetchImpl: LrsTransport = publicFetch,
): Promise<FlushSummary> {
  const nowIso = now.toISOString()
  const { data: endpoints, error: endpointErr } = await admin
    .from('strike_lrs_endpoints')
    .select('tenant_id,endpoint,auth_username,auth_password')
    .eq('enabled', true)
  if (endpointErr) throw new Error(endpointErr.message)

  const summary: FlushSummary = { tenants: 0, sent: 0, failed: 0 }
  for (const endpoint of (endpoints ?? []) as (LrsCredentials & { tenant_id: string })[]) {
    // Scanned per tenant: one shared scan of the oldest due rows let a
    // tenant with a thousand rows that never send (a disabled or deleted
    // endpoint) fill every tick, so no other tenant's statements went out.
    const { data: due, error } = await admin
      .from('strike_xapi_statements')
      .select('id,tenant_id,statement,tries')
      .eq('tenant_id', endpoint.tenant_id)
      .is('sent_at', null)
      .lt('tries', MAX_TRIES)
      .lte('next_try_at', nowIso)
      .order('created_at', { ascending: true })
      .limit(SCAN_LIMIT)
    if (error) throw new Error(error.message)
    const rows = (due ?? []) as DueRow[]
    if (rows.length === 0) continue

    summary.tenants++
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const outcome = await deliver(admin, endpoint, rows.slice(i, i + BATCH_SIZE), now, fetchImpl)
      summary.sent += outcome.sent
      summary.failed += outcome.failed
      // Don't keep hammering an LRS that is down or refusing our key; the rest wait for the next tick.
      if (outcome.stop) break
    }
  }

  const cutoff = new Date(now.getTime() - SENT_RETENTION_DAYS * 86_400_000).toISOString()
  const { error: purgeErr } = await admin.from('strike_xapi_statements').delete().lt('sent_at', cutoff)
  if (purgeErr) throw new Error(purgeErr.message)

  return summary
}

/** The LRS refused the content of the batch, not the connection or the key. */
function rejectsStatements(result: Extract<LrsResult, { ok: false }>): boolean {
  return !result.retry && (result.status === 400 || result.status === 413)
}

/**
 * Sends one batch. When the LRS rejects its content, the batch is halved
 * until the statement it objects to is alone, so one malformed statement
 * fails by itself instead of taking 49 good ones down with it.
 */
async function deliver(
  admin: SupabaseClient,
  endpoint: LrsCredentials & { tenant_id: string },
  batch: DueRow[],
  now: Date,
  fetchImpl: LrsTransport,
): Promise<{ sent: number; failed: number; stop: boolean }> {
  const result = await postStatements(endpoint, batch.map(r => r.statement), fetchImpl)
  if (result.ok) {
    await markSent(admin, endpoint.tenant_id, batch, now.toISOString())
    return { sent: batch.length, failed: 0, stop: false }
  }
  if (rejectsStatements(result) && batch.length > 1) {
    const middle = Math.ceil(batch.length / 2)
    const first = await deliver(admin, endpoint, batch.slice(0, middle), now, fetchImpl)
    if (first.stop) return first
    const second = await deliver(admin, endpoint, batch.slice(middle), now, fetchImpl)
    return { sent: first.sent + second.sent, failed: first.failed + second.failed, stop: second.stop }
  }
  await markFailed(admin, endpoint.tenant_id, batch, result, now)
  return { sent: 0, failed: batch.length, stop: !rejectsStatements(result) }
}

async function markSent(admin: SupabaseClient, tenantId: string, batch: DueRow[], nowIso: string): Promise<void> {
  const { error } = await admin
    .from('strike_xapi_statements')
    .update({ sent_at: nowIso, last_error: null })
    .in('id', batch.map(r => r.id))
  if (error) throw new Error(error.message)
  const { error: endpointErr } = await admin
    .from('strike_lrs_endpoints')
    .update({ last_success_at: nowIso })
    .eq('tenant_id', tenantId)
  if (endpointErr) throw new Error(endpointErr.message)
}

async function markFailed(
  admin: SupabaseClient,
  tenantId: string,
  batch: DueRow[],
  result: Extract<LrsResult, { ok: false }>,
  now: Date,
): Promise<void> {
  // A permanent refusal (bad credentials, a malformed statement) stops
  // retrying until an admin fixes it and presses Retry.
  const byTries = new Map<number, string[]>()
  for (const row of batch) {
    const tries = result.retry ? row.tries + 1 : MAX_TRIES
    byTries.set(tries, [...(byTries.get(tries) ?? []), row.id])
  }
  for (const [tries, ids] of byTries) {
    const { error } = await admin
      .from('strike_xapi_statements')
      .update({ tries, last_error: result.error, next_try_at: new Date(now.getTime() + retryDelayMs(tries)).toISOString() })
      .in('id', ids)
    if (error) throw new Error(error.message)
  }
  const { error: endpointErr } = await admin
    .from('strike_lrs_endpoints')
    .update({ last_error: result.error, last_error_at: now.toISOString() })
    .eq('tenant_id', tenantId)
  if (endpointErr) throw new Error(endpointErr.message)
}
