'use client'

import { useCallback, useEffect, useRef } from 'react'
import type { StrikeBlockEvent } from '@soteria/core/strikeContent'

export interface QueuedBlockEvent {
  block_key: string
  event: StrikeBlockEvent
  dwell_ms?: number
  detail?: Record<string, unknown>
}

const FLUSH_DELAY_MS = 1200
const MAX_BATCH = 50

/**
 * Batches block events and posts them through an injected transport (the
 * signed-in and kiosk players authenticate differently). `flush()` resolves
 * once everything queued so far is delivered — the quiz submit awaits it so
 * the server sees the final "completed" event before it checks evidence.
 */
export function useBlockEventQueue(send: (events: QueuedBlockEvent[]) => Promise<void>) {
  const queue = useRef<QueuedBlockEvent[]>([])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflight = useRef<Promise<void>>(Promise.resolve())
  const sendRef = useRef(send)
  useEffect(() => { sendRef.current = send }, [send])

  const flush = useCallback((): Promise<void> => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    // Chained so batches stay ordered; a failed batch goes back on the queue
    // and is retried by the next flush rather than lost.
    inflight.current = inflight.current.then(async () => {
      while (queue.current.length > 0) {
        const batch = queue.current.splice(0, MAX_BATCH)
        try {
          await sendRef.current(batch)
        } catch {
          queue.current.unshift(...batch)
          return
        }
      }
    })
    return inflight.current
  }, [])

  const enqueue = useCallback((event: QueuedBlockEvent) => {
    queue.current.push(event)
    if (!timer.current) timer.current = setTimeout(() => { void flush() }, FLUSH_DELAY_MS)
  }, [flush])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return { enqueue, flush }
}
