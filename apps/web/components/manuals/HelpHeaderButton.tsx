'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'

// Header link → /manuals. Visible to every authenticated user.
// Icon + "Wiki" label on md+; icon-only on narrow viewports to keep
// the chrome from wrapping. No badge, no polling — manuals are
// platform-wide and reading them isn't a per-tenant signal.

export default function HelpHeaderButton() {
  return (
    <Link
      href="/manuals"
      aria-label="Wiki"
      title="Wiki"
      className="text-white/80 hover:text-white hover:bg-white/10 rounded-md h-10 px-2 md:px-3 flex items-center gap-1.5 transition-colors"
    >
      <BookOpen className="h-5 w-5" />
      <span className="hidden md:inline text-sm font-medium">Wiki</span>
    </Link>
  )
}
