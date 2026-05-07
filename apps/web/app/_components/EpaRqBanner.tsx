'use client'

import Link from 'next/link'
import { AlertOctagon, AlertTriangle, Beaker } from 'lucide-react'
import {
  checkSpillRq,
  type RqDecision,
} from '@soteria/core/epaReportableQuantities'
import { type IncidentSpillUnit } from '@soteria/core/incident'

// Surfaced on the incident overview when incident_type =
// 'environmental'. Runs the spill-substance + quantity through the
// CERCLA RQ catalog and renders one of four states:
//   meets_rq               — call NRC immediately, hard banner
//   non_cercla_petroleum   — petroleum sheen rule, amber banner
//   below_rq               — soft confirmation
//   unknown_*              — soft prompt to consult SDS

interface Props {
  substance:     string | null
  quantity:      number | null
  quantity_unit: IncidentSpillUnit | null
}

export default function EpaRqBanner({ substance, quantity, quantity_unit }: Props) {
  const decision = checkSpillRq({
    substance,
    quantity,
    quantity_unit,
  })

  // Tone + icon selection.
  const tone = toneFor(decision)
  const heading = headingFor(decision)
  const message = messageFor(decision)
  const iconClasses = `h-5 w-5 ${tone.icon}`
  // Render the right icon literally — keeping the JSX inline
  // satisfies react-hooks/static-components (lifting the icon to
  // a variable would treat it as a component created during render).
  const iconNode =
    decision.kind === 'meets_rq'             ? <AlertOctagon className={iconClasses} /> :
    decision.kind === 'non_cercla_petroleum' ? <AlertTriangle className={iconClasses} /> :
    <Beaker className={iconClasses} />

  return (
    <section className={`rounded-xl border p-4 ${tone.border} ${tone.bg}`}>
      <header className="flex items-center gap-2">
        {iconNode}
        <h3 className={`text-sm font-semibold ${tone.text}`}>{heading}</h3>
      </header>
      <p className={`mt-1 text-xs ${tone.body}`}>{message}</p>
      {decision.kind === 'meets_rq' && (
        <p className="mt-2 text-[11px] font-mono text-slate-700 dark:text-slate-300">
          Released ~{decision.quantity_lb.toFixed(1)} lb · RQ {decision.rq_lb} lb · CAS {decision.entry.cas}
        </p>
      )}
      {decision.kind === 'below_rq' && (
        <p className="mt-2 text-[11px] font-mono text-slate-600 dark:text-slate-400">
          Released ~{decision.quantity_lb.toFixed(1)} lb · RQ {decision.rq_lb} lb · CAS {decision.entry.cas}
        </p>
      )}
      <p className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
        Heuristic check against a curated subset of 40 CFR 302.4. Always confirm against the substance&apos;s SDS.
        {' '}
        <Link href="https://www.epa.gov/emergency-response" className="underline hover:text-slate-700">EPA emergency response →</Link>
      </p>
    </section>
  )
}

function toneFor(d: RqDecision): { border: string; bg: string; icon: string; text: string; body: string } {
  switch (d.kind) {
    case 'meets_rq':
      return {
        border: 'border-rose-300 dark:border-rose-800',
        bg:     'bg-rose-50 dark:bg-rose-950/30',
        icon:   'text-rose-600 dark:text-rose-400',
        text:   'text-rose-900 dark:text-rose-100',
        body:   'text-rose-800 dark:text-rose-200',
      }
    case 'non_cercla_petroleum':
      return {
        border: 'border-amber-300 dark:border-amber-800',
        bg:     'bg-amber-50 dark:bg-amber-950/30',
        icon:   'text-amber-700 dark:text-amber-300',
        text:   'text-amber-900 dark:text-amber-100',
        body:   'text-amber-800 dark:text-amber-200',
      }
    case 'below_rq':
      return {
        border: 'border-emerald-200 dark:border-emerald-900',
        bg:     'bg-emerald-50/40 dark:bg-emerald-950/20',
        icon:   'text-emerald-700 dark:text-emerald-300',
        text:   'text-emerald-900 dark:text-emerald-100',
        body:   'text-emerald-800 dark:text-emerald-200',
      }
    default:
      return {
        border: 'border-slate-300 dark:border-slate-700',
        bg:     'bg-slate-50 dark:bg-slate-900/40',
        icon:   'text-slate-500',
        text:   'text-slate-900 dark:text-slate-100',
        body:   'text-slate-700 dark:text-slate-300',
      }
  }
}

function headingFor(d: RqDecision): string {
  switch (d.kind) {
    case 'meets_rq':              return 'CERCLA Reportable Quantity met — notify NRC'
    case 'non_cercla_petroleum':  return 'Petroleum spill threshold met'
    case 'below_rq':              return `Below CERCLA RQ for ${d.entry.name}`
    case 'unknown_quantity':      return d.entry.name + ' is RQ-listed — quantity check pending'
    case 'unknown_substance':     return 'Reportable-quantity check unavailable'
  }
}

function messageFor(d: RqDecision): string {
  return 'message' in d
    ? d.message
    : `Released ${d.quantity_lb.toFixed(1)} lb of ${d.entry.name}; RQ is ${d.rq_lb} lb (CAS ${d.entry.cas}).`
}
