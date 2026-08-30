import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/operator/conversations         → the caller's recent conversations
// GET /api/operator/conversations?id=<id>  → one conversation's messages
//
// Powers the Operator Console history list + transcript rehydration. Own-row:
// a user only ever reads their own conversations.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const LIST_LIMIT = 50

export async function GET(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const admin = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')

  if (id) {
    const { data: conv } = await admin
      .from('operator_conversations')
      .select('id, user_id')
      .eq('id', id)
      .maybeSingle()
    if (!conv || conv.user_id !== gate.userId) {
      return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 })
    }
    const { data: messages } = await admin
      .from('operator_messages')
      .select('id, role, content, metadata, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    return NextResponse.json({ messages: messages ?? [] })
  }

  const { data: conversations } = await admin
    .from('operator_conversations')
    .select('id, title, last_message_at')
    .eq('user_id', gate.userId)
    .eq('tenant_id', gate.tenantId)
    .order('last_message_at', { ascending: false })
    .limit(LIST_LIMIT)
  return NextResponse.json({ conversations: conversations ?? [] })
}
