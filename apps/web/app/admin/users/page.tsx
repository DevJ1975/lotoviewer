'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { ArrowLeft, Check, Copy, Loader2, Mail, MailCheck, Shield, Trash2, UserPlus } from 'lucide-react'
import { z } from 'zod'

import { useAuth } from '@/components/AuthProvider'
import {
  AlertDialog,
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

  const [justInvited, setJustInvited] = useState<{ email: string; fullName: string; tempPassword: string; emailSent: boolean } | null>(null)
  const [copied, setCopied] = useState(false)

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
    setJustInvited({
      email:        body.email,
      fullName:     body.fullName ?? '',
      tempPassword: body.tempPassword,
      emailSent:    body.emailSent === true,
    })
    if (body.emailSent === true) {
      toast.success(`Invite emailed to ${body.email}`)
    }
    form.reset()
    fetchUsers()
  }

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

  const emailTemplate = useMemo(() => {
    if (!justInvited) return ''
    const displayName = justInvited.fullName || justInvited.email.split('@')[0]
    return `Hi ${displayName},

You've been invited to SoteriaField. Here's how to log in for the first time:

1. Open SoteriaField in your browser.
2. Sign in with:
     Email:     ${justInvited.email}
     Password:  ${justInvited.tempPassword}
3. On your first login you'll be asked to confirm your full name and set a new password of your own. Please use a password at least 8 characters long.

The temporary password above only works until you change it, and you must change it on first login.

If you have any trouble signing in, reply to this email.

— Jamil
jamil@trainovations.com`
  }, [justInvited])

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
      cell: ({ row }) =>
        row.original.must_change_password ? (
          <span className="safety-tag safety-tag-caution">Pending First Login</span>
        ) : (
          <span className="safety-tag safety-tag-cleared">Active</span>
        ),
    },
    {
      id:        'actions',
      header:    () => <span className="sr-only">Actions</span>,
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setRemoveTarget(row.original)}
          aria-label={`Remove ${row.original.email}`}
        >
          <Trash2 />
        </Button>
      ),
    },
  ], [])

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
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Invite users and copy the welcome email to send them.</p>
        </div>
      </header>

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

      {/* Result panel for the most recent invite. Two shapes:
          • emailSent=true  — green confirmation, password shown small as
            a fallback in case the email got caught by spam.
          • emailSent=false — full copy-paste template (legacy behavior),
            so the admin can paste into their own email client. */}
      {justInvited && justInvited.emailSent && (
        <section className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl ring-1 ring-emerald-200 p-5">
          <div className="flex items-start gap-3">
            <MailCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> Invitation emailed to {justInvited.email}
              </h2>
              <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                {(justInvited.fullName || justInvited.email.split('@')[0])} will receive a sign-in link with their one-time password.
                On first login they&apos;ll be required to set their own password (≥ 8 characters).
              </p>
              <details className="mt-3 text-xs text-emerald-900 dark:text-emerald-100">
                <summary className="cursor-pointer font-semibold hover:underline">
                  Show one-time password (in case the email gets lost)
                </summary>
                <div className="mt-2 inline-flex items-center gap-2 bg-white dark:bg-slate-900 rounded-md px-3 py-1.5 ring-1 ring-emerald-200">
                  <code className="text-sm font-mono tracking-wide">{justInvited.tempPassword}</code>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(justInvited.tempPassword)
                        setCopied(true); setTimeout(() => setCopied(false), 1500)
                      } catch { /* ignore */ }
                    }}
                    className="text-emerald-700 dark:text-emerald-300 hover:text-emerald-900 dark:hover:text-emerald-100"
                    aria-label="Copy password"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  {copied && <span className="text-[11px] text-emerald-700 dark:text-emerald-300">copied</span>}
                </div>
              </details>
            </div>
          </div>
        </section>
      )}

      {justInvited && !justInvited.emailSent && (
        <section className="bg-amber-50 dark:bg-amber-950/40 rounded-xl ring-1 ring-amber-200 p-5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h2 className="text-sm font-bold text-amber-900 dark:text-amber-100">Invite created — email not sent</h2>
              <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
                The user is created but Resend isn&apos;t configured (or the send failed). Copy this into your email to {justInvited.email}.
                The password is shown once; save it if you lose the window.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(emailTemplate)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 1500)
                } catch { /* ignore */ }
              }}
            >
              <Copy />
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <pre className="whitespace-pre-wrap text-xs font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-900 rounded-lg p-3 ring-1 ring-amber-200 max-h-80 overflow-auto">
{emailTemplate}
          </pre>
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

      {/* Delete confirmation — replaces window.confirm.
          The action button is a plain <Button>, NOT an AlertDialogAction
          (which is Base UI's Close primitive). Base UI's AlertDialog
          forces modal + disablePointerDismissal, and when an onClick
          handler ALSO drives close via setRemoveTarget(null), the two
          paths race and the backdrop sticks — the page appears frozen.
          Driving close through controlled state alone is reliable. */}
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
            <Button
              type="button"
              variant="destructive"
              onClick={confirmRemove}
            >
              Remove
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
