// Repeat-incident detection — pure heuristic.
//
// Phase 5 ships a keyword + location-based matcher (no embeddings).
// The matcher takes the focal incident + a window of recent
// incidents and scores each candidate by:
//   - location_text exact match    (heavy weight)
//   - related_loto / hot-work / jha permit overlap
//   - body-part overlap            (when both have an injured person)
//   - description keyword overlap  (Jaccard on tokenised words)
//   - same incident_type           (bonus)
//
// Anything that scores above the threshold gets surfaced as a
// "similar past incident" link on the detail page. Phase 6 will
// upgrade this to a Claude embedding for semantic matches.

export interface RepeatCandidate {
  id:                              string
  report_number:                   string
  occurred_at:                     string
  incident_type:                   string
  description:                     string
  location_text:                   string | null
  related_loto_permit_id?:         string | null
  related_hot_work_permit_id?:     string | null
  related_confined_space_permit_id?: string | null
  related_jha_id?:                 string | null
  body_parts?:                     string[] | null      // pre-joined from incident_people
}

export interface RepeatMatchResult {
  candidate: RepeatCandidate
  score:     number              // 0-1
  reasons:   string[]            // human-readable triggers
}

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','to','of','in','on','at','by','for','with',
  'is','was','were','be','been','being','it','this','that','these','those',
  'as','from','into','onto','about','was','were','their','they','them',
  'he','she','his','her','him','i','me','my','you','your',
])

function tokenise(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 4 && !STOP_WORDS.has(t)),
  )
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter += 1
  const union = a.size + b.size - inter
  return inter / union
}

export interface RepeatDetectorOptions {
  /** Match score above which a candidate is surfaced. Default 0.20. */
  threshold?: number
  /** Top-N to return after sorting. Default 5. */
  limit?: number
}

export function detectRepeatIncidents(
  focal: RepeatCandidate,
  pool:  ReadonlyArray<RepeatCandidate>,
  opts:  RepeatDetectorOptions = {},
): RepeatMatchResult[] {
  const threshold = opts.threshold ?? 0.20
  const limit     = opts.limit     ?? 5

  const focalTokens = tokenise(focal.description ?? '')
  const focalLoc    = (focal.location_text ?? '').trim().toLowerCase()
  const focalBody   = new Set(focal.body_parts ?? [])

  const out: RepeatMatchResult[] = []
  for (const c of pool) {
    if (c.id === focal.id) continue

    let score = 0
    const reasons: string[] = []

    // Same location — heavy weight.
    const candLoc = (c.location_text ?? '').trim().toLowerCase()
    if (focalLoc && candLoc && focalLoc === candLoc) {
      score += 0.4
      reasons.push(`Same location: ${c.location_text}`)
    }

    // Cross-module FK overlap. Each match bumps the score.
    if (focal.related_loto_permit_id && focal.related_loto_permit_id === c.related_loto_permit_id) {
      score += 0.30
      reasons.push('Same LOTO permit')
    }
    if (focal.related_hot_work_permit_id && focal.related_hot_work_permit_id === c.related_hot_work_permit_id) {
      score += 0.30
      reasons.push('Same hot-work permit')
    }
    if (focal.related_confined_space_permit_id && focal.related_confined_space_permit_id === c.related_confined_space_permit_id) {
      score += 0.30
      reasons.push('Same confined-space permit')
    }
    if (focal.related_jha_id && focal.related_jha_id === c.related_jha_id) {
      score += 0.20
      reasons.push('Same JHA')
    }

    // Body-part overlap.
    if (focalBody.size > 0 && c.body_parts && c.body_parts.length > 0) {
      const overlap = c.body_parts.filter(b => focalBody.has(b))
      if (overlap.length > 0) {
        score += 0.10 * Math.min(3, overlap.length)
        reasons.push(`Same body part(s): ${overlap.join(', ')}`)
      }
    }

    // Description keyword overlap (Jaccard).
    // Weight 0.7 — when location + FKs don't match, the description
    // is the strongest signal we have. A 25% token overlap on its
    // own is enough to clear the default threshold.
    const candTokens = tokenise(c.description ?? '')
    const j = jaccard(focalTokens, candTokens)
    if (j > 0) {
      score += j * 0.7
      if (j >= 0.20) {
        reasons.push(`Similar description (Jaccard ${(j * 100).toFixed(0)}%)`)
      }
    }

    // Same incident type — small bonus.
    if (focal.incident_type === c.incident_type) {
      score += 0.05
    }

    if (score >= threshold && reasons.length > 0) {
      out.push({ candidate: c, score: Math.min(1, score), reasons })
    }
  }

  out.sort((a, b) => b.score - a.score)
  return out.slice(0, limit)
}
