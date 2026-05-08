'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import { useTenant } from '@/components/TenantProvider'
import { fetchUnreadTotal } from '@/lib/chat/client'

// Header button → /chat with an unread badge. Polls /api/chat/unread
// every 30s while the tab is visible. The chat page itself updates
// counts more aggressively when a channel is open; this is just for
// the "unread elsewhere" awareness when the user isn't on /chat.

const POLL_MS = 30_000

export default function ChatHeaderButton() {
  const { tenant } = useTenant()
  const [unread, setUnread] = useState<number>(0)

  useEffect(() => {
    if (!tenant?.id) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      try {
        const n = await fetchUnreadTotal(tenant!.id)
        if (!cancelled) setUnread(n)
      } catch { /* network — leave the previous count */ }
    }
    function start() {
      if (timer) return
      void poll()
      timer = setInterval(poll, POLL_MS)
    }
    function stop() {
      if (timer) { clearInterval(timer); timer = null }
    }
    function onVisibility() {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      stop()
    }
  }, [tenant])

  return (
    <Link
      href="/chat"
      aria-label="Open chat"
      className="relative text-white/80 hover:text-white hover:bg-white/10 rounded-md h-10 w-10 flex items-center justify-center transition-colors"
      title={unread > 0 ? `${unread} unread` : 'Chat'}
    >
      <MessageSquare className="h-5 w-5" />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold px-1">
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  )
}
