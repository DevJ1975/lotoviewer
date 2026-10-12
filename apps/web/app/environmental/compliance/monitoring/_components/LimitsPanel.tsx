'use client'

import { ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react'
import { CitationList, StatusChip, VerifyNote } from '@/components/environmental/badges'
import { primaryButtonCls, secondaryButtonCls } from '@/components/environmental/form'
import { appliesToText, effectiveText, limitStanding, limitText, basisLabel } from '@/lib/environmental/monitoringView'
import type { LimitRow, MonitoringLimit } from '@soteria/core/environmental/monitoring'

// The limits that apply at the site, each with what kind of limit it is, where it came from and
// what a reviewer must still confirm about it, and where it stands in this reporting year. Any
// member reads them; a tenant admin, who is given `actions`, adds, edits and deletes them and
// adopts the draft defaults.

interface Props {
  limits:   MonitoringLimit[]
  /** The summary's rows, to say where each limit stands this reporting year. */
  rows:     LimitRow[]
  outfalls: readonly { id: string; code: string }[]
  actions?: {
    onAdd:    () => void
    onEdit:   (limit: MonitoringLimit) => void
    onDelete: (limit: MonitoringLimit) => void
    /** Present only when the site has draft defaults to offer. */
    onAdopt?: () => void
  }
}

const th = 'px-3 py-2 font-semibold'
const td = 'px-3 py-2 align-top'

export function LimitsPanel({ limits, rows, outfalls, actions }: Props) {
  return (
    <section aria-labelledby="monitoring-limits" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="monitoring-limits" className="flex items-center gap-2 text-base font-semibold text-slate-900 dark:text-slate-100">
          <ClipboardList className="h-4 w-4" /> Limits at this site
        </h2>
        {actions && (
          <div className="flex flex-wrap gap-2">
            {actions.onAdopt && (
              <button type="button" className={secondaryButtonCls} onClick={actions.onAdopt}>Adopt draft defaults</button>
            )}
            <button type="button" className={primaryButtonCls} onClick={actions.onAdd}><Plus className="h-4 w-4" /> Add limit</button>
          </div>
        )}
      </div>

      {limits.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          No limits are recorded for this site, so results are not judged yet.
          {actions ? ' Add the limits from your permit, or adopt the draft defaults if the site has some.' : ' A tenant admin can add them.'}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <caption className="sr-only">Limits at this site</caption>
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th scope="col" className={th}>Parameter</th>
                <th scope="col" className={th}>Applies to</th>
                <th scope="col" className={th}>Limit</th>
                <th scope="col" className={th}>Kind of limit</th>
                <th scope="col" className={th}>This reporting year</th>
                <th scope="col" className={th}>Source and checks</th>
                {actions && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {limits.map(limit => {
                const standing = limitStanding(limit, rows)
                const label = `${limit.parameter}, ${limitText(limit)}, ${appliesToText(limit, outfalls)}`
                const period = effectiveText(limit)
                return (
                  <tr key={limit.id} className="bg-white dark:bg-slate-950">
                    <th scope="row" className={`${td} text-left font-semibold text-slate-900 dark:text-slate-100`}>{limit.parameter}</th>
                    <td className={`${td} font-mono`}>{appliesToText(limit, outfalls)}</td>
                    <td className={`${td} tabular-nums`}>
                      {limitText(limit)}
                      {period && <p className="text-xs text-slate-500 dark:text-slate-400">In force: {period}</p>}
                    </td>
                    <td className={td}><StatusChip tone="idle">{basisLabel(limit.basis)}</StatusChip></td>
                    <td className={td}>
                      {standing === null
                        ? <span className="text-slate-400 dark:text-slate-500">—</span>
                        : (
                          <div className="space-y-1">
                            <StatusChip tone={standing.chip.tone}>{standing.chip.label}</StatusChip>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                              {standing.sampleCount} judged, {standing.exceedanceCount} over
                            </p>
                          </div>
                        )}
                    </td>
                    <td className={td}>
                      <div className="space-y-1">
                        {limit.source === 'library' && <StatusChip tone="warn">Draft default</StatusChip>}
                        {limit.citation && <CitationList citations={[{ ref: limit.citation }]} />}
                        {limit.verify && <VerifyNote note={limit.verify} />}
                      </div>
                    </td>
                    {actions && (
                      <td className={td}>
                        <div className="flex justify-end gap-2">
                          <button type="button" className={secondaryButtonCls} aria-label={`Edit limit: ${label}`} onClick={() => actions.onEdit(limit)}>
                            <Pencil className="h-4 w-4" /> Edit
                          </button>
                          <button type="button" className={secondaryButtonCls} aria-label={`Delete limit: ${label}`} onClick={() => actions.onDelete(limit)}>
                            <Trash2 className="h-4 w-4" /> Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
