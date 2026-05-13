'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  FileText,
  Loader2,
  MapPin,
  Plus,
} from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  HAZARDOUS_WASTE_AREA_LABEL,
  HAZARDOUS_WASTE_CALENDAR,
  HAZARDOUS_WASTE_DOCUMENT_PACKETS,
  daysSinceLastInspection,
  isAreaOverdue,
  type HazardousWasteAreaRow,
  type HazardousWasteInspectionRow,
} from '@soteria/core/hazardousWaste'

// /hazardous-waste — module hub. Phase 1 (this PR) gives the hub real
// data: areas the tenant has registered, the next due walk-throughs,
// the latest inspection findings, and a critical-failure count. The
// static document-packet / calendar-rule catalogs stay for reference
// because Phase 2/3 build out the actual generators.

interface AreaWithLastInspection extends HazardousWasteAreaRow {
  last_inspected_at: string | null
}

export default function HazardousWastePage() {
  const { tenant } = useTenant()
  const { profile } = useAuth()
  const canManageAreas = !!profile?.is_admin || !!profile?.is_superadmin

  const [areas,        setAreas]       = useState<AreaWithLastInspection[] | null>(null)
  const [inspections,  setInspections] = useState<HazardousWasteInspectionRow[] | null>(null)
  const [error,        setError]       = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!tenant?.id) return
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers: Record<string, string> = { 'x-active-tenant': tenant.id }
      if (session?.access_token) headers.authorization = `Bearer ${session.access_token}`

      const [areasRes, insRes] = await Promise.all([
        fetch('/api/hazardous-waste/areas', { headers }),
        fetch('/api/hazardous-waste/inspections?limit=10', { headers }),
      ])
      const areasBody = await areasRes.json()
      const insBody   = await insRes.json()
      if (!areasRes.ok) throw new Error(areasBody.error ?? `HTTP ${areasRes.status}`)
      if (!insRes.ok)   throw new Error(insBody.error   ?? `HTTP ${insRes.status}`)
      setAreas(areasBody.areas ?? [])
      setInspections(insBody.inspections ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tenant?.id])

  useEffect(() => { void load() }, [load])

  const summary = useMemo(() => {
    const now = new Date()
    const active = (areas ?? []).filter(a => !a.archived_at)
    const overdue = active.filter(a => isAreaOverdue(a, a.last_inspected_at, now))
    const sevenDaysAgo = now.getTime() - 7 * 86_400_000
    const recentCritical = (inspections ?? []).filter(i =>
      i.critical_failures > 0 && new Date(i.inspected_at).getTime() >= sevenDaysAgo,
    ).length
    return { activeAreas: active.length, overdueAreas: overdue.length, recentCritical }
  }, [areas, inspections])

  const loading = areas === null || inspections === null

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Hazardous Waste</h1>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
            Track accumulation areas, record inspections, and assemble CUPA / DTSC binder
            evidence. The document and calendar catalogs below are reference for what each
            packet contains — generators arrive in Phase 2.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/manuals/hazardous-waste"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <BookOpen className="h-4 w-4" />
            Open manual
          </Link>
          {canManageAreas && (
            <Link
              href="/hazardous-waste/areas"
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              <MapPin className="h-4 w-4" />
              Manage areas
            </Link>
          )}
          <Link
            href="/hazardous-waste/inspections/new"
            className={
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-white ' +
              (summary.activeAreas === 0
                ? 'bg-slate-300 dark:bg-slate-700 pointer-events-none'
                : 'bg-brand-navy hover:bg-brand-navy/90')
            }
            aria-disabled={summary.activeAreas === 0}
          >
            <Plus className="h-4 w-4" />
            New inspection
          </Link>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryTile
          label="Active areas"
          value={loading ? null : summary.activeAreas}
          accent="text-sky-700 dark:text-sky-300"
          icon={<MapPin className="h-5 w-5" />}
          hint={summary.activeAreas === 0 ? 'No areas yet — add one to start logging walk-throughs.' : 'Accumulation areas this tenant manages.'}
        />
        <SummaryTile
          label="Overdue walk-throughs"
          value={loading ? null : summary.overdueAreas}
          accent="text-amber-700 dark:text-amber-300"
          icon={<CalendarClock className="h-5 w-5" />}
          hint="Past each area's configured cadence."
        />
        <SummaryTile
          label="Critical fails (7d)"
          value={loading ? null : summary.recentCritical}
          accent="text-rose-700 dark:text-rose-300"
          icon={<AlertTriangle className="h-5 w-5" />}
          hint="Inspections with at least one critical-fail finding."
        />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <AreaList areas={areas ?? []} loading={loading} canManageAreas={canManageAreas} />
        <RecentInspections inspections={inspections ?? []} areas={areas ?? []} loading={loading} />
      </section>

      <section className="rounded-lg border border-slate-200 dark:border-slate-800 p-5">
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-emerald-100 p-2 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            <ClipboardCheck className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">How the data layer works</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Phase 1 persists inspections to the server with full audit history. Any tenant
              member can submit a walk-through; only admins can add or archive accumulation
              areas. Critical-fail findings come straight from the static catalog so a client
              can't downgrade a regulator-relevant item by editing the request.
            </p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-2">
            <FileText className="h-4 w-4" /> Record Packets (Phase 2)
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_DOCUMENT_PACKETS.map(packet => (
              <div key={packet.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{packet.title}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{packet.systemOutput}</p>
                <p className="mt-2 text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  {packet.caution}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-2">
            <CalendarClock className="h-4 w-4" /> Calendar Foundation (Phase 5)
          </h2>
          <div className="space-y-2">
            {HAZARDOUS_WASTE_CALENDAR.map(item => (
              <div key={item.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
                <h3 className="font-semibold text-slate-900 dark:text-slate-100">{item.title}</h3>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.dueRule}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}

function SummaryTile({
  label, value, accent, icon, hint,
}: {
  label: string
  value: number | null
  accent: string
  icon: React.ReactNode
  hint:  string
}) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
      <div className={`flex items-center gap-2 ${accent}`}>
        {icon}
        <h2 className="text-sm font-semibold">{label}</h2>
      </div>
      <p className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
        {value === null ? <Loader2 className="h-6 w-6 animate-spin text-slate-400" /> : value}
      </p>
      <p className="text-xs text-slate-500 dark:text-slate-400">{hint}</p>
    </div>
  )
}

function AreaList({
  areas, loading, canManageAreas,
}: {
  areas: AreaWithLastInspection[]
  loading: boolean
  canManageAreas: boolean
}) {
  const now = new Date()
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Accumulation areas</span>
        {canManageAreas && (
          <Link href="/hazardous-waste/areas" className="text-[11px] font-semibold text-brand-navy hover:underline normal-case tracking-normal">
            Manage →
          </Link>
        )}
      </h2>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : areas.filter(a => !a.archived_at).length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No accumulation areas yet.
          {canManageAreas
            ? <> <Link href="/hazardous-waste/areas" className="font-semibold text-brand-navy hover:underline">Add one</Link> to start logging walk-throughs.</>
            : ' Ask a tenant admin to add one.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {areas.filter(a => !a.archived_at).map(area => {
            const days = daysSinceLastInspection(area.last_inspected_at, now)
            const overdue = isAreaOverdue(area, area.last_inspected_at, now)
            return (
              <li key={area.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">{area.name}</h3>
                    <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {HAZARDOUS_WASTE_AREA_LABEL[area.area_type]}
                    </span>
                    {overdue ? (
                      <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                        Due
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Cadence every {area.weekly_cadence_days} day{area.weekly_cadence_days === 1 ? '' : 's'} ·{' '}
                    {days === null ? 'never inspected' : `${days} day${days === 1 ? '' : 's'} since last walk-through`}
                  </p>
                </div>
                <Link
                  href={`/hazardous-waste/inspections/new?area=${encodeURIComponent(area.id)}`}
                  className="text-[11px] font-semibold text-brand-navy hover:underline shrink-0"
                >
                  Inspect →
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function RecentInspections({
  inspections, areas, loading,
}: {
  inspections: HazardousWasteInspectionRow[]
  areas:       AreaWithLastInspection[]
  loading:     boolean
}) {
  const areaName = useMemo(() => {
    const m = new Map<string, string>()
    for (const a of areas) m.set(a.id, a.name)
    return m
  }, [areas])

  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2 flex items-center gap-2">
        <ClipboardList className="h-4 w-4" /> Recent inspections
      </h2>
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
      ) : inspections.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
          No inspections logged yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {inspections.slice(0, 5).map(ins => (
            <li key={ins.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {areaName.get(ins.area_id) ?? '(unknown area)'}
                </span>
                <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                  {formatRelative(ins.inspected_at)}
                </span>
              </div>
              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 flex-wrap">
                <span>{ins.passing_checks}/{ins.total_checks} pass</span>
                {ins.critical_failures > 0 && (
                  <span className="font-semibold text-rose-700 dark:text-rose-300 inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    {ins.critical_failures} critical
                  </span>
                )}
                {ins.observations && (
                  <span className="text-slate-500 dark:text-slate-400 italic truncate max-w-xs">
                    “{ins.observations}”
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 60_000)     return 'just now'
  if (ms < 3_600_000)  return `${Math.floor(ms / 60_000)}m ago`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`
  return `${Math.floor(ms / 86_400_000)}d ago`
}
