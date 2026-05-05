import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireSuperadmin } from '@/lib/auth/superadmin'

// GET /api/support/conversations/[id] — superadmin-only conversation
// transcript. Used by the triage page to expand a ticket and read the
// full back-and-forth that led to it.
//
// Returns the conversation row + every message in chronological order.
// Tool/system rows are included so the transcript matches what the
// support email body shows.

export const runtime = 'nodejs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  }

  const admin = supabaseAdmin()
  const [{ data: conv }, { data: msgs }] = await Promise.all([
    admin
      .from('support_conversations')
      .select('id, user_id, tenant_id, origin_path, started_at, last_message_at, resolved')
      .eq('id', id)
      .maybeSingle(),
    admin
      .from('support_messages')
      .select('id, role, content, input_tokens, output_tokens, cache_read_tokens, created_at')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true }),
  ])
  if (!conv) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })
  }
  return NextResponse.json({
    conversation: conv,
    messages:     msgs ?? [],
  })
}
