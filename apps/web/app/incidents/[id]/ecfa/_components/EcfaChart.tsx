'use client'

import {
  layoutEcfaChart,
  CAUSAL_FACTOR_CATEGORY_LABEL,
  type EcfaLayoutNode,
  type EcfaShape,
  type CausalFactorCategory,
} from '@soteria/core/ecfaSchemas'

// Read-only SVG rendering of the ECFA chart. All geometry comes from the
// pure layoutEcfaChart() function (also used by the PDF export), so this
// component only maps shapes → SVG primitives following the standard ECFA
// legend: events = rectangles, conditions = ovals, the loss = a diamond,
// dashed border = presumptive, a highlighted border + ★ = causal factor.
// Editing happens in EcfaBoard; this is purely the picture.

// Category accent colors (the four ICAM-aligned causal-factor categories).
const CATEGORY_COLOR: Record<CausalFactorCategory, string> = {
  absent_failed_defences:        '#e11d48', // rose-600
  individual_team_actions:       '#d97706', // amber-600
  task_environmental_conditions: '#0284c7', // sky-600
  organisational_factors:        '#7c3aed', // violet-600
}

const INK      = '#1e293b' // slate-800 text
const SEQ       = '#64748b' // slate-500 arrows
const EVENT_BG  = '#f8fafc'
const EVENT_LN  = '#94a3b8'
const COND_BG   = '#f0f9ff'
const COND_LN   = '#7dd3fc'
const LOSS_BG   = '#ffe4e6'
const LOSS_LN   = '#e11d48'
const CF_LN     = '#f59e0b' // amber-500 causal-factor highlight

// Char budget per line by shape width (font ~11px). Pure + deterministic.
function wrapLabel(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let cur = ''
  for (const w of words) {
    const candidate = cur ? `${cur} ${w}` : w
    if (candidate.length <= maxChars) { cur = candidate; continue }
    if (cur) lines.push(cur)
    cur = w
    if (lines.length === maxLines - 1) break
  }
  if (cur && lines.length < maxLines) lines.push(cur)
  // Truncate the last line if the text overflowed the line budget.
  const consumed = lines.join(' ').length
  if (consumed < text.trim().length && lines.length > 0) {
    const last = lines[lines.length - 1]
    lines[lines.length - 1] = last.length > 3 ? last.slice(0, maxChars - 1).trimEnd() + '…' : last + '…'
  }
  return lines
}

function ShapeNode({ s }: { s: EcfaShape }) {
  const cx = s.x + s.w / 2
  const cy = s.y + s.h / 2
  const dash = s.dashed ? '5 4' : undefined
  const maxChars = s.kind === 'incident' ? 14 : s.kind === 'condition' ? 20 : 22
  const maxLines = s.kind === 'incident' ? 2 : 3
  const lines = wrapLabel(s.label, maxChars, maxLines)
  const lineH = 13
  const firstY = cy - ((lines.length - 1) * lineH) / 2

  let bg = EVENT_BG, ln = EVENT_LN
  if (s.kind === 'condition') { bg = COND_BG; ln = COND_LN }
  if (s.kind === 'incident')  { bg = LOSS_BG; ln = LOSS_LN }
  const stroke = s.highlighted ? CF_LN : ln
  const strokeW = s.highlighted ? 3 : 1.5

  return (
    <g>
      <title>{s.label}</title>
      {s.kind === 'event' && (
        <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={8}
          fill={bg} stroke={stroke} strokeWidth={strokeW} strokeDasharray={dash} />
      )}
      {s.kind === 'condition' && (
        <ellipse cx={cx} cy={cy} rx={s.w / 2} ry={s.h / 2}
          fill={bg} stroke={stroke} strokeWidth={strokeW} strokeDasharray={dash} />
      )}
      {s.kind === 'incident' && (
        <polygon
          points={`${cx},${s.y} ${s.x + s.w},${cy} ${cx},${s.y + s.h} ${s.x},${cy}`}
          fill={bg} stroke={stroke} strokeWidth={strokeW} strokeDasharray={dash} />
      )}

      {/* causal-factor star + category accent dot */}
      {s.highlighted && (
        <text x={s.x + s.w - 6} y={s.y + 14} textAnchor="end" fontSize={13} fill={CF_LN}>★</text>
      )}
      {s.category && (
        <circle cx={s.x + 9} cy={s.y + 10} r={4} fill={CATEGORY_COLOR[s.category]} />
      )}

      {lines.map((ln2, i) => (
        <text key={i} x={cx} y={firstY + i * lineH} textAnchor="middle"
          dominantBaseline="middle" fontSize={11} fill={INK}>
          {ln2}
        </text>
      ))}
    </g>
  )
}

export default function EcfaChart({ nodes }: { nodes: EcfaLayoutNode[] }) {
  const geo = layoutEcfaChart(nodes)
  const hasContent = geo.shapes.length > 0

  const usedCategories = Array.from(
    new Set(nodes.filter(n => n.is_causal_factor && n.cf_category).map(n => n.cf_category)),
  ) as CausalFactorCategory[]

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white p-2">
        {hasContent ? (
          <svg
            width={geo.width}
            height={geo.height}
            viewBox={`0 0 ${geo.width} ${geo.height}`}
            role="img"
            aria-label="Events and causal factors chart"
            style={{ maxWidth: 'none' }}
          >
            <defs>
              <marker id="ecfa-arrow" markerWidth="8" markerHeight="8" refX="7" refY="3"
                orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3 L0,6 Z" fill={SEQ} />
              </marker>
            </defs>
            {geo.edges.map(e => (
              <line
                key={e.id}
                x1={e.fromX} y1={e.fromY} x2={e.toX} y2={e.toY}
                stroke={e.kind === 'sequence' ? SEQ : COND_LN}
                strokeWidth={e.kind === 'sequence' ? 1.75 : 1.25}
                markerEnd={e.kind === 'sequence' ? 'url(#ecfa-arrow)' : undefined}
              />
            ))}
            {geo.shapes.map(s => <ShapeNode key={s.id} s={s} />)}
          </svg>
        ) : (
          <p className="px-2 py-8 text-center text-sm text-slate-400">
            Add events below to build the chart.
          </p>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-slate-400 bg-slate-50" /> Event</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-full border border-sky-300 bg-sky-50" /> Condition</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rotate-45 border border-rose-500 bg-rose-100" /> Loss</span>
        <span className="inline-flex items-center gap-1"><span className="text-amber-500">★</span> Causal factor</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3.5 rounded-[2px] border border-dashed border-slate-400" /> Presumptive</span>
        {usedCategories.map(c => (
          <span key={c} className="inline-flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: CATEGORY_COLOR[c] }} />
            {CAUSAL_FACTOR_CATEGORY_LABEL[c]}
          </span>
        ))}
      </div>
    </div>
  )
}
