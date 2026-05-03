import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { verifyInspectorToken, type InspectorTokenPayload } from '@/lib/inspectorToken'
import type { ConfinedSpacePermit, HotWorkPermit } from '@/lib/types'

// POST /api/inspector/lookup
// Stateless — no rate limit yet, but we do clamp the response shape so a
// stolen token (or one shared past its useful life) returns only the
// summarised view, not raw PII or operationally-sensitive permit text.
//
// Request body:
//   { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD', exp: number, label: string, sig: string }
//
// Response (200):
//   { window: {...}, csPermits: [...], hotWorkPermits: [...] }
//
// Response (4xx): { error }

interface Body extends InspectorTokenPayload {
  sig?: string
}

interface InspectorCsPermit {
  id:        string
  serial:    string
  spaceId:   string
  startedAt: string
  expiresAt: string
  status:    'pending_signature' | 'active' | 'expired' | 'canceled'
  // Cancel reason surfaced to inspector — they care about for-cause
  // closures vs clean close-outs.
  cancelReason: string | null
  cancelDate:   string | null
}

interface InspectorHotWorkPermit {
  id:           string
  serial:       string
  workLocation: string
  startedAt:    string
  expiresAt:    string
  status:       string
  cancelReason: string | null
  cancelDate:   string | null
}

function csStatusFor(p: ConfinedSpacePermit): InspectorCsPermit['status'] {
  if (p.canceled_at) return 'canceled'
  if (p.expires_at && new Date(p.expires_at) < new Date()) return 'expired'
  if (!p.entry_supervisor_signature_at) return 'pending_signature'
  return 'active'
}

function hotWorkStatusLabel(p: HotWorkPermit): string {
  if (p.canceled_at)        return 'canceled'
  if (p.work_completed_at)  return 'post_watch'
  if (p.pai_signature_at)   return 'active'
  return 'pending_signature'
}

export async function POST(req: Request) {
  const secret = process.env.INSPECTOR_TOKEN_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'Inspector access is not configured on this deployment.' }, { status: 503 })
  }

  let body: Body
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { sig, ...rest } = body
  if (!sig) return NextResponse.json({ error: 'Missing signature' }, { status: 400 })

  const verify = verifyInspectorToken({ payload: rest, sig, secret })
  if (!verify.ok) return NextResponse.json({ error: verify.reason }, { status: 401 })

  // Inclusive on both ends. started_at is the lifecycle anchor — same
  // semantics the compliance-bundle admin tool uses.
  const startTs = new Date(`${rest.start}T00:00:00.000Z`).toISOString()
  const endTs   = new Date(`${rest.end}T23:59:59.999Z`).toISOString()

  const admin = supabaseAdmin()
  try {
    const [csRes, hwRes] = await Promise.all([
      admin
        .from('loto_confined_space_permits')
        .select('id, serial, space_id, started_at, expires_at, canceled_at, cancel_reason, entry_supervisor_signature_at, entry_supervisor_id')
        .gte('started_at', startTs)
        .lte('started_at', endTs)
        .order('started_at', { ascending: true }),
      admin
        .from('loto_hot_work_permits')
        .select('id, serial, work_location, started_at, expires_at, canceled_at, cancel_reason, work_completed_at, pai_signature_at')
        .gte('started_at', startTs)
        .lte('started_at', endTs)
        .order('started_at', { ascending: true }),
    ])
    if (csRes.error) throw new Error(`CS permits: ${csRes.error.message}`)
    if (hwRes.error) throw new Error(`hot-work permits: ${hwRes.error.message}`)

    const csPermits: InspectorCsPermit[] = ((csRes.data ?? []) as Array<Pick<ConfinedSpacePermit,
      'id' | 'serial' | 'space_id' | 'started_at' | 'expires_at' | 'canceled_at' | 'cancel_reason' | 'entry_supervisor_signature_at'>>).map(p => ({
        id:           p.id,
        serial:       p.serial,
        spaceId:      p.space_id,
        startedAt:    p.started_at,
        expiresAt:    p.expires_at,
        status:       csStatusFor(p as ConfinedSpacePermit),
        cancelReason: p.cancel_reason,
        cancelDate:   p.canceled_at,
      }))

    const hotWorkPermits: InspectorHotWorkPermit[] = ((hwRes.data ?? []) as Array<Pick<HotWorkPermit,
      'id' | 'serial' | 'work_location' | 'started_at' | 'expires_at' | 'canceled_at' | 'cancel_reason' | 'work_completed_at' | 'pai_signature_at'>>).map(p => ({
        id:           p.id,
        serial:       p.serial,
        workLocation: p.work_location,
        startedAt:    p.started_at,
        expiresAt:    p.expires_at,
        status:       hotWorkStatusLabel(p as HotWorkPermit),
        cancelReason: p.cancel_reason,
        cancelDate:   p.canceled_at,
      }))

    return NextResponse.json({
      window: {
        start: rest.start,
        end:   rest.end,
        label: rest.label,
        exp:   rest.exp,
      },
      csPermits,
      hotWorkPermits,
    })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/inspector/lookup' } })
    console.error('[inspector/lookup]', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Lookup failed' }, { status: 500 })
  }
}
