'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, MessageSquare, Plus, Shield, EyeOff } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import BoardSearch from '@/components/safetyBoards/BoardSearch'
import { listBoards, createBoard, type SafetyBoardSummary } from '@/lib/safetyBoards/client'

// /safety-boards — index of all boards in the active tenant. Admin
// users can create new boards from this page. Members see read-only.

export default function SafetyBoardsIndex() {
  const { tenant, role } = useTenant()
  const isAdmin = role === 'admin' || role === 'owner'

  const [boards, setBoards] = useState<SafetyBoardSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [name, setName]   = useState('')
  const [desc, setDesc]   = useState('')
  const [allowAnon, setAllowAnon] = useState(false)
  const [busy, setBusy]   = useState(false)

  const refresh = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const list = await listBoards(tenant.id)
      setBoards(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant])

  useEffect(() => { void refresh() }, [refresh])

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id || !name.trim()) return
    setBusy(true); setError(null)
    try {
      await createBoard(tenant.id, {
        name: name.trim(),
        description: desc.trim() || undefined,
        allow_anonymous: allowAnon,
      })
      setName(''); setDesc(''); setAllowAnon(false); setShowForm(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            Safety boards
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Internal forums for safety topics. Anyone in the tenant can post a thread; admins can pin or lock.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowForm(s => !s)}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
          >
            <Plus className="h-4 w-4" /> {showForm ? 'Cancel' : 'New board'}
          </button>
        )}
      </header>

      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>
      )}

      {showForm && isAdmin && (
        <form onSubmit={submitNew} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Board name</span>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={80}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              placeholder="General safety"
              required
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Description</span>
            <input
              value={desc}
              onChange={e => setDesc(e.target.value)}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              placeholder="Optional"
            />
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowAnon}
              onChange={e => setAllowAnon(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1">
                <EyeOff className="h-3.5 w-3.5" /> Allow anonymous posts
              </span>
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Members can post hazard reports / questions without their name attached. Useful for safety reporting.
              </span>
            </span>
          </label>
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !name.trim()} className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50">
              {busy ? 'Creating…' : 'Create board'}
            </button>
          </div>
        </form>
      )}

      <BoardSearch />

      {boards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">No boards yet. {isAdmin ? 'Create one to get started.' : 'Ask your administrator to create one.'}</p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {boards.map(b => (
            <li key={b.id}>
              <Link
                href={`/safety-boards/${b.id}`}
                className="block rounded-xl border border-slate-200 dark:border-slate-800 p-4 hover:border-brand-navy/40 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h2 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{b.name}</h2>
                    {b.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{b.description}</p>
                    )}
                  </div>
                  <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                    <MessageSquare className="h-3.5 w-3.5" />
                    {b.thread_count}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
