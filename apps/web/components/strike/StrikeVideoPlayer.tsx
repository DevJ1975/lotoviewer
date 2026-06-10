'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

// Hardened STRIKE playback surface. Three deterrents stack here:
//   1. Download friction — no download control, no PiP, no context menu.
//      (Determined users can still screen-record; the watermark is for them.)
//   2. Visible watermark — viewer identity + live timestamp, cycling corners
//      so a static crop can't remove it, tying any leaked capture to a person.
//   3. Expiring sources — playback URLs die in minutes; onExpired lets the
//      page mint a fresh one without interrupting the learner.

export interface WatchProgress {
  percent_watched: number
  max_position_seconds: number
  duration_seconds: number | null
}

interface StrikeVideoPlayerProps {
  src: string
  provider: 'storage' | 'cloudflare'
  captionsSrc?: string | null
  watermarkText: string
  onProgress?: (progress: WatchProgress) => void
  onExpired?: () => void
}

const WATERMARK_CORNERS = [
  'left-3 top-3',
  'right-3 top-3',
  'right-3 bottom-12',
  'left-3 bottom-12',
] as const

export function StrikeVideoPlayer({
  src,
  provider,
  captionsSrc,
  watermarkText,
  onProgress,
  onExpired,
}: StrikeVideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const maxPositionRef = useRef(0)
  const lastReportedPercentRef = useRef(-1)
  const [cornerIndex, setCornerIndex] = useState(0)
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString())

  // Keep callback identity churn (inline lambdas from the page) from
  // re-running the source effect and restarting playback.
  const onExpiredRef = useRef(onExpired)
  const onProgressRef = useRef(onProgress)
  useEffect(() => {
    onExpiredRef.current = onExpired
    onProgressRef.current = onProgress
  }, [onExpired, onProgress])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    if (provider === 'storage' || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      return
    }

    let hls: { destroy: () => void } | null = null
    let cancelled = false
    void import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !videoRef.current) return
      if (!Hls.isSupported()) {
        videoRef.current.src = src
        return
      }
      const instance = new Hls()
      instance.loadSource(src)
      instance.attachMedia(videoRef.current)
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) onExpiredRef.current?.()
      })
      hls = instance
    })
    return () => {
      cancelled = true
      hls?.destroy()
    }
  }, [src, provider])

  useEffect(() => {
    const interval = setInterval(() => {
      setCornerIndex(index => (index + 1) % WATERMARK_CORNERS.length)
      setClock(new Date().toLocaleTimeString())
    }, 15_000)
    return () => clearInterval(interval)
  }, [])

  const handleTimeUpdate = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    maxPositionRef.current = Math.max(maxPositionRef.current, video.currentTime)
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const percent = duration
      ? Math.min(100, Math.round((maxPositionRef.current / duration) * 100))
      : 0
    if (percent === lastReportedPercentRef.current) return
    lastReportedPercentRef.current = percent
    onProgressRef.current?.({
      percent_watched: percent,
      max_position_seconds: Math.round(maxPositionRef.current),
      duration_seconds: duration ? Math.round(duration) : null,
    })
  }, [])

  const handleError = useCallback(() => {
    // A media error after the source was healthy usually means the signed
    // URL expired mid-session; let the page mint a fresh one.
    if (maxPositionRef.current > 0) onExpiredRef.current?.()
  }, [])

  return (
    <div className="relative">
      <video
        ref={videoRef}
        controls
        controlsList="nodownload noremoteplayback"
        disablePictureInPicture
        crossOrigin="anonymous"
        onContextMenu={e => e.preventDefault()}
        onTimeUpdate={handleTimeUpdate}
        onError={handleError}
        className="aspect-video w-full rounded-lg bg-black"
      >
        {captionsSrc && <track kind="captions" src={captionsSrc} default />}
      </video>
      <span
        aria-hidden
        className={`pointer-events-none absolute select-none rounded bg-black/30 px-2 py-0.5 text-[11px] font-medium text-white/60 ${WATERMARK_CORNERS[cornerIndex]}`}
      >
        {watermarkText} · {clock}
      </span>
    </div>
  )
}
