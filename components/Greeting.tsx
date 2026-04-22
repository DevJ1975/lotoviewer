'use client'

import { useAuth } from '@/components/AuthProvider'

export function timeOfDayGreeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function firstName(fullName: string | null | undefined): string {
  if (!fullName) return ''
  return fullName.trim().split(/\s+/)[0] ?? ''
}

export default function Greeting({ className = '' }: { className?: string }) {
  const { profile, email } = useAuth()
  const name = firstName(profile?.full_name) || (email ? email.split('@')[0] : '')
  if (!name) return null
  return (
    <span className={`text-sm font-medium ${className}`}>
      {timeOfDayGreeting()}, <span className="font-semibold">{name}</span>
    </span>
  )
}
