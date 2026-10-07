'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, Loader2, ShieldCheck, Sparkles } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { useFacility } from '@/components/FacilityProvider'
import { CitationList, DraftBadge, StatusChip } from '@/components/environmental/badges'
import { HowToPanel, JurisdictionBanner } from '@/components/environmental/context'
import { ErrorList, Field, inputCls, primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import {
  applyLibraryToSite, errorList, listSites, previewLibrary, saveSite,
  type ApplyResponse, type SiteDetail, type SiteSummary,
} from '@/lib/environmental/client'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { ENV_PROGRAM_LABELS, type EnvProgram } from '@soteria/core/environmental/siteProfile'

// /environmental/compliance — the suite's home.
//
// With one site selected: where it is (the state drives which rules apply), which
// programs apply to it, and a button that adds the jurisdiction's legal register,
// checklists and deadlines. With all sites selected: a table of every site and
// where each stands, to pick one from.

const SCOPE_TONE = { in_scope: 'good', out_of_scope: 'idle', not_evaluated: 'warn' } as const
const SCOPE_LABEL = { in_scope: 'In scope', out_of_scope: 'Not applicable', not_evaluated: 'Not evaluated' } as const

const GENERAL_PERMITS = [
  { key: 'ca_igp', label: 'California Industrial General Permit (IGP)' },
  { key: 'tx_txr05', label: 'Texas Multi-Sector General Permit (TXR050000)' },
  { key: 'epa_msgp', label: 'EPA Multi-Sector General Permit (MSGP)' },
]

export default function EnvironmentalComplianceHome() {
  const { facilityId, ready } = useEnvironmentalScope()
  if (!ready) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={ShieldCheck}
        eyebrow="ISO 14001 · 6.1.3 · 8.1 · 9.1.1"
        title="Environmental compliance"
        description="Permits, checklists, deadlines and the legal register for each site, with the state's rules layered on the federal baseline."
      />
      {facilityId ? <SiteView /> : <AllSites />}
    </>
  )
}

// ── all sites ───────────────────────────────────────────────────────────────

function AllSites() {
  const { scope } = useEnvironmentalScope()
  const { switchFacility } = useFacility()
  const [sites, setSites] = useState<SiteSummary[] | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  useEffect(() => {
    if (!scope) return
    listSites(scope).then(r => setSites(r.sites)).catch(e => setErrors(errorList(e)))
  }, [scope])

  if (errors.length > 0) return <ErrorList errors={errors} />
  if (!sites) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  if (sites.length === 0) return <EmptyState icon={ShieldCheck} eyebrow="No sites" title="No sites yet" description="Add a site to the account first; the environmental rules depend on where it is." />

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-400">Pick a site to work on it. The rules that apply depend on the site&apos;s state and its permits.</p>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
            <tr><th className="px-3 py-2">Site</th><th className="px-3 py-2">Rules</th><th className="px-3 py-2">Programs in scope</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
            {sites.map(s => (
              <tr key={s.id} className="bg-white dark:bg-slate-950">
                <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{s.name}</td>
                <td className="px-3 py-2">
                  <StatusChip tone={s.jurisdiction.status === 'supported' ? 'good' : 'warn'}>
                    {s.jurisdiction.status === 'supported' ? `Federal + ${s.state}` : s.jurisdiction.status === 'unset' ? 'No state set: federal only' : `${s.state}: federal only`}
                  </StatusChip>
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    {s.scopes.filter(p => p.status === 'in_scope').map(p => <StatusChip key={p.program} tone="good">{ENV_PROGRAM_LABELS[p.program]}</StatusChip>)}
                    {s.scopes.every(p => p.status !== 'in_scope') && <span className="text-xs text-slate-500">{s.profile_saved ? 'None yet' : 'Profile not started'}</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right">
                  <button type="button" className={secondaryButtonCls} onClick={() => switchFacility(s.id)}>Open</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── one site ────────────────────────────────────────────────────────────────

interface Draft {
  state: string
  stormwater_coverage: string
  stormwater_general_permit: string
  air_permit_type: string
  wastewater_discharge: string
  pretreatment_status: string
  potw_name: string
  air_district: string
  cupa: string
  regional_board: string
  spcc_applicable: string
  tier2_applicable: string
  sic_codes: string
  naics_codes: string
  notes: string
}

const tri = (v: boolean | null | undefined) => (v === true ? 'yes' : v === false ? 'no' : '')
const fromTri = (v: string) => (v === 'yes' ? true : v === 'no' ? false : null)

function toDraft(site: SiteDetail): Draft {
  const p = site.profile as Record<string, unknown>
  const agencies = (p.local_agencies ?? {}) as Record<string, string | null>
  const text = (v: unknown) => (typeof v === 'string' ? v : '')
  return {
    state: site.facility.state ?? '',
    stormwater_coverage: text(p.stormwater_coverage) || 'not_evaluated',
    stormwater_general_permit: text(p.stormwater_general_permit),
    air_permit_type: text(p.air_permit_type) || 'not_evaluated',
    wastewater_discharge: text(p.wastewater_discharge) || 'not_evaluated',
    pretreatment_status: text(p.pretreatment_status) || 'not_evaluated',
    potw_name: text(p.potw_name),
    air_district: text(agencies.air_district), cupa: text(agencies.cupa), regional_board: text(agencies.regional_board),
    spcc_applicable: tri(p.spcc_applicable as boolean | null), tier2_applicable: tri(p.tier2_applicable as boolean | null),
    sic_codes: ((p.sic_codes as string[]) ?? []).join(', '), naics_codes: ((p.naics_codes as string[]) ?? []).join(', '),
    notes: text(p.notes),
  }
}

const codes = (s: string) => s.split(/[\s,]+/).filter(Boolean)

function SiteView() {
  const { scope, facilityId, canAdmin } = useEnvironmentalScope()
  const { site, loading, error, setSite } = useEnvironmentalSite()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (site) setDraft(toDraft(site)) }, [site])
  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(d => (d ? { ...d, [key]: value } : d)), [])

  const save = useCallback(async (confirm: boolean) => {
    if (!scope || !facilityId || !draft) return
    setBusy(true); setErrors([]); setNotice(null)
    try {
      const saved = await saveSite(scope, facilityId, {
        state: draft.state || null,
        stormwater_coverage: draft.stormwater_coverage,
        stormwater_general_permit: draft.stormwater_coverage === 'general_permit' ? draft.stormwater_general_permit || null : null,
        air_permit_type: draft.air_permit_type,
        wastewater_discharge: draft.wastewater_discharge,
        pretreatment_status: draft.pretreatment_status,
        potw_name: draft.potw_name || null,
        local_agencies: { air_district: draft.air_district || null, cupa: draft.cupa || null, regional_board: draft.regional_board || null },
        spcc_applicable: fromTri(draft.spcc_applicable),
        tier2_applicable: fromTri(draft.tier2_applicable),
        sic_codes: codes(draft.sic_codes), naics_codes: codes(draft.naics_codes),
        notes: draft.notes || null,
        ...(confirm ? { confirm: true } : {}),
      })
      setSite(saved)
      setNotice(saved.state_changed
        ? 'Saved. The state also sets this site\'s OSHA reporting jurisdiction everywhere else in the product.'
        : confirm ? 'Saved and confirmed.' : 'Saved.')
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(false)
    }
  }, [scope, facilityId, draft, setSite])

  const statesByName = useMemo(() => site?.states ?? [], [site])

  if (loading && !site) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  if (error) return <ErrorList errors={[error]} />
  if (!site || !draft) return null
  const readOnly = !canAdmin

  return (
    <div className="space-y-5">
      <JurisdictionBanner site={site} />
      <HowToPanel pageKey="home" state={site.facility.state} />

      <section className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Programs at this site</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {site.scopes.map(s => (
            <div key={s.program} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-800">
              <span className="text-sm text-slate-800 dark:text-slate-200">{ENV_PROGRAM_LABELS[s.program as EnvProgram]}</span>
              <StatusChip tone={SCOPE_TONE[s.status]}>{SCOPE_LABEL[s.status]}</StatusChip>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Hazardous waste follows the generator category set under{' '}
          <Link href="/hazardous-waste/facility" className="underline">Hazardous waste · Facility profile</Link>
          {site.generator_category ? ` (currently ${site.generator_category.toUpperCase()}).` : ' (not set yet).'}
        </p>
      </section>

      <form
        onSubmit={e => { e.preventDefault(); void save(false) }}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Site profile</h2>
          {site.profile.confirmed_at
            ? <StatusChip tone="good"><CheckCircle2 className="h-3 w-3" /> Confirmed {String(site.profile.confirmed_at).slice(0, 10)}</StatusChip>
            : <StatusChip tone="warn">Not confirmed</StatusChip>}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State" hint="Chooses whose rules apply. It also sets this site's OSHA reporting jurisdiction.">
            <select value={draft.state} onChange={e => set('state', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="">Not set: federal baseline only</option>
              {statesByName.map(s => <option key={s.code} value={s.code}>{s.name}{s.supported ? ' (state rules available)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Industrial stormwater coverage">
            <select value={draft.stormwater_coverage} onChange={e => set('stormwater_coverage', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="not_evaluated">Not evaluated yet</option>
              <option value="not_required">Not required (no regulated activity)</option>
              <option value="no_exposure">No-exposure certification</option>
              <option value="general_permit">Covered by a general permit</option>
              <option value="individual_permit">Individual permit</option>
            </select>
          </Field>
          {draft.stormwater_coverage === 'general_permit' && (
            <Field label="Which general permit">
              <select value={draft.stormwater_general_permit} onChange={e => set('stormwater_general_permit', e.target.value)} disabled={readOnly} className={inputCls}>
                <option value="">Another general permit</option>
                {GENERAL_PERMITS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Air permit">
            <select value={draft.air_permit_type} onChange={e => set('air_permit_type', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="not_evaluated">Not evaluated yet</option>
              <option value="not_required">Not required</option>
              <option value="exempt">Exempt</option>
              <option value="registration_or_pbr">Registration or permit by rule</option>
              <option value="minor_permit">Minor source permit</option>
              <option value="synthetic_minor">Synthetic minor</option>
              <option value="title_v">Title V (major source)</option>
            </select>
          </Field>
          <Field label="Wastewater discharge">
            <select value={draft.wastewater_discharge} onChange={e => set('wastewater_discharge', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="not_evaluated">Not evaluated yet</option>
              <option value="none">No process wastewater discharge</option>
              <option value="potw_indirect">To the sewer (POTW), indirect</option>
              <option value="npdes_direct">Direct to a water body (NPDES)</option>
              <option value="zero_discharge">Zero discharge</option>
              <option value="septic">Septic</option>
            </select>
          </Field>
          {draft.wastewater_discharge === 'potw_indirect' && (
            <>
              <Field label="Pretreatment status">
                <select value={draft.pretreatment_status} onChange={e => set('pretreatment_status', e.target.value)} disabled={readOnly} className={inputCls}>
                  <option value="not_evaluated">Not evaluated yet</option>
                  <option value="not_regulated">Not regulated</option>
                  <option value="non_significant">Non-significant user</option>
                  <option value="siu">Significant industrial user</option>
                  <option value="ciu">Categorical industrial user</option>
                </select>
              </Field>
              <Field label="Sewer agency (POTW)"><input value={draft.potw_name} onChange={e => set('potw_name', e.target.value)} disabled={readOnly} maxLength={200} className={inputCls} /></Field>
            </>
          )}
          <Field label="SPCC plan required" hint="Oil storage over the federal thresholds">
            <select value={draft.spcc_applicable} onChange={e => set('spcc_applicable', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="">Not evaluated yet</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
          <Field label="Tier II reporting required" hint="Hazardous chemicals over the thresholds (EPCRA)">
            <select value={draft.tier2_applicable} onChange={e => set('tier2_applicable', e.target.value)} disabled={readOnly} className={inputCls}>
              <option value="">Not evaluated yet</option><option value="yes">Yes</option><option value="no">No</option>
            </select>
          </Field>
          <Field label="SIC codes" hint="Four digits, separated by commas"><input value={draft.sic_codes} onChange={e => set('sic_codes', e.target.value)} disabled={readOnly} className={inputCls} /></Field>
          <Field label="NAICS codes" hint="Two to six digits, separated by commas"><input value={draft.naics_codes} onChange={e => set('naics_codes', e.target.value)} disabled={readOnly} className={inputCls} /></Field>
        </div>

        {site.facility.state && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Air district"><input value={draft.air_district} onChange={e => set('air_district', e.target.value)} disabled={readOnly} maxLength={200} className={inputCls} /></Field>
            <Field label="Local hazardous materials agency (CUPA)"><input value={draft.cupa} onChange={e => set('cupa', e.target.value)} disabled={readOnly} maxLength={200} className={inputCls} /></Field>
            <Field label="Regional water board"><input value={draft.regional_board} onChange={e => set('regional_board', e.target.value)} disabled={readOnly} maxLength={200} className={inputCls} /></Field>
          </div>
        )}

        <Field label="Notes"><textarea value={draft.notes} onChange={e => set('notes', e.target.value)} disabled={readOnly} rows={2} maxLength={2000} className={inputCls} /></Field>

        <ErrorList errors={errors} />
        {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{notice}</p>}

        {readOnly ? (
          <p className="text-xs text-slate-500 dark:text-slate-400">Only a tenant admin can change the site profile.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={secondaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </button>
            <button type="button" disabled={busy} onClick={() => void save(true)} className={primaryButtonCls}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Save and confirm
            </button>
            <p className="self-center text-xs text-slate-500 dark:text-slate-400">Confirm once you have checked each answer against your permits.</p>
          </div>
        )}
      </form>

      <LibraryPanel site={site} canAdmin={canAdmin} />
    </div>
  )
}

// ── apply the library ───────────────────────────────────────────────────────

function LibraryPanel({ site, canAdmin }: { site: SiteDetail; canAdmin: boolean }) {
  const { scope } = useEnvironmentalScope()
  const [preview, setPreview] = useState<ApplyResponse | null>(null)
  const [done, setDone] = useState<ApplyResponse | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)

  const run = useCallback(async (kind: 'preview' | 'apply') => {
    if (!scope) return
    setBusy(kind); setErrors([])
    try {
      if (kind === 'preview') { setDone(null); setPreview(await previewLibrary(scope, site.facility.id)) }
      else { setDone(await applyLibraryToSite(scope, site.facility.id)); setPreview(null) }
    } catch (e) {
      setErrors(errorList(e))
    } finally {
      setBusy(null)
    }
  }, [scope, site.facility.id])

  const total = preview ? preview.plan.legal.create.length + preview.plan.templates.create.length + preview.plan.obligations.create.length : 0

  return (
    <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-brand-navy dark:text-brand-yellow" />
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Set up this site from the library</h2>
        <DraftBadge packs={site.packs} className="ml-auto" />
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400">
        Adds the legal requirements, checklists and recurring deadlines that apply to this site&apos;s state and programs. Nothing you have
        already set up is changed, and you see exactly what will be added before anything is.
      </p>

      <ErrorList errors={errors} />

      {canAdmin && !preview && (
        <button type="button" onClick={() => void run('preview')} disabled={busy !== null} className={primaryButtonCls}>
          {busy === 'preview' && <Loader2 className="h-4 w-4 animate-spin" />} Preview what would be added
        </button>
      )}
      {!canAdmin && <p className="text-xs text-slate-500">Only a tenant admin can apply the library.</p>}

      {preview && (
        <div className="space-y-3">
          {total === 0 ? (
            <p className="text-sm text-slate-700 dark:text-slate-300">This site already has everything the library offers for its current profile.</p>
          ) : (
            <>
              <PreviewList title="Legal requirements" items={preview.plan.legal.create.map(i => ({ key: i.key, label: i.title, detail: i.citation, verify: i.verify }))} />
              <PreviewList title="Checklists" items={preview.plan.templates.create.map(i => ({ key: i.key, label: i.name, detail: `${i.items} questions` }))} />
              <PreviewList title="Recurring deadlines" items={preview.plan.obligations.create.map(i => ({ key: i.key, label: i.title, detail: `${i.cadence}, first due ${i.nextDueAt}` }))} />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Already in place and left alone: {preview.plan.legal.existing} legal, {preview.plan.templates.existing} checklists, {preview.plan.obligations.existing} deadlines.
                Items marked Verify have not been confirmed against current regulatory text; check them before relying on them.
              </p>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            {total > 0 && (
              <button type="button" onClick={() => void run('apply')} disabled={busy !== null} className={primaryButtonCls}>
                {busy === 'apply' && <Loader2 className="h-4 w-4 animate-spin" />} Add these to the site
              </button>
            )}
            <button type="button" onClick={() => setPreview(null)} className={secondaryButtonCls}>Cancel</button>
          </div>
        </div>
      )}

      {done?.result && (
        <p role="status" className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">
          Added {done.result.legal.created} legal requirements, {done.result.templates.created} checklists and {done.result.obligations.created} deadlines.{' '}
          <Link href="/environmental/compliance/calendar" className="font-semibold underline">See the calendar</Link>
        </p>
      )}
    </section>
  )
}

function PreviewList({ title, items }: { title: string; items: Array<{ key: string; label: string; detail?: string; verify?: string | null }> }) {
  if (items.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{title} ({items.length})</h3>
      <ul className="mt-1 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
        {items.map(i => (
          <li key={i.key} className="px-3 py-1.5">
            <span className="text-slate-900 dark:text-slate-100">{i.label}</span>
            {i.detail && <span className="ml-2 text-xs text-slate-500">{i.detail}</span>}
            {i.verify && <CitationList className="mt-1" citations={[{ ref: 'Needs checking', verify: i.verify }]} />}
          </li>
        ))}
      </ul>
    </div>
  )
}
