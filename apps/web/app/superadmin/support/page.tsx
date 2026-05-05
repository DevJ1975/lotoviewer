'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, AlertCircle, Loader2, RefreshCw, CheckCircle2, Undo2,
  MessageSquare, X, AlertTriangle, ShieldAlert, UserRound,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Superadmin triage page for AI-support tickets. Shows the open queue
// by default; toggle to see resolved or all. Click a row to open the
// conversation transcript that produced the ticket.
//
// Reads + writes go through /api/support/tickets and
// /api/support/conversations/[id] which both call requireSuperadmin —
// this page does not directly query Supabase so it can't be defeated
// by a client-side RLS bypass.

type TicketReason = 'user_requested' | 'low_confidence' | 'safety_critical'
type StatusFilter = 'open' | 'resolved' | 'all'

interface TicketRow {
  id:              string
  conversation_id: string
  user_id:         string
  tenant_id:       string | null
  tenant_name:     string | null
  user_email:      string | null
  user_name:       string | null
  subject:         string
  summary:         string
  reason:          TicketReason
  emailed_ok:      boolean | null
  resolved_at:     string | null
  created_at:      string
}

interface TranscriptMessage {
  id:                 string
  role:               'user' | 'assistant' | 'system' | 'tool'
  content:            string
  input_tokens:       number | null
  output_tokens:      number | null
  cache_read_tokens:  number | null
  created_at:         string
}

const REASON_BADGE: Record<TicketReason, { label: string; cls: string; icon: typeof AlertCircle }> = {
  user_requested:  { label: 'User asked',     cls: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',         icon: UserRound },
  low_confidence:  { label: 'Bot stuck',      cls: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',      icon: AlertTriangle },
  safety_critical: { label: 'Safety',         cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',          icon: ShieldAlert },
}

export default function SuperadminSupportPage() {
  const [filter,    setFilter]    = useState<StatusFilter>('open')
  const [tickets,   setTickets]   = useState<TicketRow[]>([])
  const [loading,   setLoading]   = useState(true)
  const [error,     setError]     = useState<string | null>(null)
  const [busyId,    setBusyId]    = useState<string | null>(null)
  const [openConv,  setOpenConv]  = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sign-in expired — please log in again.')
      const res = await fetch(`/api/support/tickets?status=${filter}&limit=200`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      setTickets((j.tickets ?? []) as TicketRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load tickets.')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { void load() }, [load])

  async function toggleResolved(t: TicketRow) {
    setBusyId(t.id)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) throw new Error('Sign-in expired')
      const wasResolved = t.resolved_at !== null
      const res = await fetch(`/api/support/tickets/${t.id}/resolve`, {
        method: wasResolved ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      // Optimistic-ish: refetch so the count tile + filter view stay
      // correct. Cheap because the list is capped at 200.
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update ticket.')
    } finally {
      setBusyId(null)
    }
  }

  const openCount = tickets.filter(t => !t.resolved_at).length

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/superadmin" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow" aria-label="Back to superadmin home">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-0.5">Superadmin</p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">AI support tickets</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Tickets opened by the in-app assistant when a user asks for human help, the bot gets stuck, or the question is safety-critical.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
        >
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </button>
      </header>

      {/* Filter pills + count tile */}
      <section className="flex items-center justify-between gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden text-xs font-semibold">
          {(['open', 'resolved', 'all'] as const).map(f => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? 'px-3 py-1.5 bg-brand-navy text-white'
                  : 'px-3 py-1.5 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
              }
            >
              {f === 'open' ? 'Open' : f === 'resolved' ? 'Resolved' : 'All'}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {filter === 'open'
            ? <><span className="font-mono font-bold text-rose-700 dark:text-rose-300">{openCount}</span> open ticket{openCount === 1 ? '' : 's'}</>
            : <>Showing {tickets.length} ticket{tickets.length === 1 ? '' : 's'}</>}
        </p>
      </section>

      {error && (
        <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-3 py-2 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}

      {/* Ticket list */}
      <section className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
        {loading && tickets.length === 0
          ? <div className="p-12 text-center text-slate-400 dark:text-slate-500"><Loader2 className="h-5 w-5 animate-spin inline" /></div>
          : tickets.length === 0
            ? <p className="p-12 text-center text-sm text-slate-500 dark:text-slate-400">
                {filter === 'open' ? 'No open tickets — quiet day. ✅' : `No ${filter} tickets.`}
              </p>
            : (
              <ul className="divide-y divide-slate-200 dark:divide-slate-700">
                {tickets.map(t => (
                  <TicketRowCard
                    key={t.id}
                    ticket={t}
                    busy={busyId === t.id}
                    onToggleResolved={() => void toggleResolved(t)}
                    onOpenTranscript={() => setOpenConv(t.conversation_id)}
                  />
                ))}
              </ul>
            )}
      </section>

      {openConv && (
        <TranscriptModal conversationId={openConv} onClose={() => setOpenConv(null)} />
      )}
    </div>
  )
}

// ── Single ticket row ─────────────────────────────────────────────────────

function TicketRowCard({
  ticket: t,
  busy,
  onToggleResolved,
  onOpenTranscript,
}: {
  ticket:           TicketRow
  busy:             boolean
  onToggleResolved: () => void
  onOpenTranscript: () => void
}) {
  const Reason = REASON_BADGE[t.reason] ?? REASON_BADGE.user_requested
  const ReasonIcon = Reason.icon
  const created = new Date(t.created_at)
  const resolved = !!t.resolved_at

  return (
    <li className={resolved ? 'p-4 bg-slate-50 dark:bg-slate-900/40' : 'p-4'}>
      <div className="flex items-start gap-3">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${Reason.cls} shrink-0`}>
          <ReasonIcon className="h-3 w-3" />
          {Reason.label}
        </span>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold ${resolved ? 'text-slate-500 dark:text-slate-400 line-through' : 'text-slate-900 dark:text-slate-100'}`}>
            {t.subject}
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 line-clamp-2 whitespace-pre-wrap">
            {t.summary}
          </p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="font-mono">{(t.user_name ?? 'unknown')} &lt;{t.user_email ?? 'unknown'}&gt;</span>
            <span aria-hidden="true">·</span>
            <span>{t.tenant_name ?? '(no tenant)'}</span>
            <span aria-hidden="true">·</span>
            <time dateTime={t.created_at} title={created.toISOString()}>{created.toLocaleString()}</time>
            {t.emailed_ok === false && (
              <>
                <span aria-hidden="true">·</span>
                <span className="text-rose-700 dark:text-rose-300 font-semibold">email failed</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={onOpenTranscript}
            title="View transcript"
            aria-label="View transcript"
            className="p-2 rounded-md text-slate-500 dark:text-slate-400 hover:text-brand-navy dark:hover:text-brand-yellow hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleResolved}
            disabled={busy}
            title={resolved ? 'Re-open ticket' : 'Mark resolved'}
            aria-label={resolved ? 'Re-open ticket' : 'Mark resolved'}
            className={
              resolved
                ? 'px-2.5 py-1.5 rounded-md text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 disabled:opacity-40 transition-colors'
                : 'px-2.5 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 inline-flex items-center gap-1 disabled:opacity-40 transition-colors'
            }
          >
            {busy
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : resolved
                ? <><Undo2 className="h-3 w-3" /> Re-open</>
                : <><CheckCircle2 className="h-3 w-3" /> Resolve</>}
          </button>
        </div>
      </div>
    </li>
  )
}

// ── Transcript modal ──────────────────────────────────────────────────────

function TranscriptModal({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [messages, setMessages] = useState<TranscriptMessage[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      setLoading(true)
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const token = session?.access_token
        if (!token) throw new Error('Sign-in expired')
        const res = await fetch(`/api/support/conversations/${conversationId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        const j = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
        if (!cancelled) setMessages((j.messages ?? []) as TranscriptMessage[])
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load transcript.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [conversationId])

  // Esc closes — same pattern as the chat panel.
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Conversation transcript"
        onClick={e => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Conversation transcript</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono">{conversationId.slice(0, 8)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-slate-400 mx-auto block mt-8" />}
          {error && (
            <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-3 py-2">{error}</p>
          )}
          {!loading && messages.length === 0 && !error && (
            <p className="text-xs text-slate-500 dark:text-slate-400 text-center py-8">No messages.</p>
          )}
          {messages.map(m => <MessageBubble key={m.id} message={m} />)}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message: m }: { message: TranscriptMessage }) {
  const isUser = m.role === 'user'
  const tag =
    m.role === 'user'      ? 'User'
  : m.role === 'assistant' ? 'Assistant'
  : m.role === 'tool'      ? 'Tool result'
  :                          'System'
  const tokens = (m.input_tokens ?? 0) + (m.output_tokens ?? 0)
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand-navy text-white px-3 py-2 text-sm whitespace-pre-wrap'
            : 'max-w-[90%] rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm whitespace-pre-wrap'
        }
      >
        <p className={`text-[10px] font-mono uppercase tracking-wide ${isUser ? 'text-white/60' : 'text-slate-500 dark:text-slate-400'} mb-1`}>
          {tag}
          {tokens > 0 && <> · {tokens} tok</>}
        </p>
        {m.content}
      </div>
    </div>
  )
}
