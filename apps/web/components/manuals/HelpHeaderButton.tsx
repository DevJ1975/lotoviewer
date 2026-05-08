'use client'

import Link from 'next/link'
import { BookOpen } from 'lucide-react'

// Header button → /manuals. Visible to every authenticated user.
// No badge, no polling — manuals are platform-wide and reading them
// isn't a per-tenant signal.

export default function HelpHeaderButton() {
  return (
    <Link
      href="/manuals"
      aria-label="User manuals"
      title="User manuals"
      className="text-white/80 hover:text-white hover:bg-white/10 rounded-md h-10 w-10 flex items-center justify-center transition-colors"
    >
      <BookOpen className="h-5 w-5" />
    </Link>
  )
}
