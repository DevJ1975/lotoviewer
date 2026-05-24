'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Bot, Maximize2, ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { timeOfDayGreeting } from '@/components/Greeting'
import AssistantChat from '@/components/assistant/AssistantChat'
import MultiModuleDashboard from './MultiModuleDashboard'

// Agent-first home. The assistant is the primary surface a client lands on —
// they can ask anything across every module and the agent answers using its
// tools + regulatory RAG. The full operational dashboard (command center,
// KPIs, module panels) stays one scroll below as secondary context.
//
// Single-module tenants are still redirected to their module home by
// lib/landing.ts; this surface is the multi-module landing.

const SUGGESTIONS = [
  "What's our incident risk right now and where should we focus?",
  'Show me overdue corrective actions and risk reviews.',
  'Which training certifications expire this month?',
  "Summarize this week's near-misses and BBS observations.",
  'Take me to the confined-space status board.',
]

export default function AgentHome() {
  const { profile, email } = useAuth()
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0]) || (email?.split('@')[0]) || 'there'
  const greeting = useMemo(() => timeOfDayGreeting(new Date()), [])
  const [showDashboard, setShowDashboard] = useState(true)

  return (
    <div className="animate-panel-in">
      <section className="mx-auto max-w-4xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
              <Bot className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">
                {greeting}, {firstName}.
              </h1>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Ask SoteriaField anything — incidents, permits, chemicals, risk, training, and more.
              </p>
            </div>
          </div>
          <Link
            href="/assistant"
            title="Open full assistant view"
            className="motion-press hidden shrink-0 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm hover:border-indigo-300 hover:text-indigo-700 sm:inline-flex dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Full view
          </Link>
        </div>

        <AssistantChat
          pathname="/"
          placeholder="Ask about any module, or type what you need…"
          scrollClassName="h-[44vh] min-h-[320px]"
          suggestions={SUGGESTIONS}
          emptyState={<p className="text-slate-600 dark:text-slate-300">Try one of these, or ask your own question:</p>}
        />
      </section>

      <section className="mx-auto mt-8 max-w-7xl px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => setShowDashboard(v => !v)}
          className="motion-press mb-1 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          aria-expanded={showDashboard}
        >
          {showDashboard ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Operations dashboard
        </button>
      </section>

      {showDashboard && <MultiModuleDashboard embedded />}
    </div>
  )
}
