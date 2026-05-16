'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Brain, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  shouldEscalate,
  type IncidentSeverity,
  type SeverityPrediction,
} from '@soteria/core/incidentEscalation'
import { SEVERITY_ACTUAL_LABEL } from '@soteria/core/incident'

interface Props {
  incidentId:      string
  currentSeverity: IncidentSeverity
}

interface PredictionRow {
  id:                 string
  predicted_severity: IncidentSeverity
  confidence:         number
  model:              string
  prompt_version:     string
  predicted_at:       string
  reasoning?:         string
  raw_response?:      { reasoning?: string } | null
}

export default function EscalationPredictionPanel({ incidentId, currentSeverity }: Props) {
  const { profile } = useAuth()
  const { tenant } = useTenant()
  const isAdmin = !!profile?.is_admin

  const [latest, setLatest] = useState<PredictionRow | null>(null)
  const [busy,   setBusy]   = useState(false)
  const [error,  setError]  = useState<string | null>(null)

  const loadLatest = useCallback(async () => {
    if (!tenant?.id) return
    try {
      const { data, error } = await supabase
        .from('incident_predictions')
        .select('id, predicted_severity, confidence, model, prompt_version, predicted_at, raw_response')
        .eq('tenant_id', tenant.id)
        .eq('incident_id', incidentId)
        .order('predicted_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw new Error(error.message)
      setLatest(data as PredictionRow | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load prediction history.')
    }
  }, [tenant?.id, incidentId])

  useEffect(() => { void loadLatest() }, [loadLatest])

  async function runPrediction() {
    if (!tenant?.id || busy) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {
        'content-type':    'application/json',
        'x-active-tenant': tenant.id,
      }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${incidentId}/predict-escalation`, {
        method: 'POST',
        headers,
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setLatest(body.prediction as PredictionRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Prediction failed.')
    } finally {
      setBusy(false)
    }
  }

  const prediction: SeverityPrediction | null = latest
    ? { predicted_severity: latest.predicted_severity, confidence: latest.confidence }
    : null
  const escalate = prediction ? shouldEscalate(currentSeverity, prediction) : false

  return (
    <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
          <Brain className="h-3.5 w-3.5" />
          AI severity check
        </h2>
        {isAdmin && (
          <button
            type="button"
            onClick={() => void runPrediction()}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-brand-navy text-white px-3 py-1 text-xs font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Brain className="h-3 w-3" />}
            Run prediction
          </button>
        )}
      </header>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error}
        </div>
      )}

      {!latest ? (
        <p className="text-xs text-slate-500 dark:text-slate-400 italic">
          {isAdmin
            ? 'No prediction run yet. Click "Run prediction" to ask the model whether the severity was under-classified.'
            : 'No AI prediction recorded for this incident yet.'}
        </p>
      ) : (
        <>
          {escalate && (
            <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/40 px-3 py-2 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">Possible under-classification.</p>
                <p>
                  Model suggests <strong>{SEVERITY_ACTUAL_LABEL[latest.predicted_severity]}</strong> at{' '}
                  {Math.round(latest.confidence * 100)}% confidence — currently classified as{' '}
                  <strong>{SEVERITY_ACTUAL_LABEL[currentSeverity]}</strong>. Review and adjust if appropriate.
                </p>
              </div>
            </div>
          )}
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-xs">
            <Field label="Predicted">{SEVERITY_ACTUAL_LABEL[latest.predicted_severity]}</Field>
            <Field label="Confidence">{Math.round(latest.confidence * 100)}%</Field>
            <Field label="Model">{latest.model} · {latest.prompt_version}</Field>
          </dl>
          {(latest.raw_response?.reasoning || latest.reasoning) && (
            <p className="text-xs text-slate-600 dark:text-slate-400 italic">
              {latest.raw_response?.reasoning ?? latest.reasoning}
            </p>
          )}
          <p className="text-[10px] text-slate-400 tabular-nums">
            Last run {new Date(latest.predicted_at).toLocaleString()}
          </p>
        </>
      )}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className="text-slate-800 dark:text-slate-200">{children}</dd>
    </div>
  )
}
