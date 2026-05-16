// Rendered text for the physical Proposition 65 warning sign.
//
// The 2018 regulatory package (Cal. Code Regs tit. 27 §§25602–25607)
// prescribes the exact wording for "safe harbor" warnings. Using
// non-safe-harbor wording forfeits the rebuttable presumption — so
// this module is the canonical text. Do not improvise.
//
// Two formats:
//   - long_form  (§25603): the warning symbol "⚠ WARNING:", at least
//                 one chemical name per endpoint clause, and the
//                 P65Warnings.ca.gov reference URL.
//   - short_form (§25603(b)): abbreviated; allowed on small consumer
//                 products. Skips the chemical-name list.
//
// English + Spanish. Other languages aren't safe-harbor; tenants who
// post additional languages must layer their own translation on top
// of the English safe-harbor sign.

import type { Prop65HarmEndpoint } from './prop65'

export interface WarningChemical {
  /** The chemical name as rendered on the sign. Pass the human-
   *  readable name verbatim — including any parentheses or symbols.
   *  E.g. "Di(2-ethylhexyl)phthalate (DEHP)". */
  name:     string
  /** Determines which endpoint clause(s) cite this chemical. */
  endpoint: Prop65HarmEndpoint
}

export type WarningLanguage = 'en' | 'es'

export interface WarningInput {
  chemicals: readonly WarningChemical[]
  language:  WarningLanguage
}

const REFERENCE_URL = 'www.P65Warnings.ca.gov'

const TEMPLATES = {
  en: {
    prefix:   'WARNING:',
    cancer:   'This area can expose you to chemicals including {{names}}, which is known to the State of California to cause cancer.',
    repro:    'This area can expose you to chemicals including {{names}}, which is known to the State of California to cause birth defects or other reproductive harm.',
    both:     'This area can expose you to chemicals including {{names}}, which is known to the State of California to cause cancer and birth defects or other reproductive harm.',
    moreInfo: 'For more information go to',
    short: {
      cancer: 'Cancer Risk',
      repro:  'Reproductive Harm',
      both:   'Cancer and Reproductive Harm',
    },
    shortMoreInfo: 'For more information go to',
  },
  es: {
    prefix:   'ADVERTENCIA:',
    cancer:   'Esta área puede exponerle a sustancias químicas, incluyendo {{names}}, que en el Estado de California se considera que causa cáncer.',
    repro:    'Esta área puede exponerle a sustancias químicas, incluyendo {{names}}, que en el Estado de California se considera que causa defectos de nacimiento u otros daños reproductivos.',
    both:     'Esta área puede exponerle a sustancias químicas, incluyendo {{names}}, que en el Estado de California se considera que causa cáncer y defectos de nacimiento u otros daños reproductivos.',
    moreInfo: 'Para obtener más información, vaya a',
    short: {
      cancer: 'Riesgo de cáncer',
      repro:  'Daño reproductivo',
      both:   'Cáncer y daño reproductivo',
    },
    shortMoreInfo: 'Para obtener más información, vaya a',
  },
} as const

/**
 * Group chemicals into the three endpoint buckets. A 'both'-endpoint
 * chemical lands in the 'both' bucket only; it is NOT duplicated into
 * cancer + repro. This matches §25603's worked examples — a single
 * "cancer and birth defects" clause is preferred over two separate
 * clauses for the same chemical.
 */
function bucketize(chemicals: readonly WarningChemical[]) {
  const cancer: string[] = []
  const repro:  string[] = []
  const both:   string[] = []
  for (const c of chemicals) {
    const name = (c.name ?? '').trim()
    if (!name) continue
    if (c.endpoint === 'cancer')       cancer.push(name)
    else if (c.endpoint === 'reproductive') repro.push(name)
    else                                both.push(name)
  }
  return { cancer, repro, both }
}

function joinNames(names: readonly string[]): string {
  return names.join(', ')
}

function renderClause(template: string, names: readonly string[]): string {
  return template.replace('{{names}}', joinNames(names))
}

/**
 * Long-form Prop 65 sign text per §25603. Includes the warning
 * symbol, one clause per active endpoint bucket, and the reference
 * URL. Multiple endpoint buckets join with a blank line between
 * clauses so the rendered placard wraps cleanly.
 *
 * Throws on empty input — a sign with no chemicals is not a safe-
 * harbor warning, it's a typo.
 */
export function buildLongFormWarning(input: WarningInput): string {
  if (!input.chemicals || input.chemicals.length === 0) {
    throw new Error('buildLongFormWarning: at least one chemical required')
  }
  const t = TEMPLATES[input.language]
  const { cancer, repro, both } = bucketize(input.chemicals)

  const clauses: string[] = []
  if (cancer.length > 0) clauses.push(renderClause(t.cancer, cancer))
  if (repro.length  > 0) clauses.push(renderClause(t.repro,  repro))
  if (both.length   > 0) clauses.push(renderClause(t.both,   both))

  // Belt-and-suspenders — bucketize already filtered blanks.
  if (clauses.length === 0) {
    throw new Error('buildLongFormWarning: no usable chemical names supplied')
  }

  return [
    `⚠ ${t.prefix}`,
    ...clauses,
    `${t.moreInfo} ${REFERENCE_URL}.`,
  ].join('\n\n')
}

/**
 * Short-form sign per §25603(b). Drops the chemical-name list and
 * the long endpoint clause. Allowed on physical products ≤ 5 in² of
 * label space; some EHS shops also use it for compact area signs.
 *
 * Endpoint heading reflects the union of every supplied chemical's
 * endpoint — if any chemical is 'both', the heading reads 'both'.
 */
export function buildShortFormWarning(input: WarningInput): string {
  if (!input.chemicals || input.chemicals.length === 0) {
    throw new Error('buildShortFormWarning: at least one chemical required')
  }
  const t = TEMPLATES[input.language]

  let hasCancer = false
  let hasRepro  = false
  for (const c of input.chemicals) {
    if (c.endpoint === 'cancer')        hasCancer = true
    else if (c.endpoint === 'reproductive') hasRepro  = true
    else { hasCancer = true; hasRepro = true }
  }

  const heading =
    hasCancer && hasRepro ? t.short.both
    : hasCancer            ? t.short.cancer
    : hasRepro             ? t.short.repro
    : t.short.cancer

  return [
    `⚠ ${t.prefix} ${heading}`,
    `${t.shortMoreInfo} ${REFERENCE_URL}.`,
  ].join('\n')
}
