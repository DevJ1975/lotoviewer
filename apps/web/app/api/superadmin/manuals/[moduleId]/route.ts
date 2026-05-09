import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireSuperadmin } from '@/lib/auth/superadmin'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncManualToRagSafe, type ManualForSync } from '@/lib/ai/syncManualToRag'

// PATCH  /api/superadmin/manuals/[moduleId]
//   Edit body / title / summary / publish state. Calls the
//   update_manual() RPC so the trigger picks up the optional
//   change_note via SET LOCAL.
//
// DELETE /api/superadmin/manuals/[moduleId]
//   Soft-delete by clearing published_at. We never hard-delete so
//   the changelog stays intact for audit.

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/

interface RouteContext { params: Promise<{ moduleId: string }> }

export async function PATCH(req: Request, ctx: RouteContext) {
  const { moduleId } = await ctx.params
  if (!SLUG_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 })

  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: {
    title?: string; summary?: string | null; body_md?: string;
    published_at?: string | null;
    publish?: boolean;     // shorthand: true → set published_at = now if currently NULL
    unpublish?: boolean;   // shorthand: true → clear published_at
    change_note?: string;
  }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (t.length < 1 || t.length > 200) return NextResponse.json({ error: 'title must be 1-200 chars' }, { status: 400 })
  }

  // Resolve publish state: explicit published_at wins, then publish/unpublish flags.
  let pPublishedAt: string | null = null
  let pClearPublished = false
  if (body.unpublish === true) {
    pClearPublished = true
  } else if (body.publish === true) {
    pPublishedAt = new Date().toISOString()
  } else if (typeof body.published_at === 'string') {
    pPublishedAt = body.published_at
  } else if (body.published_at === null) {
    pClearPublished = true
  }

  try {
    const admin = supabaseAdmin()
    const { data, error } = await admin.rpc('update_manual', {
      p_module_id:        moduleId,
      p_title:            typeof body.title === 'string' ? body.title.trim() : null,
      p_summary:          'summary' in body ? (body.summary?.toString().trim() || null) : null,
      p_summary_set:      'summary' in body,
      p_body_md:          typeof body.body_md === 'string' ? body.body_md : null,
      p_published_at:     pPublishedAt,
      p_clear_published:  pClearPublished,
      p_updated_by:       gate.userId,
      p_change_note:      typeof body.change_note === 'string' ? body.change_note.trim() : null,
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'superadmin-manuals/[id]/PATCH' } })
      const status = /not found/i.test(error.message) ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    // RAG sync. update_manual returns the row shape we need; treat the
    // sync as best-effort so a Voyage outage or ingestion error never
    // blocks the manual save itself. The bulk sync endpoint is the
    // operator's recovery path.
    const ragOutcome = await syncManualToRagSafe(data as ManualForSync)

    return NextResponse.json({ manual: data, rag: ragOutcome })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin-manuals/[id]/PATCH' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: RouteContext) {
  const { moduleId } = await ctx.params
  if (!SLUG_RE.test(moduleId)) return NextResponse.json({ error: 'Invalid moduleId' }, { status: 400 })

  const gate = await requireSuperadmin(req.headers.get('authorization'))
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  try {
    const admin = supabaseAdmin()
    // Soft-delete by unpublishing. update_manual handles the trigger.
    const { error } = await admin.rpc('update_manual', {
      p_module_id:        moduleId,
      p_title:            null,
      p_summary:          null,
      p_summary_set:      false,
      p_body_md:          null,
      p_published_at:     null,
      p_clear_published:  true,
      p_updated_by:       gate.userId,
      p_change_note:      'Unpublished by superadmin',
    })
    if (error) {
      Sentry.captureException(error, { tags: { route: 'superadmin-manuals/[id]/DELETE' } })
      const status = /not found/i.test(error.message) ? 404 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    // Unpublish removes the manual from RAG. Best-effort.
    await syncManualToRagSafe({
      id:           '',           // not used on the unpublish path
      module_id:    moduleId,
      title:        '',
      summary:      null,
      body_md:      '',
      published_at: null,         // forces the 'removed' branch
      version:      0,
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'superadmin-manuals/[id]/DELETE' } })
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
