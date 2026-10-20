'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { BookOpen, HardHat, Loader2, MessageCircleQuestion, Send, X } from 'lucide-react'
import { Markdown } from '@/components/ui/markdown'
import { strikeFetch } from '@/lib/strike/clientApi'

interface CoachCitation {
  document_id: string
  title: string
  section: string | null
  source_url: string | null
}

interface CoachTurn {
  role: 'user' | 'assistant'
  content: string
  citations?: CoachCitation[]
}

interface CoachDockProps {
  tenantId: string
  moduleId?: string
  /** While the graded check is open the coach explains concepts but won't give answers. */
  attemptOpen: boolean
}

const STARTERS = [
  "What's the difference between authorized and affected?",
  'Can I use just a tag?',
  '¿Qué hago al cambio de turno?',
]

// Floating "Ask LOTO Coach" panel beside a STRIKE module. A bottom sheet on
// phones, a docked card on wider screens. The footer is permanent on purpose:
// the coach explains; the site procedure and the supervisor decide.
export function CoachDock({ tenantId, moduleId, attemptOpen }: CoachDockProps) {
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<CoachTurn[]>([])
  const [draft, setDraft] = useState('')
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, sending])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  async function ask(question: string) {
    const message = question.trim()
    if (!message || sending) return
    setTurns(prev => [...prev, { role: 'user', content: message }])
    setDraft('')
    setSending(true)
    setError(null)
    try {
      const res = await strikeFetch<{ conversationId: string; reply: string; citations: CoachCitation[] }>(
        '/api/strike/coach/chat',
        tenantId,
        { body: { message, conversation_id: conversationId, module_id: moduleId ?? null, attempt_open: attemptOpen } },
      )
      setConversationId(res.conversationId)
      setTurns(prev => [...prev, { role: 'assistant', content: res.reply, citations: dedupe(res.citations) }])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void ask(draft)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="motion-press fixed bottom-4 right-4 z-40 inline-flex min-h-12 items-center gap-2 rounded-full bg-brand-navy px-4 py-3 text-sm font-bold text-white shadow-lg ring-2 ring-brand-yellow hover:bg-brand-navy/90"
      >
        <MessageCircleQuestion className="h-5 w-5 text-brand-yellow" aria-hidden />
        Ask LOTO Coach
      </button>
    )
  }

  return (
    <section
      role="dialog"
      aria-label="LOTO Coach"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:inset-x-auto sm:bottom-4 sm:right-4 sm:max-h-[min(640px,80vh)] sm:w-[400px] sm:rounded-2xl"
    >
      <header className="flex items-center justify-between gap-2 rounded-t-2xl bg-brand-navy px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-brand-yellow" aria-hidden />
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.12em]">LOTO Coach</h2>
            <p className="text-[11px] text-white/75">{attemptOpen ? 'Knowledge check open: I’ll explain, not answer' : 'Ask anything about lockout/tagout'}</p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close LOTO Coach"
          className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </header>

      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600 dark:text-slate-300">Try one of these:</p>
            {STARTERS.map(q => (
              <button key={q} type="button" onClick={() => void ask(q)}
                className="block min-h-11 w-full rounded-lg border border-slate-200 px-3 py-2 text-left text-sm text-slate-800 hover:border-brand-navy dark:border-slate-700 dark:text-slate-100">
                {q}
              </button>
            ))}
          </div>
        )}
        {turns.map((turn, i) => (
          <div key={i} className={turn.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
              turn.role === 'user'
                ? 'bg-brand-navy text-white'
                : 'bg-slate-100 text-slate-900 dark:bg-slate-900 dark:text-slate-100'
            }`}>
              {turn.role === 'assistant' ? <Markdown text={turn.content} /> : turn.content}
              {turn.citations && turn.citations.length > 0 && (
                <ul className="mt-2 flex flex-wrap gap-1" aria-label="Sources">
                  {turn.citations.map(c => (
                    <li key={c.document_id} className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700">
                      <BookOpen className="h-3 w-3" aria-hidden />
                      {c.title.replace(/^LOTO Coach:\s*/, '')}{c.section ? ` · ${c.section}` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {sending && (
          <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Coach is thinking…</p>
        )}
        {error && <p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{error}</p>}
      </div>

      <form onSubmit={onSubmit} className="flex items-end gap-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
        <label className="sr-only" htmlFor="loto-coach-input">Ask the LOTO Coach</label>
        <textarea
          id="loto-coach-input"
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft) } }}
          rows={1}
          maxLength={2000}
          placeholder="Ask about lockout/tagout…"
          className="max-h-28 min-h-11 flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:border-brand-navy focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-600 dark:bg-slate-900"
        />
        <button type="submit" disabled={sending || !draft.trim()} aria-label="Send"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-navy text-white disabled:opacity-40">
          <Send className="h-4 w-4" />
        </button>
      </form>
      <p className="border-t border-slate-100 px-4 py-2 text-center text-[11px] text-slate-500 dark:border-slate-800 dark:text-slate-400">
        Coach explains; your site procedure and supervisor decide.
      </p>
    </section>
  )
}

function dedupe(citations: CoachCitation[] = []): CoachCitation[] {
  const seen = new Set<string>()
  return citations.filter(c => (seen.has(c.document_id) ? false : (seen.add(c.document_id), true)))
}
