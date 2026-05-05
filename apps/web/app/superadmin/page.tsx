'use client'

import Link from 'next/link'
import { Building2, ArrowRight, BookOpen } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { AllMembersPanel } from './_components/AllMembersPanel'

// Superadmin landing. AuthGate enforces is_superadmin before this renders;
// the env allowlist is enforced server-side by requireSuperadmin() in
// every /api/superadmin/* route.
export default function SuperadminHome() {
  const { profile } = useAuth()

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-brand-yellow font-bold mb-1">
          Superadmin
        </p>
        <h1 className="text-2xl sm:text-3xl font-semibold text-slate-900 dark:text-slate-100">
          Tenant management
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
          Signed in as <span className="font-mono">{profile?.email}</span>.
          Actions here cross tenant boundaries — RLS is bypassed by your
          superadmin role.
        </p>
      </header>

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
        <li>
          <Link
            href="/superadmin/tenants"
            className="block p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-brand-navy dark:hover:border-brand-yellow hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <Building2 className="h-5 w-5 text-brand-navy dark:text-brand-yellow shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    Tenants
                  </h2>
                  <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-brand-navy dark:group-hover:text-brand-yellow transition-colors shrink-0" />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  List, create, and configure tenant organizations and their modules.
                </p>
              </div>
            </div>
          </Link>
        </li>
        <li>
          <Link
            href="/wiki"
            className="block p-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 hover:border-brand-navy dark:hover:border-brand-yellow hover:shadow-sm transition-all group"
          >
            <div className="flex items-start gap-3">
              <BookOpen className="h-5 w-5 text-brand-navy dark:text-brand-yellow shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    User wiki
                  </h2>
                  <ArrowRight className="h-4 w-4 text-slate-300 dark:text-slate-600 group-hover:text-brand-navy dark:group-hover:text-brand-yellow transition-colors shrink-0" />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                  Per-module FAQs, Do&apos;s &amp; Don&apos;ts, and the wiki-sync update protocol.
                </p>
              </div>
            </div>
          </Link>
        </li>
      </ul>

      <AllMembersPanel />
    </div>
  )
}
