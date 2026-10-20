import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { authenticateOfflineCaller } from '@/lib/strike/offlineCaller'
import { buildOfflineManifest } from '@/lib/strike/offlineManifest'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

// What the tablet app downloads to work with no connection. The response
// carries the per-device quiz key, so it is never cached.
export async function GET(req: Request) {
  try {
    const admin = supabaseAdmin()
    const auth = await authenticateOfflineCaller(admin, req)
    if (!auth.ok) return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status })

    const limit = checkMemoryRateLimit(`strike-offline-manifest:${auth.rateKey}`, 10, 60_000)
    if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

    const manifest = await buildOfflineManifest(admin, { tenantId: auth.caller.tenantId, device: auth.caller.device, keyScope: auth.keyScope })
    return NextResponse.json(manifest, { headers: { 'cache-control': 'no-store' } })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/offline/manifest' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
