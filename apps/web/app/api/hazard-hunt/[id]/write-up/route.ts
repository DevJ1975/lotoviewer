import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { requireTenantAdmin, requireTenantModuleMember } from '@/lib/auth/tenantGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { runHazardHuntWriteUp } from '@/lib/hazardHunt/runWriteUp'
import { ingestPolicyDocument, tenantStagingPrefix } from '@/lib/ai/ingestPolicy'
import type { Citation, CspRecommendation } from '@/lib/hazardHunt/agents/schemas'

// Routes for the CSP write-up of a Hazard Hunt inspection ([id] = inspection id).
//   GET   — read the write-up (module members).
//   POST  — (re)generate the draft via the CSP agent (admins).
//   PATCH — finalize: flip status='final' and ingest the write-up into the
//           knowledge base so the assistant can cite it (admins).

export const runtime = 'nodejs'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface WriteUpRow {
  id:                    string
  inspection_id:         string
  status:                'draft' | 'final'
  summary:               string | null
  citations:             Citation[] | null
  recommendations:       CspRecommendation[] | null
  knowledge_document_id: string | null
  model:                 string | null
  updated_at:            string
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireTenantModuleMember(req, 'inspections')
  if (!g.ok) return NextResponse.json({ error: g.message }, { status: g.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  const { data, error } = await g.authedClient
    .from('hazard_hunt_write_ups')
    .select('id, inspection_id, status, summary, citations, recommendations, knowledge_document_id, model, updated_at')
    .eq('inspection_id', id)
    .maybeSingle<WriteUpRow>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ writeUp: data })
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  // Synchronous here (unlike the submit hook) so the admin gets the fresh draft.
  await runHazardHuntWriteUp({ tenantId: gate.tenantId, inspectionId: id, userId: gate.userId })

  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('hazard_hunt_write_ups')
    .select('id, inspection_id, status, summary, citations, recommendations, knowledge_document_id, model, updated_at')
    .eq('tenant_id', gate.tenantId)
    .eq('inspection_id', id)
    .maybeSingle<WriteUpRow>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'write_up_unavailable' }, { status: 502 })
  return NextResponse.json({ writeUp: data })
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireTenantAdmin(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })
  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'invalid_id' }, { status: 400 })

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid_json' }, { status: 400 }) }
  if (body.action !== 'finalize') return NextResponse.json({ error: 'unsupported_action' }, { status: 400 })

  const admin = supabaseAdmin()
  const { data: writeUp, error: loadErr } = await admin
    .from('hazard_hunt_write_ups')
    .select('id, inspection_id, status, summary, citations, recommendations, knowledge_document_id, model, updated_at')
    .eq('tenant_id', gate.tenantId)
    .eq('inspection_id', id)
    .maybeSingle<WriteUpRow>()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!writeUp) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  // Ingest into the knowledge base so the assistant can cite it. Best-effort: a
  // KB failure must not block finalizing the write-up itself.
  let knowledgeDocumentId = writeUp.knowledge_document_id
  let kbWarning: string | null = null
  try {
    const markdown = renderWriteUpMarkdown(writeUp)
    const storagePath = `${tenantStagingPrefix(gate.tenantId)}hazard-hunt-${id}.md`
    const up = await admin.storage.from('policy-uploads').upload(
      storagePath, new Blob([markdown], { type: 'text/markdown' }),
      { contentType: 'text/markdown', upsert: true },
    )
    if (up.error) throw new Error(up.error.message)
    const outcome = await ingestPolicyDocument({
      storagePath, tenantId: gate.tenantId, sourceType: 'company_policy',
      title: `Hazard Hunt write-up — ${id}`, mime: 'text/markdown',
      userId: gate.userId, route: 'hazard-hunt/write-up/finalize',
    })
    const docId = (outcome.body as { document_id?: string }).document_id
    if (outcome.status >= 400 || !docId) {
      kbWarning = `Knowledge-base ingestion skipped (status ${outcome.status}).`
    } else {
      knowledgeDocumentId = docId
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'hazard-hunt/write-up/finalize', stage: 'kb-ingest' } })
    kbWarning = e instanceof Error ? e.message : 'Knowledge-base ingestion failed.'
  }

  const { data: updated, error: updErr } = await admin
    .from('hazard_hunt_write_ups')
    .update({ status: 'final', knowledge_document_id: knowledgeDocumentId, updated_at: new Date().toISOString() })
    .eq('id', writeUp.id)
    .eq('tenant_id', gate.tenantId)
    .select('id, inspection_id, status, summary, citations, recommendations, knowledge_document_id, model, updated_at')
    .single()
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ writeUp: updated, kbWarning })
}

// Renders the structured write-up to markdown for knowledge-base ingestion.
function renderWriteUpMarkdown(w: WriteUpRow): string {
  const lines: string[] = ['# Hazard Hunt Write-up', '']
  if (w.summary) lines.push('## Summary', '', w.summary, '')
  const citations = w.citations ?? []
  if (citations.length) {
    lines.push('## Regulatory citations', '')
    for (const c of citations) lines.push(`- **${c.code}** (${c.severity}): ${c.text}`)
    lines.push('')
  }
  const recs = w.recommendations ?? []
  if (recs.length) {
    lines.push('## Recommended corrective actions', '')
    for (const r of recs) lines.push(`- [${r.hierarchy_level}] ${r.item} (finding: ${r.finding_ref})`)
    lines.push('')
  }
  return lines.join('\n')
}
