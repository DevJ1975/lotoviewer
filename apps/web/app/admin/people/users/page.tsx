'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import type { ColumnDef } from '@tanstack/react-table'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { ArrowLeft, Check, Loader2, Mail, MailCheck, Shield, Trash2, UserPlus } from 'lucide-react'
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
  email_verified:       boolean
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

  const [justInvited, setJustInvited] = useState<{ email: string; fullName: string; emailSent: boolean; alreadyExisted: boolean } | null>(null)

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
      email:          body.email,
      fullName:       body.fullName ?? '',
      emailSent:      body.emailSent === true,
      alreadyExisted: body.alreadyExisted === true,
    })
    if (body.emailSent === true) {
      toast.success(`Verification email sent to ${body.email}`)
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
        if (!u.email_verified) return <span className="safety-tag safety-tag-caution">Pending Verification</span>
        if (u.must_change_password) return <span className="safety-tag safety-tag-caution">Setup Incomplete</span>
        return <span className="safety-tag safety-tag-cleared">Active</span>
      },
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

      {/* Result panel for the most recent invite.
          • emailSent=true  — confirmation that the verification email went out.
          • emailSent=false — the send failed (e.g. Resend not configured);
            prompt the admin to fix email and re-invite. No credential is ever
            shown — the verification link is the only way in, and it's emailed
            directly to the recipient, never surfaced here. */}
      {justInvited && justInvited.emailSent && (
        <section className="bg-emerald-50 dark:bg-emerald-950/40 rounded-xl ring-1 ring-emerald-200 p-5">
          <div className="flex items-start gap-3">
            <MailCheck className="h-6 w-6 text-emerald-700 dark:text-emerald-300 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold text-emerald-900 dark:text-emerald-100 flex items-center gap-1.5">
                <Check className="h-4 w-4" />
                {justInvited.alreadyExisted ? 'Notified' : 'Verification email sent to'} {justInvited.email}
              </h2>
              <p className="text-xs text-emerald-800 dark:text-emerald-200 mt-1">
                {justInvited.alreadyExisted
                  ? `${justInvited.fullName || justInvited.email.split('@')[0]} already has an account — they've been added to this tenant and notified.`
                  : `${justInvited.fullName || justInvited.email.split('@')[0]} will get a link to verify their email and set their own password. They show as "Pending Verification" until they open it.`}
              </p>
            </div>
          </div>
        </section>
      )}

      {justInvited && !justInvited.emailSent && (
        <section className="bg-amber-50 dark:bg-amber-950/40 rounded-xl ring-1 ring-amber-200 p-5">
          <h2 className="text-sm font-bold text-amber-900 dark:text-amber-100">Account created — email not sent</h2>
          <p className="text-xs text-amber-800 dark:text-amber-200 mt-0.5">
            {justInvited.email} couldn&apos;t be emailed (Resend isn&apos;t configured, or the send failed). The verification
            link is the only way in and can&apos;t be shared from here — fix email delivery, then invite {justInvited.email} again to resend it.
          </p>
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
