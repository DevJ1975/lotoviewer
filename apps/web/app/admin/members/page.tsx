'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  Download,
  Loader2,
  Search,
  ShieldAlert,
  UserRoundCog,
  Users,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { listAdminMembers } from '@/lib/members/client'
import type { MemberSearchResult } from '@/lib/members/types'

export default function AdminMembersPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()
  const [members, setMembers] = useState<MemberSearchResult[]>([])
  const [q, setQ] = useState('')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const canManage = !!profile?.is_admin || !!profile?.is_superadmin

  const load = useCallback(async () => {
    if (!tenantId || !canManage) return
    setLoading(true)
    setError(null)
    try {
      setMembers(await listAdminMembers(tenantId, { q, includeArchived, limit: 500 }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members')
      setMembers([])
    } finally {
      setLoading(false)
    }
  }, [tenantId, canManage, q, includeArchived])

  useEffect(() => {
    const t = window.setTimeout(() => { void load() }, 250)
    return () => window.clearTimeout(t)
  }, [load])

  const stats = useMemo(() => {
    const active = members.filter(m => m.status === 'active').length
    const login = members.filter(m => !!m.profile_id).length
    const restricted = members.filter(m => m.readiness_status === 'restricted').length
    return { active, login, restricted, total: members.length }
  }, [members])

  function exportCsv() {
    const headers = [
      'member_code', 'handle', 'display_name', 'email', 'phone',
      'employee_id', 'badge_id', 'employment_type', 'vendor_company',
      'department', 'site_label', 'position_title', 'shift_label',
      'supervisor_name', 'readiness_status', 'status', 'tenant_role',
    ]
    const rows = members.map(m => headers.map(h => csvCell(String((m as unknown as Record<string, unknown>)[h] ?? ''))).join(','))
    const blob = new Blob([[headers.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'members.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (authLoading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
  }
  if (!canManage) {
    return <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">Admins only.</div>
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-black text-slate-950 dark:text-slate-50">
            <Users className="h-6 w-6 text-brand-navy dark:text-brand-yellow" />
            Member Command Center
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-500 dark:text-slate-400">
            One roster for app users, shop-floor workers, contractors, temps, supervisors, readiness, mentions, and safety workflows.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={members.length === 0}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </header>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric icon={<Users className="h-4 w-4" />} label="Total" value={stats.total} />
        <Metric icon={<BadgeCheck className="h-4 w-4" />} label="Active" value={stats.active} />
        <Metric icon={<UserRoundCog className="h-4 w-4" />} label="Login access" value={stats.login} />
        <Metric icon={<ShieldAlert className="h-4 w-4" />} label="Restricted" value={stats.restricted} tone={stats.restricted > 0 ? 'warn' : 'normal'} />
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search name, @handle, #member code, email, employee ID, department, shift"
            className="pl-9"
          />
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={e => setIncludeArchived(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300"
          />
          Include archived
        </label>
      </section>

      {error && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
          {error}
        </p>
      )}

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="grid grid-cols-[minmax(280px,1.4fr)_1fr_1fr_auto] gap-3 border-b border-slate-200 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-500 dark:border-slate-800">
          <span>Member</span>
          <span>Assignment</span>
          <span>Readiness</span>
          <span>Status</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
        ) : members.length === 0 ? (
          <p className="px-4 py-12 text-center text-sm text-slate-500">No members found.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map(m => (
              <li key={m.member_id} className="grid grid-cols-1 gap-3 px-4 py-3 lg:grid-cols-[minmax(280px,1.4fr)_1fr_1fr_auto] lg:items-center">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar src={m.avatar_url} name={m.display_name} email={m.email} size="sm" />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-black text-slate-950 dark:text-slate-50">{m.display_name}</p>
                      <span className="placard-numeric text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-sm px-1.5 py-0.5">@{m.handle}</span>
                      <span className="placard-numeric text-[11px] font-bold text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900 rounded-sm px-1.5 py-0.5">#{m.member_code}</span>
                    </div>
                    <p className="truncate text-xs text-slate-500">{m.email || m.phone || 'No login/contact on file'}</p>
                  </div>
                </div>
                <div className="text-sm text-slate-700 dark:text-slate-200">
                  <p className="font-semibold">{m.position_title || m.employment_type}</p>
                  <p className="text-xs text-slate-500">{[m.department, m.shift_label, m.site_label].filter(Boolean).join(' · ') || 'Assignment not set'}</p>
                </div>
                <div className="text-sm">
                  <span className={`safety-tag ${readinessTagClass(m.readiness_status)}`}>{m.readiness_status.replaceAll('_', ' ')}</span>
                  <p className="mt-1 text-xs text-slate-500">{m.supervisor_name ? `Supervisor: ${m.supervisor_name}` : 'No supervisor assigned'}</p>
                </div>
                <div className="flex items-center justify-between gap-3 lg:justify-end">
                  <span className={`safety-tag ${m.status === 'active' ? 'safety-tag-cleared' : 'safety-tag-caution'}`}>{m.status}</span>
                  <BriefcaseBusiness className="h-4 w-4 text-slate-400" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function Metric({ icon, label, value, tone = 'normal' }: { icon: ReactNode; label: string; value: number; tone?: 'normal' | 'warn' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <div className={tone === 'warn' ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'}>{icon}</div>
      <p className="mt-2 text-2xl font-black text-slate-950 dark:text-slate-50">{value}</p>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  )
}

// Readiness state → safety-tag tone. Mirrors the OSHA-coded vocabulary
// used by the rest of the app: cleared (ready to work), danger (work
// restricted), caution (everything in between — pending paperwork,
// expired training, awaiting medical clearance, etc).
function readinessTagClass(status: string): string {
  if (status === 'ready')      return 'safety-tag-cleared'
  if (status === 'restricted') return 'safety-tag-danger'
  return 'safety-tag-caution'
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
