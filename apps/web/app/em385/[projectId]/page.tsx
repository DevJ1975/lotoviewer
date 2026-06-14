'use client'

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, AlertTriangle, Loader2, Clock, CalendarClock } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { em385Headers, EM385_STATUS_PILL } from '../_components/client'
import {
  EM385_CATEGORIES,
  EM385_CATEGORY_LABEL,
  EM385_STATUS_LABEL,
  isOverdue,
  isExpiringSoon,
  type Em385ProjectRow,
  type Em385RegisterItemRow,
} from '@soteria/core/em385'
import type { Em385Metrics } from '@soteria/core/em385Metrics'

interface DetailResponse {
  project: Em385ProjectRow
  items:   Em385RegisterItemRow[]
  metrics: Em385Metrics
}

// /em385/[projectId] — Compliance dashboard for one contract: a readiness
// headline, overdue / expiring tiles, and the register grouped by category.

export default function Em385ProjectDetailPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = use(params)
  const { tenant } = useTenant()
  const tenantId = tenant?.id
  const [data, setData] = useState<DetailResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const headers = await em385Headers(tenantId)
      if (!headers) return
      const res = await fetch(`/api/em385/projects/${projectId}`, { headers })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
      setData(body as DetailResponse)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenantId, projectId])

  useEffect(() => { void load() }, [load])

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950/30 dark:text-rose-200">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    )
  }

  const { project, items, metrics } = data
  const now = new Date()

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      <Link href="/em385" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        <ArrowLeft className="h-4 w-4" />
        Back to contracts
      </Link>

      <header>
        <p className="font-mono text-xs text-slate-500 dark:text-slate-400">
          {project.project_number ?? project.contract_number} · EM 385-1-1 ({project.edition})
        </p>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{project.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {project.prime_contractor ? `${project.prime_contractor} · ` : ''}
          {project.location ?? 'No location set'}
          {project.ssho_name ? ` · SSHO: ${project.ssho_name}` : ''}
        </p>
      </header>

      {/* Dashboard tiles */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Tile label="Readiness" value={`${metrics.percentAccepted}%`} hint={`${metrics.accepted}/${metrics.total - metrics.notApplicable} in-scope accepted`} />
        <Tile label="Overdue" value={String(metrics.overdue)} tone={metrics.overdue > 0 ? 'rose' : undefined} icon={<Clock className="h-4 w-4" />} />
        <Tile label="Expiring soon" value={String(metrics.expiringSoon)} tone={metrics.expiringSoon > 0 ? 'amber' : undefined} icon={<CalendarClock className="h-4 w-4" />} />
        <Tile label="Not applicable" value={String(metrics.notApplicable)} />
      </section>

      {/* Register grouped by category */}
      <section className="space-y-5">
        {EM385_CATEGORIES.map(cat => {
          const rows = items.filter(i => i.category === cat)
          if (rows.length === 0) return null
          const cm = metrics.byCategory[cat]
          return (
            <div key={cat} className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
              <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900 px-4 py-2.5">
                <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{EM385_CATEGORY_LABEL[cat]}</h2>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {cm.accepted}/{cm.total} accepted{cm.overdue > 0 ? ` · ${cm.overdue} overdue` : ''}
                </span>
              </div>
              <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-950">
                  {rows.map(item => (
                    <tr key={item.id} className="hover:bg-slate-50 dark:hover:bg-slate-900/60">
                      <td className="px-4 py-2">
                        <Link href={`/em385/${projectId}/items/${item.id}`} className="text-slate-800 dark:text-slate-200 hover:underline">
                          {item.title}
                        </Link>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {isOverdue(item, now) && <Badge tone="rose">Overdue</Badge>}
                          {isExpiringSoon(item, now) && <Badge tone="amber">Expiring soon</Badge>}
                          {item.due_date && <span className="text-[11px] text-slate-400">Due {item.due_date}</span>}
                          {item.expires_at && <span className="text-[11px] text-slate-400">Expires {item.expires_at}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2 whitespace-nowrap text-right">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-semibold ${EM385_STATUS_PILL[item.status]}`}>
                          {EM385_STATUS_LABEL[item.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })}

        {items.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-sm text-slate-500 dark:text-slate-400">
            This contract has no register items.
          </div>
        )}
      </section>
    </div>
  )
}

function Tile({ label, value, hint, tone, icon }: { label: string; value: string; hint?: string; tone?: 'rose' | 'amber'; icon?: React.ReactNode }) {
  const toneCls = tone === 'rose'
    ? 'text-rose-700 dark:text-rose-300'
    : tone === 'amber'
      ? 'text-amber-700 dark:text-amber-300'
      : 'text-slate-900 dark:text-slate-100'
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
        {icon}
      </div>
      <p className={`mt-2 text-3xl font-bold tabular-nums ${toneCls}`}>{value}</p>
      {hint && <p className="text-[11px] text-slate-400 mt-1">{hint}</p>}
    </div>
  )
}

function Badge({ tone, children }: { tone: 'rose' | 'amber'; children: React.ReactNode }) {
  const cls = tone === 'rose'
    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${cls}`}>{children}</span>
}
