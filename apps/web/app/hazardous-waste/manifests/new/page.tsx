'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { parseFacilityProfile, type FieldError } from '@soteria/core/hazardousWaste'
import { normalizeWasteCodes } from '@soteria/core/hazardousWasteManifest'
import {
  CONTAINER_STATUS_LABEL, manifestFormDefaults, manifestFormToBody, splitWasteCodes, type ManifestFormValues, type ShippableContainer,
} from '@/lib/hazardousWasteManifestView'
import { ManifestFieldsForm } from '../_components/ManifestFieldsForm'
import { ManifestApiError, createManifest, listShippableContainers } from '../_lib/manifestClient'

// New manifest: pick the closed containers going out on this shipment, then the details. The
// manifest is drafted, not shipped: its containers move to "In shipment" now so no one puts them on
// a second manifest, and the draft can be cancelled to put them back.

export default function NewHazardousWasteManifestPage() {
  const router = useRouter()
  const { tenant } = useTenant()
  const { facility } = useFacility()
  const tenantId = tenant?.id

  const [containers, setContainers] = useState<ShippableContainer[] | null>(null)
  const [total, setTotal]           = useState(0)
  const [selected, setSelected]     = useState<ReadonlySet<string>>(new Set())
  const [values, setValues]         = useState<ManifestFormValues>(() => manifestFormDefaults(null))
  const [edited, setEdited]         = useState(false)
  const [loadError, setLoadError]   = useState<string | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [submitting, setSubmitting] = useState(false)

  // The site's generator profile arrives after the page does; it fills the form only until the person has touched it.
  const profile = useMemo(() => (facility ? parseFacilityProfile(facility.settings) : null), [facility])
  useEffect(() => {
    if (!edited) setValues(manifestFormDefaults(profile))
  }, [profile, edited])

  const changeValues = (next: ManifestFormValues) => {
    setEdited(true)
    setValues(next)
  }

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const result = await listShippableContainers(tenantId)
      setContainers(result.containers)
      setTotal(result.total)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
      setContainers([])
    }
  }, [tenantId])

  useEffect(() => { void load() }, [load])

  const chosen = useMemo(() => (containers ?? []).filter(c => selected.has(c.id)), [containers, selected])

  // Codes the chosen containers' streams already carry: offered, never filled in unasked.
  const suggestedCodes = useMemo(
    () => normalizeWasteCodes(chosen.flatMap(c => c.stream?.waste_codes ?? [])),
    [chosen],
  )

  const toggle = (id: string) => setSelected(previous => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!tenantId) { setError('No active tenant'); return }
    setError(null)
    setFieldErrors([])
    setSubmitting(true)
    try {
      const { manifest } = await createManifest(tenantId, { ...manifestFormToBody(values), container_ids: [...selected] })
      router.push(`/hazardous-waste/manifests/${manifest.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (e instanceof ManifestApiError) setFieldErrors(e.fieldErrors)
      setSubmitting(false)
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste/manifests" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Manifests
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">New manifest</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {facility ? <>Closed containers at <strong>{facility.name}</strong>. </> : <>Closed containers at every site; a manifest covers one site. </>}
          Drafting the manifest moves the containers you choose to In shipment.
        </p>
      </header>

      {loadError && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {loadError}
        </div>
      )}

      {containers === null && (
        <div role="status" className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading containers…
        </div>
      )}

      {containers && containers.length === 0 && !loadError && (
        <div className="rounded-md border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No closed containers {facility ? 'at this site' : ''} to ship. A container goes on a manifest once it is{' '}
          {CONTAINER_STATUS_LABEL.closed.toLowerCase()}: <Link href="/hazardous-waste/containers" className="text-brand-navy underline">close one on the Containers page</Link>.
        </div>
      )}

      {containers && containers.length > 0 && (
        <form onSubmit={onSubmit} className="space-y-6">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">Containers on this shipment</legend>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {selected.size} of {containers.length} selected{total > containers.length ? ` (showing the first ${containers.length} of ${total})` : ''}.
            </p>
            <div className="flex gap-3 text-xs">
              <button type="button" onClick={() => setSelected(new Set(containers.map(c => c.id)))} className="font-semibold text-brand-navy underline">
                Select all
              </button>
              <button type="button" onClick={() => setSelected(new Set())} className="font-semibold text-brand-navy underline">
                Clear
              </button>
            </div>
            <ul className="space-y-2">
              {containers.map(container => (
                <li key={container.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
                  <div className="flex items-start gap-3">
                    <input
                      id={`container-${container.id}`} type="checkbox" checked={selected.has(container.id)} onChange={() => toggle(container.id)}
                      className="mt-1 h-4 w-4 rounded border-slate-300"
                    />
                    <label htmlFor={`container-${container.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block font-semibold text-slate-900 dark:text-slate-100">{container.label}</span>
                      <span className="block text-xs text-slate-500 dark:text-slate-400">
                        {[
                          container.stream?.name,
                          container.area_location,
                          container.volume_quantity != null && container.volume_unit ? `${container.volume_quantity} ${container.volume_unit}` : null,
                        ].filter(Boolean).join(' · ') || 'No details recorded'}
                      </span>
                    </label>
                  </div>
                </li>
              ))}
            </ul>
          </fieldset>

          <ManifestFieldsForm idPrefix="new" values={values} onChange={changeValues} fieldErrors={fieldErrors} disabled={submitting} />

          {suggestedCodes.length > 0 && normalizeWasteCodes(splitWasteCodes(values.wasteCodes)).join() !== suggestedCodes.join() && (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              The chosen containers&apos; streams carry {suggestedCodes.join(', ')}.{' '}
              <button type="button" onClick={() => changeValues({ ...values, wasteCodes: suggestedCodes.join(', ') })} className="font-semibold text-brand-navy underline">
                Use these waste codes
              </button>
            </p>
          )}

          {error && (
            <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-sm text-slate-700 dark:text-slate-200" aria-live="polite">
              {selected.size === 0
                ? 'Choose at least one container.'
                : `The ${selected.size} selected container${selected.size === 1 ? '' : 's'} will move to In shipment.`}
            </p>
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={submitting || selected.size === 0}
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Create draft manifest
              </button>
              <Link href="/hazardous-waste/manifests" className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100">
                Cancel
              </Link>
            </div>
          </div>
        </form>
      )}
    </main>
  )
}
