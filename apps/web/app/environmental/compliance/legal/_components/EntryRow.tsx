'use client'

import { Fragment, useMemo, type ReactNode } from 'react'
import { CalendarCheck, ChevronRight, ClipboardCheck, ExternalLink, Loader2, Pencil, Trash2 } from 'lucide-react'
import { StatusChip, VerifyNote } from '@/components/environmental/badges'
import { primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import type { LegalEntry } from '@/lib/environmental/client'
import { useEvidenceUrl } from '@/lib/environmental/useEvidenceUrl'
import {
  APPLICABILITY_META, COMPLIANCE_META, jurisdictionLabel, linkableUrl, ownerName, programOf, REVIEW_FREQUENCY_LABELS,
  reviewChip, siteLabel, verifyNoteFor,
} from '@/lib/environmental/legalView'
import { cn } from '@/lib/utils'
import { parseReviewFrequency } from '@soteria/core/environmental/legalRegister'
import { ENV_PROGRAM_LABELS } from '@soteria/core/environmental/siteProfile'

/** What an admin can do to an entry. A member gets none, so the controls are absent rather than disabled. */
export interface RowActions {
  onEvaluate: () => void
  onMarkReviewed: () => void
  onEdit: () => void
  onDelete: () => void
  reviewing: boolean
}

interface Props {
  entry: LegalEntry
  open: boolean
  onToggle: () => void
  /** The roll-up has a Site column; one site does not. */
  siteNames: ReadonlyMap<string, string> | null
  owners: ReadonlyMap<string, string>
  actions: RowActions | null
}

const day = (iso: string | null) => iso?.slice(0, 10) ?? null

export function EntryRow({ entry, open, onToggle, siteNames, owners, actions }: Props) {
  const program = programOf(entry)
  const compliance = COMPLIANCE_META[entry.compliance_status]
  const applicability = APPLICABILITY_META[entry.applicability]
  const review = reviewChip(entry)
  const owner = ownerName(entry.owner_user_id, owners)
  const detailId = `legal-detail-${entry.id}`

  return (
    <Fragment>
      <tr className="bg-white align-top dark:bg-slate-950">
        <td className="px-3 py-2">
          <button
            type="button" onClick={onToggle} aria-expanded={open} aria-controls={detailId}
            className="flex w-full items-start gap-2 rounded text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy/60"
          >
            <ChevronRight aria-hidden="true" className={cn('mt-0.5 h-4 w-4 shrink-0 text-slate-500 transition-transform', open && 'rotate-90')} />
            <span>
              <span className="block font-medium text-slate-900 dark:text-slate-100">{entry.title}</span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">{entry.citation}</span>
            </span>
          </button>
          <div className="mt-1 flex flex-wrap gap-1 pl-6">
            <StatusChip tone="idle">{jurisdictionLabel(entry.jurisdiction)}</StatusChip>
            {program && <StatusChip tone="idle">{ENV_PROGRAM_LABELS[program]}</StatusChip>}
            {siteNames === null && entry.facility_id === null && <StatusChip tone="idle">All sites</StatusChip>}
          </div>
        </td>
        {siteNames && <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{siteLabel(entry.facility_id, siteNames)}</td>}
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            <StatusChip tone={compliance.tone}>{compliance.label}</StatusChip>
            <StatusChip tone={applicability.tone}>{applicability.label}</StatusChip>
          </div>
        </td>
        <td className="px-3 py-2"><StatusChip tone={review.tone}>{review.text}</StatusChip></td>
        <td className="px-3 py-2 text-slate-700 dark:text-slate-300">
          {owner ?? <><span aria-hidden="true">—</span><span className="sr-only">No owner</span></>}
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50 dark:bg-slate-900/50">
          <td id={detailId} colSpan={siteNames ? 5 : 4} className="px-4 py-3">
            <EntryDetail entry={entry} actions={actions} />
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function EntryDetail({ entry, actions }: { entry: LegalEntry; actions: RowActions | null }) {
  // Entries are stored without the library's note, so it is looked up each time it is shown.
  const verify = useMemo(() => verifyNoteFor(entry), [entry])
  const sourceUrl = linkableUrl(entry.source_url)
  const frequency = parseReviewFrequency(entry.review_frequency)

  return (
    <div className="space-y-3 text-sm">
      {entry.summary && <p className="text-slate-700 dark:text-slate-300">{entry.summary}</p>}
      {verify && <VerifyNote note={verify} />}

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Applicability note" wide>{entry.applicability_note}</Fact>
        <Fact label="Authority">{entry.authority}</Fact>
        <Fact label="Effective">{day(entry.effective_date)}</Fact>
        <Fact label="Review cycle">{frequency ? REVIEW_FREQUENCY_LABELS[frequency] : null}</Fact>
        <Fact label="Last reviewed">{day(entry.last_reviewed_at)}</Fact>
        <Fact label="Last evaluated">{day(entry.last_evaluated_at)}</Fact>
        <Fact label="Source">
          {sourceUrl && (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">
              Read the source <ExternalLink aria-hidden="true" className="h-3 w-3" /><span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
        </Fact>
        <Fact label="Evaluation note" wide>{entry.evaluation_note}</Fact>
        <Fact label="Evidence">{entry.evidence_path && <EvidenceLink path={entry.evidence_path} />}</Fact>
      </dl>

      {actions && (
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="button" onClick={actions.onEvaluate} className={primaryButtonCls}><ClipboardCheck className="h-4 w-4" /> Evaluate</button>
          <button type="button" onClick={actions.onMarkReviewed} disabled={actions.reviewing} className={secondaryButtonCls}>
            {actions.reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarCheck className="h-4 w-4" />} Mark reviewed
          </button>
          <button type="button" onClick={actions.onEdit} className={secondaryButtonCls}><Pencil className="h-4 w-4" /> Edit</button>
          <button type="button" onClick={actions.onDelete} className={cn(secondaryButtonCls, 'text-rose-700 dark:text-rose-300')}><Trash2 className="h-4 w-4" /> Delete</button>
        </div>
      )}
    </div>
  )
}

function Fact({ label, wide, children }: { label: string; wide?: boolean; children?: ReactNode }) {
  return (
    <div className={cn(wide && 'sm:col-span-2 lg:col-span-3')}>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{children || '—'}</dd>
    </div>
  )
}

/** A time-limited link to the stored evidence; the stored path itself is not something a person can open. */
function EvidenceLink({ path }: { path: string }) {
  const url = useEvidenceUrl(path)

  if (!url) return <span className="text-slate-500">Attached</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">
      View evidence <ExternalLink aria-hidden="true" className="h-3 w-3" /><span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}
