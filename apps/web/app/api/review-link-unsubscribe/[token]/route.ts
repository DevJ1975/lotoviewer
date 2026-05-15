import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Public one-click unsubscribe endpoint for review-link emails.
// Referenced by the `List-Unsubscribe` header in sendReviewLinkEmail
// (RFC 2369 / RFC 8058). Gmail and Yahoo now require a working
// one-click unsubscribe on bulk-ish mail; without it deliverability
// drops and messages land in spam.
//
// Auth model: the URL token is the credential, mirroring the public
// review-portal route. Unknown / already-revoked / malformed tokens
// all return 200 so we don't leak link existence to scanners.
//
// RFC 8058 mandates POST with body `List-Unsubscribe=One-Click`.
// We also accept GET for human-typed URLs and mailto-style fallbacks;
// it does the same revoke and returns a tiny plain-text confirmation.

const TOKEN_RE = /^[0-9a-f]{32}$/

async function revokeByToken(token: string): Promise<void> {
  if (!TOKEN_RE.test(token)) return

  const admin = supabaseAdmin()
  const { error } = await admin
    .from('loto_review_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token', token)
    .is('revoked_at', null)
  if (error) {
    Sentry.captureException(error, { tags: { route: 'review-link-unsubscribe', stage: 'revoke' } })
  }
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  await revokeByToken(token)
  return new NextResponse(null, { status: 200 })
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  await revokeByToken(token)
  return new NextResponse(
    'You have been unsubscribed from this review request. You can close this window.',
    { status: 200, headers: { 'content-type': 'text/plain; charset=utf-8' } },
  )
}
