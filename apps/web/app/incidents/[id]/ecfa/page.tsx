'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, AlertTriangle, BookOpen, Loader2, Play } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import type { IncidentInvestigationRow } from '@soteria/core/rcaSchemas'
import EcfaBoard from './_components/EcfaBoard'

// /incidents/[id]/ecfa — Events & Causal Factors Analysis.
//
// A complementary investigation surface that runs alongside RCA: build the
// chronological event/condition timeline, flag + code the causal factors,
// and turn each one into a tracked corrective action. It attaches to the
// same incident_investigations row, so it reuses the "Begin investigation"
// lifecycle — if no investigation exists yet, start one here.

export default function EcfaPage() {
  const { id } = useParams<{ id: string }>()
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const isAdmin = !!profile?.is_admin || !!profile?.is_superadmin

  const [investigation, setInvestigation] = useState<IncidentInvestigationRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id || !id) return
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}/investigation`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow | null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [tenant, id])

  useEffect(() => { void load() }, [load])

  async function begin() {
    if (!tenant?.id || !id) return
    setBusy(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'content-type': 'application/json', 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      const res = await fetch(`/api/incidents/${id}/investigation`, {
        method: 'POST', headers, body: JSON.stringify({ rca_method: 'none_yet' }),
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setInvestigation(body.investigation as IncidentInvestigationRow)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link href={`/incidents/${id}`} className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Back to incident
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Events &amp; Causal Factors</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Chart what happened in order, separate verified fact from assumption, and turn each causal factor into a corrective action.
          </p>
        </div>
        <Link href="/wiki/ecfa" className="inline-flex items-center gap-1 rounded-md border border-slate-300 dark:border-slate-700 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">
          <BookOpen className="h-3.5 w-3.5" /> How to use
        </Link>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" /><span>{error}</span>
        </div>
      )}

      {!investigation ? (
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 p-5">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Start the investigation</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            The ECFA attaches to this incident&apos;s investigation. Begin one to start charting.
          </p>
          <button type="button" disabled={busy} onClick={() => void begin()}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-brand-navy text-white px-3 py-1.5 text-xs font-semibold hover:bg-brand-navy/90 disabled:opacity-50">
            <Play className="h-3.5 w-3.5" /> Begin investigation
          </button>
        </section>
      ) : (
        tenant?.id && (
          <EcfaBoard
            incidentId={id}
            tenantId={tenant.id}
            isAdmin={isAdmin}
            readOnly={!!investigation.completed_at}
          />
        )
      )}
    </div>
  )
}
