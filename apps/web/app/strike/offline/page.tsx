'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CloudDownload, Loader2, RefreshCw, Trash2 } from 'lucide-react'
import {
  STRIKE_OFFLINE_CAP_DEFAULT_MB,
  deleteStrikeVideo,
  enforceOfflineCap,
  getOfflineCapMb,
  listOfflineMetadata,
  setOfflineCapMb,
  type StrikeOfflineModuleMeta,
} from '@/lib/offline/strikeOffline'
import { listQueuedAttempts, removeQueuedAttempt, type QueuedStrikeAttempt } from '@/lib/offline/strikeQueue'

// /strike/offline — learner-facing manager for what's cached locally
// (videos) and what's waiting to sync (quiz attempts). The cap setting is
// a per-device localStorage value; we hint at the trade-offs but the
// floor and absolute ceiling come from decideStrikeEvictions().

function formatMb(bytes: number): string {
  if (bytes <= 0) return '0 MB'
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function StrikeOfflinePage() {
  const [modules, setModules] = useState<StrikeOfflineModuleMeta[]>([])
  const [queued, setQueued] = useState<QueuedStrikeAttempt[]>([])
  const [capMb, setCapMb] = useState(STRIKE_OFFLINE_CAP_DEFAULT_MB)
  const [loading, setLoading] = useState(true)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [draftCap, setDraftCap] = useState(String(STRIKE_OFFLINE_CAP_DEFAULT_MB))

  const refresh = useCallback(async () => {
    setLoading(true)
    const [mods, queue] = await Promise.all([listOfflineMetadata(), listQueuedAttempts()])
    setModules(mods.slice().sort((a, b) => b.lastUsedAt - a.lastUsedAt))
    setQueued(queue)
    setLoading(false)
  }, [])

  useEffect(() => {
    setCapMb(getOfflineCapMb())
    setDraftCap(String(getOfflineCapMb()))
    void refresh()
  }, [refresh])

  async function removeModule(path: string) {
    setBusyPath(path)
    await deleteStrikeVideo(path)
    await refresh()
    setBusyPath(null)
  }

  async function applyCap() {
    const next = Number(draftCap)
    if (!Number.isFinite(next) || next <= 0) return
    setOfflineCapMb(next)
    setCapMb(getOfflineCapMb())
    await enforceOfflineCap()
    await refresh()
  }

  async function removeQueued(id: string) {
    await removeQueuedAttempt(id)
    await refresh()
  }

  const totalBytes = modules.reduce((sum, m) => sum + m.sizeBytes, 0)
  const capBytes = capMb * 1024 * 1024
  const usagePercent = capBytes === 0 ? 0 : Math.min(100, Math.round((totalBytes / capBytes) * 100))

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6 sm:px-6">
      <header className="space-y-2">
        <Link href="/strike" className="inline-flex items-center gap-2 text-sm text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-4 w-4" /> STRIKE library
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
          <CloudDownload className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
          Offline content
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Manage downloaded training videos and any quiz attempts waiting to sync.
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Storage cap</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              When the cap is reached, the least-recently-watched module is removed first.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={50}
              max={4000}
              value={draftCap}
              onChange={e => setDraftCap(e.target.value)}
              className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-700 dark:bg-slate-950"
              aria-label="Cap in megabytes"
            />
            <span className="text-xs text-slate-500 dark:text-slate-400">MB</span>
            <button
              type="button"
              onClick={() => void applyCap()}
              className="rounded-md bg-brand-navy px-3 py-1 text-xs font-semibold text-white hover:bg-brand-navy/90"
            >
              Apply
            </button>
          </div>
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div
            className={`h-full rounded-full ${usagePercent >= 90 ? 'bg-rose-500' : usagePercent >= 70 ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {formatMb(totalBytes)} of {capMb} MB used ({usagePercent}%)
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Downloaded modules</h2>
          <button
            type="button"
            onClick={() => void refresh()}
            aria-label="Refresh"
            className="rounded-md p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>
        {modules.length === 0 ? (
          <p className="px-4 py-6 text-sm italic text-slate-500 dark:text-slate-400">
            No videos downloaded yet. Use the &ldquo;Download for offline&rdquo; button on a module page.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {modules.map(m => (
              <li key={m.path} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{m.title}</p>
                  <p className="truncate text-xs text-slate-500 dark:text-slate-400">
                    {formatMb(m.sizeBytes)} · last used {new Date(m.lastUsedAt).toLocaleDateString()}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeModule(m.path)}
                  disabled={busyPath === m.path}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {busyPath === m.path ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Queued submissions</h2>
        </div>
        {queued.length === 0 ? (
          <p className="px-4 py-6 text-sm italic text-slate-500 dark:text-slate-400">
            Nothing queued — quiz submissions are flushed automatically when you regain connectivity.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {queued.map(q => (
              <li key={q.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-slate-900 dark:text-slate-100">
                    Module {q.moduleId.slice(0, 8)}…
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Queued {new Date(q.createdAt).toLocaleString()}
                    {q.attempts > 0 ? ` · ${q.attempts} retry attempt${q.attempts === 1 ? '' : 's'}` : ''}
                  </p>
                  {q.lastError && (
                    <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{q.lastError}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => void removeQueued(q.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  <Trash2 className="h-3 w-3" />
                  Discard
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
