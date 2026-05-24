'use client'

import { useState } from 'react'
import { Bot, Loader2, Plus } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import AssistantChat from '@/components/assistant/AssistantChat'

// Full-page assistant view at /assistant. The floating dock in
// AssistantDock is the inline surface; this page is the "expanded" view
// linked from the dock's Maximize button. The conversation logic lives in
// the shared AssistantChat component; "New" remounts it to reset state.

const SUGGESTIONS = [
  'What does 29 CFR 1910.147 require for periodic LOTO inspections?',
  'List departments and which ones have the most equipment.',
  'Show recent incidents and group them by severity.',
  "What PPE do this tenant's policies require for confined-space entry?",
]

export default function AssistantPage() {
  const { profile, loading: authLoading } = useAuth()
  const [resetKey, setResetKey] = useState(0)

  if (authLoading) return <div className="p-8 text-slate-500"><Loader2 className="h-5 w-5 animate-spin" /></div>
  if (!profile) return <div className="p-8 text-slate-500">Sign in to use the assistant.</div>

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
          onClick={() => setResetKey(k => k + 1)}
          className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700"
        >
          <Plus className="h-3.5 w-3.5" /> New
        </button>
      </header>

      <AssistantChat
        key={resetKey}
        pathname="/assistant"
        placeholder="Ask about your tenant, OSHA, DOT, EPA, or company policies…"
        scrollClassName="h-[60vh]"
        suggestions={SUGGESTIONS}
        emptyState={<p>Try asking:</p>}
      />

      <p className="mt-3 text-[11px] text-slate-400 text-center">
        Soteria is a drafting + reference tool. Compliance and safety decisions must be reviewed by a qualified person before action.
      </p>
    </div>
  )
}
