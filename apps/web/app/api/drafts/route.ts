import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aiErrorToResponse } from '@/lib/ai/client'
import { checkAiRateLimit, checkTenantBudget, logAiInvocation } from '@/lib/ai/rateLimit'
import { MODEL_BY_SURFACE } from '@/lib/ai/models'
import { isDocumentDraftKind, DOCUMENT_DRAFT_KINDS } from '@soteria/core/documentDrafts'
import { DraftGenerationError, draftDocument } from '@/lib/ai/drafts/draftDocument'

// POST /api/drafts — generate a first draft of a regulatory document.
// GET  /api/drafts — list this tenant's drafts.
//
// Admin-only. These drafts become risk assessments, method statements, JSA
// checklists, and incident reports — documents a qualified person signs — so
// generating one is an authoring action, not a read. It also matches the gate
// on /api/insights/incident-risk rather than the member-level assistant chat.
//
// Nothing here writes a live record. The draft is staged in document_drafts for
// review; accepting it goes through the target module's own reviewed POST.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SURFACE = 'draft-regulatory-document' as const
const MODEL = MODEL_BY_SURFACE[SURFACE]
const MAX_SUBJECT_LENGTH = 500
const MAX_CONTEXT_LENGTH = 4_000
const LIST_LIMIT = 50

export async function POST(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  let body: Record<string, unknown>
  try { body = await req.json() as Record<string, unknown> }
  catch { return NextResponse.json({ error: 'Expected a JSON body.' }, { status: 400 }) }

  if (!isDocumentDraftKind(body.kind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${DOCUMENT_DRAFT_KINDS.join(', ')}.` },
      { status: 400 },
    )
  }
  const subject = typeof body.subject === 'string' ? body.subject.trim() : ''
  if (subject.length === 0 || subject.length > MAX_SUBJECT_LENGTH) {
    return NextResponse.json(
      { error: `subject is required and must be at most ${MAX_SUBJECT_LENGTH} characters.` },
      { status: 400 },
    )
  }
  // Required, never inferred: a Cal/OSHA method statement and a UK RAMS are
  // different documents with different mandatory sections, and letting the
  // model guess makes that a silent assumption inside a legal document.
  const jurisdiction = typeof body.jurisdiction === 'string' ? body.jurisdiction.trim() : ''
  if (jurisdiction.length === 0) {
    return NextResponse.json(
      { error: 'jurisdiction is required — mandatory sections differ by regime.' },
      { status: 400 },
    )
  }
  const context = typeof body.context === 'string'
    ? body.context.trim().slice(0, MAX_CONTEXT_LENGTH)
    : undefined

  const budget = await checkTenantBudget({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!budget.ok) {
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'budget_blocked' })
    return NextResponse.json({ error: budget.message }, { status: 429 })
  }
  const limit = await checkAiRateLimit({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE })
  if (!limit.ok) {
    return NextResponse.json(
      { error: `AI rate limit reached (${limit.reason}). Try again later.` },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSec) } },
    )
  }

  try {
    const outcome = await draftDocument(supabaseAdmin(), {
      tenantId:   gate.tenantId,
      userId:     gate.userId,
      kind:       body.kind,
      subject,
      jurisdiction,
      context,
    })
    return NextResponse.json({ ok: true, ...outcome })
  } catch (err) {
    if (err instanceof DraftGenerationError) {
      await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error', context: err.message })
      return NextResponse.json({ error: err.message }, { status: 502 })
    }
    const mapped = aiErrorToResponse(err, SURFACE)
    Sentry.captureException(err, { tags: { ...mapped.tags, route: 'drafts' } })
    await logAiInvocation({ userId: gate.userId, tenantId: gate.tenantId, surface: SURFACE, model: MODEL, status: 'error' })
    return NextResponse.json(mapped.body, { status: mapped.status })
  }
}

export async function GET(req: Request) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const status = url.searchParams.get('status')

  let query = supabaseAdmin()
    .from('document_drafts')
    .select('id, kind, title, jurisdiction, status, fabricated_citation_count, citation_chunk_ids, model, created_at, accepted_at')
    .eq('tenant_id', gate.tenantId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)

  if (kind !== null && isDocumentDraftKind(kind)) query = query.eq('kind', kind)
  if (status === 'draft' || status === 'accepted' || status === 'discarded') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ drafts: data ?? [] })
}
