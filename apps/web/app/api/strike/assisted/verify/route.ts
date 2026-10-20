import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { verifyPngDataUrl } from '@/lib/security/magicBytes'
import { verifyAssistedAttempt } from '@/lib/strike/assisted'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNATURE_MAX_BYTES = 200_000

// POST /api/strike/assisted/verify — a supervisor signs off an assisted
// (ADA) session on the worker's device. The request carries the
// supervisor's own access token, never the worker's, so the record names who
// signed. Any member who can edit (not a viewer) may sign, as with "Train
// now" links: the supervisor at the line is usually not a tenant admin.
export async function POST(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  if (gate.role === 'viewer') return NextResponse.json({ error: 'View-only accounts can’t sign off training.' }, { status: 403 })

  const limit = checkMemoryRateLimit(`strike-assisted-verify:${gate.userId}`, 20, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests. Try again in a minute.' }, { status: 429 })

  let body: { attempt_id?: unknown; checked?: unknown; signature_png?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const attemptId = typeof body.attempt_id === 'string' && UUID_RE.test(body.attempt_id) ? body.attempt_id : null
  const checked = Array.isArray(body.checked) && body.checked.length <= 50 && body.checked.every(k => typeof k === 'string' && k.length <= 100)
    ? body.checked as string[]
    : null
  const signature = typeof body.signature_png === 'string' ? body.signature_png : ''
  if (!attemptId || !checked) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  if (signature.length > SIGNATURE_MAX_BYTES) return NextResponse.json({ error: 'The signature image is too large.' }, { status: 413 })
  if (verifyPngDataUrl(signature) !== null) return NextResponse.json({ error: 'Draw a signature before signing.' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const { data: profile, error } = await admin.from('profiles').select('full_name').eq('id', gate.userId).maybeSingle()
    if (error) throw new Error(error.message)
    const result = await verifyAssistedAttempt(admin, {
      tenantId: gate.tenantId,
      userId: gate.userId,
      name: (profile?.full_name as string | null) || gate.userEmail || 'Supervisor',
    }, { attemptId, checkedKeys: checked, signaturePng: signature })
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return NextResponse.json({ completion_id: result.value.completionId, signed_at: result.value.signedAt }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/assisted/verify' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
