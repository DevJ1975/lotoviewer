'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type {
  AtmosphericTest,
  AtmosphericTestKind,
  CancelReason,
  ConfinedSpace,
  ConfinedSpaceEntry,
  ConfinedSpacePermit,
  GasMeter,
} from '@/lib/types'
import {
  effectiveThresholds,
  evaluateChannel,
  evaluateTest,
  permitState,
  type ReadingStatus,
  type ThresholdSet,
} from '@/lib/confinedSpaceThresholds'
import { bumpStatus, calibrationOverdue } from '@/lib/gasMeters'
import { CANCEL_REASON_LABELS } from '@/lib/confinedSpaceLabels'

// Live permit page — the OSHA-compliant lifecycle:
//   1. Permit was created in pending_signature state
//   2. Tester records the pre-entry atmospheric reading here
//   3. Supervisor reviews readings + permit details
//   4. If pre-entry test passes thresholds → "Sign & activate" enables
//   5. Once active, periodic tests recorded as the entry continues
//   6. Permit is canceled (task complete or prohibited condition) — never deleted
//
// This single page covers all four states (pending / active / expired /
// canceled) by switching what's editable.

export default function PermitDetailPage() {
  const params  = useParams<{ id: string; permitId: string }>()
  const router  = useRouter()
  const { userId } = useAuth()
  const spaceId  = decodeURIComponent(params.id)
  const permitId = params.permitId

  const [space, setSpace]       = useState<ConfinedSpace | null>(null)
  const [permit, setPermit]     = useState<ConfinedSpacePermit | null>(null)
  const [tests, setTests]       = useState<AtmosphericTest[]>([])
  const [entries, setEntries]   = useState<ConfinedSpaceEntry[]>([])
  // Map by instrument_id for the bump-test warning. Fetched once at load —
  // small table (≤ a few dozen meters per site). Pre-migration-012 sites
  // get an empty map and the form renders without warnings.
  const [meters, setMeters]     = useState<Map<string, GasMeter>>(new Map())
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [signing, setSigning]   = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  // Bias the cancel dialog toward prohibited_condition when the user opens
  // it from the evacuation banner (vs. the regular Cancel button).
  const [cancelInitialReason, setCancelInitialReason] = useState<CancelReason>('task_complete')

  const load = useCallback(async () => {
    const [spaceRes, permitRes, testsRes, entriesRes, metersRes] = await Promise.all([
      supabase.from('loto_confined_spaces').select('*').eq('space_id', spaceId).single(),
      supabase.from('loto_confined_space_permits').select('*').eq('id', permitId).single(),
      supabase.from('loto_atmospheric_tests').select('*').eq('permit_id', permitId).order('tested_at', { ascending: false }),
      supabase.from('loto_confined_space_entries').select('*').eq('permit_id', permitId).order('entered_at', { ascending: false }),
      supabase.from('loto_gas_meters').select('*').eq('decommissioned', false),
    ])
    if (spaceRes.error || permitRes.error || !spaceRes.data || !permitRes.data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setSpace(spaceRes.data as ConfinedSpace)
    setPermit(permitRes.data as ConfinedSpacePermit)
    if (testsRes.data) setTests(testsRes.data as AtmosphericTest[])
    // entries / meters tables come from migration 012; if it hasn't been
    // applied yet, both queries return an error and we leave the state
    // empty. The UI degrades — no in/out log, no bump-test warning — but
    // doesn't break the rest of the page.
    if (entriesRes.data) setEntries(entriesRes.data as ConfinedSpaceEntry[])
    if (metersRes.data) {
      const m = new Map<string, GasMeter>()
      for (const row of metersRes.data as GasMeter[]) m.set(row.instrument_id, row)
      setMeters(m)
    }
    setLoading(false)
  }, [spaceId, permitId])

  useEffect(() => { load() }, [load])

  const thresholds = useMemo(() => effectiveThresholds(permit, space), [permit, space])
  const state      = useMemo(() => permit ? permitState(permit) : null, [permit])

  // Pre-entry test = the most recent test marked pre_entry. Sign-to-activate
  // requires one to exist AND pass thresholds.
  const preEntryTest = useMemo(
    () => tests.find(t => t.kind === 'pre_entry') ?? null,
    [tests],
  )
  const preEntryStatus = useMemo(
    () => preEntryTest ? evaluateTest(preEntryTest, thresholds).status : 'unknown' as ReadingStatus,
    [preEntryTest, thresholds],
  )

  // Prohibited-condition watchdog: tests are sorted newest-first, so a
  // failing tests[0] on an active permit means the most recent reading
  // crossed a threshold. §1910.146(e)(5)(ii) requires immediate evacuation
  // and permit cancellation. We surface a red banner — but don't auto-
  // cancel, because meter glitches happen and the supervisor must own the
  // call to evacuate.
  const latestTest   = tests[0] ?? null
  const latestStatus = latestTest ? evaluateTest(latestTest, thresholds).status : null

  if (loading) {
    return <div className="max-w-3xl mx-auto px-4 py-10 text-center text-sm text-slate-400">Loading…</div>
  }
  if (notFound || !space || !permit) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700">Permit not found.</p>
        <Link href={`/confined-spaces/${encodeURIComponent(spaceId)}`} className="inline-block px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors">
          Back to space
        </Link>
      </div>
    )
  }

  // Computed AFTER the null-guard so `permit` is narrowed to non-null. The
  // reads here would type-check above too if we used `permit?.x`, but the
  // narrow form keeps the intent obvious — alert depends on a real permit.
  const showEvacuationAlert = permit.entry_supervisor_signature_at && !permit.canceled_at && latestStatus === 'fail'

  // PDF download — opens the generated PDF in a new tab rather than using
  // a programmatic anchor click. The latter is silently ignored by iOS
  // Safari (especially in PWA standalone mode), which is where most field
  // users open this app. Opening in a new tab gives iOS the native PDF
  // viewer with Share / Save to Files / Print built in, and on desktop
  // Chrome/Safari the new tab shows a normal "Save / Print" PDF chrome.
  // Any failure surfaces via the existing serverError banner.
  async function handleDownloadPdf() {
    setServerError(null)
    try {
      const { generatePermitPdf } = await import('@/lib/pdfPermit')
      const permitUrl = `${window.location.origin}/confined-spaces/${encodeURIComponent(spaceId)}/permits/${permit!.id}`
      const bytes = await generatePermitPdf({ space: space!, permit: permit!, tests, permitUrl })
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
      const url  = URL.createObjectURL(blob)
      const filename = `${permit!.serial ?? `permit-${permit!.id.slice(0, 8)}`}.pdf`

      // Try opening the blob in a new tab first — most platform-agnostic
      // path. window.open returns null when popups are blocked.
      const newWin = window.open(url, '_blank', 'noopener,noreferrer')
      if (!newWin) {
        // Popup blocked — fall back to anchor click which at least triggers
        // a download on Chrome/Edge/Firefox even when popups are blocked.
        const a = document.createElement('a')
        a.href     = url
        a.download = filename
        a.rel      = 'noopener noreferrer'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
      }

      // Long delay so the new tab has time to load the PDF before the
      // blob URL is revoked. 60s is plenty; the URL is just memory and
      // gets cleaned up when the tab navigates away anyway.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      console.error('[permit-pdf] download failed', err)
      setServerError(`Could not generate PDF: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  // ── sign & activate ──────────────────────────────────────────────────────
  async function handleSign() {
    if (!userId) return
    if (!preEntryTest) {
      setServerError('Take a pre-entry atmospheric test before signing.')
      return
    }
    if (preEntryStatus !== 'pass') {
      setServerError('Pre-entry test does not meet acceptable thresholds — entry cannot be authorized.')
      return
    }
    // §1910.146(f)(11) — rescue service must be identified on the permit
    // before entry is authorized. Require name + at least one contact path
    // (phone for outside service, ETA for an in-house team).
    const r = permit!.rescue_service
    if (!r?.name?.trim() || (!r?.phone?.trim() && r?.eta_minutes == null)) {
      setServerError('Rescue service is incomplete — name and either a phone number or ETA are required before signing (§1910.146(f)(11)).')
      return
    }
    setSigning(true)
    setServerError(null)
    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('loto_confined_space_permits')
      .update({ entry_supervisor_signature_at: now, updated_at: now })
      .eq('id', permitId)
      .select('*')
      .single()
    if (error || !data) {
      setServerError(error?.message ?? 'Could not sign the permit.')
      setSigning(false)
      return
    }
    setPermit(data as ConfinedSpacePermit)
    setSigning(false)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/confined-spaces/${encodeURIComponent(spaceId)}`} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
          ← Back to space
        </Link>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadPdf}
            className="text-xs font-semibold text-brand-navy hover:underline"
          >
            ⬇ Download PDF
          </button>
          <span className="text-[11px] text-slate-500 font-mono font-bold tracking-wider">{permit.serial}</span>
        </div>
      </div>

      <StatusBanner state={state!} permit={permit} />

      <header className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-bold text-slate-900">{permit.purpose}</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              <span className="font-mono font-semibold">{space.space_id}</span> — {space.description}
            </p>
          </div>
          <p className="text-[11px] text-slate-500">
            Started <strong>{new Date(permit.started_at).toLocaleString()}</strong>
            {' · expires '}
            <strong>{new Date(permit.expires_at).toLocaleString()}</strong>
          </p>
        </div>
      </header>

      {serverError && (
        <p className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{serverError}</p>
      )}

      <Section title="Personnel">
        <PersonnelRow label="Entry supervisor" values={[permit.entry_supervisor_id.slice(0, 8) + ' (you sign with this account)']} />
        <PersonnelRow label="Authorized entrants" values={permit.entrants} />
        <PersonnelRow label="Attendant(s)" values={permit.attendants} />
      </Section>

      <Section title="Hazards & Isolation">
        <Roster label="Hazards present" items={permit.hazards_present} emptyLabel="None recorded" />
        <Roster label="Isolation measures" items={permit.isolation_measures} emptyLabel="None recorded" />
      </Section>

      <Section title="Acceptable Atmospheric Conditions" hint={permit.acceptable_conditions_override ? 'Permit override' : space.acceptable_conditions ? 'From space override' : 'Site defaults'}>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <Stat label="O₂ min"  value={`${thresholds.o2_min}%`} />
          <Stat label="O₂ max"  value={`${thresholds.o2_max}%`} />
          <Stat label="LEL max" value={`${thresholds.lel_max}%`} />
          <Stat label="H₂S max" value={`${thresholds.h2s_max} ppm`} />
          <Stat label="CO max"  value={`${thresholds.co_max} ppm`} />
        </dl>
      </Section>

      <Section title="Communication & Rescue">
        <p className="text-xs"><span className="font-semibold text-slate-700">Communication:</span> {permit.communication_method ?? <em className="text-slate-400">not set</em>}</p>
        <RescueDisplay rescue={permit.rescue_service} />
      </Section>

      {(permit.equipment_list.length > 0 || permit.concurrent_permits || permit.notes) && (
        <Section title="Equipment & Other">
          {permit.equipment_list.length > 0 && (
            <Roster label="Equipment in use" items={permit.equipment_list} emptyLabel="None recorded" />
          )}
          {permit.concurrent_permits && (
            <p className="text-xs"><span className="font-semibold text-slate-700">Concurrent permits:</span> {permit.concurrent_permits}</p>
          )}
          {permit.notes && (
            <p className="text-xs"><span className="font-semibold text-slate-700">Notes:</span> {permit.notes}</p>
          )}
        </Section>
      )}

      {showEvacuationAlert && latestTest && (
        <div className="bg-rose-600 text-white rounded-xl px-4 py-3 space-y-2 ring-2 ring-rose-300 ring-offset-2">
          <p className="text-[11px] font-bold uppercase tracking-widest opacity-90">⚠ Prohibited condition detected</p>
          <p className="text-sm">
            Most recent reading at <strong>{new Date(latestTest.tested_at).toLocaleTimeString()}</strong> exceeds
            acceptable thresholds. OSHA §1910.146(e)(5)(ii) requires immediate evacuation and permit cancellation.
          </p>
          <button
            type="button"
            onClick={() => { setCancelInitialReason('prohibited_condition'); setCancelOpen(true) }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-rose-700 text-sm font-bold hover:bg-rose-50 transition-colors"
          >
            Evacuate &amp; cancel permit →
          </button>
        </div>
      )}

      <Section title={`Atmospheric Tests${tests.length > 0 ? ` (${tests.length})` : ''}`}>
        {state !== 'canceled' && state !== 'expired' && (
          <NewTestForm
            permitId={permitId}
            userId={userId}
            kindHint={preEntryTest ? 'periodic' : 'pre_entry'}
            thresholds={thresholds}
            meters={meters}
            onSaved={(t) => setTests(prev => [t, ...prev])}
          />
        )}
        {tests.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No tests recorded yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {tests.map(t => (
              <TestRow key={t.id} test={t} thresholds={thresholds} />
            ))}
          </ul>
        )}
      </Section>

      {/* Multi-party authorization. The supervisor's signature above is the
          OSHA-mandated authorization (§(f)(6)); these strengthen the audit
          trail when the site requires the attendant to sign on duty and
          when the supervisor wants to attest the entrants were briefed
          on hazards. Both are optional — never block entry. */}
      {(state === 'active' || state === 'canceled' || state === 'expired') && (
        <Section title="Authorization & Acknowledgements">
          <AuthorizationBlock
            permit={permit}
            readOnly={state !== 'active'}
            onUpdated={setPermit}
          />
        </Section>
      )}

      {/* Entrant in/out log per §1910.146(i)(4) — the attendant must know
          who is inside the space at any moment. Renders for active permits
          (live log + in/out buttons) and as read-only history for canceled
          / expired permits. Pending-signature permits don't render this:
          entrants can't enter until the permit is signed. */}
      {state !== 'pending_signature' && (
        <Section title="Entrant Log">
          <EntrantLog
            permit={permit}
            entries={entries}
            attendantUserId={userId}
            readOnly={state === 'canceled' || state === 'expired'}
            onEntered={(row) => setEntries(prev => [row, ...prev])}
            onExited={(row) => setEntries(prev => prev.map(e => e.id === row.id ? row : e))}
          />
        </Section>
      )}

      {state === 'pending_signature' && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
          <h3 className="text-sm font-bold text-emerald-900">Sign & activate this permit</h3>
          <p className="text-[11px] text-emerald-900/80">
            By signing you authorize entry per §1910.146(f)(6). The permit becomes active immediately.
            {' '}{!preEntryTest
              ? 'A pre-entry atmospheric test is required first.'
              : preEntryStatus !== 'pass'
              ? 'Pre-entry test must pass thresholds before signing.'
              : 'Pre-entry test passes — ready to sign.'}
          </p>
          <button
            type="button"
            onClick={handleSign}
            disabled={signing || !preEntryTest || preEntryStatus !== 'pass'}
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700 transition-colors"
          >
            {signing ? 'Signing…' : '✓ Sign & activate permit'}
          </button>
        </div>
      )}

      {state === 'active' && (
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={() => { setCancelInitialReason('task_complete'); setCancelOpen(true) }}
            className="px-4 py-2 rounded-lg border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
          >
            Cancel permit
          </button>
        </div>
      )}

      {/* Expired-but-uncancelled — supervisors must positively close out per
          §1910.146(e)(5). Without this button there's no UI path to clear an
          expired permit, leaving it stuck in the home Critical Alert banner. */}
      {state === 'expired' && (
        <div className="rounded-xl bg-rose-50 border border-rose-200 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-rose-900/80">
            This permit ran past expiration without being formally closed. Close it out
            now to clear the alert and lock in the audit trail.
          </p>
          <button
            type="button"
            onClick={() => { setCancelInitialReason('expired'); setCancelOpen(true) }}
            className="shrink-0 px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 transition-colors"
          >
            Close out expired permit
          </button>
        </div>
      )}

      {cancelOpen && permit && (
        <CancelDialog
          permit={permit}
          initialReason={cancelInitialReason}
          hasPreEntryTest={!!preEntryTest}
          onClose={() => setCancelOpen(false)}
          onCanceled={(updated) => {
            setPermit(updated)
            setCancelOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── Status banner ──────────────────────────────────────────────────────────

function StatusBanner({ state, permit }: { state: NonNullable<ReturnType<typeof permitState>>; permit: ConfinedSpacePermit }) {
  const cfg = state === 'active' ? {
    label: 'ACTIVE',
    bg:    'bg-emerald-600',
    detail: `Signed ${permit.entry_supervisor_signature_at ? new Date(permit.entry_supervisor_signature_at).toLocaleString() : ''} — entry authorized`,
  } : state === 'pending_signature' ? {
    label: 'PENDING SIGNATURE',
    bg:    'bg-amber-500',
    detail: 'Take pre-entry atmospheric test below, then sign to authorize entry.',
  } : state === 'canceled' ? {
    label: 'CANCELED',
    bg:    'bg-slate-600',
    detail: `Canceled ${permit.canceled_at ? new Date(permit.canceled_at).toLocaleString() : ''} — ${permit.cancel_reason ?? ''}${permit.cancel_notes ? `: ${permit.cancel_notes}` : ''}`,
  } : {
    label: 'EXPIRED',
    bg:    'bg-rose-600',
    detail: `Expired ${new Date(permit.expires_at).toLocaleString()} without cancellation. Cancel manually if entry is complete.`,
  }
  return (
    <div className={`${cfg.bg} text-white rounded-xl px-4 py-3`}>
      <p className="text-[11px] font-bold uppercase tracking-widest opacity-80">{cfg.label}</p>
      <p className="text-sm mt-0.5">{cfg.detail}</p>
    </div>
  )
}

// ── Personnel / hazards / equipment chips ──────────────────────────────────

function PersonnelRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 w-32 shrink-0">{label}</span>
      {values.length === 0 ? (
        <span className="text-xs text-slate-400 italic">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className="px-2 py-0.5 rounded-md bg-slate-100 text-[11px] text-slate-800 font-mono">{v}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Roster({ label, items, emptyLabel }: { label: string; items: string[]; emptyLabel: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 italic">{emptyLabel}</p>
      ) : (
        <ul className="space-y-0.5 list-disc list-inside marker:text-slate-300">
          {items.map((it, i) => (
            <li key={`${it}-${i}`} className="text-xs text-slate-700">{it}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RescueDisplay({ rescue }: { rescue: ConfinedSpacePermit['rescue_service'] }) {
  if (!rescue || Object.keys(rescue).length === 0) {
    return <p className="text-xs text-slate-400 italic">No rescue service recorded.</p>
  }
  return (
    <p className="text-xs">
      <span className="font-semibold text-slate-700">Rescue:</span>{' '}
      {rescue.name ?? 'unnamed'}
      {rescue.phone && <> · <span className="font-mono">{rescue.phone}</span></>}
      {rescue.eta_minutes != null && <> · ETA {rescue.eta_minutes} min</>}
      {rescue.equipment && rescue.equipment.length > 0 && (
        <> · {rescue.equipment.join(', ')}</>
      )}
    </p>
  )
}

// ── Multi-party authorization block ────────────────────────────────────────
//
// Two optional signatures on top of the supervisor's mandatory authorization:
//   - Attendant on duty (§(i)) — picks a name from the attendants[] roster,
//     clicks to sign on. Times the moment they took post.
//   - Entrant briefing acknowledgement (§(f)(6)) — supervisor attests the
//     entrants were briefed on hazards. Single timestamp; the briefing is
//     a group act, not per-entrant.
//
// Both are write-once for now — once recorded, we surface the timestamp.
// Re-attestation can be done on a fresh permit if the situation changes.

function AuthorizationBlock({
  permit, readOnly, onUpdated,
}: {
  permit:    ConfinedSpacePermit
  readOnly:  boolean
  onUpdated: (updated: ConfinedSpacePermit) => void
}) {
  const [attendantPick, setAttendantPick] = useState<string>(permit.attendants[0] ?? '')
  const [busy, setBusy]   = useState<null | 'attendant' | 'briefing'>(null)
  const [error, setError] = useState<string | null>(null)

  async function signAsAttendant() {
    if (!attendantPick.trim()) { setError('Pick the attendant name first.'); return }
    setBusy('attendant'); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({
        attendant_signature_at:   now,
        attendant_signature_name: attendantPick,
        updated_at:               now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(null)
    if (err || !data) { setError(err?.message ?? 'Could not record attendant sign-on.'); return }
    onUpdated(data as ConfinedSpacePermit)
  }

  async function ackEntrants() {
    setBusy('briefing'); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({ entrant_acknowledgement_at: now, updated_at: now })
      .eq('id', permit.id)
      .select('*')
      .single()
    setBusy(null)
    if (err || !data) { setError(err?.message ?? 'Could not record acknowledgement.'); return }
    onUpdated(data as ConfinedSpacePermit)
  }

  return (
    <div className="space-y-3">
      {/* Attendant sign-on */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">Attendant on duty · §1910.146(i)</p>
        {permit.attendant_signature_at ? (
          <p className="text-xs text-slate-700">
            <span className="font-semibold">{permit.attendant_signature_name ?? '—'}</span> signed on at{' '}
            {new Date(permit.attendant_signature_at).toLocaleString()}.
          </p>
        ) : permit.attendants.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No attendants on the roster — add one to enable sign-on.</p>
        ) : readOnly ? (
          <p className="text-xs text-slate-400 italic">No attendant signed on while the permit was active.</p>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={attendantPick}
              onChange={e => setAttendantPick(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            >
              {permit.attendants.map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={signAsAttendant}
              disabled={busy === 'attendant'}
              className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-50 hover:bg-brand-navy/90 transition-colors"
            >
              {busy === 'attendant' ? '…' : 'Sign on as attendant'}
            </button>
          </div>
        )}
      </div>

      {/* Entrant briefing ack */}
      <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-1.5">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">Entrant briefing · §1910.146(f)(6)</p>
        {permit.entrant_acknowledgement_at ? (
          <p className="text-xs text-slate-700">
            Supervisor attested entrants were briefed on hazards at{' '}
            {new Date(permit.entrant_acknowledgement_at).toLocaleString()}.
          </p>
        ) : readOnly ? (
          <p className="text-xs text-slate-400 italic">No briefing acknowledgement was recorded while the permit was active.</p>
        ) : (
          <button
            type="button"
            onClick={ackEntrants}
            disabled={busy === 'briefing'}
            className="px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold disabled:opacity-50 hover:bg-brand-navy/90 transition-colors"
          >
            {busy === 'briefing' ? '…' : 'I have briefed entrants on hazards'}
          </button>
        )}
      </div>

      {error && <p className="text-[11px] text-rose-600">{error}</p>}
    </div>
  )
}

// ── Entrant in/out log ─────────────────────────────────────────────────────
//
// One row per name in permit.entrants[]. Status comes from the entries
// table — if there's a row with exited_at IS NULL, the entrant is inside.
// The attendant clicks "Log in" / "Log out" and we insert/update the row.
// Names match string-compare against permit.entrants[]; the supervisor can
// edit the roster on the permit but in/out actions are name-keyed so a
// rename mid-shift breaks the live mapping (acceptable trade — name edits
// during an active permit are rare and we surface an "Unrostered" row
// for any orphan entry rather than dropping it silently).

function EntrantLog({
  permit, entries, attendantUserId, readOnly, onEntered, onExited,
}: {
  permit:          ConfinedSpacePermit
  entries:         ConfinedSpaceEntry[]
  attendantUserId: string | null
  readOnly:        boolean
  onEntered:       (row: ConfinedSpaceEntry) => void
  onExited:        (row: ConfinedSpaceEntry) => void
}) {
  // Group entries by name so we can render the chronological in/out cycles
  // grouped under each rostered entrant. An "open" row (exited_at == null)
  // means the entrant is currently inside.
  const byName = new Map<string, ConfinedSpaceEntry[]>()
  for (const e of entries) {
    const list = byName.get(e.entrant_name) ?? []
    list.push(e)
    byName.set(e.entrant_name, list)
  }
  // Names that have entries but aren't on the roster — rare, but visible
  // so the supervisor sees the discrepancy.
  const orphan = [...byName.keys()].filter(n => !permit.entrants.includes(n))

  const insideCount = entries.filter(e => e.exited_at == null).length

  if (permit.entrants.length === 0 && orphan.length === 0) {
    return <p className="text-xs text-slate-400 italic">No entrants on the roster yet.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-600">
        <span className="font-semibold">{insideCount}</span> currently inside
        {' · '}
        §1910.146(i)(4) — the attendant logs each entrant in and out so the count is accurate at any moment.
      </p>
      <ul className="space-y-2">
        {permit.entrants.map(name => (
          <EntrantRow
            key={name}
            name={name}
            entries={byName.get(name) ?? []}
            permitId={permit.id}
            attendantUserId={attendantUserId}
            readOnly={readOnly}
            onEntered={onEntered}
            onExited={onExited}
          />
        ))}
        {orphan.map(name => (
          <EntrantRow
            key={`orphan:${name}`}
            name={name}
            entries={byName.get(name) ?? []}
            permitId={permit.id}
            attendantUserId={attendantUserId}
            readOnly={readOnly}
            isOrphan
            onEntered={onEntered}
            onExited={onExited}
          />
        ))}
      </ul>
    </div>
  )
}

function EntrantRow({
  name, entries, permitId, attendantUserId, readOnly, isOrphan,
  onEntered, onExited,
}: {
  name:            string
  entries:         ConfinedSpaceEntry[]
  permitId:        string
  attendantUserId: string | null
  readOnly:        boolean
  isOrphan?:       boolean
  onEntered:       (row: ConfinedSpaceEntry) => void
  onExited:        (row: ConfinedSpaceEntry) => void
}) {
  const [busy, setBusy]   = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Sort newest-first so the open cycle (if any) is at the top.
  const sorted = [...entries].sort((a, b) =>
    new Date(b.entered_at).getTime() - new Date(a.entered_at).getTime(),
  )
  const open = sorted.find(e => e.exited_at == null) ?? null
  const inside = open != null

  async function logIn() {
    if (!attendantUserId) { setError('Attendant must be logged in to record entry.'); return }
    setBusy(true); setError(null)
    const { data, error: err } = await supabase
      .from('loto_confined_space_entries')
      .insert({
        permit_id:    permitId,
        entrant_name: name,
        entered_by:   attendantUserId,
      })
      .select('*')
      .single()
    setBusy(false)
    if (err || !data) { setError(err?.message ?? 'Could not record entry.'); return }
    onEntered(data as ConfinedSpaceEntry)
  }

  async function logOut() {
    if (!open) return
    if (!attendantUserId) { setError('Attendant must be logged in to record exit.'); return }
    setBusy(true); setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_entries')
      .update({ exited_at: now, exited_by: attendantUserId })
      .eq('id', open.id)
      .select('*')
      .single()
    setBusy(false)
    if (err || !data) { setError(err?.message ?? 'Could not record exit.'); return }
    onExited(data as ConfinedSpaceEntry)
  }

  return (
    <li className={`rounded-lg border ${inside ? 'border-emerald-300 bg-emerald-50/60' : 'border-slate-200 bg-white'} px-3 py-2`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">
            {name}
            {isOrphan && (
              <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-amber-700">unrostered</span>
            )}
          </p>
          <p className="text-[11px] text-slate-500">
            {inside
              ? <>Inside since {new Date(open!.entered_at).toLocaleString()}</>
              : sorted.length === 0
                ? 'Has not entered yet'
                : <>Last out {new Date(sorted[0].exited_at!).toLocaleString()}</>
            }
          </p>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={inside ? logOut : logIn}
            disabled={busy}
            className={`shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold disabled:opacity-50 transition-colors ${
              inside
                ? 'bg-slate-700 text-white hover:bg-slate-800'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {busy ? '…' : inside ? 'Log out' : 'Log in'}
          </button>
        )}
      </div>
      {/* Cycle history — show prior in/out pairs for the audit trail. Cap
          at 4 entries with an ellipsis to keep long shifts compact. */}
      {sorted.length > 1 && (
        <ul className="mt-2 space-y-0.5 text-[10px] text-slate-500 font-mono">
          {sorted.slice(inside ? 1 : 0, (inside ? 1 : 0) + 4).map(e => (
            <li key={e.id}>
              {new Date(e.entered_at).toLocaleTimeString()} in
              {' → '}
              {e.exited_at ? new Date(e.exited_at).toLocaleTimeString() + ' out' : 'still inside'}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-[11px] text-rose-600 mt-1">{error}</p>}
    </li>
  )
}

// ── Test row ───────────────────────────────────────────────────────────────

function TestRow({ test, thresholds }: { test: AtmosphericTest; thresholds: ReturnType<typeof effectiveThresholds> }) {
  const evals = evaluateTest(test, thresholds)
  const cls = evals.status === 'fail' ? 'border-rose-300 bg-rose-50'
            : evals.status === 'pass' ? 'border-emerald-300 bg-emerald-50'
            :                            'border-slate-200 bg-white'
  return (
    <li className={`rounded-lg border ${cls} px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-semibold text-slate-600">
          {test.kind.replace('_', ' ').toUpperCase()} · {new Date(test.tested_at).toLocaleString()}
        </p>
        <p className="text-[10px] text-slate-500 font-mono">{test.tested_by.slice(0, 8)}</p>
      </div>
      <dl className="grid grid-cols-4 gap-1.5 mt-1.5 text-xs">
        <ChannelStat label="O₂"  value={test.o2_pct}  unit="%"   status={evals.channels.o2} />
        <ChannelStat label="LEL" value={test.lel_pct} unit="%"   status={evals.channels.lel} />
        <ChannelStat label="H₂S" value={test.h2s_ppm} unit="ppm" status={evals.channels.h2s} />
        <ChannelStat label="CO"  value={test.co_ppm}  unit="ppm" status={evals.channels.co} />
      </dl>
      {test.instrument_id && <p className="text-[10px] text-slate-400 mt-1">Meter: <span className="font-mono">{test.instrument_id}</span></p>}
      {test.notes && <p className="text-[11px] text-slate-600 mt-1">{test.notes}</p>}
    </li>
  )
}

function ChannelStat({ label, value, unit, status }: { label: string; value: number | null; unit: string; status: ReadingStatus }) {
  const cls = status === 'fail' ? 'text-rose-700 font-bold'
            : status === 'pass' ? 'text-emerald-700 font-semibold'
            :                      'text-slate-400'
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`text-sm font-mono ${cls}`}>
        {value == null ? '—' : `${value} ${unit}`}
      </dd>
    </div>
  )
}

// ── New test inline form ───────────────────────────────────────────────────

function NewTestForm({
  permitId, userId, kindHint, thresholds, meters, onSaved,
}: {
  permitId:   string
  userId:     string | null
  kindHint:   AtmosphericTestKind
  thresholds: ThresholdSet
  // Map from instrument_id to the gas-meter row in the bump-test register.
  // Empty map means migration 012 hasn't been applied or no meters yet —
  // the form renders without warnings in either case.
  meters:     Map<string, GasMeter>
  onSaved:    (test: AtmosphericTest) => void
}) {
  const [kind, setKind]                 = useState<AtmosphericTestKind>(kindHint)
  const [o2, setO2]                     = useState('')
  const [lel, setLel]                   = useState('')
  const [h2s, setH2s]                   = useState('')
  const [co, setCo]                     = useState('')
  const [instrumentId, setInstrumentId] = useState('')
  const [notes, setNotes]               = useState('')
  const [submitting, setSubmitting]     = useState(false)
  const [error, setError]               = useState<string | null>(null)

  // Update default kind when hint changes (e.g. after a pre-entry test lands).
  useEffect(() => { setKind(kindHint) }, [kindHint])

  function num(s: string): number | null {
    const t = s.trim()
    if (!t) return null
    const n = Number(t)
    return Number.isNaN(n) ? null : n
  }

  // Live per-channel pass/fail so the tester can see whether a reading is
  // acceptable BEFORE submitting. evaluateChannel returns 'unknown' for
  // empty/non-numeric values, which keeps the input neutral until the
  // tester actually types something.
  const o2Status  = evaluateChannel('o2',  num(o2),  thresholds)
  const lelStatus = evaluateChannel('lel', num(lel), thresholds)
  const h2sStatus = evaluateChannel('h2s', num(h2s), thresholds)
  const coStatus  = evaluateChannel('co',  num(co),  thresholds)

  // Bump-test status for the typed instrument id. Re-computed each render
  // — the lookup is a Map.get + a single Date parse, both negligible.
  const meterRow      = instrumentId.trim() ? meters.get(instrumentId.trim()) ?? null : null
  const meterStatus   = bumpStatus(meterRow, Date.now())
  const calOverdue    = calibrationOverdue(meterRow, Date.now())

  async function submit() {
    if (!userId) { setError('You must be logged in.'); return }
    const o2v = num(o2), lelv = num(lel)
    if (o2v == null && lelv == null) {
      setError('Record at least O₂ and LEL — these are mandatory channels per §(d)(5).')
      return
    }
    setSubmitting(true)
    setError(null)
    const payload = {
      permit_id:     permitId,
      tested_by:     userId,
      o2_pct:        o2v,
      lel_pct:       lelv,
      h2s_ppm:       num(h2s),
      co_ppm:        num(co),
      instrument_id: instrumentId.trim() || null,
      kind,
      notes:         notes.trim() || null,
    }
    const { data, error: err } = await supabase
      .from('loto_atmospheric_tests')
      .insert(payload)
      .select('*')
      .single()
    if (err || !data) {
      setError(err?.message ?? 'Could not record test.')
      setSubmitting(false)
      return
    }
    onSaved(data as AtmosphericTest)
    setO2(''); setLel(''); setH2s(''); setCo(''); setInstrumentId(''); setNotes('')
    setSubmitting(false)
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">+ Record new reading</p>
        <select
          value={kind}
          onChange={e => setKind(e.target.value as AtmosphericTestKind)}
          className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="pre_entry">Pre-entry</option>
          <option value="periodic">Periodic</option>
          <option value="post_alarm">Post-alarm</option>
        </select>
      </div>
      {/* Bump-test / calibration warning. Only renders when the tester has
          typed an instrument id — empty input stays clean. Three states:
          overdue (rose), never-bumped or unknown meter (amber), calibration
          past due (rose). Doesn't block submit — the supervisor owns the
          call, but the audit trail captures the reading + the warning. */}
      {instrumentId.trim() && meterStatus.kind === 'overdue' && (
        <p className="text-[11px] rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900">
          ⚠ {instrumentId.trim()} bump-test is {meterStatus.hoursSince}h old (window: 24h). §(d)(5)(i) requires a calibrated direct-reading instrument — verify before submitting.
        </p>
      )}
      {instrumentId.trim() && meterStatus.kind === 'never' && (
        <p className="text-[11px] rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-amber-900">
          ⚠ {instrumentId.trim()} has no bump-test on record. Verify the meter has been bumped today before submitting.
        </p>
      )}
      {instrumentId.trim() && meterStatus.kind === 'unknown' && meters.size > 0 && (
        <p className="text-[11px] rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1 text-amber-900/80">
          {instrumentId.trim()} isn't in the meter register yet — add it to track bump-test compliance.
        </p>
      )}
      {calOverdue && (
        <p className="text-[11px] rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900">
          ⚠ {instrumentId.trim()} calibration is past due. Send the meter back for full calibration before further use.
        </p>
      )}
      {/* Threshold legend right above the inputs so the tester doesn't have
          to remember §(d)(5) numbers or open another tab. Same numbers the
          row is evaluated against — they tick if the supervisor edits the
          permit's acceptable_conditions_override. */}
      <p className="text-[10px] text-slate-500">
        Acceptable: O₂ {thresholds.o2_min}–{thresholds.o2_max}%
        {' · '}LEL &lt;{thresholds.lel_max}%
        {' · '}H₂S &lt;{thresholds.h2s_max} ppm
        {' · '}CO &lt;{thresholds.co_max} ppm
      </p>
      <div className="grid grid-cols-4 gap-2">
        <NumInput label="O₂ (%)"    value={o2}  onChange={setO2}  step="0.1" status={o2Status}  />
        <NumInput label="LEL (%)"   value={lel} onChange={setLel} step="0.1" status={lelStatus} />
        <NumInput label="H₂S (ppm)" value={h2s} onChange={setH2s} step="0.1" status={h2sStatus} />
        <NumInput label="CO (ppm)"  value={co}  onChange={setCo}  step="0.1" status={coStatus}  />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          value={instrumentId}
          onChange={e => setInstrumentId(e.target.value)}
          placeholder="Meter ID (BW MicroClip…)"
          className="sm:col-span-1 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="sm:col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
      </div>
      {error && <p className="text-[11px] text-rose-600">{error}</p>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="px-4 py-1.5 rounded-lg bg-brand-navy text-white text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {submitting ? 'Recording…' : 'Record reading'}
        </button>
      </div>
    </div>
  )
}

function NumInput({
  label, value, onChange, step, status,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  step?: string
  // 'unknown' = empty / not yet typed → neutral; 'pass'/'fail' tint the
  // border AND the label so the cue carries on a tester glancing at the
  // form from arm's length on a noisy plant floor.
  status?: ReadingStatus
}) {
  const borderCls = status === 'fail'
    ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/40'
    : status === 'pass'
    ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/40'
    : 'border-slate-200 bg-white'
  const labelCls = status === 'fail'
    ? 'text-rose-700'
    : status === 'pass'
    ? 'text-emerald-700'
    : 'text-slate-500'
  return (
    <label className="flex flex-col gap-0.5">
      <span className={`text-[10px] font-semibold uppercase tracking-wide ${labelCls}`}>{label}</span>
      <input
        type="number"
        step={step}
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`rounded-lg border px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy ${borderCls}`}
      />
    </label>
  )
}

// ── Cancel dialog ──────────────────────────────────────────────────────────

interface CancelProps {
  permit:          ConfinedSpacePermit
  initialReason:   CancelReason
  // Whether a pre_entry atmospheric test exists on this permit. Drives the
  // §1910.146(d)(5) compliance warning — closing out a permit that never
  // had a pre-entry test is non-compliant and the supervisor should know.
  hasPreEntryTest: boolean
  onClose:         () => void
  onCanceled:      (updated: ConfinedSpacePermit) => void
}

function CancelDialog({ permit, initialReason, hasPreEntryTest, onClose, onCanceled }: CancelProps) {
  const [reason, setReason]       = useState<CancelReason>(initialReason)
  const [notes, setNotes]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const requiresNotes = reason !== 'task_complete'
  // Surface the missing-pre-entry-test warning whenever it applies, not just
  // for `expired`. A `task_complete` cancellation on a permit that never had
  // a pre-entry test is just as non-compliant.
  const showPreEntryWarning = !hasPreEntryTest

  async function submit() {
    if (requiresNotes && !notes.trim()) {
      setError('Please describe the situation when canceling for this reason.')
      return
    }
    setSubmitting(true)
    setError(null)
    const now = new Date().toISOString()
    const { data, error: err } = await supabase
      .from('loto_confined_space_permits')
      .update({
        canceled_at:   now,
        cancel_reason: reason,
        cancel_notes:  notes.trim() || null,
        updated_at:    now,
      })
      .eq('id', permit.id)
      .select('*')
      .single()
    if (err || !data) {
      setError(err?.message ?? 'Could not cancel.')
      setSubmitting(false)
      return
    }
    onCanceled(data as ConfinedSpacePermit)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-5 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Cancel permit</h2>
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
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">Reason</span>
            <select
              value={reason}
              onChange={e => setReason(e.target.value as CancelReason)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {Object.entries(CANCEL_REASON_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold text-slate-600">
              Notes {requiresNotes && <span className="text-rose-500">*</span>}
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder={
                reason === 'prohibited_condition' ? 'What condition was detected? Was the space evacuated successfully?'
              : reason === 'expired'              ? 'Permit ran past expiration — describe the disposition.'
              : reason === 'other'                ? 'Describe the cancellation reason.'
              :                                     '(optional)'
              }
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
        </div>

        {showPreEntryWarning && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <p className="font-bold mb-0.5">No pre-entry test on record</p>
            <p>
              §1910.146(d)(5) requires an atmospheric test before entry. This permit will
              close with that gap on the audit trail — note the disposition above so a
              future inspector understands why.
            </p>
          </div>
        )}

        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-md px-3 py-2">{error}</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800"
          >
            Back
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="px-5 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-rose-700 transition-colors"
          >
            {submitting ? 'Canceling…' : 'Cancel permit'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Layout helpers ─────────────────────────────────────────────────────────

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
