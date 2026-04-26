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
  ConfinedSpacePermit,
} from '@/lib/types'
import {
  effectiveThresholds,
  evaluateTest,
  permitState,
  type ReadingStatus,
} from '@/lib/confinedSpaceThresholds'

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

const CANCEL_REASON_LABELS: Record<CancelReason, string> = {
  task_complete:        'Task complete',
  prohibited_condition: 'Prohibited condition (evacuated)',
  expired:              'Time expired',
  other:                'Other',
}

export default function PermitDetailPage() {
  const params  = useParams<{ id: string; permitId: string }>()
  const router  = useRouter()
  const { userId } = useAuth()
  const spaceId  = decodeURIComponent(params.id)
  const permitId = params.permitId

  const [space, setSpace]       = useState<ConfinedSpace | null>(null)
  const [permit, setPermit]     = useState<ConfinedSpacePermit | null>(null)
  const [tests, setTests]       = useState<AtmosphericTest[]>([])
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [signing, setSigning]   = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)

  const load = useCallback(async () => {
    const [spaceRes, permitRes, testsRes] = await Promise.all([
      supabase.from('loto_confined_spaces').select('*').eq('space_id', spaceId).single(),
      supabase.from('loto_confined_space_permits').select('*').eq('id', permitId).single(),
      supabase.from('loto_atmospheric_tests').select('*').eq('permit_id', permitId).order('tested_at', { ascending: false }),
    ])
    if (spaceRes.error || permitRes.error || !spaceRes.data || !permitRes.data) {
      setNotFound(true)
      setLoading(false)
      return
    }
    setSpace(spaceRes.data as ConfinedSpace)
    setPermit(permitRes.data as ConfinedSpacePermit)
    if (testsRes.data) setTests(testsRes.data as AtmosphericTest[])
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
      <div className="flex items-center justify-between">
        <Link href={`/confined-spaces/${encodeURIComponent(spaceId)}`} className="text-sm font-semibold text-slate-500 hover:text-slate-700">
          ← Back to space
        </Link>
        <span className="text-[11px] text-slate-400 font-mono">{permit.id.slice(0, 8)}</span>
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

      <Section title={`Atmospheric Tests${tests.length > 0 ? ` (${tests.length})` : ''}`}>
        {state !== 'canceled' && state !== 'expired' && (
          <NewTestForm
            permitId={permitId}
            userId={userId}
            kindHint={preEntryTest ? 'periodic' : 'pre_entry'}
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
            onClick={() => setCancelOpen(true)}
            className="px-4 py-2 rounded-lg border border-rose-200 text-sm font-semibold text-rose-700 hover:bg-rose-50 transition-colors"
          >
            Cancel permit
          </button>
        </div>
      )}

      {cancelOpen && permit && (
        <CancelDialog
          permit={permit}
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
  permitId, userId, kindHint, onSaved,
}: {
  permitId: string
  userId:   string | null
  kindHint: AtmosphericTestKind
  onSaved:  (test: AtmosphericTest) => void
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
      <div className="grid grid-cols-4 gap-2">
        <NumInput label="O₂ (%)"  value={o2}  onChange={setO2}  step="0.1" />
        <NumInput label="LEL (%)" value={lel} onChange={setLel} step="0.1" />
        <NumInput label="H₂S (ppm)" value={h2s} onChange={setH2s} step="0.1" />
        <NumInput label="CO (ppm)"  value={co}  onChange={setCo}  step="0.1" />
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

function NumInput({ label, value, onChange, step }: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <input
        type="number"
        step={step}
        inputMode="decimal"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
      />
    </label>
  )
}

// ── Cancel dialog ──────────────────────────────────────────────────────────

interface CancelProps {
  permit:     ConfinedSpacePermit
  onClose:    () => void
  onCanceled: (updated: ConfinedSpacePermit) => void
}

function CancelDialog({ permit, onClose, onCanceled }: CancelProps) {
  const [reason, setReason]       = useState<CancelReason>('task_complete')
  const [notes, setNotes]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError]         = useState<string | null>(null)

  const requiresNotes = reason !== 'task_complete'

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
