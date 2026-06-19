import { describe, expect, it } from 'vitest'
import { GHS_PICTOGRAMS } from '@soteria/core/chemicals'
import {
  GHS_PICTOGRAM_DETAIL,
  DOT_HAZARD_CLASSES,
  DOT_HAZARD_CLASS_META,
  DOT_PACKING_GROUPS,
  NFPA_CATEGORIES,
  NFPA_RATING_CATEGORIES,
  NFPA_RATING_MEANINGS,
  NFPA_SPECIAL_SYMBOLS,
  NFPA_SPECIAL_SYMBOL_MEANING,
  NFPA_QUADRANT_HEX,
  isValidDotHazardClass,
  isValidNfpaRating,
  isValidNfpaSpecialSymbol,
} from '@soteria/core/hazardSymbols'

// Guards the code-vs-seed contract: these cardinalities and shapes must
// match the seeded reference catalogs (migrations 232-234). A mismatch
// means the database and the renderers have drifted.

describe('GHS pictogram catalog (migration 232)', () => {
  it('has detail for all nine canonical pictograms', () => {
    expect(GHS_PICTOGRAMS.length).toBe(9)
    expect(Object.keys(GHS_PICTOGRAM_DETAIL).length).toBe(9)
    for (const code of GHS_PICTOGRAMS) {
      expect(GHS_PICTOGRAM_DETAIL[code], `detail for ${code}`).toBeDefined()
    }
  })

  it('points every pictogram at its canonical /ghs/<code>.svg artwork', () => {
    for (const code of GHS_PICTOGRAMS) {
      expect(GHS_PICTOGRAM_DETAIL[code].imagePath).toBe(`/ghs/${code}.svg`)
    }
  })

  it('gives every pictogram a non-empty symbol description and a valid signal word', () => {
    for (const code of GHS_PICTOGRAMS) {
      const detail = GHS_PICTOGRAM_DETAIL[code]
      expect(detail.symbolDescription.length).toBeGreaterThan(0)
      expect(detail.hazardClassSummary.length).toBeGreaterThan(0)
      expect(['danger', 'warning']).toContain(detail.defaultSignalWord)
    }
  })
})

describe('DOT hazard-class catalog (migration 233)', () => {
  it('catalogs the 20 canonical classes/divisions', () => {
    expect(DOT_HAZARD_CLASSES.length).toBe(20)
    expect(Object.keys(DOT_HAZARD_CLASS_META).length).toBe(20)
  })

  it('has metadata for every class id with a unique artwork path', () => {
    const paths = new Set<string>()
    for (const id of DOT_HAZARD_CLASSES) {
      const meta = DOT_HAZARD_CLASS_META[id]
      expect(meta, `meta for ${id}`).toBeDefined()
      expect(meta.imagePath).toBe(`/dot/${id}.svg`)
      expect(meta.labelName.length).toBeGreaterThan(0)
      expect(meta.symbolLegend.length).toBeGreaterThan(0)
      expect(meta.placardColor, `color for ${id}`).toMatch(/^#[0-9A-Fa-f]{6}$/)
      expect(meta.classNumber).toBeGreaterThanOrEqual(1)
      expect(meta.classNumber).toBeLessThanOrEqual(9)
      paths.add(meta.imagePath)
    }
    expect(paths.size).toBe(20)
  })

  it('keeps the class number consistent with the id', () => {
    for (const id of DOT_HAZARD_CLASSES) {
      const expected = Number(id.split('.')[0])
      expect(DOT_HAZARD_CLASS_META[id].classNumber).toBe(expected)
    }
  })

  it('exposes the three UN packing groups', () => {
    expect(DOT_PACKING_GROUPS).toEqual(['I', 'II', 'III'])
  })
})

describe('NFPA 704 legend (migration 234)', () => {
  it('covers four quadrants with exact render hexes', () => {
    expect(NFPA_CATEGORIES).toEqual(['health', 'flammability', 'instability', 'special'])
    for (const category of NFPA_CATEGORIES) {
      expect(NFPA_QUADRANT_HEX[category]).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
  })

  it('has 18 legend entries (3 quadrants x 5 ratings + 3 special symbols)', () => {
    const ratingRows = NFPA_RATING_CATEGORIES.length * 5
    const specialRows = NFPA_SPECIAL_SYMBOLS.length
    expect(ratingRows + specialRows).toBe(18)
  })

  it('defines all 0-4 ratings for each numeric quadrant', () => {
    for (const category of NFPA_RATING_CATEGORIES) {
      for (const rating of [0, 1, 2, 3, 4] as const) {
        expect(NFPA_RATING_MEANINGS[category][rating].length).toBeGreaterThan(0)
      }
    }
  })

  it('defines the three white-quadrant special symbols', () => {
    expect(NFPA_SPECIAL_SYMBOLS).toEqual(['W', 'OX', 'SA'])
    for (const symbol of NFPA_SPECIAL_SYMBOLS) {
      expect(NFPA_SPECIAL_SYMBOL_MEANING[symbol].length).toBeGreaterThan(0)
    }
  })
})

describe('hazard-symbol validators', () => {
  it('accepts catalogued DOT classes and rejects others', () => {
    expect(isValidDotHazardClass('3')).toBe(true)
    expect(isValidDotHazardClass('5.1')).toBe(true)
    expect(isValidDotHazardClass('1.7')).toBe(false)
    expect(isValidDotHazardClass('10')).toBe(false)
    expect(isValidDotHazardClass('')).toBe(false)
  })

  it('accepts integer NFPA ratings 0-4 only', () => {
    expect(isValidNfpaRating(0)).toBe(true)
    expect(isValidNfpaRating(4)).toBe(true)
    expect(isValidNfpaRating(5)).toBe(false)
    expect(isValidNfpaRating(-1)).toBe(false)
    expect(isValidNfpaRating(2.5)).toBe(false)
  })

  it('accepts the three NFPA special symbols only', () => {
    expect(isValidNfpaSpecialSymbol('W')).toBe(true)
    expect(isValidNfpaSpecialSymbol('OX')).toBe(true)
    expect(isValidNfpaSpecialSymbol('SA')).toBe(true)
    expect(isValidNfpaSpecialSymbol('XX')).toBe(false)
  })
})
