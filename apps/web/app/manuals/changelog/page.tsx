'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { listChangelog, type ChangelogEntry } from '@/lib/manuals/client'

// /manuals/changelog — master rollup across every manual the caller
// can see. Time-ordered.

function relative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60_000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString()
}

export default function MasterChangelogPage() {
  const [entries, setEntries] = useState<ChangelogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const list = await listChangelog({ limit: 100 })
        if (!cancelled) setEntries(list)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/manuals" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> All manuals
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Master changelog</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every saved revision across every manual, newest first.
        </p>
      </header>

      {error && <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}

      {entries.length === 0 ? (
        <p className="text-sm italic text-slate-500 dark:text-slate-400">
          No revisions yet — manuals are at their initial versions.
        </p>
      ) : (
        <ul className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {entries.map(e => {
            const author = e.author_full_name || e.author_email || 'a Soteria admin'
            return (
              <li key={e.id}>
                <Link
                  href={`/manuals/${e.module_id}/changelog`}
                  className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                      {e.module_id}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{e.module_title} · v{e.version}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {relative(e.created_at)} · {author}
                    </span>
                  </div>
                  {e.change_note && (
                    <p className="text-sm text-slate-700 dark:text-slate-200 italic mt-0.5">&ldquo;{e.change_note}&rdquo;</p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
