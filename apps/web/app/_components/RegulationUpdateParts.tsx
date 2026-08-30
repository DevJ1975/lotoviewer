'use client'

import { ExternalLink } from 'lucide-react'
import {
  REGULATION_JURISDICTION_LABEL,
  type OshaRegulationUpdate,
  type OshaUpdateSeverity,
  type RegulationJurisdiction,
} from '@soteria/core/oshaRegWatch'

// Presentational pieces shared by the two regulatory panels on the Control
// Center home dashboard: OshaRegWatchPanel (what has happened) and
// ComingUpPanel (what is about to). Extracted rather than duplicated — the
// panels differ in what they emphasise, but a title link and a severity pill
// look the same either way, and the two drifting apart would read as a bug.

export function TitleLink({ update }: { update: OshaRegulationUpdate }) {
  if (update.source_url === '') {
    return <span className="font-semibold text-slate-900 dark:text-slate-100">{update.title}</span>
  }
  return (
    <a
      href={update.source_url}
      target="_blank"
      rel="noopener noreferrer"
      className="group inline-flex items-start gap-1 font-semibold text-brand-navy dark:text-brand-yellow hover:underline"
    >
      <span>{update.title}</span>
      <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70 group-hover:opacity-100" />
    </a>
  )
}

export function SeverityPill({ severity }: { severity: OshaUpdateSeverity | null }) {
  if (!severity) return null
  const cls =
    severity === 'high'   ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    : severity === 'medium' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
    :                         'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${cls}`}>
      {severity}
    </span>
  )
}

/**
 * Which regulator an item came from. Only rendered when a tenant can actually
 * see more than one jurisdiction — for a single-jurisdiction tenant every row
 * would carry the same badge, which is noise rather than information.
 */
export function JurisdictionBadge({ jurisdiction }: { jurisdiction: RegulationJurisdiction }) {
  const cls = jurisdiction === 'CA'
    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300'
    : 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
  return (
    <span className={`rounded-md px-2 py-0.5 font-bold uppercase tracking-wide ${cls}`}>
      {REGULATION_JURISDICTION_LABEL[jurisdiction]}
    </span>
  )
}
