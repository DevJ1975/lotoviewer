import { NextResponse } from 'next/server'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { HISTORY_CONNECTORS } from '@/lib/insights/historyConnectors'

// GET /api/admin/history-connectors
//
// Lists the external historical-data connectors and their configuration
// status, for the admin "Data connectors" page. Read-only; admin/owner gated.

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  return NextResponse.json({
    connectors: HISTORY_CONNECTORS.map(c => ({
      id:           c.id,
      label:        c.label,
      configured:   c.isConfigured(),
      status:       c.status(),
      requirements: c.requirements,
    })),
  })
}
