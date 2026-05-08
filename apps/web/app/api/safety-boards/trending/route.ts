import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/safety-boards/trending?limit=10
//
// Most-active threads in the past 7 days. Tenant-scoped via the
// safety_board_trending view (which inherits RLS from the threads
// table).

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(limitRaw) ? limitRaw : 10, 50))

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin
      .from('safety_board_trending')
      .select('*')
      .eq('tenant_id', gate.tenantId)
      .order('score', { ascending: false })
      .order('last_reply_at', { ascending: false })
      .limit(limit)
    if (error) throw new Error(error.message)
    return NextResponse.json({ trending: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-trending/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
