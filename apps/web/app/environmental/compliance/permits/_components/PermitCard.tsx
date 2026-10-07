'use client'

import { useId } from 'react'
import { FileText, Pencil, Trash2 } from 'lucide-react'
import { StatusChip } from '@/components/environmental/badges'
import { secondaryButtonCls } from '@/components/environmental/form'
import type { Permit } from '@/lib/environmental/client'
import { useEvidenceUrl } from '@/lib/environmental/useEvidenceUrl'
import {
  jurisdictionLabel, PERMIT_HEALTH_META, permitHealthText, permitLabel, permitProgramLabel, renewalDeadline,
} from '@/lib/environmental/permitView'

// One permit: what it is, where it stands, and what it asks of the site.

interface Props {
  permit: Permit
  nowMs: number
  /** Given in the all-sites roll-up, where a permit's site is not otherwise obvious. */
  siteName?: string
  /** Given only to a tenant admin: both controls, or neither. */
  actions?: { onEdit: () => void; onDelete: () => void }
}

export function PermitCard({ permit, nowMs, siteName, actions }: Props) {
  const headingId = useId()
  const health = PERMIT_HEALTH_META[permit.health]
  const identifiers = Object.entries(permit.identifiers)

  return (
    <article aria-labelledby={headingId} className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-sm font-semibold text-slate-900 dark:text-slate-100">{permit.permit_type}</h3>
          {permit.permit_number && <p className="font-mono text-xs text-slate-600 dark:text-slate-400">{permit.permit_number}</p>}
        </div>
        <StatusChip tone={health.tone}>{health.label}</StatusChip>
        <StatusChip tone="idle">{permitProgramLabel(permit.program)}</StatusChip>
        {actions && (
          <div className="flex gap-2">
            <button type="button" className={secondaryButtonCls} aria-label={`Edit ${permitLabel(permit)}`} onClick={actions.onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </button>
            <button type="button" className={secondaryButtonCls} aria-label={`Delete ${permitLabel(permit)}`} onClick={actions.onDelete}>
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          </div>
        )}
      </div>

      <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{permitHealthText(permit, nowMs)}</p>

      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        {siteName !== undefined && <Detail label="Site" value={siteName} />}
        <Detail label="Issuing agency" value={permit.issuing_agency} />
        <Detail label="Jurisdiction" value={jurisdictionLabel(permit.jurisdiction)} />
        <Detail label="Effective" value={permit.effective_date} />
        <Detail label="Expires" value={permit.expiration_date} />
        <Detail label="Renewal deadline" value={renewalDeadline(permit)} />
      </dl>

      {identifiers.length > 0 && (
        <dl className="mt-3 flex flex-wrap gap-2 text-xs">
          {identifiers.map(([name, value]) => (
            <div key={name} className="rounded-md border border-slate-200 px-2 py-0.5 dark:border-slate-700">
              <dt className="inline font-semibold text-slate-600 dark:text-slate-400">{name}: </dt>
              <dd className="inline font-mono text-slate-900 dark:text-slate-100">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {permit.conditions.length > 0 && (
        <details className="mt-3 rounded-md border border-slate-200 dark:border-slate-800">
          <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-800 dark:text-slate-200">Conditions ({permit.conditions.length})</summary>
          <ul className="divide-y divide-slate-100 border-t border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {permit.conditions.map(condition => (
              <li key={condition.id} className="space-y-1 px-3 py-2 text-sm">
                <p className="text-slate-900 dark:text-slate-100">{condition.text}</p>
                {(condition.frequency || condition.ref) && (
                  <p className="flex flex-wrap gap-x-4 text-xs text-slate-600 dark:text-slate-400">
                    {condition.frequency && <span>Frequency: {condition.frequency}</span>}
                    {condition.ref && <span>Reference: {condition.ref}</span>}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {permit.document_path && <DocumentLink path={permit.document_path} />}
      {permit.notes && <p className="mt-3 whitespace-pre-line text-sm text-slate-600 dark:text-slate-400">{permit.notes}</p>}
    </article>
  )
}

function Detail({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-slate-900 dark:text-slate-100">{value ?? '—'}</dd>
    </div>
  )
}

// The stored path is private; a link to it is signed on demand and expires.
function DocumentLink({ path }: { path: string }) {
  const url = useEvidenceUrl(path)

  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">
      <FileText className="h-4 w-4" /> View permit document
    </a>
  ) : (
    <p className="mt-3 flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400"><FileText className="h-4 w-4" /> Document attached</p>
  )
}
