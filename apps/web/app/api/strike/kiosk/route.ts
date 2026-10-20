import { NextResponse } from 'next/server'
import { createHash } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import { checkMemoryRateLimit } from '@/lib/rateLimit/memory'
import { verifyKioskToken } from '@/lib/strike/kioskToken'
import { loadKioskSession } from '@/lib/strike/kioskSession'
import {
  gradeAndRecordAttempt,
  openAttempt,
  parseBlockEvents,
  parseDelivery,
  recordBlockEvents,
  versionContent,
  type StrikeAnswerMap,
} from '@/lib/strike/attempts'
import { signStrikeContentAssets, STRIKE_ASSET_TTL_SECONDS } from '@/lib/strike/assets'
import { emailCertificate, parseCertificateRecipient, renderCertificate } from '@/lib/strike/certificateDelivery'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ACTIONS = ['bootstrap', 'start', 'events', 'assets', 'submit', 'certificate', 'email_certificate'] as const
type KioskAction = typeof ACTIONS[number]

// The no-login "Train now" player. The signed token in the body is the only
// credential (it names one tenant, member and module), so every action
// re-verifies it and then runs the same attempt lifecycle as the signed-in
// routes — the kiosk cannot grade differently.
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const token = typeof body.token === 'string' ? body.token : ''
  const action = body.action as KioskAction
  if (!token || !(ACTIONS as readonly string[]).includes(action)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const tokenKey = createHash('sha256').update(token).digest('hex').slice(0, 24)
  const limit = checkMemoryRateLimit(`strike-kiosk:${tokenKey}`, 120, 60_000)
  if (!limit.ok) return NextResponse.json({ error: 'Too many requests.' }, { status: 429 })

  let verified: ReturnType<typeof verifyKioskToken>
  try { verified = verifyKioskToken(token) }
  catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/kiosk' } })
    return NextResponse.json({ error: 'Train-now links are not configured.' }, { status: 503 })
  }
  if (!verified.ok) {
    const message = verified.reason === 'expired'
      ? 'This link has expired. Ask your supervisor for a new one.'
      : 'This link is not valid.'
    return NextResponse.json({ error: message }, { status: 401 })
  }

  try {
    const admin = supabaseAdmin()
    const session = await loadKioskSession(admin, verified.claims, typeof body.locale === 'string' ? body.locale : null)
    if (!session.ok) return NextResponse.json({ error: session.message }, { status: session.status })
    const { learner, module, version, memberName, locales } = session.value
    const attemptId = typeof body.attempt_id === 'string' && UUID_RE.test(body.attempt_id) ? body.attempt_id : null

    switch (action) {
      case 'bootstrap': {
        const { data: questions, error: qErr } = await admin
          .from('strike_quiz_questions')
          .select('id,question_type,prompt,sort_order,required,points')
          .eq('module_version_id', version.id)
          .eq('graded', true)
          .order('sort_order', { ascending: true })
        if (qErr) throw new Error(qErr.message)
        const ids = (questions ?? []).map(q => q.id as string)
        // answer_text only: the service role can read is_correct, and this
        // response goes to an unauthenticated device.
        const { data: answers, error: aErr } = ids.length > 0
          ? await admin.from('strike_quiz_answers').select('id,question_id,answer_text,sort_order').in('question_id', ids).order('sort_order')
          : { data: [], error: null }
        if (aErr) throw new Error(aErr.message)
        return NextResponse.json({
          module,
          tenant_id: learner.tenantId,
          member_name: memberName,
          locales,
          expires_at: new Date(verified.claims.expiresAt).toISOString(),
          version: { id: version.id, passing_score: version.passing_score, content: version.content, locale: version.locale },
          questions: questions ?? [],
          answers: answers ?? [],
        })
      }
      case 'start': {
        const opened = await openAttempt(admin, learner, { moduleId: module.id, version, assignmentId: null, delivery: parseDelivery(body.delivery) })
        return NextResponse.json({ attempt_id: opened.attemptId, reached: opened.reached })
      }
      case 'assets': {
        const content = versionContent(version)
        const urls = content ? await signStrikeContentAssets(admin, content) : {}
        return NextResponse.json({ urls, expires_in: STRIKE_ASSET_TTL_SECONDS, has_download: false })
      }
      case 'events': {
        const events = parseBlockEvents(body.events)
        if (!events || !attemptId) return NextResponse.json({ error: 'Send 1–50 well-formed block events.' }, { status: 400 })
        const result = await recordBlockEvents(admin, learner, { moduleId: module.id, version, attemptId, events })
        return result.ok ? NextResponse.json(result.value) : NextResponse.json({ error: result.message }, { status: result.status })
      }
      case 'submit': {
        const answers = isAnswerMap(body.answers) ? body.answers : {}
        const result = await gradeAndRecordAttempt(admin, learner, {
          moduleId: module.id, version, attemptId, assignmentId: null, answers, watch: null,
        })
        if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
        const { attemptId: recorded, ...score } = result.value
        return NextResponse.json({ attempt_id: recorded, ...score }, { status: 201 })
      }
      case 'certificate': {
        if (!attemptId) return NextResponse.json({ error: 'Invalid attempt id' }, { status: 400 })
        const result = await renderCertificate(admin, learner, attemptId)
        if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status })
        return NextResponse.json({ filename: result.value.filename, pdf_base64: Buffer.from(result.value.pdf).toString('base64') })
      }
      case 'email_certificate': {
        const to = parseCertificateRecipient(body.to)
        if (!attemptId || !to) return NextResponse.json({ error: 'Enter a valid email address.' }, { status: 400 })
        const emailLimit = checkMemoryRateLimit(`strike-kiosk-certificate:${tokenKey}`, 5, 60 * 60_000)
        if (!emailLimit.ok) return NextResponse.json({ error: 'Several were sent already. Try again later.' }, { status: 429 })
        const result = await emailCertificate(admin, learner, attemptId, to)
        return result.ok ? NextResponse.json(result.value) : NextResponse.json({ error: result.message }, { status: result.status })
      }
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'strike/kiosk', action } })
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}

function isAnswerMap(value: unknown): value is StrikeAnswerMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every(v =>
    typeof v === 'string' || typeof v === 'boolean' || (Array.isArray(v) && v.every(item => typeof item === 'string')),
  )
}
