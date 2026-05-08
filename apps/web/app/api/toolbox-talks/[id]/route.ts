import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/toolbox-talks/[id]
//
// Returns one talk + its sign-in roster. Used by the detail page to
// render the body and the existing signatures, and to decide whether
// the current logged-in user has already signed.
//
// Read-only. The roster is appended via POST /[id]/sign.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid talk id' }, { status: 400 })
  }

  try {
    const { data: talk, error: tErr } = await gate.authedClient
      .from('toolbox_talks')
      .select('id, tenant_id, topic_id, talk_date, title, body_markdown, key_points, delivery_notes, generated_by, generated_at, ai_model')
      .eq('id', id)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    if (tErr) throw new Error(tErr.message)
    if (!talk) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Don't return signature_data on the list — it's a 5–15 KB blob
    // per row and the list view only needs the metadata. The detail
    // page renders signatures inline by re-decoding the data URL on
    // demand if the caller asks for it via ?withSignatures=1, which
    // we keep deliberately unimplemented in v1 (audit/print bundles
    // can fetch the column directly via supabaseAdmin).
    const { data: signatures, error: sErr } = await gate.authedClient
      .from('toolbox_talk_signatures')
      .select('id, signer_user_id, signer_name, employee_id, signed_at')
      .eq('talk_id', id)
      .eq('tenant_id', gate.tenantId)
      .order('signed_at', { ascending: true })
    if (sErr) throw new Error(sErr.message)

    const alreadySigned = (signatures ?? []).some(s => s.signer_user_id === gate.userId)

    return NextResponse.json({
      talk,
      signatures:     signatures ?? [],
      already_signed: alreadySigned,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    Sentry.captureException(e, { tags: { route: 'toolbox-talks/[id]/GET' } })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
