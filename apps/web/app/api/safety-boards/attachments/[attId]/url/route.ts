import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/safety-boards/attachments/[attId]/url
//
// Returns a short-lived signed URL for the attachment's storage
// object. Bucket is private. Access rules:
//   - Uploader can always sign (preview before send, target_id still null).
//   - Otherwise: the attachment must be claimed by a (still-live)
//     thread or reply in the caller's active tenant.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SIGNED_URL_TTL_SECONDS = 60 * 10

interface RouteContext { params: Promise<{ attId: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const { attId } = await ctx.params
  if (!UUID_RE.test(attId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    const { data: att } = await admin
      .from('safety_board_attachments')
      .select('id, tenant_id, target_type, target_id, storage_path, uploaded_by')
      .eq('id', attId)
      .eq('tenant_id', gate.tenantId)
      .maybeSingle()
    const a = att as { id: string; tenant_id: string; target_type: 'thread' | 'reply' | null; target_id: string | null; storage_path: string; uploaded_by: string } | null
    if (!a) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })

    if (a.uploaded_by !== gate.userId) {
      // Other users need a live target to view. Verify the parent
      // thread (or the parent of the reply) isn't soft-deleted.
      if (!a.target_id || !a.target_type) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      let live = false
      if (a.target_type === 'thread') {
        const { data: t } = await admin
          .from('safety_board_threads')
          .select('id, deleted_at')
          .eq('id', a.target_id)
          .eq('tenant_id', gate.tenantId)
          .maybeSingle()
        live = !!(t as { deleted_at: string | null } | null) && !(t as { deleted_at: string | null }).deleted_at
      } else {
        const { data: r } = await admin
          .from('safety_board_replies')
          .select('id, deleted_at')
          .eq('id', a.target_id)
          .eq('tenant_id', gate.tenantId)
          .maybeSingle()
        live = !!(r as { deleted_at: string | null } | null) && !(r as { deleted_at: string | null }).deleted_at
      }
      if (!live) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { data: signed, error } = await admin
      .storage
      .from('safety-board-attachments')
      .createSignedUrl(a.storage_path, SIGNED_URL_TTL_SECONDS)
    if (error || !signed?.signedUrl) {
      Sentry.captureException(error ?? new Error('signed-url empty'), {
        tags: { route: 'safety-attachment-url/GET', stage: 'sign' },
      })
      return NextResponse.json({ error: error?.message ?? 'Failed to sign URL' }, { status: 500 })
    }

    return NextResponse.json({
      url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'safety-attachment-url/GET' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
