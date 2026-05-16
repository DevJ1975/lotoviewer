'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Archive, Loader2, Lock, Plus, Unlock } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import { DEFAULT_RETENTION_POLICY, type RetentionPolicy } from '@soteria/core/retentionPolicy'

// /admin/retention — surfaces the per-tenant retention policy and the
// register of legal holds. Admins can edit policy values and place or
// release holds with a required reason.
//
// This module classifies + surfaces only. Deletion is a future cron;
// today an "eligible for purge" record just shows up in the report.

type HoldScope = 'incident' | 'permit' | 'equipment' | 'chemical' | 'all'

const HOLD_SCOPE_LABELS: Record<HoldScope, string> = {
  incident:  'Incidents',
  permit:    'Permits (LOTO / hot work / confined space)',
  equipment: 'Equipment',
  chemical:  'Chemicals',
  all:       'All record types',
}

interface PolicyRow {
  tenant_id:                     string
  incident_retention_days:       number
  permit_retention_days:         number
  training_retention_days:       number
  loto_artifact_retention_years: number
  updated_at:                    string
}

interface HoldRow {
  id:                   string
  scope:                HoldScope
  scope_id:             string | null
  reason:               string
  placed_at:            string
  released_at:          string | null
  placed_by_user_id:    string
  released_by_user_id:  string | null
}

export default function RetentionPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [policy,  setPolicy]  = useState<PolicyRow | null>(null)
  const [holds,   setHolds]   = useState<HoldRow[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving,  setSaving]  = useState(false)

  // Local form mirror for the policy fields.
  const [draftIncident, setDraftIncident] = useState<number>(DEFAULT_RETENTION_POLICY.incident_retention_days)
  const [draftPermit,   setDraftPermit]   = useState<number>(DEFAULT_RETENTION_POLICY.permit_retention_days)
  const [draftTraining, setDraftTraining] = useState<number>(DEFAULT_RETENTION_POLICY.training_retention_days)
  const [draftLoto,     setDraftLoto]     = useState<number>(DEFAULT_RETENTION_POLICY.loto_artifact_retention_years)

  // New-hold form state.
  const [newScope,    setNewScope]    = useState<HoldScope>('all')
  const [newScopeId,  setNewScopeId]  = useState<string>('')
  const [newReason,   setNewReason]   = useState<string>('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      const [policyRes, holdsRes] = await Promise.all([
        supabase
          .from('tenant_retention_policies')
          .select('*')
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        supabase
          .from('legal_holds')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('placed_at', { ascending: false })
          .limit(200),
      ])
      if (policyRes.error) throw new Error(formatSupabaseError(policyRes.error, 'load retention policy'))
      if (holdsRes.error)  throw new Error(formatSupabaseError(holdsRes.error,  'load legal holds'))

      const row = (policyRes.data as PolicyRow | null) ?? null
      // Tenants seeded before this migration may not have a row yet;
      // fall back to the defaults so the form still renders.
      const effective: PolicyRow = row ?? {
        tenant_id: tenantId,
        incident_retention_days:       DEFAULT_RETENTION_POLICY.incident_retention_days,
        permit_retention_days:         DEFAULT_RETENTION_POLICY.permit_retention_days,
        training_retention_days:       DEFAULT_RETENTION_POLICY.training_retention_days,
        loto_artifact_retention_years: DEFAULT_RETENTION_POLICY.loto_artifact_retention_years,
        updated_at: new Date().toISOString(),
      }
      setPolicy(effective)
      setDraftIncident(effective.incident_retention_days)
      setDraftPermit(effective.permit_retention_days)
      setDraftTraining(effective.training_retention_days)
      setDraftLoto(effective.loto_artifact_retention_years)
      setHolds((holdsRes.data ?? []) as HoldRow[])
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load retention settings.')
    }
  }, [tenantId])

  useEffect(() => {
    if (!authLoading && profile?.is_admin) void load()
  }, [authLoading, profile, load])

  const dirty = useMemo(() => {
    if (!policy) return false
    return draftIncident !== policy.incident_retention_days
        || draftPermit   !== policy.permit_retention_days
        || draftTraining !== policy.training_retention_days
        || draftLoto     !== policy.loto_artifact_retention_years
  }, [policy, draftIncident, draftPermit, draftTraining, draftLoto])

  async function savePolicy() {
    if (!tenantId || !dirty) return
    setSaving(true)
    setLoadError(null)
    try {
      const update: Partial<PolicyRow> = {
        incident_retention_days:       draftIncident,
        permit_retention_days:         draftPermit,
        training_retention_days:       draftTraining,
        loto_artifact_retention_years: draftLoto,
      }
      const { error } = await supabase
        .from('tenant_retention_policies')
        .upsert({ tenant_id: tenantId, ...update })
      if (error) throw new Error(formatSupabaseError(error, 'save retention policy'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not save policy.')
    } finally {
      setSaving(false)
    }
  }

  async function placeHold() {
    if (!tenantId || !newReason.trim() || saving) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoadError('You must be signed in to place a hold.')
      return
    }
    setSaving(true)
    setLoadError(null)
    try {
      const { error } = await supabase
        .from('legal_holds')
        .insert({
          tenant_id:           tenantId,
          scope:               newScope,
          scope_id:            newScopeId.trim() || null,
          reason:              newReason.trim(),
          placed_by_user_id:   user.id,
        })
      if (error) throw new Error(formatSupabaseError(error, 'place legal hold'))
      setNewReason('')
      setNewScopeId('')
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not place hold.')
    } finally {
      setSaving(false)
    }
  }

  async function releaseHold(holdId: string) {
    if (!tenantId || saving) return
    if (!confirm('Release this legal hold? Affected records will become subject to the retention policy again.')) return
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      setLoadError('You must be signed in to release a hold.')
      return
    }
    setSaving(true)
    setLoadError(null)
    try {
      const { error } = await supabase
        .from('legal_holds')
        .update({
          released_at:         new Date().toISOString(),
          released_by_user_id: user.id,
        })
        .eq('id', holdId)
        .eq('tenant_id', tenantId)
      if (error) throw new Error(formatSupabaseError(error, 'release legal hold'))
      await load()
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not release hold.')
    } finally {
      setSaving(false)
    }
  }

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (!profile?.is_admin) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">
        Admins only.
      </div>
    )
  }

  const openHolds  = holds.filter(h => !h.released_at)
  const closedHolds = holds.filter(h => !!h.released_at)

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <div>
        <Link href="/" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <Archive className="h-6 w-6 text-brand-navy" />
          Data retention and legal holds
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Retention windows per record type — 29 CFR 1904.33 mandates 5 years for OSHA 300 logs; LOTO artifacts default to 7 years.
          A legal hold trumps every retention window: held records are never purged until the hold is released.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      {/* Policy editor */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <header>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Retention policy
          </h2>
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
            Values are minimums — actual deletion runs through a future cron.
          </p>
        </header>
        {policy === null ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldNumber
                label="Incident retention (days)"
                hint="OSHA 1904.33 — 5 years (1825 days)"
                value={draftIncident}
                onChange={setDraftIncident}
              />
              <FieldNumber
                label="Permit retention (days)"
                hint="LOTO, hot work, confined space — recommended 3 years (1095 days)"
                value={draftPermit}
                onChange={setDraftPermit}
              />
              <FieldNumber
                label="Training retention (days)"
                hint="§1910.147(c)(7)(iv) — keep while employee is authorized; 3 years (1095 days) default"
                value={draftTraining}
                onChange={setDraftTraining}
              />
              <FieldNumber
                label="LOTO artifact retention (years)"
                hint="Procedure / placard binders — 7 years aligns with general-industry recordkeeping"
                value={draftLoto}
                onChange={setDraftLoto}
              />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={savePolicy}
                disabled={!dirty || saving}
                className="px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold disabled:opacity-40 hover:bg-brand-navy/90"
              >
                {saving ? 'Saving…' : 'Save policy'}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Place hold */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 space-y-4">
        <header>
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Plus className="h-3.5 w-3.5" />
            Place a new legal hold
          </h2>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Scope</span>
            <select
              value={newScope}
              onChange={e => setNewScope(e.target.value as HoldScope)}
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            >
              {(Object.keys(HOLD_SCOPE_LABELS) as HoldScope[]).map(s => (
                <option key={s} value={s}>{HOLD_SCOPE_LABELS[s]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Record ID (optional)</span>
            <input
              type="text"
              value={newScopeId}
              onChange={e => setNewScopeId(e.target.value)}
              placeholder="Leave empty to hold the whole scope"
              className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Reason (required)</span>
          <textarea
            value={newReason}
            onChange={e => setNewReason(e.target.value)}
            rows={2}
            placeholder="Why are these records being held?"
            className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={placeHold}
            disabled={!newReason.trim() || saving}
            className="px-4 py-2 rounded-lg bg-rose-700 text-white text-sm font-semibold disabled:opacity-40 hover:bg-rose-800 flex items-center gap-2"
          >
            <Lock className="h-4 w-4" />
            Place hold
          </button>
        </div>
      </section>

      {/* Active holds */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5">
        <header className="mb-3">
          <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Active legal holds ({openHolds.length})
          </h2>
        </header>
        {openHolds.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No active holds.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {openHolds.map(h => (
              <li key={h.id} className="py-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                      {HOLD_SCOPE_LABELS[h.scope]}
                    </span>
                    {h.scope_id && (
                      <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400 truncate">
                        {h.scope_id}
                      </span>
                    )}
                    <span className="text-[10px] text-slate-400 tabular-nums">
                      placed {new Date(h.placed_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{h.reason}</p>
                </div>
                <button
                  type="button"
                  onClick={() => releaseHold(h.id)}
                  disabled={saving}
                  className="shrink-0 px-3 py-1.5 rounded-md text-xs font-semibold border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 flex items-center gap-1"
                >
                  <Unlock className="h-3 w-3" />
                  Release
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Closed holds — historical */}
      {closedHolds.length > 0 && (
        <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 p-5">
          <header className="mb-3">
            <h2 className="text-xs font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Released holds ({closedHolds.length})
            </h2>
          </header>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {closedHolds.map(h => (
              <li key={h.id} className="py-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                    {HOLD_SCOPE_LABELS[h.scope]}
                  </span>
                  {h.scope_id && (
                    <span className="font-mono text-[11px] text-slate-500 dark:text-slate-400">{h.scope_id}</span>
                  )}
                  <span className="text-[10px] text-slate-400 tabular-nums">
                    {new Date(h.placed_at).toLocaleDateString()} → {h.released_at ? new Date(h.released_at).toLocaleDateString() : '—'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400 italic whitespace-pre-wrap">{h.reason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function FieldNumber({
  label, hint, value, onChange,
}: {
  label: string
  hint: string
  value: number
  onChange: (n: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        onChange={e => {
          const n = Number(e.target.value)
          if (Number.isFinite(n) && n >= 0) onChange(Math.floor(n))
        }}
        className="mt-1 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
      />
      <span className="text-[10px] text-slate-400">{hint}</span>
    </label>
  )
}
