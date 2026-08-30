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
//
// Both reject a membership whose invite has been cancelled, and any
// membership in a disabled tenant, so the gate agrees with the RLS
// functions in migration 190. That matters most for the routes that pass
// the gate and then query with the RLS-bypassing service-role client, where
// this gate is the only access control in the path.

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
  // Both reads are independent, so they go together rather than in series —
  // this is the hot path of every gated route. The membership select carries
  // the lifecycle columns the RLS helpers check (migration 190): a cancelled
  // invite or a disabled tenant revokes access, and most routes reach the
  // database with a key that bypasses those policies, so this gate is the
  // only thing enforcing them.
  const [{ data: profile }, { data: membership, error: membershipErr }] = await Promise.all([
    admin.from('profiles').select('is_superadmin').eq('id', user.id).maybeSingle(),
    admin.from('tenant_memberships')
      .select('role, invite_cancelled_at, tenants:tenant_id(disabled_at)')
      .eq('user_id', user.id).eq('tenant_id', tenantId).maybeSingle(),
  ])
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isSuperadmin = !!profile?.is_superadmin && !!user.email && allow.includes(user.email.toLowerCase())

  if (isSuperadmin) {
    return makeOk(user, tenantId, facilityId, 'superadmin', token, url, anon)
  }

  // A failed lookup is not a non-member. Discarding the error made every DB or
  // PostgREST fault present as a permanent-looking 403; a 500 is honest and
  // retryable.
  if (membershipErr) {
    return { ok: false, status: 500, message: 'Could not verify tenant membership' }
  }
  if (!membership) {
    return { ok: false, status: 403, message: 'Not a member of this tenant' }
  }

  // Mirror the RLS definition, which this gate had drifted from.
  //
  // Migration 190 put `invite_cancelled_at is null` — and migration 190's
  // join puts `t.disabled_at is null` — inside current_user_tenant_ids() and
  // current_user_admin_tenant_ids(), the security-definer functions every
  // domain-table policy consults. This gate checked neither. That is only
  // invisible while a route queries through gate.authedClient, which carries
  // the user's JWT and is subject to those policies; the many routes that
  // pass the gate and then reach for supabaseAdmin() bypass RLS entirely, so
  // for them the gate IS the access control. A revoked member or a member of
  // a disabled tenant still passed it.
  const cancelledAt = (membership as { invite_cancelled_at?: string | null }).invite_cancelled_at ?? null
  if (cancelledAt) {
    return { ok: false, status: 403, message: 'Access to this tenant has been revoked' }
  }

  // PostgREST returns an embedded to-one either as an object or as a
  // single-element array depending on how it infers the relationship, so
  // accept both rather than depending on the inference.
  const embedded = (membership as { tenants?: { disabled_at?: string | null } | Array<{ disabled_at?: string | null }> | null }).tenants
  const tenantRow = Array.isArray(embedded) ? embedded[0] : embedded
  if (tenantRow?.disabled_at) {
    return { ok: false, status: 403, message: 'This tenant is disabled' }
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
