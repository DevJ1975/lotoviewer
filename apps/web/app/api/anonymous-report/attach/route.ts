import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { clientIp, hashIp, isOverIpLimit, recordAttempt } from '@/lib/anonReport/ipThrottle'

// PUBLIC POST /api/anonymous-report/attach
//
// Body: {
//   incident_id:  uuid,
//   attachments:  [{ path: string, mime: string, byte_size: number, caption?: string }]
// }
//
// Called by the report form AFTER the browser has finished
// uploading file blobs to Supabase Storage via the signed URLs that
// /api/anonymous-report returned. We validate:
//
//   - the incident exists, is_anonymous=true, and was created in
//     the last 5 minutes (a longer window would let an attacker
//     who'd discovered an incident_id late-attach junk).
//   - each path is inside <tenant>/anonymous-reports/<incident_id>/.
//   - each mime is on the allowlist.
//   - each byte_size is reasonable.
//
// On success: insert rows into incident_attachments. Storage objects
// that fail validation are deleted to avoid leaving orphans.

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg',
])
const MAX_BYTES = 10 * 1024 * 1024
const MAX_ATTACH_PER_REQUEST = 4
const ATTACH_WINDOW_MS = 5 * 60 * 1000
const ATTACH_BUCKET = 'loto-photos'

interface InboundAttachment {
  path:      string
  mime:      string
  byte_size: number
  caption?:  string
}

interface PostBody {
  incident_id?: string
  attachments?: InboundAttachment[]
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: Request) {
  const ipHash = hashIp(clientIp(req))

  if (await isOverIpLimit(ipHash)) {
    void recordAttempt(ipHash, 'submit_rate_limit')
    return NextResponse.json(
      { error: 'Too many requests. Please wait a few minutes.' },
      { status: 429 },
    )
  }

  let body: PostBody
  try { body = await req.json() as PostBody }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const incidentId = body.incident_id
  const inbound = Array.isArray(body.attachments) ? body.attachments : []
  if (!incidentId || !UUID_RE.test(incidentId)) {
    return NextResponse.json({ error: 'incident_id required' }, { status: 400 })
  }
  if (inbound.length === 0 || inbound.length > MAX_ATTACH_PER_REQUEST) {
    return NextResponse.json({ error: 'attachments must be 1..4 items' }, { status: 400 })
  }

  const admin = supabaseAdmin()

  try {
    const { data: incident, error: incErr } = await admin
      .from('incidents')
      .select('id, tenant_id, is_anonymous, reported_at')
      .eq('id', incidentId)
      .maybeSingle()
    if (incErr) {
      Sentry.captureException(incErr, { tags: { route: 'anonymous-report/attach' } })
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if (!incident) return NextResponse.json({ error: 'Unknown incident' }, { status: 404 })
    const inc = incident as unknown as { id: string; tenant_id: string; is_anonymous: boolean; reported_at: string }

    if (!inc.is_anonymous) {
      return NextResponse.json({ error: 'Cannot attach to authenticated incidents via this endpoint' }, { status: 403 })
    }
    const ageMs = Date.now() - new Date(inc.reported_at).getTime()
    if (ageMs > ATTACH_WINDOW_MS) {
      return NextResponse.json({ error: 'Attachment window expired' }, { status: 410 })
    }

    const expectedPrefix = `${inc.tenant_id}/anonymous-reports/${inc.id}/`
    const rows: Array<Record<string, unknown>> = []
    const orphans: string[] = []

    for (const a of inbound) {
      if (typeof a.path !== 'string' || !a.path.startsWith(expectedPrefix)) {
        orphans.push(typeof a.path === 'string' ? a.path : '')
        continue
      }
      if (!ALLOWED_MIME.has(a.mime)) { orphans.push(a.path); continue }
      if (typeof a.byte_size !== 'number' || a.byte_size <= 0 || a.byte_size > MAX_BYTES) {
        orphans.push(a.path); continue
      }
      rows.push({
        tenant_id:       inc.tenant_id,
        incident_id:     inc.id,
        storage_path:    a.path,
        mime_type:       a.mime,
        file_size_bytes: a.byte_size,
        caption:         typeof a.caption === 'string' && a.caption.trim()
                           ? a.caption.trim().slice(0, 500)
                           : null,
      })
    }

    if (orphans.length > 0) {
      // Best effort cleanup. Storage RLS on the bucket is tenant-
      // scoped on the path prefix; service role bypasses but we
      // should still clean up only what we created.
      const valid = orphans.filter(p => p.startsWith(`${inc.tenant_id}/`))
      if (valid.length > 0) {
        await admin.storage.from(ATTACH_BUCKET).remove(valid).catch(() => { /* ignore */ })
      }
    }

    if (rows.length === 0) {
      return NextResponse.json({ error: 'No valid attachments' }, { status: 400 })
    }

    const { error: insErr } = await admin.from('incident_attachments').insert(rows)
    if (insErr) {
      Sentry.captureException(insErr, { tags: { route: 'anonymous-report/attach', stage: 'insert' } })
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    void recordAttempt(ipHash, 'submit_ok')
    return NextResponse.json({ ok: true, attached: rows.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'anonymous-report/attach' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
