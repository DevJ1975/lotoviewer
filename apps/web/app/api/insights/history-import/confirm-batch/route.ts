import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError, badRequest } from '@/lib/security/sanitizeError'
import { validateAnnualRow, annualSummaryUpsertRow } from '@/lib/insights/annualSummaryRow'

// POST /api/insights/history-import/confirm-batch
//
// The CSV path's "save all" step. Where the single /confirm route
// upserts ONE year, this one upserts MANY: the admin maps their
// spreadsheet's columns, reviews the preview, and confirms a whole
// stack of prior years in a single request — the big win of CSV over
// the one-PDF-at-a-time flow.
//
// Same posture as /confirm: tenant-admin gated, every value
// re-validated at the boundary (the rows came from an arbitrary
// spreadsheet), and the establishment-ownership check done ONCE up
// front. Validation + totals_json build are shared with /confirm via
// lib/insights/annualSummaryRow so a CSV-imported 300A is validated
// identically to a PDF-imported one.
//
// All-or-nothing: a single invalid row rejects the whole batch with a
// message naming the offending year. Partial saves of a multi-year
// backfill would leave the scorecard's trend line silently wrong.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface BatchBody {
  establishmentId?: unknown
  rows?:            unknown
}

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: BatchBody
  try { body = (await req.json()) as BatchBody }
  catch { return badRequest('Expected an application/json body.') }

  const establishmentId = typeof body.establishmentId === 'string' ? body.establishmentId.trim() : ''
  if (!UUID_RE.test(establishmentId)) {
    return badRequest('A valid establishmentId is required.')
  }

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return badRequest('rows must be a non-empty array of annual summaries.')
  }

  const thisYear = new Date().getUTCFullYear()

  // Validate every row and key it by year. De-dupe is LAST-WINS: a
  // spreadsheet that lists the same year twice keeps the later row,
  // matching the upsert's own onConflict semantics (and what an admin
  // would expect from "the second 2021 line corrects the first").
  const byYear = new Map<number, ReturnType<typeof annualSummaryUpsertRow>>()
  for (let i = 0; i < body.rows.length; i++) {
    const raw = body.rows[i]
    if (!raw || typeof raw !== 'object') {
      return badRequest(`Row ${i + 1} is not a valid object.`)
    }
    const result = validateAnnualRow(raw as Record<string, unknown>, thisYear, `row ${i + 1}`)
    if (!result.ok) return badRequest(result.message)
    byYear.set(
      result.totals.year,
      annualSummaryUpsertRow({ tenantId: gate.tenantId, establishmentId, totals: result.totals }),
    )
  }

  // Ownership check ONCE — the RLS client scopes by tenant, so a row
  // coming back proves both existence and ownership for every upsert
  // that follows.
  const { data: establishment, error: lookupError } = await gate.authedClient
    .from('osha_establishments')
    .select('id')
    .eq('id', establishmentId)
    .maybeSingle()
  if (lookupError) return sanitizeError(lookupError, 'insights/history-import/confirm-batch/POST lookup')
  if (!establishment) return badRequest('That establishment does not belong to this tenant.', 404)

  const upsertRows = [...byYear.values()]
  const { error: upsertError } = await gate.authedClient
    .from('osha_annual_summaries')
    .upsert(upsertRows, { onConflict: 'tenant_id,establishment_id,year' })
  if (upsertError) return sanitizeError(upsertError, 'insights/history-import/confirm-batch/POST upsert')

  const years = [...byYear.keys()].sort((a, b) => a - b)
  return NextResponse.json({ ok: true, saved: years.length, years })
}
