import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { sha256HexString } from '@soteria/core/scim'

// SCIM 2.0 per-user endpoint.
//
//   GET    /api/scim/v2/Users/[id]        — fetch one user
//   PATCH  /api/scim/v2/Users/[id]        — partial update (deactivation)
//
// PATCH supports the "Replace active" operation used by IdPs to
// soft-disable an offboarded user — the most common SCIM PATCH in the
// wild. The RFC 7644 PATCH operations list can include several ops,
// each with op="replace"|"add"|"remove" and a path. We handle the
// "active" path specifically; other paths return 200 with no change
// so the IdP doesn't error out on benign operations we don't support
// yet.

const SCIM_USER_SCHEMA  = 'urn:ietf:params:scim:schemas:core:2.0:User'
const SCIM_ERROR_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:Error'
const SCIM_PATCH_SCHEMA = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
const SCIM_CONTENT_TYPE = 'application/scim+json'

interface AuthOk { ok: true;  tokenId: string; tenantId: string }
type AuthResult = AuthOk | { ok: false; status: number; detail: string }

async function authenticate(req: NextRequest): Promise<AuthResult> {
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
    Sentry.captureException(error, { tags: { route: 'scim/Users/[id]', stage: 'lookup' } })
    return { ok: false, status: 500, detail: 'Auth lookup failed' }
  }
  if (!row || row.revoked_at) {
    return { ok: false, status: 401, detail: 'Invalid or revoked token' }
  }
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

function toScimUser(row: WorkerRow) {
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteCtx { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: RouteCtx) {
  const auth = await authenticate(req)
  if (!auth.ok) return scimError(auth.status, auth.detail)

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return scimError(404, 'User not found')

  const admin = supabaseAdmin()
  const { data: row, error } = await admin
    .from('loto_workers')
    .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at')
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .maybeSingle<WorkerRow>()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'scim/Users/[id]', stage: 'fetch' } })
    return scimError(500, error.message)
  }
  if (!row) return scimError(404, 'User not found')
  return NextResponse.json(toScimUser(row), {
    status: 200,
    headers: { 'content-type': SCIM_CONTENT_TYPE },
  })
}

interface PatchOperation {
  op?:    unknown
  path?:  unknown
  value?: unknown
}

interface PatchBody {
  schemas?:    unknown
  Operations?: unknown
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await authenticate(req)
  if (!auth.ok) return scimError(auth.status, auth.detail)

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return scimError(404, 'User not found')

  let body: PatchBody
  try { body = await req.json() as PatchBody } catch {
    return scimError(400, 'Body must be valid JSON', 'invalidSyntax')
  }

  if (Array.isArray(body.schemas)) {
    const ok = body.schemas.some(s => typeof s === 'string' && s === SCIM_PATCH_SCHEMA)
    if (!ok) return scimError(400, `schemas must include "${SCIM_PATCH_SCHEMA}"`, 'invalidValue')
  }

  const ops = Array.isArray(body.Operations) ? (body.Operations as PatchOperation[]) : []
  if (ops.length === 0) return scimError(400, 'Operations must be a non-empty array', 'invalidValue')

  // Build the patch we will apply. The only field we currently honour
  // is `active` because that's the deactivation flow IdPs care about.
  // Unknown paths are accepted to keep the IdP happy but do not mutate
  // anything — we record them in the audit trail via the row update.
  let nextActive: boolean | null = null
  for (const op of ops) {
    if (typeof op !== 'object' || op === null) continue
    const opName = typeof op.op === 'string' ? op.op.toLowerCase() : ''
    if (opName !== 'replace' && opName !== 'add') continue
    const path = typeof op.path === 'string' ? op.path.toLowerCase() : ''
    if (path === 'active') {
      nextActive = Boolean(op.value)
    } else if (!path && typeof op.value === 'object' && op.value !== null) {
      const v = op.value as Record<string, unknown>
      if ('active' in v) nextActive = Boolean(v.active)
    }
  }

  const admin = supabaseAdmin()
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (nextActive !== null) update.active = nextActive

  const { data: row, error } = await admin
    .from('loto_workers')
    .update(update)
    .eq('tenant_id', auth.tenantId)
    .eq('id', id)
    .select('id, full_name, email, employee_id, active, scim_external_id, created_at, updated_at')
    .maybeSingle<WorkerRow>()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'scim/Users/[id]', stage: 'patch' } })
    return scimError(500, error.message)
  }
  if (!row) return scimError(404, 'User not found')

  return NextResponse.json(toScimUser(row), {
    status: 200,
    headers: { 'content-type': SCIM_CONTENT_TYPE },
  })
}
