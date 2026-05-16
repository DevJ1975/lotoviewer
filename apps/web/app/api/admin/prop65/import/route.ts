import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { PROP65_HARM_ENDPOINTS, type Prop65HarmEndpoint } from '@soteria/core/prop65'
import { normalizeCasNumber } from '@soteria/core/prop65SafeHarbor'

// POST /api/admin/prop65/import — superadmin CSV refresh of the
// system-wide prop65_chemicals list.
//
// Body: { rows: Array<{
//          cas_number:    string,
//          chemical_name: string,
//          harm_endpoint: 'cancer' | 'reproductive' | 'both',
//          listing_date?: string  // ISO yyyy-mm-dd
//          nsrl_mg_day?:  number | null,
//          madl_mg_day?:  number | null,
//          source_publication?: string
//        }> }
//
// The route normalizes CAS numbers, validates the endpoint, then
// upserts on cas_number — rows are added or updated, never deleted
// (OEHHA's list only grows; removing an entry is a policy decision
// best done manually).

interface ImportRow {
  cas_number:          unknown
  chemical_name:       unknown
  harm_endpoint:       unknown
  listing_date?:       unknown
  nsrl_mg_day?:        unknown
  madl_mg_day?:        unknown
  source_publication?: unknown
}

interface ImportBody { rows?: unknown }

export async function POST(req: Request) {
  const auth = await requireSuperadmin(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  let body: ImportBody
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!Array.isArray(body.rows) || body.rows.length === 0)
    return NextResponse.json({ error: 'rows must be a non-empty array' }, { status: 400 })

  const cleaned: Array<{
    cas_number: string
    chemical_name: string
    harm_endpoint: Prop65HarmEndpoint
    listing_date: string | null
    nsrl_mg_day: number | null
    madl_mg_day: number | null
    source_publication: string | null
  }> = []

  const errors: { row: number; message: string }[] = []

  body.rows.forEach((raw, idx) => {
    const row = raw as ImportRow
    const cas = typeof row.cas_number === 'string' ? normalizeCasNumber(row.cas_number) : null
    const name = typeof row.chemical_name === 'string' ? row.chemical_name.trim() : ''
    const endpoint = typeof row.harm_endpoint === 'string' ? row.harm_endpoint : ''

    if (!cas)  return errors.push({ row: idx, message: 'invalid cas_number' })
    if (!name) return errors.push({ row: idx, message: 'chemical_name required' })
    if (!PROP65_HARM_ENDPOINTS.includes(endpoint as Prop65HarmEndpoint))
      return errors.push({ row: idx, message: 'invalid harm_endpoint' })

    cleaned.push({
      cas_number:    cas,
      chemical_name: name,
      harm_endpoint: endpoint as Prop65HarmEndpoint,
      listing_date:  typeof row.listing_date === 'string' ? row.listing_date : null,
      nsrl_mg_day:   typeof row.nsrl_mg_day === 'number' ? row.nsrl_mg_day : null,
      madl_mg_day:   typeof row.madl_mg_day === 'number' ? row.madl_mg_day : null,
      source_publication: typeof row.source_publication === 'string' ? row.source_publication : null,
    })
  })

  if (errors.length > 0)
    return NextResponse.json({ error: 'Validation failed', errors }, { status: 400 })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('prop65_chemicals')
    .upsert(cleaned, { onConflict: 'cas_number' })
    .select('id, cas_number')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ imported: data?.length ?? 0 })
}
