// Inline cross-reference parser. Used by the thread/reply renderer
// to autolink `#EQ-1234`, `#INC-456`, `#ACT-789` etc. to the
// corresponding entity page. Same posture as the @-mention inline
// rendering — purely client-side cosmetic; the canonical link is
// the linked_entity_type/id pair on the thread row.
//
// Pattern: `#PREFIX-NUMBER` where PREFIX is 2-5 letters and NUMBER
// is 1-12 alphanumerics (some incident report numbers include
// dashes; we restrict the suffix to alphanumerics to keep parsing
// unambiguous — `#INC-2026-0042` would need to be written
// `#INC-20260042` or use the entity-link picker instead).
//
// This file exports BOTH the regex and a renderer so callers can
// choose: a fully-styled inline parser (rendered on threads) or
// just the regex for stripping tags (search-snippet building, etc.).

export interface CrossRefMatch {
  prefix: string  // uppercased, e.g. 'INC'
  id:     string  // raw, e.g. '0042' or 'ABC123'
  start:  number
  end:    number  // exclusive
}

// Case-insensitive on the prefix; we uppercase it post-match so the
// route-table lookup is canonical regardless of how the user typed it.
export const CROSS_REF_RE = /#([A-Za-z]{2,5})-([A-Za-z0-9]{1,12})/g

export function findCrossRefs(input: string): CrossRefMatch[] {
  const out: CrossRefMatch[] = []
  let m: RegExpExecArray | null
  // Use a fresh regex per call so the global lastIndex doesn't
  // leak across calls.
  const re = new RegExp(CROSS_REF_RE.source, 'g')
  while ((m = re.exec(input)) !== null) {
    out.push({
      prefix: m[1].toUpperCase(),
      id:     m[2],
      start:  m.index,
      end:    m.index + m[0].length,
    })
  }
  return out
}

// Map prefix → entity URL builder. Unknown prefixes return null and
// the renderer leaves them as plain text so a misspelled tag never
// 404s.
export function hrefForCrossRef(match: CrossRefMatch): string | null {
  switch (match.prefix) {
    case 'INC':  return `/incidents/${match.id}`           // by id (or report_number; route handles both)
    case 'EQ':
    case 'EQUIP':return `/equipment/${match.id}`
    case 'NM':
    case 'NEAR': return `/near-miss/${match.id}`
    case 'HW':   return `/hot-work/${match.id}`
    case 'CS':   return `/confined-spaces/${match.id}`
    case 'JHA':  return `/jha/${match.id}`
    case 'ACT':
    case 'CAPA': return null  // actions are inline on incident; no detail page
    case 'TBT':  return `/toolbox-talks/${match.id}`
    default:     return null
  }
}
