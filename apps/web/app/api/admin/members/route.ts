import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { isMissingMembersSchema, listMembersForTenant } from '@/lib/members/server'

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const includeArchived = url.searchParams.get('includeArchived') === '1'
  const limit = Number(url.searchParams.get('limit') ?? '250')

  try {
    const members = await listMembersForTenant(gate.authedClient, gate.tenantId, {
      q,
      includeArchived,
      limit: Number.isFinite(limit) ? limit : 250,
    })
    return NextResponse.json({ members })
  } catch (error) {
    if (isMissingMembersSchema(error)) {
      return NextResponse.json({
        error: 'Members schema has not been migrated yet. Apply migration 131_unified_members.sql.',
      }, { status: 503 })
    }
    Sentry.captureException(error, { tags: { route: 'admin-members/GET' } })
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 })
  }
}
