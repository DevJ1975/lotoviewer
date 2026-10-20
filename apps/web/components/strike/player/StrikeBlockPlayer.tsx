'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Info, Lock, OctagonAlert } from 'lucide-react'
import {
  strikeInteractionHints,
  type StrikeBlock,
  type StrikeBlockEvent,
  type StrikeBlockEventRecord,
  type StrikeCalloutBlock,
  type StrikeContent,
  type StrikeInteractionBlock,
} from '@soteria/core/strikeContent'
import { STRIKE_SEEN_DWELL_MS, STRIKE_SEEN_RATIO, isStrikeBlockLocked, strikeBlockGate } from '@soteria/core/strikeGating'
import { MotionScene } from './MotionScene'
import { DragSort } from './DragSort'
import { DragMatch } from './DragMatch'
import { Hotspot } from './Hotspot'
import { Scenario } from './Scenario'
import type { HintControl } from './InteractionShell'
import { useStrikeCopy, type StrikeCopy } from './copy'
import type { QueuedBlockEvent } from './useBlockEventQueue'

interface StrikeBlockPlayerProps {
  content: StrikeContent
  urls: Record<string, string>
  /** Stable per attempt, so shuffles don't reorder under the learner. */
  seed: string
  initialReached: StrikeBlockEventRecord[]
  onEvent: (event: QueuedBlockEvent) => void
  onProgress: (missing: string[]) => void
  /** Assisted (ADA) delivery: the content is videos only and the end is a supervisor sign-off, not a quiz. */
  assisted?: boolean
}

export function StrikeBlockPlayer({ content, urls, seed, initialReached, onEvent, onProgress, assisted = false }: StrikeBlockPlayerProps) {
  const t = useStrikeCopy()
  const [reached, setReached] = useState<StrikeBlockEventRecord[]>(initialReached)
  const [captionsOn, setCaptionsOn] = useState(true)
  const [hintsShown, setHintsShown] = useState<Record<string, number>>({})
  const titleByKey = useMemo(() => new Map(content.blocks.map(b => [b.key, blockTitle(b, t)])), [content, t])
  const gate = useMemo(() => strikeBlockGate(content, reached), [content, reached])
  const { missing, firstOpen } = gate
  const completedKeys = useMemo(
    () => new Set(reached.filter(r => r.event === 'completed').map(r => r.block_key)),
    [reached],
  )

  useEffect(() => { onProgress(missing) }, [missing, onProgress])

  const mark = useCallback((blockKey: string, event: StrikeBlockEvent, extra: Omit<QueuedBlockEvent, 'block_key' | 'event'> = {}) => {
    setReached(prev => (
      prev.some(r => r.block_key === blockKey && r.event === event) ? prev : [...prev, { block_key: blockKey, event }]
    ))
    onEvent({ block_key: blockKey, event, ...extra })
  }, [onEvent])

  const done = content.blocks.length - missing.length
  const lockNotice = firstOpen ? { blockKey: firstOpen.key, title: lockedBehindLabel(firstOpen, t) } : null

  const hintFor = (block: StrikeInteractionBlock): HintControl => {
    const hints = strikeInteractionHints(block).map(t.hintText)
    const shown = hintsShown[block.key] ?? 0
    return {
      revealed: hints.slice(0, shown),
      canReveal: shown < hints.length,
      onReveal: () => setHintsShown(prev => ({ ...prev, [block.key]: shown + 1 })),
    }
  }

  return (
    // manipulation: rapid taps on the arrows or markers must not trigger
    // iOS double-tap zoom.
    <div className="touch-manipulation space-y-5">
      <div className="sticky top-0 z-10 -mx-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>{assisted ? t.videos(done, content.blocks.length) : t.sections(done, content.blocks.length)}</span>
          <span>{missing.length > 0 ? t.toGo(missing.length) : assisted ? t.readyForSignOff : t.readyForCheck}</span>
        </div>
        <div className="mt-1.5 flex gap-1" aria-hidden>
          {content.blocks.map(block => (
            <a
              key={block.key}
              href={`#block-${block.key}`}
              className={`h-1.5 flex-1 rounded-full ${missing.includes(block.key) ? 'bg-slate-200 dark:bg-slate-700' : 'bg-brand-yellow'}`}
            />
          ))}
        </div>
      </div>

      {content.blocks.map((block, index) => {
        const remediationKey = 'remediate_block_key' in block ? block.remediate_block_key : null
        const remediation = remediationKey ? { blockKey: remediationKey, title: titleByKey.get(remediationKey) ?? t.relatedScene } : null
        const completed = completedKeys.has(block.key)
        const locked = isStrikeBlockLocked(gate, index)
        const onResult = (correct: boolean, detail: Record<string, unknown>) => {
          mark(block.key, 'interaction', { detail: { ...detail, correct, hints_used: hintsShown[block.key] ?? 0 } })
          if (correct) mark(block.key, 'completed')
        }
        return (
          <SeenTracker
            key={block.key}
            blockKey={block.key}
            active={!locked}
            lockedBehind={locked ? lockNotice : null}
            lockedText={t.locked}
            onSeen={dwell => mark(block.key, 'seen', { dwell_ms: dwell })}
          >
            {block.kind === 'motion_scene' && (
              <MotionScene
                block={block}
                index={index}
                urls={urls}
                completed={completed}
                captionsOn={captionsOn}
                onToggleCaptions={() => setCaptionsOn(on => !on)}
                onCompleted={() => {
                  mark(block.key, 'completed')
                  // A worker who can't read the lock notice still needs to find the next video.
                  if (assisted) document.getElementById(`block-${content.blocks[index + 1]?.key}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
              />
            )}
            {block.kind === 'callout' && <Callout block={block} label={calloutLabel(block, t)} />}
            {block.kind === 'drag_sort' && <DragSort block={block} seed={seed} completed={completed} remediation={remediation} hint={hintFor(block)} onResult={onResult} />}
            {block.kind === 'drag_match' && <DragMatch block={block} seed={seed} completed={completed} remediation={remediation} hint={hintFor(block)} onResult={onResult} />}
            {block.kind === 'hotspot' && <Hotspot block={block} urls={urls} completed={completed} remediation={remediation} hint={hintFor(block)} onResult={onResult} />}
            {block.kind === 'scenario' && <Scenario block={block} urls={urls} completed={completed} remediation={remediation} hint={hintFor(block)} onResult={onResult} />}
          </SeenTracker>
        )
      })}
    </div>
  )
}

function lockedBehindLabel(block: StrikeBlock, t: StrikeCopy): string {
  switch (block.kind) {
    case 'motion_scene':
      return t.lockedBehindScene(block.title)
    case 'callout':
      return t.lockedBehindCallout(block.title)
    default:
      return t.lockedBehindPractice
  }
}

function blockTitle(block: StrikeBlock, t: StrikeCopy): string {
  switch (block.kind) {
    case 'motion_scene':
    case 'callout':
      return block.title
    case 'scenario':
      return t.theScenario
    default:
      return block.prompt
  }
}

// "Seen" = at least half the block on screen for 800 ms. Reported once per
// mount, and never while the block is locked: a locked block shows what is
// ahead but earns nothing. The server dedupes per attempt anyway.
function SeenTracker({ blockKey, active, lockedBehind, lockedText, onSeen, children }: {
  blockKey: string
  active: boolean
  lockedBehind: { blockKey: string; title: string } | null
  lockedText: (what: string) => string
  onSeen: (dwellMs: number) => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const onSeenRef = useRef(onSeen)
  useEffect(() => { onSeenRef.current = onSeen }, [onSeen])

  useEffect(() => {
    const node = ref.current
    if (!active || !node || typeof IntersectionObserver === 'undefined') return
    let visibleSince: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let reported = false
    const observer = new IntersectionObserver(([entry]) => {
      if (reported) return
      if (entry.intersectionRatio >= STRIKE_SEEN_RATIO) {
        visibleSince = performance.now()
        timer = setTimeout(() => {
          reported = true
          onSeenRef.current(Math.round(performance.now() - (visibleSince ?? performance.now())))
          observer.disconnect()
        }, STRIKE_SEEN_DWELL_MS)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }, { threshold: [0, STRIKE_SEEN_RATIO, 1] })
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [active])

  return (
    <div ref={ref} id={`block-${blockKey}`} className="relative scroll-mt-16">
      <div inert={!active} className={active ? undefined : 'pointer-events-none select-none opacity-35 grayscale'}>
        {children}
      </div>
      {lockedBehind && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <a
            href={`#block-${lockedBehind.blockKey}`}
            className="inline-flex max-w-sm items-center gap-2 rounded-lg bg-slate-900/90 px-4 py-3 text-sm font-semibold text-white shadow-lg"
          >
            <Lock className="h-4 w-4 shrink-0 text-brand-yellow" aria-hidden />
            {lockedText(lockedBehind.title)}
          </a>
        </div>
      )}
    </div>
  )
}

const CALLOUT_STYLES = {
  danger: { icon: OctagonAlert, box: 'border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100' },
  warning: { icon: AlertTriangle, box: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100' },
  info: { icon: Info, box: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100' },
} as const

function calloutLabel(block: StrikeCalloutBlock, t: StrikeCopy): string {
  return { danger: t.calloutDanger, warning: t.calloutWarning, info: t.calloutInfo }[block.tone]
}

function Callout({ block, label }: { block: StrikeCalloutBlock; label: string }) {
  const style = CALLOUT_STYLES[block.tone]
  const Icon = style.icon
  return (
    <aside role="note" className={`flex gap-3 rounded-xl border-l-8 border p-4 ${style.box}`}>
      <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em]">{label}</p>
        <h3 className="stencil-title mt-0.5 text-lg">{block.title}</h3>
        <p className="mt-1 text-sm">{block.body}</p>
      </div>
    </aside>
  )
}
