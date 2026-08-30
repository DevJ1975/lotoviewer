'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ShieldAlert, Droplets, Recycle } from 'lucide-react'
import {
  assessHazwoperApplicability,
  classifyRelease,
  HAZWOPER_TRAINING_LABEL,
  HAZWOPER_REFRESHER_DAYS,
  type HazwoperActivity,
  type ReleaseFacts,
} from '@soteria/core/hazwoper'
import {
  universalWasteCategories,
  UNIVERSAL_WASTE_CATEGORY_LABEL,
  type WasteJurisdiction,
} from '@soteria/core/hazardousWaste'

// /hazardous-waste/worker-protection — Cal/OSHA decision aids.
//
// Three self-contained tools over the pure helpers in @soteria/core:
//   1. HAZWOPER applicability triage (8 CCR 5192)
//   2. Incidental vs. emergency release classifier (8 CCR 5192(q))
//   3. Universal-waste categories by jurisdiction (22 CCR 66273.1)
//
// These are triage aids, not a substitute for the employer's program or a
// competent safety professional's judgment.

const HAZWOPER_ACTIVITIES: ReadonlyArray<{ key: keyof HazwoperActivity; label: string }> = [
  { key: 'routineGeneratorWork',    label: 'Routine generator accumulation, labeling, weekly inspection' },
  { key: 'emergencyResponse',       label: 'Emergency response to a hazardous-substance release' },
  { key: 'correctiveActionCleanup', label: 'RCRA corrective action / cleanup of a hazardous-waste site' },
  { key: 'voluntaryCleanup',        label: 'Voluntary cleanup of an uncontrolled hazardous-waste site' },
  { key: 'tsdOperations',           label: 'Treatment / storage / disposal under RCRA permit or interim status' },
]

const RELEASE_FACTS: ReadonlyArray<{ key: keyof ReleaseFacts; label: string }> = [
  { key: 'uncontrolled',         label: 'The release is uncontrolled or spreading' },
  { key: 'safetyOrHealthHazard', label: 'It poses (or could pose) a safety or health hazard' },
  { key: 'requiresEvacuation',   label: 'It requires evacuation of the area' },
  { key: 'beyondIncidental',     label: 'It is beyond an incidental amount staff can safely clean in place' },
]

export default function WorkerProtectionPage() {
  const [activity, setActivity] = useState<HazwoperActivity>({
    tsdOperations: false,
    correctiveActionCleanup: false,
    voluntaryCleanup: false,
    emergencyResponse: false,
    routineGeneratorWork: true,
  })
  const [facts, setFacts] = useState<ReleaseFacts>({
    uncontrolled: false,
    safetyOrHealthHazard: false,
    requiresEvacuation: false,
    beyondIncidental: false,
  })
  const [jurisdiction, setJurisdiction] = useState<WasteJurisdiction>('california')

  const hazwoper = assessHazwoperApplicability(activity)
  const release = classifyRelease(facts)
  const uwCategories = universalWasteCategories(jurisdiction)

  return (
    <main className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Hazardous Waste
        </Link>
      </div>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Worker protection (Cal/OSHA)</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Decision aids for the worker-protection side of hazardous waste. These are triage tools — they
          don&apos;t replace your HAZWOPER program, training records, or a safety professional&apos;s judgment.
        </p>
      </header>

      {/* 1 — HAZWOPER applicability */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <ShieldAlert className="h-4 w-4 text-sky-600" /> HAZWOPER applicability · 8 CCR 5192
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Which of these describe the work?</p>
        <div className="space-y-2">
          {HAZWOPER_ACTIVITIES.map(({ key, label }) => (
            <Check
              key={key}
              checked={activity[key]}
              onChange={v => setActivity(a => ({ ...a, [key]: v }))}
              label={label}
            />
          ))}
        </div>
        <div
          className={`rounded-md p-3 text-sm ${
            hazwoper.covered
              ? 'bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
              : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          <p className="font-semibold">
            {hazwoper.covered ? 'HAZWOPER-covered' : 'Not HAZWOPER-covered'}
          </p>
          <p className="mt-1 text-xs">{hazwoper.basis}</p>
          {hazwoper.suggestedTraining[0] !== 'none' && (
            <ul className="mt-2 list-disc pl-5 text-xs space-y-0.5">
              {hazwoper.suggestedTraining.map(t => <li key={t}>{HAZWOPER_TRAINING_LABEL[t]}</li>)}
            </ul>
          )}
          {hazwoper.annualRefresher && (
            <p className="mt-2 text-xs font-medium">
              Annual {HAZWOPER_REFRESHER_DAYS}-day 8-hour refresher required (5192(e)(8)).
            </p>
          )}
        </div>
      </section>

      {/* 2 — Incidental vs emergency release */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Droplets className="h-4 w-4 text-sky-600" /> Spill: incidental or emergency? · 8 CCR 5192(q)
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Check anything that applies to the release.</p>
        <div className="space-y-2">
          {RELEASE_FACTS.map(({ key, label }) => (
            <Check
              key={key}
              checked={facts[key]}
              onChange={v => setFacts(f => ({ ...f, [key]: v }))}
              label={label}
            />
          ))}
        </div>
        <div
          className={`rounded-md p-3 text-sm ${
            release.classification === 'emergency_response'
              ? 'bg-rose-50 text-rose-900 dark:bg-rose-950/30 dark:text-rose-200'
              : 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200'
          }`}
        >
          <p className="font-semibold">
            {release.classification === 'emergency_response' ? 'Emergency response' : 'Incidental release'}
          </p>
          <p className="mt-1 text-xs">{release.rationale}</p>
          <p className="mt-2 text-xs font-medium">{release.action}</p>
        </div>
      </section>

      {/* 3 — Universal-waste categories */}
      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5 space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
          <Recycle className="h-4 w-4 text-emerald-600" /> Universal-waste categories
        </h2>
        <div className="flex gap-2 text-xs">
          {(['california', 'federal'] as WasteJurisdiction[]).map(j => (
            <button
              key={j}
              type="button"
              onClick={() => setJurisdiction(j)}
              className={`px-3 py-1.5 rounded-md border ${
                jurisdiction === j
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {j === 'california' ? 'California (22 CCR 66273.1)' : 'Federal (40 CFR 273)'}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-2">
          {uwCategories.map(c => (
            <li key={c} className="rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 px-2.5 py-0.5 text-xs font-medium">
              {UNIVERSAL_WASTE_CATEGORY_LABEL[c]}
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          All universal waste carries a 1-year on-site accumulation limit (40 CFR 273.15 / 22 CCR 66273.15).
          California recognizes more categories than the federal program.
        </p>
      </section>
    </main>
  )
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-200">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4"
      />
      <span>{label}</span>
    </label>
  )
}
