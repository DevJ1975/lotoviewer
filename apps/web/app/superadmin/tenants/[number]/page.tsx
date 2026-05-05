'use client'

import Link from 'next/link'
import { use, useCallback, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTenant } from '@/components/TenantProvider'
import { superadminJson } from '@/lib/superadminFetch'
import type { Tenant } from '@soteria/core/types'
import { LogoUploader }      from './_components/LogoUploader'
import { EditTenantForm }    from './_components/EditTenantForm'
import { MembersSection }    from './_components/MembersSection'
import { ResetDemoSection }  from './_components/ResetDemoSection'
import type { MemberRow }    from './_components/types'

// Tenant edit page. Composes the sub-sections in _components/. Each
// section owns its own API plumbing; the page only handles the initial
// load + propagating tenant updates back to the active-tenant cache.

export default function SuperadminTenantDetail({
  params,
}: { params: Promise<{ number: string }> }) {
  const { number } = use(params)
  const { refresh: refreshActiveTenant } = useTenant()

  const [tenant,  setTenant]  = useState<Tenant | null>(null)
  const [members, setMembers] = useState<MemberRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null)
    const { data: tRow, error: tErr } = await supabase
      .from('tenants')
      .select('*')
      .eq('tenant_number', number)
      .maybeSingle()
    if (tErr || !tRow) {
      setLoadError(tErr?.message ?? `No tenant with number ${number}`)
      setLoading(false)
      return
    }
    setTenant(tRow as Tenant)

    // Members: enriched fetch via the superadmin API. The route joins
    // auth.users for last_sign_in_at so the UI can show invite status.
    const result = await superadminJson<{ members: MemberRow[] }>(
      `/api/superadmin/tenants/${number}/members`,
      { method: 'GET' },
    )
    setMembers(result.ok && result.body ? result.body.members : [])
    setLoading(false)
  }, [number])

  useEffect(() => { void load() }, [load])

  // Propagate any tenant edit back to the active-tenant cache so the
  // header pill / drawer modules pick up the change immediately when
  // the edited tenant is one the current user belongs to.
  function onTenantChanged(next: Tenant) {
    setTenant(next)
    void refreshActiveTenant()
  }

  if (loading) {
    return (
      <div className="py-16 flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }
  if (loadError || !tenant) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
        <Link href="/superadmin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
          <ArrowLeft className="h-3.5 w-3.5" /> All tenants
        </Link>
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{loadError ?? 'Not found'}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
      <Link href="/superadmin/tenants" className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4">
        <ArrowLeft className="h-3.5 w-3.5" /> All tenants
      </Link>

      <header className="mb-8">
        <p className="font-mono text-sm text-slate-500 dark:text-slate-400">#{tenant.tenant_number}</p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
          {tenant.name}
          {tenant.is_demo && (
            <span className="ml-3 align-middle inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">Demo</span>
          )}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">{tenant.slug}</p>
      </header>

      <LogoUploader
        tenantNumber={number}
        tenant={tenant}
        onChange={onTenantChanged}
      />

      <div className="mt-8">
        <EditTenantForm
          tenantNumber={number}
          tenant={tenant}
          onSaved={onTenantChanged}
        />
      </div>

      <div className="mt-10">
        <MembersSection
          tenantNumber={number}
          members={members}
          reload={load}
        />
      </div>

      {tenant.is_demo && (
        <div className="mt-10">
          <ResetDemoSection
            tenantNumber={number}
            tenantName={tenant.name}
            reload={load}
          />
        </div>
      )}
    </div>
  )
}
