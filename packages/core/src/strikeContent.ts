// STRIKE content model: the presentation half of a module version.
//
// A version's `content` jsonb holds a flat list of blocks played in order
// (continuous scroll, no page layer), followed by the graded quiz, which
// lives in the strike_quiz_* tables so the answer key can be column-revoked.
// The database only checks that `content.blocks` is an array; the shape is
// pinned here because block schemas evolve faster than migrations should.

export const STRIKE_BLOCK_KINDS = [
  'motion_scene',
  'callout',
  'drag_sort',
  'drag_match',
  'hotspot',
  'scenario',
] as const
export type StrikeBlockKind = typeof STRIKE_BLOCK_KINDS[number]

export const STRIKE_SCENE_ANIMATIONS = ['ken_burns_in', 'ken_burns_out', 'pan_left', 'pan_right', 'static'] as const
export type StrikeSceneAnimation = typeof STRIKE_SCENE_ANIMATIONS[number]

export const STRIKE_CALLOUT_TONES = ['danger', 'warning', 'info'] as const
export type StrikeCalloutTone = typeof STRIKE_CALLOUT_TONES[number]

export const STRIKE_BLOCK_EVENTS = ['seen', 'completed', 'interaction'] as const
export type StrikeBlockEvent = typeof STRIKE_BLOCK_EVENTS[number]

/** AI-produced media must carry a human approval before the version can publish. */
export interface StrikeApproval {
  ai_generated: boolean
  approved_by: string | null
  approved_at: string | null
}

export interface StrikeImageRef extends StrikeApproval {
  path: string
  alt: string
}

export interface StrikeNarrationRef extends StrikeApproval {
  audio_path: string
  captions_path: string
  transcript: string
  duration_ms: number
  voice: string | null
}

export interface StrikeSceneBeat {
  at_ms: number
  text: string
}

interface BlockBase {
  key: string
}

export interface StrikeMotionSceneBlock extends BlockBase {
  kind: 'motion_scene'
  eyebrow: string | null
  title: string
  script: string
  beats: StrikeSceneBeat[]
  animation: StrikeSceneAnimation
  image: StrikeImageRef | null
  narration: StrikeNarrationRef | null
}

export interface StrikeCalloutBlock extends BlockBase {
  kind: 'callout'
  tone: StrikeCalloutTone
  title: string
  body: string
}

export interface StrikeChoice {
  id: string
  label: string
}

export interface StrikeDragSortBlock extends BlockBase {
  kind: 'drag_sort'
  prompt: string
  /** Listed in the correct order; the player shuffles them. */
  items: StrikeChoice[]
  remediate_block_key: string | null
  /** Author-written nudge shown before the derived hint; null means derived only. */
  hint: string | null
}

export interface StrikeMatchPair {
  id: string
  prompt: string
  answer: string
}

export interface StrikeDragMatchBlock extends BlockBase {
  kind: 'drag_match'
  prompt: string
  pairs: StrikeMatchPair[]
  remediate_block_key: string | null
  hint: string | null
}

/** Coordinates are display-only percentages; grading is by target id. */
export interface StrikeHotspotTarget {
  id: string
  label: string
  x_pct: number
  y_pct: number
  correct: boolean
}

export interface StrikeHotspotBlock extends BlockBase {
  kind: 'hotspot'
  prompt: string
  image: StrikeImageRef
  targets: StrikeHotspotTarget[]
  remediate_block_key: string | null
  hint: string | null
}

export interface StrikeScenarioChoice extends StrikeChoice {
  correct: boolean
  feedback: string
}

export interface StrikeScenarioBlock extends BlockBase {
  kind: 'scenario'
  stem: string
  image: StrikeImageRef | null
  choices: StrikeScenarioChoice[]
  remediate_block_key: string | null
  hint: string | null
}

export type StrikeInteractionBlock =
  | StrikeDragSortBlock
  | StrikeDragMatchBlock
  | StrikeHotspotBlock
  | StrikeScenarioBlock

export type StrikeBlock = StrikeMotionSceneBlock | StrikeCalloutBlock | StrikeInteractionBlock

export interface StrikeContent {
  blocks: StrikeBlock[]
}

export interface StrikeContentIssue {
  index: number
  message: string
}

export type StrikeContentParseResult =
  | { ok: true; content: StrikeContent }
  | { ok: false; issues: StrikeContentIssue[] }

const BLOCK_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

// ── Parsing (boundary validation of untrusted jsonb) ────────────────────────

export function parseStrikeContent(value: unknown): StrikeContentParseResult {
  const issues: StrikeContentIssue[] = []
  if (!isRecord(value) || !Array.isArray(value.blocks)) {
    return { ok: false, issues: [{ index: -1, message: 'Content must be an object with a blocks array.' }] }
  }

  const parsedBlocks: { block: StrikeBlock; index: number }[] = []
  const seenKeys = new Set<string>()
  value.blocks.forEach((raw, index) => {
    const block = parseBlock(raw, index, issues)
    if (!block) return
    if (seenKeys.has(block.key)) issues.push({ index, message: `Duplicate block key "${block.key}".` })
    seenKeys.add(block.key)
    parsedBlocks.push({ block, index })
  })

  for (const { block, index } of parsedBlocks) {
    const target = 'remediate_block_key' in block ? block.remediate_block_key : null
    if (target && !seenKeys.has(target)) {
      issues.push({ index, message: `Remediation link points to unknown block "${target}".` })
    }
  }
  const blocks = parsedBlocks.map(p => p.block)

  return issues.length > 0 ? { ok: false, issues } : { ok: true, content: { blocks } }
}

function parseBlock(raw: unknown, index: number, issues: StrikeContentIssue[]): StrikeBlock | null {
  const fail = (message: string): null => {
    issues.push({ index, message })
    return null
  }
  if (!isRecord(raw)) return fail('Block must be an object.')
  const key = str(raw.key)
  if (!key || !BLOCK_KEY_RE.test(key)) return fail('Block key must be lowercase letters, digits, "-" or "_".')
  if (!isOneOf(raw.kind, STRIKE_BLOCK_KINDS)) return fail(`Unknown block kind "${String(raw.kind)}".`)

  switch (raw.kind) {
    case 'motion_scene': {
      const title = str(raw.title)
      if (!title) return fail('Scene needs a title.')
      const beats = Array.isArray(raw.beats) ? raw.beats.map(parseBeat) : []
      if (beats.some(b => b === null)) return fail('Every scene beat needs at_ms ≥ 0 and text.')
      const image = raw.image == null ? null : parseImage(raw.image)
      if (raw.image != null && !image) return fail('Scene image needs a path.')
      const narration = raw.narration == null ? null : parseNarration(raw.narration)
      if (raw.narration != null && !narration) return fail('Scene narration needs audio_path, captions_path and duration_ms.')
      return {
        key,
        kind: 'motion_scene',
        eyebrow: str(raw.eyebrow) || null,
        title,
        script: str(raw.script),
        beats: (beats as StrikeSceneBeat[]).sort((a, b) => a.at_ms - b.at_ms),
        animation: isOneOf(raw.animation, STRIKE_SCENE_ANIMATIONS) ? raw.animation : 'ken_burns_in',
        image,
        narration,
      }
    }
    case 'callout': {
      const title = str(raw.title)
      if (!title) return fail('Callout needs a title.')
      return {
        key,
        kind: 'callout',
        tone: isOneOf(raw.tone, STRIKE_CALLOUT_TONES) ? raw.tone : 'info',
        title,
        body: str(raw.body),
      }
    }
    case 'drag_sort': {
      const items = parseChoices(raw.items)
      if (!items || items.length < 3) return fail('Drag-sort needs at least 3 items with unique ids.')
      return { key, kind: 'drag_sort', prompt: str(raw.prompt), items, remediate_block_key: str(raw.remediate_block_key) || null, hint: str(raw.hint) || null }
    }
    case 'drag_match': {
      const pairs = Array.isArray(raw.pairs) ? raw.pairs.map(parsePair) : []
      if (pairs.length < 2 || pairs.some(p => p === null)) return fail('Drag-match needs at least 2 pairs with id, prompt and answer.')
      if (!uniqueIds(pairs as StrikeMatchPair[])) return fail('Drag-match pair ids must be unique.')
      return { key, kind: 'drag_match', prompt: str(raw.prompt), pairs: pairs as StrikeMatchPair[], remediate_block_key: str(raw.remediate_block_key) || null, hint: str(raw.hint) || null }
    }
    case 'hotspot': {
      const image = parseImage(raw.image)
      if (!image) return fail('Hotspot needs an image.')
      const targets = Array.isArray(raw.targets) ? raw.targets.map(parseTarget) : []
      if (targets.length < 2 || targets.some(t => t === null)) return fail('Hotspot needs at least 2 targets positioned within 0–100%.')
      if (!uniqueIds(targets as StrikeHotspotTarget[])) return fail('Hotspot target ids must be unique.')
      if (!(targets as StrikeHotspotTarget[]).some(t => t.correct)) return fail('Hotspot needs at least one correct target.')
      return { key, kind: 'hotspot', prompt: str(raw.prompt), image, targets: targets as StrikeHotspotTarget[], remediate_block_key: str(raw.remediate_block_key) || null, hint: str(raw.hint) || null }
    }
    case 'scenario': {
      const choices = Array.isArray(raw.choices) ? raw.choices.map(parseScenarioChoice) : []
      if (choices.length < 2 || choices.some(c => c === null)) return fail('Scenario needs at least 2 choices with feedback.')
      if (!uniqueIds(choices as StrikeScenarioChoice[])) return fail('Scenario choice ids must be unique.')
      if (!(choices as StrikeScenarioChoice[]).some(c => c.correct)) return fail('Scenario needs a correct choice.')
      const image = raw.image == null ? null : parseImage(raw.image)
      return { key, kind: 'scenario', stem: str(raw.stem), image, choices: choices as StrikeScenarioChoice[], remediate_block_key: str(raw.remediate_block_key) || null, hint: str(raw.hint) || null }
    }
  }
}

function parseBeat(raw: unknown): StrikeSceneBeat | null {
  if (!isRecord(raw)) return null
  const atMs = num(raw.at_ms)
  const text = str(raw.text)
  return atMs !== null && atMs >= 0 && text ? { at_ms: Math.round(atMs), text } : null
}

function parseApproval(raw: Record<string, unknown>): StrikeApproval {
  return {
    ai_generated: raw.ai_generated === true,
    approved_by: str(raw.approved_by) || null,
    approved_at: str(raw.approved_at) || null,
  }
}

function parseImage(raw: unknown): StrikeImageRef | null {
  if (!isRecord(raw)) return null
  const path = str(raw.path)
  return path ? { path, alt: str(raw.alt), ...parseApproval(raw) } : null
}

function parseNarration(raw: unknown): StrikeNarrationRef | null {
  if (!isRecord(raw)) return null
  const audioPath = str(raw.audio_path)
  const captionsPath = str(raw.captions_path)
  const durationMs = num(raw.duration_ms)
  if (!audioPath || !captionsPath || durationMs === null || durationMs <= 0) return null
  return {
    audio_path: audioPath,
    captions_path: captionsPath,
    transcript: str(raw.transcript),
    duration_ms: Math.round(durationMs),
    voice: str(raw.voice) || null,
    ...parseApproval(raw),
  }
}

function parseChoices(raw: unknown): StrikeChoice[] | null {
  if (!Array.isArray(raw)) return null
  const choices = raw.map(c => (isRecord(c) && str(c.id) && str(c.label) ? { id: str(c.id), label: str(c.label) } : null))
  if (choices.some(c => c === null)) return null
  return uniqueIds(choices as StrikeChoice[]) ? (choices as StrikeChoice[]) : null
}

function parsePair(raw: unknown): StrikeMatchPair | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const prompt = str(raw.prompt)
  const answer = str(raw.answer)
  return id && prompt && answer ? { id, prompt, answer } : null
}

function parseTarget(raw: unknown): StrikeHotspotTarget | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const x = num(raw.x_pct)
  const y = num(raw.y_pct)
  if (!id || x === null || y === null || x < 0 || x > 100 || y < 0 || y > 100) return null
  return { id, label: str(raw.label) || id, x_pct: x, y_pct: y, correct: raw.correct === true }
}

function parseScenarioChoice(raw: unknown): StrikeScenarioChoice | null {
  if (!isRecord(raw)) return null
  const id = str(raw.id)
  const label = str(raw.label)
  const feedback = str(raw.feedback)
  return id && label && feedback ? { id, label, feedback, correct: raw.correct === true } : null
}

// ── Publish preflight ───────────────────────────────────────────────────────

export interface StrikePublishQuestion {
  prompt: string
  graded: boolean
  answers: { is_correct: boolean }[]
}

export interface StrikePublishInput {
  content: StrikeContent
  questions: StrikePublishQuestion[]
  passingScore: number | null
  estimatedMinutes: number
}

/**
 * Blocking checks before a version may publish. A graded question with no
 * correct answer is unpassable forever, and unapproved AI media is an
 * unreviewed safety claim, so neither is advisory.
 */
export function validateStrikeVersionForPublish(input: StrikePublishInput): StrikeContentIssue[] {
  const issues: StrikeContentIssue[] = []

  input.content.blocks.forEach((block, index) => {
    for (const image of blockImages(block)) {
      if (!image.alt.trim()) issues.push({ index, message: `Block "${block.key}" has an image without alt text.` })
      if (image.ai_generated && !isApproved(image)) {
        issues.push({ index, message: `Block "${block.key}" has an AI image awaiting human approval.` })
      }
    }
    if (block.kind === 'motion_scene' && block.narration) {
      if (!block.narration.transcript.trim()) issues.push({ index, message: `Scene "${block.key}" narration has no transcript.` })
      if (block.narration.ai_generated && !isApproved(block.narration)) {
        issues.push({ index, message: `Scene "${block.key}" has AI narration awaiting human approval.` })
      }
    }
  })

  input.questions.forEach((question, index) => {
    if (question.graded && !question.answers.some(a => a.is_correct)) {
      issues.push({ index, message: `Question ${index + 1} ("${truncate(question.prompt)}") has no correct answer.` })
    }
  })

  if (input.questions.filter(q => q.graded).length === 0) {
    issues.push({ index: -1, message: 'A module needs at least one graded knowledge-check question.' })
  }
  if (input.passingScore == null || input.passingScore < 1 || input.passingScore > 100) {
    issues.push({ index: -1, message: 'Set a passing score between 1 and 100.' })
  }

  const runtimeMs = strikeContentRuntimeMs(input.content)
  if (runtimeMs > input.estimatedMinutes * 60_000) {
    issues.push({
      index: -1,
      message: `Narration runs ${formatDuration(runtimeMs)}, longer than the ${input.estimatedMinutes}-minute estimate.`,
    })
  }

  return issues
}

function blockImages(block: StrikeBlock): StrikeImageRef[] {
  switch (block.kind) {
    case 'motion_scene':
    case 'scenario':
      return block.image ? [block.image] : []
    case 'hotspot':
      return [block.image]
    default:
      return []
  }
}

/** Every storage object the player needs, deduplicated, for one batch of signed URLs. */
export function strikeContentAssetPaths(content: StrikeContent): string[] {
  const paths = new Set<string>()
  for (const block of content.blocks) {
    for (const image of blockImages(block)) paths.add(image.path)
    if (block.kind === 'motion_scene' && block.narration) {
      paths.add(block.narration.audio_path)
      paths.add(block.narration.captions_path)
    }
  }
  return [...paths]
}

function isApproved(approval: StrikeApproval): boolean {
  return !!approval.approved_by && !!approval.approved_at
}

export function strikeContentRuntimeMs(content: StrikeContent): number {
  return content.blocks.reduce(
    (sum, block) => sum + (block.kind === 'motion_scene' && block.narration ? block.narration.duration_ms : 0),
    0,
  )
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

// ── Interaction scoring (formative: feedback, never credit) ─────────────────

export type StrikeInteractionResponse =
  | { kind: 'drag_sort'; orderedIds: string[] }
  | { kind: 'drag_match'; answerByPairId: Record<string, string> }
  | { kind: 'hotspot'; selectedIds: string[] }
  | { kind: 'scenario'; choiceId: string }

export interface StrikeInteractionResult {
  correct: boolean
  /** Item ids that are wrong, so the player can highlight exactly what to fix. */
  incorrectIds: string[]
}

export function scoreStrikeInteraction(
  block: StrikeInteractionBlock,
  response: StrikeInteractionResponse,
): StrikeInteractionResult {
  if (block.kind !== response.kind) return { correct: false, incorrectIds: [] }

  switch (block.kind) {
    case 'drag_sort': {
      const ordered = (response as Extract<StrikeInteractionResponse, { kind: 'drag_sort' }>).orderedIds
      const incorrectIds = block.items.filter((item, i) => ordered[i] !== item.id).map(item => item.id)
      return { correct: incorrectIds.length === 0 && ordered.length === block.items.length, incorrectIds }
    }
    case 'drag_match': {
      const answers = (response as Extract<StrikeInteractionResponse, { kind: 'drag_match' }>).answerByPairId
      const incorrectIds = block.pairs.filter(pair => answers[pair.id] !== pair.answer).map(pair => pair.id)
      return { correct: incorrectIds.length === 0, incorrectIds }
    }
    case 'hotspot': {
      const selected = new Set((response as Extract<StrikeInteractionResponse, { kind: 'hotspot' }>).selectedIds)
      const incorrectIds = block.targets.filter(t => t.correct !== selected.has(t.id)).map(t => t.id)
      return { correct: incorrectIds.length === 0, incorrectIds }
    }
    case 'scenario': {
      const choiceId = (response as Extract<StrikeInteractionResponse, { kind: 'scenario' }>).choiceId
      const choice = block.choices.find(c => c.id === choiceId)
      return { correct: !!choice?.correct, incorrectIds: choice?.correct ? [] : [choiceId] }
    }
  }
}

// ── Hints (escalating: the author's nudge first, then a partial reveal) ────

export type StrikeInteractionHint =
  | { kind: 'authored'; text: string }
  | { kind: 'sort_ends'; first: string; last: string }
  | { kind: 'match_one'; prompt: string; answer: string }
  | { kind: 'hotspot_count'; correctCount: number; example: string }
  | { kind: 'scenario_not'; label: string }

/**
 * The hints a learner can reveal one at a time. The last one is always
 * derived from the block's own answer key, so every practice check has a
 * hint, including content that published before authors could write one.
 * Structured rather than prose so the player can phrase it in any locale.
 */
export function strikeInteractionHints(block: StrikeInteractionBlock): StrikeInteractionHint[] {
  const authored: StrikeInteractionHint[] = block.hint ? [{ kind: 'authored', text: block.hint }] : []
  return [...authored, derivedHint(block)]
}

function derivedHint(block: StrikeInteractionBlock): StrikeInteractionHint {
  switch (block.kind) {
    case 'drag_sort':
      return { kind: 'sort_ends', first: block.items[0].label, last: block.items[block.items.length - 1].label }
    case 'drag_match':
      return { kind: 'match_one', prompt: block.pairs[0].prompt, answer: block.pairs[0].answer }
    case 'hotspot': {
      const correct = block.targets.filter(t => t.correct)
      return { kind: 'hotspot_count', correctCount: correct.length, example: correct[0].label }
    }
    case 'scenario':
      return { kind: 'scenario_not', label: (block.choices.find(c => !c.correct) ?? block.choices[0]).label }
  }
}

// ── Completion evidence ─────────────────────────────────────────────────────

export interface StrikeBlockEventRecord {
  block_key: string
  event: StrikeBlockEvent
}

/**
 * What each block needs before the graded quiz counts: scenes must be played
 * through (or seen, when silent), callouts seen, interactions solved.
 */
export function requiredEventFor(block: StrikeBlock): StrikeBlockEvent {
  if (block.kind === 'callout') return 'seen'
  if (block.kind === 'motion_scene' && !block.narration) return 'seen'
  return 'completed'
}

export function missingRequiredBlocks(content: StrikeContent, events: StrikeBlockEventRecord[]): string[] {
  const reached = new Map<string, Set<StrikeBlockEvent>>()
  for (const e of events) {
    const set = reached.get(e.block_key) ?? new Set<StrikeBlockEvent>()
    set.add(e.event)
    reached.set(e.block_key, set)
  }
  return content.blocks
    .filter(block => {
      const got = reached.get(block.key)
      const need = requiredEventFor(block)
      return !(got?.has(need) || (need === 'seen' && got?.has('completed')))
    })
    .map(block => block.key)
}

/** Deterministic shuffle so a learner's layout is stable across re-renders. */
export function stableShuffle<T>(items: readonly T[], seed: string): T[] {
  let state = 2166136261
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619)
  const next = () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507)
    state = Math.imul(state ^ (state >>> 13), 3266489909)
    state ^= state >>> 16
    return (state >>> 0) / 4294967296
  }
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out.length > 1 && out.every((item, i) => item === items[i])) out.push(out.shift() as T)
  return out
}

// ── helpers ─────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value)
}

function uniqueIds(items: { id: string }[]): boolean {
  return new Set(items.map(i => i.id)).size === items.length
}

function truncate(text: string, max = 48): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
