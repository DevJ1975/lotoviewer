import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'

// Notification channels: list + create. Admin-only. Secrets in `config` are
// never returned by the list (write-only from the client's perspective).

export const runtime = 'nodejs'

const TYPES = ['email', 'sms', 'teams', 'slack', 'webhook', 'push'] as const

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const { data, error } = await g.authedClient
      .from('notification_channels')
      .select('id, name, type, active, created_at')
      .order('created_at', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/admin/notifications/channels')
    return Response.json({ channels: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/admin/notifications/channels')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const type = typeof body.type === 'string' ? body.type : ''
  if (!name) return Response.json({ error: 'name_required' }, { status: 400 })
  if (!TYPES.includes(type as (typeof TYPES)[number])) return Response.json({ error: 'invalid_type' }, { status: 400 })
  const config = body.config && typeof body.config === 'object' ? body.config : {}

  try {
    const { data, error } = await g.authedClient
      .from('notification_channels')
      .insert({ tenant_id: g.tenantId, name, type, config, created_by: g.userId })
      .select('id, name, type, active, created_at')
      .single()
    if (error) return sanitizeError(error, 'POST /api/admin/notifications/channels')
    return Response.json({ channel: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/admin/notifications/channels')
  }
}
