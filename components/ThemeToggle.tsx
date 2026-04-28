'use client'

import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/components/ThemeProvider'

// Compact 3-state segmented control (Light / Dark / System) for use in
// menus and settings rows. The full segmented form is preferable to a
// single cycle button because it shows the current selection at a
// glance — important for the System option, which doesn't have an
// obvious icon when active.
//
// Renders dark-style colors when the resolved theme is dark so the
// control remains legible in both modes.

interface SegmentDef {
  mode:  ThemeMode
  label: string
  Icon:  typeof Sun
}

const SEGMENTS: SegmentDef[] = [
  { mode: 'light',  label: 'Light',  Icon: Sun },
  { mode: 'dark',   label: 'Dark',   Icon: Moon },
  { mode: 'system', label: 'Auto',   Icon: Monitor },
]

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const { mode, setMode } = useTheme()
  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 ${className}`}
    >
      {SEGMENTS.map(s => {
        const active = mode === s.mode
        return (
          <button
            key={s.mode}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setMode(s.mode)}
            className={
              'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors '
              + (active
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-100')
            }
          >
            <s.Icon className="h-3.5 w-3.5" />
            {s.label}
          </button>
        )
      })}
    </div>
  )
}
