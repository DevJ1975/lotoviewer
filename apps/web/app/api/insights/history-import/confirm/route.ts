import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError, badRequest } from '@/lib/security/sanitizeError'
import { INJURY_TYPES, type InjuryType, type Osha300ASummary } from '@soteria/core/oshaForms'

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

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The numeric 300A fields the form submits. Mirrors AnnualSummaryFields
// from the extractor, but the route re-validates every value — the
// admin edits them by hand, so this is an untrusted system boundary.
interface ConfirmBody {
  establishmentId?: unknown
  year?:            unknown
  fields?:          unknown
}

const SCALAR_FIELDS = [
  'total_deaths',
  'total_days_away',
  'total_restricted',
  'total_other_recordable',
  'total_days_away_count',
  'total_days_restricted_count',
  'total_hours_worked',
  'annual_avg_employees',
] as const

// A non-negative, finite, whole number — or null when the input can't
// be coerced to one. Used to reject negatives, floats, NaN, and junk at
// the boundary rather than silently flooring them: the admin typed it,
// so a malformed value is worth a 400.
function asCount(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isInteger(n) || n < 0) return null
  return n
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

  const year = asCount(body.year)
  const thisYear = new Date().getUTCFullYear()
  if (year === null || year < thisYear - 20 || year > thisYear) {
    return badRequest(`year must be between ${thisYear - 20} and ${thisYear}.`)
  }

  const rawFields = (body.fields ?? {}) as Record<string, unknown>

  // Validate every scalar count. A single malformed value fails the
  // whole submission — partial saves of a 300A would corrupt the YoY math.
  const scalars = {} as Record<(typeof SCALAR_FIELDS)[number], number>
  for (const key of SCALAR_FIELDS) {
    const n = asCount(rawFields[key])
    if (n === null) return badRequest(`${key} must be a non-negative integer.`)
    scalars[key] = n
  }

  // Per-type breakdown: each entry validated the same way, defaulting a
  // missing type to 0 (the 300A frequently leaves the breakdown blank).
  const rawByType = (rawFields.by_injury_type ?? {}) as Record<string, unknown>
  const byInjuryType = {} as Record<InjuryType, number>
  for (const type of INJURY_TYPES) {
    const n = asCount(rawByType[type])
    if (n === null) return badRequest(`by_injury_type.${type} must be a non-negative integer.`)
    byInjuryType[type] = n
  }

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

  // Build the Osha300ASummary the scorecard's year-over-year reader
  // expects in totals_json.
  const totals: Osha300ASummary = {
    year,
    total_deaths:                scalars.total_deaths,
    total_days_away:             scalars.total_days_away,
    total_restricted:            scalars.total_restricted,
    total_other_recordable:      scalars.total_other_recordable,
    total_days_away_count:       scalars.total_days_away_count,
    total_days_restricted_count: scalars.total_days_restricted_count,
    by_injury_type:              byInjuryType,
    total_hours_worked:          scalars.total_hours_worked,
    annual_avg_employees:        scalars.annual_avg_employees,
  }

  const { error: upsertError } = await gate.authedClient
    .from('osha_annual_summaries')
    .upsert(
      {
        tenant_id:            gate.tenantId,
        establishment_id:     establishmentId,
        year,
        totals_json:          totals,
        total_hours_worked:   scalars.total_hours_worked,
        annual_avg_employees: scalars.annual_avg_employees,
      },
      { onConflict: 'tenant_id,establishment_id,year' },
    )
  if (upsertError) return sanitizeError(upsertError, 'insights/history-import/confirm/POST upsert')

  return NextResponse.json({ ok: true, year })
}
