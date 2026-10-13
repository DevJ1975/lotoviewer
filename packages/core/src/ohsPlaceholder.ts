// Reserved seam for the ISO 45001 (OH&S) domain. The EMS phases build the
// shared management-system core (managementSystem.ts) so OH&S can be added
// later without a rewrite. Until Phase 8 fills this module in, a shared
// rule's `ohs` branch throws NotImplementedError instead of silently
// applying environmental logic. See docs/ohs/README.md.

export type { Discipline } from './managementSystem'

/** Thrown by an `ohs` branch of a shared management-system rule that is not built yet. */
export class NotImplementedError extends Error {
  /** @param capability What was asked for, e.g. 'MOC fan-out for discipline ohs'. */
  constructor(capability: string) {
    super(`${capability} is not implemented yet`)
    this.name = 'NotImplementedError'
  }
}
