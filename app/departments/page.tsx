'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { DepartmentStats, LotoReview } from '@/lib/types'
import { Card, CardContent } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { buildDeptStats } from '@/lib/utils'
import { applyRenameToStats, applyRenameToReviews } from '@/lib/departments'
import RenameDepartmentModal from '@/components/RenameDepartmentModal'
import { useVisibilityRefetch } from '@/hooks/useVisibilityRefetch'

type LatestReviewMap = Record<string, LotoReview>

export default function DepartmentsPage() {
  const [stats, setStats]                 = useState<DepartmentStats[]>([])
  const [latestReviews, setLatestReviews] = useState<LatestReviewMap>({})
  const [loading, setLoading]             = useState(true)
  const [renamingDept, setRenamingDept]   = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    const [equipRes, reviewRes] = await Promise.all([
      supabase
        .from('loto_equipment')
        .select('department, photo_status'),
      supabase
        .from('loto_reviews')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200),
    ])
    if (equipRes.data) setStats(buildDeptStats(equipRes.data).sort((a, b) => b.total - a.total))

    // Keep only the most recent review per department
    const map: LatestReviewMap = {}
    for (const r of (reviewRes.data ?? []) as LotoReview[]) {
      if (!map[r.department]) map[r.department] = r
    }
    setLatestReviews(map)

    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
  useVisibilityRefetch(fetchData)

  const handleRenamed = (oldName: string, newName: string) => {
    setStats(prev => applyRenameToStats(prev, oldName, newName).sort((a, b) => b.total - a.total))
    setLatestReviews(prev => applyRenameToReviews(prev, oldName, newName))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-4 border-brand-navy border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Departments</h1>
        <p className="text-sm text-slate-500 mt-0.5">{stats.length} departments · click a card to view equipment</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {stats.map(s => {
          const pctColor =
            s.pct >= 80 ? 'text-emerald-600' : s.pct >= 50 ? 'text-amber-600' : 'text-rose-600'
          const barClass =
            s.pct >= 80
              ? '[&_[data-slot=progress-indicator]]:bg-emerald-500'
              : s.pct >= 50
                ? '[&_[data-slot=progress-indicator]]:bg-amber-400'
                : '[&_[data-slot=progress-indicator]]:bg-rose-500'
          const review = latestReviews[s.department]

          return (
            <Link key={s.department} href={`/departments/${encodeURIComponent(s.department)}`}>
              <Card className="bg-white border border-slate-100 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all duration-150 cursor-pointer h-full">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-slate-800 leading-tight text-[15px]">{s.department}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={e => {
                          e.preventDefault()
                          e.stopPropagation()
                          setRenamingDept(s.department)
                        }}
                        className="p-1 rounded-md text-slate-300 hover:text-slate-700 hover:bg-slate-100 focus:text-slate-700 focus:bg-slate-100 transition-colors"
                        aria-label={`Rename ${s.department}`}
                        title="Rename department"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <span className={`text-lg font-bold tabular-nums ${pctColor}`}>{s.pct}%</span>
                    </div>
                  </div>

                  <Progress value={s.pct} className={`h-1.5 ${barClass}`} />

                  <div className="flex gap-3 text-xs">
                    <span className="text-emerald-600 font-medium">{s.complete} done</span>
                    <span className="text-amber-500 font-medium">{s.partial} partial</span>
                    <span className="text-rose-500 font-medium">{s.missing} missing</span>
                  </div>

                  <div className="flex items-center justify-between pt-0.5">
                    <p className="text-[11px] text-slate-400 font-medium uppercase tracking-wide">{s.total} equipment</p>
                    {review ? (
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                        review.approved ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                      }`}>
                        {review.approved ? '✓ Reviewed' : '⚠ Action Needed'}
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-300 font-medium">No review yet</span>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>

      {renamingDept && (
        <RenameDepartmentModal
          currentName={renamingDept}
          onClose={() => setRenamingDept(null)}
          onRenamed={newName => handleRenamed(renamingDept, newName)}
        />
      )}
    </div>
  )
}
