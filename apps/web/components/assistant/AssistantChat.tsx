'use client'

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Send, Loader2, Wrench, BookOpen } from 'lucide-react'
import { supabase, readActiveTenant } from '@/lib/supabase'
import { Markdown } from '@/components/ui/markdown'

// Shared conversation surface for the Soteria assistant. Owns the turn
// state, the POST to /api/assistant/chat, and the rendering of messages
// (tool chips, markdown, citations). Re-used by the floating dock, the
// full-page /assistant view, and the agent-first home so the chat logic
// lives in exactly one place.
//
// Styling is driven by props so each host can size the scroll area and
// slot in host-specific controls (e.g. the dock's "scan equipment"
// button) without forking the conversation logic.

export interface ToolCall {
  name:   string
  input:  unknown
  result: string
}

export interface Citation {
  document_id:  string
  chunk_index:  number
  title:        string
  source_type:  string
  jurisdiction: string | null
  source_url:   string | null
  similarity:   number
}

interface Turn {
  role:       'user' | 'assistant'
  content:    string
  messageId?: string | null
  tools?:     ToolCall[]
  citations?: Citation[]
}

// Multiple chunks from the same document are common; list each document
// once with the highest-similarity chunk's metadata.
function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>()
  for (const c of citations) {
    const existing = seen.get(c.document_id)
    if (!existing || c.similarity > existing.similarity) seen.set(c.document_id, c)
  }
  return [...seen.values()].sort((a, b) => b.similarity - a.similarity)
}

export interface AssistantChatProps {
  /** Sent to the API so the assistant knows where the user is. */
  pathname:         string
  placeholder?:     string
  /** Rendered above the suggestions when the conversation is empty. */
  emptyState?:      ReactNode
  /** Clickable example prompts shown when the conversation is empty. */
  suggestions?:     string[]
  /** Tailwind classes for the scrollable message area (controls height). */
  scrollClassName?: string
  /** Optional control rendered to the left of the textarea (e.g. scan). */
  inputLeading?:    ReactNode
  textareaRows?:    number
  /** Notified once when the server assigns a conversation id. */
  onConversationId?: (id: string) => void
}

export default function AssistantChat({
  pathname,
  placeholder      = 'Ask anything about your tenant…',
  emptyState,
  suggestions,
  scrollClassName  = 'h-[60vh]',
  inputLeading,
  textareaRows     = 3,
  onConversationId,
}: AssistantChatProps) {
  const [turns, setTurns]           = useState<Turn[]>([])
  const [input, setInput]           = useState('')
  const [sending, setSending]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [conversationId, setConvId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns])

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
        body: JSON.stringify({ conversationId, message: messageText, pathname }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? `Server returned ${res.status}`)
      if (j.conversationId && !conversationId) {
        setConvId(j.conversationId as string)
        onConversationId?.(j.conversationId as string)
      }
      setTurns(prev => [...prev, {
        role:      'assistant',
        content:   String(j.reply ?? ''),
        messageId: (j.messageId as string | null) ?? null,
        tools:     Array.isArray(j.tools) ? (j.tools as ToolCall[]) : undefined,
        citations: Array.isArray(j.citations) ? (j.citations as Citation[]) : undefined,
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

  return (
    <div className="flex flex-col">
      <div
        ref={scrollRef}
        className={`overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3 text-sm ${scrollClassName}`}
      >
        {turns.length === 0 && (
          <div className="text-slate-500 dark:text-slate-400 text-sm space-y-3">
            {emptyState}
            {suggestions && suggestions.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {suggestions.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { if (!sending) void send(s) }}
                    className="motion-press rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-indigo-500/50 dark:hover:bg-indigo-900/30"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {turns.map((t, idx) => (
          <div key={idx} className={t.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div
              className={
                t.role === 'user'
                  ? 'rounded-lg bg-indigo-50 dark:bg-indigo-900/40 px-3 py-2 max-w-[85%]'
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
              {t.role === 'assistant' && t.citations && t.citations.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1">
                    <BookOpen className="h-3 w-3" /> Sources
                  </p>
                  <ul className="space-y-0.5">
                    {dedupeCitations(t.citations).map((c, i) => (
                      <li key={i} className="text-xs text-slate-600 dark:text-slate-300">
                        {c.source_url ? (
                          <a href={c.source_url} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
                            {c.title}
                          </a>
                        ) : (
                          <span>{c.title}</span>
                        )}
                        {c.jurisdiction && <span className="text-slate-400"> · {c.jurisdiction}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
        {inputLeading}
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (input.trim() && !sending) void send(input.trim())
            }
          }}
          placeholder={placeholder}
          rows={textareaRows}
          disabled={sending}
          className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-md bg-indigo-600 text-white px-4 py-2 text-sm hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 inline-flex items-center gap-1.5"
        >
          <Send className="h-4 w-4" /> <span className="hidden sm:inline">Send</span>
        </button>
      </form>
    </div>
  )
}
