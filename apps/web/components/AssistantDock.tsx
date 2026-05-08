'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { usePathname } from 'next/navigation'
import { Bot, X, Send, Loader2, Wrench, Maximize2, ScanLine } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { supabase, ACTIVE_TENANT_KEY } from '@/lib/supabase'
import { Markdown } from '@/components/ui/markdown'

// AssistantDock — global floating button + expandable chat panel for the
// home-page assistant. Mounted once in app/layout.tsx behind the
// 'assistant' tenant module flag.
//
// Distinct from SupportBot: SupportBot is the "how do I use the app + open
// a ticket" surface. AssistantDock is the cross-module domain assistant
// with regulatory grounding (PR2) and equipment scanning (PR3).
//
// PR1 ships: send/receive turns, render tool calls, navigate to /assistant
// for a full-page view, and expose a "scan equipment" button that's inert
// until PR3 wires in the camera. The inert button is intentional — the
// affordance is part of the redesign brief and shouldn't appear out of
// nowhere when scanning lands.

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

function shouldHide(pathname: string | null): boolean {
  if (!pathname) return true
  if (pathname === '/login') return true
  if (pathname === '/welcome') return true
  if (pathname === '/forgot-password') return true
  if (pathname.startsWith('/reset-password')) return true
  if (pathname.startsWith('/inspector/')) return true
  if (pathname.startsWith('/permit-signon/')) return true
  // Avoid double-mount on the full-page view itself.
  if (pathname.startsWith('/assistant')) return true
  return false
}

function readActiveTenant(): string | null {
  if (typeof window === 'undefined') return null
  try { return window.sessionStorage.getItem(ACTIVE_TENANT_KEY) }
  catch { return null }
}

export default function AssistantDock() {
  const pathname = usePathname()
  const { profile, loading: authLoading } = useAuth()
  const [open, setOpen]               = useState(false)
  const [turns, setTurns]             = useState<Turn[]>([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const [error, setError]             = useState<string | null>(null)
  const [conversationId, setConvId]   = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [turns, open])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (authLoading) return null
  if (!profile) return null
  if (shouldHide(pathname)) return null

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

  return (
    <>
      {/* Floating launch button */}
      {!open && (
        <button
          type="button"
          aria-label="Open Soteria assistant"
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-40 h-14 w-14 rounded-full bg-indigo-600 text-white shadow-lg hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400 flex items-center justify-center"
        >
          <Bot className="h-6 w-6" />
        </button>
      )}

      {/* Expanded panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Soteria assistant"
          className="fixed bottom-5 right-5 z-40 w-[min(380px,calc(100vw-2rem))] h-[min(640px,calc(100vh-3rem))] flex flex-col rounded-xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden"
        >
          <header className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-indigo-600 text-white">
            <div className="flex items-center gap-2">
              <Bot className="h-5 w-5" />
              <span className="text-sm font-semibold">Soteria assistant</span>
            </div>
            <div className="flex items-center gap-1">
              <a
                href="/assistant"
                title="Open full view"
                className="p-1.5 rounded hover:bg-indigo-700"
              >
                <Maximize2 className="h-4 w-4" />
              </a>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close assistant"
                className="p-1.5 rounded hover:bg-indigo-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </header>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 text-sm text-slate-800 dark:text-slate-200">
            {turns.length === 0 && (
              <div className="text-slate-500 dark:text-slate-400 text-xs space-y-2 mt-2">
                <p>Ask about equipment, hazards, OSHA citations, recent incidents, or how to find anything in your tenant.</p>
                <p className="text-slate-400 dark:text-slate-500">Examples:</p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>What does OSHA say about lockout for hydraulic systems?</li>
                  <li>Show me incidents from the last 7 days.</li>
                  <li>Find chemicals with GHS H225.</li>
                </ul>
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
                          className="inline-flex items-center gap-1 rounded-full bg-slate-200 dark:bg-slate-700 px-2 py-0.5 text-[10px] text-slate-700 dark:text-slate-300"
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

          <form onSubmit={onSubmit} className="border-t border-slate-100 dark:border-slate-800 p-2 flex items-end gap-2 bg-white dark:bg-slate-900">
            <button
              type="button"
              title="Scan equipment (coming in PR3)"
              disabled
              className="p-2 rounded-md text-slate-400 dark:text-slate-500 cursor-not-allowed"
            >
              <ScanLine className="h-5 w-5" />
            </button>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  if (input.trim() && !sending) void send(input.trim())
                }
              }}
              placeholder="Ask anything about your tenant…"
              rows={2}
              disabled={sending}
              className="flex-1 resize-none rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="p-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
