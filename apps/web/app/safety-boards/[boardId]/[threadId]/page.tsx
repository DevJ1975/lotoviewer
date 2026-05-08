'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, ExternalLink, Loader2, Pin, Lock, Pencil, Trash2, X, Check } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import MentionInput, { type MentionMember } from '@/components/MentionInput'
import BoardReactions from '@/components/safetyBoards/BoardReactions'
import BoardAttachmentView from '@/components/safetyBoards/BoardAttachment'
import AttachFiles, { type PendingAttachment } from '@/components/safetyBoards/AttachFiles'
import AcknowledgementBanner from '@/components/safetyBoards/AcknowledgementBanner'
import SpawnActionButton from '@/components/safetyBoards/SpawnActionButton'
import SubscribeButton from '@/components/safetyBoards/SubscribeButton'
import RichBody from '@/components/safetyBoards/RichBody'
import ExportPdfButton from '@/components/safetyBoards/ExportPdfButton'
import {
  getThread, listReplies, createReply, patchReply, deleteReply,
  patchThread, deleteThread,
  KIND_LABEL, ENTITY_LINK_LABEL, entityHref,
  type SafetyThreadDetail, type SafetyReply, type SafetyReaction,
} from '@/lib/safetyBoards/client'

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })
}

export default function ThreadDetailPage() {
  const { boardId, threadId } = useParams<{ boardId: string; threadId: string }>()
  const { tenant, role } = useTenant()
  const { userId, profile } = useAuth()
  // Tenant-admin/owner OR superadmin can pin/lock/edit anyone's
  // content. The server is the source of truth — this only governs
  // which buttons render.
  const isPriv = role === 'admin' || role === 'owner' || profile?.is_superadmin === true

  const [thread, setThread]     = useState<SafetyThreadDetail | null>(null)
  const [replies, setReplies]   = useState<SafetyReply[]>([])
  const [members, setMembers]   = useState<MentionMember[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [draft, setDraft]       = useState('')
  const [posting, setPosting]   = useState(false)
  const [replyAttachments, setReplyAttachments] = useState<PendingAttachment[]>([])
  const [replyAnonymous, setReplyAnonymous] = useState(false)
  const [board, setBoard] = useState<{ allow_anonymous?: boolean } | null>(null)

  const [editingThread, setEditingThread] = useState(false)
  const [editTitle, setEditTitle]         = useState('')
  const [editBody, setEditBody]           = useState('')

  const [editReplyId, setEditReplyId]   = useState<string | null>(null)
  const [editReplyDraft, setEditReplyDraft] = useState('')

  const refresh = useCallback(async () => {
    if (!tenant?.id || !boardId || !threadId) return
    try {
      const [t, r] = await Promise.all([
        getThread(tenant.id, boardId, threadId),
        listReplies(tenant.id, boardId, threadId),
      ])
      setThread(t)
      setReplies(r)
      // Best-effort fetch board for the allow_anonymous flag.
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      try {
        const boardRes = await fetch(`/api/safety-boards/${boardId}`, { headers })
        if (boardRes.ok) {
          const j = await boardRes.json()
          if (j.board) setBoard(j.board as { allow_anonymous: boolean })
        }
      } catch { /* non-essential */ }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, boardId, threadId])

  const loadMembers = useCallback(async () => {
    if (!tenant?.id) return
    const { data: mems } = await supabase
      .from('tenant_memberships')
      .select('user_id, profiles:profiles!inner(email, full_name, avatar_url)')
      .eq('tenant_id', tenant.id)
    type Row = { user_id: string; profiles: { email: string | null; full_name: string | null; avatar_url: string | null } | { email: string | null; full_name: string | null; avatar_url: string | null }[] | null }
    const next: MentionMember[] = ((mems as Row[] | null) ?? []).map(m => {
      const p = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles
      return { user_id: m.user_id, email: p?.email ?? null, full_name: p?.full_name ?? null, avatar_url: p?.avatar_url ?? null }
    })
    setMembers(next)
  }, [tenant])

  useEffect(() => { void Promise.all([refresh(), loadMembers()]) }, [refresh, loadMembers])

  async function postReply() {
    const text = draft.trim()
    if ((!text && replyAttachments.length === 0) || !tenant?.id || !boardId || !threadId) return
    setPosting(true); setError(null)
    try {
      const r = await createReply(tenant.id, boardId, threadId, {
        body: text,
        attachment_ids: replyAttachments.length > 0 ? replyAttachments.map(a => a.id) : undefined,
        is_anonymous: !!board?.allow_anonymous && replyAnonymous,
      })
      setReplies(prev => [...prev, r])
      setDraft('')
      setReplyAttachments([])
      setReplyAnonymous(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPosting(false)
    }
  }

  async function saveReplyEdit(id: string) {
    const text = editReplyDraft.trim()
    if (!text || !tenant?.id) return
    try {
      await patchReply(tenant.id, id, text)
      setReplies(prev => prev.map(r => r.id === id ? { ...r, body: text, edited_at: new Date().toISOString() } : r))
      setEditReplyId(null); setEditReplyDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeReply(id: string) {
    if (!confirm('Delete this reply?') || !tenant?.id) return
    try {
      await deleteReply(tenant.id, id)
      setReplies(prev => prev.filter(r => r.id !== id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function saveThreadEdit() {
    if (!thread || !tenant?.id || !boardId) return
    const t = editTitle.trim(), b = editBody.trim()
    if (!t || !b) return
    try {
      await patchThread(tenant.id, boardId, thread.id, { title: t, body: b })
      setThread(prev => prev && ({ ...prev, title: t, body: b, edited_at: new Date().toISOString() }))
      setEditingThread(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function removeThread() {
    if (!thread || !tenant?.id || !boardId) return
    if (!confirm('Delete this thread? This will also remove all replies.')) return
    try {
      await deleteThread(tenant.id, boardId, thread.id)
      window.location.href = `/safety-boards/${boardId}`
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function togglePin() {
    if (!thread || !tenant?.id || !boardId) return
    try {
      await patchThread(tenant.id, boardId, thread.id, { pinned: !thread.pinned })
      setThread(prev => prev && ({ ...prev, pinned: !prev.pinned }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleLock() {
    if (!thread || !tenant?.id || !boardId) return
    try {
      await patchThread(tenant.id, boardId, thread.id, { locked: !thread.locked })
      setThread(prev => prev && ({ ...prev, locked: !prev.locked }))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function onThreadReactionsChange(next: SafetyReaction[]) {
    setThread(prev => prev && ({ ...prev, reactions: next }))
  }
  function onReplyReactionsChange(replyId: string, next: SafetyReaction[]) {
    setReplies(prev => prev.map(r => r.id === replyId ? { ...r, reactions: next } : r))
  }

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!thread) {
    return <div className="max-w-3xl mx-auto p-8 text-sm text-slate-500 dark:text-slate-400">Thread not found.</div>
  }

  const isAuthor = thread.author_user_id === userId
  const canPost  = !thread.locked || isPriv

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/safety-boards/${boardId}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
          <ArrowLeft className="h-4 w-4" /> Back to threads
        </Link>
        <div className="inline-flex items-center gap-2">
          <ExportPdfButton threadId={thread.id} threadTitle={thread.title} />
          <SubscribeButton targetType="thread" targetId={thread.id} />
        </div>
      </div>

      {error && <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}

      {thread.acknowledgement_required && (
        <AcknowledgementBanner threadId={thread.id} isAdmin={isPriv} />
      )}

      <article className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <header className="flex items-start gap-3">
          <Avatar src={thread.author_avatar_url} name={thread.author_full_name} email={thread.author_email} size="md" />
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                {KIND_LABEL[thread.kind]}
              </span>
              {thread.linked_entity_type && thread.linked_entity_id && (() => {
                const href = entityHref(thread.linked_entity_type, thread.linked_entity_id)
                const label = `Linked to ${ENTITY_LINK_LABEL[thread.linked_entity_type]}`
                return href ? (
                  <Link href={href} className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 dark:bg-brand-yellow/15 px-2 py-0.5 text-[10px] font-semibold text-brand-navy dark:text-brand-yellow hover:underline">
                    {label} <ExternalLink className="h-3 w-3" />
                  </Link>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-navy/10 dark:bg-brand-yellow/15 px-2 py-0.5 text-[10px] font-semibold text-brand-navy dark:text-brand-yellow">
                    {label}
                  </span>
                )
              })()}
            </div>
            {editingThread ? (
              <input
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-2 py-1 text-base font-semibold"
              />
            ) : (
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex flex-wrap items-center gap-2">
                {thread.pinned && <Pin className="h-4 w-4 text-amber-500" />}
                {thread.locked && <Lock className="h-4 w-4 text-slate-400" />}
                {thread.title}
              </h1>
            )}
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {thread.is_anonymous ? 'Anonymous' : (thread.author_full_name || thread.author_email)} · {formatTimestamp(thread.created_at)}
              {thread.edited_at && <> · <span className="italic">edited</span></>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isPriv && (
              <>
                <button type="button" onClick={() => void togglePin()} className="rounded p-1 text-slate-400 hover:text-amber-500" title={thread.pinned ? 'Unpin' : 'Pin'}>
                  <Pin className="h-4 w-4" />
                </button>
                <button type="button" onClick={() => void toggleLock()} className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title={thread.locked ? 'Unlock' : 'Lock'}>
                  <Lock className="h-4 w-4" />
                </button>
              </>
            )}
            {(isAuthor || isPriv) && !editingThread && (
              <button
                type="button"
                onClick={() => { setEditingThread(true); setEditTitle(thread.title); setEditBody(thread.body) }}
                className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                title="Edit"
              >
                <Pencil className="h-4 w-4" />
              </button>
            )}
            {(isAuthor || isPriv) && (
              <button type="button" onClick={() => void removeThread()} className="rounded p-1 text-rose-400 hover:text-rose-600" title="Delete">
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </header>

        {editingThread ? (
          <div className="space-y-2">
            <MentionInput value={editBody} onChange={setEditBody} members={members} rows={5} />
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => void saveThreadEdit()} className="inline-flex items-center gap-1 rounded bg-brand-navy text-white px-3 py-1 text-xs font-semibold hover:bg-brand-navy/90">
                <Check className="h-3 w-3" /> Save
              </button>
              <button type="button" onClick={() => setEditingThread(false)} className="inline-flex items-center gap-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300">
                <X className="h-3 w-3" /> Cancel
              </button>
            </div>
          </div>
        ) : (
          <RichBody body={thread.body} className="text-sm text-slate-800 dark:text-slate-200" />
        )}

        {thread.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {thread.attachments.map(a => (
              <BoardAttachmentView key={a.id} attachment={a} />
            ))}
          </div>
        )}

        <BoardReactions
          targetType="thread"
          targetId={thread.id}
          reactions={thread.reactions}
          onChange={onThreadReactionsChange}
        />

        <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Discussion → action: spawn a CAPA from this thread to track follow-up.
          </p>
          <SpawnActionButton
            threadId={thread.id}
            threadTitle={thread.title}
            linkedEntityType={thread.linked_entity_type}
            linkedEntityId={thread.linked_entity_id}
            onSpawned={() => void refresh()}
          />
        </div>

        {thread.spawned_actions.length > 0 && (
          <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-800 p-3">
            <p className="text-xs font-semibold text-emerald-900 dark:text-emerald-100 mb-1">
              Actions spawned from this thread
            </p>
            <ul className="space-y-1">
              {thread.spawned_actions.map(sa => (
                <li key={sa.id} className="text-xs">
                  <Link
                    href={`/incidents/${sa.incident_id}/actions`}
                    className="text-emerald-800 dark:text-emerald-200 hover:underline"
                  >
                    {sa.description.length > 80 ? sa.description.slice(0, 77) + '…' : sa.description}
                  </Link>
                  <span className="ml-1 italic text-emerald-700 dark:text-emerald-300">— {sa.status}</span>
                  {sa.due_at && <span className="ml-1 text-emerald-700 dark:text-emerald-300">· due {new Date(sa.due_at).toLocaleDateString()}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </article>

      <section>
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </h2>
        <ul className="space-y-3">
          {replies.map(r => {
            const isReplyAuthor = r.author_user_id === userId
            const editing = editReplyId === r.id
            return (
              <li key={r.id} className="flex gap-2">
                <Avatar src={r.author_avatar_url} name={r.author_full_name} email={r.author_email} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5" id={`reply-${r.id}`}>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {r.is_anonymous ? 'Anonymous' : (r.author_full_name || r.author_email)}
                    </span>
                    <span>· {formatTimestamp(r.created_at)}</span>
                    {r.edited_at && <span className="italic">(edited)</span>}
                    {isReplyAuthor && !editing && (
                      <button type="button" onClick={() => { setEditReplyId(r.id); setEditReplyDraft(r.body) }} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200" title="Edit">
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {(isReplyAuthor || isPriv) && (
                      <button type="button" onClick={() => void removeReply(r.id)} className="text-rose-400 hover:text-rose-600" title="Delete">
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {editing ? (
                    <div className="mt-1 space-y-1">
                      <MentionInput value={editReplyDraft} onChange={setEditReplyDraft} members={members} rows={2} />
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => void saveReplyEdit(r.id)} className="inline-flex items-center gap-1 rounded bg-brand-navy text-white px-2 py-1 text-[11px] font-semibold hover:bg-brand-navy/90">
                          <Check className="h-3 w-3" /> Save
                        </button>
                        <button type="button" onClick={() => { setEditReplyId(null); setEditReplyDraft('') }} className="inline-flex items-center gap-1 rounded ring-1 ring-slate-200 dark:ring-slate-700 px-2 py-1 text-[11px] text-slate-600 dark:text-slate-300">
                          <X className="h-3 w-3" /> Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <RichBody body={r.body} className="mt-0.5 text-sm text-slate-800 dark:text-slate-200" />
                      {r.attachments.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {r.attachments.map(a => (
                            <BoardAttachmentView key={a.id} attachment={a} />
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <BoardReactions
                    targetType="reply"
                    targetId={r.id}
                    reactions={r.reactions}
                    onChange={next => onReplyReactionsChange(r.id, next)}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {canPost ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-2">
          <MentionInput
            value={draft}
            onChange={setDraft}
            members={members}
            rows={3}
            placeholder="Write a reply. Use @name to ping a teammate."
            disabled={posting}
          />
          <AttachFiles pending={replyAttachments} onChange={setReplyAttachments} disabled={posting} />
          {board?.allow_anonymous && (
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
              <input
                type="checkbox"
                checked={replyAnonymous}
                onChange={e => setReplyAnonymous(e.target.checked)}
              />
              Reply anonymously
            </label>
          )}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void postReply()}
              disabled={posting || (!draft.trim() && replyAttachments.length === 0)}
              className="rounded-lg bg-brand-navy text-white px-3 py-1.5 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {posting ? 'Posting…' : 'Post reply'}
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-slate-500 dark:text-slate-400 italic">This thread is locked.</p>
      )}
    </div>
  )
}
