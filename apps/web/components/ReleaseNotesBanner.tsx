'use client'

import { useEffect, useState } from 'react'
import { Megaphone, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { renderReleaseNoteMd } from '@/lib/markdown'
import type { LatestReleaseNote } from '@/app/api/release-notes/latest/route'

// Banner that surfaces the most recent published release note to
// every authenticated user. Dismissed state lives in localStorage
// keyed on the note id, so dismissing one note doesn't hide the
// next one. No server-side per-user read-state — at this scale
// it's not worth a table.
//
// Mounted in AppChrome above the page content. No-op on /login.

const SEEN_KEY = 'soteria.releaseNote.seenId'

export function ReleaseNotesBanner() {
  const [note, setNote]       = useState<LatestReleaseNote | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!session?.access_token) return  // not signed in; don't fire
        const res = await fetch('/api/release-notes/latest', {
          headers: { authorization: `Bearer ${session.access_token}` },
          cache: 'no-store',
        })
        if (!res.ok) return
        const j = await res.json() as { note: LatestReleaseNote | null }
        if (cancelled || !j.note) return
        // Already-seen check — localStorage holds the most recently
        // dismissed note's id. A new note with a higher id resurfaces.
        let seenId = 0
        try { seenId = Number(localStorage.getItem(SEEN_KEY) ?? '0') } catch { /* private mode */ }
        if (Number.isFinite(seenId) && seenId >= j.note.id) return
        setNote(j.note)
      } catch {
        // Best-effort; banner is informational, never block the page.
      }
    })()
    return () => { cancelled = true }
  }, [])

  function dismiss() {
    if (!note) return
    setDismissed(true)
    try { localStorage.setItem(SEEN_KEY, String(note.id)) } catch { /* private mode */ }
  }

  if (!note || dismissed) return null

  return (
    <div className="bg-brand-yellow/40 dark:bg-brand-yellow/10 border-b border-brand-yellow/60 dark:border-brand-yellow/30 px-4 py-3">
      <div className="max-w-6xl mx-auto flex items-start gap-3">
        <Megaphone className="h-5 w-5 text-brand-navy dark:text-brand-yellow shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 text-sm text-slate-800 dark:text-slate-100">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{note.version}</code>
            <span className="font-semibold">{note.title}</span>
          </div>
          <div
            className="mt-1 text-xs text-slate-700 dark:text-slate-200 [&_p]:mb-1 [&_ul]:my-1 [&_a]:text-brand-navy dark:[&_a]:text-brand-yellow"
            dangerouslySetInnerHTML={{ __html: renderReleaseNoteMd(note.body_md) }}
          />
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
