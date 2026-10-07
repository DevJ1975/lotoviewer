import type { SupabaseClient } from '@supabase/supabase-js'
import type { TemplateRows } from '@soteria/core/environmental/checklists'
import type { PlannedObligation } from '@soteria/core/environmental/calendarPlan'
import type { LegalEntryPlan } from '@soteria/core/environmental/legalRegister'
import { templateStateKey, type ApplyState, type LibraryStore } from './applyLibrary'

// The Supabase side of applyLibrary: the reads that describe what a site has, and
// the writes. All of it goes through the caller's own client, so row-level
// security (including the facility clause) applies to every statement.

const UNIQUE_VIOLATION = '23505'

interface Actor {
  tenantId:   string
  facilityId: string
  userId:     string
}

export async function readApplyState(client: SupabaseClient, actor: Pick<Actor, 'tenantId' | 'facilityId'>): Promise<ApplyState> {
  const [legal, obligations, templates] = await Promise.all([
    client.from('legal_register').select('id, library_key')
      .eq('tenant_id', actor.tenantId).eq('facility_id', actor.facilityId).not('library_key', 'is', null),
    client.from('compliance_calendar_obligations').select('system_key')
      .eq('tenant_id', actor.tenantId).eq('facility_id', actor.facilityId).like('system_key', 'env:%'),
    client.from('environmental_checklist_templates').select('template_id, library_key, jurisdiction_key')
      .eq('tenant_id', actor.tenantId),
  ])
  for (const { error } of [legal, obligations, templates]) if (error) throw new Error(error.message)

  return {
    legalIds: new Map((legal.data ?? []).map(r => [r.library_key as string, r.id as string])),
    obligationKeys: new Set((obligations.data ?? []).map(r => r.system_key as string)),
    templateIds: new Map(
      (templates.data ?? []).map(r => [templateStateKey(r.library_key as string, r.jurisdiction_key as string), r.template_id as string]),
    ),
  }
}

/**
 * Create one template instance (template, items, companion) or return the one a
 * concurrent caller created first. Nothing is left half-built: a failure after the
 * template row removes it.
 */
export async function createTemplateInstance(
  client: SupabaseClient, actor: Pick<Actor, 'tenantId' | 'userId'>, rows: TemplateRows,
): Promise<{ id: string; created: boolean }> {
  const { data: template, error } = await client.from('inspection_templates')
    .insert({ tenant_id: actor.tenantId, created_by: actor.userId, ...rows.template })
    .select('id').single()
  if (error) throw new Error(error.message)
  const templateId = template.id as string

  // Everything after the template row can fail; none of it may be left half-built.
  const discard = () => client.from('inspection_templates').delete().eq('id', templateId)

  const { error: itemsError } = await client.from('inspection_template_items')
    .insert(rows.items.map(item => ({ tenant_id: actor.tenantId, template_id: templateId, ...item })))
  if (itemsError) { await discard(); throw new Error(itemsError.message) }

  const { error: companionError } = await client.from('environmental_checklist_templates')
    .insert({ template_id: templateId, tenant_id: actor.tenantId, ...rows.companion })
  if (!companionError) return { id: templateId, created: true }

  await discard()
  if (companionError.code !== UNIQUE_VIOLATION) throw new Error(companionError.message)
  // A concurrent apply made this instance first: use theirs.
  const { data: existing, error: lookupError } = await client.from('environmental_checklist_templates')
    .select('template_id').eq('tenant_id', actor.tenantId)
    .eq('library_key', rows.companion.library_key).eq('jurisdiction_key', rows.companion.jurisdiction_key).single()
  if (lookupError) throw new Error(lookupError.message)
  return { id: existing.template_id as string, created: false }
}

export function supabaseLibraryStore(client: SupabaseClient, actor: Actor): LibraryStore {
  return {
    createTemplate: (rows: TemplateRows) => createTemplateInstance(client, actor, rows),

    async createLegal(entry: LegalEntryPlan, libraryVersion: string) {
      const { data, error } = await client.from('legal_register').insert({
        tenant_id:          actor.tenantId,
        facility_id:        actor.facilityId,
        title:              entry.title,
        citation:           entry.citation,
        jurisdiction:       entry.jurisdiction,
        authority:          entry.authority,
        summary:            entry.summary,
        applicability_note: entry.applicability_note,
        source_url:         entry.source_url,
        review_frequency:   entry.review_frequency,
        program:            entry.program,
        library_key:        entry.library_key,
        library_version:    libraryVersion,
        source:             'library',
        created_by:         actor.userId,
      }).select('id').single()
      if (!error) return { id: data.id as string, created: true }
      if (error.code !== UNIQUE_VIOLATION) throw new Error(error.message)
      const { data: existing, error: lookupError } = await client.from('legal_register').select('id')
        .eq('tenant_id', actor.tenantId).eq('facility_id', actor.facilityId).eq('library_key', entry.library_key).single()
      if (lookupError) throw new Error(lookupError.message)
      return { id: existing.id as string, created: false }
    },

    async createObligation(obligation: PlannedObligation, links) {
      const { error } = await client.from('compliance_calendar_obligations').insert({
        tenant_id:             actor.tenantId,
        facility_id:           actor.facilityId,
        title:                 obligation.title,
        description:           obligation.description,
        regulatory_ref:        obligation.regulatory_ref,
        category:              obligation.category,
        cadence:               obligation.cadence,
        cadence_days:          obligation.cadence_days,
        next_due_at:           obligation.next_due_at,
        source:                'library',
        system_key:            obligation.system_key,
        status:                'open',
        program:               obligation.program,
        library_key:           obligation.library_key,
        jurisdiction:          obligation.jurisdiction,
        due_anchor:            obligation.due_anchor,
        lead_days:             obligation.lead_days,
        legal_register_id:     links.legalId,
        checklist_template_id: links.templateId,
        created_by:            actor.userId,
      })
      if (!error) return { created: true }
      if (error.code === UNIQUE_VIOLATION) return { created: false }
      throw new Error(error.message)
    },
  }
}
