'use client'

import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'

// Top-of-page emergency banner shown only when expired permits exist.
// Tapping deep-links to the status board so the supervisor can verify
// evacuation and formally cancel each permit (§1910.146(e)(5)(ii)).

export function CriticalAlertBanner({ count }: { count: number }) {
  return (
    <Link
      href="/confined-spaces/status"
      className="block bg-rose-600 hover:bg-rose-700 text-white rounded-xl p-4 ring-2 ring-rose-300 ring-offset-2 transition-colors"
    >
      <div className="flex items-center gap-3">
        <AlertTriangle className="h-6 w-6 shrink-0" />
        <div className="flex-1">
          <p className="text-base sm:text-lg font-black">
            {count} permit{count === 1 ? '' : 's'} expired without cancellation
          </p>
          <p className="text-xs text-white/80 mt-0.5">
            OSHA §1910.146(e)(5)(ii) — verify evacuation, then formally cancel. Tap to open the status board.
          </p>
        </div>
      </div>
    </Link>
  )
}
