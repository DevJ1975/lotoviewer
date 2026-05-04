'use client'

import { useState, type FormEvent } from 'react'
import { Loader2, AlertCircle, CheckCircle2, UserPlus, X, Trash2 } from 'lucide-react'
import { superadminJson } from '@/lib/superadminFetch'
import type { TenantRole } from '@/lib/types'
import { Section } from './Section'
import { StatusBadge } from './StatusBadge'
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
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson(
      `/api/superadmin/tenants/${tenantNumber}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    )
    if (!result.ok) setRowError(result.error ?? 'Change failed')
    else await reload()
    setBusyUserId(null)
  }

  async function removeMember(userId: string, label: string) {
    if (!confirm(`Remove ${label} from this tenant? Their account stays — only the membership is removed.`)) return
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson(
      `/api/superadmin/tenants/${tenantNumber}/members/${userId}`,
      { method: 'DELETE' },
    )
    if (!result.ok) setRowError(result.error ?? 'Remove failed')
    else await reload()
    setBusyUserId(null)
  }

  // Cancel-invite path: removes the membership AND deletes the auth.user
  // when the invitee never signed in. Backed by ?cancel-invite=true on
  // the membership DELETE — server verifies "never signed in AND no
  // other memberships" before nuking the account.
  async function cancelInvite(userId: string, label: string) {
    if (!confirm(`Cancel invite for ${label}? Their account will be deleted from the system entirely (they never signed in).`)) return
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson<{ userDeleted?: boolean; userDeleteError?: string }>(
      `/api/superadmin/tenants/${tenantNumber}/members/${userId}?cancel-invite=true`,
      { method: 'DELETE' },
    )
    if (!result.ok) {
      setRowError(result.error ?? 'Cancel failed')
    } else {
      if (result.body?.userDeleted === false && result.body.userDeleteError) {
        setRowError(`Membership removed but user delete failed: ${result.body.userDeleteError}`)
      }
      await reload()
    }
    setBusyUserId(null)
  }

  // System-wide delete: removes the user from every tenant + auth.users.
  // Hidden behind a typed-confirmation prompt for safety.
  async function deleteUserSystemWide(userId: string, email: string | null, label: string) {
    const phrase = `DELETE ${email ?? label}`
    const got = prompt(
      `Permanently delete ${label} from Soteria FIELD?\n\n` +
      `This removes them from EVERY tenant and deletes their account. ` +
      `The action cannot be undone.\n\n` +
      `Type "${phrase}" to confirm.`,
    )
    if (got !== phrase) {
      if (got !== null) alert('Confirmation phrase did not match. Nothing was changed.')
      return
    }
    setBusyUserId(userId); setRowError(null)
    const result = await superadminJson(
      `/api/superadmin/users/${userId}`,
      { method: 'DELETE' },
    )
    if (!result.ok) setRowError(result.error ?? 'Delete failed')
    else await reload()
    setBusyUserId(null)
  }

  return (
    <Section title={`Members (${members.length})`}>
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
                <p className="mt-2 text-emerald-800 dark:text-emerald-200 text-xs">
                  Temporary password — copy if email failed:
                  <code className="block mt-1 p-2 bg-emerald-100 dark:bg-emerald-900/40 rounded font-mono text-sm select-all">
                    {inviteResult.tempPassword}
                  </code>
                </p>
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

      {members.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">No members yet. Use the invite button above.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {members.map(m => {
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
                    <p className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">{label}</p>
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
                  {invited ? (
                    <button
                      type="button"
                      onClick={() => cancelInvite(m.user_id, label)}
                      disabled={busy}
                      aria-label={`Cancel invite for ${label}`}
                      title="Cancel invite (deletes the account)"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      Cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => removeMember(m.user_id, label)}
                      disabled={busy}
                      aria-label={`Remove ${label} from this tenant`}
                      title="Remove from this tenant (account stays)"
                      className="text-slate-400 dark:text-slate-500 hover:text-rose-600 dark:hover:text-rose-400 transition-colors disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteUserSystemWide(m.user_id, m.email, label)}
                    disabled={busy}
                    aria-label={`Delete ${label} from system`}
                    title="Delete from Soteria FIELD entirely"
                    className="text-slate-300 dark:text-slate-600 hover:text-rose-700 dark:hover:text-rose-400 transition-colors disabled:opacity-50 text-[10px] uppercase tracking-wider font-bold"
                  >
                    Sys
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
