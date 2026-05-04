import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

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
      role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
      /** Per-request authenticated supabase client (RLS scoped). */
      authedClient: SupabaseClient }
  | { ok: false; status: number; message: string }

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

  const admin = supabaseAdmin()

  // Superadmin shortcut: DB flag + env allowlist (same posture as
  // /api/admin/review-links).
  const { data: profile } = await admin
    .from('profiles')
    .select('is_superadmin')
    .eq('id', user.id)
    .maybeSingle()
  const allow = (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  const isSuperadmin = !!profile?.is_superadmin && !!user.email && allow.includes(user.email.toLowerCase())

  if (isSuperadmin) {
    return makeOk(user, tenantId, 'superadmin', token, url, anon)
  }

  const { data: membership } = await admin
    .from('tenant_memberships')
    .select('role')
    .eq('user_id',   user.id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (!membership) {
    return { ok: false, status: 403, message: 'Not a member of this tenant' }
  }

  const role = membership.role as 'owner' | 'admin' | 'member' | 'viewer'
  if (opts.requireRole === 'admin' && !['owner', 'admin'].includes(role)) {
    return { ok: false, status: 403, message: 'Tenant admin or owner required' }
  }

  return makeOk(user, tenantId, role, token, url, anon)
}

function makeOk(
  user: { id: string; email?: string },
  tenantId: string,
  role: 'owner' | 'admin' | 'member' | 'viewer' | 'superadmin',
  token: string,
  url: string,
  anon: string,
): TenantGate {
  // Authenticated client carrying the user's JWT — RLS sees the
  // user and the active-tenant header, scopes everything.
  const authedClient = createClient(url, anon, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization:    `Bearer ${token}`,
        'x-active-tenant': tenantId,
      },
    },
  })
  return { ok: true, userId: user.id, userEmail: user.email ?? null, tenantId, role, authedClient }
}

export function requireTenantMember(req: Request) {
  return gate(req, { requireRole: 'member' })
}

export function requireTenantAdmin(req: Request) {
  return gate(req, { requireRole: 'admin' })
}
