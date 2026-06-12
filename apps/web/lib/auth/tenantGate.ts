import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// Shared tenant auth gate for the /api/risk/* family. Same pattern
// as the inline helpers in /api/admin/review-links — JWT identifies
// the user, x-active-tenant header identifies the tenant, then a
// tenant_memberships role check decides what they can do.
//
// Two granularities:
//   - requireTenantMember: any non-superadmin role (member, viewer,
//     admin, owner) on the active tenant. Superadmins always pass.
//     Used for read endpoints.
//   - requireTenantAdmin: only owner / admin roles on the active
//     tenant. Used for mutation endpoints.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type TenantGate =
  | { ok: true;  userId: string; userEmail: string | null; tenantId: string;
      /**
       * Active facility from the x-active-facility header, or null for the
       * roll-up view (all facilities in the tenant). Routes that CREATE
       * facility-scoped records should reject a null facilityId; read routes
       * may allow it.
       */
      facilityId: string | null
      role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
      /** Per-request authenticated supabase client (RLS scoped). */
      authedClient: SupabaseClient }
  | { ok: false; status: number; message: string }

export type TenantModuleGate =
  | (Extract<TenantGate, { ok: true }> & {
      tenantName:     string | null
      tenantModules:  Record<string, boolean> | null
      tenantSettings: Record<string, unknown> | null
    })
  | Extract<TenantGate, { ok: false }>

interface GateOptions {
  requireRole?: 'member' | 'admin'
}

// One-row context returned by the get_gate_context RPC: the caller's
// superadmin flag, their role on the active tenant (null when not a member),
// and the tenant's module context (null when the tenant row is absent).
interface GateContextRow {
  is_superadmin:      boolean
  role:               'owner' | 'admin' | 'member' | 'viewer' | null
  tenant_exists:      boolean
  tenant_name:        string | null
  tenant_modules:     Record<string, boolean> | null
  tenant_settings:    Record<string, unknown> | null
  tenant_disabled_at: string | null
}

// Resolved request identity plus the one-shot gate context. Shared by the
// member/admin gates and the module gate so the auth decision lives in one
// place and every gate makes a single get_gate_context round-trip.
type GateCore =
  | { ok: false; status: number; message: string }
  | {
      ok: true
      user: { id: string; email?: string }
      tenantId: string
      facilityId: string | null
      role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
      token: string
      url: string
      anon: string
      ctx: GateContextRow | undefined
    }

async function gateCore(req: Request, opts: GateOptions = {}): Promise<GateCore> {
  const authHeader = req.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing bearer token' }
  }
  const token = authHeader.slice('Bearer '.length)

  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) {
    return { ok: false, status: 500, message: 'Supabase env not configured' }
  }

  // Anon-keyed client just for token-to-user resolution.
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const tenantId = req.headers.get('x-active-tenant')?.trim() ?? ''
  if (!UUID_RE.test(tenantId)) {
    return { ok: false, status: 400, message: 'Missing or malformed x-active-tenant header' }
  }

  // Optional: a missing/blank header means the roll-up view. A present but
  // malformed value is treated as null rather than rejected, so a bad header
  // never blocks a read — same posture as the client-side reader.
  const rawFacility = req.headers.get('x-active-facility')?.trim() ?? ''
  const facilityId  = UUID_RE.test(rawFacility) ? rawFacility : null

  // One round-trip for the superadmin flag (profiles), this user's role on
  // the tenant (tenant_memberships) and the tenant's module context
  // (tenants). The module context is only consumed by module gates, but it
  // is a single-row PK join — cheap — and it spares those gates a second
  // sequential round-trip.
  const { data: ctxRows, error: ctxErr } = await supabaseAdmin().rpc('get_gate_context', {
    p_user:   user.id,
    p_tenant: tenantId,
  })
  if (ctxErr) return { ok: false, status: 500, message: ctxErr.message }
  const ctx = ((ctxRows ?? []) as GateContextRow[])[0]

  // Superadmin requires BOTH the DB flag and the env allowlist; the allowlist
  // half stays here because it depends on SUPERADMIN_EMAILS and the
  // auth-server email, not the database.
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isSuperadmin = !!ctx?.is_superadmin && !!user.email && allow.includes(user.email.toLowerCase())

  let role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
  if (isSuperadmin) {
    role = 'superadmin'
  } else {
    if (!ctx?.role) {
      return { ok: false, status: 403, message: 'Not a member of this tenant' }
    }
    role = ctx.role
    if (opts.requireRole === 'admin' && !['owner', 'admin'].includes(role)) {
      return { ok: false, status: 403, message: 'Tenant admin or owner required' }
    }
  }

  return { ok: true, user, tenantId, facilityId, role, token, url, anon, ctx }
}

async function gate(req: Request, opts: GateOptions = {}): Promise<TenantGate> {
  const core = await gateCore(req, opts)
  if (!core.ok) return core
  return makeOk(core.user, core.tenantId, core.facilityId, core.role, core.token, core.url, core.anon)
}

function makeOk(
  user: { id: string; email?: string },
  tenantId: string,
  facilityId: string | null,
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin',
  token: string,
  url: string,
  anon: string,
): Extract<TenantGate, { ok: true }> {
  // Authenticated client carrying the user's JWT — RLS sees the
  // user, the active-tenant header, and (when set) the active-facility
  // header, scoping everything. Forwarding x-active-facility also lets the
  // facility_id column DEFAULT (migration 210) auto-stamp inserts done
  // through this client.
  const headers: Record<string, string> = {
    Authorization:     `Bearer ${token}`,
    'x-active-tenant': tenantId,
  }
  if (facilityId) headers['x-active-facility'] = facilityId

  const authedClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers },
  })
  return { ok: true, userId: user.id, userEmail: user.email ?? null, tenantId, facilityId, role, authedClient }
}

export function requireTenantMember(req: Request) {
  return gate(req, { requireRole: 'member' })
}

export function requireTenantAdmin(req: Request) {
  return gate(req, { requireRole: 'admin' })
}

export async function requireTenantModuleMember(req: Request, moduleId: string): Promise<TenantModuleGate> {
  const core = await gateCore(req, { requireRole: 'member' })
  if (!core.ok) return core

  // gateCore already fetched the tenant's module context in the same
  // round-trip. A missing or disabled tenant, or a module the tenant hasn't
  // enabled, all read as "module not enabled".
  const ctx = core.ctx
  if (!ctx?.tenant_exists || ctx.tenant_disabled_at) {
    return { ok: false, status: 403, message: 'Module is not enabled for this tenant' }
  }
  const modules = ctx.tenant_modules ?? null
  if (!isModuleVisible(moduleId, modules)) {
    return { ok: false, status: 403, message: 'Module is not enabled for this tenant' }
  }

  const base = makeOk(core.user, core.tenantId, core.facilityId, core.role, core.token, core.url, core.anon)
  return {
    ...base,
    tenantName:     ctx.tenant_name,
    tenantModules:  modules,
    tenantSettings: ctx.tenant_settings ?? null,
  }
}
