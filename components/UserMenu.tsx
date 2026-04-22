'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { ChevronDown, LogOut, Shield, UserRound } from 'lucide-react'
import { useAuth } from '@/components/AuthProvider'

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
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-white/10 transition-colors"
      >
        <span className="w-7 h-7 rounded-full bg-brand-yellow text-brand-navy text-xs font-bold flex items-center justify-center">
          {(profile?.full_name?.[0] ?? email[0]).toUpperCase()}
        </span>
        <span className="hidden sm:inline font-medium text-white max-w-[160px] truncate">{display}</span>
        <ChevronDown className="h-4 w-4 text-white/70" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-56 rounded-lg bg-white ring-1 ring-slate-200 shadow-lg z-50 py-1">
          <div className="px-3 py-2 text-xs text-slate-500 border-b border-slate-100">
            <div className="font-medium text-slate-700 truncate">{display}</div>
            <div className="truncate">{email}</div>
          </div>
          {profile?.is_admin && (
            <Link
              href="/admin/users"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              <Shield className="h-4 w-4 text-slate-400" />
              User Management
            </Link>
          )}
          <Link
            href="/welcome"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <UserRound className="h-4 w-4 text-slate-400" />
            Profile & Password
          </Link>
          <button
            type="button"
            onClick={() => { setOpen(false); signOut() }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4 text-slate-400" />
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
