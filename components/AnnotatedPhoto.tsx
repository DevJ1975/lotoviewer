'use client'

import { useId, useRef, useState } from 'react'
import { Pencil, ArrowRight, Type, Trash2, X, Check } from 'lucide-react'
import { type Annotation, clampUnit, parseAnnotations } from '@/lib/photoAnnotations'

// Default arrow + label color. Equipment photo uses brand navy; the
// isolation photo passes the placard red so the two layers read as
// distinct at a glance.
const DEFAULT_COLOR = '#214488'

// useId() returns ":r0:" — the colons are valid HTML5 ids but break
// url(#…) refs on some browsers (treated as pseudo-class delimiters).
// One sanitiser, used by both the read-only overlay and the editor.
function useUniqueMarkerId(): string {
  return useId().replace(/:/g, '_')
}

// Photo with overlay annotations. Two modes:
//   - default: renders an SVG overlay on top of the image. Click "Annotate"
//     to enter the editor.
//   - editor: a modal with the same image, tool palette, and a save action.
//
// Coordinates throughout are 0-1 relative to the image. The SVG uses
// viewBox="0 0 1 1" so we never need to know the rendered pixel size —
// shape coordinates literally map to the SVG coordinate system.

export function AnnotatedPhoto({
  src, alt, annotations, onSave, editable = false, className, color = DEFAULT_COLOR,
}: {
  src:         string
  alt:         string
  annotations: Annotation[]
  // Called when the user saves changes. Receives the new annotation
  // array; persistence is the parent's job (insert/update jsonb column).
  onSave?:     (next: Annotation[]) => void
  // When false, the "Annotate" button is hidden — pure display use.
  editable?:   boolean
  className?:  string
  // Stroke + arrowhead fill. Pass placard red for the isolation photo,
  // brand navy (default) for the equipment photo.
  color?:      string
}) {
  const [editing, setEditing] = useState(false)
  return (
    // w-full h-full so the wrapper fills its parent (typically an
    // aspect-ratio'd container). Without an explicit height, the img's
    // h-full resolves to 0, and the absolute-positioned Annotate button
    // ends up clipped by the parent's overflow-hidden.
    <div className={`relative w-full h-full ${className ?? ''}`}>
      <img src={src} alt={alt} className="w-full h-full object-cover" />
      <AnnotationLayer annotations={annotations} color={color} />
      {editable && onSave && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="absolute bottom-2 right-2 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/90 dark:bg-slate-900/90 hover:bg-white dark:hover:bg-slate-900 text-slate-700 dark:text-slate-300 text-[11px] font-semibold shadow-sm border border-slate-200 dark:border-slate-700 transition-colors"
        >
          <Pencil className="h-3 w-3" />
          Annotate
        </button>
      )}
      {editing && onSave && (
        <AnnotationEditor
          src={src}
          alt={alt}
          initial={annotations}
          color={color}
          onClose={() => setEditing(false)}
          // Await the parent's save so we only close the editor on
          // success. If onSave throws (e.g. Supabase RLS / column
          // error), keep the editor open so the user's drawn shapes
          // aren't lost and they have a chance to read the toast.
          onSave={async (next) => {
            try {
              await onSave(next)
              setEditing(false)
            } catch {
              // Parent already surfaced the error via toast / console.
              // Editor stays open with the drawn shapes intact.
            }
          }}
        />
      )}
    </div>
  )
}

// Arrowhead marker reused by every arrow shape. Filled with the caller-
// provided color and a white edge so it's legible against any photo
// background. refX positions the tip on the arrow's endpoint, not past it.
function ArrowheadMarker({ id, color }: { id: string; color: string }) {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9" refY="5"
      markerWidth="6" markerHeight="6"
      markerUnits="strokeWidth"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} stroke="white" strokeWidth="0.5" />
    </marker>
  )
}

// SVG primitives for one shape — no wrapping <g>, so the parent owns
// click handlers and pointer-events styling. Single source of truth for
// what an arrow / label looks like.
function ShapeNode({ shape, color, markerId }: {
  shape:    Annotation
  color:    string
  markerId: string
}) {
  if (shape.type === 'arrow') {
    return (
      <>
        {/* White halo first, then colored line on top — keeps the arrow
            visible on dark backgrounds. */}
        <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2}
          stroke="white" strokeWidth="0.012" strokeLinecap="round" />
        <line x1={shape.x1} y1={shape.y1} x2={shape.x2} y2={shape.y2}
          stroke={color} strokeWidth="0.008" strokeLinecap="round"
          markerEnd={`url(#${markerId})`} />
        {shape.label && (
          <text x={shape.x2} y={shape.y2 - 0.02} fontSize="0.04"
            fill="#0f172a" stroke="white" strokeWidth="0.008" paintOrder="stroke"
            textAnchor="middle" fontWeight="bold">
            {shape.label}
          </text>
        )}
      </>
    )
  }
  return (
    <text x={shape.x} y={shape.y} fontSize="0.045"
      fill="#0f172a" stroke="white" strokeWidth="0.012" paintOrder="stroke"
      textAnchor="middle" dominantBaseline="middle" fontWeight="bold">
      {shape.text}
    </text>
  )
}

// Read-only SVG overlay. Drawn over the image with absolute positioning;
// inherits its size from the parent so the annotations track the photo
// regardless of object-fit / responsive layout. Exported so other
// consumers (e.g. the placard photo slots) can render arrows + labels
// directly over their own <img>/<Image> without going through
// AnnotatedPhoto's editor-aware shell. Owns its marker id internally.
export function AnnotationLayer({ annotations, color = DEFAULT_COLOR }: {
  annotations: Annotation[]
  color?:      string
}) {
  const markerId = useUniqueMarkerId()
  return (
    <svg
      viewBox="0 0 1 1"
      preserveAspectRatio="none"
      className="absolute inset-0 w-full h-full pointer-events-none"
    >
      <defs>
        <ArrowheadMarker id={markerId} color={color} />
      </defs>
      {annotations.map((shape, i) => (
        <g key={i}>
          <ShapeNode shape={shape} color={color} markerId={markerId} />
        </g>
      ))}
    </svg>
  )
}

// ── Editor modal ──────────────────────────────────────────────────────────

type Tool = 'arrow' | 'label' | 'select'

function AnnotationEditor({
  src, alt, initial, color, onClose, onSave,
}: {
  src:     string
  alt:     string
  initial: Annotation[]
  color:   string
  onClose: () => void
  // May be sync or async. Async returns let us show a "Saving…"
  // state and keep the editor open if the save throws.
  onSave:  (next: Annotation[]) => void | Promise<void>
}) {
  const [shapes, setShapes] = useState<Annotation[]>(() => parseAnnotations(initial))
  const [tool, setTool]     = useState<Tool>('arrow')
  const [saving, setSaving] = useState(false)
  const markerId = useUniqueMarkerId()
  // Drag-and-release arrow drawing. arrowDraft holds the in-flight
  // arrow's tail (x1,y1) and current pointer position (x2,y2) while the
  // finger is down. null = nothing being drawn. The earlier tap-tap
  // approach was confusing on iPad — users couldn't tell which tap set
  // the arrowhead direction, so arrows often pointed the wrong way.
  type ArrowDraft = { x1: number; y1: number; x2: number; y2: number }
  const [arrowDraft, setArrowDraft] = useState<ArrowDraft | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  function pointerToUnit(e: React.PointerEvent<SVGSVGElement>): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    return {
      x: clampUnit((e.clientX - rect.left) / rect.width),
      y: clampUnit((e.clientY - rect.top)  / rect.height),
    }
  }

  function handlePointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (tool === 'select') return
    const p = pointerToUnit(e)
    if (tool === 'arrow') {
      // Capture the pointer so we keep getting move/up events even if
      // the finger drifts outside the SVG bounds during the drag.
      try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* unsupported, ignore */ }
      setArrowDraft({ x1: p.x, y1: p.y, x2: p.x, y2: p.y })
    } else if (tool === 'label') {
      const text = window.prompt('Label text')
      if (text && text.trim()) {
        setShapes(prev => [...prev, { type: 'label', x: p.x, y: p.y, text: text.trim() }])
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!arrowDraft) return
    const p = pointerToUnit(e)
    setArrowDraft(prev => prev ? { x1: prev.x1, y1: prev.y1, x2: p.x, y2: p.y } : null)
  }

  function handlePointerUp() {
    if (!arrowDraft) return
    const draft = arrowDraft
    setArrowDraft(null)
    const dx = draft.x2 - draft.x1
    const dy = draft.y2 - draft.y1
    // Reject anything shorter than ~4% of the image — almost certainly
    // a stray tap rather than an intended arrow. Without this guard,
    // accidental presses leave 0-length arrows that look like a dot.
    if (dx * dx + dy * dy < 0.04 * 0.04) return
    const text = window.prompt('Name this isolation point (optional)')
    const label = text && text.trim() ? text.trim() : undefined
    setShapes(prev => [...prev, {
      type: 'arrow',
      x1: draft.x1, y1: draft.y1,
      x2: draft.x2, y2: draft.y2,
      label,
    }])
  }

  function deleteAt(index: number) {
    setShapes(prev => prev.filter((_, i) => i !== index))
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex flex-col">
      <header className="bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
        <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">Annotate photo</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try { await onSave(shapes) } finally { setSaving(false) }
            }}
            className="inline-flex items-center gap-1 px-4 py-1.5 rounded-md bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 disabled:opacity-60 transition-colors"
          >
            <Check className="h-4 w-4" />
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center p-4 overflow-hidden">
        <div className="relative w-full h-full max-w-3xl flex items-center justify-center">
          <div className="relative inline-block max-w-full max-h-full">
            <img src={src} alt={alt} className="block max-w-full max-h-[70vh] object-contain" />
            <svg
              ref={svgRef}
              viewBox="0 0 1 1"
              preserveAspectRatio="none"
              className="absolute inset-0 w-full h-full"
              style={{ touchAction: 'none', cursor: tool === 'select' ? 'pointer' : 'crosshair' }}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={() => setArrowDraft(null)}
            >
              <defs>
                <ArrowheadMarker id={markerId} color={color} />
              </defs>
              {shapes.map((shape, i) => (
                <g key={i}
                   onClick={(e) => { e.stopPropagation(); if (tool === 'select') deleteAt(i) }}
                   className={tool === 'select' ? 'cursor-pointer' : ''}>
                  <ShapeNode shape={shape} color={color} markerId={markerId} />
                </g>
              ))}
              {/* Live preview while the user is dragging — same visual
                  weight as a finalized arrow so they see exactly what
                  they're about to commit. */}
              {arrowDraft && (
                <g>
                  <line x1={arrowDraft.x1} y1={arrowDraft.y1} x2={arrowDraft.x2} y2={arrowDraft.y2}
                        stroke="white" strokeWidth="0.012" strokeLinecap="round" />
                  <line x1={arrowDraft.x1} y1={arrowDraft.y1} x2={arrowDraft.x2} y2={arrowDraft.y2}
                        stroke={color} strokeWidth="0.008" strokeLinecap="round"
                        markerEnd={`url(#${markerId})`} />
                </g>
              )}
            </svg>
          </div>
        </div>
      </div>

      <footer className="bg-white dark:bg-slate-900 px-4 py-3 flex items-center justify-between gap-3 shrink-0 border-t border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-1.5">
          <ToolButton active={tool === 'arrow'}  onClick={() => { setTool('arrow');  setArrowDraft(null) }} icon={<ArrowRight className="h-4 w-4" />} label="Arrow" />
          <ToolButton active={tool === 'label'}  onClick={() => { setTool('label');  setArrowDraft(null) }} icon={<Type className="h-4 w-4" />}       label="Label" />
          <ToolButton active={tool === 'select'} onClick={() => { setTool('select'); setArrowDraft(null) }} icon={<Trash2 className="h-4 w-4" />}     label="Tap to delete" />
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {tool === 'arrow' && (arrowDraft ? 'Release on the isolation point.' : 'Press, drag to the isolation point, release.')}
          {tool === 'label' && 'Tap to drop a label.'}
          {tool === 'select' && 'Tap a shape to remove it.'}
        </p>
      </footer>
    </div>
  )
}

function ToolButton({ active, onClick, icon, label }: {
  active:  boolean
  onClick: () => void
  icon:    React.ReactNode
  label:   string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-semibold transition-colors ${
        active
          ? 'bg-brand-navy text-white'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
