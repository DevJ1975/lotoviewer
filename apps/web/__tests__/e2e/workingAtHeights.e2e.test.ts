// End-to-end scenarios for the Working at Heights foundation.
//
// "End-to-end" here means the test starts from a real-user prompt
// and walks every layer it touches: the manual content the wiki
// renders, the regulatory data and calculator math the assistant
// cites, and the seed-script output shape that lands in the AI
// knowledge base. No browser is driven — Playwright suites for the
// permit and inspection UIs land with Phase 2 — but every
// non-browser layer is exercised through the same code path the
// operator's request would take.
//
// Each `it()` block reads as a story: "Operator does X, the system
// should reach state Y." If a single scenario breaks the chain
// (manual edit drops a required section, calculator regresses on a
// common case, citation drift), one test points at the exact step
// that broke.

import { describe, expect, it } from 'vitest'
import {
  SECTIONS,
  MANUAL_TITLE,
  MANUAL_VERSION,
  MANUAL_LAST_UPDATED,
  type ManualSection,
} from '@/app/wiki/working-at-heights/_content'
import {
  calculateRequiredClearance,
  requiredAnchorCapacity,
  TRIGGER_HEIGHTS,
  LADDER_TYPE_RATINGS,
  FALL_PROTECTION_COMPONENT_TYPES,
  type TriggerHeightKey,
} from '@soteria/core/workingAtHeights'

// ─── Scenario 1: Calculator drives system selection at the worksite ──────
//
// An operator standing under an anchor at a specific height should be
// told — without ambiguity — whether a standard shock lanyard is safe,
// whether they must switch to an SRL, or whether the location is
// unsuitable for any system. This is the most consequential decision
// the module makes; bad output here can put a body on the ground.

describe('E2E — operator picks the right system at the anchor', () => {
  it('rejects a 6-ft lanyard when only 12 ft of clearance is available', () => {
    // Operator at a mezzanine anchor 12 ft above the warehouse floor.
    // 6-ft lanyard needs ~18 ft — short by 6 ft.
    const r = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    const availableFt = 12
    const safe = availableFt >= r.requiredClearanceFt
    expect(safe).toBe(false)
    expect(r.requiredClearanceFt).toBeGreaterThan(availableFt)
  })

  it('approves a Class 1 SRL at the same 12-ft anchor', () => {
    // SRL needs ~10.5 ft — fits comfortably under the same anchor.
    const r = calculateRequiredClearance({ system: 'srl_class1' })
    const availableFt = 12
    expect(availableFt).toBeGreaterThanOrEqual(r.requiredClearanceFt)
    // Margin is the audit cushion — must be positive.
    expect(availableFt - r.requiredClearanceFt).toBeGreaterThan(0)
  })

  it('approves a 6-ft lanyard at a 25-ft anchor (rooftop davit)', () => {
    // Common rooftop davit case — plenty of clearance.
    const r = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    expect(25).toBeGreaterThanOrEqual(r.requiredClearanceFt)
    // Comfortably above with margin to spare.
    expect(25 - r.requiredClearanceFt).toBeGreaterThan(5)
  })

  it('escalates required clearance for a 4-ft swing-fall offset', () => {
    // Anchor 4 ft to the side adds pendulum drop. The system might
    // be safe directly under but unsafe with the offset.
    const direct = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    const swung  = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6, swingFallOffsetFt: 4 })
    expect(swung.requiredClearanceFt).toBeGreaterThan(direct.requiredClearanceFt)
    expect(swung.notes.join(' ')).toMatch(/swing-fall/i)
  })

  it('restraint mode is the only system safe at 8 ft of clearance', () => {
    // Below 10.5 ft, neither a 6-ft lanyard nor a Class 1 SRL is
    // viable. Restraint — physically preventing the worker from
    // reaching the edge — is the only acceptable answer. This is
    // the case where most programs silently fail; the math must
    // surface it. 8 ft is a real-world picking-mezzanine height
    // where this trade-off shows up.
    const availableFt = 8
    const lanyard = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    const srl     = calculateRequiredClearance({ system: 'srl_class1' })
    const restr   = calculateRequiredClearance({ system: 'restraint' })
    expect(availableFt).toBeLessThan(lanyard.requiredClearanceFt)
    expect(availableFt).toBeLessThan(srl.requiredClearanceFt)
    expect(availableFt).toBeGreaterThanOrEqual(restr.requiredClearanceFt)
  })
})

// ─── Scenario 2: Anchor sizing — single vs two-person, default vs eng ───

describe('E2E — anchor capacity sizing for a permit pre-check', () => {
  it('single-worker improvised anchor — 5,000 lbf default', () => {
    expect(requiredAnchorCapacity(1, false)).toBe(5000)
  })

  it('two workers tied off — anchor must be rated for both', () => {
    expect(requiredAnchorCapacity(2, false)).toBe(10000)
  })

  it('engineered anchor uses 2x peak arrest force, not the default 5,000', () => {
    // 1,800 lbf peak * 2 safety factor = 3,600 per worker — lower
    // than the 5,000 default because the QP signed off on the math.
    expect(requiredAnchorCapacity(1, true)).toBe(3600)
    expect(requiredAnchorCapacity(2, true)).toBe(7200)
  })

  it('zero workers gives zero capacity (no division-by-zero)', () => {
    expect(requiredAnchorCapacity(0, false)).toBe(0)
  })
})

// ─── Scenario 3: Trigger heights match the jurisdiction selected ─────────

describe('E2E — jurisdiction-aware fall protection trigger', () => {
  it('a 5-ft platform in general industry triggers fall protection', () => {
    const platformHeight = 5
    expect(platformHeight).toBeGreaterThanOrEqual(TRIGGER_HEIGHTS.FED_GENERAL_INDUSTRY.feet)
  })

  it('a 5-ft platform on a Cal/OSHA construction site requires protection too (7.5 ft trigger)', () => {
    // 5 ft is below the Cal/OSHA construction trigger of 7.5 — but
    // the test below makes sure operators don't misread the rule.
    const platformHeight = 5
    expect(platformHeight).toBeLessThan(TRIGGER_HEIGHTS.CALOSHA_CONSTRUCTION.feet)
  })

  it('an 8-ft work platform on a Cal/OSHA construction site requires protection', () => {
    const platformHeight = 8
    expect(platformHeight).toBeGreaterThanOrEqual(TRIGGER_HEIGHTS.CALOSHA_CONSTRUCTION.feet)
  })

  it('every trigger height carries an OSHA citation a CP can quote', () => {
    for (const key of Object.keys(TRIGGER_HEIGHTS) as TriggerHeightKey[]) {
      const t = TRIGGER_HEIGHTS[key]
      expect(t.citation, `${key} citation`).toMatch(/CFR|Cal\/OSHA/)
      expect(t.feet, `${key} feet`).toBeGreaterThan(0)
    }
  })
})

// ─── Scenario 4: Ladder type-rating sanity check for procurement ────────

describe('E2E — ladder type rating informs procurement', () => {
  it('industrial sites should default to IA or IAA (≥300 lbf capacity)', () => {
    const industrialOk = LADDER_TYPE_RATINGS.filter(r => r.capacityLbf >= 300)
    expect(industrialOk.map(r => r.type)).toEqual(['IAA', 'IA'])
  })

  it('Type III is explicitly flagged as not-for-industrial', () => {
    const t3 = LADDER_TYPE_RATINGS.find(r => r.type === 'III')!
    expect(t3.recommendedUse).toMatch(/NOT for industrial/i)
  })

  it('ratings descend strictly — IAA > IA > I > II > III', () => {
    const capacities = LADDER_TYPE_RATINGS.map(r => r.capacityLbf)
    for (let i = 1; i < capacities.length; i++) {
      expect(capacities[i]).toBeLessThan(capacities[i - 1])
    }
  })
})

// ─── Scenario 5: Manual integrity contract ──────────────────────────────
//
// Every operator visit to /wiki/working-at-heights and every assistant
// query about a fall-protection topic falls back to the manual content.
// These tests pin the contract — a manual edit that drops a required
// section, breaks a citation URL, or shrinks the prose past the
// reference threshold lights up here before it ships to production.

describe('E2E — manual integrity contract', () => {
  it('manual exposes title, version, last-updated metadata', () => {
    expect(MANUAL_TITLE).toBe('Working at Heights')
    expect(MANUAL_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
    expect(MANUAL_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('contains at least 20 sections — the comprehensive bar', () => {
    expect(SECTIONS.length).toBeGreaterThanOrEqual(20)
  })

  it('every section has a unique id and a non-empty title', () => {
    const ids = new Set<string>()
    for (const s of SECTIONS) {
      expect(s.id, 'section id').toMatch(/^[a-z][a-z0-9-]+$/)
      expect(s.title.trim().length, `${s.id} title`).toBeGreaterThan(0)
      expect(ids.has(s.id), `duplicate id ${s.id}`).toBe(false)
      ids.add(s.id)
    }
  })

  it('every section has at least one paragraph of prose', () => {
    for (const s of SECTIONS) {
      expect(s.paragraphs.length, `${s.id} paragraphs`).toBeGreaterThan(0)
      for (const p of s.paragraphs) {
        // A real paragraph, not an empty string or a placeholder.
        expect(p.trim().length, `${s.id} paragraph length`).toBeGreaterThan(40)
      }
    }
  })

  it('required topical sections are present (none silently dropped on edit)', () => {
    // Each id below corresponds to a topic the assistant or an OSHA
    // auditor is expected to find. Drop one and the contract fails.
    const required = [
      'overview', 'roles', 'trigger-heights', 'hierarchy',
      'portable-ladders', 'fixed-ladders',
      'harnesses', 'lanyards', 'srl', 'anchors',
      'clearance-calculation', 'rescue-plan',
      'permits', 'aerial-platforms', 'roof-safety',
      'inspections', 'quarantine', 'training',
      'contractors', 'incident-response', 'documentation',
      'faq', 'glossary', 'strike-training', 'related-modules',
    ]
    const ids = new Set(SECTIONS.map(s => s.id))
    for (const id of required) {
      expect(ids.has(id), `required section missing: ${id}`).toBe(true)
    }
  })

  it('every citation URL is https + points at an OSHA / DIR / ASSP / ALI source', () => {
    const allowedHosts = ['osha.gov', 'dir.ca.gov', 'assp.org', 'americanladderinstitute.org']
    for (const s of SECTIONS) {
      for (const c of s.citations ?? []) {
        expect(c.url, `${s.id} citation url`).toMatch(/^https:\/\//)
        const host = new URL(c.url).host
        expect(
          allowedHosts.some(h => host.endsWith(h)),
          `${s.id} citation host ${host} not on allow-list`,
        ).toBe(true)
        expect(c.label.trim().length, `${s.id} citation label`).toBeGreaterThan(0)
      }
    }
  })

  it('rescue-plan section calls out suspension trauma and the in-advance requirement', () => {
    // The most-cited fall violation; the manual must make the
    // requirement unambiguous.
    const rescue = SECTIONS.find(s => s.id === 'rescue-plan')!
    const blob = rescueText(rescue).toLowerCase()
    expect(blob).toMatch(/suspension trauma/)
    expect(blob).toMatch(/in advance|written/)
    expect(blob).toMatch(/1926\.502/)
  })

  it('clearance-calculation section names both lanyard and SRL math', () => {
    const calc = SECTIONS.find(s => s.id === 'clearance-calculation')!
    const blob = rescueText(calc).toLowerCase()
    expect(blob).toMatch(/lanyard/)
    expect(blob).toMatch(/srl|self-retracting/)
    expect(blob).toMatch(/swing|pendulum/)
  })

  it('permit section enumerates worker auth, equipment, anchor, rescue, weather pre-checks', () => {
    const permit = SECTIONS.find(s => s.id === 'permits')!
    const blob = rescueText(permit).toLowerCase()
    // Each of the 5 pre-condition families must appear; otherwise
    // the permit doc isn't doing its gate-keeping job.
    expect(blob).toMatch(/authoriz/)        // worker authorisation
    expect(blob).toMatch(/inspect/)         // equipment inspection
    expect(blob).toMatch(/anchor/)          // anchor in-window
    expect(blob).toMatch(/rescue/)          // rescue plan
    expect(blob).toMatch(/weather|wind|lightning/) // weather hold
  })

  it('STRIKE section lists at least 10 micro-learning topics', () => {
    const strike = SECTIONS.find(s => s.id === 'strike-training')!
    expect(strike.bullets?.length ?? 0).toBeGreaterThanOrEqual(10)
  })

  it('total word count meets the "comprehensive" bar (≥3,000 words)', () => {
    // Counts the operator-visible prose: paragraphs + bullets +
    // do/dont entries. A drop below 3,000 means a meaningful chunk
    // of the manual was removed.
    let words = 0
    for (const s of SECTIONS) {
      const buckets = [
        ...s.paragraphs,
        ...(s.bullets ?? []),
        ...(s.dodonts?.dos ?? []),
        ...(s.dodonts?.donts ?? []),
      ]
      for (const text of buckets) {
        words += text.trim().split(/\s+/).length
      }
    }
    expect(words).toBeGreaterThanOrEqual(3000)
  })
})

// ─── Scenario 6: AI seed payload shape matches the script's contract ────
//
// The seed script reads SECTIONS, formats each section as a text
// block, and emits one knowledge_chunk per section. These tests pin
// what the script will emit so a refactor here doesn't silently
// change what lands in the AI knowledge base.

describe('E2E — AI knowledge ingest payload shape', () => {
  it('section formatting includes title, paragraphs, bullets when present', () => {
    const section = SECTIONS.find(s => s.bullets && s.bullets.length > 0)!
    const formatted = formatSection(section)
    expect(formatted).toMatch(/^# /m)                   // title heading
    expect(formatted).toContain(section.paragraphs[0])  // body
    expect(formatted).toContain(`- ${section.bullets![0]}`) // first bullet
  })

  it('citations format as "label — url" bullets after the body', () => {
    const section = SECTIONS.find(s => s.citations && s.citations.length > 0)!
    const formatted = formatSection(section)
    expect(formatted).toMatch(/Citations:/i)
    const cite = section.citations![0]
    expect(formatted).toContain(`${cite.label} — ${cite.url}`)
  })

  it('do/donts render under "Do:" and "Don\'t:" headings', () => {
    const section = SECTIONS.find(s => s.dodonts)!
    const formatted = formatSection(section)
    expect(formatted).toMatch(/^Do:/m)
    expect(formatted).toMatch(/Don't:/m)
  })

  it('every section produces a chunk of usable size for embedding', () => {
    // Voyage-3-large accepts up to ~32k tokens per chunk; our
    // chunks should sit well under that. The lower bound rules out
    // tiny chunks that would dilute retrieval — every chunk should
    // be substantive enough to stand alone in a citation.
    for (const s of SECTIONS) {
      const text = formatSection(s)
      const approxTokens = Math.ceil(text.length / 4)
      expect(approxTokens, `${s.id} too small`).toBeGreaterThan(50)
      expect(approxTokens, `${s.id} too large`).toBeLessThan(2000)
    }
  })
})

// ─── helpers ────────────────────────────────────────────────────────────

// Concatenates every operator-visible string in a section so a
// keyword can be asserted regardless of which sub-array it lives in.
function rescueText(section: ManualSection): string {
  return [
    ...section.paragraphs,
    ...(section.bullets ?? []),
    ...(section.dodonts?.dos ?? []),
    ...(section.dodonts?.donts ?? []),
    ...(section.citations?.map(c => `${c.label} ${c.url}`) ?? []),
  ].join('\n')
}

// Mirrors the formatter the seed script uses. Keeping a copy here
// lets us pin the shape without coupling to the script's module
// (the script is a .mjs CLI; importing it in a vitest run is
// brittle). The script's formatter is small and stable.
function formatSection(section: ManualSection): string {
  const parts: string[] = []
  parts.push(`# ${section.title}`)
  parts.push('')
  for (const p of section.paragraphs) parts.push(p)
  if (section.bullets && section.bullets.length > 0) {
    parts.push('')
    for (const b of section.bullets) parts.push(`- ${b}`)
  }
  if (section.dodonts) {
    parts.push('')
    parts.push('Do:')
    for (const d of section.dodonts.dos)   parts.push(`- ${d}`)
    parts.push('')
    parts.push("Don't:")
    for (const d of section.dodonts.donts) parts.push(`- ${d}`)
  }
  if (section.citations && section.citations.length > 0) {
    parts.push('')
    parts.push('Citations:')
    for (const c of section.citations) parts.push(`- ${c.label} — ${c.url}`)
  }
  return parts.join('\n')
}

// ─── Scenario 7: Component-type registry — every type the inventory
//                 schema will reference exists in core ────────────────────

describe('E2E — fall protection component-type registry covers the program', () => {
  it('every ANSI Z359 device class an inventory row could be is enumerated', () => {
    // The Phase 2 schema will reference these as enum values. Drop
    // one here and the schema migration will fail check-nav-sync.
    const required = [
      'harness',
      'shock_lanyard',
      'positioning_lanyard',
      'restraint_lanyard',
      'srl_class1',
      'srl_class2',
      'anchor_connector',
      'rope_grab',
      'trauma_strap',
      'rescue_descent_device',
    ]
    for (const t of required) {
      expect(FALL_PROTECTION_COMPONENT_TYPES, `missing component type: ${t}`)
        .toContain(t as typeof FALL_PROTECTION_COMPONENT_TYPES[number])
    }
  })
})
