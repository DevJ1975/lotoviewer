'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import {
  classifyPeriodic,
  type PeriodicStatus,
} from '@soteria/core/lotoPeriodicInspection'
import type { Equipment } from '@soteria/core/types'

// Dashboard banner for §147(c)(6) overdue periodic inspections.
//
// Surfaces a one-line count on /loto and /status. Clicking jumps to
// /admin/periodic-inspections where the admin sees the per-equipment
// list. Silent when there are no overdue items so it doesn't pollute
// the dashboard during normal operation.

export default function PeriodicInspectionWidget() {
  const { tenantId } = useTenant()
  const [counts, setCounts] = useState<Record<PeriodicStatus, number> | null>(null)

  useEffect(() => {
    if (!tenantId) return
    let canceled = false
    ;(async () => {
      const { data, error } = await supabase
        .from('loto_equipment')
        .select('equipment_id, next_periodic_review_due_at, decommissioned')
        .eq('tenant_id', tenantId)
      if (canceled || error || !data) return
      const now = new Date()
      const buckets: Record<PeriodicStatus, number> = { overdue: 0, due_soon: 0, never: 0, current: 0 }
      for (const row of data as Pick<Equipment, 'equipment_id' | 'next_periodic_review_due_at' | 'decommissioned'>[]) {
        if (row.decommissioned) continue
        buckets[classifyPeriodic(row.next_periodic_review_due_at, now)]++
      }
      setCounts(buckets)
    })()
    return () => { canceled = true }
  }, [tenantId])

  if (!counts) return null
  const overdue = counts.overdue + counts.never  // "never inspected" is also a §147(c)(6) gap
  if (overdue === 0 && counts.due_soon === 0) return null

  return (
    <Link
      href="/admin/periodic-inspections"
      className="block rounded-xl border border-rose-300 bg-rose-50 dark:bg-rose-950/40 px-4 py-3 hover:bg-rose-100/70 dark:hover:bg-rose-950/60 transition-colors"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-rose-700 dark:text-rose-300 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-rose-900 dark:text-rose-100">
            {overdue > 0
              ? `${overdue} procedure${overdue === 1 ? '' : 's'} overdue for §147(c)(6) review`
              : `${counts.due_soon} procedure${counts.due_soon === 1 ? '' : 's'} due for review within 30 days`}
          </p>
          <p className="text-[11px] text-rose-900/80 dark:text-rose-100/80 mt-0.5">
            Annual inspection required — open the list to record this year&rsquo;s.
          </p>
        </div>
      </div>
    </Link>
  )
}
