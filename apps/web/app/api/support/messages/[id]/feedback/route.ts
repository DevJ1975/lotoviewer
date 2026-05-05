import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST   /api/support/messages/[id]/feedback  body: { helpful: boolean }
// DELETE /api/support/messages/[id]/feedback
//
// Records or clears a per-assistant-turn 👍/👎 vote. Only the
// conversation owner may write — RLS enforces this AND the route
// re-checks against the auth session so a forged x-user-id header
// can't bypass.
//
// Lightweight: no rate-limit beyond what RLS gives us — feedback is
// idempotent (toggling the same vote is a no-op write) and requires a
// valid session.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authedUserId(authHeader: string | null): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null
  const token = authHeader.slice('Bearer '.length)
  const url  = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return null
  const userClient = createClient(url, anon, { auth: { persistSession: false } })
  const { data: { user }, error } = await userClient.auth.getUser(token)
  if (error || !user) return null
  return user.id
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) return NextResponse.json({ error: 'Sign in to leave feedback.' }, { status: 401 })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid message id' }, { status: 400 })

  let body: { helpful?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  if (typeof body.helpful !== 'boolean') {
    return NextResponse.json({ error: '"helpful" must be a boolean' }, { status: 400 })
  }

  return updateHelpful(id, userId, body.helpful)
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const userId = await authedUserId(req.headers.get('authorization'))
  if (!userId) return NextResponse.json({ error: 'Sign in to leave feedback.' }, { status: 401 })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid message id' }, { status: 400 })

  return updateHelpful(id, userId, null)
}

async function updateHelpful(messageId: string, userId: string, helpful: boolean | null) {
  const admin = supabaseAdmin()

  // Verify the message belongs to a conversation the caller owns AND
  // the message is an assistant turn (only those can be voted on).
  const { data: msg } = await admin
    .from('support_messages')
    .select('id, role, conversation_id, support_conversations!inner(user_id)')
    .eq('id', messageId)
    .maybeSingle()
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  type Joined = { role: string; support_conversations: { user_id: string } | { user_id: string }[] }
  const conv = (msg as unknown as Joined).support_conversations
  const ownerId = Array.isArray(conv) ? conv[0]?.user_id : conv?.user_id
  if (ownerId !== userId) {
    return NextResponse.json({ error: 'Message not found' }, { status: 404 })
  }
  if ((msg as unknown as Joined).role !== 'assistant') {
    return NextResponse.json({ error: 'Only assistant turns can receive feedback.' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('support_messages')
    .update({
      helpful,
      helpful_at: helpful === null ? null : new Date().toISOString(),
    })
    .eq('id', messageId)
    .select('id, helpful, helpful_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
