import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Public audit-review API. No account — the URL token is the auth (same posture
// as /api/review/[token], but for kind='audit' links bound to an audit run).
//
//   GET  — the run summary, per-equipment results, and the staged change-set.
//   POST action='view-ack'      — stamp first view.
//        action='decide-change' — approve/reject one staged change (+ note).
//        action='signoff'       — finalize the review (no further decisions).
//
// Deciding a change never writes to the live LOTO tables — it only flips the
// staged row's status. An admin then applies the approved set (snapshot-first)
// via /api/admin/loto/audit/[runId]/apply. No approval here ⇒ no live write.

const TOKEN_RE = /^[0-9a-f]{32}$/

type AuditLink = {
  id:            string
  tenant_id:     string
  audit_run_id:  string
  signed_off_at: string | null
  first_viewed_at: string | null
}

type LinkLookup = { ok: true; link: AuditLink } | { ok: false; status: number; message: string }

async function lookupAuditLink(token: string): Promise<LinkLookup> {
  if (!TOKEN_RE.test(token)) return { ok: false, status: 400, message: 'Invalid token format' }
  const admin = supabaseAdmin()
  const { data: link, error } = await admin
    .from('loto_review_links')
    .select('id, tenant_id, kind, audit_run_id, expires_at, revoked_at, first_viewed_at, signed_off_at')
    .eq('token', token)
    .maybeSingle()
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review/audit/[token]', stage: 'lookup' } })
    return { ok: false, status: 500, message: error.message }
  }
  if (!link) return { ok: false, status: 404, message: 'Review link not found' }
  if (link.kind !== 'audit' || !link.audit_run_id) return { ok: false, status: 404, message: 'Not an audit review link' }
  if (link.revoked_at) return { ok: false, status: 410, message: 'This review link has been revoked.' }
  if (Date.parse(link.expires_at) < Date.now()) return { ok: false, status: 410, message: 'This review link has expired.' }
  return {
    ok: true,
    link: {
      id: link.id, tenant_id: link.tenant_id, audit_run_id: link.audit_run_id,
      signed_off_at: link.signed_off_at, first_viewed_at: link.first_viewed_at,
    },
  }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const lookup = await lookupAuditLink(token)
  if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })
  const { link } = lookup
  const admin = supabaseAdmin()

  const [{ data: run }, { data: changes }, { data: results }] = await Promise.all([
    // regulator_report carries the Cal/OSHA inspector's program-level review the
    // reviewer reads before approving.
    admin.from('loto_audit_runs')
      .select('id, status, scope, total_equipment, processed_equipment, started_at, finished_at, regulator_report')
      .eq('id', link.audit_run_id).maybeSingle(),
    admin.from('loto_audit_changes')
      .select('id, equipment_id, change_kind, target_table, target_column, old_value, new_value, agent, rationale, severity, status, staged_photo_url, decided_by, decided_at, decided_note')
      .eq('run_id', link.audit_run_id)
      .order('equipment_id', { ascending: true }).order('created_at', { ascending: true }),
    // regulator_payload (per-machine inspector narrative) + regulator_concurs
    // (the "sharpened" badge) ride alongside the EHS verdict.
    admin.from('loto_audit_equipment_results')
      .select('equipment_id, iso_photo_verdict, equip_photo_verdict, ds_equipment_confidence, ehs_pass, ehs_notes, regulator_payload, regulator_concurs')
      .eq('run_id', link.audit_run_id).order('equipment_id', { ascending: true }),
  ])

  return NextResponse.json({
    signed_off_at: link.signed_off_at,
    run: run ?? null,
    changes: changes ?? [],
    results: results ?? [],
    regulator_report: run?.regulator_report ?? null,
  })
}

interface PostBody {
  action?:        unknown
  change_id?:     unknown
  decision?:      unknown
  note?:          unknown
  reviewer_name?: unknown
  typed_name?:    unknown
  approved?:      unknown
  notes?:         unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const lookup = await lookupAuditLink(token)
  if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })
  const { link } = lookup
  const admin = supabaseAdmin()

  let body: PostBody
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const action = typeof body.action === 'string' ? body.action : ''

  if (action === 'view-ack') {
    if (!link.first_viewed_at) {
      await admin.from('loto_review_links').update({ first_viewed_at: new Date().toISOString() }).eq('id', link.id)
    }
    return NextResponse.json({ ok: true })
  }

  if (link.signed_off_at) {
    return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
  }

  if (action === 'decide-change') {
    const changeId = typeof body.change_id === 'string' ? body.change_id : ''
    const decision = body.decision === 'approved' ? 'approved' : body.decision === 'rejected' ? 'rejected' : null
    const reviewer = typeof body.reviewer_name === 'string' ? body.reviewer_name.trim() : ''
    const note     = typeof body.note === 'string' ? body.note.trim() : ''
    if (!changeId) return NextResponse.json({ error: 'change_id required' }, { status: 400 })
    if (!decision) return NextResponse.json({ error: 'decision must be approved or rejected' }, { status: 400 })

    // Only undecided/decided-but-not-yet-applied rows can flip; applied/
    // superseded are terminal. Scope to this link's run + tenant.
    const { data: updated, error } = await admin
      .from('loto_audit_changes')
      .update({ status: decision, decided_by: reviewer || null, decided_at: new Date().toISOString(), decided_note: note || null })
      .eq('id', changeId)
      .eq('run_id', link.audit_run_id)
      .eq('tenant_id', link.tenant_id)
      .in('status', ['pending', 'approved', 'rejected'])
      .select('id')
    if (error) {
      Sentry.captureException(error, { tags: { route: 'review/audit/[token]', stage: 'decide-change' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!updated?.length) return NextResponse.json({ error: 'Change not found or already applied' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  if (action === 'signoff') {
    const typedName = typeof body.typed_name === 'string' ? body.typed_name.trim() : ''
    const approved  = body.approved === true ? true : body.approved === false ? false : null
    const notes     = typeof body.notes === 'string' ? body.notes.trim() : ''
    if (!typedName) return NextResponse.json({ error: 'typed_name required' }, { status: 400 })
    if (approved === null) return NextResponse.json({ error: 'approved (boolean) required' }, { status: 400 })

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
    const userAgent = req.headers.get('user-agent') ?? null

    const { data: updated, error } = await admin
      .from('loto_review_links')
      .update({
        signed_off_at: new Date().toISOString(),
        signoff_approved: approved,
        signoff_typed_name: typedName,
        signoff_notes: notes || null,
        signoff_ip: ip,
        signoff_user_agent: userAgent,
      })
      .eq('id', link.id)
      .is('signed_off_at', null)
      .select('id')
    if (error) {
      Sentry.captureException(error, { tags: { route: 'review/audit/[token]', stage: 'signoff' } })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (!updated?.length) return NextResponse.json({ error: 'This review has already been signed off.' }, { status: 409 })
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Unsupported action' }, { status: 400 })
}
