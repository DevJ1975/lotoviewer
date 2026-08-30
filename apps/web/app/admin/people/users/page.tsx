'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Link2 as LinkIcon,
  Loader2,
  Mail,
  MailCheck,
  Send,
  Shield,
  Trash2,
  UserPlus,
} from 'lucide-react'
import { z } from 'zod'

import { useAuth } from '@/components/AuthProvider'
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
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/ui/data-table'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { useTenant } from '@/components/TenantProvider'
import { supabase } from '@/lib/supabase'

interface AdminUserRow {
  id:                   string
  email:                string
  full_name:            string | null
  is_admin:             boolean
  role?:                string
  must_change_password: boolean
  created_at:           string
  /** null = invited but never signed in — the only state a resend applies to. */
  last_sign_in_at:      string | null
}

// What produced the link currently on screen. Drives the panel's headline;
// "we emailed it" and "here it is, go paste it" are different messages.
type InviteAction = 'created' | 'resent' | 'link_only'

interface InviteResult {
  action:        InviteAction
  email:         string
  fullName:      string
  tempPassword?: string
  inviteUrl?:    string
  expiresAt?:    string
  emailSent:     boolean
}

const inviteSchema = z.object({
  fullName: z.string().trim().max(120).optional(),
  email:    z.string().trim().toLowerCase().email("Enter a valid email"),
})
type InviteValues = z.infer<typeof inviteSchema>

async function authFetch(path: string, tenantId: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init?.headers)
  if (session?.access_token) headers.set('Authorization', `Bearer ${session.access_token}`)
  headers.set('x-active-tenant', tenantId)
  if (init?.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

export default function AdminUsersPage() {
  const { profile, loading: authLoading } = useAuth()
  const { tenantId, role, loading: tenantLoading } = useTenant()
  const [users, setUsers]   = useState<AdminUserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AdminUserRow | null>(null)

  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [resendingId, setResendingId] = useState<string | null>(null)

  const form = useForm<InviteValues>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { fullName: '', email: '' },
  })

  const canManage = profile?.is_superadmin === true || role === 'owner' || role === 'admin'

  const fetchUsers = useCallback(async () => {
    if (!tenantId) {
      setLoadError('Select an active tenant before managing users.')
      setLoading(false)
      return
    }
    const res = await authFetch('/api/admin/users', tenantId)
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      setLoadError(body.error ?? 'Could not load users')
      setLoading(false)
      return
    }
    const data = await res.json() as { users: AdminUserRow[] }
    setUsers(data.users)
    setLoading(false)
  }, [tenantId])

  useEffect(() => {
    if (authLoading || tenantLoading) return
    if (!canManage) {
      setLoading(false)
      return
    }
    fetchUsers()
  }, [authLoading, tenantLoading, canManage, fetchUsers])

  async function onInvite(values: InviteValues) {
    if (!tenantId) {
      toast.error('Select an active tenant before inviting users.')
      return
    }
    const res = await authFetch('/api/admin/users', tenantId, {
      method: 'POST',
      body: JSON.stringify({ email: values.email, fullName: values.fullName ?? '' }),
    })
    const body = await res.json()
    if (!res.ok) {
      toast.error(body.error ?? 'Could not create user')
      return
    }
    setInviteResult({
      action:       'created',
      email:        body.email,
      fullName:     body.fullName ?? '',
      tempPassword: body.tempPassword,
      inviteUrl:    body.inviteUrl,
      expiresAt:    body.expiresAt,
      emailSent:    body.emailSent === true,
    })
    if (body.emailSent === true) {
      toast.success(`Invite emailed to ${body.email}`)
    }
    form.reset()
    fetchUsers()
  }

  const copyText = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      setTimeout(() => setCopied(null), 1500)
    } catch { /* clipboard blocked — the text is on screen to select */ }
  }, [])

  // Both row actions hit the same endpoint; `sendEmail` is the only
  // difference. Either way the invitee gets a brand-new link and the
  // previous one stops working — the panel says so.
  const resendInvite = useCallback(async (user: AdminUserRow, sendEmail: boolean) => {
    if (!tenantId) {
      toast.error('Select an active tenant first.')
      return
    }
    setResendingId(user.id)
    try {
      const res = await authFetch(`/api/admin/users/${user.id}/resend-invite`, tenantId, {
        method: 'POST',
        body:   JSON.stringify({ sendEmail }),
      })
      const body = await res.json().catch(() => ({ error: res.statusText }))
      if (!res.ok) {
        toast.error(body.error ?? 'Could not resend the invite')
        return
      }
      setInviteResult({
        action:    sendEmail ? 'resent' : 'link_only',
        email:     body.email,
        fullName:  body.fullName ?? '',
        inviteUrl: body.inviteUrl,
        expiresAt: body.expiresAt,
        emailSent: body.emailSent === true,
      })
      if (sendEmail && body.emailSent === true) toast.success(`Invite re-sent to ${body.email}`)
      // Best-effort convenience for the link-only path: the panel below is
      // the reliable copy affordance when the browser refuses a clipboard
      // write this far from the click.
      if (!sendEmail && body.inviteUrl) await copyText(body.inviteUrl, 'link')
    } catch {
      // A dropped connection here is indistinguishable from success to the
      // eye — the spinner just stops — so say so rather than fail silently.
      toast.error('Could not reach the server. Check your connection and try again.')
    } finally {
      setResendingId(null)
    }
  }, [tenantId, copyText])

  async function confirmRemove() {
    if (!removeTarget) return
    const target = removeTarget
    setRemoveTarget(null)
    if (!tenantId) {
      toast.error('Select an active tenant before removing users.')
      return
    }
    const res = await authFetch(`/api/admin/users?id=${encodeURIComponent(target.id)}`, tenantId, { method: 'DELETE' })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      toast.error(body.error ?? 'Could not remove user')
      return
    }
    toast.success(`Removed ${target.email}`)
    fetchUsers()
  }

  // Signed by whoever is actually inviting — every tenant's admin sends
  // their own invites, so a hard-coded signature would put the wrong name
  // on someone else's email.
  const signature = useMemo(() => {
    const name = profile?.full_name?.trim()
    return [name, profile?.email].filter(Boolean).join('\n')
  }, [profile])

  const emailTemplate = useMemo(() => {
    if (!inviteResult) return ''
    const displayName = inviteResult.fullName || inviteResult.email.split('@')[0]
    const signoff = signature ? `\n\n— ${signature}` : ''
    if (inviteResult.inviteUrl) {
      return `Hi ${displayName},

You've been invited to SoteriaField. Set up your account here:

  ${inviteResult.inviteUrl}

The link is just for you — it can be used once, it lets you choose
your own password (at least 8 characters), and it ${expiryPhrase(inviteResult.expiresAt)}.

If you have any trouble, reply to this email.${signoff}`
    }
    return `Hi ${displayName},

You've been invited to SoteriaField. Here's how to log in for the first time:

1. Open SoteriaField in your browser.
2. Sign in with:
     Email:     ${inviteResult.email}
     Password:  ${inviteResult.tempPassword ?? '(ask your admin)'}
3. On your first login you'll be asked to confirm your full name and set a new password of your own. Please use a password at least 8 characters long.

The temporary password above only works until you change it, and you must change it on first login.

If you have any trouble signing in, reply to this email.${signoff}`
  }, [inviteResult, signature])

  // DataTable columns. Memoised so TanStack Table doesn't see a new
  // reference on every render and reset its internal state.
  const columns = useMemo<ColumnDef<AdminUserRow>[]>(() => [
    {
      accessorKey: 'full_name',
      header:      'Name',
      cell: ({ row }) => {
        const u = row.original
        return (
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">
              {u.full_name || u.email.split('@')[0]}
            </span>
            {u.is_admin && <span className="safety-tag safety-tag-info">Admin</span>}
          </div>
        )
      },
    },
    {
      accessorKey: 'email',
      header:      'Email',
      cell: ({ row }) => (
        <span className="text-xs text-slate-500 dark:text-slate-400 truncate">{row.original.email}</span>
      ),
    },
    {
      id:          'status',
      header:      'Status',
      cell: ({ row }) => {
        const u = row.original
        if (!u.last_sign_in_at) return <span className="safety-tag safety-tag-caution">Invite pending</span>
        if (u.must_change_password) return <span className="safety-tag safety-tag-caution">Password change due</span>
        return <span className="safety-tag safety-tag-cleared">Active</span>
      },
    },
    {
      id:        'actions',
      header:    () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => {
        const u = row.original
        // Resending only makes sense while the invite is unaccepted. Once
        // someone has signed in, a new invite link would be a password
        // reset in disguise — the server rejects it, so we don't offer it.
        const pending = !u.last_sign_in_at
        const busy = resendingId === u.id
        return (
          <div className="flex items-center justify-end gap-1">
            {pending && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={() => resendInvite(u, true)}
                  aria-label={`Resend invite email to ${u.email}`}
                  title="Resend invite email"
                >
                  {busy ? <Loader2 className="animate-spin" /> : <Send />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busy}
                  onClick={() => resendInvite(u, false)}
                  aria-label={`Copy invite link for ${u.email}`}
                  title="Get a link to share yourself"
                >
                  <LinkIcon />
                </Button>
              </>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setRemoveTarget(u)}
              aria-label={`Remove ${u.email}`}
            >
              <Trash2 />
            </Button>
          </div>
        )
      },
    },
  ], [resendInvite, resendingId])

  if (authLoading || tenantLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="h-6 w-6 animate-spin text-slate-400 dark:text-slate-500" /></div>
  }
  if (!canManage) {
    return <div className="flex items-center justify-center min-h-[60vh] text-sm text-slate-500 dark:text-slate-400">Admins only.</div>
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <header className="flex items-center gap-3">
        <Link href="/" className="text-slate-400 dark:text-slate-500 hover:text-brand-navy" aria-label="Back to dashboard">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Shield className="h-5 w-5 text-slate-500 dark:text-slate-400" />
            User Management
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Invite users, re-send a pending invite, or grab the link to share yourself when our email lands in junk.
          </p>
        </div>
      </header>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100">
        This page is being replaced by the unified{' '}
        <Link href="/admin/people/members" className="font-semibold underline hover:text-amber-700 dark:hover:text-amber-200">
          Members page
        </Link>
        . Role management still works here.
      </div>

      {/* Invite form — react-hook-form + zod */}
      <section className="bg-white dark:bg-slate-900 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 p-5">
        <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          Invite a user
        </h2>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onInvite)}
            className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end"
          >
            <FormField
              control={form.control}
              name="fullName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Full name (optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="Jane Doe" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-xs">Email</FormLabel>
                  <FormControl>
                    <div className="relative">
                      <Mail className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <Input type="email" placeholder="user@example.com" className="pl-9" {...field} />
                    </div>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? <Loader2 className="animate-spin" /> : <UserPlus />}
              {form.formState.isSubmitting ? 'Inviting…' : 'Invite'}
            </Button>
          </form>
        </Form>
      </section>

      {/* One panel for every way a link reaches the invitee — a new invite,
          a resend, or a link the admin will send themselves. The link is
          shown once: it is only recoverable by minting another one, which
          would retire the one already on screen. */}
      {inviteResult && (
        <section className={`rounded-xl p-5 ring-1 ${
          emailFailed(inviteResult)
            ? 'bg-amber-50 ring-amber-200 dark:bg-amber-950/40'
            : 'bg-emerald-50 ring-emerald-200 dark:bg-emerald-950/40'
        }`}>
          <div className="flex items-start gap-3">
            {emailFailed(inviteResult)
              ? <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-700 dark:text-amber-300" />
              : inviteResult.action === 'link_only'
                ? <LinkIcon className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700 dark:text-emerald-300" />
                : <MailCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-700 dark:text-emerald-300" />}

            <div className="min-w-0 flex-1">
              <h2 className={`text-sm font-bold ${emailFailed(inviteResult) ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100'}`}>
                {headlineFor(inviteResult)}
              </h2>
              <p className={`mt-1 text-xs ${emailFailed(inviteResult) ? 'text-amber-800 dark:text-amber-200' : 'text-emerald-800 dark:text-emerald-200'}`}>
                {subheadFor(inviteResult)}
              </p>

              {inviteResult.inviteUrl && (
                <>
                  <div className="mt-3 flex items-center gap-2 rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                    <code className="min-w-0 break-all font-mono text-[11px]">{inviteResult.inviteUrl}</code>
                    <button
                      type="button"
                      onClick={() => copyText(inviteResult.inviteUrl!, 'link')}
                      className="shrink-0 text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                      aria-label="Copy invite link"
                    >
                      {copied === 'link' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-400">
                    Single use · {expiryPhrase(inviteResult.expiresAt)} · replaces any earlier link for {inviteResult.email}
                  </p>
                </>
              )}

              {/* Open by default exactly when the admin is the one doing the
                  sending — otherwise it is a fallback and stays folded. */}
              <details className="mt-3 text-xs" open={inviteResult.action === 'link_only' || emailFailed(inviteResult)}>
                <summary className="cursor-pointer font-semibold hover:underline">
                  Ready-to-send message {inviteResult.tempPassword ? '& temporary password' : ''}
                </summary>
                <div className="mt-2 flex justify-end">
                  <Button type="button" variant="outline" size="sm" onClick={() => copyText(emailTemplate, 'message')}>
                    <Copy />
                    {copied === 'message' ? 'Copied' : 'Copy message'}
                  </Button>
                </div>
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 font-mono text-xs text-slate-800 ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-200 dark:ring-slate-700">
{emailTemplate}
                </pre>
                {inviteResult.tempPassword && (
                  <div className="mt-2 inline-flex items-center gap-2 rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-700">
                    <code className="font-mono text-sm tracking-wide">{inviteResult.tempPassword}</code>
                    <button
                      type="button"
                      onClick={() => copyText(inviteResult.tempPassword!, 'password')}
                      className="text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
                      aria-label="Copy password"
                    >
                      {copied === 'password' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                )}
              </details>
            </div>
          </div>
        </section>
      )}

      {/* User list — TanStack DataTable with sort + filter + paginate */}
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Users</h2>
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">{users.length}</span>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400 dark:text-slate-500" />
          </div>
        ) : loadError ? (
          <p className="px-5 py-6 text-sm text-rose-700 dark:text-rose-300">{loadError}</p>
        ) : (
          <DataTable
            columns={columns}
            data={users}
            searchColumn="email"
            searchPlaceholder="Filter by email…"
          />
        )}
      </section>

      {/* Delete confirmation — replaces window.confirm */}
      <AlertDialog open={removeTarget != null} onOpenChange={open => { if (!open) setRemoveTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.email}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the user from this tenant. Their audit history is retained.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} className="bg-destructive text-white hover:bg-destructive/90">
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// "We tried to email this and it didn't go" — the only state that is a
// problem. A link the admin asked to deliver themselves has emailSent
// false too, and that one is working as intended.
function emailFailed(result: InviteResult): boolean {
  return result.action !== 'link_only' && !result.emailSent
}

function headlineFor(result: InviteResult): string {
  if (emailFailed(result)) return `Invite link ready — but the email didn't send`
  if (result.action === 'link_only') return `Invite link ready to share for ${result.email}`
  if (result.action === 'resent') return `Invite re-sent to ${result.email}`
  return `Invitation emailed to ${result.email}`
}

function subheadFor(result: InviteResult): string {
  const who = result.fullName || result.email.split('@')[0]
  if (emailFailed(result)) {
    return `Email delivery failed or isn't configured. Send ${who} the link below yourself — it is shown once.`
  }
  if (result.action === 'link_only') {
    return `Nothing was emailed. Paste this into your own email, Teams, or a text — however ${who} will actually see it.`
  }
  return `${who} gets a single-use link to choose their own password (≥ 8 characters). No password is sent in the email. If it lands in junk, use the link below instead.`
}

// Invite links are minted with a multi-day TTL, so a date is more useful to
// paste into a message than a countdown.
function expiryPhrase(expiresAt: string | undefined): string {
  if (!expiresAt) return 'expires in about 2 weeks'
  const when = new Date(expiresAt)
  if (Number.isNaN(when.getTime())) return 'expires in about 2 weeks'
  return `expires ${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
}
