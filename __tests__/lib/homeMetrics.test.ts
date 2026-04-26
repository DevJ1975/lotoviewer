import { describe, it, expect } from 'vitest'
import {
  describeAuditEvent,
  linkForAuditEvent,
  partitionPermits,
  summarizeMetricsFromRows,
  findExpiringSoon,
  findPendingStale,
  EXPIRING_SOON_MIN,
  PENDING_STALE_MIN,
  type AuditLogRow,
  type EquipmentPhotoStatusRow,
  type PermitSummaryRow,
  type PendingPermitRow,
} from '@/lib/homeMetrics'

const NOW = new Date('2026-04-26T12:00:00Z').getTime()

// Test fixture builder. Spread-after-defaults so explicit nulls survive
// (the same gotcha bit me on the permit-status tests).
function audit(partial: Partial<AuditLogRow> & Pick<AuditLogRow, 'table_name' | 'operation'>): AuditLogRow {
  return {
    id:         1,
    actor_id:   null,
    actor_email: null,
    row_pk:     null,
    old_row:    null,
    new_row:    null,
    created_at: '2026-04-26T11:00:00Z',
    ...partial,
  }
}

function permit(partial: Partial<PermitSummaryRow>): PermitSummaryRow {
  return {
    id:                            'permit-uuid-1',
    serial:                        'CSP-20260426-0001',
    space_id:                      'CS-MIX-04',
    expires_at:                    new Date(NOW + 4 * 3600_000).toISOString(),
    canceled_at:                   null,
    entry_supervisor_signature_at: '2026-04-26T11:00:00Z',
    entrants:                      [],
    attendants:                    [],
    ...partial,
  }
}

// ── describeAuditEvent ─────────────────────────────────────────────────────

describe('describeAuditEvent', () => {
  describe('loto_confined_space_permits', () => {
    it('describes INSERT as "Permit issued"', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_confined_space_permits', operation: 'INSERT' }))).toBe('Permit issued')
    })

    it('describes a sign transition as "Permit signed — entry authorized"', () => {
      const r = audit({
        table_name: 'loto_confined_space_permits',
        operation:  'UPDATE',
        old_row:    { entry_supervisor_signature_at: null, canceled_at: null },
        new_row:    { entry_supervisor_signature_at: '2026-04-26T12:00:00Z', canceled_at: null },
      })
      expect(describeAuditEvent(r)).toBe('Permit signed — entry authorized')
    })

    it('describes a cancel transition with the reason', () => {
      const r = audit({
        table_name: 'loto_confined_space_permits',
        operation:  'UPDATE',
        old_row:    { canceled_at: null },
        new_row:    { canceled_at: '2026-04-26T12:00:00Z', cancel_reason: 'task_complete' },
      })
      expect(describeAuditEvent(r)).toBe('Permit canceled (task complete)')
    })

    it('describes a cancel without reason as just "Permit canceled"', () => {
      const r = audit({
        table_name: 'loto_confined_space_permits',
        operation:  'UPDATE',
        old_row:    { canceled_at: null },
        new_row:    { canceled_at: '2026-04-26T12:00:00Z' },
      })
      expect(describeAuditEvent(r)).toBe('Permit canceled')
    })

    it('falls back to "Permit updated" for non-state-transition edits', () => {
      const r = audit({
        table_name: 'loto_confined_space_permits',
        operation:  'UPDATE',
        old_row:    { notes: 'old', canceled_at: null, entry_supervisor_signature_at: '2026-04-26T11:00:00Z' },
        new_row:    { notes: 'new', canceled_at: null, entry_supervisor_signature_at: '2026-04-26T11:00:00Z' },
      })
      expect(describeAuditEvent(r)).toBe('Permit updated')
    })

    it('cancel takes precedence over sign when both transitions appear', () => {
      // Defensive: a single audit row shouldn't carry both, but if it
      // somehow does, the cancel description is more useful (more recent
      // intent on the record).
      const r = audit({
        table_name: 'loto_confined_space_permits',
        operation:  'UPDATE',
        old_row:    { canceled_at: null, entry_supervisor_signature_at: null },
        new_row:    { canceled_at: '2026-04-26T12:00:00Z', cancel_reason: 'prohibited_condition', entry_supervisor_signature_at: '2026-04-26T12:00:00Z' },
      })
      expect(describeAuditEvent(r)).toMatch(/canceled/i)
    })
  })

  describe('loto_equipment', () => {
    it('describes a photo URL change as "Equipment photo saved"', () => {
      const r = audit({
        table_name: 'loto_equipment',
        operation:  'UPDATE',
        old_row:    { equip_photo_url: null, iso_photo_url: 'https://e.example/iso.jpg' },
        new_row:    { equip_photo_url: 'https://e.example/equip.jpg', iso_photo_url: 'https://e.example/iso.jpg' },
      })
      expect(describeAuditEvent(r)).toBe('Equipment photo saved')
    })

    it('describes a generic edit as "Equipment edited"', () => {
      const r = audit({
        table_name: 'loto_equipment',
        operation:  'UPDATE',
        old_row:    { description: 'Old', equip_photo_url: 'a', iso_photo_url: 'b' },
        new_row:    { description: 'New', equip_photo_url: 'a', iso_photo_url: 'b' },
      })
      expect(describeAuditEvent(r)).toBe('Equipment edited')
    })

    it('describes INSERT/DELETE plainly', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_equipment', operation: 'INSERT' }))).toBe('Equipment added')
      expect(describeAuditEvent(audit({ table_name: 'loto_equipment', operation: 'DELETE' }))).toBe('Equipment removed')
    })
  })

  describe('other tables', () => {
    it('describes atmospheric tests', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_atmospheric_tests', operation: 'INSERT' })))
        .toBe('Atmospheric test recorded')
    })

    it('describes confined-space CRUD', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_confined_spaces', operation: 'INSERT' }))).toBe('Confined space added')
      expect(describeAuditEvent(audit({ table_name: 'loto_confined_spaces', operation: 'UPDATE' }))).toBe('Confined space edited')
      expect(describeAuditEvent(audit({ table_name: 'loto_confined_spaces', operation: 'DELETE' }))).toBe('Confined space removed')
    })

    it('describes energy steps', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_energy_steps', operation: 'INSERT' }))).toBe('Energy step added')
    })

    it('falls back to a generic line for unknown tables', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_some_future_table', operation: 'UPDATE' })))
        .toBe('update on some future table')
    })

    it('strips loto_ prefix and underscores in the fallback', () => {
      expect(describeAuditEvent(audit({ table_name: 'loto_inventory_items', operation: 'INSERT' })))
        .toBe('insert on inventory items')
    })
  })
})

// ── linkForAuditEvent ──────────────────────────────────────────────────────

describe('linkForAuditEvent', () => {
  it('builds a deep permit link when space_id + row_pk are present', () => {
    const r = audit({
      table_name: 'loto_confined_space_permits',
      operation:  'UPDATE',
      row_pk:     'permit-uuid-1',
      new_row:    { space_id: 'CS-MIX-04' },
    })
    expect(linkForAuditEvent(r)).toBe('/confined-spaces/CS-MIX-04/permits/permit-uuid-1')
  })

  it('falls back to the confined-spaces module home when space_id is missing', () => {
    const r = audit({ table_name: 'loto_confined_space_permits', operation: 'INSERT', row_pk: 'permit-uuid-1' })
    expect(linkForAuditEvent(r)).toBe('/confined-spaces')
  })

  it('uses old_row.space_id when new_row is null (DELETE case)', () => {
    const r = audit({
      table_name: 'loto_confined_space_permits',
      operation:  'DELETE',
      row_pk:     'permit-uuid-1',
      old_row:    { space_id: 'CS-MIX-04' },
      new_row:    null,
    })
    expect(linkForAuditEvent(r)).toBe('/confined-spaces/CS-MIX-04/permits/permit-uuid-1')
  })

  it('builds an equipment link from row_pk', () => {
    const r = audit({ table_name: 'loto_equipment', operation: 'UPDATE', row_pk: 'EQ-001' })
    expect(linkForAuditEvent(r)).toBe('/equipment/EQ-001')
  })

  it('encodes special characters in equipment IDs', () => {
    const r = audit({ table_name: 'loto_equipment', operation: 'UPDATE', row_pk: 'EQ/MIX 01' })
    expect(linkForAuditEvent(r)).toBe('/equipment/EQ%2FMIX%2001')
  })

  it('returns null for unknown tables (informational, not clickable)', () => {
    const r = audit({ table_name: 'loto_some_unknown', operation: 'INSERT' })
    expect(linkForAuditEvent(r)).toBeNull()
  })

  it('falls back to /confined-spaces/status for atmospheric tests with permit_id', () => {
    const r = audit({
      table_name: 'loto_atmospheric_tests',
      operation:  'INSERT',
      new_row:    { permit_id: 'permit-uuid-1' },
    })
    expect(linkForAuditEvent(r)).toBe('/confined-spaces/status')
  })
})

// ── partitionPermits ───────────────────────────────────────────────────────

describe('partitionPermits', () => {
  it('skips canceled permits entirely', () => {
    const out = partitionPermits([
      permit({ canceled_at: '2026-04-26T11:00:00Z' }),
    ], NOW)
    expect(out.active).toEqual([])
    expect(out.expired).toEqual([])
  })

  it('skips unsigned drafts', () => {
    const out = partitionPermits([
      permit({ entry_supervisor_signature_at: null }),
    ], NOW)
    expect(out.active).toEqual([])
    expect(out.expired).toEqual([])
  })

  it('classifies a future-expiry signed permit as active', () => {
    const out = partitionPermits([
      permit({ expires_at: new Date(NOW + 60_000).toISOString() }),
    ], NOW)
    expect(out.active).toHaveLength(1)
    expect(out.expired).toHaveLength(0)
  })

  it('classifies a past-expiry signed permit as expired (verify-evac)', () => {
    const out = partitionPermits([
      permit({ expires_at: new Date(NOW - 60_000).toISOString() }),
    ], NOW)
    expect(out.active).toHaveLength(0)
    expect(out.expired).toHaveLength(1)
  })

  it('classifies expires_at exactly equal to now as expired (fail-closed)', () => {
    // Boundary: <= nowMs is expired. A permit whose timer hits zero this
    // tick should be off the active list, not lingering for one more second.
    const out = partitionPermits([
      permit({ expires_at: new Date(NOW).toISOString() }),
    ], NOW)
    expect(out.expired).toHaveLength(1)
  })

  it('classifies an unparseable expires_at as expired (fail-closed)', () => {
    const out = partitionPermits([
      permit({ expires_at: 'not-a-date' }),
    ], NOW)
    expect(out.expired).toHaveLength(1)
  })

  it('handles a mixed roster cleanly', () => {
    const out = partitionPermits([
      permit({ id: 'a', canceled_at: '2026-04-26T11:30:00Z' }),
      permit({ id: 'b', entry_supervisor_signature_at: null }),
      permit({ id: 'c', expires_at: new Date(NOW + 4 * 3600_000).toISOString() }),
      permit({ id: 'd', expires_at: new Date(NOW - 60_000).toISOString() }),
    ], NOW)
    expect(out.active.map(p => p.id)).toEqual(['c'])
    expect(out.expired.map(p => p.id)).toEqual(['d'])
  })
})

// ── summarizeMetricsFromRows ───────────────────────────────────────────────

describe('summarizeMetricsFromRows', () => {
  it('returns zeros for an empty input set', () => {
    const m = summarizeMetricsFromRows({
      permits: [], equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.activePermits).toEqual([])
    expect(m.activePermitCount).toBe(0)
    expect(m.expiredPermitCount).toBe(0)
    expect(m.peopleInSpaces).toBe(0)
    expect(m.totalEquipment).toBe(0)
    expect(m.photoCompletionPct).toBe(0)
    expect(m.recentActivity).toEqual([])
  })

  it('caps active permits to top 3 sorted by soonest expiry', () => {
    const permits: PermitSummaryRow[] = [
      permit({ id: '1', expires_at: new Date(NOW + 4 * 3600_000).toISOString() }),
      permit({ id: '2', expires_at: new Date(NOW + 1 * 3600_000).toISOString() }),
      permit({ id: '3', expires_at: new Date(NOW + 2 * 3600_000).toISOString() }),
      permit({ id: '4', expires_at: new Date(NOW + 5 * 3600_000).toISOString() }),
    ]
    const m = summarizeMetricsFromRows({
      permits, equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.activePermits.map(p => p.id)).toEqual(['2', '3', '1'])
    expect(m.activePermitCount).toBe(4)  // count is full, list is top-3
  })

  it('sums entrants across active permits only (expired entrants don\'t count)', () => {
    const m = summarizeMetricsFromRows({
      permits: [
        permit({ id: '1', entrants: ['Alice', 'Bob'], expires_at: new Date(NOW + 60_000).toISOString() }),
        permit({ id: '2', entrants: ['Carol'],         expires_at: new Date(NOW - 60_000).toISOString() }), // expired
        permit({ id: '3', entrants: ['Dan', 'Eve'],    expires_at: new Date(NOW + 120_000).toISOString() }),
      ],
      equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.peopleInSpaces).toBe(4)
    expect(m.expiredPermitCount).toBe(1)
  })

  it('joins space descriptions onto the top-3 active permits when available', () => {
    const m = summarizeMetricsFromRows({
      permits: [permit({ space_id: 'CS-MIX-04' })],
      equipRows: [],
      audits: [],
      spaceDescById: new Map([['CS-MIX-04', 'South side mixing tank #4']]),
      nowMs: NOW,
    })
    expect(m.activePermits[0].spaceDescription).toBe('South side mixing tank #4')
  })

  it('falls back to null spaceDescription when no entry in the map', () => {
    const m = summarizeMetricsFromRows({
      permits: [permit({ space_id: 'CS-OTHER' })],
      equipRows: [],
      audits: [],
      spaceDescById: new Map(),
      nowMs: NOW,
    })
    expect(m.activePermits[0].spaceDescription).toBeNull()
  })

  it('synthesizes a fallback serial when the DB row is missing one', () => {
    // Pre-migration-011 permits could have null serials; the fallback
    // gives the home a stable label instead of "null" / "undefined".
    const m = summarizeMetricsFromRows({
      permits: [permit({ id: '12345678-90ab-cdef-1234-567890abcdef', serial: null })],
      equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.activePermits[0].serial).toBe('permit-12345678')
  })

  it('computes photoCompletionPct as integer percentage', () => {
    const equipRows: EquipmentPhotoStatusRow[] = [
      { photo_status: 'complete' },
      { photo_status: 'complete' },
      { photo_status: 'complete' },
      { photo_status: 'partial' },
    ]
    const m = summarizeMetricsFromRows({
      permits: [], equipRows, audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.totalEquipment).toBe(4)
    expect(m.photoCompletionPct).toBe(75)
  })

  it('rounds compliance to nearest integer (no fractional %)', () => {
    // 1 / 3 = 33.33% → rounds to 33.
    const equipRows: EquipmentPhotoStatusRow[] = [
      { photo_status: 'complete' },
      { photo_status: 'partial' },
      { photo_status: 'missing' },
    ]
    const m = summarizeMetricsFromRows({
      permits: [], equipRows, audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.photoCompletionPct).toBe(33)
  })

  it('returns 0% compliance for an empty equipment list (no division by zero)', () => {
    const m = summarizeMetricsFromRows({
      permits: [], equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.photoCompletionPct).toBe(0)
  })

  it('translates audit rows into ActivityEvent shape with link + description', () => {
    const audits: AuditLogRow[] = [{
      id: 42,
      table_name: 'loto_confined_space_permits',
      operation: 'INSERT',
      row_pk: 'permit-uuid-1',
      old_row: null,
      new_row: { space_id: 'CS-MIX-04' },
      created_at: '2026-04-26T11:30:00Z',
      actor_email: 'jamil@example.com',
    }]
    const m = summarizeMetricsFromRows({
      permits: [], equipRows: [], audits, spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.recentActivity).toHaveLength(1)
    expect(m.recentActivity[0]).toMatchObject({
      id:          42,
      description: 'Permit issued',
      link:        '/confined-spaces/CS-MIX-04/permits/permit-uuid-1',
      actorEmail:  'jamil@example.com',
    })
  })

  it('flags active permits expiring within EXPIRING_SOON_MIN', () => {
    const m = summarizeMetricsFromRows({
      permits: [
        permit({ id: 'soon', expires_at: new Date(NOW + 30 * 60_000).toISOString() }),     // 30 min
        permit({ id: 'safe', expires_at: new Date(NOW + 6 * 3600_000).toISOString() }),    // 6 h
      ],
      equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.expiringSoonPermits.map(p => p.id)).toEqual(['soon'])
  })

  it('flags pending-signature permits older than PENDING_STALE_MIN', () => {
    const stale: PendingPermitRow = {
      id:                            'stale',
      serial:                        'CSP-20260426-0099',
      space_id:                      'CS-FERM-A',
      started_at:                    new Date(NOW - 3 * 3600_000).toISOString(),
      canceled_at:                   null,
      entry_supervisor_signature_at: null,
    }
    const fresh: PendingPermitRow = {
      ...stale,
      id:        'fresh',
      started_at: new Date(NOW - 30 * 60_000).toISOString(),
    }
    const m = summarizeMetricsFromRows({
      permits: [], pending: [stale, fresh],
      equipRows: [], audits: [], spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.pendingStalePermits.map(p => p.id)).toEqual(['stale'])
  })

  it('preserves input order of audit rows (caller orders DESC)', () => {
    const audits: AuditLogRow[] = [
      { id: 3, table_name: 'loto_equipment', operation: 'INSERT', row_pk: null, old_row: null, new_row: null, created_at: '2026-04-26T11:30:00Z' },
      { id: 2, table_name: 'loto_equipment', operation: 'INSERT', row_pk: null, old_row: null, new_row: null, created_at: '2026-04-26T11:00:00Z' },
      { id: 1, table_name: 'loto_equipment', operation: 'INSERT', row_pk: null, old_row: null, new_row: null, created_at: '2026-04-26T10:00:00Z' },
    ]
    const m = summarizeMetricsFromRows({
      permits: [], equipRows: [], audits, spaceDescById: new Map(), nowMs: NOW,
    })
    expect(m.recentActivity.map(e => e.id)).toEqual([3, 2, 1])
  })
})

// ── findExpiringSoon ────────────────────────────────────────────────────────

describe('findExpiringSoon', () => {
  it('returns nothing when all permits have plenty of headroom', () => {
    const out = findExpiringSoon(
      [permit({ id: 'a', expires_at: new Date(NOW + 6 * 3600_000).toISOString() })],
      NOW, EXPIRING_SOON_MIN,
    )
    expect(out).toEqual([])
  })

  it('returns permits within the threshold sorted soonest-first', () => {
    const out = findExpiringSoon(
      [
        permit({ id: 'b', expires_at: new Date(NOW + 90 * 60_000).toISOString() }),
        permit({ id: 'a', expires_at: new Date(NOW + 15 * 60_000).toISOString() }),
        permit({ id: 'c', expires_at: new Date(NOW + 5  * 3600_000).toISOString() }),
      ],
      NOW, EXPIRING_SOON_MIN,
    )
    expect(out.map(p => p.id)).toEqual(['a', 'b'])
  })

  it('skips permits already past expiry — those are the "expired" alert, not "expiring soon"', () => {
    const out = findExpiringSoon(
      [permit({ id: 'past', expires_at: new Date(NOW - 5 * 60_000).toISOString() })],
      NOW, EXPIRING_SOON_MIN,
    )
    expect(out).toEqual([])
  })

  it('synthesizes a fallback serial when the row has none (pre-migration-011 data)', () => {
    const out = findExpiringSoon(
      [permit({ id: '12345678-aaaa-bbbb-cccc-dddddddddddd', serial: null, expires_at: new Date(NOW + 60 * 60_000).toISOString() })],
      NOW, EXPIRING_SOON_MIN,
    )
    expect(out[0].serial).toBe('permit-12345678')
  })
})

// ── findPendingStale ───────────────────────────────────────────────────────

describe('findPendingStale', () => {
  function pending(partial: Partial<PendingPermitRow>): PendingPermitRow {
    return {
      id:                            'pending-1',
      serial:                        'CSP-20260426-0099',
      space_id:                      'CS-FERM-A',
      started_at:                    new Date(NOW - 30 * 60_000).toISOString(),
      canceled_at:                   null,
      entry_supervisor_signature_at: null,
      ...partial,
    }
  }

  it('returns nothing when all drafts are fresh', () => {
    expect(findPendingStale([pending({})], NOW, PENDING_STALE_MIN)).toEqual([])
  })

  it('flags drafts older than the threshold', () => {
    const out = findPendingStale(
      [pending({ id: 'old', started_at: new Date(NOW - 4 * 3600_000).toISOString() })],
      NOW, PENDING_STALE_MIN,
    )
    expect(out.map(p => p.id)).toEqual(['old'])
  })

  it('orders oldest first so the supervisor sees the most-stale draft on top', () => {
    const out = findPendingStale(
      [
        pending({ id: 'younger', started_at: new Date(NOW - 3 * 3600_000).toISOString() }),
        pending({ id: 'older',   started_at: new Date(NOW - 8 * 3600_000).toISOString() }),
      ],
      NOW, PENDING_STALE_MIN,
    )
    expect(out.map(p => p.id)).toEqual(['older', 'younger'])
  })

  it('defensively skips signed or canceled rows even if the caller passed them', () => {
    const out = findPendingStale(
      [
        pending({ id: 'signed',   started_at: new Date(NOW - 4 * 3600_000).toISOString(), entry_supervisor_signature_at: '2026-04-26T11:00:00Z' }),
        pending({ id: 'canceled', started_at: new Date(NOW - 4 * 3600_000).toISOString(), canceled_at: '2026-04-26T11:30:00Z' }),
      ],
      NOW, PENDING_STALE_MIN,
    )
    expect(out).toEqual([])
  })
})
