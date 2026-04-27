'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

// Three-state theme: explicit 'light' / 'dark' or 'system' which tracks the
// OS preference. Stored in localStorage as the same string. Default is
// 'system' so a brand-new visitor gets whatever their OS is set to.
export type ThemeMode = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'soteria.theme'

interface ThemeContextValue {
  // What the user picked (or 'system' if they never picked).
  mode:     ThemeMode
  // What's actually applied right now after resolving 'system'.
  resolved: 'light' | 'dark'
  setMode:  (m: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>')
  return ctx
}

// Inline <script> string injected into <head> from the server-rendered
// layout. Runs synchronously before paint to apply the dark class so the
// page never flashes light-on-dark. Mirrors the pattern next-themes uses.
//
// Exported as a string (not a component) because Next 16's RSC <head>
// merging can drop client-island scripts. Embedding via
// <script dangerouslySetInnerHTML> guarantees it lands.
export const NO_FLASH_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var mode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    var dark = mode === 'dark' || (mode === 'system' && prefersDark);
    var cl = document.documentElement.classList;
    if (dark) cl.add('dark'); else cl.remove('dark');
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) { /* no-op: pre-paint script must never throw */ }
})();
`.trim()

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Lazy initial read so we don't double-apply on hydration. The inline
  // <head> script has already set the class — we just observe + persist.
  const [mode, setModeState] = useState<ThemeMode>('system')
  const [resolved, setResolved] = useState<'light' | 'dark'>('light')

  // Initial sync after mount: read the stored preference and reconcile
  // state with what the no-flash script already painted.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null
    const initial: ThemeMode = stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system'
    setModeState(initial)
    setResolved(currentlyDark() ? 'dark' : 'light')
  }, [])

  // Apply changes when mode changes: write to localStorage + toggle the
  // class. We also want 'system' mode to react live to OS preference
  // flips (user changes OS theme while the tab is open).
  useEffect(() => {
    apply(mode)
    setResolved(currentlyDark() ? 'dark' : 'light')

    if (mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    function onChange() {
      apply('system')
      setResolved(currentlyDark() ? 'dark' : 'light')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [mode])

  const setMode = useCallback((m: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, m)
    } catch {
      // localStorage can throw in private mode / disabled storage —
      // fall through and just apply the class for the session.
    }
    setModeState(m)
  }, [])

  return (
    <ThemeContext.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeContext.Provider>
  )
}

// Pure helpers — kept module-level so the no-flash script + provider
// stay in lockstep on the resolution rules.

function currentlyDark(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

function apply(mode: ThemeMode): void {
  if (typeof document === 'undefined') return
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const dark = mode === 'dark' || (mode === 'system' && prefersDark)
  const cl = document.documentElement.classList
  if (dark) cl.add('dark'); else cl.remove('dark')
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}
