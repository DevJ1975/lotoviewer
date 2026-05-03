'use client'

import Link from 'next/link'
import { ArrowLeft, Construction } from 'lucide-react'

// Stub until slice 6.2. The form lives here; the create action will POST
// to /api/superadmin/tenants which uses requireSuperadmin() server-side.
export default function NewTenantPage() {
  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6 py-12">
      <Link
        href="/superadmin/tenants"
        className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 transition-colors mb-6"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All tenants
      </Link>

      <div className="text-center py-12">
        <Construction className="h-12 w-12 text-slate-300 dark:text-slate-600 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
          New-tenant form coming in slice 6.2
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          For now, create tenants via SQL using the pattern in <span className="font-mono">migrations/028</span>.
          The next allocated number will be <span className="font-mono">#0003</span>
          (or whatever <span className="font-mono">next_tenant_number()</span> returns).
        </p>
      </div>
    </div>
  )
}
