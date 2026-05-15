'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, KeyRound, Loader2, Repeat, UserPlus, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/components/AuthProvider'
import { useTenant } from '@/components/TenantProvider'
import { formatSupabaseError } from '@/lib/supabaseError'
import type { LotoWorker } from '@soteria/core/types'
import {
  canAddMember,
  canClosePermit,
  type LotoGroupPermit,
  type LotoGroupPermitMember,
  type LotoGroupPermitHandoff,
} from '@soteria/core/lotoGroupPermit'

export default function GroupPermitDetailPage() {
  return (
    <Suspense fallback={<Loader />}>
      <GroupPermitDetail />
    </Suspense>
  )
}

function Loader() {
  return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
}

interface ProfileLite {
  id: string
  email: string | null
  full_name: string | null
}

function GroupPermitDetail() {
  const router = useRouter()
  const { id: permitId } = useParams<{ id: string }>()
  const { profile, loading: authLoading } = useAuth()
  const { tenantId } = useTenant()

  const [permit, setPermit] = useState<LotoGroupPermit | null>(null)
  const [members, setMembers] = useState<LotoGroupPermitMember[]>([])
  const [handoffs, setHandoffs] = useState<LotoGroupPermitHandoff[]>([])
  const [workers, setWorkers] = useState<LotoWorker[]>([])
  const [tenantProfiles, setTenantProfiles] = useState<ProfileLite[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Add-member form
  const [addingWorkerId, setAddingWorkerId] = useState('')
  const [addingUserId, setAddingUserId] = useState('')
  const [lockSerial, setLockSerial] = useState('')

  // Handoff form
  const [handoffToUserId, setHandoffToUserId] = useState('')
  const [handoffNotes, setHandoffNotes] = useState('')

  const load = useCallback(async () => {
    if (!tenantId) return
    setError(null)
    try {
      const [permitResult, membersResult, handoffsResult, workersResult, profilesResult] = await Promise.all([
        supabase.from('loto_group_permits').select('*').eq('id', permitId).eq('tenant_id', tenantId).single(),
        supabase.from('loto_group_permit_members').select('*').eq('group_permit_id', permitId).order('joined_at', { ascending: true }),
        supabase.from('loto_group_permit_handoffs').select('*').eq('group_permit_id', permitId).order('occurred_at', { ascending: false }),
        supabase.from('loto_workers').select('*').eq('tenant_id', tenantId).eq('active', true).order('full_name', { ascending: true }),
        supabase
          .from('tenant_memberships')
          .select('user_id, profiles:user_id (id, email, full_name)')
          .eq('tenant_id', tenantId),
      ])
      if (permitResult.error)   throw new Error(formatSupabaseError(permitResult.error,   'load permit'))
      if (membersResult.error)  throw new Error(formatSupabaseError(membersResult.error,  'load members'))
      if (handoffsResult.error) throw new Error(formatSupabaseError(handoffsResult.error, 'load handoffs'))
      if (workersResult.error)  throw new Error(formatSupabaseError(workersResult.error,  'load workers'))
      if (profilesResult.error) throw new Error(formatSupabaseError(profilesResult.error, 'load profiles'))

      setPermit(permitResult.data as LotoGroupPermit)
      setMembers((membersResult.data ?? []) as LotoGroupPermitMember[])
      setHandoffs((handoffsResult.data ?? []) as LotoGroupPermitHandoff[])
      setWorkers((workersResult.data ?? []) as LotoWorker[])

      const profiles: ProfileLite[] = []
      for (const row of (profilesResult.data ?? []) as Array<{ profiles: ProfileLite | ProfileLite[] | null }>) {
        const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles
        if (p) profiles.push(p)
      }
      profiles.sort((a, b) => (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? ''))
      setTenantProfiles(profiles)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load permit.')
    }
  }, [tenantId, permitId])

  useEffect(() => { if (!authLoading) load() }, [authLoading, load])

  const memberLabel = useMemo(() => {
    const w = new Map(workers.map(w => [w.id, w.full_name]))
    const p = new Map(tenantProfiles.map(p => [p.id, p.full_name ?? p.email ?? p.id.slice(0, 8)]))
    return (m: LotoGroupPermitMember) =>
      m.worker_id ? (w.get(m.worker_id) ?? `worker ${m.worker_id.slice(0, 8)}`)
                  : (p.get(m.user_id!) ?? `user ${m.user_id!.slice(0, 8)}`)
  }, [workers, tenantProfiles])

  const primaryName = useMemo(() => {
    if (!permit?.primary_authorized_employee_id) return '—'
    const p = tenantProfiles.find(x => x.id === permit.primary_authorized_employee_id)
    return p?.full_name ?? p?.email ?? permit.primary_authorized_employee_id.slice(0, 8)
  }, [permit, tenantProfiles])

  if (authLoading || !permit) {
    return <Loader />
  }

  const addInvariant = canAddMember(permit)
  const closeInvariant = canClosePermit(permit, members)

  async function addMember() {
    setError(null)
    if (!addInvariant.canAdd) { setError(addInvariant.reason ?? 'Cannot add members right now.'); return }
    if (!addingWorkerId && !addingUserId) { setError('Pick a worker or app user.'); return }
    if (addingWorkerId && addingUserId)   { setError('Pick a worker OR an app user, not both.'); return }
    if (!lockSerial.trim()) { setError('Enter the personal lock serial.'); return }
    setBusy(true)
    try {
      const { error: err } = await supabase
        .from('loto_group_permit_members')
        .insert({
          group_permit_id:      permitId,
          worker_id:            addingWorkerId || null,
          user_id:              addingUserId   || null,
          personal_lock_serial: lockSerial.trim(),
        })
      if (err) throw new Error(formatSupabaseError(err, 'add member'))
      setAddingWorkerId('')
      setAddingUserId('')
      setLockSerial('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add member.')
    } finally {
      setBusy(false)
    }
  }

  async function detachMember(memberId: string) {
    setError(null); setBusy(true)
    try {
      const { error: err } = await supabase
        .from('loto_group_permit_members')
        .update({ left_at: new Date().toISOString() })
        .eq('id', memberId)
      if (err) throw new Error(formatSupabaseError(err, 'detach member'))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not detach member.')
    } finally {
      setBusy(false)
    }
  }

  async function handoff() {
    setError(null)
    if (!handoffToUserId) { setError('Pick the on-coming primary.'); return }
    if (handoffToUserId === profile?.id) { setError('Pick a different user to hand off to.'); return }
    setBusy(true)
    try {
      const { error: err } = await supabase.rpc('handoff_loto_group_permit', {
        p_permit_id:  permitId,
        p_to_user_id: handoffToUserId,
        p_notes:      handoffNotes.trim() || null,
      })
      if (err) throw new Error(formatSupabaseError(err, 'hand off permit'))
      setHandoffToUserId('')
      setHandoffNotes('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not hand off permit.')
    } finally {
      setBusy(false)
    }
  }

  async function closePermit() {
    setError(null)
    if (!closeInvariant.canClose) { setError(closeInvariant.reason ?? 'Cannot close yet.'); return }
    setBusy(true)
    try {
      const { error: err } = await supabase.rpc('close_loto_group_permit', {
        p_permit_id:    permitId,
        p_close_notes: null,
      })
      if (err) throw new Error(formatSupabaseError(err, 'close permit'))
      router.push('/loto/group-permits')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close permit.')
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <div>
        <Link href="/loto/group-permits" className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300">
          <ArrowLeft className="h-3 w-3" /> Back to group permits
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
          <KeyRound className="h-6 w-6 text-brand-navy" />
          {permit.work_description}
        </h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Started {new Date(permit.started_at).toLocaleString()}
          {' · '}primary: <span className="font-semibold">{primaryName}</span>
          {' · status: '}<span className="font-semibold">{permit.status}</span>
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 dark:bg-rose-950/40 px-3 py-2 text-xs text-rose-900 dark:text-rose-100">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-4">
        <header className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Members</h2>
        </header>

        {members.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">No members yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {members.map(m => (
              <li key={m.id} className="py-2 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{memberLabel(m)}</p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Lock <span className="font-mono">{m.personal_lock_serial}</span>
                    {' · joined '}{new Date(m.joined_at).toLocaleString()}
                    {m.left_at && <> · left {new Date(m.left_at).toLocaleString()}</>}
                  </p>
                </div>
                {!m.left_at && permit.status !== 'closed' && (
                  <button
                    type="button"
                    onClick={() => detachMember(m.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="h-3 w-3" /> Detach
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {permit.status !== 'closed' && (
          <div className="space-y-2 border-t border-slate-100 dark:border-slate-800 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <UserPlus className="h-3 w-3" /> Add member
            </p>
            {!addInvariant.canAdd && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">{addInvariant.reason}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select
                value={addingWorkerId}
                onChange={e => { setAddingWorkerId(e.target.value); if (e.target.value) setAddingUserId('') }}
                disabled={busy || !addInvariant.canAdd}
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              >
                <option value="">— shop-floor worker —</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
              <select
                value={addingUserId}
                onChange={e => { setAddingUserId(e.target.value); if (e.target.value) setAddingWorkerId('') }}
                disabled={busy || !addInvariant.canAdd}
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              >
                <option value="">— app user —</option>
                {tenantProfiles.map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
              </select>
              <input
                type="text"
                value={lockSerial}
                onChange={e => setLockSerial(e.target.value)}
                disabled={busy || !addInvariant.canAdd}
                placeholder="Lock serial"
                className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
              />
            </div>
            <button
              type="button"
              onClick={addMember}
              disabled={busy || !addInvariant.canAdd}
              className="text-xs px-3 py-1.5 rounded-md bg-brand-navy text-white font-semibold disabled:opacity-40"
            >
              Attach personal lock
            </button>
          </div>
        )}
      </section>

      {permit.status !== 'closed' && (
        <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <header className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-slate-500 dark:text-slate-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Shift handoff (§(f)(4))</h2>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={handoffToUserId}
              onChange={e => setHandoffToUserId(e.target.value)}
              disabled={busy}
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            >
              <option value="">— on-coming primary —</option>
              {tenantProfiles
                .filter(p => p.id !== permit.primary_authorized_employee_id)
                .map(p => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
            </select>
            <input
              type="text"
              value={handoffNotes}
              onChange={e => setHandoffNotes(e.target.value)}
              disabled={busy}
              placeholder="Notes (optional)"
              className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
            />
          </div>
          <button
            type="button"
            onClick={handoff}
            disabled={busy || !handoffToUserId}
            className="text-xs px-3 py-1.5 rounded-md bg-brand-navy text-white font-semibold disabled:opacity-40"
          >
            Hand off primary
          </button>
          {handoffs.length > 0 && (
            <ul className="text-[11px] text-slate-500 dark:text-slate-400 mt-2 space-y-0.5">
              {handoffs.map(h => (
                <li key={h.id}>
                  {new Date(h.occurred_at).toLocaleString()} ·{' '}
                  {tenantProfiles.find(p => p.id === h.from_user_id)?.full_name ?? h.from_user_id.slice(0, 8)}
                  {' → '}
                  {tenantProfiles.find(p => p.id === h.to_user_id)?.full_name ?? h.to_user_id.slice(0, 8)}
                  {h.notes && <> · {h.notes}</>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {permit.status !== 'closed' && (
        <section className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Close permit</h2>
          {!closeInvariant.canClose && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300">{closeInvariant.reason}</p>
          )}
          <button
            type="button"
            onClick={closePermit}
            disabled={busy || !closeInvariant.canClose}
            className="text-xs px-3 py-1.5 rounded-md bg-rose-600 text-white font-semibold disabled:opacity-40 hover:bg-rose-700 transition-colors"
          >
            Close group permit
          </button>
        </section>
      )}
    </div>
  )
}
