'use client'

import Link from 'next/link'
import { Pencil, Trash2 } from 'lucide-react'
import { StatusChip } from '@/components/environmental/badges'
import { secondaryButtonCls } from '@/components/environmental/form'
import type { Outfall, Permit } from '@/lib/environmental/client'
import { useEvidenceUrl } from '@/lib/environmental/useEvidenceUrl'
import {
  coordinatesLabel, inspectHref, OUTFALL_STATUS_META, OUTFALL_TYPE_LABELS, representativeOfLabel,
} from '@/lib/environmental/outfallView'
import { permitLabel } from '@/lib/environmental/permitView'

// The site's outfalls, one row each. Everyone can inspect an outfall; only a tenant
// admin, who is given `actions`, can change or delete one.

interface Props {
  outfalls: Outfall[]
  permits: Permit[]
  actions?: { onEdit: (outfall: Outfall) => void; onDelete: (outfall: Outfall) => void }
}

const th = 'px-3 py-2 font-semibold'
const td = 'px-3 py-2 align-top'
const none = <span className="text-slate-400 dark:text-slate-500">—</span>

export function OutfallsTable({ outfalls, permits, actions }: Props) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <caption className="sr-only">Outfalls at this site</caption>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
          <tr>
            <th scope="col" className={th}>Outfall</th>
            <th scope="col" className={th}>Receiving water</th>
            <th scope="col" className={th}>Type</th>
            <th scope="col" className={th}>Represents</th>
            <th scope="col" className={th}>Permit</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={th}>Coordinates</th>
            <th scope="col" className={th}>Photo</th>
            <th scope="col" className={th}><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
          {outfalls.map(outfall => {
            const status = OUTFALL_STATUS_META[outfall.status]
            const permit = permits.find(p => p.id === outfall.permit_id)
            const inspect = inspectHref(outfall)
            return (
              <tr key={outfall.id} className="bg-white dark:bg-slate-950">
                <th scope="row" className={`${td} text-left font-normal`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{outfall.code}</span>{' '}
                    {outfall.is_sampling_point && <StatusChip tone="idle">Sampling point</StatusChip>}
                  </div>
                  {outfall.name && <p className="text-slate-700 dark:text-slate-300">{outfall.name}</p>}
                </th>
                <td className={td}>{outfall.receiving_water ?? none}</td>
                <td className={td}>{OUTFALL_TYPE_LABELS[outfall.outfall_type]}</td>
                <td className={td}>{representativeOfLabel(outfall, outfalls) ?? none}</td>
                <td className={td}>{permit ? permitLabel(permit) : none}</td>
                <td className={td}><StatusChip tone={status.tone}>{status.label}</StatusChip></td>
                <td className={`${td} font-mono text-xs`}>{coordinatesLabel(outfall) ?? none}</td>
                <td className={td}><OutfallPhoto outfall={outfall} /></td>
                <td className={td}>
                  <div className="flex justify-end gap-2">
                    {inspect && (
                      <Link href={inspect} className={secondaryButtonCls} aria-label={`Inspect ${outfall.code}`}>Inspect</Link>
                    )}
                    {actions && (
                      <>
                        <button type="button" className={secondaryButtonCls} aria-label={`Edit ${outfall.code}`} onClick={() => actions.onEdit(outfall)}>
                          <Pencil className="h-4 w-4" /> Edit
                        </button>
                        <button type="button" className={secondaryButtonCls} aria-label={`Delete ${outfall.code}`} onClick={() => actions.onDelete(outfall)}>
                          <Trash2 className="h-4 w-4" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// The stored path is private; a link to it is signed on demand and expires.
function OutfallPhoto({ outfall }: { outfall: Outfall }) {
  const path = outfall.photo_path
  const url = useEvidenceUrl(path)

  if (!path) return none
  if (!url) return <span className="text-xs text-slate-500 dark:text-slate-400">Photo attached</span>
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL; the image optimizer cannot fetch it */}
      <img src={url} alt={`Photo of outfall ${outfall.code}`} className="h-10 w-14 rounded border border-slate-200 object-cover dark:border-slate-700" />
    </a>
  )
}
