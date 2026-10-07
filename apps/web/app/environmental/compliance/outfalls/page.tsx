'use client'

import { useEffect, useState } from 'react'
import { Droplets, Plus } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import OpsSpinner from '@/components/OpsSpinner'
import { EmptyState } from '@/components/EmptyState'
import { HowToPanel, JurisdictionBanner, SiteRequired } from '@/components/environmental/context'
import { ErrorList, primaryButtonCls } from '@/components/environmental/form'
import { errorList, listOutfalls, listPermits, type Outfall, type Permit, type Scope } from '@/lib/environmental/client'
import { sortOutfallsByCode } from '@/lib/environmental/outfallView'
import { useEnvironmentalScope, useEnvironmentalSite } from '@/lib/environmental/useEnvironmental'
import { DeleteOutfallDialog } from './_components/DeleteOutfallDialog'
import { OutfallForm } from './_components/OutfallForm'
import { OutfallsTable } from './_components/OutfallsTable'

// /environmental/compliance/outfalls — the stormwater outfalls of one site.
//
// An outfall belongs to one site and may only point at that site's permits and
// outfalls, so this screen needs a site; the all-sites roll-up asks for one.
// Anyone can start an inspection from a row; a tenant admin can also add, edit
// and delete.

export default function EnvironmentalOutfalls() {
  const { scope, facilityId, facilityName, canAdmin, ready } = useEnvironmentalScope()
  if (!ready || !scope) return <div className="flex justify-center py-16"><OpsSpinner /></div>
  return (
    <>
      <PageHeader
        icon={Droplets}
        eyebrow="ISO 14001 · 8.1 · 9.1.1"
        title="Stormwater outfalls"
        description="Where the site's stormwater leaves it, which permit covers each outfall, and a way to walk each one."
      />
      {facilityId
        ? <SiteOutfalls scope={scope} siteId={facilityId} siteName={facilityName ?? 'this site'} canAdmin={canAdmin} />
        : <SiteRequired />}
    </>
  )
}

interface SiteProps { scope: Scope; siteId: string; siteName: string; canAdmin: boolean }

function SiteOutfalls({ scope, siteId, siteName, canAdmin }: SiteProps) {
  const { site, error: siteError } = useEnvironmentalSite()
  const [loaded, setLoaded] = useState<{ outfalls: Outfall[]; permits: Permit[] } | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const [reloads, setReloads] = useState(0)
  const [editing, setEditing] = useState<{ outfall: Outfall | null } | null>(null)
  const [deleting, setDeleting] = useState<Outfall | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([listOutfalls(scope), listPermits(scope)])
      .then(([o, p]) => { if (!cancelled) { setLoaded({ outfalls: sortOutfallsByCode(o.outfalls), permits: p.permits }); setErrors([]) } })
      .catch(e => { if (!cancelled) setErrors(errorList(e)) })
    return () => { cancelled = true }
  }, [scope, reloads])

  const reload = () => setReloads(n => n + 1)

  return (
    <div className="space-y-5">
      <JurisdictionBanner site={site} />
      <HowToPanel pageKey="outfalls" state={site?.facility.state ?? null} />
      {siteError && <ErrorList errors={[siteError]} />}
      <ErrorList errors={errors} />

      {loaded === null && errors.length === 0 && <div className="flex justify-center py-16"><OpsSpinner /></div>}

      {loaded?.outfalls.length === 0 && (
        <EmptyState
          icon={Droplets}
          eyebrow="No outfalls"
          title="No outfalls listed yet"
          description={`An outfall is a point where stormwater leaves the site, such as a pipe, a ditch or a swale. List each one and you can inspect it on schedule, mark which are sampling points, and show which permit covers it.${canAdmin ? '' : ' A tenant admin can add them.'}`}
          action={canAdmin ? (
            <button type="button" className={primaryButtonCls} onClick={() => setEditing({ outfall: null })}>
              <Plus className="h-4 w-4" /> Add your first outfall
            </button>
          ) : undefined}
        />
      )}

      {loaded && loaded.outfalls.length > 0 && (
        <>
          {canAdmin && (
            <div className="flex justify-end">
              <button type="button" className={primaryButtonCls} onClick={() => setEditing({ outfall: null })}>
                <Plus className="h-4 w-4" /> Add outfall
              </button>
            </div>
          )}
          <OutfallsTable
            outfalls={loaded.outfalls}
            permits={loaded.permits}
            actions={canAdmin ? { onEdit: outfall => setEditing({ outfall }), onDelete: setDeleting } : undefined}
          />
        </>
      )}

      {editing && loaded && (
        <OutfallForm
          scope={scope} siteId={siteId} siteName={siteName}
          outfall={editing.outfall} outfalls={loaded.outfalls} permits={loaded.permits}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
      {deleting && (
        <DeleteOutfallDialog
          scope={scope} outfall={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => { setDeleting(null); reload() }}
        />
      )}
    </div>
  )
}
