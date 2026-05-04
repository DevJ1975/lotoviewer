'use client'

import Image from 'next/image'
import { useTenant } from '@/components/TenantProvider'

// Visual confirmation in the app header that the user is in the right
// tenant. Rendered between the brand mark and the global search.
//
// Layout (left → right):
//   [logo or initials] [tenant name]  [#0001]  [DEMO badge if is_demo]
//
// Mobile (below md): logo + #0001 only — tenant name truncates aggressively
// on narrow widths, and the brand mark to the left already takes space.

// Deterministic background color from the slug so initials stay stable
// across renders. Tailwind palette so dark mode covers itself.
const COLOR_PALETTE = [
  'bg-emerald-500', 'bg-sky-500', 'bg-violet-500',
  'bg-amber-500',   'bg-rose-500', 'bg-teal-500',
  'bg-fuchsia-500', 'bg-indigo-500',
] as const

function colorFromSlug(slug: string): string {
  let h = 0
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) | 0
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length]!
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export default function TenantHeaderPill() {
  const { tenant, loading } = useTenant()
  if (loading || !tenant) return null

  const logo = tenant.logo_url
  const colorClass = colorFromSlug(tenant.slug)

  return (
    <div className="flex items-center gap-2 min-w-0 px-2 py-1 rounded-md bg-white/5">
      {logo ? (
        <Image
          src={logo}
          alt={`${tenant.name} logo`}
          width={28}
          height={28}
          className="h-7 w-7 rounded-md object-contain bg-white shrink-0"
          unoptimized
        />
      ) : (
        <div
          className={`h-7 w-7 rounded-md flex items-center justify-center text-white text-[11px] font-bold shrink-0 ${colorClass}`}
          aria-hidden="true"
        >
          {initials(tenant.name)}
        </div>
      )}

      <span className="hidden sm:inline text-white/90 text-sm font-medium truncate max-w-[140px]">
        {tenant.name}
      </span>

      <span className="text-white/50 text-xs font-mono tracking-tight tabular-nums">
        #{tenant.tenant_number}
      </span>

      {tenant.is_demo && (
        <span className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-brand-yellow text-brand-navy tracking-wider">
          Demo
        </span>
      )}
    </div>
  )
}
