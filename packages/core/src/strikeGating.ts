// How a learner moves through a STRIKE module: strictly in order. Everything
// after the first unfinished block stays locked, so the next scene cannot
// play until the check before it is solved. Shared by the web player and the
// tablet app so both lock exactly the same blocks.

import { missingRequiredBlocks, type StrikeBlock, type StrikeBlockEventRecord, type StrikeContent } from './strikeContent'

/** A block counts as "seen" once this share of it is on screen... */
export const STRIKE_SEEN_RATIO = 0.5
/** ...for at least this long. */
export const STRIKE_SEEN_DWELL_MS = 800

export interface StrikeBlockGate {
  /** Keys of blocks still missing their required event, in content order. */
  missing: string[]
  /** The block the learner must finish next; null once every block is done. */
  firstOpen: StrikeBlock | null
  /** Index of `firstOpen` in the content; -1 once every block is done. */
  firstOpenIndex: number
}

export function strikeBlockGate(content: StrikeContent, reached: readonly StrikeBlockEventRecord[]): StrikeBlockGate {
  const missing = missingRequiredBlocks(content, [...reached])
  const missingSet = new Set(missing)
  const firstOpenIndex = content.blocks.findIndex(block => missingSet.has(block.key))
  return {
    missing,
    firstOpen: firstOpenIndex === -1 ? null : content.blocks[firstOpenIndex],
    firstOpenIndex,
  }
}

/** A locked block shows what is ahead but cannot be played or earn credit. */
export function isStrikeBlockLocked(gate: StrikeBlockGate, index: number): boolean {
  return gate.firstOpenIndex !== -1 && index > gate.firstOpenIndex
}
