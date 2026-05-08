import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/safety-boards/threads/[threadId]/spawn-action
//
// One-click "create CAPA from thread." Creates a row in
// incident_actions with source_thread_id pointing back at this
// thread, so:
//   - The thread page can show a "spawned actions" panel.
//   - The action page can render "↶ from board thread #N."
//
// Body:
//   {
//     description?: string         // defaults to thread.title
//     action_type:  'corrective' | 'preventive' | 'interim'
//     hierarchy_of_controls?: string
//     owner_user_id?: string
//     due_at?: string              // ISO
//     incident_id?: string         // optional — if the thread is
//                                  // already linked to an incident, we
//                                  // default to that
//   }
//
// Permissions: any tenant member can spawn an action from a thread
// they can see. Same posture as creating an action from the incident
// page directly (members can file CAPAs).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTION_TYPES = ['corrective','preventive','interim'] as const
const HIERARCHY = ['elimination','substitution','engineering','administrative','ppe'] as const

interface RouteContext { params: Promise<{ threadId: string }> }

export async function POST(req: Request, ctx: RouteContext) {
  const { threadId } = await ctx.params
  if (!UUID_RE.test(threadId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    description?: string
    action_type?: typeof ACTION_TYPES[number]
    hierarchy_of_controls?: typeof HIERARCHY[number] | null
    owner_user_id?: string | null
    due_at?: string | null
    incident_id?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.action_type || !(ACTION_TYPES as readonly string[]).includes(body.action_type)) {
    return NextResponse.json({ error: `action_type must be one of ${ACTION_TYPES.join(', ')}` }, { status: 400 })
  }
  if (body.hierarchy_of_controls && !(HIERARCHY as readonly string[]).includes(body.hierarchy_of_controls)) {
    return NextResponse.json({ error: `hierarchy_of_controls invalid` }, { status: 400 })
  }
  if (body.owner_user_id && !UUID_RE.test(body.owner_user_id)) {
    return NextResponse.json({ error: 'owner_user_id must be a uuid' }, { status: 400 })
  }
  if (body.incident_id && !UUID_RE.test(body.incident_id)) {
    return NextResponse.json({ error: 'incident_id must be a uuid' }, { status: 400 })
  }

  try {
    const admin = supabaseAdmin()
    const { data: thread } = await admin
      .from('safety_board_threads')
      .select('id, tenant_id, title, body, deleted_at, linked_entity_type, linked_entity_id')
      .eq('id', threadId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const t = thread as {
      id: string; tenant_id: string; title: string; body: string;
      deleted_at: string | null;
      linked_entity_type: string | null; linked_entity_id: string | null
    } | null
    if (!t || t.deleted_at) return NextResponse.json({ error: 'Thread not found' }, { status: 404 })

    // Resolve incident: explicit param wins; otherwise inherit if
    // the thread is linked to an incident; otherwise reject — the
    // CAPA model requires an incident parent.
    let incidentId: string | null = body.incident_id ?? null
    if (!incidentId && t.linked_entity_type === 'incident') {
      incidentId = t.linked_entity_id
    }
    if (!incidentId) {
      return NextResponse.json({
        error: 'Cannot spawn action: provide incident_id or link the thread to an incident first.',
      }, { status: 400 })
    }
    // Verify incident exists in tenant.
    const { data: incident } = await admin
      .from('incidents')
      .select('id, tenant_id')
      .eq('id', incidentId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (!incident) return NextResponse.json({ error: 'Incident not found' }, { status: 404 })

    const description = (body.description ?? `From safety-board discussion: ${t.title}`).trim()

    const { data: inserted, error: insertErr } = await admin
      .from('incident_actions')
      .insert({
        tenant_id:             gate.tenantId,
        incident_id:           incidentId,
        action_type:           body.action_type,
        hierarchy_of_controls: body.hierarchy_of_controls ?? null,
        description,
        owner_user_id:         body.owner_user_id ?? null,
        due_at:                body.due_at ?? null,
        source_thread_id:      threadId,
        created_by:            gate.userId,
        updated_by:            gate.userId,
      })
      .select('*')
      .single()
    if (insertErr) {
      Sentry.captureException(insertErr, { tags: { route: 'safety-thread-spawn-action/POST', stage: 'insert' } })
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ action: inserted, incident_id: incidentId }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-thread-spawn-action/POST' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
