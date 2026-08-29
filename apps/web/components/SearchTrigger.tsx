'use client'

import { Search } from 'lucide-react'

// Header control that opens the command palette. It is a button, not an input,
// because there is exactly one search surface now and it lives in the palette
// — a second text field in the header would re-create the split this replaced,
// where the box a user could see searched equipment only and the box that
// searched pages was invisible behind ⌘K.
//
// Same event contract as the drawer's search stub (AppDrawer), so both
// entry points route to the one palette instance in AppChrome.

export default function SearchTrigger({ className = '' }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event('soteria:open-command-palette'))}
      // aria-keyshortcuts announces ⌘K to assistive tech; the visible kbd hint
      // is decorative and hidden from the accessibility tree.
      aria-keyshortcuts="Meta+K Control+K"
      className={`motion-press flex h-8 w-full items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 text-left text-sm text-white/60 transition-colors hover:border-brand-yellow/40 hover:bg-white/15 hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-yellow/50 ${className}`}
    >
      <Search className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">Search pages, modules, equipment…</span>
      <kbd
        aria-hidden="true"
        className="hidden rounded border border-white/25 px-1.5 py-0.5 font-mono text-[10px] text-white/50 sm:inline-block"
      >
        ⌘K
      </kbd>
    </button>
  )
}
