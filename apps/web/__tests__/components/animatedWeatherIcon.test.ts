import { describe, it, expect } from 'vitest'
import { weatherKind, type WeatherKind } from '@/app/_components/AnimatedWeatherIcon'
import { weatherLabelForCode } from '@/app/_components/WeatherCard'

// The glyph and the label are chosen by two separate functions — the glyph is
// coarser (drizzle/rain/showers all draw as falling drops). They are allowed
// to differ in precision but must never contradict each other: a code that
// says "Snow" must not draw a sun.

describe('weatherKind', () => {
  it('maps the WMO codes the API actually returns', () => {
    expect(weatherKind(0)).toBe('clear')
    expect(weatherKind(2)).toBe('cloud')
    expect(weatherKind(45)).toBe('fog')
    expect(weatherKind(48)).toBe('fog')
    expect(weatherKind(55)).toBe('rain')    // drizzle
    expect(weatherKind(63)).toBe('rain')
    expect(weatherKind(73)).toBe('snow')
    expect(weatherKind(81)).toBe('rain')    // showers
    expect(weatherKind(86)).toBe('snow')    // snow showers
    expect(weatherKind(95)).toBe('storm')
    expect(weatherKind(99)).toBe('storm')
  })

  it('falls back to a cloud for unassigned codes inside the range', () => {
    expect(weatherKind(7)).toBe('cloud')    // gap between 3 and 45
    expect(weatherKind(59)).toBe('cloud')   // gap between drizzle and rain
    expect(weatherKind(-1)).toBe('cloud')
  })

  // Both weatherKind and weatherLabelForCode use an open-ended `>= 95`, so a
  // nonsense high value reads as a storm in the glyph AND the label. That is
  // unreachable — Open-Meteo emits 0-99 — and the two agreeing matters more
  // than either being "right" about input that cannot occur.
  it('stays self-consistent above the documented range', () => {
    expect(weatherKind(1000)).toBe('storm')
    expect(weatherLabelForCode(1000)).toBe('Thunderstorm')
  })
})

describe('glyph and label agree', () => {
  // Which glyphs are defensible for a label. Drizzle drawn as rain is fine;
  // snow drawn as clear is not.
  const ALLOWED: Record<string, WeatherKind[]> = {
    'Clear':         ['clear'],
    'Partly cloudy': ['cloud'],
    'Cloudy':        ['cloud'],
    'Fog':           ['fog'],
    'Drizzle':       ['rain'],
    'Rain':          ['rain'],
    'Showers':       ['rain'],
    'Snow':          ['snow'],
    'Snow showers':  ['snow'],
    'Thunderstorm':  ['storm'],
  }

  it('never contradicts itself across the whole 0-99 code range', () => {
    const mismatches: string[] = []
    for (let code = 0; code <= 99; code++) {
      const label = weatherLabelForCode(code)
      const kind  = weatherKind(code)
      const ok    = ALLOWED[label]
      if (!ok) { mismatches.push(`code ${code}: unknown label ${label}`); continue }
      if (!ok.includes(kind)) mismatches.push(`code ${code}: label "${label}" drew "${kind}"`)
    }
    expect(mismatches).toEqual([])
  })

  it('covers every label the card can render', () => {
    const produced = new Set(
      Array.from({ length: 100 }, (_, c) => weatherLabelForCode(c)),
    )
    for (const label of produced) expect(ALLOWED).toHaveProperty(label)
  })
})
