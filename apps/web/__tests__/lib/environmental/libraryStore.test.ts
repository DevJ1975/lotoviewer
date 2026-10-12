import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseLibraryStore } from '@/lib/environmental/libraryStore'
import type { PlannedObligation } from '@soteria/core/environmental/calendarPlan'
import { parseJurisdiction } from '@soteria/core/complianceEvaluation'

// The library writes deadlines into the ISO 14001 obligations register
// (migration 298). The register's own checks refuse a row in the wrong shape, so what
// the adapter sends is pinned here rather than discovered when a database says no.

const actor = { tenantId: 'tenant-1', facilityId: 'site-1', userId: 'user-1' }

const planned = (over: Partial<PlannedObligation> = {}): PlannedObligation => ({
  system_key: 'env:sw-ca-qse:site-1', library_key: 'sw-ca-qse', facility_id: 'site-1', program: 'stormwater',
  title: 'QSE sampling', description: 'Collect samples.', regulatory_ref: 'CA IGP Section XI', category: 'environmental',
  cadence: 'quarterly', cadence_days: null, next_due_at: '2026-12-31', lead_days: 14, due_anchor: 'period_end',
  jurisdiction: 'CA', legal_library_key: null, checklist_library_key: null, ...over,
})

function recordingClient(insertError: { code?: string; message: string } | null = null) {
  const inserts: Array<{ table: string; row: Record<string, unknown> }> = []
  const client = {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row })
        return Promise.resolve({ error: insertError })
      },
    }),
  } as unknown as SupabaseClient
  return { client, inserts }
}

describe('supabaseLibraryStore.createObligation', () => {
  it('writes the register\'s columns: the ISO 14001 register, a legal requirement, and state:XX for a state pack', async () => {
    const { client, inserts } = recordingClient()
    const result = await supabaseLibraryStore(client, actor).createObligation(planned(), { legalId: 'legal-1', templateId: 'tpl-1' })

    expect(result).toEqual({ created: true })
    expect(inserts).toHaveLength(1)
    expect(inserts[0].table).toBe('compliance_calendar_obligations')
    expect(inserts[0].row).toMatchObject({
      tenant_id: 'tenant-1', facility_id: 'site-1', source: 'library', discipline: 'ems', source_kind: 'law', jurisdiction: 'state:CA',
      program: 'stormwater', library_key: 'sw-ca-qse', due_anchor: 'period_end', lead_days: 14,
      legal_register_id: 'legal-1', checklist_template_id: 'tpl-1', created_by: 'user-1',
    })
  })

  it('never sends the bare pack key "CA": the register refuses it, and EMS\'s parser would not read it', async () => {
    const { client, inserts } = recordingClient()
    await supabaseLibraryStore(client, actor).createObligation(planned({ jurisdiction: 'TX' }), { legalId: null, templateId: null })
    const jurisdiction = inserts[0].row.jurisdiction as string
    expect(jurisdiction).toBe('state:TX')
    expect(parseJurisdiction(jurisdiction)).toEqual({ level: 'state', state: 'TX' })
  })

  it('writes the federal baseline as "federal"', async () => {
    const { client, inserts } = recordingClient()
    await supabaseLibraryStore(client, actor).createObligation(planned({ jurisdiction: 'federal' }), { legalId: null, templateId: null })
    expect(inserts[0].row.jurisdiction).toBe('federal')
  })

  it('leaves the evaluation frequency to a person: it makes the register open and email an evaluation for every deadline', async () => {
    const { client, inserts } = recordingClient()
    await supabaseLibraryStore(client, actor).createObligation(planned(), { legalId: null, templateId: null })
    expect(Object.keys(inserts[0].row)).not.toContain('evaluation_cadence_days')
  })

  it('treats a unique violation as "already there", so applying twice is safe', async () => {
    const { client } = recordingClient({ code: '23505', message: 'duplicate key' })
    expect(await supabaseLibraryStore(client, actor).createObligation(planned(), { legalId: null, templateId: null })).toEqual({ created: false })
  })

  it('surfaces any other database error rather than reporting success', async () => {
    const { client } = recordingClient({ code: '23514', message: 'violates check constraint' })
    await expect(supabaseLibraryStore(client, actor).createObligation(planned(), { legalId: null, templateId: null }))
      .rejects.toThrow('violates check constraint')
  })
})
