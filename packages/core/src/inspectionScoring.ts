// Pure scoring logic for the inspection/audit builder. No I/O.
//
// An inspection is a set of template items + per-item responses. Only
// pass/fail/na items contribute to the score; text/photo/signature items are
// informational. The overall result fails if any scorable item failed.

export type InspectionItemType =
  | 'pass_fail_na' | 'multiple_choice' | 'numeric' | 'text' | 'photo' | 'signature'

export type ResponseResult = 'pass' | 'fail' | 'na'

export function isScorableType(t: InspectionItemType): boolean {
  return t === 'pass_fail_na' || t === 'numeric' || t === 'multiple_choice'
}

export interface ScoreItem {
  id:                 string
  type:               InspectionItemType
  weight:             number
  failCreatesAction:  boolean
}

export interface ScoreResponse {
  itemId: string
  result: ResponseResult | null
}

export interface InspectionScore {
  /** Weighted sum of passing scorable items. */
  score:         number
  /** Weighted sum of scorable items answered pass OR fail (na/blank excluded). */
  maxScore:      number
  /** 0–100, integer; 100 when nothing scorable was answered. */
  pct:           number
  /** Overall result: fail if any scorable item failed, else pass. */
  result:        'pass' | 'fail'
  /** Items answered 'fail'. */
  failedItemIds: string[]
  /** Failed items flagged to auto-create a corrective action. */
  actionItemIds: string[]
}

export function scoreInspection(
  items: ScoreItem[],
  responses: ScoreResponse[],
): InspectionScore {
  const byId = new Map(items.map(i => [i.id, i]))
  const respByItem = new Map(responses.map(r => [r.itemId, r.result]))

  let score = 0
  let maxScore = 0
  const failedItemIds: string[] = []
  const actionItemIds: string[] = []

  for (const item of items) {
    if (!isScorableType(item.type)) continue
    const result = respByItem.get(item.id) ?? null
    if (result === 'na' || result === null) continue // excluded from scoring
    const weight = Number.isFinite(item.weight) && item.weight > 0 ? item.weight : 1
    maxScore += weight
    if (result === 'pass') score += weight
  }

  for (const r of responses) {
    if (r.result !== 'fail') continue
    const item = byId.get(r.itemId)
    if (!item) continue
    failedItemIds.push(item.id)
    if (item.failCreatesAction) actionItemIds.push(item.id)
  }

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 100
  return {
    score,
    maxScore,
    pct,
    result: failedItemIds.length > 0 ? 'fail' : 'pass',
    failedItemIds,
    actionItemIds,
  }
}

/** Pass/fail for a numeric item against an optional [min, max] tolerance. */
export function evaluateNumeric(
  value: number,
  min: number | null,
  max: number | null,
): ResponseResult {
  if (!Number.isFinite(value)) return 'na'
  if (min != null && value < min) return 'fail'
  if (max != null && value > max) return 'fail'
  return 'pass'
}
