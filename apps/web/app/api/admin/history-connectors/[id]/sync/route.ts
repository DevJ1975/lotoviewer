import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { sanitizeError } from '@/lib/security/sanitizeError'
import {
  getHistoryConnector,
  connectorRowsToUpserts,
  ConnectorError,
} from '@/lib/insights/historyConnectors'

// POST /api/admin/history-connectors/[id]/sync
//
// Pull annual EHS rollups from an external connector and upsert them into
// osha_annual_summaries (same target + validation as the PDF/CSV import).
//
// The plumbing is complete: fetch → validate → upsert through the gate's
// RLS-scoped client. Only the connector's fetch is stubbed today — the Intelex
// adapter throws ConnectorError (501) until its credentials + field mapping
// land, at which point this route works end-to-end with no changes here.

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await params
  const connector = getHistoryConnector(id)
  if (!connector) {
    return NextResponse.json({ error: `Unknown connector: ${id}` }, { status: 404 })
  }

  let rows
  try {
    rows = await connector.fetchAnnualSummaries({ tenantId: gate.tenantId })
  } catch (err) {
    if (err instanceof ConnectorError) {
      return NextResponse.json({ error: err.message }, { status: err.httpStatus })
    }
    return sanitizeError(err, `history-connectors/${id}/sync fetch`)
  }

  const { upserts, errors } = connectorRowsToUpserts(gate.tenantId, rows)

  // Write the valid rows through the tenant-scoped client so RLS confines them
  // to this tenant and a bad establishment_id can't slip in cross-tenant.
  let imported = 0
  for (const row of upserts) {
    const { error } = await gate.authedClient
      .from('osha_annual_summaries')
      .upsert(row, { onConflict: 'tenant_id,establishment_id,year' })
    if (error) return sanitizeError(error, `history-connectors/${id}/sync upsert`)
    imported += 1
  }

  return NextResponse.json({ ok: true, imported, errors })
}
