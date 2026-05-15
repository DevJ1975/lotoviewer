const BODY_MAX_CHARS    = 20_000
const BODY_MIN_CHARS    = 80
const KEY_POINT_MAX_LEN = 200
const KEY_POINTS_MAX    = 8

export interface RawGeneratedToolboxTalk {
  title?:          unknown
  body_markdown?:  unknown
  key_points?:     unknown
  delivery_notes?: unknown
}

export interface NormalizedGeneratedToolboxTalk {
  title:         string
  bodyMarkdown:  string
  keyPoints:     string[]
  deliveryNotes: string
}

export function normalizeGeneratedToolboxTalk(
  fields: RawGeneratedToolboxTalk,
  fallbackTitle: string,
): NormalizedGeneratedToolboxTalk {
  const title = typeof fields.title === 'string'
    ? fields.title.trim().slice(0, 200)
    : ''
  const bodyMarkdown = typeof fields.body_markdown === 'string'
    ? fields.body_markdown.trim().slice(0, BODY_MAX_CHARS)
    : ''
  const keyPoints = Array.isArray(fields.key_points)
    ? fields.key_points
        .filter((point): point is string => typeof point === 'string')
        .map(point => point.trim().slice(0, KEY_POINT_MAX_LEN))
        .filter(Boolean)
        .slice(0, KEY_POINTS_MAX)
    : []
  const deliveryNotes = typeof fields.delivery_notes === 'string'
    ? fields.delivery_notes.trim().slice(0, 1000)
    : ''

  if (bodyMarkdown.length < BODY_MIN_CHARS) {
    throw new Error('Generated toolbox talk body was empty or too short')
  }
  if (keyPoints.length === 0) {
    throw new Error('Generated toolbox talk did not include key points')
  }

  return {
    title: title || fallbackTitle,
    bodyMarkdown,
    keyPoints,
    deliveryNotes,
  }
}

export function parseGenerationBudget(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
