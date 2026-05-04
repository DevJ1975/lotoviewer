import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { reviewCadenceDays, bandFor } from '@soteria/core/risk'

// POST /api/risk/[id]/reviews
// Body: { trigger?, outcome?, notes? }
//
// Records a review event in risk_reviews and bumps the parent risk's
// next_review_date by the cadence appropriate to its band (residual
// if non-null, else inherent — per the slice-2 plan's Q2 default).
//
// Auth: tenant admin or owner.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VALID_TRIGGERS = ['cadence','incident','moc','audit','worker_report','regulatory','manual'] as const
const VALID_OUTCOMES = ['no_change','rescored','controls_updated','closed','escalated']  as const
type Trigger = typeof VALID_TRIGGERS[number]
type Outcome = typeof VALID_OUTCOMES[number]

interface PostBody {
  trigger?: unknown
  outcome?: unknown
  notes?:   unknown
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  }

  let body: PostBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const trigger: Trigger = (typeof body.trigger === 'string' && (VALID_TRIGGERS as readonly string[]).includes(body.trigger))
    ? body.trigger as Trigger
    : 'manual'
  const outcome: Outcome = (typeof body.outcome === 'string' && (VALID_OUTCOMES as readonly string[]).includes(body.outcome))
    ? body.outcome as Outcome
    : 'no_change'
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  try {
    const admin = supabaseAdmin()

    // Snapshot current scores so the review row records the state at
    // review time (not what they get re-scored to next week).
    const { data: risk, error: fetchErr } = await admin
      .from('risks')
      .select('inherent_score, residual_score, residual_band, inherent_band')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (fetchErr) throw new Error(fetchErr.message)
    if (!risk) return NextResponse.json({ error: 'Not found or wrong tenant' }, { status: 404 })

    // Bump cadence by the residual band when present, else inherent
    // (a freshly-created risk with no residual yet should still get
    // a review date in the calendar).
    const band = (risk.residual_band ?? risk.inherent_band) as ReturnType<typeof bandFor>
    const cadence = reviewCadenceDays(band)
    const nextReview = new Date(Date.now() + cadence * 86_400_000).toISOString().slice(0, 10)

    const { error: insertErr } = await admin
      .from('risk_reviews')
      .insert({
        tenant_id:               gate.tenantId,
        risk_id:                 id,
        reviewed_by:             gate.userId,
        trigger,
        inherent_score_at_review: risk.inherent_score,
        residual_score_at_review: risk.residual_score,
        outcome,
        notes:                   notes || null,
      })
    if (insertErr) throw new Error(insertErr.message)

    const { error: bumpErr } = await admin
      .from('risks')
      .update({
        next_review_date: nextReview,
        last_reviewed_at: new Date().toISOString(),
        last_reviewed_by: gate.userId,
        updated_by:       gate.userId,
      })
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
    if (bumpErr) throw new Error(bumpErr.message)

    return NextResponse.json({ ok: true, next_review_date: nextReview }, { status: 201 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'risk/[id]/reviews/POST' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
