import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireStrikeMember } from '@/lib/strike/gate'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { resolveMemberIdForUser } from '@/lib/strike/attempts'
import { emailCertificate, parseCertificateRecipient, renderCertificate } from '@/lib/strike/certificateDelivery'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// A signed-in learner's completion certificate.
//   GET  ?attempt=<id>               the PDF
//   POST { attempt_id, to }          emailed to any address they choose
// Only the learner's own completion can be fetched or sent.
export async function GET(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const attemptId = new URL(req.url).searchParams.get('attempt') ?? ''
  if (!UUID_RE.test(attemptId)) return NextResponse.json({ error: 'Invalid attempt id' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const learner = { tenantId: gate.tenantId, userId: gate.userId, memberId: await resolveMemberIdForUser(admin, gate.tenantId, gate.userId) }
    const result = await renderCertificate(admin, learner, attemptId)
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
    return new Response(Buffer.from(result.value.pdf), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${result.value.filename}"`,
        'cache-control': 'private, no-store',
      },
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/certificate', method: 'GET' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  const gate = await requireStrikeMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  // Each send is an email to an address the learner typed; keep it to a handful.
  const limit = checkMemoryRateLimit(`strike-certificate-email:${gate.userId}`, 5, 60 * 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'You’ve sent several already. Try again later.' }, { status: 429 })

  let body: { attempt_id?: unknown; to?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const attemptId = typeof body.attempt_id === 'string' && UUID_RE.test(body.attempt_id) ? body.attempt_id : null
  const to = parseCertificateRecipient(body.to)
  if (!attemptId) return NextResponse.json({ error: 'Invalid attempt id' }, { status: 400 })
  if (!to) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })

  try {
    const admin = supabaseAdmin()
    const learner = { tenantId: gate.tenantId, userId: gate.userId, memberId: await resolveMemberIdForUser(admin, gate.tenantId, gate.userId) }
    const result = await emailCertificate(admin, learner, attemptId, to)
    return result.ok ? NextResponse.json(result.value) : NextResponse.json({ error: result.message }, { status: result.status })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/certificate', method: 'POST' } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
