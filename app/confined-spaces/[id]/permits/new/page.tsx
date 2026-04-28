'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type { ConfinedSpace } from '@/lib/types'
import { effectiveThresholds, SITE_DEFAULTS } from '@/lib/confinedSpaceThresholds'

// Permit issuance — creates the row in `pending_signature` state. The
// supervisor reviews the live permit page, takes the pre-entry atmospheric
// test there, then signs to activate. Splitting create-vs-sign is what
// makes §1910.146(f)(10) work properly: the test result has to be on the
// permit BEFORE the supervisor authorizes entry.
//
// Defaults pre-fill from the space (hazards, isolation hint, dept) so the
// 90% case is a few targeted edits rather than re-typing everything.

// Site policy and schema CHECK (migration 011) cap permit duration at one
// shift. OSHA wants permits to "not exceed task time" — capping at 8h
// forces a cancel + re-issue (and thus a fresh atmospheric test) for
// longer work, which is the safety win.
const MAX_PERMIT_HOURS = 8

function pad(n: number): string { return String(n).padStart(2, '0') }
function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function defaultExpiresAt(): string {
  const d = new Date()
  d.setHours(d.getHours() + MAX_PERMIT_HOURS)
  return toLocalInput(d)
}
function maxExpiresAt(): string {
  return defaultExpiresAt()
}

// Splits a multiline textarea on newlines, trims, drops empties.
function splitLines(s: string): string[] {
  return s.split('\n').map(l => l.trim()).filter(l => l.length > 0)
}

export default function NewPermitPage() {
  const params  = useParams<{ id: string }>()
  const router  = useRouter()
  const { userId } = useAuth()
  const spaceId = decodeURIComponent(params.id)

  const [space, setSpace]       = useState<ConfinedSpace | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Form fields
  const [purpose, setPurpose]                       = useState('')
  const [expiresAt, setExpiresAt]                   = useState(defaultExpiresAt)
  const [entrants, setEntrants]                     = useState('')
  const [attendants, setAttendants]                 = useState('')
  const [hazardsText, setHazardsText]               = useState('')
  const [isolationText, setIsolationText]           = useState('')
  const [equipmentText, setEquipmentText]           = useState('')
  const [communicationMethod, setCommunicationMethod] = useState('Voice contact + radio backup')
  const [rescueName, setRescueName]                 = useState('')
  const [rescuePhone, setRescuePhone]               = useState('')
  const [rescueEta, setRescueEta]                   = useState('')
  const [rescueEquipment, setRescueEquipment]       = useState('')
  const [concurrentPermits, setConcurrentPermits]   = useState('')
  const [workOrderRef, setWorkOrderRef]             = useState('')
  const [permitNotes, setPermitNotes]               = useState('')
  const [submitting, setSubmitting]                 = useState(false)
  const [serverError, setServerError]               = useState<string | null>(null)
  // AI suggester state — collapsed by default; appends to the form fields
  // rather than replacing so a partially-filled form isn't clobbered.
  const [aiOpen, setAiOpen]                         = useState(false)
  const [aiContext, setAiContext]                   = useState('')
  const [generating, setGenerating]                 = useState(false)
  const [aiError, setAiError]                       = useState<string | null>(null)

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
    const s = data as ConfinedSpace
    setSpace(s)
    // Prefill — saves typing in the 90% case.
    setHazardsText(s.known_hazards.join('\n'))
    if (s.isolation_required) setIsolationText(s.isolation_required)
    setLoading(false)
  }, [spaceId])

  useEffect(() => { load() }, [load])

  const thresholds = useMemo(
    () => effectiveThresholds(null, space),
    [space],
  )

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }
  if (notFound || !space) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Space not found.</p>
        <Link href="/confined-spaces" className="inline-block px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors">
          Back to list
        </Link>
      </div>
    )
  }

  const entrantList   = splitLines(entrants)
  const attendantList = splitLines(attendants)

  const trimmedPurpose = purpose.trim()
  const expiresDate    = expiresAt ? new Date(expiresAt) : null
  const validExpiry    = expiresDate && !Number.isNaN(expiresDate.getTime()) && expiresDate.getTime() > Date.now()
  // Site policy: max 8h. Schema enforces this via CHECK so the form is
  // a friendly first line of defense — without this clamp the user gets
  // a 400 from Postgres only on submit.
  const exceedsMax = validExpiry && (expiresDate!.getTime() - Date.now()) > MAX_PERMIT_HOURS * 3600_000
  const errors: string[] = []
  if (!trimmedPurpose)            errors.push('Purpose is required.')
  if (!validExpiry)                errors.push('Expiration must be a valid future date/time.')
  if (exceedsMax)                  errors.push(`Permits cannot exceed ${MAX_PERMIT_HOURS} hours. Cancel and re-issue with a fresh atmospheric test for longer work.`)
  if (entrantList.length === 0)    errors.push('At least one authorized entrant is required.')
  if (attendantList.length === 0)  errors.push('At least one attendant is required (§1910.146(i)).')
  if (!userId)                     errors.push('You must be logged in to create a permit.')

  // Append a generated list to an existing textarea value. Uses newlines
  // as the separator so the user sees suggestions next to anything they
  // already typed and can edit/delete by hand. Empty existing → just join.
  function appendLines(existing: string, additions: string[]): string {
    const trimmed = existing.trim()
    const joined  = additions.map(a => a.trim()).filter(Boolean).join('\n')
    if (!trimmed)  return joined
    if (!joined)   return existing
    return `${trimmed}\n${joined}`
  }

  async function handleGenerate() {
    if (!space) return
    setGenerating(true)
    setAiError(null)
    try {
      const res = await fetch('/api/generate-confined-space-hazards', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          space_id:           space.space_id,
          description:        space.description,
          department:         space.department,
          space_type:         space.space_type,
          classification:     space.classification,
          known_hazards:      space.known_hazards,
          isolation_required: space.isolation_required,
          equip_photo_url:    space.equip_photo_url,
          interior_photo_url: space.interior_photo_url,
          context:            aiContext.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Could not reach the AI service.' }))
        setAiError(body.error ?? 'Could not generate suggestions.')
        return
      }
      const json = await res.json() as {
        hazards:            string[]
        isolation_measures: string[]
        equipment_list:     string[]
        rescue_equipment:   string[]
        notes:              string
      }
      setHazardsText(prev   => appendLines(prev, json.hazards))
      setIsolationText(prev => appendLines(prev, json.isolation_measures))
      setEquipmentText(prev => appendLines(prev, json.equipment_list))
      setRescueEquipment(prev => appendLines(prev, json.rescue_equipment))
      if (json.notes && json.notes.trim()) {
        setPermitNotes(prev => prev.trim() ? `${prev.trim()}\n${json.notes.trim()}` : json.notes.trim())
      }
      setAiOpen(false)
      setAiContext('')
    } catch (err) {
      console.error('[generate-confined-space-hazards]', err)
      setAiError('Could not reach the AI service.')
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit() {
    if (errors.length > 0 || !validExpiry) return
    setSubmitting(true)
    setServerError(null)

    const payload = {
      space_id:            spaceId,
      purpose:             trimmedPurpose,
      expires_at:          expiresDate!.toISOString(),
      entry_supervisor_id: userId,
      attendants:          attendantList,
      entrants:            entrantList,
      hazards_present:     splitLines(hazardsText),
      isolation_measures:  splitLines(isolationText),
      equipment_list:      splitLines(equipmentText),
      communication_method: communicationMethod.trim() || null,
      rescue_service: {
        name:        rescueName.trim() || undefined,
        phone:       rescuePhone.trim() || undefined,
        eta_minutes: rescueEta ? Number(rescueEta) : undefined,
        equipment:   splitLines(rescueEquipment),
      },
      concurrent_permits:  concurrentPermits.trim() || null,
      work_order_ref:      workOrderRef.trim() || null,
      notes:               permitNotes.trim() || null,
    }

    const { data, error } = await supabase
      .from('loto_confined_space_permits')
      .insert(payload)
      .select('id')
      .single()

    if (error || !data) {
      setServerError(error?.message ?? 'Could not create permit.')
      setSubmitting(false)
      return
    }

    router.push(`/confined-spaces/${encodeURIComponent(spaceId)}/permits/${data.id}`)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between">
        <Link href={`/confined-spaces/${encodeURIComponent(spaceId)}`} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          ← Back to space
        </Link>
      </div>

      <header className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Issue Entry Permit</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          For <span className="font-mono font-semibold">{space.space_id}</span> — {space.description}
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1">
          The permit is created in <strong>pending signature</strong> state. After you take the
          pre-entry atmospheric test on the next page, sign to authorize entry per §1910.146(f)(6).
        </p>
      </header>

      {/* ── AI suggester ───────────────────────────────────────────────────
          Appends suggested hazards, isolation steps, equipment, and rescue
          gear to the form fields so the supervisor reviews each item before
          saving. The space's photos are passed through to Sonnet 4.6 so
          visible disconnects, manways, and residue inform the output. */}
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 dark:bg-violet-950/40/60 p-3 space-y-2">
        {aiOpen ? (
          <>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-violet-900">✨ Suggest hazards & equipment with AI</span>
              <button
                type="button"
                onClick={() => { setAiOpen(false); setAiContext(''); setAiError(null) }}
                disabled={generating}
                className="text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
              >
                Cancel
              </button>
            </div>
            <textarea
              rows={2}
              value={aiContext}
              onChange={e => setAiContext(e.target.value)}
              disabled={generating}
              placeholder="Optional — anything the photos / description don't already say (e.g. 'recently CIP'd, residual caustic possible' or 'top-entry only via 18-inch manway')"
              className="w-full rounded-lg border border-violet-200 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-400 disabled:opacity-60"
            />
            {aiError && (
              <p className="text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded px-2 py-1">{aiError}</p>
            )}
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-violet-900/80 leading-snug">
                AI suggestions — qualified safety professional must review before issuing the permit.
              </p>
              <button
                type="button"
                onClick={handleGenerate}
                disabled={generating}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50"
              >
                {generating ? 'Generating…' : 'Generate'}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="w-full flex items-center justify-center gap-2 text-sm font-semibold text-violet-700 dark:text-violet-300 hover:text-violet-900 py-1"
          >
            <span>✨</span>
            <span>Suggest hazards &amp; equipment with AI</span>
          </button>
        )}
      </div>

      <Section title="Purpose & Duration">
        <Field label="Purpose of entry" required>
          <input
            type="text"
            value={purpose}
            onChange={e => setPurpose(e.target.value)}
            placeholder="e.g. Replace level sensor, Internal weld repair, CIP residue inspection"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Permit expires" required hint={`Capped at ${MAX_PERMIT_HOURS} hours per §(f)(3) + site policy`}>
          <input
            type="datetime-local"
            value={expiresAt}
            max={maxExpiresAt()}
            onChange={e => setExpiresAt(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      <Section title="Personnel" hint="Names — one per line">
        <Field label="Authorized entrants" required>
          <textarea
            rows={3}
            value={entrants}
            onChange={e => setEntrants(e.target.value)}
            placeholder="Jane Doe&#10;John Smith"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy font-mono"
          />
        </Field>
        <Field label="Attendant(s)" required hint="Stays outside throughout entry per §(i)">
          <textarea
            rows={2}
            value={attendants}
            onChange={e => setAttendants(e.target.value)}
            placeholder="Alex Kim"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy font-mono"
          />
        </Field>
      </Section>

      <Section title="Hazards & Isolation" hint="One per line">
        <Field label="Hazards present" hint="Pre-filled from this space's known hazards">
          <textarea
            rows={3}
            value={hazardsText}
            onChange={e => setHazardsText(e.target.value)}
            placeholder="Engulfment risk&#10;H2S evolution from CIP residue&#10;Limited egress"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Isolation measures" hint="LOTO refs, ventilation, purging, flushing — one per line">
          <textarea
            rows={3}
            value={isolationText}
            onChange={e => setIsolationText(e.target.value)}
            placeholder="LOTO on EQ-MIX-04 main disconnect&#10;Forced-air ventilation @ 200 CFM through top manway"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      <Section title="Acceptable Atmospheric Conditions" hint={space.acceptable_conditions ? 'From space override' : 'Site defaults'}>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
          Pre-entry and periodic tests must hit these targets. The test entry on the next page colors red/green
          against these values.
        </p>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <Stat label="O₂ min"  value={`${thresholds.o2_min}%`} />
          <Stat label="O₂ max"  value={`${thresholds.o2_max}%`} />
          <Stat label="LEL max" value={`${thresholds.lel_max}%`} />
          <Stat label="H₂S max" value={`${thresholds.h2s_max} ppm`} />
          <Stat label="CO max"  value={`${thresholds.co_max} ppm`} />
        </dl>
        {!space.acceptable_conditions && (
          <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1.5">
            Defaults: O₂ {SITE_DEFAULTS.o2_min}–{SITE_DEFAULTS.o2_max}%, LEL &lt;{SITE_DEFAULTS.lel_max}%,
            H₂S &lt;{SITE_DEFAULTS.h2s_max} ppm, CO &lt;{SITE_DEFAULTS.co_max} ppm.
          </p>
        )}
      </Section>

      <Section title="Communication & Rescue">
        <Field label="Communication method" hint="§(f)(12) — radio, voice, line-of-sight, etc.">
          <input
            type="text"
            value={communicationMethod}
            onChange={e => setCommunicationMethod(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Rescue service" hint="§(f)(11)">
            <input
              type="text"
              value={rescueName}
              onChange={e => setRescueName(e.target.value)}
              placeholder="Site rescue team"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
          <Field label="Phone">
            <input
              type="tel"
              value={rescuePhone}
              onChange={e => setRescuePhone(e.target.value)}
              placeholder="x4444"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
          <Field label="ETA (min)">
            <input
              type="number"
              min={0}
              value={rescueEta}
              onChange={e => setRescueEta(e.target.value)}
              placeholder="5"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </Field>
        </div>
        <Field label="Rescue equipment" hint="One per line">
          <textarea
            rows={2}
            value={rescueEquipment}
            onChange={e => setRescueEquipment(e.target.value)}
            placeholder="Tripod + winch + full-body harness&#10;SCBA"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      <Section title="Equipment & Other">
        <Field label="Equipment in use" hint="§(f)(13) — PPE, monitors, alarms, lighting; one per line">
          <textarea
            rows={3}
            value={equipmentText}
            onChange={e => setEquipmentText(e.target.value)}
            placeholder="4-gas monitor (BW MicroClip XL)&#10;FR coveralls&#10;Hard hat with chin strap"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Concurrent permits" hint="§(f)(15) — hot work, line-break, etc.">
          <input
            type="text"
            value={concurrentPermits}
            onChange={e => setConcurrentPermits(e.target.value)}
            placeholder="Hot work permit #HW-2026-118"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Work order ref" hint="upstream CMMS reference — renders as a link if your org has a URL template configured">
          <input
            type="text"
            value={workOrderRef}
            onChange={e => setWorkOrderRef(e.target.value)}
            placeholder="WO-2026-04-1234"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
        <Field label="Additional notes" hint="§(f)(14)">
          <textarea
            rows={2}
            value={permitNotes}
            onChange={e => setPermitNotes(e.target.value)}
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </Field>
      </Section>

      {errors.length > 0 && (
        <ul className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-900 dark:text-amber-100 space-y-0.5">
          {errors.map(e => <li key={e}>• {e}</li>)}
        </ul>
      )}
      {serverError && (
        <p className="text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 rounded-md px-3 py-2">{serverError}</p>
      )}

      <div className="flex items-center justify-end gap-2 sticky bottom-0 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm py-3 -mx-4 px-4 border-t border-slate-200 dark:border-slate-700">
        <Link
          href={`/confined-spaces/${encodeURIComponent(spaceId)}`}
          className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
        >
          Cancel
        </Link>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={errors.length > 0 || submitting}
          className="px-5 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {submitting ? 'Creating…' : 'Create permit (pending signature)'}
        </button>
      </div>
    </div>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-3">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#214487]">{title}</h2>
        {hint && <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>}
      </header>
      {children}
    </section>
  )
}

function Field({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-slate-600 dark:text-slate-300 flex items-baseline gap-1.5">
        <span>{label}{required && <span className="text-rose-500 ml-0.5">*</span>}</span>
        {hint && <span className="text-slate-400 dark:text-slate-500 font-normal text-[11px]">{hint}</span>}
      </label>
      {children}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 px-2 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800 dark:text-slate-200 font-mono">{value}</dd>
    </div>
  )
}
