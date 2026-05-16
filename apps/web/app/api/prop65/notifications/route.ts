import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/prop65/notifications — record an ad-hoc right-to-know
// notification (the loto_training_records trigger handles the
// training-driven case automatically; this endpoint covers email,
// pamphlet, and posted_sign events).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const METHODS = ['posted_sign', 'training', 'email', 'pamphlet'] as const
type Method = (typeof METHODS)[number]

interface PostBody {
  site_id?:              unknown
  worker_id?:            unknown
  notification_method?:  unknown
  training_record_id?:   unknown
  notes?:                unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const siteId  = typeof body.site_id === 'string' ? body.site_id : ''
  const method  = typeof body.notification_method === 'string' ? body.notification_method : ''
  const workerId = typeof body.worker_id === 'string' ? body.worker_id : null
  const trainingId = typeof body.training_record_id === 'string' ? body.training_record_id : null
  const notes = typeof body.notes === 'string' ? body.notes : null

  if (!UUID_RE.test(siteId))
    return NextResponse.json({ error: 'site_id must be a uuid' }, { status: 400 })
  if (!METHODS.includes(method as Method))
    return NextResponse.json({ error: `notification_method must be one of ${METHODS.join(', ')}` }, { status: 400 })
  if (workerId && !UUID_RE.test(workerId))
    return NextResponse.json({ error: 'worker_id must be a uuid' }, { status: 400 })
  if (trainingId && !UUID_RE.test(trainingId))
    return NextResponse.json({ error: 'training_record_id must be a uuid' }, { status: 400 })
  if (method === 'training' && !trainingId)
    return NextResponse.json({ error: 'training_record_id required when notification_method=training' }, { status: 400 })
  if (method !== 'training' && trainingId)
    return NextResponse.json({ error: 'training_record_id only valid with notification_method=training' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: site } = await admin
      .from('prop65_sites')
      .select('id')
      .eq('id', siteId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

    const { data, error } = await admin
      .from('prop65_notifications')
      .insert({
        tenant_id:            gate.tenantId,
        worker_id:            workerId,
        site_id:              siteId,
        notification_method:  method,
        training_record_id:   trainingId,
        notes,
      })
      .select('id, tenant_id, worker_id, site_id, notification_method, notified_at, training_record_id, notes')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ notification: data }, { status: 201 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
