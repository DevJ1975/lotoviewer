'use client'

import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowLeft,
  Award,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  Forklift,
  GraduationCap,
  Loader2,
  PackageCheck,
  Scissors,
  ShieldAlert,
  ShieldCheck,
  Trophy,
  UserRoundCog,
  Users,
  Wrench,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import '@/lib/supabase'
import {
  fetchMyReadiness,
  type EquipmentBadgeStatus,
  type MyReadiness,
  type ReadinessTone,
  type RequirementStatus,
  type TrainingRequirementStatus,
} from '@soteria/core/myReadiness'

export default function MySafetyReadinessPage() {
  const [readiness, setReadiness] = useState<MyReadiness | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setReadiness(await fetchMyReadiness())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load readiness')
      setReadiness(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" />
      </div>
    )
  }

  if (error) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <BackLink />
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {error}
        </div>
      </main>
    )
  }

  if (!readiness) {
    return (
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <BackLink />
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
          Sign in to view My Safety Readiness.
        </div>
      </main>
    )
  }

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
      <BackLink />
      <ReadinessHeader readiness={readiness} />
      <PrimaryMobileAction readiness={readiness} />
      <RestrictedFrom items={readiness.restrictions} />
      <RenewalTimeline items={readiness.renewalTimeline} />

      <section className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-5">
        <TrainingMatrixPreview rows={readiness.training} summary={readiness.matrixPlaceholder} />
        <EquipmentBadges rows={readiness.equipmentBadges} />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <AdminEditPath links={readiness.adminLinks} />
        <SupervisorTeam rows={readiness.supervisorTeam} />
      </section>
    </main>
  )
}

function BackLink() {
  return (
    <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-brand-navy dark:text-slate-400 dark:hover:text-brand-yellow">
      <ArrowLeft className="h-4 w-4" />
      Home
    </Link>
  )
}

function ReadinessHeader({ readiness }: { readiness: MyReadiness }) {
  const tone = toneClass(readiness.overallStatus)
  const StatusIcon = readiness.overallStatus === 'ready'
    ? CheckCircle2
    : readiness.overallStatus === 'attention'
      ? Clock
      : ShieldAlert

  return (
    <section className={`rounded-xl border p-5 ${tone.section}`}>
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-5">
        <div className="flex items-start gap-4 min-w-0">
          <Avatar
            src={readiness.profile.avatarUrl}
            name={readiness.profile.fullName}
            email={readiness.profile.email}
            size="xl"
          />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              My Safety Readiness
            </p>
            <h1 className="mt-1 text-2xl font-black text-slate-950 dark:text-slate-50 truncate">
              {readiness.profile.fullName ?? readiness.profile.email ?? 'My profile'}
            </h1>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <InfoPill icon={<BriefcaseBusiness className="h-3.5 w-3.5" />} label={readiness.assignment.positionTitle ?? 'Position not assigned'} />
              <InfoPill icon={<Clock className="h-3.5 w-3.5" />} label={readiness.assignment.shiftLabel ?? 'Shift not assigned'} />
              <InfoPill icon={<CalendarClock className="h-3.5 w-3.5" />} label={readiness.assignment.serviceLabel ? `${readiness.assignment.serviceLabel} service` : 'Service date not set'} />
            </div>
          </div>
        </div>

        <div className="lg:w-80 rounded-lg border border-white/60 bg-white/70 p-4 dark:border-slate-700 dark:bg-slate-950/40">
          <div className="flex items-center gap-2">
            <StatusIcon className={`h-5 w-5 ${tone.icon}`} />
            <p className="text-sm font-black text-slate-950 dark:text-slate-50">{readiness.readinessLabel}</p>
          </div>
          <p className="mt-2 text-sm leading-snug text-slate-700 dark:text-slate-300">{readiness.nextBestAction}</p>
          <Link
            href={readiness.primaryAction.href}
            className={`mt-4 hidden sm:inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-black ${primaryActionClass(readiness.primaryAction.tone)}`}
          >
            <ShieldCheck className="h-4 w-4" />
            {readiness.primaryAction.label}
          </Link>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <MiniMetric label="Required" value={String(readiness.matrixPlaceholder.requiredTrainingCount)} />
            <MiniMetric label="Current" value={String(readiness.matrixPlaceholder.currentTrainingCount)} />
            <MiniMetric label="Gaps" value={String(readiness.matrixPlaceholder.openGapCount)} />
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Signal icon={<GraduationCap className="h-4 w-4" />} label="Training matrix" value={`${readiness.matrixPlaceholder.currentTrainingCount}/${readiness.matrixPlaceholder.requiredTrainingCount} current`} />
        <Signal icon={<Award className="h-4 w-4" />} label="Equipment badges" value={`${readiness.equipmentBadges.filter(b => b.status === 'current' || b.status === 'due_soon').length}/${readiness.equipmentBadges.length} active`} />
        <Signal icon={<Trophy className="h-4 w-4" />} label="BBS leaderboard" value={readiness.leaderboard.rank ? `#${readiness.leaderboard.rank} · ${readiness.leaderboard.pointsTotal} pts` : 'No rank yet'} />
      </div>
    </section>
  )
}

function PrimaryMobileAction({ readiness }: { readiness: MyReadiness }) {
  return (
    <Link
      href={readiness.primaryAction.href}
      className={`sm:hidden flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-black ${primaryActionClass(readiness.primaryAction.tone)}`}
    >
      <ShieldCheck className="h-4 w-4" />
      {readiness.primaryAction.label}
    </Link>
  )
}

function RestrictedFrom({ items }: { items: MyReadiness['restrictions'] }) {
  if (items.length === 0) {
    return (
      <section id="restrictions" className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 dark:border-emerald-900 dark:bg-emerald-950/20">
        <div className="flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-300" />
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-emerald-700 dark:text-emerald-300">Restricted from</p>
            <h2 className="text-base font-black text-slate-950 dark:text-slate-50">No current work restrictions</h2>
          </div>
        </div>
      </section>
    )
  }

  return (
    <section id="restrictions" className="rounded-xl border border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900 dark:bg-rose-950/20">
      <header className="flex items-center gap-2">
        <ShieldAlert className="h-5 w-5 text-rose-600 dark:text-rose-300" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-rose-700 dark:text-rose-300">Restricted from</p>
          <h2 className="text-base font-black text-slate-950 dark:text-slate-50">{items.length} work restriction{items.length === 1 ? '' : 's'}</h2>
        </div>
      </header>
      <ul className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
        {items.map(item => (
          <li key={item.id} className="rounded-lg border border-rose-200 bg-white/70 p-3 dark:border-rose-900 dark:bg-slate-950/40">
            <p className="text-sm font-black text-slate-950 dark:text-slate-50">{item.label}</p>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{item.reason}</p>
          </li>
        ))}
      </ul>
    </section>
  )
}

function RenewalTimeline({ items }: { items: MyReadiness['renewalTimeline'] }) {
  return (
    <section id="renewals" className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Next 90 days</p>
          <h2 className="text-lg font-black text-slate-950 dark:text-slate-50">Upcoming renewals</h2>
        </div>
        <CalendarClock className="h-5 w-5 text-slate-400" />
      </header>
      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No training or equipment renewals due in the next 90 days.
        </p>
      ) : (
        <ol className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {items.map(item => (
            <li key={item.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-800">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
                {item.kind} · {item.daysUntilDue === 0 ? 'Due today' : `${item.daysUntilDue} days`}
              </p>
              <p className="mt-1 text-sm font-black text-slate-950 dark:text-slate-50">{item.label}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Due {item.dueAt}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function TrainingMatrixPreview({
  rows,
  summary,
}: {
  rows: TrainingRequirementStatus[]
  summary: MyReadiness['matrixPlaceholder']
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Required by position
          </p>
          <h2 className="text-lg font-black text-slate-950 dark:text-slate-50">Training matrix</h2>
        </div>
        <div className="rounded-lg bg-slate-100 px-3 py-2 text-right dark:bg-slate-800">
          <p className="text-lg font-black tabular-nums text-slate-950 dark:text-slate-50">{summary.openGapCount}</p>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Open gaps</p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No position requirements assigned yet.
        </p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <div className="grid grid-cols-[1fr_auto] bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
            <span>Certification</span>
            <span>Status</span>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map(row => (
              <li key={row.id} className="grid grid-cols-[1fr_auto] gap-3 px-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">{row.label}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {row.completedAt ? `Completed ${row.completedAt}` : 'No completion on file'}
                    {row.expiresAt ? ` · due ${row.expiresAt}` : ''}
                  </p>
                  <EvidenceLink href={row.evidenceHref} label={row.evidenceLabel} />
                </div>
                <StatusPill status={row.status} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function EquipmentBadges({ rows }: { rows: EquipmentBadgeStatus[] }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
          Certified equipment
        </p>
        <h2 className="text-lg font-black text-slate-950 dark:text-slate-50">Equipment badges</h2>
      </header>

      {rows.length === 0 ? (
        <p className="mt-5 rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          No equipment certifications assigned yet.
        </p>
      ) : (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3">
          {rows.map(row => {
            const Icon = iconForEquipment(row.equipmentFamily, row.status)
            return (
              <div key={row.id} className={`rounded-lg border p-3 ${badgeClass(row.status)}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-2 min-w-0">
                    <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-950 dark:text-slate-50 truncate">{row.label}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">
                        {row.expiresAt ? `Expires ${row.expiresAt}` : row.evaluationDueAt ? `Evaluation due ${row.evaluationDueAt}` : 'No expiry date'}
                      </p>
                      <EvidenceLink href={row.evidenceHref} label={row.evidenceLabel} />
                    </div>
                  </div>
                  <StatusPill status={row.status} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function AdminEditPath({ links }: { links: MyReadiness['adminLinks'] }) {
  if (links.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center gap-2">
        <UserRoundCog className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Admin edit path</p>
          <h2 className="text-lg font-black text-slate-950 dark:text-slate-50">Manage readiness data</h2>
        </div>
      </header>
      <div className="mt-4 grid grid-cols-1 gap-3">
        {links.map(link => (
          <Link key={link.id} href={link.href} className="rounded-lg border border-slate-200 p-3 hover:border-brand-navy hover:shadow-sm dark:border-slate-800">
            <p className="text-sm font-black text-slate-950 dark:text-slate-50">{link.label}</p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{link.detail}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}

function SupervisorTeam({ rows }: { rows: MyReadiness['supervisorTeam'] }) {
  if (rows.length === 0) return null
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <header className="flex items-center gap-2">
        <Users className="h-5 w-5 text-slate-400" />
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">Supervisor view</p>
          <h2 className="text-lg font-black text-slate-950 dark:text-slate-50">Direct report readiness</h2>
        </div>
      </header>
      <ul className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {rows.map(row => (
          <li key={row.userId} className="grid grid-cols-[1fr_auto] gap-3 p-3">
            <div className="min-w-0">
              <p className="text-sm font-black text-slate-950 dark:text-slate-50 truncate">{row.fullName ?? row.email ?? 'Unknown worker'}</p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {row.positionTitle ?? 'Position not assigned'}{row.shiftLabel ? ` · ${row.shiftLabel}` : ''}
              </p>
            </div>
            <div className="text-right">
              <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${readinessTonePill(row.status)}`}>
                {row.status}
              </span>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">{row.openGapCount} gaps · {row.dueSoonCount} due</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function EvidenceLink({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return <p className="mt-1 text-[11px] font-semibold text-slate-400 dark:text-slate-500">{label}</p>
  }
  return (
    <Link href={href} className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-brand-navy hover:underline dark:text-brand-yellow">
      {label}
      <ExternalLink className="h-3 w-3" />
    </Link>
  )
}

function InfoPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-2.5 py-1 font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  )
}

function Signal({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/60 bg-white/70 p-3 dark:border-slate-700 dark:bg-slate-950/40">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon}
        <p className="text-[10px] font-bold uppercase tracking-widest">{label}</p>
      </div>
      <p className="mt-2 text-base font-black text-slate-950 dark:text-slate-50">{value}</p>
    </div>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-lg font-black tabular-nums text-slate-950 dark:text-slate-50">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">{label}</p>
    </div>
  )
}

function StatusPill({ status }: { status: RequirementStatus }) {
  const label: Record<RequirementStatus, string> = {
    current:      'Current',
    due_soon:    'Due soon',
    overdue:     'Overdue',
    missing:     'Missing',
    not_required: 'Not required',
  }
  return (
    <span className={`self-start rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-wider ${pillClass(status)}`}>
      {label[status]}
    </span>
  )
}

function iconForEquipment(family: string, status: RequirementStatus) {
  if (status === 'missing' || status === 'overdue') return AlertTriangle
  if (family.includes('forklift') || family === 'reach_truck' || family === 'order_picker') return Forklift
  if (family.includes('aerial_lift')) return Scissors
  if (family.includes('pallet')) return PackageCheck
  if (family.includes('hot') || family.includes('fire')) return Flame
  return Wrench
}

function toneClass(tone: ReadinessTone) {
  switch (tone) {
    case 'ready':
      return { section: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900 dark:bg-emerald-950/20', icon: 'text-emerald-600 dark:text-emerald-300' }
    case 'attention':
      return { section: 'border-amber-200 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20', icon: 'text-amber-600 dark:text-amber-300' }
    case 'restricted':
      return { section: 'border-rose-200 bg-rose-50/70 dark:border-rose-900 dark:bg-rose-950/20', icon: 'text-rose-600 dark:text-rose-300' }
  }
}

function pillClass(status: RequirementStatus): string {
  switch (status) {
    case 'current':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
    case 'due_soon':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
    case 'overdue':
    case 'missing':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200'
    case 'not_required':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  }
}

function badgeClass(status: RequirementStatus): string {
  switch (status) {
    case 'current':
      return 'border-emerald-200 bg-emerald-50/60 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300'
    case 'due_soon':
      return 'border-amber-200 bg-amber-50/60 text-amber-700 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-300'
    case 'overdue':
    case 'missing':
      return 'border-rose-200 bg-rose-50/60 text-rose-700 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-300'
    case 'not_required':
      return 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/30 dark:text-slate-300'
  }
}

function primaryActionClass(tone: ReadinessTone): string {
  switch (tone) {
    case 'ready':
      return 'bg-emerald-600 text-white hover:bg-emerald-700'
    case 'attention':
      return 'bg-amber-500 text-slate-950 hover:bg-amber-400'
    case 'restricted':
      return 'bg-rose-600 text-white hover:bg-rose-700'
  }
}

function readinessTonePill(tone: ReadinessTone): string {
  switch (tone) {
    case 'ready':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200'
    case 'attention':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200'
    case 'restricted':
      return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200'
  }
}
