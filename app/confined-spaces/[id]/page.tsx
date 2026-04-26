'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import type {
  ConfinedSpace,
  ConfinedSpaceClassification,
  ConfinedSpaceType,
  ConfinedSpacePermit,
} from '@/lib/types'
import { permitState, SITE_DEFAULTS } from '@/lib/confinedSpaceThresholds'
import { SPACE_TYPE_LABELS, CLASSIFICATION_LABELS } from '@/lib/confinedSpaceLabels'
import SpacePhotoSlot from '@/components/confined/SpacePhotoSlot'

// Detail page for a single confined space. Read-mostly with an "Edit"
// affordance opening an inline form.

export default function ConfinedSpaceDetailPage() {
  const params  = useParams<{ id: string }>()
  const router  = useRouter()
  const spaceId = decodeURIComponent(params.id)

  const [space, setSpace]       = useState<ConfinedSpace | null>(null)
  const [permits, setPermits]   = useState<ConfinedSpacePermit[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [editOpen, setEditOpen] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('loto_confined_spaces')
      .select('*')
      .eq('space_id', spaceId)
      .single()

    if (error || !data) {
      setNotFound(true)
      setLoading(false)
      return
    }

    setSpace(data as ConfinedSpace)

    const { data: permitRows } = await supabase
      .from('loto_confined_space_permits')
      .select('*')
      .eq('space_id', spaceId)
      .order('started_at', { ascending: false })
      .limit(20)
    if (permitRows) setPermits(permitRows as ConfinedSpacePermit[])

    setLoading(false)
  }, [spaceId])

  useEffect(() => { load() }, [load])

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-center text-sm text-slate-400">Loading…</div>
  }

  if (notFound || !space) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700">Space not found.</p>
        <Link href="/confined-spaces" className="inline-block px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors">
          Back to list
        </Link>
      </div>
    )
  }

  const c = space.acceptable_conditions ?? SITE_DEFAULTS

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/confined-spaces" className="text-sm font-semibold text-slate-500 hover:text-slate-700">
          ← Back
        </Link>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditOpen(true)}
            className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
          >
            ✎ Edit details
          </button>
          <Link
            href={`/confined-spaces/${encodeURIComponent(space.space_id)}/permits/new`}
            className="px-3 py-1.5 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            + Issue permit
          </Link>
        </div>
      </div>

      <header className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="font-mono text-lg font-bold text-slate-900">{space.space_id}</h1>
          <ClassificationBadge value={space.classification} />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            {SPACE_TYPE_LABELS[space.space_type]}
          </span>
        </div>
        <p className="text-sm text-slate-700">{space.description}</p>
        <p className="text-xs text-slate-500">{space.department}</p>
        {space.entry_dimensions && (
          <p className="text-xs text-slate-500"><span className="font-semibold">Entry:</span> {space.entry_dimensions}</p>
        )}
      </header>

      <Section title="Photos" hint="Feed the AI hazard suggester — interior shots make the biggest difference">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SpacePhotoSlot
            spaceId={space.space_id}
            slot="exterior"
            label="Exterior / Approach"
            existingUrl={space.equip_photo_url}
            onUploaded={(url) => setSpace(prev => prev ? { ...prev, equip_photo_url: url } : prev)}
          />
          <SpacePhotoSlot
            spaceId={space.space_id}
            slot="interior"
            label="Interior / Manway"
            existingUrl={space.interior_photo_url}
            onUploaded={(url) => setSpace(prev => prev ? { ...prev, interior_photo_url: url } : prev)}
          />
        </div>
      </Section>

      <Section title="Known Hazards">
        {space.known_hazards.length === 0 ? (
          <p className="text-xs text-slate-400 italic">None recorded yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {space.known_hazards.map(h => (
              <li key={h} className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-[11px] font-semibold text-amber-900">
                {h}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="Acceptable Atmospheric Conditions"
        hint={space.acceptable_conditions ? 'Per-space override' : 'Site defaults'}
      >
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <Stat label="O₂ min"  value={`${c.o2_min ?? SITE_DEFAULTS.o2_min}%`} />
          <Stat label="O₂ max"  value={`${c.o2_max ?? SITE_DEFAULTS.o2_max}%`} />
          <Stat label="LEL max" value={`${c.lel_max ?? SITE_DEFAULTS.lel_max}%`} />
          <Stat label="H₂S max" value={`${c.h2s_max ?? SITE_DEFAULTS.h2s_max} ppm`} />
          <Stat label="CO max"  value={`${c.co_max ?? SITE_DEFAULTS.co_max} ppm`} />
        </dl>
      </Section>

      {space.isolation_required && (
        <Section title="Isolation Required">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{space.isolation_required}</p>
        </Section>
      )}

      {space.internal_notes && (
        <Section title="Internal Notes" hint="Private — never printed on a permit">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{space.internal_notes}</p>
        </Section>
      )}

      <Section title={`Recent Permits${permits.length > 0 ? ` (${permits.length})` : ''}`}>
        {permits.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No permits issued yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg overflow-hidden">
            {permits.map(p => (
              <li key={p.id}>
                <Link
                  href={`/confined-spaces/${encodeURIComponent(space.space_id)}/permits/${p.id}`}
                  className="block px-3 py-2 hover:bg-slate-50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{p.purpose}</p>
                      <p className="text-[11px] text-slate-500">
                        <span className="font-mono font-bold tracking-wider text-slate-600">{p.serial}</span>
                        {' · '}
                        {new Date(p.started_at).toLocaleString()}
                        {p.canceled_at && <> · <span className="font-semibold text-slate-700">canceled</span> ({p.cancel_reason})</>}
                      </p>
                    </div>
                    <PermitStatusBadge permit={p} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editOpen && (
        <EditDetailsDialog
          space={space}
          onClose={() => setEditOpen(false)}
          onSaved={(patched) => {
            setSpace(patched)
            setEditOpen(false)
          }}
          onDeleted={() => {
            // Decommissioning routes back to the list; the actual row stays
            // for retention. Hard delete is reserved for the Decommission UI
            // (existing pattern for equipment).
            router.push('/confined-spaces')
          }}
        />
      )}
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#214487]">{title}</h2>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 border border-slate-100 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 font-mono">{value}</dd>
    </div>
  )
}

function ClassificationBadge({ value }: { value: ConfinedSpaceClassification }) {
  const cls =
    value === 'permit_required' ? 'bg-rose-100 text-rose-800'
  : value === 'reclassified'    ? 'bg-amber-100 text-amber-800'
  :                                'bg-slate-100 text-slate-700'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {CLASSIFICATION_LABELS[value]}
    </span>
  )
}

function PermitStatusBadge({ permit }: { permit: ConfinedSpacePermit }) {
  const state = permitState(permit)
  const cls =
    state === 'active'             ? 'bg-emerald-100 text-emerald-800'
  : state === 'pending_signature'  ? 'bg-amber-100 text-amber-800'
  : state === 'expired'            ? 'bg-rose-100 text-rose-800'
  :                                  'bg-slate-100 text-slate-600'
  const label =
    state === 'active'             ? 'Active'
  : state === 'pending_signature'  ? 'Pending sig'
  : state === 'expired'            ? 'Expired'
  :                                  'Canceled'
  return (
    <span className={`shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${cls}`}>
      {label}
    </span>
  )
}

// ── Edit details dialog ─────────────────────────────────────────────────────
// Inline form covering the fields users would routinely edit on the inventory
// row. Photos, AI hazard generation, and acceptable-conditions overrides are
// follow-ups so this stays a simple 5-field form for now.

interface EditProps {
  space:     ConfinedSpace
  onClose:   () => void
  onSaved:   (patched: ConfinedSpace) => void
  onDeleted: () => void
}

function EditDetailsDialog({ space, onClose, onSaved, onDeleted }: EditProps) {
  const [description, setDescription]       = useState(space.description)
  const [department, setDepartment]         = useState(space.department)
  const [spaceType, setSpaceType]           = useState<ConfinedSpaceType>(space.space_type)
  const [classification, setClassification] = useState<ConfinedSpaceClassification>(space.classification)
  const [entryDimensions, setEntryDimensions] = useState(space.entry_dimensions ?? '')
  const [internalNotes, setInternalNotes]   = useState(space.internal_notes ?? '')
  const [submitting, setSubmitting]         = useState(false)
  const [serverError, setServerError]       = useState<string | null>(null)

  async function handleSave() {
    setSubmitting(true)
    setServerError(null)

    const patch = {
      description:      description.trim() || space.description,
      department:       department.trim()  || space.department,
      space_type:       spaceType,
      classification:   classification,
      entry_dimensions: entryDimensions.trim() || null,
      internal_notes:   internalNotes.trim()   || null,
      updated_at:       new Date().toISOString(),
    }

    const { data, error } = await supabase
      .from('loto_confined_spaces')
      .update(patch)
      .eq('space_id', space.space_id)
      .select('*')
      .single()

    if (error) {
      setServerError(error.message)
      setSubmitting(false)
      return
    }

    onSaved(data as ConfinedSpace)
  }

  async function handleDecommission() {
    setServerError(null)
    setSubmitting(true)
    // Hard gate: never let a supervisor hide a space while a permit is
    // signed-not-canceled on it. Entrants could literally still be inside.
    // We surface the blocking permits' serials so they know what to clear.
    const { data: blockers, error: blockerErr } = await supabase
      .from('loto_confined_space_permits')
      .select('serial')
      .eq('space_id', space.space_id)
      .is('canceled_at', null)
      .not('entry_supervisor_signature_at', 'is', null)
      .limit(5)
    if (blockerErr) {
      setServerError(blockerErr.message)
      setSubmitting(false)
      return
    }
    if (blockers && blockers.length > 0) {
      const serials = blockers.map(b => b.serial).filter(Boolean).join(', ')
      setServerError(
        `Cannot decommission — ${blockers.length} permit${blockers.length === 1 ? '' : 's'} still active or expired-uncancelled (${serials}). Cancel them first.`,
      )
      setSubmitting(false)
      return
    }
    if (!confirm(`Decommission ${space.space_id}? It will hide from the list but stay in the database for retention.`)) {
      setSubmitting(false)
      return
    }
    const { error } = await supabase
      .from('loto_confined_spaces')
      .update({ decommissioned: true, updated_at: new Date().toISOString() })
      .eq('space_id', space.space_id)
    if (error) {
      setServerError(error.message)
      setSubmitting(false)
      return
    }
    onDeleted()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 overflow-y-auto py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Edit Details</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none px-1"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="space-y-3">
          <Field label="Description">
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Department">
            <input
              type="text"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Type">
              <select
                value={spaceType}
                onChange={e => setSpaceType(e.target.value as ConfinedSpaceType)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              >
                {Object.entries(SPACE_TYPE_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </Field>

            <Field label="Classification">
              <select
                value={classification}
                onChange={e => setClassification(e.target.value as ConfinedSpaceClassification)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              >
                {Object.entries(CLASSIFICATION_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Entry Dimensions" hint="e.g. 24-inch top manway">
            <input
              type="text"
              value={entryDimensions}
              onChange={e => setEntryDimensions(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>

          <Field label="Internal Notes" hint="Private — never printed on a permit">
            <textarea
              rows={3}
              value={internalNotes}
              onChange={e => setInternalNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
        </div>

        {serverError && (
          <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{serverError}</p>
        )}

        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            onClick={handleDecommission}
            disabled={submitting}
            className="px-3 py-2 text-xs font-semibold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md transition-colors disabled:opacity-40"
          >
            Decommission
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={submitting}
              className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600">
        {label}
        {hint && <span className="text-slate-400 font-normal ml-1.5">{hint}</span>}
      </label>
      {children}
    </div>
  )
}
