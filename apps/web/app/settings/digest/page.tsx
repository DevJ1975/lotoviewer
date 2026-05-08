'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { supabase } from '@/lib/supabase'
import {
  getDigestPreferences, setDigestPreference,
  type DigestCadence, type DigestPreference,
} from '@/lib/safetyBoards/client'

// User-level digest preferences page. Lists every tenant the user
// belongs to and lets them set a per-tenant cadence (off / daily /
// weekly). Per-tenant because users with multi-tenant access often
// want different rhythms (active customer = daily, archived demo
// tenant = off).

interface TenantRow { id: string; name: string }

export default function DigestSettingsPage() {
  const { profile, loading: authLoading } = useAuth()
  const [tenants, setTenants] = useState<TenantRow[]>([])
  const [prefs, setPrefs] = useState<DigestPreference[]>([])
  const [loading, setLoading] = useState(true)
  const [savingFor, setSavingFor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading) return
    if (!profile) return
    void (async () => {
      try {
        const [{ data: mems }, p] = await Promise.all([
          supabase
            .from('tenant_memberships')
            .select('tenant_id, tenants:tenants!inner(id, name)')
            .eq('user_id', profile.id),
          getDigestPreferences(),
        ])
        type Row = { tenant_id: string; tenants: { id: string; name: string } | { id: string; name: string }[] | null }
        const list: TenantRow[] = ((mems as Row[] | null) ?? []).map(m => {
          const t = Array.isArray(m.tenants) ? m.tenants[0] : m.tenants
          return { id: t?.id ?? m.tenant_id, name: t?.name ?? m.tenant_id }
        })
        setTenants(list)
        setPrefs(p)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally { setLoading(false) }
    })()
  }, [authLoading, profile])

  async function update(tenantId: string, cadence: DigestCadence) {
    setSavingFor(tenantId); setError(null)
    try {
      await setDigestPreference(tenantId, cadence)
      setPrefs(prev => {
        const idx = prev.findIndex(p => p.tenant_id === tenantId)
        if (idx === -1) return [...prev, { tenant_id: tenantId, cadence, last_sent_at: null }]
        const copy = prev.slice()
        copy[idx] = { ...copy[idx], cadence }
        return copy
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSavingFor(null) }
  }

  if (loading || authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }

  return (
    <div className="max-w-2xl mx-auto p-4 sm:p-6 space-y-5">
      <Link href="/welcome" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" /> Back
      </Link>
      <header>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Email digests</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Get a periodic email roundup of safety-board activity. Pick a
          cadence per tenant. Empty windows are skipped — we won&apos;t
          send a digest with nothing in it.
        </p>
      </header>

      {error && <p className="text-sm text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 rounded-lg px-3 py-2">{error}</p>}

      <ul className="rounded-2xl ring-1 ring-slate-200 dark:ring-slate-700 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
        {tenants.length === 0 && (
          <li className="p-4 text-sm text-slate-500 dark:text-slate-400">You&apos;re not a member of any tenant.</li>
        )}
        {tenants.map(t => {
          const cadence = prefs.find(p => p.tenant_id === t.id)?.cadence ?? 'off'
          return (
            <li key={t.id} className="p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-slate-900 dark:text-slate-100 truncate">{t.name}</div>
                {prefs.find(p => p.tenant_id === t.id)?.last_sent_at && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    last sent {new Date(prefs.find(p => p.tenant_id === t.id)!.last_sent_at!).toLocaleString()}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {(['off','daily','weekly'] as DigestCadence[]).map(c => (
                  <button
                    type="button"
                    key={c}
                    onClick={() => void update(t.id, c)}
                    disabled={savingFor === t.id}
                    className={
                      'rounded-lg px-3 py-1 text-xs font-medium ring-1 ' +
                      (cadence === c
                        ? 'bg-brand-navy text-white ring-brand-navy'
                        : 'ring-slate-200 dark:ring-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800')
                    }
                  >
                    {c}
                  </button>
                ))}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
