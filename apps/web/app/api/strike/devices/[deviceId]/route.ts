import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeAdmin } from '@/lib/strike/gate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ deviceId: string }>
}

/** Revokes a tablet. Its next request is refused, which tells it to wipe what it downloaded. */
export async function DELETE(req: Request, ctx: RouteContext) {
  const gate = await requireStrikeAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { deviceId } = await ctx.params
  if (!UUID_RE.test(deviceId)) return NextResponse.json({ error: 'Invalid device id' }, { status: 400 })

  try {
    const { data, error } = await supabaseAdmin()
      .from('strike_devices')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', deviceId)
      .eq('tenant_id', gate.tenantId)
      .is('revoked_at', null)
      .select('id')
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) return NextResponse.json({ error: 'Device not found.' }, { status: 404 })
    return new NextResponse(null, { status: 204 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/devices', method: 'DELETE' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
