import { formatDay, timelineEntries, type TimelineEntry } from '@/lib/hazardousWasteManifestView'
import type { HazardousWasteShipmentRow } from '@soteria/core/hazardousWasteManifest'

// The manifest's life in order. A step that has not happened reads "Not yet" rather than
// being left off, so it is plain what is still owed.

export function ManifestTimeline({ manifest }: { manifest: Pick<HazardousWasteShipmentRow, 'status' | 'created_at' | 'updated_at' | 'shipped_on' | 'completed_on' | 'exception_reported_on'> }) {
  const entries: TimelineEntry[] = timelineEntries(manifest)
  return (
    <ol aria-label="Manifest timeline" className="space-y-2">
      {entries.map(entry => (
        <li key={entry.key} className="flex items-baseline justify-between gap-3 border-l-2 border-slate-200 pl-3 dark:border-slate-700">
          <span className="text-sm text-slate-800 dark:text-slate-200">{entry.label}</span>
          <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">
            {entry.date ? formatDay(entry.date) : 'Not yet'}
          </span>
        </li>
      ))}
    </ol>
  )
}
