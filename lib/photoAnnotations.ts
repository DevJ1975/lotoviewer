// Photo overlay annotations for LOTO placards. Coordinates are relative
// (0-1) so the same shape data renders correctly whether the photo is
// shown as a 200×150 thumbnail in the dashboard or a 600×400 slot on the
// placard detail page — no per-render scaling math required.

export type ArrowShape = {
  type:   'arrow'
  // Start and end points, both 0-1 in image space.
  x1: number; y1: number
  x2: number; y2: number
  // Optional label drawn near the arrowhead.
  label?: string
}

export type LabelShape = {
  type:    'label'
  x: number; y: number
  text:    string
}

export type Annotation = ArrowShape | LabelShape

// Validate a parsed jsonb array. Permissive — anything we can't recognize
// or that has out-of-range coordinates is dropped silently rather than
// failing the whole render. A bad annotation should never break the page.
export function parseAnnotations(raw: unknown): Annotation[] {
  if (!Array.isArray(raw)) return []
  const out: Annotation[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const t = (item as { type?: unknown }).type
    if (t === 'arrow') {
      const a = item as Partial<ArrowShape>
      if (isUnit(a.x1) && isUnit(a.y1) && isUnit(a.x2) && isUnit(a.y2)) {
        out.push({
          type: 'arrow',
          x1: a.x1!, y1: a.y1!, x2: a.x2!, y2: a.y2!,
          label: typeof a.label === 'string' ? a.label : undefined,
        })
      }
    } else if (t === 'label') {
      const l = item as Partial<LabelShape>
      if (isUnit(l.x) && isUnit(l.y) && typeof l.text === 'string' && l.text.trim().length > 0) {
        out.push({ type: 'label', x: l.x!, y: l.y!, text: l.text })
      }
    }
  }
  return out
}

// 0-1 inclusive. Real photo clicks always produce values in this range,
// but we re-check on parse because the column is jsonb and could be
// edited via SQL or a future API caller without going through the UI.
function isUnit(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
}

// Clamp a coordinate to [0, 1]. Used by the editor when a touch event
// drifts slightly outside the image bounds (mobile rubber-banding).
export function clampUnit(v: number): number {
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(1, v))
}
