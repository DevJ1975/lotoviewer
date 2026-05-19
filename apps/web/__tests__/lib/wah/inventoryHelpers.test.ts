// Unit tests for the Working at Heights inventory helpers. Pure
// functions, injectable `now` — every case is deterministic.

import { describe, expect, it } from 'vitest'
import {
  daysUntil,
  expiryBand,
  decorateWithDaysLeft,
  EXPIRY_BAND_CLASS,
  FALL_PROTECTION_TYPE_LABELS,
  ANCHOR_KIND_LABELS,
  INSPECTION_KIND_LABELS,
  ROLE_LABELS,
  STATUS_BADGE_CLASS,
  OUTCOME_BADGE_CLASS,
} from '@/lib/wah/inventoryHelpers'
import {
  FALL_PROTECTION_COMPONENT_TYPES,
  AT_HEIGHTS_ROLES,
} from '@soteria/core/workingAtHeights'

// Fixed reference moment so every test reads the same "now". Picked
// arbitrarily, but stable.
const NOW = new Date('2026-06-15T12:00:00Z').getTime()

describe('daysUntil', () => {
  it('returns null for null / undefined / empty input', () => {
    expect(daysUntil(null, NOW)).toBeNull()
    expect(daysUntil(undefined, NOW)).toBeNull()
    expect(daysUntil('', NOW)).toBeNull()
  })

  it('returns 0 when the date is today (same calendar moment)', () => {
    expect(daysUntil('2026-06-15T12:00:00Z', NOW)).toBe(0)
  })

  it('returns 1 for tomorrow (24 hours forward)', () => {
    expect(daysUntil('2026-06-16T12:00:00Z', NOW)).toBe(1)
  })

  it('returns a negative number for past dates', () => {
    expect(daysUntil('2026-06-14T12:00:00Z', NOW)).toBe(-1)
    expect(daysUntil('2025-06-15T12:00:00Z', NOW)).toBe(-365)
  })

  it('rounds upward — a date 12 hours away counts as 1 day', () => {
    // ceil() rather than floor() so "expires in 0.5 days" presents as
    // "1d left", which matches the operator-facing reading.
    expect(daysUntil('2026-06-16T00:00:00Z', NOW)).toBe(1)
  })

  it('returns NaN for a malformed date string', () => {
    // Caller decides what to do with NaN — expiryBand treats it as
    // unknown, which is the right rendering fallback.
    expect(daysUntil('not a date', NOW)).toBeNaN()
  })

  it('uses Date.now() when no explicit now is passed', () => {
    // Smoke: passing the same date twice should produce two results
    // close enough that any flakiness is wall-clock drift, not bug.
    const a = daysUntil('2030-01-01T00:00:00Z')
    const b = daysUntil('2030-01-01T00:00:00Z')
    expect(Math.abs((a ?? 0) - (b ?? 0))).toBeLessThanOrEqual(1)
  })
})

describe('expiryBand', () => {
  it('null → unknown', () => {
    expect(expiryBand(null)).toBe('unknown')
  })

  it('NaN → unknown', () => {
    expect(expiryBand(NaN)).toBe('unknown')
  })

  it('negative → expired', () => {
    expect(expiryBand(-1)).toBe('expired')
    expect(expiryBand(-90)).toBe('expired')
    expect(expiryBand(-3650)).toBe('expired')
  })

  it('0 → expiring_soon (today is the deadline)', () => {
    expect(expiryBand(0)).toBe('expiring_soon')
  })

  it('within default 90-day window → expiring_soon', () => {
    expect(expiryBand(1)).toBe('expiring_soon')
    expect(expiryBand(45)).toBe('expiring_soon')
    expect(expiryBand(90)).toBe('expiring_soon')
  })

  it('91+ days → ok', () => {
    expect(expiryBand(91)).toBe('ok')
    expect(expiryBand(365)).toBe('ok')
  })

  it('respects the soonThresholdDays override (rescue plan drills use 30)', () => {
    // 60 days is far enough out to be OK under the 30-day threshold,
    // but expiring_soon under the default 90.
    expect(expiryBand(60, 30)).toBe('ok')
    expect(expiryBand(60, 90)).toBe('expiring_soon')
  })

  it('EXPIRY_BAND_CLASS covers every band', () => {
    expect(EXPIRY_BAND_CLASS.expired).toMatch(/rose|red/)
    expect(EXPIRY_BAND_CLASS.expiring_soon).toMatch(/amber|yellow/)
    expect(EXPIRY_BAND_CLASS.ok).toMatch(/slate|grey/i)
    expect(EXPIRY_BAND_CLASS.unknown).toMatch(/slate|grey/i)
  })
})

describe('decorateWithDaysLeft', () => {
  const rows = [
    { id: 'a', service_expires_at: '2026-06-16T12:00:00Z' },  // 1 day
    { id: 'b', service_expires_at: '2026-06-14T12:00:00Z' },  // -1 day (expired)
    { id: 'c', service_expires_at: null },                    // null
    { id: 'd', service_expires_at: '2030-01-01T00:00:00Z' },  // far future
  ]

  it('attaches days_left to every row', () => {
    const decorated = decorateWithDaysLeft(rows, 'service_expires_at', NOW)
    expect(decorated).toHaveLength(4)
    expect(decorated[0].days_left).toBe(1)
    expect(decorated[1].days_left).toBe(-1)
    expect(decorated[2].days_left).toBeNull()
    expect(decorated[3].days_left).toBeGreaterThan(1000)
  })

  it('preserves original row fields', () => {
    const decorated = decorateWithDaysLeft(rows, 'service_expires_at', NOW)
    expect(decorated[0].id).toBe('a')
    expect(decorated[0].service_expires_at).toBe('2026-06-16T12:00:00Z')
  })

  it('handles an empty list', () => {
    expect(decorateWithDaysLeft([], 'service_expires_at', NOW)).toEqual([])
  })

  it('works with arbitrary date field names', () => {
    const altRows = [{ id: 'x', valid_until: '2026-06-16T12:00:00Z' }]
    const decorated = decorateWithDaysLeft(altRows, 'valid_until', NOW)
    expect(decorated[0].days_left).toBe(1)
  })
})

describe('Label maps cover every enum value', () => {
  it('FALL_PROTECTION_TYPE_LABELS includes every ANSI Z359 component type', () => {
    for (const t of FALL_PROTECTION_COMPONENT_TYPES) {
      expect(FALL_PROTECTION_TYPE_LABELS[t], `missing label for ${t}`).toBeDefined()
      expect(FALL_PROTECTION_TYPE_LABELS[t].length).toBeGreaterThan(0)
    }
  })

  it('ROLE_LABELS covers every at-heights role', () => {
    for (const r of AT_HEIGHTS_ROLES) {
      expect(ROLE_LABELS[r], `missing label for ${r}`).toBeDefined()
    }
  })

  it('ANCHOR_KIND_LABELS covers the four anchor kinds', () => {
    expect(ANCHOR_KIND_LABELS.engineered_permanent).toBeDefined()
    expect(ANCHOR_KIND_LABELS.engineered_portable).toBeDefined()
    expect(ANCHOR_KIND_LABELS.horizontal_lifeline).toBeDefined()
    expect(ANCHOR_KIND_LABELS.improvised).toBeDefined()
  })

  it('INSPECTION_KIND_LABELS covers pre-use / periodic / post-event', () => {
    expect(INSPECTION_KIND_LABELS.pre_use).toBe('Pre-use')
    expect(INSPECTION_KIND_LABELS.periodic).toBe('Periodic')
    expect(INSPECTION_KIND_LABELS.post_event).toBe('Post-event')
  })

  it('STATUS_BADGE_CLASS covers every equipment status', () => {
    // Mirrors public.wah_equipment_status (Phase 2 migration).
    const required = ['in_service', 'quarantined', 'condemned', 'in_rescue_cache', 'pending_recert']
    for (const s of required) {
      expect(STATUS_BADGE_CLASS[s], `missing badge for ${s}`).toBeDefined()
    }
  })

  it('OUTCOME_BADGE_CLASS covers every inspection outcome', () => {
    expect(OUTCOME_BADGE_CLASS.pass).toBeDefined()
    expect(OUTCOME_BADGE_CLASS.concern).toBeDefined()
    expect(OUTCOME_BADGE_CLASS.condemn).toBeDefined()
  })
})

describe('Migration 188 shape (file-level smoke)', () => {
  // Cheap defensive check: assert the migration file contains every
  // table + enum the helpers above expect to read. If somebody
  // deletes a table from the migration this fails — they have to
  // delete the helpers too, which is the intended behaviour.
  it('declares every table the inventory pages read', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const path = resolve(
      __dirname,
      '../../..',
      'migrations',
      '188_working_at_heights_schema.sql',
    )
    const sql = readFileSync(path, 'utf8')
    const tables = [
      'wah_authorizations',
      'wah_components',
      'wah_ladders_portable',
      'wah_ladders_fixed',
      'wah_anchors',
      'wah_rescue_plans',
      'wah_inspections',
      'wah_permits',
    ]
    for (const t of tables) {
      expect(sql, `${t} create-table`).toMatch(new RegExp(`create table if not exists public\\.${t}\\b`))
    }
  })

  it('declares every wah_* enum the helpers reference', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const path = resolve(
      __dirname,
      '../../..',
      'migrations',
      '188_working_at_heights_schema.sql',
    )
    const sql = readFileSync(path, 'utf8')
    const enums = [
      'wah_role',
      'wah_component_type',
      'wah_equipment_status',
      'wah_ladder_type',
      'wah_ladder_material',
      'wah_ladder_duty',
      'wah_anchor_kind',
      'wah_inspection_kind',
      'wah_inspection_outcome',
      'wah_permit_status',
    ]
    for (const e of enums) {
      expect(sql, `${e} create-type`).toMatch(new RegExp(`create type public\\.${e} as enum`))
    }
  })

  it('enables RLS on every table', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const path = resolve(
      __dirname,
      '../../..',
      'migrations',
      '188_working_at_heights_schema.sql',
    )
    const sql = readFileSync(path, 'utf8')
    const tables = [
      'wah_authorizations',
      'wah_components',
      'wah_ladders_portable',
      'wah_ladders_fixed',
      'wah_anchors',
      'wah_rescue_plans',
      'wah_inspections',
      'wah_permits',
    ]
    for (const t of tables) {
      expect(sql, `${t} RLS`).toMatch(new RegExp(`alter table public\\.${t} enable row level security`))
    }
  })

  it('attaches the audit-log trigger to every table', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const path = resolve(
      __dirname,
      '../../..',
      'migrations',
      '188_working_at_heights_schema.sql',
    )
    const sql = readFileSync(path, 'utf8')
    // Trigger names are abbreviated where the table name would push
    // past the Postgres 63-char identifier limit (e.g. wah_authorizations
    // → trg_audit_wah_auth). The contract is "audit trigger attached"
    // not "named the same as the table", so we assert the trigger fires
    // on each table via the `on public.<table>` clause.
    const tables = [
      'wah_authorizations',
      'wah_components',
      'wah_ladders_portable',
      'wah_ladders_fixed',
      'wah_anchors',
      'wah_rescue_plans',
      'wah_inspections',
      'wah_permits',
    ]
    for (const t of tables) {
      const re = new RegExp(
        `create trigger trg_audit_\\w+\\s+after insert or update or delete on public\\.${t}`,
        'i',
      )
      expect(sql, `${t} audit trigger`).toMatch(re)
    }
  })
})
