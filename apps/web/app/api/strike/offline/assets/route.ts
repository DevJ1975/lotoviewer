import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { signStrikeContentAssets, STRIKE_ASSET_TTL_SECONDS } from '@/lib/strike/assets'
import { versionContent } from '@/lib/strike/attempts'
import { loadPublishedStrikeVersion } from '@/lib/strike/moduleAccess'
import { authenticateOfflineCaller } from '@/lib/strike/offlineCaller'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Signed URLs for one module version's images, narration and captions. They
// expire in an hour, so the tablet downloads the files straight away and keeps
// the files, never the URLs.
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const moduleVersionId = typeof body.module_version_id === 'string' ? body.module_version_id : ''
  if (!UUID_RE.test(moduleVersionId)) return NextResponse.json({ error: 'Invalid module version id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const auth = await authenticateOfflineCaller(admin, req)
    if (!auth.ok) return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status })

    const limit = checkMemoryRateLimit(`strike-offline-assets:${auth.rateKey}`, 60, 60_000)
    if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

    const { data: row, error } = await admin.from('strike_module_versions').select('module_id').eq('id', moduleVersionId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!row) return NextResponse.json({ error: 'Published version not found' }, { status: 404 })

    const lookup = await loadPublishedStrikeVersion(admin, {
      moduleId: row.module_id as string,
      moduleVersionId,
      tenantId: auth.caller.tenantId,
      role: auth.caller.user?.role ?? 'member',
    })
    if (!lookup.ok) return NextResponse.json({ error: lookup.message }, { status: lookup.status })

    const content = versionContent(lookup.version)
    const urls = content ? await signStrikeContentAssets(admin, content) : {}
    return NextResponse.json({ urls, expires_in: STRIKE_ASSET_TTL_SECONDS }, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/offline/assets' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
