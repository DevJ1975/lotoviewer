'use client'

import Link from 'next/link'
import { use, useEffect, useState } from 'react'
import { ArrowLeft, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { Tenant } from '@/lib/types'

// Tenant detail / edit page. Slice 6.1 ships a read-only summary so
// clicking a row from the tenants list works end-to-end. Slice 6.3 adds
// the modules editor, logo upload, and members management. Slice 6.4
// adds the Reset Demo button (visible only when is_demo).

export default function SuperadminTenantDetail({ params }: { params: Promise<{ number: string }> }) {
  const { number } = use(params)
  const [tenant, setTenant] = useState<Tenant | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      setLoading(true)
      const { data, error: err } = await supabase
        .from('tenants')
        .select('*')
        .eq('tenant_number', number)
        .maybeSingle()
      if (err)         setError(err.message)
      else if (!data)  setError(`No tenant with number ${number}`)
      else             setTenant(data as Tenant)
      setLoading(false)
    })()
  }, [number])

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <Link
        href="/superadmin/tenants"
        className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-4"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All tenants
      </Link>

      {loading && (
        <div className="py-16 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
        </div>
      )}

      {error && (
        <div className="p-4 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 flex gap-2 items-start">
          <AlertCircle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
          <p className="text-sm text-rose-800 dark:text-rose-200">{error}</p>
        </div>
      )}

      {tenant && (
        <>
          <header className="mb-6">
            <p className="font-mono text-sm text-slate-500 dark:text-slate-400">
              #{tenant.tenant_number}
            </p>
            <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
              {tenant.name}
              {tenant.is_demo && (
                <span className="ml-3 align-middle inline-flex items-center px-2 py-0.5 rounded text-xs font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">
                  Demo
                </span>
              )}
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 font-mono">
              {tenant.slug}
            </p>
          </header>

          <section className="space-y-6">
            <Field label="Status">{tenant.status}</Field>
            <Field label="Created">{new Date(tenant.created_at).toLocaleString()}</Field>
            <Field label="Updated">{new Date(tenant.updated_at).toLocaleString()}</Field>
            <Field label="Modules">
              <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-900/40 rounded p-3 overflow-x-auto">
                {JSON.stringify(tenant.modules, null, 2)}
              </pre>
            </Field>
            <Field label="Settings">
              <pre className="text-xs font-mono bg-slate-50 dark:bg-slate-900/40 rounded p-3 overflow-x-auto">
                {JSON.stringify(tenant.settings, null, 2)}
              </pre>
            </Field>
          </section>

          <p className="mt-8 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
            Editing modules, logo upload, and member management ship in slice 6.3.
            For now use the SQL editor for tenant changes.
          </p>
        </>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xs uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
        {label}
      </h2>
      <div className="text-sm text-slate-800 dark:text-slate-200">{children}</div>
    </div>
  )
}
