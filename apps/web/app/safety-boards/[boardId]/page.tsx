'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Bell, EyeOff, Loader2, MessageSquare, Pin, Lock, Plus } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/ui/Avatar'
import MentionInput, { type MentionMember } from '@/components/MentionInput'
import EntityLinkPicker from '@/components/safetyBoards/EntityLinkPicker'
import AttachFiles, { type PendingAttachment } from '@/components/safetyBoards/AttachFiles'
import BoardSearch from '@/components/safetyBoards/BoardSearch'
import BoardAccessEditor from '@/components/safetyBoards/BoardAccessEditor'
import SubscribeButton from '@/components/safetyBoards/SubscribeButton'
import {
  listThreads, createThread,
  THREAD_KINDS, KIND_LABEL, KIND_DESCRIPTIONS, ENTITY_LINK_LABEL,
  type SafetyThreadSummary, type ThreadKind, type EntityLinkType,
  type SafetyBoardSummary,
} from '@/lib/safetyBoards/client'

// /safety-boards/[boardId] — thread list for a single board.

function formatRelative(iso: string): string {
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'just now'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return d.toLocaleDateString()
}

export default function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const { tenant, role } = useTenant()
  const isAdmin = role === 'admin' || role === 'owner'

  const [threads, setThreads] = useState<SafetyThreadSummary[]>([])
  const [board, setBoard]     = useState<SafetyBoardSummary | null>(null)
  const [filterKind, setFilterKind] = useState<ThreadKind | 'all'>('all')
  const [members, setMembers] = useState<MentionMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle]     = useState('')
  const [bodyText, setBody]   = useState('')
  const [kind, setKind]       = useState<ThreadKind>('discussion')
  const [link, setLink]       = useState<{ type: EntityLinkType; id: string; label: string } | null>(null)
  const [ackRequired, setAckRequired] = useState(false)
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [busy, setBusy]       = useState(false)

  const refresh = useCallback(async () => {
    if (!tenant?.id || !boardId) return
    try {
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
      const [list, boardRes] = await Promise.all([
        listThreads(tenant.id, boardId),
        fetch(`/api/safety-boards/${boardId}`, { headers }).then(r => r.json()).catch(() => ({})),
      ])
      setThreads(list)
      if (boardRes?.board) setBoard(boardRes.board as SafetyBoardSummary)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, boardId])

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

  useEffect(() => {
    void Promise.all([refresh(), loadMembers()])
  }, [refresh, loadMembers])

  async function submitNew(e: React.FormEvent) {
    e.preventDefault()
    if (!tenant?.id || !boardId || !title.trim() || !bodyText.trim()) return
    setBusy(true); setError(null)
    try {
      await createThread(tenant.id, boardId, {
        title: title.trim(),
        body:  bodyText.trim(),
        kind,
        linked_entity_type: link?.type ?? null,
        linked_entity_id:   link?.id   ?? null,
        acknowledgement_required: isAdmin && ackRequired,
        attachment_ids: attachments.length > 0 ? attachments.map(a => a.id) : undefined,
        is_anonymous: !!board?.allow_anonymous && isAnonymous,
      })
      setTitle(''); setBody('')
      setKind('discussion')
      setLink(null)
      setAckRequired(false)
      setIsAnonymous(false)
      setAttachments([])
      setShowForm(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const visibleThreads = filterKind === 'all' ? threads : threads.filter(t => t.kind === filterKind)

  if (loading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/safety-boards" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> All boards
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 truncate">{board?.name ?? 'Threads'}</h1>
          {board?.description && (
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{board.description}</p>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SubscribeButton targetType="board" targetId={boardId} />
            {isAdmin && <BoardAccessEditor boardId={boardId} />}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setShowForm(s => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90"
        >
          <Plus className="h-4 w-4" /> {showForm ? 'Cancel' : 'New thread'}
        </button>
      </header>

      <BoardSearch boardId={boardId} />

      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>
      )}

      {showForm && (
        <form onSubmit={submitNew} className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Type</span>
            <div className="mt-1 grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {THREAD_KINDS.map(k => (
                <button
                  type="button"
                  key={k}
                  onClick={() => setKind(k)}
                  className={
                    'rounded-lg px-3 py-1.5 text-xs ring-1 transition-colors text-left ' +
                    (kind === k
                      ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 ring-brand-navy/30 text-brand-navy dark:text-brand-yellow font-semibold'
                      : 'ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
                  }
                >
                  <div>{KIND_LABEL[k]}</div>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{KIND_DESCRIPTIONS[kind]}</p>
          </div>
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Title</span>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-700 dark:bg-slate-800 px-3 py-2 text-sm"
              required
            />
          </label>
          <div className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Body</span>
            <div className="mt-1">
              <MentionInput
                value={bodyText}
                onChange={setBody}
                members={members}
                rows={5}
                placeholder="Share an observation, ask a question, or post a near-miss reflection. Use @name to ping a teammate."
              />
            </div>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Link to (optional)</span>
            <div className="mt-1">
              <EntityLinkPicker value={link} onChange={setLink} />
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Tying this thread to an entity (incident, equipment, near-miss, …) lets you spawn a CAPA later, and surfaces the discussion on that entity&apos;s page.
            </p>
          </div>
          <div>
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Attachments (optional)</span>
            <div className="mt-1">
              <AttachFiles pending={attachments} onChange={setAttachments} />
            </div>
          </div>
          {isAdmin && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ackRequired}
                onChange={e => setAckRequired(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-slate-700 dark:text-slate-200">Require acknowledgement</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Members will see a banner until they acknowledge they have read this. Useful for safety alerts and OSHA-style toolbox-talk records.
                </span>
              </span>
            </label>
          )}
          {board?.allow_anonymous && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={e => setIsAnonymous(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="font-medium text-slate-700 dark:text-slate-200 inline-flex items-center gap-1">
                  <EyeOff className="h-3.5 w-3.5" /> Post anonymously
                </span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">
                  Your name will be hidden from other members. Tenant admins can still recover the author for moderation if needed.
                </span>
              </span>
            </label>
          )}
          <div className="flex justify-end">
            <button type="submit" disabled={busy || !title.trim() || !bodyText.trim()} className="rounded-lg bg-brand-navy text-white px-4 py-2 text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-50">
              {busy ? 'Posting…' : 'Post thread'}
            </button>
          </div>
        </form>
      )}

      {threads.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-slate-400">Filter:</span>
          <button
            type="button"
            onClick={() => setFilterKind('all')}
            className={
              'rounded-full px-2 py-0.5 text-xs ' +
              (filterKind === 'all'
                ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 text-brand-navy dark:text-brand-yellow font-semibold'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')
            }
          >
            All
          </button>
          {THREAD_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setFilterKind(k)}
              className={
                'rounded-full px-2 py-0.5 text-xs ' +
                (filterKind === k
                  ? 'bg-brand-navy/10 dark:bg-brand-yellow/15 text-brand-navy dark:text-brand-yellow font-semibold'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800')
              }
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      )}

      {visibleThreads.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {threads.length === 0 ? 'No threads on this board yet.' : 'No threads match this filter.'}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {visibleThreads.map(t => (
            <li key={t.id}>
              <Link
                href={`/safety-boards/${t.board_id}/${t.id}`}
                className="block rounded-xl border border-slate-200 dark:border-slate-800 p-3 hover:border-brand-navy/40 hover:shadow-sm transition-shadow"
              >
                <div className="flex items-start gap-2">
                  <Avatar src={t.author_avatar_url} name={t.author_full_name} email={t.author_email} size="sm" />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                      <span className="inline-block rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">
                        {KIND_LABEL[t.kind]}
                      </span>
                      {t.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
                      {t.locked && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                      {t.acknowledgement_required && <Bell className="h-3.5 w-3.5 text-amber-600" />}
                      {t.is_anonymous && <EyeOff className="h-3.5 w-3.5 text-slate-400" />}
                      <h2 className="font-semibold text-slate-900 dark:text-slate-100 truncate">{t.title}</h2>
                    </div>
                    <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{t.body}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
                      <span>{t.is_anonymous ? 'Anonymous' : (t.author_full_name || t.author_email)}</span>
                      <span>· {formatRelative(t.created_at)}</span>
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        {t.reply_count}
                      </span>
                      {t.linked_entity_type && (
                        <span className="inline-flex items-center gap-1 italic">
                          · linked to {ENTITY_LINK_LABEL[t.linked_entity_type]}
                        </span>
                      )}
                      {t.last_reply_at && t.last_reply_at !== t.created_at && (
                        <span>· last reply {formatRelative(t.last_reply_at)}</span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
