'use client'

import Link from 'next/link'
import { Camera, FileText, Plus } from 'lucide-react'
import { isModuleVisible } from '@soteria/core/moduleVisibility'
import { useTenant } from '@/components/TenantProvider'

// Three most common workflows. Sized for an iPad on a stand — 44pt+ tap
// targets, big icons. Each tile is gated on the underlying module being
// visible for the active tenant; if none are visible the row collapses
// to nothing instead of leaving dead links.

interface ActionDef {
  moduleId: string
  href:     string
  icon:     React.ReactNode
  label:    string
  sub:      string
}

const ACTIONS: ActionDef[] = [
  { moduleId: 'confined-spaces', href: '/confined-spaces', icon: <FileText className="h-6 w-6" />, label: 'Issue Permit',   sub: 'Confined-space entry' },
  { moduleId: 'loto',            href: '/loto',            icon: <Plus className="h-6 w-6" />,     label: 'Add Equipment', sub: 'LOTO inventory' },
  { moduleId: 'loto',            href: '/loto',            icon: <Camera className="h-6 w-6" />,   label: 'Take Photo',    sub: 'Pick equipment first' },
]

export function QuickActions() {
  const { tenant } = useTenant()
  const visible = ACTIONS.filter(a => isModuleVisible(a.moduleId, tenant?.modules))
  if (visible.length === 0) return null
  return (
    <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {visible.map((a, i) => (
        <QuickAction key={i} href={a.href} icon={a.icon} label={a.label} sub={a.sub} />
      ))}
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
