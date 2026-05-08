import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadChannelMembership } from '@/lib/chat/membership'

// GET /api/chat/attachments/[attId]/url
// Returns a short-lived signed URL for the attachment's storage
// object. The chat-attachments bucket is private (no public CDN), so
// the client cannot fetch the bytes without this signature. Access is
// gated on channel membership: only members of the channel the
// attachment is bound to can sign for it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_URL_TTL_SECONDS = 60 * 10  // 10 minutes is plenty for inline render

interface RouteContext { params: Promise<{ attId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { attId } = await ctx.params
  if (!UUID_RE.test(attId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: att } = await admin
      .from('chat_message_attachments')
      .select('id, tenant_id, message_id, storage_path, uploaded_by')
      .eq('id', attId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const a = att as { id: string; tenant_id: string; message_id: string | null; storage_path: string; uploaded_by: string } | null
    if (!a) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

    // Two access paths:
    //   - The uploader can always sign (so they can preview before
    //     sending the message — message_id is still null).
    //   - Anyone else needs membership in the channel the attachment
    //     belongs to. message_id has to be set, so look up the parent.
    if (a.uploaded_by !== gate.userId) {
      if (!a.message_id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const { data: msg } = await admin
        .from('chat_messages')
        .select('channel_id')
        .eq('id', a.message_id)
        .eq('tenant_id', gate.tenantId)
        .maybeSingle()
      const channelId = (msg as { channel_id: string } | null)?.channel_id
      if (!channelId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      const me = await loadChannelMembership(admin, channelId, gate.userId, gate.tenantId)
      if (!me && gate.role !== 'superadmin') {
        return NextResponse.json({ error: 'Not a member of this channel.' }, { status: 403 })
      }
    }

    const { data: signed, error } = await admin
      .storage
      .from('chat-attachments')
      .createSignedUrl(a.storage_path, SIGNED_URL_TTL_SECONDS)
    if (error || !signed?.signedUrl) {
      Sentry.captureException(error ?? new Error('signed-url empty'), {
        tags: { route: 'chat-attachment-url/GET', stage: 'sign' },
      })
      return NextResponse.json({ error: error?.message ?? 'Failed to sign URL' }, { status: 500 })
    }

    return NextResponse.json({
      url:      signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'chat-attachment-url/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
