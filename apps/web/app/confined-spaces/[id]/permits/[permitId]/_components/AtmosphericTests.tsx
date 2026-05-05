'use client'

import { useEffect, useState } from 'react'
import { Bluetooth, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { AtmosphericTest, AtmosphericTestKind, GasMeter } from '@soteria/core/types'
import {
  effectiveThresholds,
  evaluateChannel,
  evaluateTest,
  type ReadingStatus,
  type ThresholdSet,
} from '@soteria/core/confinedSpaceThresholds'
import { bumpStatus, calibrationOverdue } from '@/lib/gasMeters'
import { createMeterReader, meterReaderSupported } from '@/lib/meterReader'

// ── Existing-test row ─────────────────────────────────────────────────────

export function TestRow({ test, thresholds }: {
  test:       AtmosphericTest
  thresholds: ReturnType<typeof effectiveThresholds>
}) {
  const evals = evaluateTest(test, thresholds)
  const cls = evals.status === 'fail' ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/40'
            : evals.status === 'pass' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/40'
            :                            'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
  return (
    <li className={`rounded-lg border ${cls} px-3 py-2`}>
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
          {test.kind.replace('_', ' ').toUpperCase()} · {new Date(test.tested_at).toLocaleString()}
        </p>
        <p className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">{test.tested_by.slice(0, 8)}</p>
      </div>
      <dl className="grid grid-cols-4 gap-1.5 mt-1.5 text-xs">
        <ChannelStat label="O₂"  value={test.o2_pct}  unit="%"   status={evals.channels.o2} />
        <ChannelStat label="LEL" value={test.lel_pct} unit="%"   status={evals.channels.lel} />
        <ChannelStat label="H₂S" value={test.h2s_ppm} unit="ppm" status={evals.channels.h2s} />
        <ChannelStat label="CO"  value={test.co_ppm}  unit="ppm" status={evals.channels.co} />
      </dl>
      {test.instrument_id && <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-1">Meter: <span className="font-mono">{test.instrument_id}</span></p>}
      {test.notes && <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1">{test.notes}</p>}
    </li>
  )
}

function ChannelStat({ label, value, unit, status }: {
  label: string; value: number | null; unit: string; status: ReadingStatus
}) {
  const cls = status === 'fail' ? 'text-rose-700 dark:text-rose-300 font-bold'
            : status === 'pass' ? 'text-emerald-700 dark:text-emerald-300 font-semibold'
            :                      'text-slate-400 dark:text-slate-500'
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-sm font-mono ${cls}`}>
        {value == null ? '—' : `${value} ${unit}`}
      </dd>
    </div>
  )
}

// ── Inline new-test form ──────────────────────────────────────────────────

export function NewTestForm({
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

  // Live capture from a Bluetooth meter (T1.1). Browser-gated: shows the
  // button only when navigator.bluetooth exists, which excludes iOS
  // Safari. Manual entry stays the canonical path; this is a convenience
  // for Android / desktop Chrome users with a Soteria-compatible meter.
  const [connecting, setConnecting] = useState(false)
  const [meterMessage, setMeterMessage] = useState<string | null>(null)
  const meterAvailable = meterReaderSupported()

  // Update default kind when hint changes (e.g. after a pre-entry test lands).
  useEffect(() => { setKind(kindHint) }, [kindHint])

  async function connectMeter() {
    setConnecting(true)
    setMeterMessage(null)
    setError(null)
    const reader = createMeterReader('auto')
    if (!reader) {
      setMeterMessage('Bluetooth meter capture is not available on this device. Use manual entry.')
      setConnecting(false)
      return
    }
    try {
      const reading = await reader.connect()
      // Only overwrite fields the meter actually returned a value for —
      // a meter without an H₂S sensor shouldn't blank a tester's
      // already-typed value.
      if (reading.o2_pct  != null) setO2(String(reading.o2_pct))
      if (reading.lel_pct != null) setLel(String(reading.lel_pct))
      if (reading.h2s_ppm != null) setH2s(String(reading.h2s_ppm))
      if (reading.co_ppm  != null) setCo(String(reading.co_ppm))
      if (reading.instrument_id) setInstrumentId(reading.instrument_id)
      setMeterMessage(`Filled from ${reader.name} at ${new Date(reading.sampledAt).toLocaleTimeString()}.`)
    } catch (err) {
      // User-cancel of the picker throws NotFoundError ("User cancelled
      // the requestDevice() chooser") — surface that softly rather than
      // as an angry error.
      const msg = err instanceof Error ? err.message : 'Could not read meter'
      if (/cancel/i.test(msg)) setMeterMessage('Meter selection canceled.')
      else                     setError(`Meter capture failed: ${msg}`)
    } finally {
      // Disconnect on the way out so we don't hold the device.
      try { await reader?.close() } catch { /* ignore */ }
      setConnecting(false)
    }
  }

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
      setError(formatSupabaseError(err, 'record test'))
      setSubmitting(false)
      return
    }
    onSaved(data as AtmosphericTest)
    setO2(''); setLel(''); setH2s(''); setCo(''); setInstrumentId(''); setNotes('')
    setSubmitting(false)
  }

  return (
    <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/40/50 p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#214487]">+ Record new reading</p>
        <select
          value={kind}
          onChange={e => setKind(e.target.value as AtmosphericTestKind)}
          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-0.5 text-[11px] font-semibold focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        >
          <option value="pre_entry">Pre-entry</option>
          <option value="periodic">Periodic</option>
          <option value="post_alarm">Post-alarm</option>
        </select>
      </div>
      {meterAvailable && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button
            type="button"
            onClick={connectMeter}
            disabled={connecting}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold border border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 hover:bg-blue-100 dark:hover:bg-blue-950/60 disabled:opacity-50 transition-colors"
          >
            {connecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bluetooth className="h-3 w-3" />}
            {connecting ? 'Connecting…' : 'Connect meter'}
          </button>
          {meterMessage && (
            <span className="text-[10px] text-slate-600 dark:text-slate-300 truncate max-w-[60%]">{meterMessage}</span>
          )}
        </div>
      )}
      {/* Bump-test / calibration warning. Only renders when the tester has
          typed an instrument id — empty input stays clean. Three states:
          overdue (rose), never-bumped or unknown meter (amber), calibration
          past due (rose). Doesn't block submit — the supervisor owns the
          call, but the audit trail captures the reading + the warning. */}
      {instrumentId.trim() && meterStatus.kind === 'overdue' && (
        <p className="text-[11px] rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-1 text-rose-900 dark:text-rose-100">
          ⚠ {instrumentId.trim()} bump-test is {meterStatus.hoursSince}h old (window: 24h). §(d)(5)(i) requires a calibrated direct-reading instrument — verify before submitting.
        </p>
      )}
      {instrumentId.trim() && meterStatus.kind === 'never' && (
        <p className="text-[11px] rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 text-amber-900 dark:text-amber-100">
          ⚠ {instrumentId.trim()} has no bump-test on record. Verify the meter has been bumped today before submitting.
        </p>
      )}
      {instrumentId.trim() && meterStatus.kind === 'unknown' && meters.size > 0 && (
        <p className="text-[11px] rounded-md border border-amber-200 bg-amber-50/60 dark:bg-amber-950/40/60 px-2 py-1 text-amber-900/80 dark:text-amber-100/80">
          {instrumentId.trim()} isn&apos;t in the meter register yet — add it to track bump-test compliance.
        </p>
      )}
      {calOverdue && (
        <p className="text-[11px] rounded-md border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-1 text-rose-900 dark:text-rose-100">
          ⚠ {instrumentId.trim()} calibration is past due. Send the meter back for full calibration before further use.
        </p>
      )}
      {/* Threshold legend right above the inputs so the tester doesn't have
          to remember §(d)(5) numbers or open another tab. Same numbers the
          row is evaluated against — they tick if the supervisor edits the
          permit's acceptable_conditions_override. */}
      <p className="text-[10px] text-slate-500 dark:text-slate-400">
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
          className="sm:col-span-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="sm:col-span-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-[12px] focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
        />
      </div>
      {error && <p className="text-[11px] text-rose-600 dark:text-rose-400">{error}</p>}
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
    ? 'border-rose-400 ring-2 ring-rose-200 bg-rose-50/40 dark:bg-rose-950/40/40'
    : status === 'pass'
    ? 'border-emerald-400 ring-2 ring-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/40/40'
    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
  const labelCls = status === 'fail'
    ? 'text-rose-700 dark:text-rose-300'
    : status === 'pass'
    ? 'text-emerald-700 dark:text-emerald-300'
    : 'text-slate-500 dark:text-slate-400'
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
