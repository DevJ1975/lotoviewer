'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, BookText, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { formatSupabaseError } from '@/lib/supabaseError'
import { ISO45001_CLAUSE_MAP } from '@soteria/core/iso45001'

// /admin/evidence/iso45001 — clause map landing.
//
// Lists every clause we satisfy with the modules that contribute
// evidence. Each row drills into /admin/evidence/iso45001/[clauseCode] which
// shows curated evidence + an export button.

interface ClauseEvidenceCount {
  clause_code: string
  count:       number
}

export default function Iso45001MapPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [counts, setCounts]       = useState<Map<string, number>>(new Map())
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loaded, setLoaded]       = useState(false)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const { data, error } = await supabase
        .from('iso45001_clause_evidence')
        .select('clause_code')
        .eq('tenant_id', tenantId)
        .limit(10_000)
      if (error) throw new Error(formatSupabaseError(error, 'load clause evidence'))
      const m = new Map<string, number>()
      for (const row of ((data ?? []) as ClauseEvidenceCount[])) {
        m.set(row.clause_code, (m.get(row.clause_code) ?? 0) + 1)
      }
      setCounts(m)
      setLoaded(true)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load evidence counts.')
      setLoaded(true)
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <BookText className="h-6 w-6 text-brand-navy" />
          ISO 45001:2018 clause map
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Every clause we satisfy and which platform modules supply the evidence. Curated pins live in
          iso45001_clause_evidence — click into a clause to pin specific rows and export an evidence pack.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      ) : (
        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-950/40 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              <tr>
                <th className="text-left px-4 py-2 w-24">Clause</th>
                <th className="text-left px-4 py-2">Title</th>
                <th className="text-left px-4 py-2">Modules</th>
                <th className="text-right px-4 py-2 w-32">Pinned evidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ISO45001_CLAUSE_MAP.map(entry => (
                <tr key={entry.code} className="hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <td className="px-4 py-2 font-mono text-xs text-slate-900 dark:text-slate-100">
                    <Link href={`/admin/evidence/iso45001/${encodeURIComponent(entry.code)}`} className="text-brand-navy hover:underline">
                      {entry.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                    {entry.title}
                  </td>
                  <td className="px-4 py-2 text-[11px] text-slate-500 dark:text-slate-400">
                    {entry.sources.join(', ')}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    <Link href={`/admin/evidence/iso45001/${encodeURIComponent(entry.code)}`} className="text-brand-navy hover:underline">
                      {counts.get(entry.code) ?? 0} pinned
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
