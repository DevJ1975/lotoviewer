// Which regulatory layers apply to a site, from the state it is in.
//
// Environmental duties stack: federal baseline first, then the state's own
// program on top. A state with no content pack yet resolves to federal ONLY and
// says so (`status: 'unsupported'`), because the federal stormwater baseline (the
// EPA MSGP) legally applies only where EPA is the permitting authority: showing
// it for another state without saying so would present a reference as that
// state's rule. The UI must render a banner for anything but 'supported'.

export const US_STATES: Readonly<Record<string, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida',
  GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine',
  MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island',
  SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin',
  WY: 'Wyoming',
}

/** States that have a content pack. Adding a state = one pack file and one entry here. */
export const SUPPORTED_STATES = ['CA', 'TX'] as const
export type SupportedState = typeof SUPPORTED_STATES[number]

export type JurisdictionCode = 'federal' | SupportedState

const NAME_TO_CODE: ReadonlyMap<string, string> = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code]),
)

/**
 * A USPS code from what a person or a form might have typed: "ca", " CA ",
 * "California". Null when it is not a US state, territory-free by design (the
 * packs and the OSHA reporting windows are keyed by state).
 */
export function normalizeStateCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null
  const upper = trimmed.toUpperCase()
  if (upper in US_STATES) return upper
  return NAME_TO_CODE.get(trimmed.toLowerCase()) ?? null
}

export function stateName(code: string | null | undefined): string | null {
  const normalized = normalizeStateCode(code)
  return normalized ? US_STATES[normalized]! : null
}

export function isSupportedState(code: string | null | undefined): code is SupportedState {
  const normalized = normalizeStateCode(code)
  return normalized !== null && (SUPPORTED_STATES as readonly string[]).includes(normalized)
}

export type JurisdictionStatus = 'supported' | 'unsupported' | 'unset'

export interface JurisdictionResolution {
  /** Layers in application order: federal first, the state (if any) after. */
  chain: JurisdictionCode[]
  /** The normalized USPS code, or null when none is set. */
  state: string | null
  /**
   * supported   - a state pack is layered on the federal baseline.
   * unsupported - the state is known but has no pack: federal baseline only.
   * unset       - the site has no state: federal baseline only.
   */
  status: JurisdictionStatus
}

export function resolveJurisdiction(state: string | null | undefined): JurisdictionResolution {
  const normalized = normalizeStateCode(state)
  if (normalized === null) return { chain: ['federal'], state: null, status: 'unset' }
  if (isSupportedState(normalized)) return { chain: ['federal', normalized], state: normalized, status: 'supported' }
  return { chain: ['federal'], state: normalized, status: 'unsupported' }
}

/** The sentence the UI shows under a banner when the chain is federal-only. */
export function fallbackNotice(resolution: JurisdictionResolution): string | null {
  switch (resolution.status) {
    case 'supported':
      return null
    case 'unset':
      return 'No state is set for this site, so only the federal baseline is shown. Choose the state to add its requirements.'
    case 'unsupported': {
      const name = stateName(resolution.state) ?? resolution.state
      return `${name} has its own environmental programs, which are not in the library yet. This is the federal baseline only: it is a reference, not ${name}'s rule. Confirm everything against your state permits and agency.`
    }
  }
}
