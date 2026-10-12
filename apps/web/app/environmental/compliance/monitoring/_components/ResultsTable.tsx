'use client'

import { Pencil, Trash2 } from 'lucide-react'
import { StatusChip } from '@/components/environmental/badges'
import { secondaryButtonCls } from '@/components/environmental/form'
import { useEvidenceUrl } from '@/lib/environmental/useEvidenceUrl'
import { judgmentLines, outfallName, resultValueText, sampledAtText } from '@/lib/environmental/monitoringView'
import { judgeResult, type MonitoringLimit, type MonitoringResult } from '@soteria/core/environmental/monitoring'

// Sample results, newest first. Each is judged here against every limit that binds it, and the
// row shows the verdict next to the limit it was judged against, with what kind of limit that
// is: "Exceeds permit limit" and "Exceeds benchmark" are different words and different colours.
// Any member records a result; only a tenant admin, who is given `actions`, can correct or remove one.

interface Props {
  results:  MonitoringResult[]
  limits:   MonitoringLimit[]
  outfalls: readonly { id: string; code: string }[]
  actions?: { onEdit: (result: MonitoringResult) => void; onDelete: (result: MonitoringResult) => void }
}

const th = 'px-3 py-2 font-semibold'
const td = 'px-3 py-2 align-top'
const none = <span className="text-slate-400 dark:text-slate-500">—</span>

export function ResultsTable({ results, limits, outfalls, actions }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <caption className="sr-only">Sample results</caption>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className={th}>Sampled</th>
            <th scope="col" className={th}>Outfall</th>
            <th scope="col" className={th}>Parameter</th>
            <th scope="col" className={th}>Result</th>
            <th scope="col" className={th}>Judged against</th>
            <th scope="col" className={th}>Event and lab</th>
            <th scope="col" className={th}>Report</th>
            {actions && <th scope="col" className={th}><span className="sr-only">Actions</span></th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {results.map(result => {
            const lines = judgmentLines(judgeResult(limits, result))
            const label = `${result.parameter} at ${outfallName(result.outfallId, outfalls)}, ${sampledAtText(result.sampledAt)}`
            return (
              <tr key={result.id} className="bg-white dark:bg-slate-950">
                <th scope="row" className={`${td} whitespace-nowrap text-left font-normal text-slate-700 dark:text-slate-300`}>{sampledAtText(result.sampledAt)}</th>
                <td className={`${td} font-mono`}>{outfallName(result.outfallId, outfalls)}</td>
                <td className={td}>{result.parameter}</td>
                <td className={`${td} tabular-nums`}>{resultValueText(result)}</td>
                <td className={td}>
                  {lines.length === 0
                    ? <span className="text-xs text-slate-500 dark:text-slate-400">No limit applies</span>
                    : (
                      <ul className="space-y-1.5">
                        {lines.map(line => (
                          <li key={line.key} className="space-y-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                              <StatusChip tone={line.chip.tone}>{line.chip.label}</StatusChip>
                              <span className="text-xs text-slate-700 dark:text-slate-300">{line.limit}</span>
                            </div>
                            {line.reason && <p className="text-xs text-slate-500 dark:text-slate-400">{line.reason}</p>}
                          </li>
                        ))}
                      </ul>
                    )}
                </td>
                <td className={td}>
                  {result.eventLabel && <p className="text-slate-800 dark:text-slate-200">{result.eventLabel}</p>}
                  {result.lab && <p className="text-xs text-slate-500 dark:text-slate-400">{result.lab}</p>}
                  {!result.eventLabel && !result.lab && none}
                  {result.note && <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{result.note}</p>}
                </td>
                <td className={td}><EvidenceLink path={result.evidenceId} label={label} /></td>
                {actions && (
                  <td className={td}>
                    <div className="flex justify-end gap-2">
                      <button type="button" className={secondaryButtonCls} aria-label={`Edit result: ${label}`} onClick={() => actions.onEdit(result)}>
                        <Pencil className="h-4 w-4" /> Edit
                      </button>
                      <button type="button" className={secondaryButtonCls} aria-label={`Delete result: ${label}`} onClick={() => actions.onDelete(result)}>
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
  )
}

// The stored path is private; a link to it is signed on demand and expires.
function EvidenceLink({ path, label }: { path: string | null; label: string }) {
  const url = useEvidenceUrl(path)
  if (!path) return none
  if (!url) return <span className="text-xs text-slate-500 dark:text-slate-400">Report attached</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open lab report for ${label}`} className="text-sm font-medium text-brand-navy underline-offset-2 hover:underline dark:text-brand-yellow">
      Open report
    </a>
  )
}
