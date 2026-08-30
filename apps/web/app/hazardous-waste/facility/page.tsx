'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2, Building2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { useFacility } from '@/components/FacilityProvider'
import { supabase } from '@/lib/supabase'
import {
  EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE,
  type HazardousWasteFacilityProfile,
  type RcraGeneratorCategory,
  type WasteJurisdiction,
} from '@soteria/core/hazardousWaste'

// /hazardous-waste/facility — the facility-level generator profile.
//
// Generator category is determined by the facility's total monthly generation
// across all streams (40 CFR 262.13), so it belongs to the facility, not the
// waste stream. The container aging clock prefers this profile and falls back
// to the stream's own category when it isn't set.

export default function HazardousWasteFacilityProfilePage() {
  const { tenant } = useTenant()
  const { profile: authProfile } = useAuth()
  const { facilityId, facility } = useFacility()
  const canEdit = !!authProfile?.is_admin || !!authProfile?.is_superadmin

  const [profile, setProfile] = useState<HazardousWasteFacilityProfile>(EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)
  const [loaded,  setLoaded]  = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [saved,   setSaved]   = useState(false)
  const [busy,    setBusy]    = useState(false)

  const headers = useCallback(async (json = false) => {
    const { data: { session } } = await supabase.auth.getSession()
    const h: Record<string, string> = { 'x-active-tenant': tenant?.id ?? '' }
    if (facilityId) h['x-active-facility'] = facilityId
    if (session?.access_token) h.authorization = `Bearer ${session.access_token}`
    if (json) h['content-type'] = 'application/json'
    return h
  }, [tenant?.id, facilityId])

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    setLoaded(false)
    try {
      const res = await fetch('/api/hazardous-waste/facility-profile', { headers: await headers() })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setProfile(json.profile ?? EMPTY_HAZARDOUS_WASTE_FACILITY_PROFILE)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [tenant?.id, headers])

  useEffect(() => { void load() }, [load])

  async function save() {
    setBusy(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/hazardous-waste/facility-profile', {
        method: 'PUT',
        headers: await headers(true),
        body: JSON.stringify(profile),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setProfile(json.profile)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const longHaulEligible =
    profile.generator_category === 'sqg' ||
    (profile.generator_category === 'vsqg' && profile.jurisdiction === 'california')

  return (
    <main className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        <Link href="/hazardous-waste" className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <ArrowLeft className="h-3.5 w-3.5" /> Hazardous Waste
        </Link>
      </div>

      <header className="flex items-start gap-3">
        <span className="rounded-md bg-sky-100 p-2 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300">
          <Building2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Facility generator profile</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Generator category is a facility-level determination (40 CFR 262.13) — the total hazardous
            waste this site generates per month across all streams. The container aging clock uses this
            profile, falling back to a stream&apos;s own category when it isn&apos;t set here.
          </p>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
          {error}
        </div>
      )}

      {!facilityId && loaded && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
          You&apos;re viewing all facilities. Pick a single facility in the header to view or edit its
          generator profile.
        </div>
      )}

      {!loaded ? (
        <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
      ) : facilityId ? (
        <form
          onSubmit={e => { e.preventDefault(); void save() }}
          className="space-y-4 rounded-lg border border-slate-200 dark:border-slate-800 p-5"
        >
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Facility: <span className="font-semibold text-slate-700 dark:text-slate-200">{facility?.name ?? '—'}</span>
          </p>

          <Field label="Generator category" hint="Determined by total monthly generation across all streams">
            <select
              value={profile.generator_category ?? ''}
              onChange={e => setProfile(p => ({ ...p, generator_category: (e.target.value || null) as RcraGeneratorCategory | null }))}
              disabled={!canEdit}
              className={inputCls}
            >
              <option value="">(not set — use each stream&apos;s category)</option>
              <option value="lqg">LQG — 90-day accumulation</option>
              <option value="sqg">SQG — 180-day accumulation</option>
              <option value="vsqg">VSQG</option>
            </select>
          </Field>

          <Field label="Jurisdiction" hint="California holds a VSQG to the SQG limit (no VSQG exemption)">
            <select
              value={profile.jurisdiction ?? ''}
              onChange={e => setProfile(p => ({ ...p, jurisdiction: (e.target.value || null) as WasteJurisdiction | null }))}
              disabled={!canEdit}
              className={inputCls}
            >
              <option value="">(not set — use each stream&apos;s jurisdiction)</option>
              <option value="california">California (DTSC / 22 CCR)</option>
              <option value="federal">Federal only (40 CFR)</option>
            </select>
          </Field>

          <Field label="EPA ID number" hint="Site identification number, e.g. CAL000123456">
            <input
              value={profile.epa_id_number ?? ''}
              onChange={e => setProfile(p => ({ ...p, epa_id_number: e.target.value || null }))}
              maxLength={40}
              disabled={!canEdit}
              className={inputCls}
            />
          </Field>

          {longHaulEligible && (
            <Field label="TSDF distance" hint=">200 mi extends the accumulation limit to 270 days">
              <label className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input
                  type="checkbox"
                  checked={profile.long_haul_default}
                  onChange={e => setProfile(p => ({ ...p, long_haul_default: e.target.checked }))}
                  disabled={!canEdit}
                />
                Long-haul (&gt;200 mi) by default
              </label>
            </Field>
          )}

          {canEdit ? (
            <div className="flex items-center gap-3 pt-1">
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-md bg-brand-navy px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy/90 disabled:opacity-60"
              >
                {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                Save profile
              </button>
              {saved && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved.</span>}
            </div>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400">Only a tenant admin can edit this profile.</p>
          )}
        </form>
      ) : null}
    </main>
  )
}

const inputCls =
  'w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy/60 disabled:opacity-60'

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  )
}
