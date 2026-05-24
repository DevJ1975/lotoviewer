import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { recordSuppression } from '@/lib/email/suppression'
import { verifyUnsubscribeToken } from '@/lib/email/unsubscribe'

// Public unsubscribe endpoint for the List-Unsubscribe header (RFC 8058).
//
// GET  — a human clicking the link. We DON'T mutate on GET (mailbox link
//        scanners pre-fetch URLs and would otherwise opt people out by
//        accident); instead we render a one-button confirmation page that
//        POSTs back with the same token.
// POST — performs the opt-out. Serves both the confirmation form and the
//        provider's automated one-click POST (body List-Unsubscribe=One-Click,
//        which we don't need to read — the signed token is the authority).

export const runtime = 'nodejs'

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="robots" content="noindex"><title>${title}</title></head>`
    + `<body style="margin:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a2230;">`
    + `<div style="max-width:480px;margin:64px auto;padding:32px 28px;background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(15,23,42,0.08);text-align:center;">`
    + body
    + `</div></body></html>`
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })
}

function tokenFrom(req: Request): string {
  return new URL(req.url).searchParams.get('token') ?? ''
}

// Human-readable name for the stream a token opts out of.
function categoryLabel(category: string): string {
  if (category === 'weekly_digest') return "SoteriaField's weekly digest emails"
  if (category === 'reminders')     return "SoteriaField's reminder emails"
  return 'these SoteriaField emails'
}

export function GET(req: Request): Response {
  const token = tokenFrom(req)
  const payload = verifyUnsubscribeToken(token)
  if (!payload) {
    return page('Unsubscribe', `<h1 style="font-size:18px;margin:0 0 8px;">Link expired or invalid</h1>`
      + `<p style="font-size:14px;color:#5b6675;margin:0;">This unsubscribe link could not be verified. If you keep receiving unwanted emails, reply to one and we'll remove you.</p>`, 400)
  }
  const safeEmail = payload.email.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return page('Unsubscribe',
    `<h1 style="font-size:18px;margin:0 0 8px;">Unsubscribe?</h1>`
    + `<p style="font-size:14px;color:#5b6675;margin:0 0 20px;">${safeEmail} will stop receiving ${categoryLabel(payload.category)}. Transactional messages (invites, alerts) are unaffected.</p>`
    + `<form method="post" action="/api/email/unsubscribe?token=${encodeURIComponent(token)}">`
    + `<button type="submit" style="background:#1D3ECF;color:#fff;border:0;border-radius:10px;font-size:15px;font-weight:700;padding:12px 24px;cursor:pointer;">Confirm unsubscribe</button>`
    + `</form>`)
}

export async function POST(req: Request): Promise<Response> {
  const payload = verifyUnsubscribeToken(tokenFrom(req))
  if (!payload) {
    return page('Unsubscribe', `<h1 style="font-size:18px;margin:0 0 8px;">Link expired or invalid</h1>`
      + `<p style="font-size:14px;color:#5b6675;margin:0;">This unsubscribe link could not be verified.</p>`, 400)
  }
  await recordSuppression(supabaseAdmin(), payload.email, payload.category, 'user')
  return page('Unsubscribed', `<h1 style="font-size:18px;margin:0 0 8px;">You're unsubscribed</h1>`
    + `<p style="font-size:14px;color:#5b6675;margin:0;">You won't receive any more ${categoryLabel(payload.category)} at this address. You'll still get transactional messages like invites and incident alerts.</p>`)
}
