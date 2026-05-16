'use client'

// Admin member detail page. Server-rendering this would require fetching
// the auth.users last_sign_in_at via the admin client from a server
// component, which means duplicating the tenant-gate logic outside the
// API surface. Keeping it client-side lets the existing /api/admin/members
// endpoints stay the single source of truth.

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  Check,
  Copy,
  GitMerge,
  Loader2,
  ShieldCheck,
  UserCheck,
  UserPlus,
} from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'
import {
  grantMemberLogin,
  listAdminMembers,
  mergeMembers,
  type GrantLoginResult,
} from '@/lib/members/client'
import type { MemberSearchResult, MemberSummary } from '@/lib/members/types'

interface MemberStatusEvent {
  id:         string
  event_type: string
  reason:     string | null
  created_at: string
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default function AdminMemberDetailPage() {
  const params = useParams<{ memberId: string }>()
  const router = useRouter()
  const memberId = params?.memberId ?? ''

  const { profile, loading: authLoading } = useAuth()
  const { tenantId, loading: tenantLoading } = useTenant()
  const canManage = !!profile?.is_admin || !!profile?.is_superadmin

  const [member, setMember]     = useState<MemberSummary | null>(null)
  const [events, setEvents]     = useState<MemberStatusEvent[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [granting, setGranting] = useState(false)
  const [grantResult, setGrantResult] = useState<GrantLoginResult | null>(null)
  const [copied, setCopied]     = useState(false)

  // Merge picker state
  const [mergeOpen, setMergeOpen]   = useState(false)
  const [mergeSearch, setMergeSearch] = useState('')
  const [mergeOptions, setMergeOptions] = useState<MemberSearchResult[]>([])
  const [mergeTargetId, setMergeTargetId] = useState<string | null>(null)
  const [mergeReason, setMergeReason] = useState('')
  const [merging, setMerging] = useState(false)

  const load = useCallback(async () => {
    if (!tenantId || !canManage || !UUID_RE.test(memberId)) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const headers = new Headers()
      if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
      headers.set('x-active-tenant', tenantId)

      // Member detail comes from the listing endpoint filtered to the
      // exact id — saves a dedicated GET-by-id route and reuses
      // v_member_roster's existing shape.
      const list = await listAdminMembers(tenantId, { includeArchived: true, limit: 500 })
      const found = list.find(m => m.member_id === memberId) ?? null
      setMember(found)

      // Recent member_status_events for this member.
      const { data: eventRows } = await supabase
        .from('member_status_events')
        .select('id, event_type, reason, created_at')
        .eq('member_id', memberId)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(20)
      setEvents((eventRows ?? []) as MemberStatusEvent[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load member')
    } finally {
      setLoading(false)
    }
  }, [tenantId, canManage, memberId])

  useEffect(() => { void load() }, [load])

  const onGrantLogin = useCallback(async () => {
    if (!tenantId || !member) return
    setGranting(true)
    setError(null)
    try {
      const result = await grantMemberLogin(tenantId, member.member_id, {})
      setGrantResult(result)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not grant login')
    } finally {
      setGranting(false)
    }
  }, [tenantId, member, load])

  const openMerge = useCallback(async () => {
    if (!tenantId) return
    setMergeOpen(true)
    setMergeSearch('')
    setMergeTargetId(null)
    setMergeReason('')
    try {
      const list = await listAdminMembers(tenantId, { includeArchived: false, limit: 50 })
      setMergeOptions(list.filter(m => m.member_id !== member?.member_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load members for merge')
    }
  }, [tenantId, member])

  const onSearchMerge = useCallback(async (q: string) => {
    setMergeSearch(q)
    if (!tenantId) return
    try {
      const list = await listAdminMembers(tenantId, { q, includeArchived: false, limit: 50 })
      setMergeOptions(list.filter(m => m.member_id !== member?.member_id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not search members')
    }
  }, [tenantId, member])

  const onConfirmMerge = useCallback(async () => {
    if (!tenantId || !member || !mergeTargetId || !mergeReason.trim()) return
    setMerging(true)
    setError(null)
    try {
      await mergeMembers(tenantId, {
        sourceMemberId: member.member_id,
        targetMemberId: mergeTargetId,
        reason: mergeReason.trim(),
      })
      setMergeOpen(false)
      // The source row is now status='merged' — redirect to the target.
      router.push(`/admin/members/${mergeTargetId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Merge failed')
    } finally {
      setMerging(false)
    }
  }, [tenantId, member, mergeTargetId, mergeReason, router])

  const mergeTarget = useMemo(
    () => mergeOptions.find(m => m.member_id === mergeTargetId) ?? null,
    [mergeOptions, mergeTargetId],
  )

  if (authLoading || tenantLoading || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    )
  }
  if (!canManage) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-sm text-slate-500">
        Admins only.
      </div>
    )
  }
  if (!member) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <Link href="/admin/members" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Members
        </Link>
        <p className="mt-6 text-sm text-slate-500">Member not found.</p>
      </main>
    )
  }

  const hasLogin = !!member.profile_id

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
      <header>
        <Link href="/admin/members" className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-brand-navy">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Members
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-4">
            <Avatar src={member.avatar_url} name={member.display_name} email={member.email} size="lg" />
            <div>
              <h1 className="text-2xl font-black text-slate-950 dark:text-slate-50">{member.display_name}</h1>
              <p className="mt-1 text-xs text-slate-500">
                @{member.handle} · #{member.member_code} · {member.employment_type}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                Source: {hasLogin ? 'login user' : 'roster only'} · Status: {member.status}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onGrantLogin} disabled={hasLogin || granting}>
              {granting ? <Loader2 className="h-4 w-4 animate-spin" /> : hasLogin ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
              {hasLogin ? 'Login active' : 'Grant app access'}
            </Button>
            <Button variant="outline" onClick={openMerge}>
              <GitMerge className="h-4 w-4" />
              Merge into…
            </Button>
          </div>
        </div>
      </header>

      {error && (
        <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-100">
          {error}
        </p>
      )}

      {grantResult && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-5 w-5 text-emerald-700 dark:text-emerald-300" />
            <div className="flex-1">
              <p className="text-sm font-bold text-emerald-900 dark:text-emerald-100">
                Login created.{grantResult.emailSent ? ' Invite email sent.' : ' Email was not sent — copy the password below.'}
              </p>
              {grantResult.tempPassword && (
                <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 ring-1 ring-emerald-200 dark:bg-slate-900">
                  <code className="font-mono text-sm">{grantResult.tempPassword}</code>
                  <button
                    type="button"
                    aria-label="Copy password"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(grantResult.tempPassword!)
                        setCopied(true); setTimeout(() => setCopied(false), 1500)
                      } catch { /* ignore */ }
                    }}
                    className="text-emerald-700 hover:text-emerald-900 dark:text-emerald-300"
                  >
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <DetailCard title="Identity">
          <DetailRow label="Legal name"     value={member.legal_name} />
          <DetailRow label="Preferred name" value={member.preferred_name} />
          <DetailRow label="Email"          value={member.email} />
          <DetailRow label="Phone"          value={member.phone} />
          <DetailRow label="Employee ID"    value={member.employee_id} />
          <DetailRow label="Badge ID"       value={member.badge_id} />
        </DetailCard>
        <DetailCard title="Assignment">
          <DetailRow label="Department"      value={member.department} />
          <DetailRow label="Site"            value={member.site_label} />
          <DetailRow label="Shift"           value={member.shift_label} />
          <DetailRow label="Position"        value={member.position_title} />
          <DetailRow label="Employment type" value={member.employment_type} />
          <DetailRow label="Supervisor"      value={member.supervisor_name} />
        </DetailCard>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent activity</h2>
        {events.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">No recorded events.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {events.map(e => (
              <li key={e.id} className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0 dark:border-slate-800">
                <div>
                  <span className="font-medium">{e.event_type.replaceAll('_', ' ')}</span>
                  {e.reason && <span className="ml-2 text-xs text-slate-500">{e.reason}</span>}
                </div>
                <span className="text-xs text-slate-500">{new Date(e.created_at).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <AlertDialog open={mergeOpen} onOpenChange={setMergeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Merge {member.display_name} into…</AlertDialogTitle>
            <AlertDialogDescription>
              The selected member becomes the surviving record. Pick the target carefully — the merge cannot be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <input
              type="text"
              value={mergeSearch}
              onChange={e => onSearchMerge(e.target.value)}
              placeholder="Search by name, email, employee ID…"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
            <ul className="max-h-56 space-y-1 overflow-auto rounded-md border border-slate-200 p-1 dark:border-slate-800">
              {mergeOptions.length === 0 ? (
                <li className="px-2 py-3 text-xs text-slate-500">No matches.</li>
              ) : mergeOptions.map(m => (
                <li key={m.member_id}>
                  <button
                    type="button"
                    onClick={() => setMergeTargetId(m.member_id)}
                    className={`flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm ${
                      mergeTargetId === m.member_id
                        ? 'bg-brand-navy/10 text-brand-navy dark:bg-brand-yellow/10 dark:text-brand-yellow'
                        : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>
                      <span className="font-medium">{m.display_name}</span>
                      <span className="ml-2 text-xs text-slate-500">{m.email ?? '—'} · #{m.member_code}</span>
                    </span>
                    {m.profile_id && <span className="safety-tag safety-tag-info">login</span>}
                  </button>
                </li>
              ))}
            </ul>
            {mergeTarget && (
              <div className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                <p className="font-semibold">Will merge:</p>
                <p>{member.display_name} (#{member.member_code}) → {mergeTarget.display_name} (#{mergeTarget.member_code})</p>
                {member.profile_id && mergeTarget.profile_id && (
                  <p className="mt-1 font-semibold text-rose-700 dark:text-rose-300">
                    Both members have login. Revoke one via /admin/users first.
                  </p>
                )}
              </div>
            )}
            <textarea
              value={mergeReason}
              onChange={e => setMergeReason(e.target.value)}
              placeholder="Reason for the merge (required, audit trail)"
              rows={2}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
            />
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={merging}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmMerge}
              disabled={!mergeTargetId || !mergeReason.trim() || merging
                || (!!member.profile_id && !!mergeTarget?.profile_id)}
            >
              {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Merge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

function DetailCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
      <dl className="mt-3 space-y-1.5">{children}</dl>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-right text-slate-800 dark:text-slate-200">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  )
}
