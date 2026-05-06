import { describe, it, expect } from 'vitest'
import {
  buildExpiryDigest,
  EXPIRING_WINDOW_DAYS,
  EXPIRED_GRACE_DAYS,
  type RawTrainingRow,
} from '@soteria/core/trainingExpiryDigest'

const ASOF = new Date('2026-05-06T12:00:00Z')
const TENANT_A = '00000000-0000-0000-0000-000000000001'
const TENANT_B = '00000000-0000-0000-0000-000000000002'

function row(p: Partial<RawTrainingRow> & Pick<RawTrainingRow, 'worker_name' | 'expires_at'>): RawTrainingRow {
  return {
    tenant_id:    TENANT_A,
    role:         'authorized_employee',
    completed_at: '2024-01-01',
    ...p,
  }
}

describe('buildExpiryDigest', () => {
  it('returns empty when no records expire in window', () => {
    expect(buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: '2027-01-01' }),  // far future
      row({ worker_name: 'Tomás', expires_at: null }),          // no expiry on file
    ], ASOF)).toEqual([])
  })

  it('classifies a record expiring tomorrow as expiring', () => {
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: '2026-05-07' }),
    ], ASOF)
    expect(out).toHaveLength(1)
    expect(out[0].rows[0]).toMatchObject({
      worker_name: 'Maria',
      status:      'expiring',
      days:        1,
    })
  })

  it('classifies a record expired yesterday as expired', () => {
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: '2026-05-05' }),
    ], ASOF)
    expect(out[0].rows[0]).toMatchObject({ status: 'expired', days: 1 })
  })

  it('drops records expired more than EXPIRED_GRACE_DAYS days ago', () => {
    expect(buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: '2026-04-01' }),  // 35 days ago
    ], ASOF)).toEqual([])
  })

  it('drops records expiring further than EXPIRING_WINDOW_DAYS in the future', () => {
    expect(buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: '2026-07-01' }),  // 56 days out
    ], ASOF)).toEqual([])
  })

  it('respects EXPIRING_WINDOW boundary (day 30 is included)', () => {
    const target = ymdOffset(ASOF, EXPIRING_WINDOW_DAYS)
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: target }),
    ], ASOF)
    expect(out[0].rows[0]).toMatchObject({ status: 'expiring', days: EXPIRING_WINDOW_DAYS })
  })

  it('respects EXPIRED_GRACE boundary (day -7 is included)', () => {
    const target = ymdOffset(ASOF, -EXPIRED_GRACE_DAYS)
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', expires_at: target }),
    ], ASOF)
    expect(out[0].rows[0]).toMatchObject({ status: 'expired', days: EXPIRED_GRACE_DAYS })
  })

  it('uses the freshest record per (tenant, worker, role)', () => {
    // Older record expired but a newer one is still current → drop both.
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', completed_at: '2024-01-01', expires_at: '2025-01-01' }),
      row({ worker_name: 'Maria', completed_at: '2026-04-01', expires_at: '2028-04-01' }),
    ], ASOF)
    expect(out).toEqual([])
  })

  it('groups output by tenant', () => {
    const out = buildExpiryDigest([
      row({ tenant_id: TENANT_A, worker_name: 'Maria', expires_at: '2026-05-07' }),
      row({ tenant_id: TENANT_B, worker_name: 'Tomás', expires_at: '2026-05-07' }),
    ], ASOF)
    expect(out).toHaveLength(2)
    const a = out.find(t => t.tenant_id === TENANT_A)
    const b = out.find(t => t.tenant_id === TENANT_B)
    expect(a?.rows).toHaveLength(1)
    expect(b?.rows).toHaveLength(1)
  })

  it('sorts within tenant: expired (most overdue first), then expiring (soonest first)', () => {
    const out = buildExpiryDigest([
      row({ worker_name: 'expiring-far',  expires_at: '2026-06-01' }),  // 26d
      row({ worker_name: 'expiring-near', expires_at: '2026-05-08' }),  // 2d
      row({ worker_name: 'expired-fresh', expires_at: '2026-05-05' }),  // -1d
      row({ worker_name: 'expired-old',   expires_at: '2026-05-01' }),  // -5d
    ], ASOF)
    expect(out[0].rows.map(r => r.worker_name)).toEqual([
      'expired-old',
      'expired-fresh',
      'expiring-near',
      'expiring-far',
    ])
  })

  it('decorates with role_label', () => {
    const out = buildExpiryDigest([
      row({ worker_name: 'Maria', role: 'authorized_employee', expires_at: '2026-05-07' }),
    ], ASOF)
    expect(out[0].rows[0].role_label).toBe('LOTO authorized employee')
  })
})

// ─── helpers ────────────────────────────────────────────────────────────
function ymdOffset(asOf: Date, deltaDays: number): string {
  const d = new Date(asOf.getTime() + deltaDays * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}
