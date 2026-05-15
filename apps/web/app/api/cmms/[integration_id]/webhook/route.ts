import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseInboundEvent, verifyHmacSignature } from '@soteria/core/cmmsSync'

// POST /api/cmms/[integration_id]/webhook
//
// HMAC-verified inbound CMMS webhook. The CMMS computes HMAC-SHA256
// over the raw body using the integration's webhook_secret and sends
// it in X-Soteria-Signature: sha256=<hex>. We recompute and compare
// constant-time before doing anything with the body — request bodies
// are otherwise opaque and writing to the DB before auth would be a
// CSRF-shaped vulnerability.
//
// Effects on success:
//   1. cmms_sync_events row inserted with direction=inbound, status=delivered.
//   2. cmms_work_order_links row upserted on (cmms_system, work_order_id).
//   3. opened/closed transitions flip opened_at / closed_at.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteCtx { params: Promise<{ integration_id: string }> }

export async function POST(req: NextRequest, ctx: RouteCtx) {
  const { integration_id } = await ctx.params
  if (!UUID_RE.test(integration_id)) {
    return NextResponse.json({ error: 'Invalid integration id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const { data: integration, error: lookupErr } = await admin
    .from('cmms_integrations')
    .select('id, tenant_id, system, webhook_secret, enabled')
    .eq('id', integration_id)
    .maybeSingle()
  if (lookupErr) {
    Sentry.captureException(lookupErr, { tags: { route: 'cmms/webhook', stage: 'lookup' } })
    return NextResponse.json({ error: lookupErr.message }, { status: 500 })
  }
  if (!integration || !integration.enabled) {
    // Same response for missing + disabled — don't leak which one to a
    // probe with the wrong integration id.
    return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
  }

  // Read the raw body BEFORE parsing JSON so the HMAC matches what
  // the sender computed over the bytes.
  const rawBody = await req.text()
  const signature = req.headers.get('x-soteria-signature')
  const verified = await verifyHmacSignature(integration.webhook_secret, rawBody, signature)
  if (!verified) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: unknown
  try { payload = JSON.parse(rawBody) } catch {
    return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
  }
  const parsed = parseInboundEvent(payload)
  if (!parsed.ok) {
    return NextResponse.json({
      error:  'Payload validation failed',
      errors: parsed.errors,
    }, { status: 400 })
  }

  try {
    // 1. Log the event (append-only).
    const { error: eventErr } = await admin
      .from('cmms_sync_events')
      .insert({
        tenant_id:      integration.tenant_id,
        integration_id: integration.id,
        direction:      'inbound',
        event_type:     parsed.event.event_type,
        payload:        parsed.event,
        status:         'delivered',
        attempts:       1,
        processed_at:   new Date().toISOString(),
      })
    if (eventErr) {
      Sentry.captureException(eventErr, { tags: { route: 'cmms/webhook', stage: 'event-insert' } })
      return NextResponse.json({ error: eventErr.message }, { status: 500 })
    }

    // 2. Upsert the work-order link.
    const nowIso = new Date().toISOString()
    const opened  = parsed.event.event_type === 'work_order.opened'
    const closed  = parsed.event.event_type === 'work_order.closed'
                 || parsed.event.event_type === 'work_order.cancelled'

    const { error: linkErr } = await admin
      .from('cmms_work_order_links')
      .upsert({
        tenant_id:          integration.tenant_id,
        equipment_id:       parsed.event.equipment_id,
        cmms_system:        integration.system,
        cmms_work_order_id: parsed.event.work_order_id,
        status:             parsed.event.status,
        opened_at:          opened ? (parsed.event.occurred_at ?? nowIso) : undefined,
        closed_at:          closed ? (parsed.event.occurred_at ?? nowIso) : undefined,
      }, { onConflict: 'tenant_id,cmms_system,cmms_work_order_id' })
    if (linkErr) {
      Sentry.captureException(linkErr, { tags: { route: 'cmms/webhook', stage: 'link-upsert' } })
      return NextResponse.json({ error: linkErr.message }, { status: 500 })
    }

    // 3. Stamp last_sync_at.
    await admin
      .from('cmms_integrations')
      .update({ last_sync_at: nowIso })
      .eq('id', integration.id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cmms/webhook' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
