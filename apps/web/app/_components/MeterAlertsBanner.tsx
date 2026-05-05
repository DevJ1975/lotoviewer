'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { bumpStatus } from '@/lib/gasMeters'
import type { GasMeter } from '@soteria/core/types'

// Visual companion to the bump-test reminder push (cron route at
// /api/cron/meter-bump-reminders). The push wakes a user who isn't
// looking at the app; this banner shows the same overdue meters to a
// user who IS on the dashboard, so they don't have to wait for a
// notification cycle.
//
// Kept lightweight: one query of the live (non-decommissioned) gas
// meters, derive bump status client-side using the same helper the
// permit page uses, render only when at least one is overdue or
// never-bumped. Fail-soft if the table is missing (pre-migration-012).

interface OverdueMeter {
  instrument_id: string
  description:   string | null
  kind:          'overdue' | 'never'
  hoursSince:    number | null
}

export function MeterAlertsBanner() {
  const [overdue, setOverdue] = useState<OverdueMeter[] | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data, error } = await supabase
        .from('loto_gas_meters')
        .select('*')
        .eq('decommissioned', false)
      if (cancelled) return
      if (error || !data) {
        // Pre-migration-012 the table doesn't exist; silently render
        // nothing in that case rather than surfacing a confusing error.
        setOverdue([])
        return
      }
      const now = Date.now()
      const out: OverdueMeter[] = []
      for (const m of data as GasMeter[]) {
        const status = bumpStatus(m, now)
        if (status.kind === 'overdue') {
          out.push({
            instrument_id: m.instrument_id,
            description:   m.description,
            kind:          'overdue',
            hoursSince:    status.hoursSince,
          })
        } else if (status.kind === 'never') {
          out.push({
            instrument_id: m.instrument_id,
            description:   m.description,
            kind:          'never',
            hoursSince:    null,
          })
        }
      }
      setOverdue(out)
    }

    load()
    // Refresh every 5 min so a meter that gets bump-tested mid-shift
    // disappears without the user reloading the page. Cheap query — the
    // meter register is small.
    const id = setInterval(load, 5 * 60_000)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  // Initial load + empty case render nothing — the banner is meant to
  // be invisible when there's nothing to flag.
  if (!overdue || overdue.length === 0) return null

  return (
    <Link
      href="/admin/configuration"
      className="block bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/60 border border-amber-300 rounded-xl p-4 ring-1 ring-amber-300 transition-colors"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-100">
            {overdue.length} gas meter{overdue.length === 1 ? '' : 's'} need a bump test
          </p>
          <p className="text-[11px] text-amber-900/80 dark:text-amber-100/80 mt-0.5">
            §(d)(5)(i) requires a calibrated direct-reading instrument. Bump before next entry.
          </p>
          {/* Show the first 3 by name; the count above covers the rest. */}
          <ul className="mt-2 text-[11px] text-amber-900/90 dark:text-amber-100/90 space-y-0.5">
            {overdue.slice(0, 3).map(m => (
              <li key={m.instrument_id}>
                <span className="font-mono font-semibold">{m.instrument_id}</span>
                {' — '}
                {m.kind === 'never'
                  ? 'never bumped on this system'
                  : `last bumped ${m.hoursSince}h ago`}
                {m.description && (
                  <span className="text-amber-900/70 dark:text-amber-100/70"> · {m.description}</span>
                )}
              </li>
            ))}
            {overdue.length > 3 && (
              <li className="text-amber-900/70 dark:text-amber-100/70">
                + {overdue.length - 3} more — open the meter register to review.
              </li>
            )}
          </ul>
        </div>
      </div>
    </Link>
  )
}
