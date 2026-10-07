import type { SupabaseClient } from '@supabase/supabase-js'
import type { ChecklistSubjectType } from '@soteria/core/environmental/content'
import type { NonconformityInsert } from '@soteria/core/environmental/checklists'
import { createTemplateInstance } from './libraryStore'
import type { NewRun, ObligationRow, RunItem, RunResponse, RunSnapshot, RunStore } from './checklistRuns'

// The Supabase side of checklistRuns. Every statement runs through the caller's
// own client, so row-level security (tenant, facility and, for evidence, admin
// rights) applies to each one.

const UNIQUE_VIOLATION = '23505'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const OBLIGATION_COLUMNS = 'id, title, status, cadence, cadence_days, next_due_at, due_anchor, owner_user_id, facility_id, library_key'

function fail(error: { message: string } | null): asserts error is null {
  if (error) throw new Error(error.message)
}

export function supabaseRunStore(client: SupabaseClient, actor: { tenantId: string; userId: string }): RunStore {
  async function findSubject(type: ChecklistSubjectType, id: string, facilityId: string): Promise<{ label: string } | null> {
    if (!UUID_RE.test(id)) return null
    if (type === 'outfall') {
      const { data, error } = await client.from('stormwater_outfalls').select('code')
        .eq('id', id).eq('facility_id', facilityId).neq('status', 'removed').maybeSingle()
      fail(error)
      return data ? { label: `Outfall ${data.code as string}` } : null
    }
    if (type === 'permit') {
      const { data, error } = await client.from('environmental_permits').select('permit_type, permit_number')
        .eq('id', id).eq('facility_id', facilityId).maybeSingle()
      fail(error)
      return data ? { label: [data.permit_type, data.permit_number].filter(Boolean).join(' ') } : null
    }
    if (type === 'hw_area') {
      const { data, error } = await client.from('hazardous_waste_areas').select('name')
        .eq('id', id).is('archived_at', null).maybeSingle()
      fail(error)
      return data ? { label: data.name as string } : null
    }
    return null
  }

  async function getObligation(id: string): Promise<ObligationRow | null> {
    if (!UUID_RE.test(id)) return null
    const { data, error } = await client.from('compliance_calendar_obligations').select(OBLIGATION_COLUMNS)
      .eq('tenant_id', actor.tenantId).eq('id', id).maybeSingle()
    fail(error)
    return (data as ObligationRow | null) ?? null
  }

  return {
    findSubject,
    getObligation,

    async findTemplateId(libraryKey, instanceKey) {
      const { data, error } = await client.from('environmental_checklist_templates').select('template_id')
        .eq('tenant_id', actor.tenantId).eq('library_key', libraryKey).eq('jurisdiction_key', instanceKey).maybeSingle()
      fail(error)
      return data ? (data.template_id as string) : null
    },

    createTemplate: rows => createTemplateInstance(client, actor, rows),

    async findOpenRun({ templateId, facilityId, subjectId }) {
      const { data, error } = await client.from('inspections').select('id')
        .eq('tenant_id', actor.tenantId).eq('template_id', templateId).eq('facility_id', facilityId)
        .eq('subject_id', subjectId).eq('status', 'in_progress').eq('domain', 'environmental')
        .order('started_at', { ascending: false }).limit(1)
      fail(error)
      return data && data.length > 0 ? (data[0]!.id as string) : null
    },

    async createRun(run: NewRun) {
      const { data: template, error: templateError } = await client.from('inspection_templates')
        .select('version').eq('id', run.templateId).single()
      fail(templateError)

      const { data: inspection, error } = await client.from('inspections').insert({
        tenant_id:        actor.tenantId,
        template_id:      run.templateId,
        template_version: template.version as number,
        title:            run.title,
        subject_type:     run.subjectType,
        subject_id:       run.subjectId,
        assignee_user_id: run.userId,
        status:           'in_progress',
        due_at:           run.occurrenceAt,
        created_by:       run.userId,
        facility_id:      run.facilityId,
        domain:           'environmental',
      }).select('id').single()
      fail(error)
      const inspectionId = inspection.id as string

      const { error: companionError } = await client.from('environmental_checklist_runs').insert({
        inspection_id:    inspectionId,
        tenant_id:        actor.tenantId,
        facility_id:      run.facilityId,
        obligation_id:    run.obligationId,
        occurrence_at:    run.occurrenceAt,
        subject_type:     run.subjectType,
        subject_id:       run.subjectId,
        jurisdiction_key: run.jurisdictionKey,
        library_version:  run.libraryVersion,
      })
      if (companionError) {
        // An inspection without its environmental companion would read as a safety inspection.
        await client.from('inspections').delete().eq('id', inspectionId)
        throw new Error(companionError.message)
      }
      return inspectionId
    },

    async loadRun(inspectionId): Promise<RunSnapshot | null> {
      if (!UUID_RE.test(inspectionId)) return null
      const { data: inspection, error } = await client.from('inspections')
        .select('id, title, status, domain, template_id, facility_id, score, max_score, result, subject_type, subject_id')
        .eq('tenant_id', actor.tenantId).eq('id', inspectionId).maybeSingle()
      fail(error)
      if (!inspection) return null

      const [run, template, items, responses] = await Promise.all([
        client.from('environmental_checklist_runs')
          .select('obligation_id, occurrence_at, subject_type, subject_id, attested, signature').eq('inspection_id', inspectionId).maybeSingle(),
        client.from('inspection_templates').select('name').eq('id', inspection.template_id as string).single(),
        client.from('inspection_template_items')
          .select('id, item_type, prompt, section, sort_order, required, weight, fail_creates_action, config')
          .eq('template_id', inspection.template_id as string).order('sort_order', { ascending: true }),
        client.from('inspection_responses').select('item_id, value, result, evidence_id, note').eq('inspection_id', inspectionId),
      ])
      for (const { error: e } of [run, template, items, responses]) fail(e)

      const runRow = run.data as RunSnapshot['run']
      const subjectType = runRow?.subject_type as ChecklistSubjectType | null
      const subject = subjectType && runRow?.subject_id && inspection.facility_id && subjectType !== 'facility'
        ? await findSubject(subjectType, runRow.subject_id, inspection.facility_id as string) : null

      return {
        inspection: inspection as RunSnapshot['inspection'],
        run: runRow,
        templateName: template.data!.name as string,
        subjectLabel: subject?.label ?? null,
        items: (items.data ?? []).map(i => ({ ...i, weight: Number(i.weight), config: (i.config ?? {}) as Record<string, unknown> })) as RunItem[],
        responses: (responses.data ?? []) as RunResponse[],
      }
    },

    async saveResponses(inspectionId, responses) {
      if (responses.length === 0) return
      const { error } = await client.from('inspection_responses').upsert(
        responses.map(r => ({ tenant_id: actor.tenantId, inspection_id: inspectionId, ...r })),
        { onConflict: 'inspection_id,item_id' },
      )
      fail(error)
    },

    async existingFindingRefs(inspectionId) {
      const { data, error } = await client.from('nonconformities').select('source_reference')
        .eq('tenant_id', actor.tenantId).like('source_reference', `env-checklist:${inspectionId}:%`)
      fail(error)
      return new Set((data ?? []).map(r => r.source_reference as string))
    },

    async insertFindings(findings: NonconformityInsert[]) {
      const rows = findings.map(f => ({ tenant_id: actor.tenantId, ...f }))
      const { error } = await client.from('nonconformities').insert(rows)
      if (!error) return
      if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message)
      // A concurrent submit raised some of these: keep the rest, one at a time.
      for (const row of rows) {
        const { error: single } = await client.from('nonconformities').insert(row)
        if (single && single.code !== UNIQUE_VIOLATION) throw new Error(single.message)
      }
    },

    async recordCompletion({ obligationId, occurrenceAt, inspectionId, userId, note }) {
      const { error } = await client.from('compliance_calendar_events').insert({
        tenant_id: actor.tenantId, obligation_id: obligationId, occurrence_at: occurrenceAt,
        completed_by: userId, inspection_id: inspectionId, note,
      })
      // The unique link to the checklist makes this safe to repeat.
      if (error && error.code !== UNIQUE_VIOLATION) throw new Error(error.message)
    },

    async advanceObligation(id, update) {
      const { error } = await client.from('compliance_calendar_obligations')
        .update({ ...update, updated_at: new Date().toISOString() }).eq('tenant_id', actor.tenantId).eq('id', id)
      fail(error)
    },

    async saveSignature(inspectionId, signature) {
      const { error } = await client.from('environmental_checklist_runs')
        .update({ signature, attested: true }).eq('inspection_id', inspectionId)
      fail(error)
    },

    async finalize({ inspectionId, score, maxScore, result, userId, submittedAt }) {
      const { data, error } = await client.from('inspections').update({
        status: 'submitted', score, max_score: maxScore, result,
        submitted_at: submittedAt, submitted_by: userId, updated_at: submittedAt,
      }).eq('tenant_id', actor.tenantId).eq('id', inspectionId).eq('status', 'in_progress').select('id')
      fail(error)
      return (data ?? []).length > 0
    },
  }
}
