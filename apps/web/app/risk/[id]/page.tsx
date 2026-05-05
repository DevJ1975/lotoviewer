'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { useAuth } from '@/components/AuthProvider'
import { readRiskConfig } from '@soteria/core/risk'
import RiskScoreCard from '../_components/RiskScoreCard'
import ControlsTable from '../_components/ControlsTable'
import ReviewsTable from '../_components/ReviewsTable'
import AuditTimeline from '../_components/AuditTimeline'
import RiskQuickActions from '../_components/RiskQuickActions'
import type { RiskDetailBundle } from '@soteria/core/queries/risks'

// /risk/[id] — read-mostly detail page. Sections (top → bottom):
//   1. Header (risk_number + title + status pill).
//   2. Score card (inherent + residual side-by-side).
//   3. Meta block (category, source, location, owner, etc.).
//   4. Description.
//   5. Controls table.
//   6. Reviews table.
//   7. Audit timeline (last 20 events).
//   8. Quick actions (admin only).

export default function RiskDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { tenant } = useTenant()
  const { profile } = useAuth()

  const [bundle, setBundle] = useState<RiskDetailBundle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const config = useMemo(() => readRiskConfig(tenant?.settings ?? null), [tenant?.settings])

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = {}
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`
      if (tenant?.id)            headers['x-active-tenant'] = tenant.id

      const res = await fetch(`/api/risk/${id}`, { headers })
      const body = await res.json()
      if (res.status === 404) { setBundle(null); return }
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setBundle(body as RiskDetailBundle)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id, tenant?.id])

  useEffect(() => { void fetchData() }, [fetchData])

  // is_admin from the profiles row (legacy single-tenant flag) is
  // good enough for the slice 2 quick actions; the API enforces
  // tenant-membership role anyway.
  const canEdit = !!profile?.is_admin || !!profile?.is_superadmin

  if (loading) return <FullPageSpinner />
  if (error)   return <ErrorScreen message={error} />
  if (!bundle) return <NotFoundScreen />

  const { risk, controls, reviews, audit } = bundle

  return (
    <main className="max-w-5xl mx-auto px-4 py-6 space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/risk/list"
            className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-100"
          >
            <ArrowLeft className="h-3 w-3" /> Risk register
          </Link>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-1">
            <span className="font-mono text-base text-slate-500 dark:text-slate-400 mr-2">{risk.risk_number}</span>
            {risk.title}
          </h1>
        </div>
        <RiskQuickActions
          riskId={risk.id}
          currentStatus={risk.status}
          canEdit={canEdit}
        />
      </header>

      <RiskScoreCard
        inherent={{
          severity:   risk.inherent_severity,
          likelihood: risk.inherent_likelihood,
          score:      risk.inherent_score,
          band:       risk.inherent_band,
        }}
        residual={{
          severity:   risk.residual_severity,
          likelihood: risk.residual_likelihood,
          score:      risk.residual_score,
          band:       risk.residual_band,
        }}
        bandScheme={config.bandScheme}
        acceptanceThreshold={config.acceptanceThreshold}
      />

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-3">
          Risk details
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <Field label="Hazard category">{risk.hazard_category}</Field>
          <Field label="Source">{risk.source}</Field>
          <Field label="Activity type">{risk.activity_type}</Field>
          <Field label="Exposure frequency">{risk.exposure_frequency}</Field>
          <Field label="Location">{risk.location ?? '—'}</Field>
          <Field label="Process">{risk.process ?? '—'}</Field>
          <Field label="Owner">{risk.assigned_to ?? '—'}</Field>
          <Field label="Reviewer">{risk.reviewer ?? '—'}</Field>
          <Field label="Approver">{risk.approver ?? '—'}</Field>
          <Field label="Next review">{risk.next_review_date ?? '—'}</Field>
        </div>

        <h3 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mt-5 mb-2">
          Description
        </h3>
        <p className="text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap">{risk.description}</p>
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-3">
          Controls (Hierarchy of Controls · ISO 45001 8.1.2)
        </h2>
        <ControlsTable
          controls={controls}
          inherentScore={risk.inherent_score}
          ppeOnlyJustification={risk.ppe_only_justification}
        />
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-3">
          Review history
        </h2>
        <ReviewsTable reviews={reviews} />
      </section>

      <section className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm p-5">
        <h2 className="text-[10px] font-bold tracking-widest uppercase text-slate-500 dark:text-slate-400 mb-3">
          Audit timeline
        </h2>
        <AuditTimeline entries={audit} />
        <p className="text-[10px] text-slate-400 italic mt-3">
          Showing the last {audit.length} events. Audit log is append-only (DB-enforced).
        </p>
      </section>
    </main>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        {label}
      </span>
      <div className="text-slate-800 dark:text-slate-200 capitalize-first">{children}</div>
    </div>
  )
}

function FullPageSpinner() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
    </div>
  )
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center space-y-2">
      <h1 className="text-xl font-bold text-rose-700">Couldn’t load this risk</h1>
      <p className="text-sm text-slate-500">{message}</p>
      <Link href="/risk" className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
        <ArrowLeft className="h-3 w-3" /> Back to heat map
      </Link>
    </main>
  )
}

function NotFoundScreen() {
  return (
    <main className="max-w-2xl mx-auto px-4 py-16 text-center space-y-2">
      <h1 className="text-xl font-bold">Risk not found</h1>
      <p className="text-sm text-slate-500">Either the id is wrong, or this risk lives in a different tenant.</p>
      <Link href="/risk" className="inline-flex items-center gap-1 text-xs text-brand-navy hover:underline">
        <ArrowLeft className="h-3 w-3" /> Back to heat map
      </Link>
    </main>
  )
}
