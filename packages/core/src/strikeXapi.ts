// xAPI (Experience API 1.0.3) statements for STRIKE learning events, so any
// LMS with a Learning Record Store can import STRIKE progress.
//
// Pure: statement ids and timestamps come from the caller, which makes every
// statement reproducible from the evidence row it describes.

import type {
  StrikeBlock,
  StrikeBlockEvent,
  StrikeCalloutBlock,
  StrikeContent,
  StrikeInteractionBlock,
  StrikeMotionSceneBlock,
} from './strikeContent'

export const XAPI_VERSION = '1.0.3'

/** IRIs only identify; they never need to resolve. Fixed so a change of host never forks a learner's history. */
export const STRIKE_XAPI_IRI_BASE = 'https://soteriafield.app/xapi/strike'
export const STRIKE_XAPI_ACCOUNT_HOME = 'https://soteriafield.app'

const VERB_IRI = {
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  completed: 'http://adlnet.gov/expapi/verbs/completed',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
} as const
export type StrikeXapiVerb = keyof typeof VERB_IRI

const ACTIVITY_TYPE = {
  course: 'http://adlnet.gov/expapi/activities/course',
  media: 'http://adlnet.gov/expapi/activities/media',
  lesson: 'http://adlnet.gov/expapi/activities/lesson',
  interaction: 'http://adlnet.gov/expapi/activities/cmi.interaction',
} as const

const INTERACTION_TYPE: Record<StrikeInteractionBlock['kind'], 'sequencing' | 'matching' | 'choice'> = {
  drag_sort: 'sequencing',
  drag_match: 'matching',
  hotspot: 'choice',
  scenario: 'choice',
}

const HINTS_USED_EXTENSION = `${STRIKE_XAPI_IRI_BASE}/extensions/hints-used`
const MODULE_VERSION_EXTENSION = `${STRIKE_XAPI_IRI_BASE}/extensions/module-version`

export interface XapiAgent {
  objectType: 'Agent'
  name?: string
  mbox?: string
  account?: { homePage: string; name: string }
}

export interface XapiActivity {
  objectType: 'Activity'
  id: string
  definition: {
    name: Record<string, string>
    type: string
    interactionType?: 'sequencing' | 'matching' | 'choice'
  }
}

export interface XapiStatement {
  id: string
  actor: XapiAgent
  verb: { id: string; display: Record<string, string> }
  object: XapiActivity
  result?: {
    success?: boolean
    completion?: boolean
    score?: { scaled: number; raw: number; min: number; max: number }
    extensions?: Record<string, unknown>
  }
  context: {
    registration: string
    platform: string
    language: string
    contextActivities?: { parent: XapiActivity[] }
    extensions: Record<string, unknown>
  }
  timestamp: string
}

export interface StrikeXapiLearner {
  name: string | null
  email: string | null
  /** Stable id for learners without an email (kiosk roster members). */
  accountName: string
}

/** LMSs match learners by email, so mbox when we have one; otherwise a stable account. */
export function strikeXapiActor(learner: StrikeXapiLearner): XapiAgent {
  const name = learner.name?.trim() || undefined
  const email = learner.email?.trim().toLowerCase()
  if (email) return { objectType: 'Agent', name, mbox: `mailto:${email}` }
  return { objectType: 'Agent', name, account: { homePage: STRIKE_XAPI_ACCOUNT_HOME, name: learner.accountName } }
}

export interface StrikeXapiModule {
  moduleId: string
  moduleTitle: string
  versionId: string
  locale: string
}

export type StrikeXapiEvent =
  | { verb: 'attempted' }
  | { verb: 'experienced'; block: StrikeMotionSceneBlock | StrikeCalloutBlock }
  | { verb: 'answered'; block: StrikeInteractionBlock; success: boolean; hintsUsed: number }
  /** An interaction solved; `answered` only records the first try. */
  | { verb: 'completed'; block: StrikeInteractionBlock }
  | { verb: 'passed' | 'failed'; scorePercent: number }
  /** The module itself. */
  | { verb: 'completed'; block: null }

/** The activity the statement is about: the module, or one block of it. */
export function strikeXapiActivityId(module: Pick<StrikeXapiModule, 'moduleId'>, blockKey: string | null): string {
  const moduleIri = `${STRIKE_XAPI_IRI_BASE}/modules/${module.moduleId}`
  return blockKey ? `${moduleIri}/blocks/${blockKey}` : moduleIri
}

export function strikeXapiStatement(args: {
  id: string
  timestamp: string
  registration: string
  actor: XapiAgent
  module: StrikeXapiModule
  event: StrikeXapiEvent
}): XapiStatement {
  const { module, event } = args
  const moduleActivity: XapiActivity = {
    objectType: 'Activity',
    id: strikeXapiActivityId(module, null),
    definition: { name: { [module.locale]: module.moduleTitle }, type: ACTIVITY_TYPE.course },
  }
  const block = 'block' in event ? event.block : null
  const object = block ? blockActivity(module, block) : moduleActivity

  return {
    id: args.id,
    actor: args.actor,
    verb: { id: VERB_IRI[event.verb], display: { 'en-US': event.verb } },
    object,
    ...resultFor(event),
    context: {
      registration: args.registration,
      platform: 'Soteria Field STRIKE',
      language: module.locale,
      ...(block ? { contextActivities: { parent: [moduleActivity] } } : {}),
      extensions: { [MODULE_VERSION_EXTENSION]: module.versionId },
    },
    timestamp: args.timestamp,
  }
}

function resultFor(event: StrikeXapiEvent): Pick<XapiStatement, 'result'> {
  switch (event.verb) {
    case 'answered':
      return { result: { success: event.success, extensions: { [HINTS_USED_EXTENSION]: event.hintsUsed } } }
    // A module is only ever reported completed on a pass, and a supervisor
    // sign-off (assisted delivery) has no score to send as 'passed', so this
    // statement is what tells an LMS the learner succeeded.
    case 'completed':
      return { result: { completion: true, success: true } }
    case 'passed':
    case 'failed': {
      const raw = Math.max(0, Math.min(100, Math.round(event.scorePercent)))
      return { result: { success: event.verb === 'passed', completion: true, score: { scaled: raw / 100, raw, min: 0, max: 100 } } }
    }
    default:
      return {}
  }
}

function blockActivity(module: StrikeXapiModule, block: StrikeBlock): XapiActivity {
  const name = { [module.locale]: truncate(blockName(block)) }
  const id = strikeXapiActivityId(module, block.key)
  switch (block.kind) {
    case 'motion_scene':
      return { objectType: 'Activity', id, definition: { name, type: ACTIVITY_TYPE.media } }
    case 'callout':
      return { objectType: 'Activity', id, definition: { name, type: ACTIVITY_TYPE.lesson } }
    default:
      return { objectType: 'Activity', id, definition: { name, type: ACTIVITY_TYPE.interaction, interactionType: INTERACTION_TYPE[block.kind] } }
  }
}

function blockName(block: StrikeBlock): string {
  switch (block.kind) {
    case 'motion_scene':
    case 'callout':
      return block.title
    case 'scenario':
      return block.stem
    default:
      return block.prompt
  }
}

function truncate(text: string): string {
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

/**
 * The xAPI events a batch of newly recorded block evidence implies. Only
 * evidence that means something to an LMS maps: a scene played through (or a
 * callout or silent scene seen), an interaction's first try, and its solve.
 */
export function strikeXapiEventsForBlockEvents(
  content: StrikeContent,
  events: { block_key: string; event: StrikeBlockEvent; detail: Record<string, unknown> }[],
): StrikeXapiEvent[] {
  const byKey = new Map(content.blocks.map(b => [b.key, b]))
  const out: StrikeXapiEvent[] = []
  for (const e of events) {
    const block = byKey.get(e.block_key)
    if (!block) continue
    if (block.kind === 'callout' || block.kind === 'motion_scene') {
      const experiencedOn: StrikeBlockEvent = block.kind === 'motion_scene' && block.narration ? 'completed' : 'seen'
      if (e.event === experiencedOn) out.push({ verb: 'experienced', block })
      continue
    }
    if (e.event === 'interaction') {
      const hints = Number(e.detail.hints_used)
      out.push({ verb: 'answered', block, success: e.detail.correct === true, hintsUsed: Number.isFinite(hints) && hints > 0 ? Math.floor(hints) : 0 })
    } else if (e.event === 'completed') {
      out.push({ verb: 'completed', block })
    }
  }
  return out
}
