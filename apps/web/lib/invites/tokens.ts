// First-party invite tokens (migration 247). Server-only — imports
// node:crypto and must run under the nodejs runtime like the rest of
// the invite API routes.
//
// The raw token is a 256-bit random value that exists only in the
// invite email (and the admin UI's copy fallback); the database stores
// its sha256 hash. Issuing a new token supersedes the user's previous
// active one, so the newest emailed link is always the one that works.

import { createHash, randomBytes } from 'node:crypto'
import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_TTL_DAYS = 14

export interface InviteTokenRow {
  id:            string
  user_id:       string
  tenant_id:     string | null
  email:         string
  expires_at:    string
  used_at:       string | null
  superseded_at: string | null
}

export type InviteTokenStatus = 'valid' | 'expired' | 'used' | 'superseded' | 'not_found'

export interface VerifiedInviteToken {
  status: InviteTokenStatus
  row:    InviteTokenRow | null
}

export function hashInviteToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  return { raw, hash: hashInviteToken(raw) }
}

export function inviteLinkTtlDays(): number {
  const parsed = Number.parseInt(process.env.INVITE_LINK_TTL_DAYS ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TTL_DAYS
}

export function buildInviteUrl(appUrl: string, rawToken: string): string {
  return `${appUrl}/accept-invite?token=${rawToken}`
}

export interface IssueInviteTokenArgs {
  userId:    string
  tenantId:  string | null
  email:     string
  /** Inviting admin; null when minted by the reminder cron. */
  createdBy: string | null
}

export type IssueInviteTokenResult =
  | { ok: true; raw: string; expiresAt: string }
  | { ok: false; error: { message: string } }

export async function issueInviteToken(
  admin: SupabaseClient,
  args: IssueInviteTokenArgs,
): Promise<IssueInviteTokenResult> {
  const { raw, hash } = generateInviteToken()
  const expiresAt = new Date(Date.now() + inviteLinkTtlDays() * 24 * 60 * 60 * 1000).toISOString()

  // Supersede first so there is never more than one active link per user.
  // A failure here is fatal for the issue (a stale older link outliving a
  // "resend" would be a lie to the admin who clicked it).
  const { error: supersedeErr } = await admin
    .from('invite_tokens')
    .update({ superseded_at: new Date().toISOString() })
    .eq('user_id', args.userId)
    .is('used_at', null)
    .is('superseded_at', null)
  if (supersedeErr) return { ok: false, error: supersedeErr }

  const { error: insertErr } = await admin
    .from('invite_tokens')
    .insert({
      user_id:    args.userId,
      tenant_id:  args.tenantId,
      email:      args.email,
      token_hash: hash,
      created_by: args.createdBy,
      expires_at: expiresAt,
    })
  if (insertErr) return { ok: false, error: insertErr }

  return { ok: true, raw, expiresAt }
}

export async function verifyInviteToken(
  admin: SupabaseClient,
  rawToken: string,
): Promise<VerifiedInviteToken> {
  const { data, error } = await admin
    .from('invite_tokens')
    .select('id, user_id, tenant_id, email, expires_at, used_at, superseded_at')
    .eq('token_hash', hashInviteToken(rawToken))
    .maybeSingle()

  // A DB error is NOT the same as a bad token, but the caller can only
  // act on a status. Surface it to Sentry so a real outage (or a missing
  // invite_tokens table in an unmigrated env) doesn't masquerade as a
  // wave of "invalid link" reports with no signal.
  if (error) {
    Sentry.captureException(error, { tags: { module: 'verifyInviteToken', stage: 'lookup' } })
    return { status: 'not_found', row: null }
  }
  if (!data) return { status: 'not_found', row: null }

  const row = data as InviteTokenRow
  if (row.used_at) return { status: 'used', row }
  if (row.superseded_at) return { status: 'superseded', row }
  if (new Date(row.expires_at).getTime() <= Date.now()) return { status: 'expired', row }
  return { status: 'valid', row }
}

/**
 * Stamp used_at, but only if it is still unset — the conditional update
 * makes double-submits benign. Returns false when the token was already
 * consumed by a concurrent request.
 */
export async function consumeInviteToken(
  admin: SupabaseClient,
  tokenId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from('invite_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', tokenId)
    .is('used_at', null)
    .select('id')
  if (error) return false
  return (data ?? []).length > 0
}
