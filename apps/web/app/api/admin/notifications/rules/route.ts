import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { isNotificationSeverity } from '@soteria/core/notificationRouting'

// Notification routing rules: list + create. Admin-only.

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  try {
    const { data, error } = await g.authedClient
      .from('notification_rules')
      .select('id, event_type, min_severity, channel_id, active, created_at')
      .order('created_at', { ascending: true })
    if (error) return sanitizeError(error, 'GET /api/admin/notifications/rules')
    return Response.json({ rules: data ?? [] })
  } catch (e) {
    return sanitizeError(e, 'GET /api/admin/notifications/rules')
  }
}

export async function POST(req: Request) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }) }

  const eventType = typeof body.event_type === 'string' ? body.event_type.trim() : ''
  const channelId = typeof body.channel_id === 'string' ? body.channel_id : ''
  const minSeverity = typeof body.min_severity === 'string' ? body.min_severity : 'info'
  if (!eventType) return Response.json({ error: 'event_type_required' }, { status: 400 })
  if (!channelId) return Response.json({ error: 'channel_id_required' }, { status: 400 })
  if (!isNotificationSeverity(minSeverity)) return Response.json({ error: 'invalid_severity' }, { status: 400 })

  try {
    const { data, error } = await g.authedClient
      .from('notification_rules')
      .insert({ tenant_id: g.tenantId, event_type: eventType, min_severity: minSeverity, channel_id: channelId, created_by: g.userId })
      .select('id, event_type, min_severity, channel_id, active, created_at')
      .single()
    if (error) return sanitizeError(error, 'POST /api/admin/notifications/rules')
    return Response.json({ rule: data }, { status: 201 })
  } catch (e) {
    return sanitizeError(e, 'POST /api/admin/notifications/rules')
  }
}
