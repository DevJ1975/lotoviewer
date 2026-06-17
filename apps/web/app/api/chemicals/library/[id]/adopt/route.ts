import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { adoptLibraryChemical } from '@/lib/sdsLibraryAdopt'

// POST /api/chemicals/library/[id]/adopt   { override_restricted?: boolean }
//
// Clone an approved library chemical into the tenant's catalog and fetch a
// fresh manufacturer SDS into the tenant's storage. Admin-only: it creates a
// catalog record and carries the same restricted-list semantics as create.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function POST(req: Request, ctx: Ctx) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid library id' }, { status: 400 })

  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> }
  catch { /* empty body is fine */ }
  const overrideRestricted = body.override_restricted === true

  try {
    const result = await adoptLibraryChemical({
      tenantId: gate.tenantId, userId: gate.userId, libraryId: id, overrideRestricted,
    })
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, matched: result.matched, requires_override: result.requiresOverride },
        { status: result.status },
      )
    }
    return NextResponse.json({
      product:           result.product,
      sds:               result.sds,
      deduped:           result.deduped,
      sds_fetch_pending: result.sdsFetchPending,
      sds_fetch_outcome: result.sdsFetchOutcome,
    }, { status: result.deduped ? 200 : 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: '/api/chemicals/library/adopt' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
