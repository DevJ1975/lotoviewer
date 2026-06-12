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

async function gate(req: Request, opts: GateOptions = {}): Promise<TenantGate> {
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

  const admin = supabaseAdmin()

  // Superadmin shortcut (DB flag + env allowlist) and the tenant-membership
  // role check are independent — fire both in parallel so a non-superadmin
  // (the common case) pays one round-trip instead of two. A superadmin pays
  // for a membership query it won't use, but superadmins are rare.
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle(),
    admin.from('tenant_memberships').select('role').eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle(),
  ])
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isSuperadmin = !!profile?.is_superadmin && !!user.email && allow.includes(user.email.toLowerCase())

  if (isSuperadmin) {
    return makeOk(user, tenantId, facilityId, 'superadmin', token, url, anon)
  }

  if (!membership) {
    return { ok: false, status: 403, message: 'Not a member of this tenant' }
  }

  const role = membership.role as 'owner' | 'admin' | 'member' | 'viewer'
  if (opts.requireRole === 'admin' && !['owner', 'admin'].includes(role)) {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }

  return makeOk(user, tenantId, facilityId, role, token, url, anon)
}

function makeOk(
  user: { id: string; email?: string },
  tenantId: string,
  facilityId: string | null,
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin',
  token: string,
  url: string,
  anon: string,
): TenantGate {
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
  const member = await requireTenantMember(req)
  if (!member.ok) return member

  const { data: tenant, error } = await supabaseAdmin()
    .from('tenants')
    .select('name, modules, settings, disabled_at')
    .eq('id', member.tenantId)
    .maybeSingle()

  if (error) return { ok: false, status: 500, message: error.message }
  if (!tenant || tenant.disabled_at) {
    return { ok: false, status: 403, message: 'Module is not enabled for this tenant' }
  }

  const modules = (tenant.modules ?? null) as Record<string, boolean> | null
  if (!isModuleVisible(moduleId, modules)) {
    return { ok: false, status: 403, message: 'Module is not enabled for this tenant' }
  }

  return {
    ...member,
    tenantName:     typeof tenant.name === 'string' ? tenant.name : null,
    tenantModules:  modules,
    tenantSettings: (tenant.settings ?? null) as Record<string, unknown> | null,
  }
}
