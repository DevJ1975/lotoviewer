'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { LifeBuoy, X, Send, Loader2, MessageSquarePlus, AlertTriangle, ThumbsUp, ThumbsDown } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'

// Floating support bubble. Mounts globally in AppChrome and shows on every
// authenticated route except a small allowlist of bare/landing pages.
//
// Single-bubble UX:
//   - Closed: a brand-navy circle bottom-right with the LifeBuoy icon.
//   - Open: a chat panel anchored bottom-right (full-screen sheet on
//     mobile, 360 × 560 card on desktop).
//   - The "Talk to a human" button at the panel footer fires the
//     escalation tool directly via a hard-coded message — short-circuits
//     the model so frustrated users don't have to convince the bot.

interface ChatTurn {
  role:    'user' | 'assistant'
  content: string
  // Server-assigned message id. Present on assistant turns once the
  // POST /chat response lands; null while the turn is still streaming
  // or for synthetic local-only rows.
  messageId?: string | null
  // Set on the assistant turn that completed the escalation. Used to
  // surface a small ticket badge in the UI.
  ticketId?: string | null
  // 👍/👎 vote, persisted via /api/support/messages/[id]/feedback.
  // null = not voted; true/false = the user's last vote. Local state
  // is the source of truth between server roundtrips.
  helpful?: boolean | null
}

// Two-letter language tag we hand to the API. Keep this list explicit
// so we don't quietly forward whatever odd Accept-Language string the
// browser produces — the model only has Spanish + English KB.
type Lang = 'en' | 'es'

function detectLang(): Lang {
  if (typeof navigator === 'undefined') return 'en'
  const langs = (navigator.languages?.length ? navigator.languages : [navigator.language]) ?? []
  for (const raw of langs) {
    const head = (raw ?? '').toLowerCase().split('-')[0]
    if (head === 'es') return 'es'
    if (head === 'en') return 'en'
  }
  return 'en'
}

const HUMAN_HANDOFF_PROMPT =
  'Please open a support ticket for me — I would like to talk to a human.'

// Routes where we hide the bubble. These are the bare/login surfaces and
// the kiosk/inspector flows that are explicitly outside the normal auth
// shell.
function shouldHide(pathname: string | null): boolean {
  if (!pathname) return true
  if (pathname === '/login') return true
  if (pathname === '/welcome') return true
  if (pathname === '/forgot-password') return true
  if (pathname.startsWith('/reset-password')) return true
  if (pathname.startsWith('/inspector/')) return true
  if (pathname.startsWith('/permit-signon/')) return true
  return false
}

export default function SupportBot() {
  const pathname = usePathname()
  const { profile, email, loading: authLoading } = useAuth()
  const [open, setOpen]               = useState(false)
  const [turns, setTurns]             = useState<ChatTurn[]>([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [conversationId, setConvId]   = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll the message list to the bottom whenever a new turn lands.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, sending])

  // Esc closes the panel — matches the modal/drawer pattern used elsewhere.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (authLoading) return null
  if (!profile) return null
  if (shouldHide(pathname)) return null

  async function send(messageText: string) {
    setError(null)
    setSending(true)
    const userTurn: ChatTurn = { role: 'user', content: messageText }
    setTurns(prev => [...prev, userTurn])
    setInput('')

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Sign in expired — please log in again.')
      const res = await fetch('/api/support/chat', {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          conversationId,
          message:  messageText,
          pathname,
          lang:     detectLang(),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      if (j.conversationId && !conversationId) setConvId(j.conversationId as string)
      setTurns(prev => [...prev, {
        role:      'assistant',
        content:   String(j.reply ?? ''),
        messageId: (j.messageId as string | null) ?? null,
        ticketId:  (j.ticketId as string | null) ?? null,
        helpful:   null,
      }])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The assistant is unavailable.')
    } finally {
      setSending(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    void send(text)
  }

  function onTalkToHuman() {
    if (sending) return
    void send(HUMAN_HANDOFF_PROMPT)
  }

  async function onVote(idx: number, helpful: boolean) {
    const turn = turns[idx]
    if (!turn || turn.role !== 'assistant' || !turn.messageId) return
    // Toggle: clicking the same vote clears it.
    const next: boolean | null = turn.helpful === helpful ? null : helpful
    // Optimistic. Roll back on error.
    setTurns(prev => prev.map((t, i) => i === idx ? { ...t, helpful: next } : t))
    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Sign in expired')
      const res = await fetch(`/api/support/messages/${turn.messageId}/feedback`, {
        method: next === null ? 'DELETE' : 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: next === null ? undefined : JSON.stringify({ helpful: next }),
      })
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
    } catch {
      // Roll back optimistic update on failure. We deliberately don't
      // surface an error toast — feedback is non-critical UX.
      setTurns(prev => prev.map((t, i) => i === idx ? { ...t, helpful: turn.helpful ?? null } : t))
    }
  }

  function onReset() {
    setTurns([])
    setConvId(null)
    setError(null)
    setInput('')
  }

  return (
    <>
      {/* The bubble — always present (when allowed). aria-expanded
          mirrors the open state so screen readers announce the panel. */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close support assistant' : 'Open support assistant'}
        aria-expanded={open}
        className="fixed bottom-4 right-4 z-50 h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-brand-navy text-white shadow-lg shadow-brand-navy/30 flex items-center justify-center hover:bg-brand-navy/90 active:scale-95 transition-all"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        {open
          ? <X        className="h-5 w-5 sm:h-6 sm:w-6" />
          : <LifeBuoy className="h-5 w-5 sm:h-6 sm:w-6" />}
      </button>

      {/* The panel. Full-screen sheet on mobile, anchored card on desktop. */}
      {open && (
        <div
          role="dialog"
          aria-label="Support assistant"
          className="fixed z-50 inset-0 sm:inset-auto sm:bottom-20 sm:right-4 sm:w-[380px] sm:h-[560px] bg-white dark:bg-slate-900 sm:rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 flex flex-col"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 rounded-full bg-brand-navy/10 dark:bg-brand-navy/30 flex items-center justify-center shrink-0">
                <LifeBuoy className="h-4 w-4 text-brand-navy dark:text-white" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 leading-tight">Soteria support</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight truncate">
                  Ask how-to questions or talk to a human
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {turns.length > 0 && (
                <button
                  type="button"
                  onClick={onReset}
                  title="Start a new conversation"
                  aria-label="Start a new conversation"
                  className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 h-8 w-8 rounded-md flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  <MessageSquarePlus className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-200 h-8 w-8 rounded-md flex items-center justify-center hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {turns.length === 0 && <EmptyState pathname={pathname} onPick={t => { void send(t) }} />}
            {turns.map((t, i) => (
              <Bubble
                key={i}
                turn={t}
                onVote={t.role === 'assistant' && t.messageId ? (h: boolean) => { void onVote(i, h) } : undefined}
              />
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
              </div>
            )}
            {error && (
              <p className="text-xs text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900 rounded-md px-3 py-2 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{error}</span>
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="border-t border-slate-200 dark:border-slate-700 px-3 py-3 space-y-2 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    onSubmit(e as unknown as FormEvent)
                  }
                }}
                rows={1}
                maxLength={4000}
                placeholder={sending ? 'Waiting…' : 'Ask me anything about Soteria…'}
                disabled={sending}
                className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy bg-white dark:bg-slate-950 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={sending || input.trim().length === 0}
                aria-label="Send"
                className="h-9 w-9 rounded-lg bg-brand-navy text-white flex items-center justify-center disabled:opacity-40 hover:bg-brand-navy/90 transition-colors shrink-0"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={onTalkToHuman}
              disabled={sending}
              className="w-full text-xs font-semibold text-brand-navy dark:text-brand-yellow hover:underline disabled:opacity-40"
            >
              Talk to a human →
            </button>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center">
              Replies go to <span className="font-mono">{email ?? 'your account email'}</span>.
            </p>
          </form>
        </div>
      )}
    </>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────

function Bubble({ turn, onVote }: { turn: ChatTurn; onVote?: (helpful: boolean) => void }) {
  const isUser = turn.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex flex-col items-start'}>
      <div
        className={
          isUser
            ? 'max-w-[85%] rounded-2xl rounded-br-md bg-brand-navy text-white px-3 py-2 text-sm whitespace-pre-wrap'
            : 'max-w-[90%] rounded-2xl rounded-bl-md bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm whitespace-pre-wrap'
        }
      >
        {/* Light markdown rendering: links + bold are common in KB
            answers. Anything fancier (lists, code) stays as plain text
            for v1 — switching to a markdown lib is Phase 2. */}
        <RenderMarkdown text={turn.content} />
        {turn.ticketId && (
          <p className="mt-2 text-[10px] font-mono text-slate-500 dark:text-slate-400">
            Ticket #{turn.ticketId.slice(0, 8)}
          </p>
        )}
      </div>
      {!isUser && onVote && (
        <div className="flex items-center gap-1 mt-1 ml-1">
          <FeedbackButton
            active={turn.helpful === true}
            onClick={() => onVote(true)}
            label="Helpful"
            Icon={ThumbsUp}
          />
          <FeedbackButton
            active={turn.helpful === false}
            onClick={() => onVote(false)}
            label="Not helpful"
            Icon={ThumbsDown}
          />
          {turn.helpful === false && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400 ml-1">
              Tap <em>Talk to a human</em> below for personal help.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function FeedbackButton({
  active,
  onClick,
  label,
  Icon,
}: {
  active:  boolean
  onClick: () => void
  label:   string
  Icon:    typeof ThumbsUp
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={
        active
          ? 'h-6 w-6 rounded-md inline-flex items-center justify-center bg-brand-navy/10 dark:bg-brand-yellow/20 text-brand-navy dark:text-brand-yellow transition-colors'
          : 'h-6 w-6 rounded-md inline-flex items-center justify-center text-slate-400 dark:text-slate-500 hover:text-brand-navy dark:hover:text-brand-yellow hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors'
      }
    >
      <Icon className="h-3 w-3" />
    </button>
  )
}

function EmptyState({ pathname, onPick }: { pathname: string | null; onPick: (text: string) => void }) {
  // Page-aware suggestions. Falls back to general prompts when we don't
  // recognise the route.
  const suggestions = suggestionsFor(pathname)
  return (
    <div className="space-y-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Hi — I can answer how-to questions about Soteria. Try one of these or type your own.
      </p>
      <div className="flex flex-col gap-1.5">
        {suggestions.map(s => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="text-left text-xs px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-brand-navy hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 transition-colors"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

function suggestionsFor(pathname: string | null): string[] {
  const p = (pathname ?? '').toLowerCase()
  if (p === '/' || p.startsWith('/loto') || p.startsWith('/equipment')) {
    return [
      'How do I add a new piece of equipment?',
      'Why was my photo rejected?',
      'How do I generate energy-isolation steps with AI?',
    ]
  }
  if (p.startsWith('/departments')) {
    return [
      'How do I sign off a department?',
      'Why is the Sign Off button disabled?',
      'Where can I find a department\'s signed PDF history?',
    ]
  }
  if (p.startsWith('/print')) {
    return [
      'How do I batch-print placards?',
      'How do I export the print queue as CSV?',
      'How do I group the queue by department?',
    ]
  }
  if (p.startsWith('/confined-spaces')) {
    return [
      'How do I issue a new confined-space entry permit?',
      'Why is the Sign button disabled on the permit?',
      'What happens if a periodic atmospheric test fails?',
    ]
  }
  if (p.startsWith('/hot-work')) {
    return [
      'How do I create a hot-work permit?',
      'How does the post-work fire watch work?',
      'Why can\'t the PAI sign the permit?',
    ]
  }
  if (p.startsWith('/risk')) {
    return [
      'How do I score a new risk?',
      'What is the Hierarchy of Controls?',
      'My residual score is still red — what do I do?',
    ]
  }
  return [
    'How do I switch tenants?',
    'How do I install Soteria as an app on my iPad?',
    'I want to talk to a human.',
  ]
}

// ── Tiny markdown renderer (links + bold + inline code) ───────────────────
//
// We deliberately avoid pulling in a markdown lib for the MVP — bundle
// size matters on iPad. The handful of inline tokens covered here is
// enough for the KB-grounded answers the bot produces. Anything richer
// (lists, code blocks) renders as plain pre-wrapped text via the parent
// container's whitespace-pre-wrap. This will be replaced with react-
// markdown in Phase 2.

function RenderMarkdown({ text }: { text: string }) {
  const parts = parseInline(text)
  return (
    <>
      {parts.map((p, i) => {
        if (p.type === 'text')   return <span key={i}>{p.value}</span>
        if (p.type === 'bold')   return <strong key={i}>{p.value}</strong>
        if (p.type === 'code')   return <code key={i} className="font-mono text-[12px] px-1 rounded bg-black/10 dark:bg-white/10">{p.value}</code>
        if (p.type === 'link') {
          // Internal links open in the same tab; external open in a new
          // one. Treat anything starting with / as internal.
          const isInternal = p.href.startsWith('/')
          return (
            <a
              key={i}
              href={p.href}
              target={isInternal ? undefined : '_blank'}
              rel={isInternal ? undefined : 'noopener noreferrer'}
              className="underline underline-offset-2 hover:text-brand-yellow"
            >
              {p.value}
            </a>
          )
        }
        return null
      })}
    </>
  )
}

type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'code'; value: string }
  | { type: 'link'; value: string; href: string }

function parseInline(text: string): InlineToken[] {
  const out: InlineToken[] = []
  // Order matters — links before bold so "[**foo**](url)" works as a link.
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push({ type: 'text', value: text.slice(last, m.index) })
    if (m[1] && m[2])      out.push({ type: 'link', value: m[1], href: m[2] })
    else if (m[3])         out.push({ type: 'bold', value: m[3] })
    else if (m[4])         out.push({ type: 'code', value: m[4] })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) })
  return out
}
