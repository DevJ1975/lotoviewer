import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  canVerify,
  type CapaRow,
  type CapaStatus,
} from '@soteria/core/incidentCapa'

// PATCH /api/incidents/[id]/capas/[capaId]
//
// Supported transitions:
//   action: 'mark_in_progress'  → status='in_progress'
//   action: 'mark_completed'    → status='completed', completed_at=now, completed_by_user_id=actor
//   action: 'mark_verified'     → status='verified', verified_effective_at=now,
//                                  verified_by_user_id=actor, verification_notes=body.notes
//                                  (actor MUST differ from completed_by_user_id — DB trigger
//                                  also enforces this so a forged request can't bypass)
//   action: 'cancel'            → status='cancelled'
//   action: 'edit'              → free-text update of description / hierarchy / assignee / due

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface RouteContext {
  params: Promise<{ id: string; capaId: string }>
}

interface PatchBody {
  action?:               unknown
  notes?:                unknown
  description?:          unknown
  hierarchy_level?:      unknown
  assigned_to_user_id?:  unknown
  due_at?:               unknown
}

const SELECT_COLS = [
  'id', 'tenant_id', 'incident_id', 'description', 'hierarchy_level',
  'assigned_to_user_id', 'due_at', 'completed_at', 'completed_by_user_id',
  'verified_effective_at', 'verified_by_user_id', 'verification_notes',
  'status', 'created_at', 'updated_at', 'created_by_user_id',
].join(', ')

export async function PATCH(req: Request, ctx: RouteContext) {
  const { id: incidentId, capaId } = await ctx.params
  if (!UUID_RE.test(incidentId)) return NextResponse.json({ error: 'Invalid incident id' }, { status: 400 })
  if (!UUID_RE.test(capaId))     return NextResponse.json({ error: 'Invalid capa id' },     { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: PatchBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const action = typeof body.action === 'string' ? body.action : ''

  try {
    const admin = supabaseAdmin()
    const { data: current, error: loadErr } = await admin
      .from('incident_capas')
      .select(SELECT_COLS)
      .eq('id', capaId)
      .eq('tenant_id', gate.tenantId)
      .eq('incident_id', incidentId)
      .maybeSingle<CapaRow>()
    if (loadErr) throw new Error(loadErr.message)
    if (!current) return NextResponse.json({ error: 'CAPA not found' }, { status: 404 })

    const update: Partial<{
      status: CapaStatus
      completed_at: string | null
      completed_by_user_id: string | null
      verified_effective_at: string | null
      verified_by_user_id: string | null
      verification_notes: string | null
      description: string
      hierarchy_level: string
      assigned_to_user_id: string | null
      due_at: string | null
    }> = {}

    if (action === 'mark_in_progress') {
      update.status = 'in_progress'
    } else if (action === 'mark_completed') {
      update.status = 'completed'
      update.completed_at = new Date().toISOString()
      update.completed_by_user_id = gate.userId
    } else if (action === 'mark_verified') {
      // Surface the gate before issuing the SQL — the DB trigger
      // catches it too, but a clear 400 is friendlier than a generic
      // 500.
      if (!canVerify(current, gate.userId)) {
        return NextResponse.json({
          error: 'You cannot verify your own CAPA. A different user must mark verified-effective.',
        }, { status: 403 })
      }
      const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
      update.status = 'verified'
      update.verified_effective_at = new Date().toISOString()
      update.verified_by_user_id = gate.userId
      update.verification_notes = notes || null
    } else if (action === 'cancel') {
      update.status = 'cancelled'
    } else if (action === 'edit') {
      if (typeof body.description === 'string') {
        const d = body.description.trim()
        if (!d) return NextResponse.json({ error: 'description cannot be empty' }, { status: 400 })
        update.description = d
      }
      if (typeof body.hierarchy_level === 'string') update.hierarchy_level = body.hierarchy_level
      if (body.assigned_to_user_id === null || typeof body.assigned_to_user_id === 'string') {
        const v = typeof body.assigned_to_user_id === 'string' ? body.assigned_to_user_id : null
        if (v && !UUID_RE.test(v)) return NextResponse.json({ error: 'assigned_to_user_id must be a uuid' }, { status: 400 })
        update.assigned_to_user_id = v
      }
      if (body.due_at === null || typeof body.due_at === 'string') {
        update.due_at = (typeof body.due_at === 'string' && body.due_at) ? body.due_at : null
      }
    } else {
      return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('incident_capas')
      .update(update)
      .eq('id', capaId)
      .eq('tenant_id', gate.tenantId)
      .select(SELECT_COLS)
      .single()
    if (error) {
      // The DB trigger raises 'verification of effectiveness must be
      // performed by a different user from the completer' — surface
      // that as a 403 so the UI can show a sensible message.
      if (error.message.includes('different user')) {
        return NextResponse.json({ error: error.message }, { status: 403 })
      }
      Sentry.captureException(error, { tags: { route: 'capas/PATCH', stage: 'update' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ capa: data })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'capas/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Unknown error' }, { status: 500 })
  }
}
