import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError, badRequest } from '@/lib/security/sanitizeError'
import { validateAnnualRow, annualSummaryUpsertRow } from '@/lib/insights/annualSummaryRow'

// POST /api/insights/history-import/confirm
//
// Step 3 of the historical-import flow. The admin has reviewed (and
// possibly corrected) the numbers the extract route read off the PDF;
// this route validates them and upserts one osha_annual_summaries row
// for (tenant, establishment, year).
//
// The extract route NEVER writes — persistence happens here, behind an
// explicit confirm, so a human always signs off on the numbers before
// they reach the year-over-year scorecard. Writes go through the gate's
// RLS-scoped client so the row is constrained to the active tenant.
//
// The per-row validation + totals_json build live in
// lib/insights/annualSummaryRow so the batch (CSV) route applies the
// SAME rules — see confirm-batch/route.ts.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ConfirmBody {
  establishmentId?: unknown
  year?:            unknown
  fields?:          unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: ConfirmBody
  try { body = (await req.json()) as ConfirmBody }
  catch { return badRequest('Expected an application/json body.') }

  const establishmentId = typeof body.establishmentId === 'string' ? body.establishmentId.trim() : ''
  if (!UUID_RE.test(establishmentId)) {
    return badRequest('A valid establishmentId is required.')
  }

  // The form submits `year` alongside `fields`; fold it in so the
  // shared validator sees one row object. A single malformed value
  // fails the whole submission — partial saves corrupt the YoY math.
  const rawFields = (body.fields ?? {}) as Record<string, unknown>
  const thisYear = new Date().getUTCFullYear()
  const result = validateAnnualRow({ ...rawFields, year: body.year }, thisYear)
  if (!result.ok) return badRequest(result.message)

  // The establishment must belong to the active tenant. The gate's RLS
  // client already scopes by tenant, so a row coming back proves both
  // existence and ownership.
  const { data: establishment, error: lookupError } = await gate.authedClient
    .from('osha_establishments')
    .select('id')
    .eq('id', establishmentId)
    .maybeSingle()
  if (lookupError) return sanitizeError(lookupError, 'insights/history-import/confirm/POST lookup')
  if (!establishment) return badRequest('That establishment does not belong to this tenant.', 404)

  const { error: upsertError } = await gate.authedClient
    .from('osha_annual_summaries')
    .upsert(
      annualSummaryUpsertRow({ tenantId: gate.tenantId, establishmentId, totals: result.totals }),
      { onConflict: 'tenant_id,establishment_id,year' },
    )
  if (upsertError) return sanitizeError(upsertError, 'insights/history-import/confirm/POST upsert')

  return NextResponse.json({ ok: true, year: result.totals.year })
}
