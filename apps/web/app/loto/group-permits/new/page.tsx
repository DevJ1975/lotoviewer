'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { Equipment } from '@soteria/core/types'

// /loto/group-permits/new — start a §147(f)(3) group lockout permit.
//
// Required fields: work description and the primary authorized employee.
// Equipment selection is optional (group locks frequently apply to bays
// not in the loto_equipment registry).

interface ProfileLite {
  id: string
  email: string | null
  full_name: string | null
}

export default function NewGroupPermitPage() {
  const router = useRouter()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [equipment, setEquipment] = useState<Equipment[]>([])
  const [tenantProfiles, setTenantProfiles] = useState<ProfileLite[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const [workDescription, setWorkDescription] = useState('')
  const [primaryUserId, setPrimaryUserId] = useState('')
  const [equipmentSelection, setEquipmentSelection] = useState<Set<string>>(new Set())
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setLoadError(null)
    try {
      // Pull profiles + equipment in parallel. tenant_memberships drives
      // who can be a primary: the picker only shows users currently
      // attached to the active tenant.
      const [memResult, eqResult] = await Promise.all([
        supabase
          .from('tenant_memberships')
          .select('user_id, profiles:user_id (id, email, full_name)')
          .eq('tenant_id', tenantId),
        supabase
          .from('loto_equipment')
          .select('*')
          .eq('tenant_id', tenantId)
          .eq('decommissioned', false)
          .order('equipment_id', { ascending: true }),
      ])
      if (memResult.error) throw new Error(formatSupabaseError(memResult.error, 'load tenant members'))
      if (eqResult.error) throw new Error(formatSupabaseError(eqResult.error, 'load equipment'))

      const profiles: ProfileLite[] = []
      for (const row of (memResult.data ?? []) as Array<{ profiles: ProfileLite | ProfileLite[] | null }>) {
        const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        if (p) profiles.push(p)
      }
      profiles.sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''))
      setTenantProfiles(profiles)
      setEquipment((eqResult.data ?? []) as Equipment[])

      // Default the primary to the signed-in user since most permits
      // are created by the same admin who runs the crew.
      if (profile && !primaryUserId) setPrimaryUserId(profile.id)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load form data.')
    }
  }, [tenantId, profile, primaryUserId])

  useEffect(() => { if (!authLoading) load() }, [authLoading, load])

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }

  function toggleEquipment(id: string) {
    setEquipmentSelection(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (!tenantId) return
    setSubmitError(null)
    if (!workDescription.trim()) { setSubmitError('Work description is required.'); return }
    if (!primaryUserId) { setSubmitError('Pick a primary authorized employee.'); return }
    setSubmitting(true)
    try {
      const { data, error } = await supabase
        .from('loto_group_permits')
        .insert({
          tenant_id:                       tenantId,
          primary_authorized_employee_id:  primaryUserId,
          work_description:                workDescription.trim(),
          equipment_ids:                   [...equipmentSelection],
        })
        .select('id')
        .single()
      if (error) throw new Error(formatSupabaseError(error, 'create group permit'))
      router.push(`/loto/group-permits/${data!.id}`)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Could not create permit.')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/loto/group-permits" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to group permits
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100">New group LOTO permit</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          §1910.147(f)(3) — opens a group lockout. The primary authorized
          employee carries overall accountability; members attach personal
          locks on the next screen.
        </p>
      </div>

      {loadError && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {loadError}
        </div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Work description</span>
          <input
            type="text"
            value={workDescription}
            onChange={e => setWorkDescription(e.target.value)}
            disabled={submitting}
            placeholder="Replace bearing assembly on line 3 conveyor"
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          />
        </label>

        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Primary authorized employee</span>
          <select
            value={primaryUserId}
            onChange={e => setPrimaryUserId(e.target.value)}
            disabled={submitting}
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20 focus:border-brand-navy"
          >
            <option value="">— pick a primary —</option>
            {tenantProfiles.map(p => (
              <option key={p.id} value={p.id}>
                {p.full_name ?? p.email ?? p.id.slice(0, 8)}
              </option>
            ))}
          </select>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
            §147(f)(3)(ii)(A). Can be reassigned during a shift change.
          </p>
        </label>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Equipment scope (optional)</span>
          <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
            Leave empty if the lockout applies to a bay or circuit not
            in the equipment registry.
          </p>
          <div className="mt-2 max-h-48 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-md divide-y divide-slate-100 dark:divide-slate-800">
            {equipment.length === 0 ? (
              <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400 italic">No active equipment in this tenant.</p>
            ) : (
              equipment.map(eq => (
                <label key={eq.equipment_id} className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40">
                  <input
                    type="checkbox"
                    checked={equipmentSelection.has(eq.equipment_id)}
                    onChange={() => toggleEquipment(eq.equipment_id)}
                    disabled={submitting}
                    className="h-4 w-4 rounded border-slate-300 text-brand-navy focus:ring-brand-navy/30"
                  />
                  <span className="text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-mono">{eq.equipment_id}</span> · {eq.description}
                  </span>
                </label>
              ))
            )}
          </div>
        </div>

        {submitError && (
          <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
            {submitError}
          </div>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={submitting}
          className="w-full rounded-lg bg-brand-navy text-white text-sm font-semibold py-2.5 disabled:opacity-40 hover:bg-brand-navy/90 transition-colors"
        >
          {submitting ? 'Creating…' : 'Create group permit'}
        </button>
      </section>
    </div>
  )
}
