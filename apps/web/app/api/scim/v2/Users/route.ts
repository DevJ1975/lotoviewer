import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseScimUser, sha256HexString } from '@soteria/core/scim'

// SCIM 2.0 (RFC 7644) Users endpoint.
//
//   GET  /api/scim/v2/Users         — list users, paginated per the spec
//   POST /api/scim/v2/Users         — create a new user
//
// Authentication: Authorization: Bearer <opaque token>. The token is
// SHA-256-hashed and compared against scim_tokens.token_hash for the
// matching tenant. Revoked tokens are rejected. last_used_at is
// updated on every successful request so the admin UI can show
// integration freshness.
//
// Persistence target: loto_workers (workforce roster). SCIM-managed
// users get scim_external_id set to the IdP's externalId so re-syncs
// are idempotent.

const SCIM_USER_SCHEMA      = 'urn:ietf:params:scim:schemas:core:2.0:User'
const SCIM_LIST_SCHEMA      = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
const SCIM_ERROR_SCHEMA     = 'urn:ietf:params:scim:api:messages:2.0:Error'
const SCIM_CONTENT_TYPE     = 'application/scim+json'

// ── auth helpers ────────────────────────────────────────────────────

interface TokenAuthOk {
  ok: true
  tokenId:  string
  tenantId: string
}
type TokenAuthResult = TokenAuthOk | { ok: false; status: number; detail: string }

async function authenticate(req: NextRequest): Promise<TokenAuthResult> {
  const header = req.headers.get('authorization') ?? ''
  if (!header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, detail: 'Missing bearer token' }
  }
  const token = header.slice('bearer '.length).trim()
  if (!token) return { ok: false, status: 401, detail: 'Empty bearer token' }

  const tokenHash = await sha256HexString(token)
  const admin = supabaseAdmin()
  const { data: row, error } = await admin
    .from('scim_tokens')
    .select('id, tenant_id, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'scim/Users', stage: 'lookup' } })
    return { ok: false, status: 500, detail: 'Auth lookup failed' }
  }
  if (!row || row.revoked_at) {
    return { ok: false, status: 401, detail: 'Invalid or revoked token' }
  }
  // Fire-and-forget freshness stamp. Failure here doesn't reject the
  // request — the upstream caller already authenticated.
  void admin.from('scim_tokens').update({ last_used_at: new Date().toISOString() }).eq('id', row.id)

  return { ok: true, tokenId: row.id as string, tenantId: row.tenant_id as string }
}

function scimError(status: number, detail: string, scimType?: string) {
  return NextResponse.json(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status:  String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    { status, headers: { 'content-type': SCIM_CONTENT_TYPE } },
  )
}

// ── shapes ──────────────────────────────────────────────────────────

interface WorkerRow {
  id:                string
  full_name:         string
  email:             string | null
  employee_id:       string | null
  active:            boolean
  scim_external_id:  string | null
  created_at:        string
  updated_at:        string
}

interface ScimResponseUser {
  schemas:    string[]
  id:         string
  externalId: string | null
  userName:   string
  name:       { formatted: string }
  emails:     { value: string; primary: boolean }[] | undefined
  active:     boolean
  meta:       {
    resourceType: 'User'
    created:      string
    lastModified: string
  }
}

function toScimUser(row: WorkerRow): ScimResponseUser {
  return {
    schemas:    [SCIM_USER_SCHEMA],
    id:         row.id,
    externalId: row.scim_external_id,
    userName:   row.email ?? row.employee_id ?? row.full_name,
    name:       { formatted: row.full_name },
    emails:     row.email ? [{ value: row.email, primary: true }] : undefined,
    active:     row.active,
    meta: {
      resourceType: 'User',
      created:      row.created_at,
      lastModified: row.updated_at,
    },
  }
}

// ── handlers ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return scimError(auth.status, auth.detail)

  const url = new URL(req.url)
  // SCIM 2.0 pagination uses 1-based `startIndex` and `count`. We
  // translate to 0-based offsets at the SQL boundary.
  const startIndex = Math.max(1, Math.floor(Number(url.searchParams.get('startIndex') ?? '1')) || 1)
  const count      = Math.max(0, Math.min(200, Math.floor(Number(url.searchParams.get('count') ?? '50')) || 50))
  const filter     = url.searchParams.get('filter')

  // Very narrow filter parser: RFC 7644 §3.4.2.2 specifies a small
  // expression grammar. The only filter Okta + Azure send during
  // user-lookup is `userName eq "value"` or `externalId eq "value"`.
  // Anything else returns the unfiltered page — clients tolerate that.
  const filterMatch = filter
    ? filter.match(/^(userName|externalId)\s+eq\s+"([^"]+)"$/i)
    : null

  const admin = supabaseAdmin()
  let query = admin
    .from('loto_workers')
    .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at', { count: 'exact' })
    .eq('tenant_id', auth.tenantId)

  if (filterMatch) {
    const [, field, value] = filterMatch
    if (field.toLowerCase() === 'externalid') {
      query = query.eq('scim_external_id', value)
    } else {
      // userName maps to email first, then employee_id (matches toScimUser).
      query = query.or(`email.eq.${value},employee_id.eq.${value}`)
    }
  }

  const offset = startIndex - 1
  const { data, error, count: totalResults } = await query
    .order('created_at', { ascending: true })
    .range(offset, offset + Math.max(0, count - 1))

  if (error) {
    Sentry.captureException(error, { tags: { route: 'scim/Users', stage: 'list' } })
    return scimError(500, error.message)
  }

  const rows = (data ?? []) as WorkerRow[]
  return NextResponse.json(
    {
      schemas:      [SCIM_LIST_SCHEMA],
      totalResults: totalResults ?? rows.length,
      startIndex,
      itemsPerPage: rows.length,
      Resources:    rows.map(toScimUser),
    },
    { status: 200, headers: { 'content-type': SCIM_CONTENT_TYPE } },
  )
}

export async function POST(req: NextRequest) {
  const auth = await authenticate(req)
  if (!auth.ok) return scimError(auth.status, auth.detail)

  let payload: unknown
  try { payload = await req.json() } catch {
    return scimError(400, 'Body must be valid JSON', 'invalidSyntax')
  }
  const parsed = parseScimUser(payload)
  if (!parsed.ok) {
    return scimError(400, parsed.errors.map(e => `${e.field}: ${e.message}`).join('; '), 'invalidValue')
  }

  const admin = supabaseAdmin()

  // Upsert by (tenant_id, scim_external_id) so re-syncs are idempotent.
  // A pre-existing worker that was created in-app and shares the email
  // gets its scim_external_id linked on the next sync without losing
  // the existing row's training records.
  const { data: existing } = await admin
    .from('loto_workers')
    .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at')
    .eq('tenant_id', auth.tenantId)
    .eq('scim_external_id', parsed.user.externalId)
    .maybeSingle<WorkerRow>()

  if (existing) {
    const { data: updated, error } = await admin
      .from('loto_workers')
      .update({
        full_name: parsed.user.fullName,
        email:     parsed.user.primaryEmail,
        active:    parsed.user.active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
      .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at')
      .single()
    if (error || !updated) {
      Sentry.captureException(error, { tags: { route: 'scim/Users', stage: 'update' } })
      return scimError(500, error?.message ?? 'Update failed')
    }
    return NextResponse.json(toScimUser(updated as WorkerRow), {
      status: 200,
      headers: { 'content-type': SCIM_CONTENT_TYPE },
    })
  }

  const { data: created, error } = await admin
    .from('loto_workers')
    .insert({
      tenant_id:        auth.tenantId,
      full_name:        parsed.user.fullName,
      email:            parsed.user.primaryEmail,
      employee_id:      parsed.user.userName,
      active:           parsed.user.active,
      scim_external_id: parsed.user.externalId,
    })
    .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at')
    .single()
  if (error || !created) {
    if (error?.code === '23505') {
      return scimError(409, 'A user with that externalId or employee id already exists', 'uniqueness')
    }
    Sentry.captureException(error, { tags: { route: 'scim/Users', stage: 'insert' } })
    return scimError(500, error?.message ?? 'Insert failed')
  }
  return NextResponse.json(toScimUser(created as WorkerRow), {
    status: 201,
    headers: {
      'content-type': SCIM_CONTENT_TYPE,
      'location':     new URL(req.url).origin + `/api/scim/v2/Users/${created.id}`,
    },
  })
}
