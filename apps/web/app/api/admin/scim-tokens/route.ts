import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { generateScimToken, sha256HexString } from '@soteria/core/scim'

// POST /api/admin/scim-tokens
//
// Generates a fresh SCIM bearer token, hashes it, and persists the
// hash + the requested name. Returns the plaintext token to the admin
// EXACTLY ONCE in the response — this is the only place in the system
// where the plaintext exists, so the UI must surface it immediately.
//
// Admin-only. Audited via the trigger on scim_tokens.

interface CreateBody {
  name?: unknown
}

export async function POST(req: NextRequest) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: CreateBody
  try { body = await req.json() as CreateBody } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return NextResponse.json({ error: 'Name is required.' }, { status: 400 })
  if (name.length > 120) return NextResponse.json({ error: 'Name must be 120 characters or fewer.' }, { status: 400 })

  try {
    const token = generateScimToken()
    const tokenHash = await sha256HexString(token)
    const admin = supabaseAdmin()
    const { data: row, error } = await admin
      .from('scim_tokens')
      .insert({
        tenant_id:          gate.tenantId,
        name,
        token_hash:         tokenHash,
        created_by_user_id: gate.userId,
      })
      .select('id, name, created_at, last_used_at, revoked_at')
      .single()
    if (error || !row) {
      Sentry.captureException(error, { tags: { route: 'admin/scim-tokens', stage: 'insert' } })
      return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })
    }

    // The plaintext token leaves this response and is gone forever.
    return NextResponse.json({ token, row })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin/scim-tokens' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}

// DELETE /api/admin/scim-tokens?id=...
// Revokes a token by setting revoked_at; the row is preserved for audit.
export async function DELETE(req: NextRequest) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: 'Invalid token id' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: row, error } = await admin
      .from('scim_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'admin/scim-tokens', stage: 'revoke' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!row) return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin/scim-tokens' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
