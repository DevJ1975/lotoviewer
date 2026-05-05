'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import type { Equipment } from '@soteria/core/types'
import { loadAllEquipment } from '@/lib/queries/equipment'
import StatsCards from '@/components/StatsCards'
import ProgressRing from '@/components/ProgressRing'
import DepartmentChart from '@/components/DepartmentChart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { buildDeptStats } from '@/lib/utils'
import { useVisibilityRefetch } from '@/hooks/useVisibilityRefetch'
import { StatusSkeleton } from '@/components/Skeleton'

export default function StatusPage() {
  const [equipment, setEquipment]     = useState<Equipment[]>([])
  const [loading, setLoading]         = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  const fetchData = useCallback(async () => {
    try {
      const data = await loadAllEquipment()
      setEquipment(data)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('[status] fetch failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()

    const channel = supabase
      .channel('loto_equipment_status')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'loto_equipment' }, fetchData)
      .subscribe()

    const interval = setInterval(fetchData, 30_000)

    return () => {
      supabase.removeChannel(channel)
      clearInterval(interval)
    }
  }, [fetchData])

  // The 30 s poll + realtime channel keep this view fresh on an open tab,
  // but both are missed while the tab is suspended (iPad backgrounded for
  // minutes to hours). Visibility refetch closes that gap on return.
  useVisibilityRefetch(fetchData)

  // Single pass over equipment to compute all stats — previously 4 separate
  // .filter() scans of the same array.
  const { total, complete, partial, missing, pct, active } = useMemo(() => {
    const active: Equipment[] = []
    let complete = 0, partial = 0, missing = 0
    for (const e of equipment) {
      if (e.decommissioned) continue
      active.push(e)
      if (e.photo_status === 'complete') complete++
      else if (e.photo_status === 'partial') partial++
      else missing++
    }
    const total = active.length
    const pct   = total > 0 ? (complete / total) * 100 : 0
    return { total, complete, partial, missing, pct, active }
  }, [equipment])

  const deptStats = useMemo(
    () => buildDeptStats(active).sort((a, b) => a.department.localeCompare(b.department)),
    [active],
  )

  if (loading) return <StatusSkeleton />

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live LOTO Status</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Auto-refreshes every 30 s via Supabase Realtime
            {lastUpdated && <> · Last updated {lastUpdated.toLocaleTimeString()}</>}
          </p>
        </div>
        <span className="flex items-center gap-2 text-xs text-green-600 font-medium">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
          Live
        </span>
      </div>

      <StatsCards total={total} complete={complete} partial={partial} missing={missing} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="flex items-center justify-center py-6">
          <CardContent className="flex flex-col items-center gap-4 p-6">
            <ProgressRing value={pct} size={200} label="Overall Complete" sublabel={`${complete} of ${total}`} />
            <div className="flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Complete
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Partial
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Missing
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Completion by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {deptStats.length > 0 ? (
              <DepartmentChart data={deptStats} />
            ) : (
              <p className="text-gray-400 text-sm py-8 text-center">No department data available.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
