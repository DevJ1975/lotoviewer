import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  validateBugReport,
  renderBugReportText,
  type BugReportPayload,
  type BugSeverity,
} from '@/lib/bugReport'

// POST /api/support/bug-report — receive a form submission, validate,
// and email it to the configured support address via Resend.
//
// Env vars (set in Vercel):
//   RESEND_API_KEY       — Resend project API key (required)
//   SUPPORT_EMAIL        — recipient (defaults to jamil@trainovations.com)
//   SUPPORT_FROM_EMAIL   — verified sender (defaults to onboarding@resend.dev
//                          which works without DNS setup but lands in
//                          spam unless you upgrade to a verified domain)
//
// Auth: requires a logged-in user. The reporter's email + name come
// from the auth session, never from the request body, so the form
// can't be used to spoof who the report is from.

const SEVERITY_PREFIX: Record<BugSeverity, string> = {
  critical: '[CRITICAL] ',
  high:     '[HIGH] ',
  medium:   '',
  low:      '[LOW] ',
}

async function authedReporter(authHeader: string | null): Promise<{ id: string; email: string | null; name: string | null } | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const client = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  // Pull display name from the profiles table; fall back to the email
  // local part if there's no profile row yet.
  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('full_name')
    .eq('id', user.id)
    .maybeSingle()
  return {
    id:    user.id,
    email: user.email ?? null,
    name:  profile?.full_name ?? user.email?.split('@')[0] ?? null,
  }
}

export async function POST(req: Request) {
  const reporter = await authedReporter(req.headers.get('authorization'))
  if (!reporter) {
    return NextResponse.json({ error: 'Sign in to submit a report.' }, { status: 401 })
  }

  let body: Partial<BugReportPayload>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const errors = validateBugReport(body)
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(' ') }, { status: 400 })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Email service not configured. Please email support directly.' },
      { status: 500 },
    )
  }

  const to   = process.env.SUPPORT_EMAIL      ?? 'jamil@trainovations.com'
  const from = process.env.SUPPORT_FROM_EMAIL ?? 'Soteria FIELD <onboarding@resend.dev>'

  // After validation we know the required fields are present.
  const payload = body as BugReportPayload
  const submittedAt = new Date().toISOString()
  const text = renderBugReportText({
    payload,
    reporter_email: reporter.email,
    reporter_name:  reporter.name,
    submitted_at:   submittedAt,
  })
  const subject = `${SEVERITY_PREFIX[payload.severity]}Bug report: ${payload.title.trim()}`

  // Minimal HTML — the text version is the source of truth. We just
  // give email clients with rich rendering a slightly nicer layout.
  const html = `<pre style="font-family: ui-monospace, Menlo, monospace; font-size: 13px; line-height: 1.5; white-space: pre-wrap;">${escapeHtml(text)}</pre>`

  try {
    const resend = new Resend(apiKey)
    const { data, error } = await resend.emails.send({
      from,
      to,
      subject,
      text,
      html,
      // Reply-To = the reporter's email, when present, so a quick
      // reply lands in their inbox rather than the no-reply sender.
      replyTo: reporter.email ?? undefined,
    })
    if (error) {
      console.error('[bug-report] Resend rejected the send', error)
      return NextResponse.json(
        { error: `Could not send report: ${error.message ?? 'unknown error'}` },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, id: data?.id ?? null }, { status: 200 })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/support/bug-report' } })
    console.error('[bug-report] send threw', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Could not send report.' },
      { status: 500 },
    )
  }
}

// HTML-escape anything we paste into the email body so a `<script>` in
// a description doesn't render. Belt-and-suspenders alongside the text/
// plain version most clients use.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
