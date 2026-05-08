'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { getManual, type ManualDetail } from '@/lib/manuals/client'
import ManualEditor from '@/components/manuals/ManualEditor'

// /superadmin/manuals/[moduleId] — two-pane editor. Gated client-
// side by profile.is_superadmin; the API routes enforce the real
// guard via requireSuperadmin().

export default function ManualEditorPage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { profile, loading: authLoading } = useAuth()
  const isSuperadmin = profile?.is_superadmin === true

  const [manual, setManual]   = useState<ManualDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!isSuperadmin) { setLoading(false); return }
    if (!moduleId) return
    let cancelled = false
    void (async () => {
      try {
        const m = await getManual(moduleId)
        if (!cancelled) setManual(m)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [authLoading, isSuperadmin, moduleId])

  if (authLoading || loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!isSuperadmin) {
    return (
      <div className="max-w-3xl mx-auto p-8">
        <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
          Superadmin only.
        </p>
      </div>
    )
  }
  if (error || !manual) {
    return (
      <div className="max-w-3xl mx-auto p-8 space-y-3">
        <Link href="/manuals" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> All manuals
        </Link>
        <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">
          {error ?? 'Manual not found.'}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/manuals/${manual.module_id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Read view
        </Link>
        <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200">
          superadmin editor
        </span>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Edit: {manual.title}</h1>
      <ManualEditor initial={manual} />
    </div>
  )
}
