'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import type {
  AtmosphericTest,
  CancelReason,
  ConfinedSpace,
  ConfinedSpaceEntry,
  ConfinedSpacePermit,
  GasMeter,
  HotWorkPermit,
  OrgConfig,
  TrainingRecord,
} from '@/lib/types'
import { formatWorkOrderUrl } from '@/lib/orgConfig'
import {
  effectiveThresholds,
  evaluateTest,
  permitState,
  type ReadingStatus,
} from '@/lib/confinedSpaceThresholds'
import { validateTraining, type TrainingIssue } from '@/lib/trainingRecords'
import { StatusBanner }          from './_components/StatusBanner'
import { LinkedHotWorkBanner }   from './_components/LinkedHotWorkBanner'
import { RescueDisplay }         from './_components/RescueDisplay'
import { AuthorizationBlock }    from './_components/AuthorizationBlock'
import { EntrantLog }            from './_components/EntrantLog'
import { TestRow, NewTestForm }  from './_components/AtmosphericTests'
import { TrainingGap }           from './_components/TrainingGap'
import { EditRosterDialog }      from './_components/EditRosterDialog'
import { CancelDialog }          from './_components/CancelDialog'

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
  // Org-level config: just the work_order_url_template today. Loaded once
  // at page load; stays static for the rest of the session.
  const [orgConfig, setOrgConfig] = useState<OrgConfig | null>(null)
  // Training records for §1910.146(g) sign-gate. Loaded once; the gate
  // re-evaluates whenever the roster changes via the Edit Roster modal.
  const [trainingRecords, setTrainingRecords] = useState<TrainingRecord[]>([])
  // Supervisor's explicit override when training records aren't on file
  // for everyone. Tracked locally so leaving and returning to the page
  // re-prompts (matches the pre-entry-test warning pattern).
  const [trainingOverride, setTrainingOverride] = useState(false)
  // Hot-work permits cross-linked to this CS permit (migration 019). The
  // §1910.146(f)(15) cross-reference works in both directions: the hot-
  // work permit FK-points here, and the CS permit surfaces a banner so
  // the entry supervisor can see what concurrent fire-risk work is
  // happening in their space.
  const [linkedHotWork, setLinkedHotWork] = useState<HotWorkPermit[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [signing, setSigning]   = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  // Bias the cancel dialog toward prohibited_condition when the user opens
  // it from the evacuation banner (vs. the regular Cancel button).
  const [cancelInitialReason, setCancelInitialReason] = useState<CancelReason>('task_complete')
  const [rosterOpen, setRosterOpen] = useState(false)

  const load = useCallback(async () => {
    const [spaceRes, permitRes, testsRes, entriesRes, metersRes, configRes, trainingRes, hotWorkRes] = await Promise.all([
      supabase.from('loto_confined_spaces').select('*').eq('space_id', spaceId).single(),
      supabase.from('loto_confined_space_permits').select('*').eq('id', permitId).single(),
      supabase.from('loto_atmospheric_tests').select('*').eq('permit_id', permitId).order('tested_at', { ascending: false }),
      supabase.from('loto_confined_space_entries').select('*').eq('permit_id', permitId).order('entered_at', { ascending: false }),
      supabase.from('loto_gas_meters').select('*').eq('decommissioned', false),
      supabase.from('loto_org_config').select('*').eq('id', 1).maybeSingle(),
      supabase.from('loto_training_records').select('*'),
      supabase.from('loto_hot_work_permits').select('*').eq('associated_cs_permit_id', permitId).order('started_at', { ascending: false }),
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
    // Org config: optional. Pre-migration-014 the table doesn't exist
    // and the query errors silently. The work-order field still renders
    // as plain text in that case.
    if (configRes.data) setOrgConfig(configRes.data as OrgConfig)
    // Training records likewise — pre-migration-017 the query errors
    // silently and the §(g) gate behaves as if no records exist (every
    // worker flagged), which the supervisor can override.
    if (trainingRes.data) setTrainingRecords(trainingRes.data as TrainingRecord[])
    // Hot-work cross-link (migration 019). Pre-migration the table
    // doesn't exist and the query errors silently — the banner just
    // doesn't render, no crash.
    if (hotWorkRes.data) setLinkedHotWork(hotWorkRes.data as HotWorkPermit[])
    setLoading(false)
  }, [spaceId, permitId])

  useEffect(() => { load() }, [load])

  const thresholds = useMemo(() => effectiveThresholds(permit, space), [permit, space])
  const state      = useMemo(() => permit ? permitState(permit) : null, [permit])

  // §1910.146(g) gate — re-evaluates when the roster (entrants/attendants)
  // changes via the Edit Roster modal, or when training records load.
  // An empty array means the gate passes; the override checkbox is
  // hidden in that case.
  const trainingIssues: TrainingIssue[] = useMemo(
    () => permit ? validateTraining({
      entrants:   permit.entrants,
      attendants: permit.attendants,
      records:    trainingRecords,
      asOf:       new Date(),
    }) : [],
    [permit, trainingRecords],
  )

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
    return <div className="max-w-3xl mx-auto px-4 py-10 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
  }
  if (notFound || !space || !permit) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10 text-center space-y-3">
        <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">Permit not found.</p>
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
      // When a sign-on token is on the permit (post-migration-024), the
      // QR points at the worker self-service page; otherwise it points
      // at the live supervisor view of the permit. Caption changes to
      // match so a worker scanning a printed permit knows what to expect.
      const hasSignonToken = !!permit!.signon_token
      const permitUrl = hasSignonToken
        ? `${window.location.origin}/permit-signon/${permit!.signon_token}`
        : `${window.location.origin}/confined-spaces/${encodeURIComponent(spaceId)}/permits/${permit!.id}`
      const qrCaption = hasSignonToken ? 'Scan to sign in or out' : 'Scan for live permit'
      const bytes = await generatePermitPdf({
        space: space!, permit: permit!, tests, permitUrl, qrCaption,
      })
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
    // §1910.146(g) — every named entrant / attendant must have a current
    // training record. Soft block: if any are missing/expired, require
    // the supervisor to acknowledge they verified training off-app via
    // the override checkbox below the sign button.
    if (trainingIssues.length > 0 && !trainingOverride) {
      setServerError('Some entrants or attendants are missing current training records — review the §(g) banner and confirm verification before signing.')
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
        <Link href={`/confined-spaces/${encodeURIComponent(spaceId)}`} className="text-sm font-semibold text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
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
          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-mono font-bold tracking-wider">{permit.serial}</span>
        </div>
      </div>

      <StatusBanner state={state!} permit={permit} />

      <header className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4">
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-base font-bold text-slate-900 dark:text-slate-100">{permit.purpose}</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              <span className="font-mono font-semibold">{space.space_id}</span> — {space.description}
            </p>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Started <strong>{new Date(permit.started_at).toLocaleString()}</strong>
            {' · expires '}
            <strong>{new Date(permit.expires_at).toLocaleString()}</strong>
          </p>
        </div>
      </header>

      {serverError && (
        <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 rounded-lg px-3 py-2">{serverError}</p>
      )}

      {/* Hot-work cross-link banner — §1910.146(f)(15). The entry
          supervisor needs to know what fire-risk work is happening
          inside their space concurrently. Only renders when at least
          one hot-work permit references this CS permit. */}
      {linkedHotWork.length > 0 && (
        <LinkedHotWorkBanner permits={linkedHotWork} />
      )}

      <Section title="Personnel">
        <PersonnelRow label="Entry supervisor" values={[permit.entry_supervisor_id.slice(0, 8) + ' (you sign with this account)']} />
        <PersonnelRow label="Authorized entrants" values={permit.entrants} />
        <PersonnelRow label="Attendant(s)" values={permit.attendants} />
        {/* Mid-job roster edits — supervisors routinely add/remove
            entrants and attendants as crews swap during a shift. The
            modal validates against the live entries log so you can't
            silently drop a worker who's still inside the space. */}
        {state === 'active' && (
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setRosterOpen(true)}
              className="text-xs font-semibold text-brand-navy hover:underline"
            >
              + Edit roster (mid-job)
            </button>
          </div>
        )}
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
        <p className="text-xs"><span className="font-semibold text-slate-700 dark:text-slate-300">Communication:</span> {permit.communication_method ?? <em className="text-slate-400 dark:text-slate-500">not set</em>}</p>
        <RescueDisplay rescue={permit.rescue_service} />
      </Section>

      {(permit.equipment_list.length > 0 || permit.concurrent_permits || permit.work_order_ref || permit.notes) && (
        <Section title="Equipment & Other">
          {permit.equipment_list.length > 0 && (
            <Roster label="Equipment in use" items={permit.equipment_list} emptyLabel="None recorded" />
          )}
          {permit.concurrent_permits && (
            <p className="text-xs"><span className="font-semibold text-slate-700 dark:text-slate-300">Concurrent permits:</span> {permit.concurrent_permits}</p>
          )}
          {permit.work_order_ref && (
            <p className="text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Work order:</span>{' '}
              <WorkOrderRef refValue={permit.work_order_ref} template={orgConfig?.work_order_url_template ?? null} />
            </p>
          )}
          {permit.notes && (
            <p className="text-xs"><span className="font-semibold text-slate-700 dark:text-slate-300">Notes:</span> {permit.notes}</p>
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
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white dark:bg-slate-900 text-rose-700 dark:text-rose-300 text-sm font-bold hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
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
          <p className="text-xs text-slate-400 dark:text-slate-500 italic">No tests recorded yet.</p>
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
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 rounded-xl p-4 space-y-3">
          <div>
            <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-100">Sign & activate this permit</h3>
            <p className="text-[11px] text-emerald-900/80 dark:text-emerald-100/80">
              By signing you authorize entry per §1910.146(f)(6). The permit becomes active immediately.
              {' '}{!preEntryTest
                ? 'A pre-entry atmospheric test is required first.'
                : preEntryStatus !== 'pass'
                ? 'Pre-entry test must pass thresholds before signing.'
                : 'Pre-entry test passes — ready to sign.'}
            </p>
          </div>
          {trainingIssues.length > 0 && (
            <TrainingGap
              issues={trainingIssues}
              acknowledged={trainingOverride}
              onAcknowledge={setTrainingOverride}
            />
          )}
          <button
            type="button"
            onClick={handleSign}
            disabled={
              signing ||
              !preEntryTest ||
              preEntryStatus !== 'pass' ||
              (trainingIssues.length > 0 && !trainingOverride)
            }
            className="px-5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-emerald-700 transition-colors"
          >
            {signing ? 'Signing…' : '✓ Sign & activate permit'}
          </button>
        </div>
      )}

      {state === 'active' && (
        // Two distinct actions:
        //   - Close out: normal completion. Most common path. Pre-fills
        //     task_complete; the dialog is a confirm step, not a form.
        //   - Cancel for cause: prohibited condition / other disposition.
        //     Reason picker matters here.
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => { setCancelInitialReason('prohibited_condition'); setCancelOpen(true) }}
            className="text-xs font-semibold text-rose-700 dark:text-rose-300 hover:underline"
          >
            Cancel for cause…
          </button>
          <button
            type="button"
            onClick={() => { setCancelInitialReason('task_complete'); setCancelOpen(true) }}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 transition-colors"
          >
            Close out permit
          </button>
        </div>
      )}

      {/* Expired-but-uncancelled — supervisors must positively close out per
          §1910.146(e)(5). Without this button there's no UI path to clear an
          expired permit, leaving it stuck in the home Critical Alert banner. */}
      {state === 'expired' && (
        <div className="rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 p-4 flex items-center justify-between gap-3">
          <p className="text-xs text-rose-900/80 dark:text-rose-100/80">
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

      {rosterOpen && permit && (
        <EditRosterDialog
          permit={permit}
          entries={entries}
          onClose={() => setRosterOpen(false)}
          onSaved={(updated) => {
            setPermit(updated)
            setRosterOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── Personnel / hazards / equipment chips ──────────────────────────────────

function PersonnelRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 w-32 shrink-0">{label}</span>
      {values.length === 0 ? (
        <span className="text-xs text-slate-400 dark:text-slate-500 italic">None</span>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {values.map((v, i) => (
            <li key={`${v}-${i}`} className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] text-slate-800 dark:text-slate-200 font-mono">{v}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Roster({ label, items, emptyLabel }: { label: string; items: string[]; emptyLabel: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">{label}</p>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400 dark:text-slate-500 italic">{emptyLabel}</p>
      ) : (
        <ul className="space-y-0.5 list-disc list-inside marker:text-slate-300">
          {items.map((it, i) => (
            <li key={`${it}-${i}`} className="text-xs text-slate-700 dark:text-slate-300">{it}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Render a work order ref as a hyperlink when org_config has a URL
// template configured, otherwise as plain monospace text. Sanitizes
// through formatWorkOrderUrl which percent-encodes the ref.
function WorkOrderRef({ refValue, template }: { refValue: string; template: string | null }) {
  const url = formatWorkOrderUrl(template, refValue)
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-brand-navy hover:underline"
      >
        {refValue}
      </a>
    )
  }
  return <span className="font-mono">{refValue}</span>
}

// ── Layout helpers ─────────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-4 space-y-2">
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[#214487]">{title}</h2>
        {hint && <span className="text-[10px] text-slate-400 dark:text-slate-500">{hint}</span>}
      </header>
      {children}
    </section>
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
