import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { tierTwoToCsv, type TierTwoRow } from '@soteria/core/chemicals'

// GET /api/chemicals/tier-two           → JSON rollup
// GET /api/chemicals/tier-two?format=csv → CSV download (Tier II export)

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'json'

  try {
    const { data, error } = await gate.authedClient
      .from('v_chemical_tier_two')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .order('product_name', { ascending: true })
      .order('location_path', { ascending: true, nullsFirst: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const rows = (data ?? []) as TierTwoRow[]

    if (format === 'csv') {
      const csv = tierTwoToCsv(rows)
      const filename = `tier-two-${new Date().toISOString().slice(0, 10)}.csv`
      return new NextResponse(csv, {
        status: 200,
        headers: {
          'content-type':        'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${filename}"`,
          'cache-control':       'no-store',
        },
      })
    }

    return NextResponse.json({ rows, total: rows.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
