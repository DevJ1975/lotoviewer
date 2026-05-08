'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { Leaderboard } from '../_components/Leaderboard'
import type { BBSLeaderboardRow } from '@soteria/core/bbsMetrics'

export default function BBSLeaderboardPage() {
  const { tenant } = useTenant()
  const [rows, setRows] = useState<BBSLeaderboardRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
    if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
    const res = await fetch(`/api/bbs/leaderboard?limit=50`, { headers })
    const body = await res.json()
    if (!res.ok) {
      setError(body.error ?? `HTTP ${res.status}`)
      return
    }
    setRows(body.leaderboard ?? [])
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <Link href="/bbs" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
        <ArrowLeft className="w-4 h-4" />
        Back to BBS
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">BBS Leaderboard</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Top contributors all-time. Anonymous submissions don&apos;t earn points.
        </p>
      </header>
      {error && (
        <div className="rounded border border-rose-300 bg-rose-50 dark:bg-rose-950/30 dark:border-rose-800 px-4 py-3 text-sm text-rose-800 dark:text-rose-200">
          {error}
        </div>
      )}
      <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
        <Leaderboard rows={rows ?? []} loading={rows === null} />
      </div>
    </div>
  )
}
