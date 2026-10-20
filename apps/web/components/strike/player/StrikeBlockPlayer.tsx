'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Info, OctagonAlert } from 'lucide-react'
import {
  missingRequiredBlocks,
  type StrikeBlock,
  type StrikeBlockEvent,
  type StrikeBlockEventRecord,
  type StrikeCalloutBlock,
  type StrikeContent,
} from '@soteria/core/strikeContent'
import { MotionScene } from './MotionScene'
import { DragSort } from './DragSort'
import { DragMatch } from './DragMatch'
import { Hotspot } from './Hotspot'
import { Scenario } from './Scenario'
import type { QueuedBlockEvent } from './useBlockEventQueue'

interface StrikeBlockPlayerProps {
  content: StrikeContent
  urls: Record<string, string>
  /** Stable per attempt, so shuffles don't reorder under the learner. */
  seed: string
  initialReached: StrikeBlockEventRecord[]
  onEvent: (event: QueuedBlockEvent) => void
  onProgress: (missing: string[]) => void
}

const SEEN_RATIO = 0.5
const SEEN_DWELL_MS = 800

export function StrikeBlockPlayer({ content, urls, seed, initialReached, onEvent, onProgress }: StrikeBlockPlayerProps) {
  const [reached, setReached] = useState<StrikeBlockEventRecord[]>(initialReached)
  const [captionsOn, setCaptionsOn] = useState(true)
  const titleByKey = useMemo(() => new Map(content.blocks.map(b => [b.key, blockTitle(b)])), [content])
  const missing = useMemo(() => missingRequiredBlocks(content, reached), [content, reached])
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

  return (
    <div className="space-y-5">
      <div className="sticky top-0 z-10 -mx-1 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-600 dark:text-slate-300">
          <span>{done} of {content.blocks.length} sections</span>
          <span>{missing.length === 0 ? 'Ready for the knowledge check' : `${missing.length} to go`}</span>
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
        const remediation = remediationKey ? { blockKey: remediationKey, title: titleByKey.get(remediationKey) ?? 'the related scene' } : null
        const completed = completedKeys.has(block.key)
        const onResult = (correct: boolean, detail: Record<string, unknown>) => {
          mark(block.key, 'interaction', { detail: { ...detail, correct } })
          if (correct) mark(block.key, 'completed')
        }
        return (
          <SeenTracker key={block.key} blockKey={block.key} onSeen={dwell => mark(block.key, 'seen', { dwell_ms: dwell })}>
            {block.kind === 'motion_scene' && (
              <MotionScene
                block={block}
                index={index}
                urls={urls}
                completed={completed}
                captionsOn={captionsOn}
                onToggleCaptions={() => setCaptionsOn(on => !on)}
                onCompleted={() => mark(block.key, 'completed')}
              />
            )}
            {block.kind === 'callout' && <Callout block={block} />}
            {block.kind === 'drag_sort' && <DragSort block={block} seed={seed} completed={completed} remediation={remediation} onResult={onResult} />}
            {block.kind === 'drag_match' && <DragMatch block={block} seed={seed} completed={completed} remediation={remediation} onResult={onResult} />}
            {block.kind === 'hotspot' && <Hotspot block={block} urls={urls} completed={completed} remediation={remediation} onResult={onResult} />}
            {block.kind === 'scenario' && <Scenario block={block} urls={urls} completed={completed} remediation={remediation} onResult={onResult} />}
          </SeenTracker>
        )
      })}
    </div>
  )
}

function blockTitle(block: StrikeBlock): string {
  switch (block.kind) {
    case 'motion_scene':
    case 'callout':
      return block.title
    case 'scenario':
      return 'the scenario'
    default:
      return block.prompt
  }
}

// "Seen" = at least half the block on screen for 800 ms. Reported once per
// mount; the server dedupes per attempt anyway.
function SeenTracker({ blockKey, onSeen, children }: { blockKey: string; onSeen: (dwellMs: number) => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const onSeenRef = useRef(onSeen)
  useEffect(() => { onSeenRef.current = onSeen }, [onSeen])

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') return
    let visibleSince: number | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let reported = false
    const observer = new IntersectionObserver(([entry]) => {
      if (reported) return
      if (entry.intersectionRatio >= SEEN_RATIO) {
        visibleSince = performance.now()
        timer = setTimeout(() => {
          reported = true
          onSeenRef.current(Math.round(performance.now() - (visibleSince ?? performance.now())))
          observer.disconnect()
        }, SEEN_DWELL_MS)
      } else if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }, { threshold: [0, SEEN_RATIO, 1] })
    observer.observe(node)
    return () => {
      observer.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [])

  return <div ref={ref} id={`block-${blockKey}`} className="scroll-mt-16">{children}</div>
}

const CALLOUT_STYLES = {
  danger: { icon: OctagonAlert, box: 'border-red-300 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100', label: 'Danger' },
  warning: { icon: AlertTriangle, box: 'border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100', label: 'Warning' },
  info: { icon: Info, box: 'border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100', label: 'Note' },
} as const

function Callout({ block }: { block: StrikeCalloutBlock }) {
  const style = CALLOUT_STYLES[block.tone]
  const Icon = style.icon
  return (
    <aside role="note" className={`flex gap-3 rounded-xl border-l-8 border p-4 ${style.box}`}>
      <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden />
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.14em]">{style.label}</p>
        <h3 className="stencil-title mt-0.5 text-lg">{block.title}</h3>
        <p className="mt-1 text-sm">{block.body}</p>
      </div>
    </aside>
  )
}
