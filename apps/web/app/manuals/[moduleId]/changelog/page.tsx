'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Loader2 } from 'lucide-react'
import {
  getManual, getVersion, listVersions,
  type ManualDetail, type ManualVersionDetail, type ManualVersionMeta,
} from '@/lib/manuals/client'
import ManualDiff from '@/components/manuals/ManualDiff'

// /manuals/[moduleId]/changelog — version timeline + diff view.
//
// Click a version to expand a diff against the version below it
// (i.e. the previous version). Diffing the very first version shows
// it against the empty string — the whole post is "added."

export default function ChangelogPage() {
  const { moduleId } = useParams<{ moduleId: string }>()
  const [manual, setManual]   = useState<ManualDetail | null>(null)
  const [versions, setVersions] = useState<ManualVersionMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeBefore, setActiveBefore] = useState<string | null>(null)
  const [activeAfter,  setActiveAfter]  = useState<string | null>(null)
  const [loadingDiff, setLoadingDiff] = useState(false)

  useEffect(() => {
    if (!moduleId) return
    let cancelled = false
    void (async () => {
      try {
        const [m, v] = await Promise.all([
          getManual(moduleId),
          listVersions(moduleId),
        ])
        if (!cancelled) {
          setManual(m)
          setVersions(v)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [moduleId])

  async function showDiffFor(version: ManualVersionMeta, idx: number) {
    if (!manual) return
    if (activeId === version.id) {
      setActiveId(null); setActiveBefore(null); setActiveAfter(null); return
    }
    setActiveId(version.id); setLoadingDiff(true); setActiveBefore(null); setActiveAfter(null)
    try {
      // The "after" of this version is the body that REPLACED it in
      // the next-newer save. Versions are ordered desc, so:
      //   idx > 0       → the row above (newer); its body is the
      //                   pre-save state of the save AFTER this one,
      //                   which equals the post-save of the next-
      //                   older save. That's circular — we want to
      //                   show "what this save changed vs the prior
      //                   save", so the body BEFORE this save is the
      //                   row immediately below in versions[].
      //
      // For the most recent save (idx === 0), the post-save state is
      // the live manual.body_md.
      const before = idx + 1 < versions.length
        ? (await getVersion(moduleId!, versions[idx + 1].id)).body_md
        : ''
      const after = idx === 0
        ? manual.body_md
        : (await getVersion(moduleId!, versions[idx - 1].id)).body_md
      // Also show the *pre-save* body of THIS version for context
      // (it's what the save replaced).
      const thisVersion: ManualVersionDetail = await getVersion(moduleId!, version.id)
      // Show the diff: this version's archived body → next-newer
      // (which is the live body if idx===0).
      setActiveBefore(thisVersion.body_md)
      setActiveAfter(after)
      // before is unused but kept for future "show context against
      // the version below" UI; mark consumed:
      void before
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setActiveId(null)
    } finally {
      setLoadingDiff(false)
    }
  }

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

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href={`/manuals/${manual.module_id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> {manual.title}
      </Link>

      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Changelog</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Every save creates a snapshot. Click a row to see what changed.
        </p>
      </header>

      {versions.length === 0 ? (
        <p className="text-sm italic text-slate-500 dark:text-slate-400">
          This manual has only its initial version. Edits will appear here.
        </p>
      ) : (
        <ul className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
          {versions.map((v, idx) => {
            const expanded = activeId === v.id
            const author = v.author_full_name || v.author_email || 'a Soteria admin'
            return (
              <li key={v.id}>
                <button
                  type="button"
                  onClick={() => void showDiffFor(v, idx)}
                  className="w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">v{v.version}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {new Date(v.created_at).toLocaleString()} · {author}
                    </span>
                  </div>
                  {v.change_note && (
                    <p className="text-sm text-slate-700 dark:text-slate-200 italic mt-0.5">&ldquo;{v.change_note}&rdquo;</p>
                  )}
                </button>
                {expanded && (
                  <div className="px-4 pb-4">
                    {loadingDiff ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400 inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading diff…
                      </p>
                    ) : activeBefore !== null && activeAfter !== null ? (
                      <ManualDiff before={activeBefore} after={activeAfter} />
                    ) : null}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
