'use client'

import { useState } from 'react'
import type { AssistRequest, AssistResponse, FieldType } from '@/lib/assistTypes'

interface Props {
  field:        FieldType
  currentValue: string
  equipment: {
    equipment_id: string
    description:  string
    department:   string
  }
  context?: {
    energy_type?:            string
    step_number?:            number
    tag_description?:        string
    isolation_procedure?:    string
    method_of_verification?: string
  }
  onAccept:   (suggestion: string) => void
  onError?:   (message: string) => void
}

export default function AiAssistButton({ field, currentValue, equipment, context, onAccept, onError }: Props) {
  const [loading, setLoading] = useState(false)
  const [suggestion, setSuggestion] = useState<string | null>(null)

  async function fetchSuggestion() {
    setLoading(true)
    setSuggestion(null)
    try {
      const body: AssistRequest = {
        field,
        currentValue,
        equipment,
        ...(context ?? {}),
      }
      const res  = await fetch('/api/assist-placard-field', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
      })
      const json = await res.json().catch(() => null) as (AssistResponse & { error?: string }) | null
      if (!res.ok || !json?.suggestion) {
        const serverMsg = json?.error
        console.error('[AiAssistButton] request failed', res.status, serverMsg)
        throw new Error(serverMsg ?? `Request failed (${res.status})`)
      }
      setSuggestion(json.suggestion)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'AI assist unavailable.'
      onError?.(`AI assist: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  function accept() {
    if (suggestion) onAccept(suggestion)
    setSuggestion(null)
  }

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={fetchSuggestion}
        disabled={loading}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-violet-600 hover:text-violet-800 disabled:opacity-50 transition-colors"
        title={currentValue.trim() ? 'Revise with AI' : 'Generate with AI'}
      >
        {loading ? (
          <>
            <span className="w-2.5 h-2.5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
            Generating…
          </>
        ) : (
          <>✦ {currentValue.trim() ? 'Revise with AI' : 'Generate with AI'}</>
        )}
      </button>

      {suggestion && (
        <div className="rounded-lg border border-violet-200 bg-violet-50 px-3 py-2.5 space-y-2">
          <p className="text-[10px] font-bold text-violet-500 uppercase tracking-wide">AI Suggestion</p>
          <p className="text-xs text-slate-700 whitespace-pre-wrap leading-relaxed">{suggestion}</p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={accept}
              className="text-xs font-semibold text-white bg-violet-600 hover:bg-violet-700 px-3 py-1 rounded-md transition-colors"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => setSuggestion(null)}
              className="text-xs text-violet-600 hover:text-violet-800 transition-colors"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={fetchSuggestion}
              disabled={loading}
              className="text-xs text-violet-500 hover:text-violet-700 ml-auto transition-colors"
            >
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
