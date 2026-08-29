// Closed taxonomy + deterministic gate for hazards read out of field photos.
// Pure — no I/O, no model call. The vision model proposes; this module decides.
//
// WHY A CLOSED TAXONOMY
// A free-text hazard description cannot be counted, trended, or fed to the
// risk model — "guard was off" and "missing machine guard" would be two
// different hazards forever. Constraining the model to a fixed code list makes
// the output a countable signal instead of prose.
//
// WHY ORDINAL CONFIDENCE, NOT A NUMBER
// The LOTO audit's vision agent already settled this: it emits
// 'high' | 'medium' | 'low' and lets deterministic code decide (see
// lib/loto/audit/schemas.ts). A self-reported 0..1 from an LLM is not a
// calibrated probability — it drifts with prompt, image quality, and hazard
// class, so a threshold on it means something different for every code. An
// ordinal scale makes no claim it cannot support, and the gate below is where
// the actual decision lives.
//
// WHY PER-SOURCE ELIGIBILITY
// A photo's FRAMING encodes what it can answer. A hot-work permit photo is
// shot at the work area to evidence fire watch and shielding; a close-up of a
// valve on an incident report was never framed to show whether anyone in the
// room is wearing a hard hat. Asking every code of every photo manufactures
// false positives from absence-of-evidence. Each source kind therefore
// declares the codes its framing can actually support.

// ──────────────────────────────────────────────────────────────────────────
// Codes
// ──────────────────────────────────────────────────────────────────────────

export const VISION_HAZARD_CODES = [
  'ppe_head',
  'ppe_eye',
  'ppe_hand',
  'ppe_foot',
  'ppe_hi_vis',
  'ppe_fall_arrest',
  'guard_removed',
  'egress_blocked',
  'housekeeping',
  'spill_leak',
  'damaged_equipment',
  'signage_missing',
  'electrical_exposed',
  'working_at_height_unprotected',
] as const

export type VisionHazardCode = typeof VISION_HAZARD_CODES[number]

const CODE_SET: ReadonlySet<string> = new Set(VISION_HAZARD_CODES)

export function isVisionHazardCode(value: unknown): value is VisionHazardCode {
  return typeof value === 'string' && CODE_SET.has(value)
}

export const VISION_HAZARD_LABELS: Record<VisionHazardCode, string> = {
  ppe_head:                      'Head protection not worn',
  ppe_eye:                       'Eye protection not worn',
  ppe_hand:                      'Hand protection not worn',
  ppe_foot:                      'Foot protection not worn',
  ppe_hi_vis:                    'High-visibility clothing not worn',
  ppe_fall_arrest:               'Fall-arrest harness not worn or not connected',
  guard_removed:                 'Machine guard removed or defeated',
  egress_blocked:                'Exit route or egress path blocked',
  housekeeping:                  'Housekeeping — clutter, debris, or trip hazard',
  spill_leak:                    'Spill or active leak',
  damaged_equipment:             'Visibly damaged equipment',
  signage_missing:               'Required signage missing or illegible',
  electrical_exposed:            'Exposed or unsecured electrical conductors',
  working_at_height_unprotected: 'Work at height without edge protection',
}

// ──────────────────────────────────────────────────────────────────────────
// Sources
// ──────────────────────────────────────────────────────────────────────────

// The photo-bearing record kinds the sweep reads. Each maps to one table; the
// sweep resolves the image through that row so the signal never holds its own
// copy of a photo URL.
export const VISION_SOURCE_KINDS = [
  'bbs_observation',
  'incident_attachment',
  'hot_work_permit',
  'hazwaste_inspection',
] as const

export type VisionSourceKind = typeof VISION_SOURCE_KINDS[number]

export function isVisionSourceKind(value: unknown): value is VisionSourceKind {
  return typeof value === 'string' && (VISION_SOURCE_KINDS as readonly string[]).includes(value)
}

// Codes each source's framing can actually support. A BBS observation is shot
// deliberately at a behaviour or condition, so it carries the full set. The
// others are evidence photos for a specific record and answer a narrower
// question — anything outside their list is absence-of-evidence, not a finding.
export const ELIGIBLE_CODES_BY_SOURCE: Record<VisionSourceKind, readonly VisionHazardCode[]> = {
  bbs_observation: VISION_HAZARD_CODES,
  // Incident evidence is shot at the thing that went wrong, usually after the
  // fact and often after the area was made safe. Person-centric PPE codes read
  // false here; equipment and area conditions survive.
  incident_attachment: [
    'guard_removed', 'egress_blocked', 'housekeeping', 'spill_leak',
    'damaged_equipment', 'signage_missing', 'electrical_exposed',
  ],
  // Hot-work permit photos evidence the fire-watch setup at the work area.
  hot_work_permit: [
    'ppe_eye', 'ppe_hand', 'egress_blocked', 'housekeeping',
    'signage_missing', 'electrical_exposed', 'working_at_height_unprotected',
  ],
  // Hazardous-waste inspection photos are shot at a container or accumulation
  // area — container condition, containment, labelling.
  hazwaste_inspection: [
    'spill_leak', 'damaged_equipment', 'signage_missing', 'housekeeping', 'egress_blocked',
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Confidence
// ──────────────────────────────────────────────────────────────────────────

// Same ordinal scale the LOTO audit's vision agents use.
export const VISION_CONFIDENCES = ['high', 'medium', 'low'] as const
export type VisionConfidence = typeof VISION_CONFIDENCES[number]

const CONFIDENCE_RANK: Record<VisionConfidence, number> = { low: 1, medium: 2, high: 3 }

// Minimum confidence a code needs to become a signal.
//
// 'high' is required where a wrong call is most likely: every PPE code depends
// on seeing a whole person, and guard_removed depends on knowing what the
// guard should look like — both are exactly the judgements a single framed
// photo gets wrong. 'medium' is enough for conditions that are self-evident in
// the frame (a spill is a spill).
const MIN_CONFIDENCE_BY_CODE: Record<VisionHazardCode, VisionConfidence> = {
  ppe_head:                      'high',
  ppe_eye:                       'high',
  ppe_hand:                      'high',
  ppe_foot:                      'high',
  ppe_hi_vis:                    'high',
  ppe_fall_arrest:               'high',
  guard_removed:                 'high',
  working_at_height_unprotected: 'high',
  electrical_exposed:            'high',
  egress_blocked:                'medium',
  housekeeping:                  'medium',
  spill_leak:                    'medium',
  damaged_equipment:             'medium',
  signage_missing:               'medium',
}

export function minimumConfidenceFor(code: VisionHazardCode): VisionConfidence {
  return MIN_CONFIDENCE_BY_CODE[code]
}

// ──────────────────────────────────────────────────────────────────────────
// Severity weight
// ──────────────────────────────────────────────────────────────────────────

// Relative weight a confirmed signal carries into the risk model, so that ten
// housekeeping findings do not outrank one defeated machine guard. Anchored on
// the hazards that actually kill in this industry: fall protection, machine
// guarding, and energised electrical work.
const SEVERITY_WEIGHT_BY_CODE: Record<VisionHazardCode, number> = {
  ppe_fall_arrest:               3,
  working_at_height_unprotected: 3,
  guard_removed:                 3,
  electrical_exposed:            3,
  egress_blocked:                2,
  spill_leak:                    2,
  damaged_equipment:             2,
  ppe_head:                      2,
  ppe_eye:                       2,
  ppe_hand:                      1,
  ppe_foot:                      1,
  ppe_hi_vis:                    1,
  housekeeping:                  1,
  signage_missing:               1,
}

export function severityWeightFor(code: VisionHazardCode): number {
  return SEVERITY_WEIGHT_BY_CODE[code]
}

// ──────────────────────────────────────────────────────────────────────────
// Evidence text
// ──────────────────────────────────────────────────────────────────────────

/** Hard cap on the model's one-line justification. */
export const MAX_EVIDENCE_LENGTH = 240

/**
 * Normalizes the model's free-text justification for storage.
 *
 * This string is the ONLY unbounded field crossing the boundary, and its
 * content originates partly in the photo — signage, whiteboards, and printed
 * labels all land in the model's context, so a photographed instruction is
 * untrusted input. It is stored for a human reviewer to read and is never
 * re-fed to another prompt. Collapsing whitespace and stripping control
 * characters keeps a crafted multi-line payload from rendering as structure
 * wherever it is displayed.
 */
export function sanitizeEvidence(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const stripped = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
  const collapsed = stripped.replace(/\s+/g, ' ').trim()
  return collapsed.length <= MAX_EVIDENCE_LENGTH
    ? collapsed
    : collapsed.slice(0, MAX_EVIDENCE_LENGTH - 1) + '…'
}

// ──────────────────────────────────────────────────────────────────────────
// The gate
// ──────────────────────────────────────────────────────────────────────────

/** One raw proposal from the vision model, before any gating. */
export interface VisionFindingInput {
  code:       unknown
  confidence: unknown
  evidence:   unknown
}

export interface AcceptedVisionSignal {
  code:           VisionHazardCode
  confidence:     VisionConfidence
  evidence:       string
  severityWeight: number
}

export type VisionRejectReason =
  | 'unknown_code'
  | 'unknown_confidence'
  | 'ineligible_for_source'
  | 'below_confidence_floor'
  | 'duplicate_code'

export interface RejectedVisionFinding {
  /** The raw code as received — kept as a string for the run log. */
  code:   string
  reason: VisionRejectReason
}

export interface VisionGateResult {
  accepted: AcceptedVisionSignal[]
  rejected: RejectedVisionFinding[]
}

/**
 * Applies every deterministic rule to one photo's findings.
 *
 * Rejections are returned rather than dropped: a run that discards 90% of what
 * the model proposed is telling you the prompt or the eligibility map is
 * wrong, and that is only visible if the counts survive. Order is stable —
 * accepted findings keep the model's ordering so the reviewer sees them as the
 * model ranked them.
 */
export function gateVisionFindings(
  findings: readonly VisionFindingInput[],
  sourceKind: VisionSourceKind,
): VisionGateResult {
  const eligible = new Set<string>(ELIGIBLE_CODES_BY_SOURCE[sourceKind])
  const accepted: AcceptedVisionSignal[] = []
  const rejected: RejectedVisionFinding[] = []
  // A model that repeats a code for the same photo is describing one hazard
  // twice; keeping both would double-count it into the risk model.
  const bestByCode = new Map<VisionHazardCode, number>()

  for (const finding of findings) {
    const rawCode = typeof finding.code === 'string' ? finding.code : String(finding.code)

    if (!isVisionHazardCode(finding.code)) {
      rejected.push({ code: rawCode, reason: 'unknown_code' })
      continue
    }
    const code = finding.code

    if (!isVisionConfidence(finding.confidence)) {
      rejected.push({ code, reason: 'unknown_confidence' })
      continue
    }
    const confidence = finding.confidence

    if (!eligible.has(code)) {
      rejected.push({ code, reason: 'ineligible_for_source' })
      continue
    }

    if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[MIN_CONFIDENCE_BY_CODE[code]]) {
      rejected.push({ code, reason: 'below_confidence_floor' })
      continue
    }

    const seenAt = bestByCode.get(code)
    if (seenAt !== undefined) {
      // Keep whichever reading is more confident; the loser is a duplicate.
      if (CONFIDENCE_RANK[confidence] > CONFIDENCE_RANK[accepted[seenAt].confidence]) {
        accepted[seenAt] = {
          code,
          confidence,
          evidence:       sanitizeEvidence(finding.evidence),
          severityWeight: SEVERITY_WEIGHT_BY_CODE[code],
        }
      }
      rejected.push({ code, reason: 'duplicate_code' })
      continue
    }

    bestByCode.set(code, accepted.length)
    accepted.push({
      code,
      confidence,
      evidence:       sanitizeEvidence(finding.evidence),
      severityWeight: SEVERITY_WEIGHT_BY_CODE[code],
    })
  }

  return { accepted, rejected }
}

function isVisionConfidence(value: unknown): value is VisionConfidence {
  return typeof value === 'string' && (VISION_CONFIDENCES as readonly string[]).includes(value)
}

// ──────────────────────────────────────────────────────────────────────────
// Identity
// ──────────────────────────────────────────────────────────────────────────

/**
 * The natural key for a signal — what makes two findings "the same finding".
 *
 * Deliberately excludes the run id. A sweep is resumable and re-runnable, so
 * keying on the run would let one hazard land N times and inflate a
 * deterministic risk score. It also excludes the photo URL: storage URLs get
 * cache-busted and swapped in place, so the same image reachable by two URLs
 * must not become two hazards. Content hash is the only stable identity a
 * photo has.
 *
 * Mirrors the unique index the sweep upserts against.
 */
export function visionSignalIdentity(args: {
  sourceKind:  VisionSourceKind
  sourceId:    string
  photoSha256: string
  code:        VisionHazardCode
}): string {
  return [args.sourceKind, args.sourceId, args.photoSha256, args.code].join(':')
}
