'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, History, LogOut, Mail, Shield, UserRound, UserRoundCog } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'
import ThemeToggle from '@/components/ThemeToggle'
import { Avatar } from '@/components/ui/Avatar'

export default function UserMenu() {
  const { email, profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return
      if (!ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  if (!email) return null
  const display = profile?.full_name || email

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/10 dark:hover:bg-slate-900/10 transition-colors"
      >
        <Avatar
          src={profile?.avatar_url}
          name={profile?.full_name}
          email={email}
          size="sm"
        />
        <span className="hidden sm:inline font-medium text-white max-w-[160px] truncate">{display}</span>
        <ChevronDown className="h-4 w-4 text-white/70" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-60 rounded-lg bg-white dark:bg-slate-900 ring-1 ring-slate-200 dark:ring-slate-700 shadow-lg z-50 py-1">
          <div className="flex items-center gap-3 px-3 py-2 text-xs text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800">
            <Avatar
              src={profile?.avatar_url}
              name={profile?.full_name}
              email={email}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium text-slate-700 dark:text-slate-200 truncate">{display}</div>
              <div className="truncate">{email}</div>
            </div>
          </div>
          {profile?.is_admin && (
            <>
              <Link
                href="/admin/people/members"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <Shield className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                Member Management
              </Link>
              <Link
                href="/admin/evidence/audit"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
              >
                <History className="h-4 w-4 text-slate-400 dark:text-slate-500" />
                Audit Log
              </Link>
            </>
          )}
          <Link
            href="/welcome"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <UserRound className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            Account & Password
          </Link>
          <Link
            href="/settings/profile"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <UserRoundCog className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            My Profile
          </Link>
          <Link
            href="/settings/digest"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <Mail className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            Email digests
          </Link>

          {/* Theme picker — sits between profile and sign out so it's
              easy to find but doesn't interrupt the action items. */}
          <div className="border-t border-slate-100 dark:border-slate-800 mt-1 pt-2 px-3 pb-2">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-1">Theme</p>
            <ThemeToggle className="w-full justify-between" />
          </div>

          <button
            type="button"
            onClick={() => { setOpen(false); signOut() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 border-t border-slate-100 dark:border-slate-800"
          >
            <LogOut className="h-4 w-4 text-slate-400 dark:text-slate-500" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
