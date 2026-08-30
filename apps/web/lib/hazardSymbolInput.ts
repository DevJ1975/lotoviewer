import {
  GHS_PICTOGRAMS,
  GHS_SIGNAL_WORDS,
  type GhsPictogram,
  type GhsSignalWord,
} from '@soteria/core/chemicals'
import { DOT_PACKING_GROUPS, type DotPackingGroup } from '@soteria/core/hazardSymbols'

// Boundary parsing for the hazard-communication symbol fields that the
// hazardous-waste stream routes accept from untrusted JSON. Coerces raw
// values into the typed shape `HazardousWasteStreamInput` expects; the
// core validator (validateHazardSymbolFields) then rejects out-of-catalog
// codes. Kept separate from the route so the create (POST) and update
// (PATCH) handlers share one source of truth for the coercion rules.

export interface HazardSymbolFields {
  ghs_pictograms:           GhsPictogram[]
  ghs_signal_word:          GhsSignalWord | null
  nfpa_health:              number | null
  nfpa_flammability:        number | null
  nfpa_instability:         number | null
  nfpa_special:             string | null
  dot_un_number:            string | null
  dot_hazard_class:         string | null
  dot_packing_group:        DotPackingGroup | null
  dot_proper_shipping_name: string | null
}

function trimToNull(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

// NFPA ratings arrive as numbers or numeric strings; anything else (or a
// blank "none" selection) becomes null. Non-integer / out-of-range values
// pass through as-is so the validator can report them rather than silently
// clamping a data-entry mistake.
function toNfpaRating(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

// Keep only catalogued GHS codes; drop blanks and duplicates. Unknown codes
// are filtered here (not surfaced as errors) because the multi-select UI can
// only emit catalog codes — a stray value is noise, not user intent.
function toGhsPictograms(value: unknown): GhsPictogram[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<GhsPictogram>()
  for (const item of value) {
    if (typeof item === 'string' && (GHS_PICTOGRAMS as readonly string[]).includes(item)) {
      seen.add(item as GhsPictogram)
    }
  }
  return Array.from(seen)
}

function toSignalWord(value: unknown): GhsSignalWord | null {
  return typeof value === 'string' && (GHS_SIGNAL_WORDS as readonly string[]).includes(value)
    ? (value as GhsSignalWord)
    : null
}

function toPackingGroup(value: unknown): DotPackingGroup | null {
  return typeof value === 'string' && (DOT_PACKING_GROUPS as readonly string[]).includes(value)
    ? (value as DotPackingGroup)
    : null
}

/**
 * Parse the symbol fields out of a request body. Reads only keys that are
 * present; callers that want partial-update semantics check `key in body`
 * before merging. Returns a fully-formed `HazardSymbolFields` with sane
 * defaults so a create handler can spread it directly.
 */
export function parseHazardSymbolFields(body: Record<string, unknown>): HazardSymbolFields {
  return {
    ghs_pictograms:           toGhsPictograms(body.ghs_pictograms),
    ghs_signal_word:          toSignalWord(body.ghs_signal_word),
    nfpa_health:              toNfpaRating(body.nfpa_health),
    nfpa_flammability:        toNfpaRating(body.nfpa_flammability),
    nfpa_instability:         toNfpaRating(body.nfpa_instability),
    nfpa_special:             trimToNull(body.nfpa_special, 8),
    dot_un_number:            trimToNull(body.dot_un_number, 16),
    dot_hazard_class:         trimToNull(body.dot_hazard_class, 8),
    dot_packing_group:        toPackingGroup(body.dot_packing_group),
    dot_proper_shipping_name: trimToNull(body.dot_proper_shipping_name, 300),
  }
}
