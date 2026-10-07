'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, ScrollText } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { useFacility } from '@/components/FacilityProvider'
import { HowToPanel, JurisdictionBanner, SiteRequired } from '@/components/environmental/context'
import { ErrorList, primaryButtonCls } from '@/components/environmental/form'
import { errorList, listPermits, type Permit, type Scope } from '@/lib/environmental/client'
import { sortPermitsByUrgency } from '@/lib/environmental/permitView'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { DeletePermitDialog } from './_components/DeletePermitDialog'
import { PermitCard } from './_components/PermitCard'
import { PermitForm } from './_components/PermitForm'

// /environmental/compliance/permits — every permit, most urgent first.
//
// With one site selected a tenant admin can add, edit and delete its permits. With
// all sites selected it is a read-only roll-up: a permit belongs to one site for
// life, so changing one starts from choosing the site.

export default function EnvironmentalPermits() {
  const { scope, facilityId, canAdmin, ready } = useEnvironmentalScope()
  if (!ready || !scope) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={ScrollText}
        eyebrow="ISO 14001 · 6.1.3 · 9.1.2"
        title="Permits"
        description="Each permit's dates, conditions and document, with a renewal deadline kept on the calendar while it is in force."
      />
      <PermitsView scope={scope} facilityId={facilityId} canAdmin={canAdmin} />
    </>
  )
}

interface ViewProps { scope: Scope; facilityId: string | null; canAdmin: boolean }

function PermitsView({ scope, facilityId, canAdmin }: ViewProps) {
  const { site, error: siteError } = useEnvironmentalSite()
  const { available } = useFacility()
  const [loaded, setLoaded] = useState<{ permits: Permit[]; nowMs: number } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [reloads, setReloads] = useState(0)
  const [editing, setEditing] = useState<{ permit: Permit | null } | null>(null)
  const [deleting, setDeleting] = useState<Permit | null>(null)

  useEffect(() => {
    let cancelled = false
    listPermits(scope)
      .then(r => { if (!cancelled) { setLoaded({ permits: sortPermitsByUrgency(r.permits), nowMs: Date.now() }); setErrors([]) } })
      .catch(e => { if (!cancelled) setErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope, reloads])

  const siteNames = useMemo(() => new Map(available.map(f => [f.id, f.name])), [available])
  const reload = () => setReloads(n => n + 1)
  // The form needs the site loaded: its state decides the jurisdiction choices.
  const editable = canAdmin && facilityId !== null && site !== null

  return (
    <div className="space-y-5">
      <JurisdictionBanner site={site} />
      <HowToPanel pageKey="permits" state={site?.facility.state ?? null} />
      {siteError && <ErrorList errors={[siteError]} />}
      {canAdmin && facilityId === null && (
        <SiteRequired>Choose a site to add, edit or delete its permits. The list below shows the permits of every site.</SiteRequired>
      )}
      <ErrorList errors={errors} />

      {loaded === null && errors.length === 0 && <div className="flex justify-center py-16"><OpsSpinner /></div>}

      {loaded?.permits.length === 0 && (
        <EmptyState
          icon={ScrollText}
          eyebrow="No permits"
          title="No permits recorded yet"
          description={`A permit sets what a site may discharge or emit, and most expire. Record each one and the calendar warns you before it lapses, with its conditions and document kept in one place. Reading these details from the permit PDF will come with a separate document reader; until then, enter them by hand.${canAdmin ? '' : ' A tenant admin can add them.'}`}
          action={editable ? (
            <button type="button" className={primaryButtonCls} onClick={() => setEditing({ permit: null })}>
              <Plus className="h-4 w-4" /> Add your first permit
            </button>
          ) : undefined}
        />
      )}

      {loaded && loaded.permits.length > 0 && (
        <>
          {editable && (
            <div className="flex justify-end">
              <button type="button" className={primaryButtonCls} onClick={() => setEditing({ permit: null })}>
                <Plus className="h-4 w-4" /> Add permit
              </button>
            </div>
          )}
          <ul className="space-y-3">
            {loaded.permits.map(permit => (
              <li key={permit.id}>
                <PermitCard
                  permit={permit}
                  nowMs={loaded.nowMs}
                  siteName={facilityId === null ? siteNames.get(permit.facility_id) ?? 'Unknown site' : undefined}
                  actions={editable ? { onEdit: () => setEditing({ permit }), onDelete: () => setDeleting(permit) } : undefined}
                />
              </li>
            ))}
          </ul>
        </>
      )}

      {editing && site && (
        <PermitForm
          scope={scope} site={site} permit={editing.permit}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
      {deleting && (
        <DeletePermitDialog
          scope={scope} permit={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); reload() }}
        />
      )}
    </div>
  )
}
