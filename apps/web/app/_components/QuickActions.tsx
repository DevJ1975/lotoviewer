'use client'

import Link from 'next/link'
import { Camera, FileText, Plus } from 'lucide-react'

// 3 most common workflows. Sized for an iPad on a stand — 44pt+ tap
// targets, big icons. Keep to 3 so each tile gets 33% of the row.

export function QuickActions() {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <QuickAction
        href="/confined-spaces"
        icon={<FileText className="h-6 w-6" />}
        label="Issue Permit"
        sub="Confined-space entry"
      />
      <QuickAction
        href="/loto"
        icon={<Plus className="h-6 w-6" />}
        label="Add Equipment"
        sub="LOTO inventory"
      />
      <QuickAction
        href="/loto"
        icon={<Camera className="h-6 w-6" />}
        label="Take Photo"
        sub="Pick equipment first"
      />
    </section>
  )
}

function QuickAction({ href, icon, label, sub }: { href: string; icon: React.ReactNode; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-brand-navy hover:shadow-sm rounded-xl px-4 py-4 flex items-center gap-3 transition-all group"
    >
      <div className="shrink-0 w-11 h-11 rounded-lg bg-brand-navy/5 dark:bg-brand-navy/30 group-hover:bg-brand-navy/10 dark:group-hover:bg-brand-navy/40 text-brand-navy dark:text-brand-yellow flex items-center justify-center transition-colors">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-bold text-slate-900 dark:text-slate-100 group-hover:text-brand-navy transition-colors">{label}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">{sub}</p>
      </div>
    </Link>
  )
}
