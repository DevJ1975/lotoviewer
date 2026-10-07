import type { SupabaseClient } from '@supabase/supabase-js'
import { HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY } from '@soteria/core/hazardousWaste'
import { applies } from '@soteria/core/environmental/applicability'
import { EMPTY_SITE_PROFILE, toProfileRow } from '@soteria/core/environmental/siteProfile'
import type { PermitProgram } from '@soteria/core/environmental/permits'
import { executeApply, planApply } from './applyLibrary'
import { startChecklist, submitChecklist } from './checklistRuns'
import { supabaseRunStore } from './checklistStore'
import { demoAnswers, type DemoStore } from './demoSeed'
import { readApplyState, supabaseLibraryStore } from './libraryStore'
import { syncPermitRenewal } from './permitSync'
import { loadSiteContext } from './siteContext'

// The Supabase side of the demo seed. It uses the service client (a superadmin
// action on a demo account), and goes through the same apply-library and checklist
// code the product uses, so the demo cannot show something the product cannot do.

const must = <T>(result: { data: T; error: { message: string } | null }): T => {
  if (result.error) throw new Error(result.error.message)
  return result.data
}

/** A row that has to be there: a write that returns nothing is a failure, not a success. */
const required = <T>(result: { data: T; error: { message: string } | null }): NonNullable<T> => {
  const data = must(result)
  if (data === null || data === undefined) throw new Error('The database returned no row for a write that should have returned one.')
  return data
}

export function supabaseDemoStore(admin: SupabaseClient, tenantId: string): DemoStore {
  const findDeadline = async (facilityId: string, libraryKey: string) => must(await admin.from('compliance_calendar_obligations')
    .select('id').eq('tenant_id', tenantId).eq('facility_id', facilityId).eq('library_key', libraryKey).eq('status', 'open').maybeSingle())

  const findOutfall = async (facilityId: string, code: string) => must(await admin.from('stormwater_outfalls')
    .select('id').eq('tenant_id', tenantId).eq('facility_id', facilityId).eq('code', code).maybeSingle())

  return {
    async memberIds() {
      const rows = must(await admin.from('tenant_memberships').select('user_id')
        .eq('tenant_id', tenantId).is('invite_cancelled_at', null).not('user_id', 'is', null).order('user_id', { ascending: true }).limit(3))
      return (rows ?? []).map(r => r.user_id as string)
    },

    async ensureSite(site) {
      const existing = must(await admin.from('facilities').select('id, settings').eq('tenant_id', tenantId).eq('code', site.code).maybeSingle())
      const priorSettings = ((existing?.settings ?? {}) as Record<string, unknown>)
      const priorWaste = (priorSettings[HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY] ?? {}) as Record<string, unknown>
      const settings = { ...priorSettings, [HAZARDOUS_WASTE_FACILITY_SETTINGS_KEY]: { ...priorWaste, generator_category: site.generatorCategory } }
      const fields = { name: site.name, city: site.city, state: site.state, settings }
      if (existing) {
        must(await admin.from('facilities').update(fields).eq('id', existing.id as string).select('id').single())
        return existing.id as string
      }
      const created = required(await admin.from('facilities')
        .insert({ tenant_id: tenantId, code: site.code, is_primary: false, ...fields }).select('id').single())
      return created.id as string
    },

    async saveProfile(facilityId, profile, confirmedBy) {
      const now = new Date().toISOString()
      must(await admin.from('environmental_site_profiles').upsert({
        tenant_id: tenantId, facility_id: facilityId, ...toProfileRow({ ...EMPTY_SITE_PROFILE, ...profile }),
        confirmed_at: now, confirmed_by: confirmedBy, created_by: confirmedBy, updated_by: confirmedBy,
      }, { onConflict: 'facility_id' }).select('id'))
    },

    async applyLibrary(facilityId, actorUserId) {
      const site = await loadSiteContext(admin, facilityId)
      if (!site) throw new Error('The demo site could not be read back.')
      const state = await readApplyState(admin, { tenantId, facilityId })
      const plan = planApply(site, state, new Date())
      return executeApply(supabaseLibraryStore(admin, { tenantId, facilityId, userId: actorUserId }), plan, state)
    },

    async ensurePermit(facilityId, permit, dates, actorUserId) {
      let row = must(await admin.from('environmental_permits').select('*')
        .eq('tenant_id', tenantId).eq('facility_id', facilityId).eq('program', permit.program).eq('permit_number', permit.permitNumber).maybeSingle())
      if (!row) {
        row = required(await admin.from('environmental_permits').insert({
          tenant_id: tenantId, facility_id: facilityId, program: permit.program, permit_type: permit.permitType,
          permit_number: permit.permitNumber, issuing_agency: permit.agency, jurisdiction: permit.jurisdiction, status: 'active',
          effective_date: dates.effective, expiration_date: dates.expires, renewal_lead_days: permit.renewalLeadDays,
          created_by: actorUserId, updated_by: actorUserId,
        }).select('*').single())
      }
      // The renewal deadline follows the permit; this is a no-op when it already does.
      await syncPermitRenewal(admin, { tenantId, userId: actorUserId }, {
        id: row.id as string, facility_id: facilityId, program: row.program as PermitProgram, permit_type: row.permit_type as string,
        permit_number: row.permit_number as string | null, status: row.status as string,
        expiration_date: row.expiration_date as string | null, renewal_lead_days: row.renewal_lead_days as number,
      })
      return row.id as string
    },

    async ensureOutfall(facilityId, outfall, links, actorUserId) {
      const existing = await findOutfall(facilityId, outfall.code)
      if (existing) return existing.id as string
      const created = required(await admin.from('stormwater_outfalls').insert({
        tenant_id: tenantId, facility_id: facilityId, code: outfall.code, name: outfall.name, receiving_water: outfall.receivingWater,
        latitude: outfall.latitude, longitude: outfall.longitude, outfall_type: 'stormwater', is_sampling_point: outfall.sampling,
        status: 'active', permit_id: links.permitId, substantially_identical_to: links.sameAsId, created_by: actorUserId, updated_by: actorUserId,
      }).select('id').single())
      return created.id as string
    },

    async evaluateLegal(facilityId, evaluation, when, actorUserId) {
      const entry = must(await admin.from('legal_register').select('id')
        .eq('tenant_id', tenantId).eq('facility_id', facilityId).eq('library_key', evaluation.libraryKey).maybeSingle())
      if (!entry) return false
      must(await admin.from('legal_register').update({
        applicability: evaluation.applicability, compliance_status: evaluation.status, evaluation_note: evaluation.note,
        last_evaluated_at: when.evaluatedAt, last_evaluated_by: actorUserId,
        last_reviewed_at: when.reviewedAt, next_review_due: when.nextReviewDue,
      }).eq('id', entry.id as string).select('id').single())
      return true
    },

    async setDeadline(facilityId, libraryKey, change) {
      const deadline = await findDeadline(facilityId, libraryKey)
      if (!deadline) return false
      must(await admin.from('compliance_calendar_obligations').update({
        next_due_at: change.dueOn, ...(change.ownerUserId ? { owner_user_id: change.ownerUserId } : {}), updated_at: new Date().toISOString(),
      }).eq('id', deadline.id as string).select('id').single())
      return true
    },

    async ensureRun(facilityId, run, actorUserId, when) {
      const site = await loadSiteContext(admin, facilityId)
      const template = site?.library.checklists.find(t => t.id === run.libraryKey)
      if (!site || !template || !applies(template.appliesWhen, site.applicability)) return 'skipped'

      let subjectId: string | null = null
      if (template.subjectType === 'outfall') {
        const outfall = run.outfallCode ? await findOutfall(facilityId, run.outfallCode) : null
        if (!outfall) return 'skipped'
        subjectId = outfall.id as string
      }

      // A finished run is never repeated; an unfinished one is resumed by startChecklist itself.
      if (run.outcome !== 'in_progress') {
        const instances = must(await admin.from('environmental_checklist_templates').select('template_id')
          .eq('tenant_id', tenantId).eq('library_key', run.libraryKey))
        const templateIds = (instances ?? []).map(i => i.template_id as string)
        if (templateIds.length > 0) {
          let query = admin.from('inspections').select('id').eq('tenant_id', tenantId).eq('facility_id', facilityId)
            .eq('domain', 'environmental').eq('status', 'submitted').in('template_id', templateIds)
          query = query.eq('subject_id', subjectId ?? facilityId)
          if ((must(await query.limit(1)) ?? []).length > 0) return 'exists'
        }
      }

      const deadline = run.deadlineKey ? await findDeadline(facilityId, run.deadlineKey) : null
      const runStore = supabaseRunStore(admin, { tenantId, userId: actorUserId })
      const started = await startChecklist(runStore, site, actorUserId, {
        libraryKey: run.libraryKey, subjectId, obligationId: deadline ? (deadline.id as string) : null, occurrenceAt: null,
      })
      if (!started.ok) throw new Error(`Could not start the demo checklist ${run.libraryKey}: ${started.error}`)
      if (started.resumed) return 'exists'

      if (run.outcome === 'in_progress') {
        must(await admin.from('inspections').update({ started_at: when.toISOString(), created_at: when.toISOString() }).eq('id', started.inspectionId).select('id').single())
        return 'created'
      }

      const snapshot = await runStore.loadRun(started.inspectionId)
      if (!snapshot) throw new Error('The demo checklist could not be read back.')
      const answers = demoAnswers(snapshot.items, run.outcome, tenantId).map(a => ({
        itemId: a.itemId, result: a.result, value: a.value, evidenceId: a.evidenceId, note: a.note,
      }))
      const submitted = await submitChecklist(runStore, { userId: actorUserId, now: when }, started.inspectionId, {
        answers, signatureName: 'Demo Inspector', imagePath: null,
      })
      if (!submitted.ok) throw new Error(`Could not submit the demo checklist ${run.libraryKey}: ${submitted.error}`)

      // The seed runs now; the story says these happened weeks ago.
      const stamp = when.toISOString()
      must(await admin.from('inspections').update({
        started_at: new Date(when.getTime() - 3_600_000).toISOString(), submitted_at: stamp, created_at: stamp, updated_at: stamp,
      }).eq('id', started.inspectionId).select('id').single())
      return 'created'
    },
  }
}
