// Parser + fanout for @-mentions across action-item comments,
// chat messages, and safety-board posts.
//
// Mention syntax accepted in body text:
//   @<handle>          where <handle> matches profiles.full_name slugged
//                      (lowercase, spaces -> '.', non-alnum stripped) OR
//                      profiles.email local-part (everything before '@')
//
// Resolution is tenant-scoped: only members of the active tenant are
// candidates, so a chat message in tenant A can't ping a user in tenant B.
//
// Performance: a body might mention the same handle twice ("@alice");
// dedupe before resolving. Empty/none returns an empty array.

import type { SupabaseClient } from '@supabase/supabase-js'

export interface MentionCandidate {
  user_id:    string
  handle:     string             // canonical lowercase token used in @-text
  full_name:  string | null
  email:      string | null
  avatar_url: string | null
}

const MENTION_RE = /@([a-z0-9._-]{2,64})/gi

export function extractMentionTokens(body: string): string[] {
  const seen = new Set<string>()
  for (const m of body.matchAll(MENTION_RE)) {
    const tok = m[1].toLowerCase()
    if (tok) seen.add(tok)
  }
  return Array.from(seen)
}

// Slug a display name into the token form (lowercase, dots between
// words, only [a-z0-9._-]). "Jane O'Doe" -> "jane.odoe".
export function slugifyHandle(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
}

export function emailLocalPart(email: string | null | undefined): string {
  if (!email) return ''
  const at = email.indexOf('@')
  return (at < 0 ? email : email.slice(0, at)).toLowerCase()
}

export interface ResolveOpts {
  client:   SupabaseClient
  tenantId: string
  tokens:   string[]
}

// Resolve raw tokens to user ids by scanning the tenant's membership
// roster. Tenant-scoping is achieved through the membership join, NOT
// just RLS — RLS already restricts the query but the explicit
// .eq('tenant_id') is belt-and-suspenders.
//
// Returns at most one candidate per token. Ambiguous handles (two
// users with the same slug) are skipped intentionally — silently
// dropping is safer than pinging the wrong person; the author can
// disambiguate by typing the email local-part instead.
export async function resolveMentions({
  client, tenantId, tokens,
}: ResolveOpts): Promise<MentionCandidate[]> {
  if (tokens.length === 0) return []

  type Row = {
    user_id: string
    profiles:
      | { email: string | null; full_name: string | null; avatar_url: string | null }
      | { email: string | null; full_name: string | null; avatar_url: string | null }[]
      | null
  }
  const { data, error } = await client
    .from('tenant_memberships')
    .select('user_id, profiles:profiles!inner(email, full_name, avatar_url)')
    .eq('tenant_id', tenantId)
  if (error || !data) return []

  // Pre-compute candidate handles per row.
  const byHandle = new Map<string, MentionCandidate[]>()
  for (const row of data as Row[]) {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
    if (!p) continue
    const handles = new Set<string>()
    const slug = slugifyHandle(p.full_name)
    if (slug) handles.add(slug)
    const local = emailLocalPart(p.email)
    if (local) handles.add(local)
    for (const h of handles) {
      const list = byHandle.get(h) ?? []
      list.push({
        user_id:    row.user_id,
        handle:     h,
        full_name:  p.full_name,
        email:      p.email,
        avatar_url: p.avatar_url,
      })
      byHandle.set(h, list)
    }
  }

  const out: MentionCandidate[] = []
  const seenUserIds = new Set<string>()
  for (const tok of tokens) {
    const matches = byHandle.get(tok) ?? []
    if (matches.length !== 1) continue   // skip ambiguous / unmatched
    const c = matches[0]
    if (seenUserIds.has(c.user_id)) continue
    seenUserIds.add(c.user_id)
    out.push(c)
  }
  return out
}
