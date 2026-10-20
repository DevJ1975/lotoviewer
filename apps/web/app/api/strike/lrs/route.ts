import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeAdmin } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { lrsEndpointProblem, MAX_TRIES, testLrsConnection } from '@/lib/strike/lrs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

// The tenant's LMS (xAPI LRS) connection, for STRIKE admins.
//
//   GET     config without the secret, plus outbox counts
//   PUT     { endpoint, username, password?, enabled } — password omitted keeps the saved one
//   DELETE  disconnect, dropping statements that were never sent
//   POST    { action: 'test', endpoint?, username?, password? }  connection test, nothing written
//           { action: 'retry' }                                  re-queue statements that gave up
//
// The secret is write-only from the browser's side: no response includes it,
// and a saved secret is only ever sent back to the origin it was saved for
// (see savedSecretFor).

type Gate = Extract<Awaited<ReturnType<typeof requireStrikeAdmin>>, { ok: true }>

export async function GET(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  return handle('GET', async () => NextResponse.json(await loadStatus(gate)))
}

export async function PUT(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
  const username = typeof body.username === 'string' ? body.username.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const enabled = body.enabled !== false
  if (!username || username.length > 300) return NextResponse.json({ error: 'Enter the LRS key (username).' }, { status: 400 })
  if (password.length > 500) return NextResponse.json({ error: 'The secret is too long.' }, { status: 400 })

  return handle('PUT', async () => {
    const problem = await lrsEndpointProblem(endpoint)
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    const admin = supabaseAdmin()
    const secret = password || savedSecretFor(endpoint, await loadCredentials(gate.tenantId))
    if (!secret) return NextResponse.json({ error: 'Enter the LRS secret (password) for this endpoint.' }, { status: 400 })

    const { error } = await admin.from('strike_lrs_endpoints').upsert({
      tenant_id: gate.tenantId,
      endpoint,
      auth_username: username,
      auth_password: secret,
      enabled,
      updated_by: gate.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' })
    if (error) throw new Error(error.message)
    return NextResponse.json(await loadStatus(gate))
  })
}

export async function DELETE(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  return handle('DELETE', async () => {
    const admin = supabaseAdmin()
    const { error } = await admin.from('strike_lrs_endpoints').delete().eq('tenant_id', gate.tenantId)
    if (error) throw new Error(error.message)
    const { error: outboxErr } = await admin.from('strike_xapi_statements').delete().eq('tenant_id', gate.tenantId).is('sent_at', null)
    if (outboxErr) throw new Error(outboxErr.message)
    return NextResponse.json(await loadStatus(gate))
  })
}

export async function POST(req: Request) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const body = await readJson(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  if (body.action === 'retry') {
    return handle('retry', async () => {
      const { error } = await supabaseAdmin()
        .from('strike_xapi_statements')
        .update({ tries: 0, next_try_at: new Date().toISOString() })
        .eq('tenant_id', gate.tenantId)
        .is('sent_at', null)
        .gte('tries', MAX_TRIES)
      if (error) throw new Error(error.message)
      return NextResponse.json(await loadStatus(gate))
    })
  }

  if (body.action !== 'test') return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  // Each test is an outbound request the server makes on the admin's behalf.
  const limit = checkMemoryRateLimit(`strike-lrs-test:${gate.tenantId}`, 10, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many tests. Wait a minute and try again.' }, { status: 429 })

  return handle('test', async () => {
    const saved = await loadCredentials(gate.tenantId)
    const endpoint = typeof body.endpoint === 'string' && body.endpoint.trim() ? body.endpoint.trim() : saved?.endpoint ?? ''
    const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim() : saved?.auth_username ?? ''
    const password = typeof body.password === 'string' && body.password ? body.password : savedSecretFor(endpoint, saved)
    const problem = await lrsEndpointProblem(endpoint)
    if (problem) return NextResponse.json({ ok: false, message: problem })
    if (!username || !password) return NextResponse.json({ ok: false, message: 'Enter the key and secret first.' })
    return NextResponse.json(await testLrsConnection({ endpoint, auth_username: username, auth_password: password }))
  })
}

async function handle(stage: string, run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run()
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/lrs', stage } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  } catch {
    return null
  }
}

/**
 * The saved secret, but only for the origin it was saved with. Reusing it for
 * whatever endpoint the request names would let anyone with admin access
 * read it out by testing against a server of their own.
 */
function savedSecretFor(endpoint: string, saved: { endpoint: string; auth_password: string } | null): string {
  if (!saved) return ''
  try {
    return new URL(endpoint).origin === new URL(saved.endpoint).origin ? saved.auth_password : ''
  } catch {
    return ''
  }
}

async function loadCredentials(tenantId: string) {
  const { data, error } = await supabaseAdmin()
    .from('strike_lrs_endpoints')
    .select('endpoint,auth_username,auth_password')
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as { endpoint: string; auth_username: string; auth_password: string } | null
}

async function loadStatus(gate: Gate) {
  const admin = supabaseAdmin()
  const outbox = () => admin.from('strike_xapi_statements').select('id', { count: 'exact', head: true }).eq('tenant_id', gate.tenantId)
  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const [config, pending, failed, sent] = await Promise.all([
    admin.from('strike_lrs_endpoints')
      .select('endpoint,auth_username,enabled,updated_at,last_success_at,last_error,last_error_at')
      .eq('tenant_id', gate.tenantId)
      .maybeSingle(),
    outbox().is('sent_at', null).lt('tries', MAX_TRIES),
    outbox().is('sent_at', null).gte('tries', MAX_TRIES),
    outbox().gte('sent_at', since),
  ])
  const failure = config.error ?? pending.error ?? failed.error ?? sent.error
  if (failure) throw new Error(failure.message)
  return {
    config: config.data,
    queue: { pending: pending.count ?? 0, failed: failed.count ?? 0, sent_24h: sent.count ?? 0 },
  }
}
