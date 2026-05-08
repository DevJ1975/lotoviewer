'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

// Round avatar with graceful fallback to a coloured initial. Used in:
//   - UserMenu (header, dropdown header)
//   - login screen (last-login hint)
//   - chat messages, action-item comments, safety boards (Phases 2-4)
//
// Falls back to the initial whenever:
//   - src is null/empty
//   - the image fails to load (broken URL, deleted storage object, offline)
// The brand-yellow / brand-navy palette matches the previous initial-only
// circle in UserMenu so this is a visual no-op for users without an avatar.

type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZE_PX: Record<Size, number> = {
  xs: 20,
  sm: 28,
  md: 36,
  lg: 48,
  xl: 64,
}

const SIZE_CLASS: Record<Size, string> = {
  xs: 'w-5 h-5 text-[10px]',
  sm: 'w-7 h-7 text-xs',
  md: 'w-9 h-9 text-sm',
  lg: 'w-12 h-12 text-base',
  xl: 'w-16 h-16 text-lg',
}

export interface AvatarProps {
  src?: string | null
  name?: string | null
  email?: string | null
  size?: Size
  className?: string
  alt?: string
}

function initial(name: string | null | undefined, email: string | null | undefined): string {
  const fromName  = name?.trim()?.[0]
  const fromEmail = email?.trim()?.[0]
  return (fromName ?? fromEmail ?? '?').toUpperCase()
}

export function Avatar({
  src,
  name,
  email,
  size = 'sm',
  className,
  alt,
}: AvatarProps) {
  // Track failed loads so we can fall back to the initial without flicker
  // on subsequent renders. Reset whenever src changes by keying on it.
  const [failed, setFailed] = useState(false)
  const px = SIZE_PX[size]
  const showImage = !!src && !failed

  const initials = initial(name, email)
  const labelAlt = alt ?? name ?? email ?? 'User avatar'

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full overflow-hidden font-bold bg-brand-yellow text-brand-navy',
        SIZE_CLASS[size],
        className,
      )}
      aria-label={labelAlt}
    >
      {showImage ? (
        <img
          src={src!}
          alt={labelAlt}
          width={px}
          height={px}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
          // Keying by src ensures the <img> remounts (and `failed` resets)
          // when the URL changes — for example after the user uploads a
          // new avatar with a fresh ?v=<ts> cache-bust suffix.
          key={src}
        />
      ) : (
        <span aria-hidden="true">{initials}</span>
      )}
    </span>
  )
}

export default Avatar
