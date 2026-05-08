'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2, Pencil, ScrollText } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { getManual, type ManualDetail } from '@/lib/manuals/client'
import { renderManualMd } from '@/lib/manuals/markdown'
import ManualToc from '@/components/manuals/ManualToc'

// /manuals/[moduleId] — read view. Body is rendered through the
// pre-escape-then-allow markdown pipeline, so dangerouslySetInnerHTML
// is safe here. The TOC renders in a sticky right rail on lg+.

function relative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString()
}

export default function ManualPage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const { profile }  = useAuth()
  const isSuperadmin = profile?.is_superadmin === true

  const [manual, setManual]   = useState<ManualDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
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
  }, [moduleId])

  const html = useMemo(
    () => manual ? renderManualMd(manual.body_md) : '',
    [manual],
  )

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
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

  const editor = manual.editor
  const editorName = editor?.full_name || editor?.email || 'a Soteria admin'

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <Link href="/manuals" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> All manuals
        </Link>
        <div className="inline-flex items-center gap-2">
          <Link
            href={`/manuals/${manual.module_id}/changelog`}
            className="inline-flex items-center gap-1 rounded-full ring-1 ring-slate-300 dark:ring-slate-700 px-2 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <ScrollText className="h-3 w-3" /> Changelog
          </Link>
          {isSuperadmin && (
            <Link
              href={`/superadmin/manuals/${manual.module_id}`}
              className="inline-flex items-center gap-1 rounded-full bg-brand-navy text-white px-2 py-1 text-xs font-medium hover:bg-brand-navy/90"
            >
              <Pencil className="h-3 w-3" /> Edit
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-6">
        <article className="min-w-0">
          <header className="mb-4">
            {!manual.published_at && (
              <span className="inline-block rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-200 mb-2">
                draft (visible to superadmins only)
              </span>
            )}
            <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">{manual.title}</h1>
            {manual.summary && (
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{manual.summary}</p>
            )}
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              v{manual.version} · last updated {relative(manual.updated_at)} by {editorName}
            </p>
          </header>

          <div
            className="prose-manual text-sm leading-relaxed text-slate-800 dark:text-slate-200"
            dangerouslySetInnerHTML={{ __html: html }}
          />

          <footer className="mt-8 pt-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center justify-between gap-2">
            <span>v{manual.version} · last updated {new Date(manual.updated_at).toLocaleString()} by {editorName}</span>
            <Link href={`/manuals/${manual.module_id}/changelog`} className="hover:underline">
              View changelog →
            </Link>
          </footer>
        </article>

        <aside className="hidden lg:block sticky top-20 self-start">
          <ManualToc items={manual.toc} />
        </aside>
      </div>
    </div>
  )
}
