'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Bot, Send, Loader2, Wrench, Plus } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { supabase, ACTIVE_TENANT_KEY } from '@/lib/supabase'
import { Markdown } from '@/components/ui/markdown'

// Full-page assistant view at /assistant. The floating dock in
// AssistantDock is the inline surface; this page is the "expanded"
// view linked from the dock's Maximize button. PR2 adds a sidebar
// listing prior conversations once the history fetch endpoint lands.

interface ToolCall {
  name:   string
  input:  unknown
  result: string
}

interface Turn {
  role:    'user' | 'assistant'
  content: string
  messageId?: string | null
  tools?:     ToolCall[]
}

function readActiveTenant(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_TENANT_KEY) }
  catch { return null }
}

export default function AssistantPage() {
  const { profile, loading: authLoading } = useAuth()
  const [turns, setTurns]             = useState<Turn[]>([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [conversationId, setConvId]   = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

  if (authLoading) return <div className="p-8 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!profile) return <div className="p-8 text-slate-500">Sign in to use the assistant.</div>

  async function send(messageText: string) {
    setError(null)
    setSending(true)
    setTurns(prev => [...prev, { role: 'user', content: messageText }])
    setInput('')

    try {
      const session = await supabase.auth.getSession()
      const token = session.data.session?.access_token
      if (!token) throw new Error('Sign in expired — please log in again.')
      const tenantId = readActiveTenant()
      if (!tenantId) throw new Error('No active tenant. Pick a tenant from the header switcher.')
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: {
          'Content-Type':    'application/json',
          'Authorization':   `Bearer ${token}`,
          'x-active-tenant': tenantId,
        },
        body: JSON.stringify({ conversationId, message: messageText, pathname: '/assistant' }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      if (j.conversationId && !conversationId) setConvId(j.conversationId as string)
      setTurns(prev => [...prev, {
        role:      'assistant',
        content:   String(j.reply ?? ''),
        messageId: (j.messageId as string | null) ?? null,
        tools:     Array.isArray(j.tools) ? (j.tools as ToolCall[]) : undefined,
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

  function newConversation() {
    setTurns([])
    setConvId(null)
    setError(null)
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-full bg-indigo-600 text-white flex items-center justify-center">
            <Bot className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Soteria assistant</h1>
            <p className="text-xs text-slate-500">Cross-module AI grounded in your tenant data, OSHA, DOT, and EPA.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={newConversation}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </header>

      <div ref={scrollRef} className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 h-[60vh] overflow-y-auto p-4 space-y-3 text-sm">
        {turns.length === 0 && (
          <div className="text-slate-500 dark:text-slate-400 text-sm">
            <p className="mb-2">Try asking:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>What does 29 CFR 1910.147 require for periodic LOTO inspections?</li>
              <li>List departments and which ones have the most equipment.</li>
              <li>Show recent incidents and group them by severity.</li>
              <li>What PPE does this tenant&apos;s policies require for confined-space entry?</li>
            </ul>
          </div>
        )}
        {turns.map((t, idx) => (
          <div key={idx} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                t.role === 'user'
                  ? 'rounded-lg bg-indigo-50 dark:bg-indigo-900/40 px-3 py-2 max-w-[80%]'
                  : 'rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 max-w-[90%]'
              }
            >
              {t.role === 'assistant' && t.tools && t.tools.length > 0 && (
                <div className="mb-1 flex flex-wrap gap-1">
                  {t.tools.map((tc, i) => (
                    <span
                      key={i}
                      title={typeof tc.input === 'object' ? JSON.stringify(tc.input) : String(tc.input)}
                      className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[11px] text-slate-700 dark:text-slate-300"
                    >
                      <Wrench className="h-3 w-3" /> {tc.name}
                    </span>
                  ))}
                </div>
              )}
              {t.role === 'assistant'
                ? <Markdown text={t.content} />
                : <p className="whitespace-pre-wrap">{t.content}</p>}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-slate-100 dark:bg-slate-800 px-3 py-2 inline-flex items-center gap-2 text-slate-500 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" /> thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/30 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (input.trim() && !sending) void send(input.trim())
            }
          }}
          placeholder="Ask about your tenant, OSHA, DOT, EPA, or company policies…"
          rows={3}
          disabled={sending}
          className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-md bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 inline-flex items-center gap-1.5"
        >
          <Send className="h-4 w-4" /> Send
        </button>
      </form>

      <p className="mt-3 text-[11px] text-slate-400 text-center">
        Soteria is a drafting + reference tool. Compliance and safety decisions must be reviewed by a qualified person before action.
      </p>
    </div>
  )
}
