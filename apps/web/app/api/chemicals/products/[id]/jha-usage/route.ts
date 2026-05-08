import { NextResponse } from 'next/server'
import { requireTenantMember } from '@/lib/auth/tenantGate'

// GET /api/chemicals/products/[id]/jha-usage
//
// Returns the JHAs that reference this chemical via a jha_step_chemicals
// link, with each JHA's job_number + title for quick navigation. Used
// on the chemical detail page so a safety lead considering banning a
// chemical can preview the change-impact set.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) return NextResponse.json({ error: gate.message }, { status: gate.status })

  const { id } = await ctx.params
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  try {
    const { data, error } = await gate.authedClient
      .from('jha_step_chemicals')
      .select(`
        step_id,
        jha_steps (
          jha_id, sequence, description,
          jhas ( id, title, job_number, status )
        )
      `)
      .eq('tenant_id', gate.tenantId)
      .eq('product_id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // De-dupe to (jha_id) and surface a representative step for each.
    // Supabase nested-select typing materializes joins as arrays even
    // for many-to-one relations; the runtime value can be either an
    // object or a single-element array. Tolerate both.
    interface JhaJoin { id: string; title: string; job_number: string | null; status: string }
    interface StepJoin {
      jha_id:      string
      sequence:    number
      description: string
      jhas:        JhaJoin | JhaJoin[] | null
    }
    interface LinkRow { jha_steps: StepJoin | StepJoin[] | null }

    const byJha = new Map<string, {
      jha_id: string
      title:  string
      job_number: string | null
      status: string
      step_count: number
      sample_step: { sequence: number; description: string }
    }>()
    for (const row of (data ?? []) as unknown as LinkRow[]) {
      const stepJoin = row.jha_steps
      const step = Array.isArray(stepJoin) ? stepJoin[0] : stepJoin
      if (!step) continue
      const jhaJoin = step.jhas
      const j = Array.isArray(jhaJoin) ? jhaJoin[0] : jhaJoin
      if (!j) continue
      if (j.status === 'superseded') continue
      const existing = byJha.get(j.id)
      if (existing) {
        existing.step_count += 1
      } else {
        byJha.set(j.id, {
          jha_id:     j.id,
          title:      j.title,
          job_number: j.job_number,
          status:     j.status,
          step_count: 1,
          sample_step: { sequence: step.sequence, description: step.description },
        })
      }
    }
    const jhas = Array.from(byJha.values()).sort((a, b) => a.title.localeCompare(b.title))
    return NextResponse.json({ jhas, total: jhas.length })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
