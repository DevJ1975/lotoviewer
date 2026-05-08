import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireManualReader } from '@/lib/manuals/auth'

// GET /api/manuals — list of every manual the caller may see. Drafts
// (`published_at IS NULL`) only flow back to superadmins.

export async function GET(req: Request) {
  const auth = await requireManualReader(req)
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status })

  try {
    const admin = supabaseAdmin()
    let q = admin
      .from('manuals')
      .select('id, module_id, title, summary, version, published_at, updated_at, updated_by')
      .order('module_id', { ascending: true })
    if (!auth.isSuperadmin) q = q.not('published_at', 'is', null)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ manuals: data ?? [] })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'manuals/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
