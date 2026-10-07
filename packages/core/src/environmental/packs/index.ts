// The registered jurisdiction packs, and the one function the app calls to get a
// site's library.
//
// Adding a state: write packs/<state>.ts, register it here, and add the state to
// SUPPORTED_STATES in ../jurisdiction.ts. Nothing else changes.

import type { JurisdictionPack, ResolvedLibrary } from '../content'
import { resolveJurisdiction, type JurisdictionCode, type JurisdictionResolution } from '../jurisdiction'
import { resolveLibrary } from '../resolve'
import { caPack } from './ca'
import { federalPack } from './federal'
import { txPack } from './tx'

export const PACKS: Readonly<Record<JurisdictionCode, JurisdictionPack>> = {
  federal: federalPack,
  CA:      caPack,
  TX:      txPack,
}

export interface SiteLibrary {
  jurisdiction: JurisdictionResolution
  library:      ResolvedLibrary
}

/** The library for a site in `state` (null/unknown/unsupported = federal baseline only). */
export function libraryForState(state: string | null | undefined): SiteLibrary {
  const jurisdiction = resolveJurisdiction(state)
  return { jurisdiction, library: resolveLibrary(jurisdiction.chain, PACKS) }
}

export { caPack, federalPack, txPack }
