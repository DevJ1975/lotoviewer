import { describe, expect, it } from 'vitest'
import { describeJob } from '@/lib/regulationJobs'
import type { RegulationJobRow } from '@/app/api/superadmin/regulation-status/route'

const job = (over: Partial<RegulationJobRow>): RegulationJobRow => ({
  id: 'j', status: 'succeeded', payload: { source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: true },
  progress: null, result: null, last_error: null, attempts: 1, created_at: '2026-10-07T00:00:00Z', finished_at: null, ...over,
})

describe('describeJob', () => {
  it('says a queued job is waiting for the service', () => {
    expect(describeJob(job({ status: 'queued' }))).toMatch(/waiting for the service/i)
  })

  it('shows the stage and section progress of a running load', () => {
    expect(describeJob(job({ status: 'running', progress: { stage: 'writing', loaded: 12, total: 80 } })))
      .toBe('Running: writing (12 of 80 sections).')
    expect(describeJob(job({ status: 'running', progress: { stage: 'fetching' } }))).toBe('Running: fetching.')
    expect(describeJob(job({ status: 'running' }))).toBe('Running.')
  })

  it('shows the failure reason, or a plain fallback', () => {
    expect(describeJob(job({ status: 'failed', last_error: 'Parsed 3 sections but 40 are stored' }))).toContain('Parsed 3 sections')
    expect(describeJob(job({ status: 'failed' }))).toBe('Failed.')
  })

  it('reports a dry run as numbers the operator can sanity-check, and says nothing was written', () => {
    const text = describeJob(job({ result: {
      sections: 120, to_load: 118, chunks: 410, estimated_tokens: 252000, reserved: 14, unrecognized: 0,
      sample: ['40 CFR 262.10 — Purpose, scope, and applicability'],
    } }))
    expect(text).toContain('120 sections found, 118 new or changed')
    expect(text).toContain('410 chunks')
    expect(text).toContain('252,000 tokens')
    expect(text).toContain('14 reserved')
    expect(text).toContain('First: 40 CFR 262.10 — Purpose, scope, and applicability.')
    expect(text).toContain('Nothing was written.')
  })

  it('makes sections the parser did not understand impossible to miss', () => {
    const text = describeJob(job({ result: { sections: 5, to_load: 5, chunks: 5, estimated_tokens: 100, reserved: 0, unrecognized: 37 } }))
    expect(text).toContain('37 with a section number the parser did not understand')
  })

  it('reports a real load by what it loaded, left alone and removed', () => {
    const text = describeJob(job({
      payload: { source: 'epa-40-cfr-262', date: '2026-05-07', dry_run: false },
      result: { loaded: 118, unchanged: 2, removed: 1, reserved: 0, unrecognized: 0 },
    }))
    expect(text).toBe('Loaded 118 sections, 2 unchanged, 1 removed.')
  })

  it('does not throw on a result it does not recognize', () => {
    expect(() => describeJob(job({ result: { sections: 'many', sample: [7] } as never }))).not.toThrow()
    expect(() => describeJob(job({ result: null }))).not.toThrow()
  })
})
