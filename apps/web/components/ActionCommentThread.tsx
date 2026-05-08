'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, Pencil, Trash2, X, Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { Avatar } from '@/components/ui/Avatar'
import MentionInput, { type MentionMember } from '@/components/MentionInput'

// Inline comment thread for a single incident_action row.
// Collapsed by default; opens to show full history + composer.

export interface ActionComment {
  id:                 string
  incident_action_id: string
  author_user_id:     string
  author_email:       string | null
  author_full_name:   string | null
  author_avatar_url:  string | null
  body:               string
  body_mentions:      string[]
  edited_at:          string | null
  created_at:         string
}

interface Props {
  incidentId: string
  actionId:   string
  members:    MentionMember[]
}

// Render @-mentions inline as styled chips. The mention regex must match
// the server-side parser so display + parsing stay aligned.
const MENTION_RE = /@([a-zA-Z0-9._-]{2,64})/g

function renderBody(body: string): React.ReactNode {
  const out: React.ReactNode[] = []
  let last = 0
  body.replace(MENTION_RE, (match, _handle, offset: number) => {
    if (offset > last) out.push(body.slice(last, offset))
    out.push(
      <span
        key={`m-${offset}`}
        className="inline-block rounded bg-brand-navy/10 dark:bg-brand-yellow/15 px-1 text-brand-navy dark:text-brand-yellow font-medium"
      >
        {match}
      </span>,
    )
    last = offset + match.length
    return match
  })
  if (last < body.length) out.push(body.slice(last))
  return out
}

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  const mins = Math.floor(diff / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return d.toLocaleDateString()
}

export default function ActionCommentThread({ incidentId, actionId, members }: Props) {
  const { tenant } = useTenant()
  const { userId, profile } = useAuth()

  const [open, setOpen]         = useState(false)
  const [loaded, setLoaded]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [comments, setComments] = useState<ActionComment[]>([])
  const [count, setCount]       = useState<number | null>(null)

  const [draft, setDraft]       = useState('')
  const [posting, setPosting]   = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')

  async function authedHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (tenant?.id) h['x-active-tenant'] = tenant.id
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    return h
  }

  // Lightweight count fetch when collapsed — runs once per mount so the
  // collapsed pill shows "Comments (3)" instead of just "Comments".
  const fetchCount = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}/comments`, { headers })
      if (!res.ok) return
      const body = await res.json()
      setCount((body.comments as ActionComment[] | undefined)?.length ?? 0)
    } catch { /* swallow — collapsed pill just shows "Comments" */ }
    // We deliberately don't store the fetched comments in state on the
    // count fetch — the open-thread fetch below stores them. This keeps
    // collapsed/expanded state cleanly separated.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, incidentId, actionId])

  useEffect(() => { void fetchCount() }, [fetchCount])

  const loadFull = useCallback(async () => {
    if (!tenant?.id) return
    setLoading(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}/comments`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setComments(body.comments as ActionComment[])
      setCount((body.comments as ActionComment[]).length)
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, incidentId, actionId])

  function toggle() {
    const next = !open
    setOpen(next)
    if (next && !loaded) void loadFull()
  }

  async function postComment() {
    const text = draft.trim()
    if (!text || !tenant?.id) return
    setPosting(true); setError(null)
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}/comments`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ body: text }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)

      // Hydrate the freshly inserted comment with the current user's
      // profile so we don't have to refetch the whole thread.
      const enriched: ActionComment = {
        id:                 body.comment.id,
        incident_action_id: body.comment.incident_action_id ?? actionId,
        author_user_id:     userId!,
        author_email:       profile?.email ?? null,
        author_full_name:   profile?.full_name ?? null,
        author_avatar_url:  profile?.avatar_url ?? null,
        body:               body.comment.body,
        body_mentions:      body.comment.body_mentions ?? [],
        edited_at:          body.comment.edited_at ?? null,
        created_at:         body.comment.created_at ?? new Date().toISOString(),
      }
      setComments(prev => [...prev, enriched])
      setCount(c => (c ?? 0) + 1)
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  async function saveEdit(id: string) {
    const text = editDraft.trim()
    if (!text) return
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}/comments/${id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ body: text }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setComments(prev => prev.map(c => c.id === id ? {
        ...c,
        body:          body.comment.body,
        body_mentions: body.comment.body_mentions ?? [],
        edited_at:     body.comment.edited_at,
      } : c))
      setEditId(null)
      setEditDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeComment(id: string) {
    if (!confirm('Delete this comment?')) return
    try {
      const headers = await authedHeaders()
      const res = await fetch(`/api/incidents/${incidentId}/actions/${actionId}/comments/${id}`, {
        method: 'DELETE',
        headers,
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      setComments(prev => prev.filter(c => c.id !== id))
      setCount(c => Math.max(0, (c ?? 1) - 1))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="border-t border-slate-100 dark:border-slate-800 pt-2">
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        Comments{count != null ? ` (${count})` : ''}
      </button>

      {open && (
        <div className="mt-2 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          )}
          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded px-2 py-1">{error}</p>
          )}
          {!loading && comments.length === 0 && !error && (
            <p className="text-xs italic text-slate-500 dark:text-slate-400">No comments yet.</p>
          )}
          <ul className="space-y-3">
            {comments.map(c => {
              const display = c.author_full_name || c.author_email || 'Unknown user'
              const isAuthor = c.author_user_id === userId
              const editing = editId === c.id
              return (
                <li key={c.id} className="flex gap-2">
                  <Avatar src={c.author_avatar_url} name={c.author_full_name} email={c.author_email} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-slate-700 dark:text-slate-200">{display}</span>
                      <span>· {formatRelative(c.created_at)}</span>
                      {c.edited_at && <span className="italic">(edited)</span>}
                      {isAuthor && !editing && (
                        <>
                          <button
                            type="button"
                            onClick={() => { setEditId(c.id); setEditDraft(c.body) }}
                            className="ml-1 inline-flex items-center gap-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => void removeComment(c.id)}
                            className="inline-flex items-center gap-0.5 text-rose-400 hover:text-rose-600"
                            title="Delete"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </>
                      )}
                    </div>
                    {editing ? (
                      <div className="mt-1 space-y-1">
                        <MentionInput
                          value={editDraft}
                          onChange={setEditDraft}
                          members={members}
                          rows={2}
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void saveEdit(c.id)}
                            className="inline-flex items-center gap-1 rounded bg-brand-navy text-white px-2 py-1 text-[11px] font-semibold hover:bg-brand-navy/90"
                          >
                            <Check className="h-3 w-3" /> Save
                          </button>
                          <button
                            type="button"
                            onClick={() => { setEditId(null); setEditDraft('') }}
                            className="inline-flex items-center gap-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-0.5 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap break-words">
                        {renderBody(c.body)}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="flex gap-2">
            <Avatar src={profile?.avatar_url} name={profile?.full_name} email={profile?.email} size="sm" />
            <div className="flex-1 space-y-1">
              <MentionInput
                value={draft}
                onChange={setDraft}
                members={members}
                rows={2}
                placeholder="Add a comment. Use @name to ping a teammate."
                disabled={posting}
              />
              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => void postComment()}
                  disabled={posting || !draft.trim()}
                  className="rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
                >
                  {posting ? 'Posting…' : 'Post comment'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
