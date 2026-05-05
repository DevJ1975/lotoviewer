'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Loader2, AlertCircle, CheckCircle2, UserPlus, X, Trash2, Mail, Crown, Copy, MoreVertical } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type { TenantRole } from '@soteria/core/types'
import { Section } from './Section'
import { StatusBadge } from './StatusBadge'
import { UndoToast } from './UndoToast'
import { ROLE_OPTIONS, type MemberRow } from './types'

interface InviteResult {
  email:          string
  role:           TenantRole
  tempPassword?:  string
  emailSent?:     boolean
  alreadyExisted: boolean
}

interface Props {
  tenantNumber: string
  members:      MemberRow[]
  reload:       () => Promise<void>
}

export function MembersSection({ tenantNumber, members, reload }: Props) {
  const [inviteOpen,   setInviteOpen]   = useState(false)
  const [inviteEmail,  setInviteEmail]  = useState('')
  const [inviteName,   setInviteName]   = useState('')
  const [inviteRole,   setInviteRole]   = useState<TenantRole>('member')
  const [inviteBusy,   setInviteBusy]   = useState(false)
  const [inviteError,  setInviteError]  = useState<string | null>(null)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)

  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [rowError,   setRowError]   = useState<string | null>(null)

  // ── Optimistic removals — a key React pattern, worth understanding ──
  //
  // GOAL: when a destructive action succeeds, the row should disappear
  // INSTANTLY, not after the next API reload completes. The user clicked
  // Trash; the row should vanish so they know it took effect.
  //
  // PATTERN: maintain a Set of "ids we've removed but the prop hasn't
  // caught up yet." Render `members` filtered through the set.
  //
  // INTERESTING WRINKLE: when the prop DOES catch up (next reload),
  // we want to clean the set so it doesn't grow forever. But we
  // ONLY clean ids that have actually disappeared from the prop. If
  // the user is somehow STILL in members after a reload (DB delete
  // silently failed, network hiccup), keep them hidden — the UI must
  // never lie about what the click did.
  //
  // LEARN: passing a function to setState (`setX(prev => ...)`) is the
  // safe way to compute the next value from the current one. It avoids
  // stale-closure bugs when multiple updates happen quickly.
  //
  // RECOMMENDATION: if you ever need to rebuild this pattern, consider
  // a small useReducer instead — `dispatch({type: 'remove', id})` and
  // a single state update is easier to reason about than parallel sets.
  // Not worth refactoring today; the Set approach is clear enough.
  const [optimisticallyRemoved, setOptimisticallyRemoved] = useState<Set<string>>(new Set())
  useEffect(() => {
    setOptimisticallyRemoved(prev => {
      const next = new Set<string>()
      for (const id of prev) {
        if (members.some(m => m.user_id === id)) next.add(id)
      }
      return next
    })
  }, [members])

  // useMemo here memoizes the filtered array so its identity is stable
  // when neither `members` nor the optimistic set changed. Without it,
  // EVERY render produces a new filtered array, and any child that
  // depends on `visibleMembers` re-renders unnecessarily.
  const visibleMembers = useMemo(
    () => members.filter(m => !optimisticallyRemoved.has(m.user_id)),
    [members, optimisticallyRemoved],
  )

  function markRemoved(userId: string) {
    setOptimisticallyRemoved(prev => new Set([...prev, userId]))
  }
  function unmarkRemoved(userId: string) {
    setOptimisticallyRemoved(prev => {
      const next = new Set(prev)
      next.delete(userId)
      return next
    })
  }

  // Deferred-destroy queue. Holds the next destructive action that's
  // waiting for the 30-second undo window. Only one pending action at a
  // time — clicking another destructive action commits the previous
  // one immediately (see queuePendingAction).
  type PendingAction = {
    type:    'remove' | 'cancel-invite' | 'sys-delete'
    userId:  string
    email:   string | null
    label:   string
    message: string
  }
  const [pending, setPending] = useState<PendingAction | null>(null)
  // Guard against double-commits — UndoToast also fires onCommit on
  // unmount, which can race with the timer's commit. Track which
  // userIds we've already committed so the second invocation is a
  // no-op.
  const committedRef = useRef<Set<string>>(new Set())

  async function commitPending(action: PendingAction): Promise<void> {
    if (committedRef.current.has(action.userId)) return
    committedRef.current.add(action.userId)
    let url: string
    if (action.type === 'cancel-invite')
      url = `/api/superadmin/tenants/${tenantNumber}/members/${action.userId}?cancel-invite=true`
    else if (action.type === 'sys-delete')
      url = `/api/superadmin/users/${action.userId}`
    else
      url = `/api/superadmin/tenants/${tenantNumber}/members/${action.userId}`

    const result = await superadminJson<{ userDeleted?: boolean; userDeleteError?: string }>(
      url, { method: 'DELETE' },
    )
    if (!result.ok) {
      // Rollback the optimistic hide — surface the error so the user
      // knows nothing happened.
      unmarkRemoved(action.userId)
      committedRef.current.delete(action.userId)
      setRowError(result.error ?? `${action.type} failed`)
    } else {
      if (result.body?.userDeleted === false && result.body.userDeleteError) {
        setRowError(`Membership removed but user delete failed: ${result.body.userDeleteError}`)
      }
      await reload()
    }
    setPending(prev => (prev?.userId === action.userId ? null : prev))
  }

  function undoPending() {
    if (!pending) return
    unmarkRemoved(pending.userId)
    setPending(null)
  }

  // Queue a new destructive action. If something's already pending, the
  // toast will fire its onCommit on unmount before this new action
  // takes its place — preserves intent on rapid clicks.
  function queuePendingAction(a: PendingAction) {
    setRowError(null)
    markRemoved(a.userId)
    setPending(a)
  }

  async function transferOwnership(newOwnerId: string, newOwnerLabel: string) {
    if (!confirm(`Make ${newOwnerLabel} the sole owner of this tenant? Existing owner(s) become admin.`)) return
    setBusyUserId(newOwnerId); setRowError(null)
    const result = await superadminJson(
      `/api/superadmin/tenants/${tenantNumber}/transfer-ownership`,
      { method: 'POST', body: JSON.stringify({ new_owner_user_id: newOwnerId }) },
    )
    if (!result.ok) setRowError(result.error ?? 'Transfer failed')
    else await reload()
    setBusyUserId(null)
  }

  async function resendInvite(userId: string, label: string) {
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson<{ email: string; tempPassword: string; emailSent: boolean }>(
      `/api/superadmin/tenants/${tenantNumber}/members/${userId}/resend-invite`,
      { method: 'POST' },
    )
    if (!result.ok || !result.body) {
      setRowError(result.error ?? 'Resend failed')
    } else {
      // Surface the new temp password through the existing invite-result
      // panel so the superadmin can copy/paste if email failed.
      setInviteResult({
        email:          result.body.email,
        role:           members.find(m => m.user_id === userId)?.role ?? 'member',
        tempPassword:   result.body.tempPassword,
        emailSent:      result.body.emailSent,
        alreadyExisted: false,
      })
      void label  // for future toast wording
    }
    setBusyUserId(null)
  }

  async function onInvite(e: FormEvent) {
    e.preventDefault()
    setInviteError(null); setInviteResult(null)
    const email = inviteEmail.trim().toLowerCase()
    if (!email) { setInviteError('Email required'); return }

    setInviteBusy(true)
    const result = await superadminJson<{
      email: string; role: TenantRole; tempPassword?: string
      emailSent?: boolean; alreadyExisted: boolean
    }>(`/api/superadmin/tenants/${tenantNumber}/members`, {
      method: 'POST',
      body:   JSON.stringify({
        email,
        role:      inviteRole,
        full_name: inviteName.trim() || undefined,
      }),
    })
    if (!result.ok || !result.body) {
      setInviteError(result.error ?? 'Invite failed')
    } else {
      setInviteResult({
        email:          result.body.email,
        role:           result.body.role,
        tempPassword:   result.body.tempPassword,
        emailSent:      result.body.emailSent === true,
        alreadyExisted: result.body.alreadyExisted,
      })
      setInviteEmail(''); setInviteName(''); setInviteRole('member')
      await reload()
    }
    setInviteBusy(false)
  }

  async function changeRole(userId: string, role: TenantRole) {
    // If promoting to owner AND there's already a different owner,
    // route through the transfer-ownership endpoint so the tenant
    // ends up with exactly one owner. Without this, two PATCH calls
    // would temporarily produce a 2-owner tenant.
    if (role === 'owner') {
      const otherOwnerExists = members.some(m => m.role === 'owner' && m.user_id !== userId)
      if (otherOwnerExists) {
        const target = members.find(m => m.user_id === userId)
        await transferOwnership(userId, target?.full_name ?? target?.email ?? userId)
        return
      }
    }
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson(
      `/api/superadmin/tenants/${tenantNumber}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    )
    if (!result.ok) setRowError(result.error ?? 'Change failed')
    else await reload()
    setBusyUserId(null)
  }

  // All three destructive actions go through the deferred-destroy queue.
  // The row hides immediately + the UndoToast at the bottom of the
  // section gives the superadmin 30 seconds to cancel before the API
  // call fires. Removes the previous "single irreversible click" foot-
  // gun; the typed-confirmation prompt for system-delete is also gone
  // since Undo is the safer pattern for it too.

  function removeMember(userId: string, label: string) {
    queuePendingAction({
      type:    'remove',
      userId,
      email:   members.find(m => m.user_id === userId)?.email ?? null,
      label,
      message: `Removed ${label} from this tenant`,
    })
  }

  function cancelInvite(userId: string, label: string) {
    queuePendingAction({
      type:    'cancel-invite',
      userId,
      email:   members.find(m => m.user_id === userId)?.email ?? null,
      label,
      message: `Cancelled invite for ${label} (account will be deleted)`,
    })
  }

  function deleteUserSystemWide(userId: string, email: string | null, label: string) {
    queuePendingAction({
      type:    'sys-delete',
      userId,
      email,
      label,
      message: `Deleted ${label} from Soteria FIELD entirely`,
    })
  }

  async function copyTempPassword() {
    if (!inviteResult?.tempPassword) return
    try { await navigator.clipboard.writeText(inviteResult.tempPassword) }
    catch { /* clipboard blocked — user can still select-all */ }
  }

  return (
    <Section title={`Members (${visibleMembers.length})`}>
      <div className="flex justify-end mb-3">
        <button
          type="button"
          onClick={() => { setInviteOpen(o => !o); setInviteError(null); setInviteResult(null) }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-brand-navy text-white hover:bg-brand-navy/90 transition-colors"
        >
          {inviteOpen ? <X className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
          {inviteOpen ? 'Cancel' : 'Invite member'}
        </button>
      </div>

      {inviteOpen && (
        <form onSubmit={onInvite} className="mb-4 p-3 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="email"
              required
              placeholder="email@example.com"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            />
            <input
              type="text"
              placeholder="Full name (optional)"
              value={inviteName}
              onChange={e => setInviteName(e.target.value)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            />
            <select
              value={inviteRole}
              onChange={e => setInviteRole(e.target.value as TenantRole)}
              className="px-3 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand-navy"
            >
              {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={inviteBusy}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-brand-navy text-white text-sm font-medium hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
            >
              {inviteBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {inviteBusy ? 'Inviting…' : 'Send invite'}
            </button>
          </div>
          {inviteError && (
            <p className="text-sm text-rose-600 dark:text-rose-400 flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {inviteError}
            </p>
          )}
        </form>
      )}

      {inviteResult && (
        <div className="mb-4 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
            <div className="text-sm">
              <p className="font-medium text-emerald-900 dark:text-emerald-100">
                {inviteResult.alreadyExisted ? 'Added existing user' : 'Invite created'}: {inviteResult.email} ({inviteResult.role})
              </p>
              {!inviteResult.alreadyExisted && (
                <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                  {inviteResult.emailSent
                    ? '✉ Invite emailed. The temp password is in the email.'
                    : '⚠ Email not sent (Resend not configured or send failed). Copy the password below to share manually.'}
                </p>
              )}
              {inviteResult.alreadyExisted && (
                <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                  {inviteResult.emailSent
                    ? '✉ Notification emailed — they can sign in with their existing account; the new tenant will appear in the switcher.'
                    : '⚠ Email not sent. Tell them out-of-band that they were added to this tenant.'}
                </p>
              )}
              {inviteResult.tempPassword && (
                <div className="mt-2 text-emerald-800 dark:text-emerald-200 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span>Temporary password — copy if email failed:</span>
                    <button
                      type="button"
                      onClick={copyTempPassword}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-200 dark:bg-emerald-900/40 text-emerald-900 dark:text-emerald-200 hover:bg-emerald-300 dark:hover:bg-emerald-900/60 transition-colors"
                    >
                      <Copy className="h-3 w-3" /> Copy
                    </button>
                  </div>
                  <code className="block mt-1 p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded font-mono text-sm select-all">
                    {inviteResult.tempPassword}
                  </code>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {rowError && (
        <div className="mb-3 p-3 rounded-md bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800 text-sm text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" /> {rowError}
        </div>
      )}

      {visibleMembers.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No members yet. Use the invite button above.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {visibleMembers.map(m => {
            const label    = m.full_name ?? m.email ?? m.user_id
            const busy     = busyUserId === m.user_id
            const invited  = m.status === 'invited'
            const lastSeen = m.last_sign_in_at
              ? new Date(m.last_sign_in_at).toLocaleDateString()
              : null
            return (
              <li key={m.user_id} className="py-3 flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/superadmin/users/${m.user_id}`}
                      className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate hover:text-brand-navy dark:hover:text-brand-yellow transition-colors"
                    >
                      {label}
                    </Link>
                    <StatusBadge status={m.status} />
                  </div>
                  {m.email && m.full_name && (
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">{m.email}</p>
                  )}
                  <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                    {invited
                      ? `Invited ${new Date(m.joined_at).toLocaleDateString()} · never signed in`
                      : `Last signed in ${lastSeen}`}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <select
                    value={m.role}
                    onChange={e => changeRole(m.user_id, e.target.value as TenantRole)}
                    disabled={busy}
                    className="px-2 py-1 text-xs uppercase tracking-wider font-medium rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-navy disabled:opacity-60"
                  >
                    {ROLE_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                  {/* Transfer ownership: only on non-owner rows AND when
                      there's actually a current owner to transfer FROM. */}
                  {m.role !== 'owner' && members.some(o => o.role === 'owner') && (
                    <button
                      type="button"
                      onClick={() => transferOwnership(m.user_id, label)}
                      disabled={busy}
                      aria-label={`Transfer ownership to ${label}`}
                      title="Make this user the sole owner (existing owner becomes admin)"
                      className="text-slate-400 dark:text-slate-500 hover:text-brand-yellow transition-colors disabled:opacity-50"
                    >
                      <Crown className="h-4 w-4" />
                    </button>
                  )}
                  {invited ? (
                    <>
                      <button
                        type="button"
                        onClick={() => resendInvite(m.user_id, label)}
                        disabled={busy}
                        aria-label={`Resend invite to ${label}`}
                        title="Generate a fresh temp password and re-email the invite"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-brand-navy dark:text-brand-yellow bg-brand-navy/5 dark:bg-brand-navy/20 hover:bg-brand-navy/10 dark:hover:bg-brand-navy/30 transition-colors disabled:opacity-50"
                      >
                        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                        Resend
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelInvite(m.user_id, label)}
                        disabled={busy}
                        aria-label={`Cancel invite for ${label}`}
                        title="Cancel invite (deletes the account) — undoable for 30s"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors disabled:opacity-50"
                      >
                        <X className="h-3.5 w-3.5" /> Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeMember(m.user_id, label)}
                      disabled={busy}
                      aria-label={`Remove ${label} from this tenant`}
                      title="Remove from this tenant (account stays) — undoable for 30s"
                      className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteUserSystemWide(m.user_id, m.email, label)}
                    disabled={busy}
                    aria-label={`Delete ${label} from system`}
                    title="Delete from Soteria FIELD entirely — undoable for 30s"
                    className="text-slate-300 dark:text-slate-600 hover:text-rose-700 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pending && (
        <UndoToast
          key={pending.userId}
          message={pending.message}
          onCommit={() => commitPending(pending)}
          onUndo={undoPending}
        />
      )}
    </Section>
  )
}
