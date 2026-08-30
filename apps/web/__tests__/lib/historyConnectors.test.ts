import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  intelexConnector,
  getHistoryConnector,
  connectorRowsToUpserts,
  ConnectorError,
  type ConnectorAnnualSummary,
} from '@/lib/insights/historyConnectors'

afterEach(() => { vi.unstubAllEnvs() })

const EST = '00000000-0000-0000-0000-0000000000aa'

function validFields(year: number): Record<string, unknown> {
  return {
    year,
    total_deaths:                0,
    total_days_away:             1,
    total_restricted:            0,
    total_other_recordable:      2,
    total_days_away_count:       5,
    total_days_restricted_count: 0,
    total_hours_worked:          100_000,
    annual_avg_employees:        50,
  }
}

describe('intelexConnector', () => {
  it('reports awaiting_credentials when env is unset', () => {
    vi.stubEnv('INTELEX_API_TOKEN', '')
    vi.stubEnv('INTELEX_BASE_URL', '')
    expect(intelexConnector.isConfigured()).toBe(false)
    expect(intelexConnector.status()).toBe('awaiting_credentials')
  })

  it('reports awaiting_mapping once credentials are present', () => {
    vi.stubEnv('INTELEX_API_TOKEN', 'tok_123')
    vi.stubEnv('INTELEX_BASE_URL', 'https://acme.intelex.com')
    expect(intelexConnector.isConfigured()).toBe(true)
    expect(intelexConnector.status()).toBe('awaiting_mapping')
  })

  it('throws a 501 ConnectorError naming the missing credentials', async () => {
    vi.stubEnv('INTELEX_API_TOKEN', '')
    vi.stubEnv('INTELEX_BASE_URL', '')
    await expect(intelexConnector.fetchAnnualSummaries({ tenantId: 't' })).rejects.toMatchObject({
      name: 'ConnectorError', httpStatus: 501,
    })
    await expect(intelexConnector.fetchAnnualSummaries({ tenantId: 't' }))
      .rejects.toThrow(/INTELEX_API_TOKEN \+ INTELEX_BASE_URL/)
  })

  it('throws a 501 ConnectorError for the missing field mapping once configured', async () => {
    vi.stubEnv('INTELEX_API_TOKEN', 'tok_123')
    vi.stubEnv('INTELEX_BASE_URL', 'https://acme.intelex.com')
    await expect(intelexConnector.fetchAnnualSummaries({ tenantId: 't' }))
      .rejects.toThrow(/field mapping/i)
  })
})

describe('getHistoryConnector', () => {
  it('resolves a known connector and rejects unknown ids', () => {
    expect(getHistoryConnector('intelex')).toBe(intelexConnector)
    expect(getHistoryConnector('nope')).toBeUndefined()
  })
})

describe('connectorRowsToUpserts', () => {
  it('builds an upsert row for a valid connector summary', () => {
    const rows: ConnectorAnnualSummary[] = [{ establishmentId: EST, fields: validFields(2025) }]
    const { upserts, errors } = connectorRowsToUpserts('tenant-1', rows, 2026)
    expect(errors).toEqual([])
    expect(upserts).toHaveLength(1)
    expect(upserts[0]).toMatchObject({
      tenant_id:        'tenant-1',
      establishment_id: EST,
      year:             2025,
      total_hours_worked:   100_000,
      annual_avg_employees: 50,
    })
    expect(upserts[0].totals_json.year).toBe(2025)
  })

  it('captures per-row validation errors instead of throwing, and keeps valid rows', () => {
    const rows: ConnectorAnnualSummary[] = [
      { establishmentId: EST, fields: validFields(2025) },
      { establishmentId: 'bad-est', fields: { ...validFields(2025), total_deaths: -1 } },
      { establishmentId: 'old-year', fields: validFields(1990) },
    ]
    const { upserts, errors } = connectorRowsToUpserts('tenant-1', rows, 2026)
    expect(upserts).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors.map(e => e.establishmentId)).toEqual(['bad-est', 'old-year'])
  })
})

describe('ConnectorError', () => {
  it('carries the connector id and http status', () => {
    const e = new ConnectorError('intelex', 502, 'boom')
    expect(e.connectorId).toBe('intelex')
    expect(e.httpStatus).toBe(502)
    expect(e).toBeInstanceOf(Error)
  })
})
