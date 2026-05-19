'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import {
  ArrowLeft, Calculator as CalculatorIcon, CheckCircle2,
  AlertTriangle, XCircle, BookOpen,
} from 'lucide-react'
import {
  calculateRequiredClearance,
  type ClearanceInputs,
} from '@soteria/core/workingAtHeights'

// Interactive fall-clearance calculator.
//
// The math lives in packages/core/src/workingAtHeights.ts (pure, unit-
// tested). This page is the operator-facing surface: pick a system,
// enter the available clearance below the anchor, and see the
// breakdown + verdict in real time. No submit; the calculation runs
// on every input change.
//
// The verdict has three bands:
//   SAFE      — available ≥ required + 2 ft cushion
//   MARGINAL  — available within 2 ft of required (review with CP)
//   UNSAFE    — available < required (system cannot arrest the fall)

type System = ClearanceInputs['system']
type Verdict = 'safe' | 'marginal' | 'unsafe'

interface VerdictBand {
  band:        Verdict
  label:       string
  description: string
  Icon:        typeof CheckCircle2
  classes:     string
}

const VERDICTS: Record<Verdict, VerdictBand> = {
  safe: {
    band:        'safe',
    label:       'SAFE',
    description: 'Available clearance exceeds the required clearance with margin to spare.',
    Icon:        CheckCircle2,
    classes:     'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100',
  },
  marginal: {
    band:        'marginal',
    label:       'MARGINAL — REVIEW WITH CP',
    description: 'Available clearance only barely covers the requirement. Discuss with your Competent Person before issuing the permit.',
    Icon:        AlertTriangle,
    classes:     'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100',
  },
  unsafe: {
    band:        'unsafe',
    label:       'UNSAFE — DO NOT PROCEED',
    description: 'The chosen system cannot arrest a fall at this location before contact. Switch to an SRL, change the anchor, or use restraint instead.',
    Icon:        XCircle,
    classes:     'border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-100',
  },
}

function verdictFor(availableFt: number, requiredFt: number): Verdict {
  if (availableFt < requiredFt) return 'unsafe'
  if (availableFt < requiredFt + 2) return 'marginal'
  return 'safe'
}

const SYSTEM_OPTIONS: Array<{ value: System; label: string; blurb: string }> = [
  { value: 'shock_lanyard', label: 'Shock-absorbing lanyard',  blurb: 'Energy absorber deploys on impact. Typical 6-ft length. Needs the most clearance.' },
  { value: 'srl_class1',    label: 'SRL — Class 1 (overhead)', blurb: 'Self-retracting lifeline locking against an anchor directly overhead. Roughly half the clearance of a lanyard.' },
  { value: 'srl_class2',    label: 'SRL — Class 2 (leading edge)', blurb: 'SRL rated for loading over a sharp edge (typical structural steel). Same clearance math as Class 1.' },
  { value: 'restraint',     label: 'Restraint (no fall)',      blurb: 'Tether short enough that the worker cannot reach the fall edge. No arrest forces; only worker + margin clearance needed.' },
]

export default function ClearanceCalculatorPage() {
  const [system, setSystem]                 = useState<System>('shock_lanyard')
  const [lanyardLengthFt, setLanyardLengthFt] = useState(6)
  const [workerBelowDringFt, setWorkerBelowDringFt] = useState(5)
  const [safetyMarginFt, setSafetyMarginFt] = useState(2)
  const [swingFallOffsetFt, setSwingFallOffsetFt] = useState(0)
  const [availableFt, setAvailableFt]       = useState(18)

  const result = useMemo(() => calculateRequiredClearance({
    system,
    lanyardLengthFt:    system === 'shock_lanyard' ? lanyardLengthFt : undefined,
    workerBelowDringFt,
    safetyMarginFt,
    swingFallOffsetFt:  system === 'shock_lanyard' ? swingFallOffsetFt : undefined,
  }), [system, lanyardLengthFt, workerBelowDringFt, safetyMarginFt, swingFallOffsetFt])

  const verdict = verdictFor(availableFt, result.requiredClearanceFt)
  const band    = VERDICTS[verdict]
  const margin  = availableFt - result.requiredClearanceFt

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/working-at-heights" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow">
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to Working at Heights
      </Link>
      <header className="mt-3 mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow">
          <CalculatorIcon className="size-5" />
        </span>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Working at Heights
          </p>
          <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50 sm:text-3xl">
            Fall clearance calculator
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
            Pick a system and enter the available clearance below the anchor. The verdict updates as you type.
          </p>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-4 text-sm font-bold text-slate-900 dark:text-slate-100">Inputs</h2>

          <div className="space-y-4">
            <Field label="Connection system">
              <select
                value={system}
                onChange={e => setSystem(e.target.value as System)}
                className={baseInput}
              >
                {SYSTEM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">
                {SYSTEM_OPTIONS.find(o => o.value === system)?.blurb}
              </p>
            </Field>

            {system === 'shock_lanyard' && (
              <Field label="Lanyard length (ft)" hint="Standard shock-absorbing lanyards ship in 4 or 6 ft.">
                <NumberInput value={lanyardLengthFt} step={0.5} min={2} max={8} onChange={v => setLanyardLengthFt(v)} />
              </Field>
            )}

            <TwoCol>
              <Field label="Worker below D-ring (ft)" hint="Typical 5 ft for an average adult; taller workers need more.">
                <NumberInput value={workerBelowDringFt} step={0.5} min={3} max={7} onChange={v => setWorkerBelowDringFt(v)} />
              </Field>
              <Field label="Safety margin (ft)" hint="ANSI Z359 design guides recommend at least 2 ft.">
                <NumberInput value={safetyMarginFt} step={0.5} min={0} max={5} onChange={v => setSafetyMarginFt(v)} />
              </Field>
            </TwoCol>

            {system === 'shock_lanyard' && (
              <Field label="Swing-fall offset (ft)" hint="Horizontal distance from anchor to worker. Adds a pendulum drop.">
                <NumberInput value={swingFallOffsetFt} step={0.5} min={0} max={20} onChange={v => setSwingFallOffsetFt(v)} />
              </Field>
            )}

            <Field label="Available clearance below anchor (ft)" hint="Measured from anchor down to the next surface — floor, mezzanine, ground.">
              <NumberInput value={availableFt} step={0.5} min={0} max={60} onChange={v => setAvailableFt(v)} />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <div className={`rounded-xl border-2 p-5 ${band.classes}`}>
            <div className="flex items-start gap-3">
              <band.Icon className="mt-0.5 size-6 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-black tracking-wide">{band.label}</p>
                <p className="mt-1 text-sm leading-relaxed">{band.description}</p>
                <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-widest opacity-70">Required</dt>
                    <dd className="font-mono text-xl">{result.requiredClearanceFt.toFixed(1)} ft</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-widest opacity-70">Available</dt>
                    <dd className="font-mono text-xl">{availableFt.toFixed(1)} ft</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-widest opacity-70">Margin</dt>
                    <dd className={`font-mono text-xl ${margin < 0 ? 'text-rose-900 dark:text-rose-100' : ''}`}>
                      {margin >= 0 ? '+' : ''}{margin.toFixed(1)} ft
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[10px] font-bold uppercase tracking-widest opacity-70">System</dt>
                    <dd className="text-sm font-semibold">{SYSTEM_OPTIONS.find(o => o.value === system)?.label}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Breakdown</h3>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-500">
              Required clearance = sum of every component below.
            </p>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {result.breakdown.map((b, i) => (
                  <tr key={i} className="border-t border-slate-100 first:border-0 dark:border-slate-800">
                    <td className="py-1.5 text-slate-700 dark:text-slate-300">{b.label}</td>
                    <td className="py-1.5 text-right font-mono text-slate-900 dark:text-slate-100">{b.feet.toFixed(1)} ft</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-300 dark:border-slate-700">
                  <td className="py-2 text-sm font-bold text-slate-900 dark:text-slate-100">Required clearance</td>
                  <td className="py-2 text-right font-mono text-base font-bold text-slate-900 dark:text-slate-100">
                    {result.requiredClearanceFt.toFixed(1)} ft
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {result.notes.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-900/40">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-600 dark:text-slate-400">Notes</h3>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                {result.notes.map((n, i) => <li key={i}>• {n}</li>)}
              </ul>
            </div>
          )}

          <Link
            href="/wiki/working-at-heights#clearance-calculation"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-navy hover:underline dark:text-brand-yellow"
          >
            <BookOpen className="size-3.5" />
            Why these numbers — full derivation in the manual
          </Link>
        </section>
      </div>

      <FallDiagram
        availableFt={availableFt}
        requiredFt={result.requiredClearanceFt}
        verdict={verdict}
      />
    </main>
  )
}

// ─── Visual side-view diagram ──────────────────────────────────────────
//
// SVG side-view of the anchor, the worker hanging in the harness, and
// the floor below. The required-clearance band is hatched; the
// available clearance band is dotted. Helps the operator see WHY the
// verdict came out the way it did.

function FallDiagram({ availableFt, requiredFt, verdict }: { availableFt: number; requiredFt: number; verdict: Verdict }) {
  const maxFt = Math.max(availableFt, requiredFt, 20) + 4
  const W     = 380
  const H     = 240
  // Scale: ft → px. 1 ft = (H - 40) / maxFt px.
  const ftPx  = (H - 40) / maxFt
  const anchorY = 25
  const floorY  = anchorY + availableFt * ftPx
  const reqY    = anchorY + requiredFt * ftPx
  const stroke  = verdict === 'safe' ? '#10b981' : verdict === 'marginal' ? '#f59e0b' : '#e11d48'

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h3 className="mb-3 text-sm font-bold text-slate-900 dark:text-slate-100">Side view</h3>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-6">
        <svg width={W} height={H} className="rounded-md border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950" aria-hidden="true">
          {/* Anchor beam */}
          <line x1={20}  y1={anchorY} x2={W-20} y2={anchorY} stroke="#475569" strokeWidth={4} />
          <text x={W-20} y={anchorY - 6} textAnchor="end" className="fill-slate-500 text-[10px]">Anchor</text>

          {/* Required-clearance band — hatched */}
          <defs>
            <pattern id="hatch" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <line x1="0" y1="0" x2="0" y2="6" stroke={stroke} strokeWidth="1" opacity="0.4" />
            </pattern>
          </defs>
          <rect x={W/2 + 30} y={anchorY} width={60} height={Math.max(0, reqY - anchorY)} fill="url(#hatch)" />
          <text x={W/2 + 60} y={anchorY + (reqY - anchorY) / 2 + 4} textAnchor="middle" className="fill-slate-700 text-[10px] font-bold">
            need {requiredFt.toFixed(1)}ft
          </text>

          {/* Available clearance — dashed line + label */}
          <line x1={20} y1={floorY} x2={W-20} y2={floorY} stroke="#475569" strokeDasharray="4 4" strokeWidth={1.5} />
          <text x={20} y={floorY - 6} className="fill-slate-500 text-[10px]">Floor / next level</text>
          <text x={W-20} y={floorY + 14} textAnchor="end" className="fill-slate-700 text-[10px] font-bold">
            have {availableFt.toFixed(1)}ft
          </text>

          {/* Worker silhouette hanging below D-ring */}
          <circle cx={W/2 - 30} cy={anchorY + 50} r={6} fill="#0E1A2E" />
          <line   x1={W/2 - 30} y1={anchorY + 56} x2={W/2 - 30} y2={anchorY + 80} stroke="#0E1A2E" strokeWidth={3} />
          <line   x1={W/2 - 30} y1={anchorY + 65} x2={W/2 - 45} y2={anchorY + 75} stroke="#0E1A2E" strokeWidth={2} />
          <line   x1={W/2 - 30} y1={anchorY + 65} x2={W/2 - 15} y2={anchorY + 75} stroke="#0E1A2E" strokeWidth={2} />
          {/* Lanyard from anchor to worker D-ring */}
          <line   x1={W/2 - 30} y1={anchorY} x2={W/2 - 30} y2={anchorY + 50} stroke="#dc2626" strokeWidth={2} />

          {/* Verdict marker on the floor line */}
          {verdict === 'unsafe' && (
            <text x={W/2 - 30} y={floorY + 14} textAnchor="middle" className="fill-rose-700 text-[11px] font-black">
              IMPACT
            </text>
          )}
        </svg>
        <div className="max-w-xs text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          <p>
            The hatched bar shows the clearance the chosen system needs below the anchor — the worker
            cannot stop before that distance. The dashed line is where the floor (or next level) sits
            based on your input.
          </p>
          <p className="mt-2">
            When the hatched bar is shorter than the dashed line, the system has room to arrest the fall.
            When it overshoots, the worker contacts the surface before deceleration completes.
          </p>
        </div>
      </div>
    </section>
  )
}

// ─── Tiny form primitives ─────────────────────────────────────────────

const baseInput = 'w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white focus:border-brand-navy focus:outline-none focus:ring-1 focus:ring-brand-navy dark:border-slate-700 dark:bg-slate-950 dark:focus:border-brand-yellow dark:focus:ring-brand-yellow'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-500">{hint}</p>}
    </label>
  )
}

function NumberInput({ value, onChange, step, min, max }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <input
      type="number"
      value={value}
      step={step ?? 1}
      min={min}
      max={max}
      onChange={e => {
        const v = Number(e.target.value)
        onChange(Number.isFinite(v) ? v : 0)
      }}
      className={baseInput}
    />
  )
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
}
