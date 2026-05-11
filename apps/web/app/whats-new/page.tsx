'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle, Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { renderReleaseNoteMd } from '@/lib/markdown'
import { VERSION_LINE } from '@/lib/version'
import type { LatestReleaseNote } from '@/app/api/release-notes/latest/route'

// Public-to-authenticated changelog. Reached by clicking the version
// pill in the footer. Lists every published release note in reverse
// chronological order. The in-app banner shows only the most recent
// note; this page is where users go to scroll back through history.

export default function WhatsNewPage() {
  const [notes, setNotes]     = useState<LatestReleaseNote[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) {
          if (!cancelled) { setError('Sign in to view release notes.'); setLoading(false) }
          return
        }
        const res = await fetch('/api/release-notes', {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        const j = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(j?.error ?? `HTTP ${res.status}`)
          setNotes(null)
        } else {
          setNotes((j.notes ?? []) as LatestReleaseNote[])
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link href="/" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> Home
      </Link>

      <header className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Megaphone className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
          What&rsquo;s new
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          Recent changes to Soteria FIELD. Currently running{' '}
          <code className="font-mono text-[12px]">{VERSION_LINE}</code>.
        </p>
      </header>

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      {!loading && notes && notes.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">
          No release notes yet.
        </p>
      )}

      {notes && notes.length > 0 && (
        <ol className="space-y-6">
          {notes.map(n => (
            <li
              key={n.id}
              className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-5"
            >
              <div className="flex items-baseline gap-3 flex-wrap mb-1">
                <code className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{n.version}</code>
                <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 flex-1 min-w-0">
                  {n.title}
                </h2>
                <time
                  className="text-[11px] text-slate-400 dark:text-slate-500 font-mono shrink-0"
                  dateTime={n.published_at}
                >
                  {new Date(n.published_at).toLocaleDateString()}
                </time>
              </div>
              <div
                className="text-sm text-slate-700 dark:text-slate-200 [&_p]:mb-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_a]:text-brand-navy dark:[&_a]:text-brand-yellow [&_a]:underline"
                dangerouslySetInnerHTML={{ __html: renderReleaseNoteMd(n.body_md) }}
              />
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
