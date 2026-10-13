'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowLeft, FileBadge, Loader2 } from 'lucide-react'
import {
  PERMIT_PROGRAMS,
  PERMIT_PROGRAM_LABELS,
  type PermitProgram,
  type PermitStanding,
} from '@soteria/core/environmentalPermit'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { Sheet } from '@/components/ui/sheet'
import {
  getRegistersHealth,
  listPermits,
  type PermitFilters,
  type PermitRow,
  type RegistersHealth,
} from '@/lib/environmental/client'
import { STANDING_LABEL } from '@/lib/environmental/permitDisplay'
import { useCanEditRegisters } from '../_components/access'
import { BUTTON_PRIMARY, INPUT, LABEL, LABEL_TEXT } from '../_components/formStyles'
import { PERMIT_LIGHT_LABELS } from '../_components/RegisterHealthBadge'
import { RegisterHealthStrip } from '../_components/RegisterHealthStrip'
import { BusinessCriticalBadge, HolderMismatchBadge, RenewalBadge } from './_components/PermitBadges'
import { PermitForm } from './_components/PermitForm'

// /environmental/permits — the permit vault (clause 6.1.3). Every permit,
// registration and plan a site holds, grouped by program, each with its renewal
// countdown and a check that the holder of record is still the legal entity the
// scope names. Conditions are obligations linked to the permit, so they stay in
// the register and the Compliance Calendar.

const STANDINGS = Object.keys(STANDING_LABEL).filter(s => s !== 'retired') as PermitStanding[]

export default function PermitsPage() {
  const { tenantId } = useTenant()
  const { facilityId } = useFacility()
  const canEdit = useCanEditRegisters()

  const [program, setProgram] = useState<'' | PermitProgram>('')
  const [standing, setStanding] = useState<'' | PermitStanding>('')
  const [criticalOnly, setCriticalOnly] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const [permits, setPermits] = useState<PermitRow[] | null>(null)
  const [legalEntity, setLegalEntity] = useState<string | null>(null)
  const [health, setHealth] = useState<RegistersHealth['permits'] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const filters = useMemo((): PermitFilters => ({
    status: showRetired ? 'all' : 'active',
    program: program || undefined,
    standing: standing || undefined,
    business_critical: criticalOnly || undefined,
  }), [program, standing, criticalOnly, showRetired])

  // Every reload starts a new generation; a slower, older response is dropped,
  // so a quick filter change can never show the other filter's permits.
  const generation = useRef(0)

  const load = useCallback(async () => {
    if (!tenantId) return
    const current = ++generation.current
    setLoadError(null)
    setPermits(null)   // never leave the previous filter's permits under the new one's label
    void getRegistersHealth(tenantId)
      .then(registers => { if (current === generation.current) setHealth(registers.permits) })
      .catch(() => { if (current === generation.current) setHealth(null) })   // the list reports its own errors
    try {
      const page = await listPermits(tenantId, filters)
      if (current !== generation.current) return
      setPermits(page.permits)
      setLegalEntity(page.legalEntityInForce)
    } catch (err) {
      if (current === generation.current) setLoadError(err instanceof Error ? err.message : 'Could not load the permits.')
    }
  }, [tenantId, filters])

  useEffect(() => { void load() }, [load])

  const byProgram = useMemo(() => PERMIT_PROGRAMS
    .map(p => ({ program: p, permits: (permits ?? []).filter(permit => permit.program === p) }))
    .filter(group => group.permits.length > 0), [permits])

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6">
      <div>
        <Link href="/environmental" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Environmental
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-100">
          <FileBadge className="h-6 w-6 text-brand-navy" />
          Permits
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          ISO 14001:2015 clause 6.1.3. The permits, registrations and plans each site holds, when each must be renewed,
          and whether the holder of record is still the organization that runs the site.
        </p>
      </div>

      <RegisterHealthStrip title="Permits" health={health?.health ?? null} labels={PERMIT_LIGHT_LABELS} facts={health ? [
        { label: 'active records', value: health.active },
        { label: 'renewal deadline missed', value: health.deadlineMissed, warn: health.deadlineMissed > 0 },
        { label: 'holder mismatch', value: health.holderMismatch, warn: health.holderMismatch > 0 },
        { label: 'renewal due within 90 days', value: health.renewalSoon, warn: health.renewalSoon > 0 },
        { label: 'conditions overdue', value: health.conditionsOverdue, warn: health.conditionsOverdue > 0 },
        { label: 'review overdue', value: health.reviewOverdue, warn: health.reviewOverdue > 0 },
      ] : []} />

      {loadError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{loadError}</span>
        </div>
      )}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Program</span>
            <select className={INPUT} value={program} onChange={e => setProgram(e.target.value as typeof program)}>
              <option value="">All programs</option>
              {PERMIT_PROGRAMS.map(p => <option key={p} value={p}>{PERMIT_PROGRAM_LABELS[p]}</option>)}
            </select>
          </label>
          <label className={LABEL}>
            <span className={LABEL_TEXT}>Standing</span>
            <select className={INPUT} value={standing} onChange={e => setStanding(e.target.value as typeof standing)}>
              <option value="">Any</option>
              {STANDINGS.map(s => <option key={s} value={s}>{STANDING_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={criticalOnly} onChange={e => setCriticalOnly(e.target.checked)} />
            Business-critical only
          </label>
          <label className="inline-flex items-center gap-2 pb-2 text-xs text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} />
            Include retired
          </label>
        </div>
        {canEdit && (
          <button type="button" className={BUTTON_PRIMARY} disabled={!facilityId} onClick={() => setAdding(true)}>Add permit</button>
        )}
      </div>
      {canEdit && !facilityId && (
        <p className="text-xs text-slate-500">Choose a facility in the header to add a permit: a permit is issued to a site.</p>
      )}

      {permits === null ? (
        !loadError && <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : byProgram.length === 0 ? (
        <p className="rounded-xl border border-slate-100 bg-white px-4 py-10 text-center text-sm italic text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          No permits match. A site with no permits recorded is not the same as a site that needs none: record what the site holds, or say in its aspects why none applies.
        </p>
      ) : byProgram.map(group => (
        <section key={group.program} aria-label={PERMIT_PROGRAM_LABELS[group.program]} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            {PERMIT_PROGRAM_LABELS[group.program]}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {group.permits.map(permit => <PermitCard key={permit.id} permit={permit} />)}
          </ul>
        </section>
      ))}

      {tenantId && (
        <Sheet open={adding} onClose={() => setAdding(false)} title="Add a permit"
          subtitle="Record what the permit itself says: its holder, its term, and when a renewal application is due.">
          {adding && (
            <PermitForm tenantId={tenantId} initial={null} defaultHolder={legalEntity}
              onCancel={() => setAdding(false)} onSaved={() => { setAdding(false); void load() }} />
          )}
        </Sheet>
      )}
    </div>
  )
}

function PermitCard({ permit }: { permit: PermitRow }) {
  return (
    <li className="placard-surface-interactive motion-press flex flex-col gap-2 p-4">
      <Link href={`/environmental/permits/${permit.id}`} className="text-sm font-semibold text-slate-900 hover:underline dark:text-slate-100">
        {permit.title}
      </Link>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {permit.agency}{permit.permit_number ? ` · ${permit.permit_number}` : ''}
      </p>
      <p className="text-xs text-slate-600 dark:text-slate-300">Held by {permit.holder_of_record}</p>
      <div className="flex flex-wrap gap-1.5">
        <RenewalBadge permit={permit} />
        <HolderMismatchBadge permit={permit} />
        <BusinessCriticalBadge permit={permit} />
      </div>
      <p className="mt-auto pt-1 text-xs text-slate-500 dark:text-slate-400">
        {permit.conditions_open} {permit.conditions_open === 1 ? 'condition' : 'conditions'}
        {permit.conditions_overdue > 0 && <span className="font-semibold text-rose-700 dark:text-rose-300"> · {permit.conditions_overdue} overdue</span>}
      </p>
    </li>
  )
}
