// Assisted (ADA) delivery of a STRIKE module, for workers who can't read or
// write: they watch the narrated scenes only, and a supervisor verifies their
// understanding in person, works through a checklist, and signs.
//
// The checklist and acknowledgment are built here, from the module itself,
// so the server never stores wording a browser supplied: the signed record
// says exactly what the supervisor saw.

import {
  missingRequiredBlocks,
  type StrikeBlockEventRecord,
  type StrikeCalloutBlock,
  type StrikeContent,
} from './strikeContent'

export type StrikeAssistedLocale = 'en' | 'es'

/** The videos, in order: everything an assisted learner is shown. */
export function strikeAssistedContent(content: StrikeContent): StrikeContent {
  return { blocks: content.blocks.filter(block => block.kind === 'motion_scene') }
}

/** Scenes the learner still has to watch before a supervisor may sign. */
export function missingAssistedBlocks(content: StrikeContent, events: StrikeBlockEventRecord[]): string[] {
  return missingRequiredBlocks(strikeAssistedContent(content), events)
}

export interface StrikeChecklistItem {
  key: string
  text: string
  /** Shown under the item so the supervisor can read it aloud, e.g. a safety callout's body. */
  detail: string | null
}

const COPY = {
  en: {
    discussed: (name: string) => `I went over each video with ${name} and answered their questions.`,
    callout: (name: string, title: string) => `I read this safety warning aloud to ${name}, and they understood it: “${title}”`,
    questions: (name: string) => `I asked ${name} the knowledge-check questions aloud, and they answered correctly.`,
    demonstrated: (name: string) => `${name} explained or showed me the key steps in their own words.`,
    acknowledgment: (name: string, module: string) =>
      `I confirm that I verified, in person, that ${name} understands “${module}”. This training was delivered with a reading and writing accommodation, and the checklist above is accurate.`,
  },
  es: {
    discussed: (name: string) => `Repasé cada video con ${name} y respondí sus preguntas.`,
    callout: (name: string, title: string) => `Le leí en voz alta esta advertencia de seguridad a ${name} y la entendió: “${title}”`,
    questions: (name: string) => `Le hice a ${name} las preguntas de la evaluación en voz alta y las respondió correctamente.`,
    demonstrated: (name: string) => `${name} me explicó o me mostró los pasos clave con sus propias palabras.`,
    acknowledgment: (name: string, module: string) =>
      `Confirmo que verifiqué en persona que ${name} entiende “${module}”. Esta capacitación se dio con una adaptación para leer y escribir, y la lista de verificación anterior es correcta.`,
  },
} satisfies Record<StrikeAssistedLocale, Record<string, (...args: string[]) => string>>

/**
 * What the supervisor attests, item by item. Each safety callout becomes its
 * own item, with its text to read aloud: an assisted learner never sees the
 * callouts, and they carry warnings the scenes alone don't.
 */
export function strikeAssistedChecklist(
  content: StrikeContent,
  args: { learnerName: string; locale: StrikeAssistedLocale },
): StrikeChecklistItem[] {
  const copy = COPY[args.locale]
  const callouts = content.blocks.filter((b): b is StrikeCalloutBlock => b.kind === 'callout')
  return [
    { key: 'discussed', text: copy.discussed(args.learnerName), detail: null },
    ...callouts.map(c => ({ key: `callout:${c.key}`, text: copy.callout(args.learnerName, c.title), detail: c.body || null })),
    { key: 'questions', text: copy.questions(args.learnerName), detail: null },
    { key: 'demonstrated', text: copy.demonstrated(args.learnerName), detail: null },
  ]
}

export function strikeAssistedAcknowledgment(args: { learnerName: string; moduleTitle: string; locale: StrikeAssistedLocale }): string {
  return COPY[args.locale].acknowledgment(args.learnerName, args.moduleTitle)
}

/** Items the supervisor has not ticked. Empty means the checklist is complete. */
export function uncheckedChecklistItems(items: StrikeChecklistItem[], checkedKeys: readonly string[]): string[] {
  const checked = new Set(checkedKeys)
  return items.filter(item => !checked.has(item.key)).map(item => item.key)
}
