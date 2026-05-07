'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Loader2, AlertCircle, Megaphone, Plus, RefreshCw, Trash2, Eye, EyeOff,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { renderReleaseNoteMd } from '@/lib/markdown'
import type { ReleaseNoteRow } from '@/app/api/superadmin/release-notes/route'

// Superadmin authoring page for release_notes. Drafts + published
// notes in one list. Each row supports inline edit, publish/unpublish,
// and delete.

export default function ReleaseNotesPage() {
  const [notes, setNotes]     = useState<ReleaseNoteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  // New-note form state
  const [showNew,    setShowNew]    = useState(false)
  const [newVersion, setNewVersion] = useState('')
  const [newTitle,   setNewTitle]   = useState('')
  const [newBody,    setNewBody]    = useState('')
  const [creating,   setCreating]   = useState(false)
  const [createErr,  setCreateErr]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/release-notes', {
        headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        cache: 'no-store',
      })
      const j = await res.json()
      if (!res.ok) {
        setError(j?.error ?? `HTTP ${res.status}`)
      } else {
        setNotes(j.notes as ReleaseNoteRow[])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  async function createNote(publish: boolean) {
    if (creating) return
    if (!newVersion.trim() || !newTitle.trim() || !newBody.trim()) {
      setCreateErr('Version, title, and body are all required.')
      return
    }
    setCreating(true)
    setCreateErr(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/superadmin/release-notes', {
        method:  'POST',
        headers: {
          'content-type': 'application/json',
          ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ version: newVersion, title: newTitle, body_md: newBody, publish }),
      })
      const j = await res.json()
      if (!res.ok) {
        setCreateErr(j?.error ?? `HTTP ${res.status}`)
        return
      }
      setNewVersion(''); setNewTitle(''); setNewBody('')
      setShowNew(false)
      await load()
    } catch (e) {
      setCreateErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCreating(false)
    }
  }

  async function togglePublish(id: number, publish: boolean) {
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/superadmin/release-notes/${id}`, {
      method:  'PATCH',
      headers: {
        'content-type': 'application/json',
        ...(session?.access_token ? { authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ publish }),
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j?.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  async function deleteNote(id: number) {
    if (!confirm('Delete this release note? This cannot be undone.')) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(`/api/superadmin/release-notes/${id}`, {
      method:  'DELETE',
      headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
    })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      setError(j?.error ?? `HTTP ${res.status}`)
      return
    }
    await load()
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy mt-1" aria-label="Back to superadmin home">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">Superadmin</p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Megaphone className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
              Release notes
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Author + publish change announcements. The latest published note shows as a banner
              to every signed-in user until they dismiss it. Markdown subset: <code>**bold**</code>,
              <code>[link](https://…)</code>, bullet lists with <code>- </code>.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!showNew && (
            <button
              type="button"
              onClick={() => { setShowNew(true); setCreateErr(null) }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-brand-navy text-white text-xs font-semibold hover:bg-brand-navy/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              New note
            </button>
          )}
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            aria-label="Refresh"
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </div>
      </header>

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <div className="text-sm text-rose-800 dark:text-rose-200">{error}</div>
        </div>
      )}

      {/* New note form */}
      {showNew && (
        <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Version</span>
              <input
                type="text"
                value={newVersion}
                onChange={e => setNewVersion(e.target.value)}
                placeholder="v0.42 / 2026-05-08"
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <label className="block sm:col-span-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
              <input
                type="text"
                value={newTitle}
                onChange={e => setNewTitle(e.target.value)}
                placeholder="One-sentence headline"
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Body (markdown)</span>
              <textarea
                value={newBody}
                onChange={e => setNewBody(e.target.value)}
                rows={10}
                placeholder={`What's new:\n- LOTO checkout now blocks expired training\n- Cross-tenant search at /superadmin/search\n\nSee [docs](https://...) for the migration guide.`}
                className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
              />
            </label>
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Preview</span>
              <div
                className="mt-1 min-h-[200px] rounded-md border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 prose-sm"
                dangerouslySetInnerHTML={{ __html: newBody.trim() ? renderReleaseNoteMd(newBody) : '<p class="text-slate-400 italic">Preview appears here as you type.</p>' }}
              />
            </div>
          </div>
          {createErr && (
            <p className="text-xs text-rose-700 dark:text-rose-300">{createErr}</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowNew(false); setCreateErr(null) }}
              disabled={creating}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-200"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void createNote(false)}
              disabled={creating}
              className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40"
            >
              Save as draft
            </button>
            <button
              type="button"
              onClick={() => void createNote(true)}
              disabled={creating}
              className="px-4 py-1.5 rounded-md bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-40 inline-flex items-center gap-1.5"
            >
              {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
              Publish now
            </button>
          </div>
        </section>
      )}

      {loading && notes.length === 0 && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {!loading && notes.length === 0 && (
        <div className="py-16 text-center text-sm text-slate-500 dark:text-slate-400">
          No release notes yet. Click <strong>New note</strong> to publish the first one.
        </div>
      )}

      <ul className="space-y-3">
        {notes.map(n => (
          <li key={n.id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div>
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-slate-500 dark:text-slate-400">{n.version}</code>
                  {n.published_at ? (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                      published {new Date(n.published_at).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">draft</span>
                  )}
                </div>
                <h2 className="mt-1 text-base font-semibold text-slate-900 dark:text-slate-100">{n.title}</h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {n.published_at ? (
                  <button
                    type="button"
                    onClick={() => void togglePublish(n.id, false)}
                    title="Unpublish (revert to draft)"
                    className="p-1.5 rounded-md text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => void togglePublish(n.id, true)}
                    title="Publish"
                    className="p-1.5 rounded-md text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void deleteNote(n.id)}
                  title="Delete"
                  className="p-1.5 rounded-md text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div
              className="text-sm text-slate-700 dark:text-slate-200"
              dangerouslySetInnerHTML={{ __html: renderReleaseNoteMd(n.body_md) }}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}
