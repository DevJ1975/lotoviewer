'use client'

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import type { FieldError } from '@soteria/core/hazardousWaste'
import type { ManifestAction } from '@soteria/core/hazardousWasteManifest'
import {
  CONTAINER_STATUS_LABEL, GENERATOR_CATEGORY_LABEL, MANIFEST_ACTION_LABEL, MANIFEST_STATUS_LABEL, formatDay, jurisdictionLabel,
  manifestFormFromRow, manifestFormToBody, type ManifestDetail, type ManifestFormValues,
} from '@/lib/hazardousWasteManifestView'
import { ManifestClockChip } from '../_components/ManifestClockChip'
import { ManifestFieldsForm } from '../_components/ManifestFieldsForm'
import { ManifestTimeline } from '../_components/ManifestTimeline'
import { ManifestTransitionPanel } from '../_components/ManifestTransitionPanel'
import { ManifestApiError, getManifest, transitionManifest, updateManifest } from '../_lib/manifestClient'

// One manifest: where it stands against the return clock, what can be done to it next (and what that
// does to its containers), the timeline, and its details. A draft's details can be edited; once it
// ships they are the record and are read-only.

export default function HazardousWasteManifestDetailPage() {
  const params = useParams<{ id: string }>()
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const id = params?.id

  const [manifest, setManifest] = useState<ManifestDetail | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [notice, setNotice]     = useState<string | null>(null)
  const [editing, setEditing]   = useState(false)
  const [values, setValues]     = useState<ManifestFormValues | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [saving, setSaving]     = useState(false)

  const load = useCallback(async () => {
    if (!tenantId || !id) return
    setError(null)
    try {
      setManifest((await getManifest(tenantId, id)).manifest)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenantId, id])

  useEffect(() => { void load() }, [load])

  async function onTransition(action: ManifestAction, on: string | null, note: string | null) {
    if (!tenantId || !id) return
    const { manifest: moved } = await transitionManifest(tenantId, id, { action, on, note })
    setManifest(moved)
    setNotice(`${MANIFEST_ACTION_LABEL[action]}: done. The manifest is now ${MANIFEST_STATUS_LABEL[moved.status].toLowerCase()}.`)
  }

  function startEditing() {
    if (!manifest) return
    setValues(manifestFormFromRow(manifest))
    setFieldErrors([])
    setNotice(null)
    setEditing(true)
  }

  async function onSave(event: FormEvent) {
    event.preventDefault()
    if (!tenantId || !id || !values) return
    setSaving(true)
    setError(null)
    setFieldErrors([])
    try {
      const { manifest: saved } = await updateManifest(tenantId, id, manifestFormToBody(values))
      setManifest(saved)
      setEditing(false)
      setNotice('Details saved.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      if (e instanceof ManifestApiError) setFieldErrors(e.fieldErrors)
    } finally {
      setSaving(false)
    }
  }

  const backLink = (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
      <Link href="/hazardous-waste/manifests" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Manifests
      </Link>
    </div>
  )

  if (!manifest) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {backLink}
        {error
          ? <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">{error}</div>
          : <div role="status" className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…</div>}
      </main>
    )
  }

  const canEditDetails = manifest.status === 'draft' && manifest.can_modify
  const clock = manifest.clock

  return (
    <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      {backLink}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            {manifest.manifest_tracking_number ?? 'Draft manifest'}
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            {manifest.containers.length} container{manifest.containers.length === 1 ? '' : 's'}
            {manifest.transporter_name ? <> · {manifest.transporter_name}</> : null}
            {manifest.tsdf_name ? <> to {manifest.tsdf_name}</> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ManifestClockChip item={manifest} />
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
            {MANIFEST_STATUS_LABEL[manifest.status]}
          </span>
        </div>
      </header>

      {notice && (
        <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
          {notice}
        </div>
      )}
      {error && editing === false && (
        <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      <Section title="Return clock">
        <p className="text-sm text-slate-700 dark:text-slate-200">{clock.note}</p>
        <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <Fact label="Follow-up due" value={clock.followUpOn ? formatDay(clock.followUpOn) : clock.applicable ? 'Not required' : '—'} />
          <Fact label="Exception report due" value={formatDay(clock.exceptionReportDueOn)} />
          <Fact label="Keep the signed copy until" value={formatDay(manifest.retention_end)} hint="Three years from shipping; your state may require longer." />
        </dl>
      </Section>

      <Section title="What you can do next">
        <ManifestTransitionPanel manifest={manifest} onTransition={onTransition} />
      </Section>

      <Section title="Timeline">
        <ManifestTimeline manifest={manifest} />
      </Section>

      <Section
        title="Details"
        action={canEditDetails && !editing
          ? <button type="button" onClick={startEditing} className="text-xs font-semibold text-brand-navy underline">Edit details</button>
          : null}
      >
        {editing && values ? (
          <form onSubmit={onSave} className="space-y-4">
            <ManifestFieldsForm idPrefix="edit" values={values} onChange={setValues} fieldErrors={fieldErrors} disabled={saving} />
            {error && (
              <div role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
                {error}
              </div>
            )}
            <div className="flex items-center gap-3">
              <button
                type="submit" disabled={saving}
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                Save details
              </button>
              <button
                type="button" onClick={() => { setEditing(false); setError(null) }}
                className="text-sm text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <Fact label="Generator category" value={GENERATOR_CATEGORY_LABEL[manifest.generator_category]} hint="As of the shipment; not recomputed." />
            <Fact label="Rules" value={jurisdictionLabel(manifest.jurisdiction)} />
            <Fact label="Generator EPA ID" value={manifest.generator_epa_id ?? '—'} />
            <Fact label="Submitted" value={manifest.electronic ? 'Through EPA e-Manifest' : 'On paper'} />
            <Fact label="Transporter" value={[manifest.transporter_name, manifest.transporter_epa_id].filter(Boolean).join(' · ') || '—'} />
            <Fact label="Receiving facility" value={[manifest.tsdf_name, manifest.tsdf_epa_id].filter(Boolean).join(' · ') || '—'} />
            <Fact label="Waste codes" value={manifest.waste_codes.length > 0 ? manifest.waste_codes.join(', ') : '—'} />
            <Fact label="Shipping description" value={manifest.dot_description ?? '—'} />
            <div className="sm:col-span-2"><Fact label="Notes" value={manifest.notes ?? '—'} preserveLines /></div>
          </dl>
        )}
      </Section>

      <Section title="Containers">
        <ul aria-label="Containers on this manifest" className="space-y-2">
          {manifest.containers.map(container => (
            <li key={container.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <div className="min-w-0">
                <p className="font-semibold text-slate-900 dark:text-slate-100">{container.label}</p>
                {container.stream_name && <p className="text-xs text-slate-500 dark:text-slate-400">{container.stream_name}</p>}
              </div>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                {CONTAINER_STATUS_LABEL[container.status]}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}

function Section({ title, action = null, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 p-5 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

function Fact({ label, value, hint, preserveLines = false }: { label: string; value: string; hint?: string; preserveLines?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-slate-800 dark:text-slate-200 ${preserveLines ? 'whitespace-pre-wrap' : ''}`}>{value}</dd>
      {hint && <dd className="text-[11px] text-slate-500 dark:text-slate-400">{hint}</dd>}
    </div>
  )
}
