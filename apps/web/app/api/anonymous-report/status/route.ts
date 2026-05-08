import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { clientIp, hashIp, isOverIpLimit, recordAttempt } from '@/lib/anonReport/ipThrottle'
import { hashReceipt, isValidPinFormat } from '@/lib/anonReport/receipt'

// PUBLIC POST /api/anonymous-report/status
//
// Body: { report_number: string, pin: string }
//
// Looks up an anonymous incident by (report_number, hashed PIN)
// and returns ONLY public-safe fields:
//   - status (open / investigating / closed)
//   - submitted date
//   - any anon_public_status_note the safety team published
//
// Never returns: description, location, names, attachments. Those
// would defeat the anonymity guarantee if the PIN-holder isn't the
// original reporter (e.g. if the worker wrote the PIN on a
// breakroom whiteboard).
//
// IP throttle applies. PIN format is checked before DB lookup so
// malformed input doesn't hit the database.

interface PostBody {
  report_number?: string
  pin?:           string
}

const REPORT_NO_RE = /^[A-Z]{2,5}-\d{3,8}$/i

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
  catch {
    void recordAttempt(ipHash, 'receipt_invalid')
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const reportNumber = (body.report_number ?? '').trim()
  const pin          = (body.pin          ?? '').trim()

  if (!REPORT_NO_RE.test(reportNumber) || !isValidPinFormat(pin)) {
    void recordAttempt(ipHash, 'receipt_invalid')
    // Generic message — same response for malformed and not-found,
    // so a probe can't distinguish "no such report" from "bad PIN".
    return NextResponse.json({ error: 'No report matches that code.' }, { status: 404 })
  }

  try {
    const admin = supabaseAdmin()
    const hash = hashReceipt(reportNumber, pin)
    const { data, error } = await admin
      .from('incidents')
      .select('id, status, reported_at, anon_public_status_note')
      .eq('report_number', reportNumber)
      .eq('anon_receipt_hash', hash)
      .eq('is_anonymous', true)
      .maybeSingle()
    if (error) {
      Sentry.captureException(error, { tags: { route: 'anonymous-report/status' } })
      return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
    }
    if (!data) {
      void recordAttempt(ipHash, 'receipt_invalid')
      return NextResponse.json({ error: 'No report matches that code.' }, { status: 404 })
    }
    const r = data as unknown as { id: string; status: string; reported_at: string; anon_public_status_note: string | null }
    void recordAttempt(ipHash, 'receipt_ok')
    return NextResponse.json({
      status:        r.status,
      submitted_at:  r.reported_at,
      public_note:   r.anon_public_status_note,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'anonymous-report/status' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
