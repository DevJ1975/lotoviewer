'use client'

import type { ConfinedSpacePermit } from '@/lib/types'

export function RescueDisplay({ rescue }: { rescue: ConfinedSpacePermit['rescue_service'] }) {
  if (!rescue || Object.keys(rescue).length === 0) {
    return <p className="text-xs text-slate-400 dark:text-slate-500 italic">No rescue service recorded.</p>
  }
  return (
    <p className="text-xs">
      <span className="font-semibold text-slate-700 dark:text-slate-300">Rescue:</span>{' '}
      {rescue.name ?? 'unnamed'}
      {rescue.phone && <> · <span className="font-mono">{rescue.phone}</span></>}
      {rescue.eta_minutes != null && <> · ETA {rescue.eta_minutes} min</>}
      {rescue.equipment && rescue.equipment.length > 0 && (
        <> · {rescue.equipment.join(', ')}</>
      )}
    </p>
  )
}
