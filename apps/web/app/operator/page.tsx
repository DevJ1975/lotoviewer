'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowLeft, Bot, Check, Loader2, Plus, Send, Wrench } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { authHeaders } from '@/app/admin/loto/multi-agent-audit/_lib/authHeaders'
import { Markdown } from '@/components/ui/markdown'
import type { OperatorStreamEvent } from '@/lib/ai/operator/streamEvents'

// Operator Console — the top-level chat surface for the multi-agent
// orchestrator (lib/ai/operator/). Open to any signed-in member; the
// orchestrator restricts which sub-agents each role may use. This is the
// codebase's first SSE consumer: it POSTs to /api/operator/chat and reads the
// text/event-stream, rendering each milestone (delegation chips, per-agent tool
// lines) live, then the synthesized answer.

interface DelegationView {
  index:   number
  agentId: string
  title:   string
  tools:   string[]
  done:    boolean
}

interface Turn {
  role:        'user' | 'assistant'
  content:     string
  delegations: DelegationView[]
  status:      'streaming' | 'done' | 'error'
}

interface ConversationSummary {
  id:              string
  title:           string | null
  last_message_at: string
}

interface StoredDelegation {
  agentId:   string
  task:      string
  text:      string
  toolCalls: Array<{ name: string }>
  hitLoopCap: boolean
}

const SUGGESTIONS = [
  'Summarize this week\'s incidents and near-misses.',
  'Which training certifications expire in the next 30 days?',
  'What confined-space permits are active right now?',
]

const userTurn = (content: string): Turn => ({ role: 'user', content, delegations: [], status: 'done' })
const freshAssistantTurn = (): Turn => ({ role: 'assistant', content: '', delegations: [], status: 'streaming' })

export default function OperatorConsolePage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId, loading: tenantLoading } = useTenant()

  const [turns, setTurns]                 = useState<Turn[]>([])
  const [input, setInput]                 = useState('')
  const [sending, setSending]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

  const loadConversations = useCallback(async () => {
    if (!tenantId) return
    try {
      const res = await fetch('/api/operator/conversations', { headers: await authHeaders(tenantId) })
      if (!res.ok) return
      const json = await res.json()
      setConversations((json.conversations ?? []) as ConversationSummary[])
    } catch { /* non-fatal: the history list is a convenience */ }
  }, [tenantId])

  useEffect(() => { if (!authLoading && !tenantLoading && profile && tenantId) void loadConversations() },
    [authLoading, tenantLoading, profile, tenantId, loadConversations])

  // Update the trailing assistant turn from a streamed event.
  const applyEvent = useCallback((e: OperatorStreamEvent) => {
    if (e.type === 'conversation') { setConversationId(e.conversationId); return }
    setTurns(prev => {
      const next = [...prev]
      const turn = next[next.length - 1]
      if (!turn || turn.role !== 'assistant') return prev
      switch (e.type) {
        case 'delegation_start':
          turn.delegations = [...turn.delegations, { index: e.index, agentId: e.agentId, title: e.title, tools: [], done: false }]
          break
        case 'agent_tool_call': {
          turn.delegations = turn.delegations.map(d => d.index === e.index ? { ...d, tools: [...d.tools, e.tool] } : d)
          break
        }
        case 'agent_done':
          turn.delegations = turn.delegations.map(d => d.index === e.index ? { ...d, done: true } : d)
          break
        case 'final':
          turn.content = e.text; turn.status = 'done'
          break
        case 'error':
          turn.content = e.message; turn.status = 'error'
          break
      }
      next[next.length - 1] = { ...turn }
      return next
    })
  }, [])

  const send = useCallback(async (text: string) => {
    if (!tenantId) { setError('No active tenant. Pick one from the header switcher.'); return }
    setError(null)
    setSending(true)
    setInput('')
    setTurns(prev => [...prev, userTurn(text), freshAssistantTurn()])

    try {
      const res = await fetch('/api/operator/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders(tenantId)) },
        body:    JSON.stringify({ message: text, conversationId, pathname: '/operator' }),
      })
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => ({}))
        applyEvent({ type: 'error', message: (j as { error?: string }).error ?? `Server returned ${res.status}` })
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let sep: number
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep)
          buffer = buffer.slice(sep + 2)
          if (!frame.startsWith('data:')) continue
          try { applyEvent(JSON.parse(frame.slice(5).trim()) as OperatorStreamEvent) }
          catch { /* skip a malformed frame rather than abort the whole turn */ }
        }
      }
    } catch (err) {
      applyEvent({ type: 'error', message: err instanceof Error ? err.message : 'The Operator Console is unavailable.' })
    } finally {
      setSending(false)
      void loadConversations()
    }
  }, [tenantId, conversationId, applyEvent, loadConversations])

  const loadConversation = useCallback(async (id: string) => {
    if (!tenantId || sending) return
    setError(null)
    try {
      const res = await fetch(`/api/operator/conversations?id=${encodeURIComponent(id)}`, { headers: await authHeaders(tenantId) })
      if (!res.ok) { setError('Could not open that conversation.'); return }
      const json = await res.json()
      const rows = (json.messages ?? []) as Array<{ role: 'user' | 'assistant'; content: string; metadata: { delegations?: StoredDelegation[] } | null }>
      setTurns(rows.map(r => r.role === 'user' ? userTurn(r.content) : {
        role: 'assistant',
        content: r.content,
        status: 'done',
        delegations: (r.metadata?.delegations ?? []).map((d, i) => ({
          index: i, agentId: d.agentId, title: d.agentId, tools: d.toolCalls.map(t => t.name), done: true,
        })),
      }))
      setConversationId(id)
    } catch { setError('Could not open that conversation.') }
  }, [tenantId, sending])

  const startNew = useCallback(() => {
    if (sending) return
    setTurns([]); setConversationId(null); setError(null)
  }, [sending])

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const text = input.trim()
    if (!text || sending) return
    void send(text)
  }

  if (authLoading || tenantLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!profile) {
    return <main className="mx-auto max-w-3xl px-4 py-10"><p className="text-sm text-slate-500">Please sign in to use the Operator Console.</p></main>
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <div className="mb-4">
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Home
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-slate-50">
            <Bot className="h-6 w-6 text-brand-navy" /> Operator Console
          </h1>
          <button
            type="button"
            onClick={startNew}
            disabled={sending || turns.length === 0}
            className="motion-press inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:border-brand-navy/40 hover:text-brand-navy disabled:opacity-40 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <Plus className="h-3.5 w-3.5" /> New
          </button>
        </div>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Ask across your modules — the orchestrator delegates to the right specialist agents and synthesizes the answer.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_16rem]">
        {/* Conversation */}
        <section className="flex flex-col">
          <div
            ref={scrollRef}
            className="h-[62vh] space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50/60 p-4 text-sm shadow-inner dark:border-slate-800 dark:from-slate-900 dark:to-slate-950/60"
          >
            {turns.length === 0 && (
              <div className="space-y-3 text-slate-500 dark:text-slate-400">
                <p>Start by asking a question. For example:</p>
                <div className="flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => { if (!sending) void send(s) }}
                      className="motion-press rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 shadow-sm hover:border-brand-navy/40 hover:bg-brand-navy/5 hover:text-brand-navy dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((t, idx) => t.role === 'user' ? (
              <div key={idx} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-brand-navy px-3.5 py-2 text-white shadow-sm">
                  <p className="whitespace-pre-wrap">{t.content}</p>
                </div>
              </div>
            ) : (
              <div key={idx} className="flex flex-col gap-2">
                {t.delegations.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {t.delegations.map(d => (
                      <div key={d.index} className="rounded-lg border border-slate-200 bg-white/70 px-2.5 py-1.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
                        <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                          {d.done ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-navy" />}
                          {d.title}
                        </div>
                        {d.tools.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1 pl-5 text-[11px] text-slate-500 dark:text-slate-400">
                            {d.tools.map((tool, ti) => (
                              <span key={ti} className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700/60">
                                <Wrench className="h-3 w-3" /> {tool}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {t.content
                  ? (
                    <div className={`max-w-[85%] rounded-2xl rounded-bl-sm px-3.5 py-2 shadow-sm ${t.status === 'error' ? 'border border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100' : 'bg-white text-slate-800 dark:bg-slate-800 dark:text-slate-100'}`}>
                      <Markdown text={t.content} />
                    </div>
                  )
                  : t.status === 'streaming' && (
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…
                    </div>
                  )}
              </div>
            ))}
          </div>

          {error && (
            <div className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
              {error}
            </div>
          )}

          <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSubmit(e) } }}
              rows={2}
              placeholder="Ask the Operator Console…"
              className="flex-1 resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-navy/50 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="motion-press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-navy px-4 text-sm font-semibold text-white shadow-sm hover:bg-brand-navy/90 disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Send
            </button>
          </form>
        </section>

        {/* History */}
        <aside className="order-first lg:order-none">
          <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-slate-500">Recent</h2>
          {conversations.length === 0 ? (
            <p className="text-xs text-slate-400">No conversations yet.</p>
          ) : (
            <ul className="space-y-1">
              {conversations.map(c => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => void loadConversation(c.id)}
                    disabled={sending}
                    className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-xs hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800 ${c.id === conversationId ? 'bg-slate-100 font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300'}`}
                  >
                    {c.title || 'Untitled'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  )
}
