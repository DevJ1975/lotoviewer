import { NextResponse } from 'next/server'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/superadmin/sds-library/chemicals?status=pending&search=&limit=&offset=
//
// Superadmin browse of the global library, including non-approved entries (the
// review queue for AI-seeded + tenant-promoted chemicals).

export const runtime = 'nodejs'

const STATUSES = ['pending', 'approved', 'rejected', 'needs_research'] as const

export async function GET(req: Request) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const status = url.searchParams.get('status')?.trim() ?? ''
  const search = url.searchParams.get('search')?.trim() ?? ''
  const limit  = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') ?? '100', 10) || 100))
  const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0)

  const admin = supabaseAdmin()
  let q = admin
    .from('sds_library_chemicals')
    .select('id, canonical_name, manufacturer, cas_primary, source_url, source_host, review_status, last_verify_outcome, last_verified_at, seed_run_id, created_at', { count: 'exact' })

  if ((STATUSES as readonly string[]).includes(status)) q = q.eq('review_status', status)
  if (search) {
    const safe = search.replace(/[,()*]/g, ' ').trim()
    if (safe) {
      const escaped = safe.replace(/[\\%_]/g, m => `\\${m}`)
      q = q.or([`canonical_name.ilike.%${escaped}%`, `manufacturer.ilike.%${escaped}%`, `cas_primary.ilike.%${escaped}%`].join(','))
    }
  }
  q = q.order('created_at', { ascending: false }).range(offset, offset + limit - 1)

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ chemicals: data ?? [], total: count ?? 0, limit, offset })
}
