'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Bot, Maximize2, ChevronDown, ChevronUp } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { dailyQuote, timeOfDayGreeting } from '@/components/Greeting'
import AssistantChat from '@/components/assistant/AssistantChat'
import { Hero } from './Hero'
import MultiModuleDashboard from './MultiModuleDashboard'

// Agent-first home. Leads with the greeting/clock/weather hero, then the
// assistant as the primary surface (ask anything across every module), then
// the full operational dashboard below as secondary context.
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

const CLOCK_TICK_MS = 1000

export default function AgentHome() {
  const { profile, email } = useAuth()
  const firstName = (profile?.full_name?.trim().split(/\s+/)[0]) || (email?.split('@')[0]) || 'there'
  const [showDashboard, setShowDashboard] = useState(true)

  // Live clock drives the hero (greeting + time), one interval for the page.
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => clearInterval(id)
  }, [])

  const greeting = useMemo(() => timeOfDayGreeting(now), [now])
  const quoteDateKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const quote = useMemo(() => {
    const [year, month, day] = quoteDateKey.split('-').map(Number)
    return dailyQuote(new Date(year!, month!, day!)).text
  }, [quoteDateKey])
  const dateLabel = useMemo(() => now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }), [now])
  const timeLabel = useMemo(() => now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }), [now])

  return (
    <div className="animate-panel-in">
      <div className="mx-auto max-w-7xl space-y-5 px-4 pt-6 sm:px-6 lg:px-8">
        <Hero greeting={greeting} firstName={firstName} dateLabel={dateLabel} timeLabel={timeLabel} quote={quote} />

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white">
                <Bot className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Ask SoteriaField</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Incidents, permits, chemicals, risk, training — anything across your modules.
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
            scrollClassName="h-[40vh] min-h-[300px]"
            suggestions={SUGGESTIONS}
            emptyState={<p className="text-slate-600 dark:text-slate-300">Try one of these, or ask your own question:</p>}
          />
        </section>

        <button
          type="button"
          onClick={() => setShowDashboard(v => !v)}
          className="motion-press inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          aria-expanded={showDashboard}
        >
          {showDashboard ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          Operations dashboard
        </button>
      </div>

      {showDashboard && <MultiModuleDashboard embedded />}
    </div>
  )
}
