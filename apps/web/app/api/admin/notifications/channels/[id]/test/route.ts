import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import { sendToChannel } from '@/lib/notify/dispatch'

// Send a test message through one channel so an admin can verify config.

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantAdmin(req)
  if (!g.ok) return Response.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return Response.json({ error: 'invalid_id' }, { status: 400 })

  try {
    const { data: channel, error } = await g.authedClient
      .from('notification_channels').select('id, type, config').eq('id', id).maybeSingle()
    if (error) return sanitizeError(error, 'POST /api/admin/notifications/channels/[id]/test')
    if (!channel) return Response.json({ error: 'not_found' }, { status: 404 })

    const result = await sendToChannel(
      { id: channel.id as string, type: channel.type as string, config: channel.config },
      { subject: 'SoteriaField test', body: 'This is a test notification from SoteriaField.' },
    )
    return Response.json({ result })
  } catch (e) {
    return sanitizeError(e, 'POST /api/admin/notifications/channels/[id]/test')
  }
}
