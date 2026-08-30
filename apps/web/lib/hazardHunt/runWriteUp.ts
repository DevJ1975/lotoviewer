// Orchestrates the Certified Safety Professional write-up for a submitted Hazard
// Hunt inspection: loads the inspection + responses + findings, runs the CSP
// agent under the tenant budget + rate limit, logs the invocation, and upserts a
// DRAFT write-up. Invoked post-response via after() from the submit route — it
// never blocks the submit and never auto-publishes (finalize is a human action).

import * as Sentry from '@sentry/nextjs'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getAnthropic } from '@/lib/ai/client'
import { checkTenantBudget, checkAiRateLimit, logAiInvocation } from '@/lib/ai/rateLimit'
import type { HazardHuntFindingRow } from '@soteria/core/hazardHunt'
import { runCspWriteUpAgent, type CspInspectionContext, type CspResponseLine } from './agents/csp'

const SURFACE = 'hazard-hunt-csp' as const

export interface RunWriteUpOpts {
  tenantId:     string
  inspectionId: string
  userId:       string | null
}

export async function runHazardHuntWriteUp(opts: RunWriteUpOpts): Promise<void> {
  const admin = supabaseAdmin()
  const actor = opts.userId ?? 'hazard-hunt'

  try {
    const budget = await checkTenantBudget({ tenantId: opts.tenantId, userId: actor, surface: SURFACE })
    if (!budget.ok) return // kill-switch / budget exhausted — nothing to write up

    const limit = await checkAiRateLimit({ tenantId: opts.tenantId, userId: actor, surface: SURFACE })
    if (!limit.ok) return

    const context = await loadContext(admin, opts.tenantId, opts.inspectionId)
    if (!context) return

    const client = await getAnthropic(opts.tenantId, { timeoutMs: 120_000 })

    let out
    try {
      out = await runCspWriteUpAgent(client, context.inspection, context.responses, context.findings)
      await logAiInvocation({
        tenantId: opts.tenantId, userId: actor, surface: SURFACE, model: out.model, status: 'success',
        inputTokens:     out.usage?.input_tokens,
        outputTokens:    out.usage?.output_tokens,
        cacheReadTokens: out.usage?.cache_read_input_tokens ?? undefined,
      })
    } catch (err) {
      await logAiInvocation({
        tenantId: opts.tenantId, userId: actor, surface: SURFACE, model: '(error)', status: 'error',
        context: err instanceof Error ? err.message.slice(0, 200) : undefined,
      })
      throw err
    }

    const { error: upErr } = await admin
      .from('hazard_hunt_write_ups')
      .upsert({
        tenant_id:       opts.tenantId,
        inspection_id:   opts.inspectionId,
        status:          'draft',
        summary:         out.result.summary,
        citations:       out.result.citations,
        recommendations: out.result.recommendations,
        raw_payload:     out.result,
        model:           out.model,
        updated_at:      new Date().toISOString(),
      }, { onConflict: 'inspection_id' })
    if (upErr) throw new Error(upErr.message)
  } catch (err) {
    // Background task: never surface to the user. Capture for observability.
    Sentry.captureException(err, { tags: { surface: SURFACE, inspectionId: opts.inspectionId } })
  }
}

interface LoadedContext {
  inspection: CspInspectionContext
  responses:  CspResponseLine[]
  findings:   HazardHuntFindingRow[]
}

async function loadContext(
  admin: ReturnType<typeof supabaseAdmin>,
  tenantId: string,
  inspectionId: string,
): Promise<LoadedContext | null> {
  const { data: inspection, error: insErr } = await admin
    .from('inspections')
    .select('id, title, template_id, score, max_score, result, submitted_at')
    .eq('id', inspectionId)
    .eq('tenant_id', tenantId)
    .maybeSingle<{
      id: string; title: string; template_id: string
      score: number | null; max_score: number | null
      result: 'pass' | 'fail' | null; submitted_at: string | null
    }>()
  if (insErr) throw new Error(insErr.message)
  if (!inspection) return null

  const [tmplRes, itemsRes, respRes, findRes] = await Promise.all([
    admin.from('inspection_templates').select('name').eq('id', inspection.template_id).maybeSingle<{ name: string }>(),
    admin.from('inspection_template_items').select('id, prompt').eq('template_id', inspection.template_id),
    admin.from('inspection_responses').select('item_id, result, note').eq('tenant_id', tenantId).eq('inspection_id', inspectionId),
    admin.from('hazard_hunt_findings').select('*').eq('tenant_id', tenantId).eq('inspection_id', inspectionId),
  ])
  for (const r of [tmplRes, itemsRes, respRes, findRes]) {
    if (r.error) throw new Error(r.error.message)
  }

  const promptByItem = new Map(
    ((itemsRes.data ?? []) as { id: string; prompt: string }[]).map(i => [i.id, i.prompt]),
  )
  const responses: CspResponseLine[] = ((respRes.data ?? []) as { item_id: string; result: CspResponseLine['result']; note: string | null }[])
    .map(r => ({ prompt: promptByItem.get(r.item_id) ?? '(unknown item)', result: r.result, note: r.note }))

  return {
    inspection: {
      title:        inspection.title,
      templateName: tmplRes.data?.name ?? null,
      submittedAt:  inspection.submitted_at,
      score:        inspection.score,
      maxScore:     inspection.max_score,
      result:       inspection.result,
    },
    responses,
    findings: (findRes.data ?? []) as HazardHuntFindingRow[],
  }
}
