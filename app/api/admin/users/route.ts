import { NextResponse } from 'next/server'
import { supabaseAdmin, generateTempPassword } from '@/lib/supabaseAdmin'
import { createClient } from '@supabase/supabase-js'
import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'

// Verify the caller's JWT and confirm they're an admin before doing anything.
// The JWT comes from the browser's supabase client in an Authorization header.
async function requireAdmin(authHeader: string | null): Promise<{ ok: true; userId: string } | { ok: false; status: number; message: string }> {
  if (!authHeader?.startsWith('Bearer ')) return { ok: false, status: 401, message: 'Missing bearer token' }
  const token = authHeader.slice('Bearer '.length)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return { ok: false, status: 401, message: 'Invalid session' }

  const admin = supabaseAdmin()
  const { data: profile } = await admin
    .from('profiles')
    .select('is_admin')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.is_admin) return { ok: false, status: 403, message: 'Admin only' }

  return { ok: true, userId: user.id }
}

// POST /api/admin/users  { email, fullName? }
// Creates an auth user with a random temp password, patches the profiles
// row, and emails the invite to the new user via Resend. Returns
// { email, fullName, tempPassword, emailSent } — the UI shows a clean
// "✓ invite emailed" state on success and falls back to the copy-paste
// template when emailSent=false (Resend not configured / send failed).
export async function POST(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: { email?: unknown; fullName?: unknown }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const admin    = supabaseAdmin()
  const tempPw   = generateTempPassword()

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password: tempPw,
    email_confirm: true,   // skip the Supabase-managed confirmation email
    user_metadata: fullName ? { full_name: fullName } : undefined,
  })
  if (createErr || !created.user) {
    return NextResponse.json({ error: createErr?.message ?? 'Could not create user' }, { status: 400 })
  }

  // handle_new_user() trigger already inserted the profiles row; patch it
  // with the supplied name and make sure must_change_password is true.
  const { error: profErr } = await admin
    .from('profiles')
    .update({
      full_name: fullName || null,
      must_change_password: true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', created.user.id)
  if (profErr) {
    // Best-effort rollback so we don't leave a half-created user behind.
    await admin.auth.admin.deleteUser(created.user.id)
    return NextResponse.json({ error: profErr.message }, { status: 400 })
  }

  // Send the invite email. We deliberately don't fail the whole request
  // if the email send fails — the user IS created, and the UI shows the
  // copy-paste fallback so the admin can email manually. That's the same
  // posture as the bug-report route: the create succeeds, email is best
  // effort with a clear emailSent flag back to the caller.
  const loginUrl = computeLoginUrl(req)
  const emailSent = await sendInviteEmail({
    to:           email,
    fullName,
    tempPassword: tempPw,
    loginUrl,
  })

  return NextResponse.json({ email, fullName, tempPassword: tempPw, emailSent })
}

// Pick the public origin to put in the invite email. Order:
//   1. NEXT_PUBLIC_APP_URL env (set this in Vercel for branded links)
//   2. The request's Origin / Host header (works for any deploy)
//   3. Falls back to a generic placeholder if neither is available
function computeLoginUrl(req: Request): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL?.trim()
  if (envUrl) return envUrl.replace(/\/$/, '')
  const origin = req.headers.get('origin')
  if (origin) return origin.replace(/\/$/, '')
  const host = req.headers.get('host')
  if (host) return `https://${host}`
  return 'https://soteriafield.app'
}

interface InviteEmailArgs {
  to:           string
  fullName:     string
  tempPassword: string
  loginUrl:     string
}

async function sendInviteEmail(args: InviteEmailArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[admin-invite] RESEND_API_KEY not set — skipping email send')
    return false
  }

  // Resend "from" precedence:
  //   INVITE_FROM_EMAIL  — preferred, set once Soteria's domain is verified
  //   SUPPORT_FROM_EMAIL — falls back to the bug-report sender
  //   onboarding@resend.dev — Resend's test sender (works without DNS)
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'Soteria FIELD <onboarding@resend.dev>'

  const displayName = args.fullName || args.to.split('@')[0]
  const subject = "You're invited to Soteria FIELD"

  const text = renderInviteText({ displayName, ...args })
  const html = renderInviteHtml({ displayName, ...args })

  try {
    const resend = new Resend(apiKey)
    const { error } = await resend.emails.send({
      from,
      to:      args.to,
      subject,
      text,
      html,
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: '/api/admin/users', stage: 'resend' } })
      console.error('[admin-invite] Resend rejected the send', error)
      return false
    }
    return true
  } catch (err) {
    Sentry.captureException(err, { tags: { route: '/api/admin/users', stage: 'resend' } })
    console.error('[admin-invite] send threw', err)
    return false
  }
}

function renderInviteText(a: InviteEmailArgs & { displayName: string }): string {
  return `Hi ${a.displayName},

You've been invited to Soteria FIELD — your team's safety operations app
(LOTO + Confined Space + Hot Work permits).

Sign in here:
  ${a.loginUrl}/login

Your one-time login:
  Email:     ${a.to}
  Password:  ${a.tempPassword}

On your first login you'll be asked to set a new password of your own
(at least 8 characters). The password above only works until you change
it, and you must change it on first login.

If you have any trouble signing in, just reply to this email.

— Soteria FIELD
`
}

function renderInviteHtml(a: InviteEmailArgs & { displayName: string }): string {
  // Self-contained inline-styled HTML so it renders consistently across
  // email clients (Gmail/Apple/Outlook all strip <style> blocks).
  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">Soteria FIELD</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">You're invited</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">Hi ${safe(a.displayName)},</p>
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">You've been invited to Soteria FIELD — your team's safety operations app (LOTO, Confined Space, and Hot Work permits).</p>
      <p style="margin:0 0 22px 0;font-size:15px;line-height:1.55;">Tap the button below to sign in. Your one-time password is just under it — you'll be asked to set your own password on first login.</p>
      <p style="margin:0 0 22px 0;text-align:center;">
        <a href="${safe(a.loginUrl)}/login" style="display:inline-block;background:#214488;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 24px;border-radius:10px;">Sign in to Soteria FIELD →</a>
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;border-radius:10px;border:1px solid #e6ebf2;">
        <tr><td style="padding:14px 16px;font-size:13px;font-family:ui-monospace,Menlo,Consolas,monospace;color:#1a2230;">
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">Email</div>
          <div style="margin-top:2px;">${safe(a.to)}</div>
          <div style="color:#5b6675;font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;margin-top:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">One-time password</div>
          <div style="margin-top:2px;letter-spacing:.04em;">${safe(a.tempPassword)}</div>
        </td></tr>
      </table>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        The password above only works until you change it, and you must change it on first login. Use at least 8 characters.
      </p>
      <p style="margin:18px 0 0 0;font-size:12px;line-height:1.55;color:#5b6675;">
        Trouble signing in? Just reply to this email.
      </p>
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      Sent from Soteria FIELD · <a href="${safe(a.loginUrl)}" style="color:#214488;text-decoration:none;">${safe(a.loginUrl.replace(/^https?:\/\//, ''))}</a>
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}

// GET /api/admin/users — list profiles for the admin screen.
export async function GET(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('profiles')
    .select('id, email, full_name, is_admin, must_change_password, created_at')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ users: data ?? [] })
}

// DELETE /api/admin/users?id=<uuid> — remove a user (auth + profile via cascade).
export async function DELETE(req: Request) {
  const gate = await requireAdmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (id === gate.userId) return NextResponse.json({ error: 'Cannot remove your own account' }, { status: 400 })

  const admin = supabaseAdmin()
  const { error } = await admin.auth.admin.deleteUser(id)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ ok: true })
}
