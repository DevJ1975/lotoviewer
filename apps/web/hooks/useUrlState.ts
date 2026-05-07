'use client'

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Reads + writes a single URL search-param key. Wraps the
// usePathname / useSearchParams / useRouter trifecta so list pages
// don't reinvent it five different ways.
//
// Why bother: search/filter/sort UI state was previously ephemeral
// useState — refresh, browser back, share-link, all dropped the
// state. Lifting it into the URL costs three lines (the hook) and
// gets shareable filtered views for free.
//
// Default values are returned when the param is absent. Setting a
// value EQUAL to the default REMOVES the key, keeping URLs short
// in the common case (filter=open is implicit; only filter=archive
// shows in the address bar).
//
// Updates use router.replace (not push) so back-button navigates
// across pages, not across keystrokes — matching the search-bar
// convention everyone expects.

export function useUrlState<T extends string>(
  key: string,
  defaultValue: T,
): [T, (next: T) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const value = (params.get(key) as T | null) ?? defaultValue

  const setValue = useCallback((next: T) => {
    const sp = new URLSearchParams(params)
    if (next === defaultValue || next === '') sp.delete(key)
    else sp.set(key, next)
    const qs = sp.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [key, defaultValue, params, pathname, router])

  return [value, setValue]
}
