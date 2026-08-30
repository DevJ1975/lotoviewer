'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type VimeoPlayer from '@vimeo/player'

// Hardened STRIKE playback surface for Vimeo embeds. A determined viewer can
// still screen-record, so the deterrent is a visible watermark: viewer identity
// + a live timestamp, cycling corners so a static crop can't remove it, tying
// any leaked capture to a person. (Native no-download / no-PiP locks don't apply
// to an iframe — the watermark is what we have.) Watch progress comes from the
// Vimeo Player SDK and feeds the quiz's optional require-watch gate.

export interface WatchProgress {
  percent_watched: number
  max_position_seconds: number
  duration_seconds: number | null
}

interface StrikeVideoPlayerProps {
  src: string
  watermarkText: string
  onProgress?: (progress: WatchProgress) => void
}

const WATERMARK_CORNERS = [
  'left-3 top-3',
  'right-3 top-3',
  'right-3 bottom-12',
  'left-3 bottom-12',
] as const

export function StrikeVideoPlayer({ src, watermarkText, onProgress }: StrikeVideoPlayerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const maxPositionRef = useRef(0)
  const lastReportedPercentRef = useRef(-1)
  const [cornerIndex, setCornerIndex] = useState(0)
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString())

  // Keep callback identity churn (inline lambdas from the page) from
  // re-running the source effect and reloading the player.
  const onProgressRef = useRef(onProgress)
  useEffect(() => { onProgressRef.current = onProgress }, [onProgress])

  // Report against the furthest point reached, so seeking backwards never
  // lowers the recorded percentage. Throttled to whole-percent changes.
  const reportProgress = useCallback((seconds: number, duration: number) => {
    maxPositionRef.current = Math.max(maxPositionRef.current, seconds)
    const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : null
    const percent = safeDuration
      ? Math.min(100, Math.round((maxPositionRef.current / safeDuration) * 100))
      : 0
    if (percent === lastReportedPercentRef.current) return
    lastReportedPercentRef.current = percent
    onProgressRef.current?.({
      percent_watched: percent,
      max_position_seconds: Math.round(maxPositionRef.current),
      duration_seconds: safeDuration ? Math.round(safeDuration) : null,
    })
  }, [])

  useEffect(() => {
    if (!containerRef.current) return

    let player: VimeoPlayer | null = null
    let cancelled = false
    void import('@vimeo/player').then(({ default: Player }) => {
      if (cancelled || !containerRef.current) return
      // vimeoEmbedUrl always yields a player.vimeo.com/video/* URL; the cast
      // satisfies the SDK's template-literal VimeoUrl type for our string src.
      const instance = new Player(containerRef.current, {
        url: src as `https://player.vimeo.com/video/${string}`,
        dnt: true,
      })
      instance.on('timeupdate', data => reportProgress(data.seconds, data.duration))
      player = instance
    })
    return () => {
      cancelled = true
      void player?.destroy()
    }
  }, [src, reportProgress])

  useEffect(() => {
    const interval = setInterval(() => {
      setCornerIndex(index => (index + 1) % WATERMARK_CORNERS.length)
      setClock(new Date().toLocaleTimeString())
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black [&_iframe]:absolute [&_iframe]:inset-0 [&_iframe]:h-full [&_iframe]:w-full">
      <div ref={containerRef} className="h-full w-full" />
      <span
        aria-hidden
        className={`pointer-events-none absolute select-none rounded bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white/60 ${WATERMARK_CORNERS[cornerIndex]}`}
      >
        {watermarkText} · {clock}
      </span>
    </div>
  )
}
