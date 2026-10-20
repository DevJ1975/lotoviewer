'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Captions, CaptionsOff, CheckCircle2, Pause, Play, RotateCcw } from 'lucide-react'
import { formatDuration, type StrikeMotionSceneBlock } from '@soteria/core/strikeContent'

interface MotionSceneProps {
  block: StrikeMotionSceneBlock
  index: number
  urls: Record<string, string>
  completed: boolean
  captionsOn: boolean
  onToggleCaptions: () => void
  onCompleted: () => void
}

// A narrated "motion slide": the still drifts (Ken Burns / pan) for exactly
// the narration's length while beats reveal on their cue times. Text stays
// live HTML, so it is crisp, selectable, translatable and screen-readable —
// the reason scenes are rendered rather than shipped as a video file.
export function MotionScene({ block, index, urls, completed, captionsOn, onToggleCaptions, onCompleted }: MotionSceneProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [positionMs, setPositionMs] = useState(0)
  const [cue, setCue] = useState<string | null>(null)

  const narration = block.narration
  const durationMs = narration?.duration_ms ?? 0
  const imageUrl = block.image ? urls[block.image.path] : undefined
  const audioUrl = narration ? urls[narration.audio_path] : undefined
  const captionsUrl = narration ? urls[narration.captions_path] : undefined
  // Silent scenes show every beat at once; narrated scenes reveal on cue.
  const visibleBeats = narration ? block.beats.filter(b => b.at_ms <= positionMs) : block.beats

  useEffect(() => {
    const track = audioRef.current?.textTracks?.[0]
    if (!track) return
    track.mode = 'hidden'
    const onCueChange = () => {
      const active = track.activeCues?.[0] as VTTCue | undefined
      setCue(active?.text ?? null)
    }
    track.addEventListener('cuechange', onCueChange)
    return () => track.removeEventListener('cuechange', onCueChange)
  }, [captionsUrl])

  function togglePlay() {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) void audio.play()
    else audio.pause()
  }

  function replay() {
    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = 0
    setPositionMs(0)
    void audio.play()
  }

  const mediaStyle = {
    '--scene-ms': `${Math.max(durationMs, 8000)}ms`,
    '--scene-play': playing ? 'running' : 'paused',
  } as CSSProperties

  return (
    <article aria-labelledby={`${block.key}-title`} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-950 shadow-sm dark:border-slate-800">
      <div className="relative aspect-video overflow-hidden">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL; next/image would cache it past expiry
          <img
            src={imageUrl}
            alt={block.image?.alt ?? ''}
            className={`strike-scene-media strike-anim-${block.animation} h-full w-full object-cover`}
            style={mediaStyle}
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-brand-navy to-slate-900" aria-hidden />
        )}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/10" aria-hidden />

        <div className="absolute inset-x-0 top-0 flex items-center justify-between p-3 sm:p-4">
          <span className="rounded bg-brand-yellow px-2 py-1 text-[11px] font-black uppercase tracking-[0.14em] text-slate-950">
            {block.eyebrow ?? `Scene ${index + 1}`}
          </span>
          {completed && (
            <span className="inline-flex items-center gap-1 rounded bg-emerald-500/90 px-2 py-1 text-xs font-semibold text-white">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Done
            </span>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 space-y-2 p-4 sm:p-6">
          <h3 id={`${block.key}-title`} className="stencil-title text-xl text-white sm:text-3xl">{block.title}</h3>
          <ul className="space-y-1.5" aria-live="polite">
            {visibleBeats.map(beat => (
              <li key={`${beat.at_ms}-${beat.text}`} className="strike-beat-in flex items-start gap-2 text-sm font-semibold text-white sm:text-base">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-sm bg-brand-yellow" aria-hidden />
                {beat.text}
              </li>
            ))}
          </ul>
          {captionsOn && cue && (
            <p className="rounded bg-black/75 px-3 py-1.5 text-center text-sm text-white sm:text-base">{cue}</p>
          )}
        </div>
      </div>

      {narration && audioUrl ? (
        <div className="flex items-center gap-3 bg-slate-900 px-3 py-2.5 text-white">
          <button
            type="button"
            onClick={togglePlay}
            aria-label={playing ? `Pause ${block.title}` : `Play ${block.title}`}
            className="motion-press inline-flex h-11 w-11 items-center justify-center rounded-full bg-brand-yellow text-slate-950"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 translate-x-0.5" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="h-1.5 overflow-hidden rounded-full bg-white/15" aria-hidden>
              <div className="h-full bg-brand-yellow transition-[width] duration-200" style={{ width: `${durationMs ? Math.min(100, (positionMs / durationMs) * 100) : 0}%` }} />
            </div>
            <p className="mt-1 text-xs tabular-nums text-white/70">
              {formatDuration(positionMs)} / {formatDuration(durationMs)}
            </p>
          </div>
          <button type="button" onClick={replay} aria-label="Replay scene" className="rounded p-2 text-white/80 hover:text-white">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onToggleCaptions}
            aria-pressed={captionsOn}
            aria-label={captionsOn ? 'Hide captions' : 'Show captions'}
            className="rounded p-2 text-white/80 hover:text-white"
          >
            {captionsOn ? <Captions className="h-4 w-4" /> : <CaptionsOff className="h-4 w-4" />}
          </button>
          <audio
            ref={audioRef}
            src={audioUrl}
            preload="metadata"
            crossOrigin="anonymous"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={e => setPositionMs(Math.round(e.currentTarget.currentTime * 1000))}
            onEnded={() => {
              setPlaying(false)
              setPositionMs(durationMs)
              onCompleted()
            }}
          >
            {captionsUrl && <track kind="captions" srcLang="en" label="English" src={captionsUrl} default />}
          </audio>
        </div>
      ) : null}

      {narration && (
        <details className="bg-white px-4 py-2 text-sm dark:bg-slate-950">
          <summary className="cursor-pointer font-semibold text-slate-700 dark:text-slate-200">Transcript</summary>
          <p className="mt-2 text-slate-600 dark:text-slate-300">{narration.transcript}</p>
        </details>
      )}
    </article>
  )
}
