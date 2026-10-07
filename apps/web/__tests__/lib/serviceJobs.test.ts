import { afterEach, describe, expect, it, vi } from 'vitest'
import { enqueueServiceJob, serviceJobsConfigured } from '@/lib/serviceJobs'

const ORIG_ENV = { ...process.env }
const JOB = { kind: 'document_extract', tenantId: 'tenant-1', payload: { document_id: 'doc-1' } }

afterEach(() => {
  process.env = { ...ORIG_ENV }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(impl: (...args: unknown[]) => unknown) {
  const fetchMock = vi.fn(impl)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('serviceJobsConfigured', () => {
  it('follows SDS_PARSER_URL', () => {
    delete process.env.SDS_PARSER_URL
    expect(serviceJobsConfigured()).toBe(false)
    process.env.SDS_PARSER_URL = 'http://svc'
    expect(serviceJobsConfigured()).toBe(true)
  })
})

describe('enqueueServiceJob', () => {
  it('does nothing and never calls out when the service is not configured', async () => {
    delete process.env.SDS_PARSER_URL
    const fetchMock = stubFetch(async () => ({ status: 202 }))
    expect(await enqueueServiceJob(JOB)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('posts the job in the service wire format and returns its id', async () => {
    process.env.SDS_PARSER_URL = 'http://svc///'
    process.env.SDS_PARSER_API_KEY = 'k3y'
    const fetchMock = stubFetch(async () => ({ status: 202, json: async () => ({ job_id: 'job-9' }) }))

    const out = await enqueueServiceJob({ ...JOB, requestedBy: 'user-1', dedupeKey: 'doc-1' })

    expect(out).toEqual({ jobId: 'job-9' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('http://svc/jobs')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'x-api-key': 'k3y', 'content-type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'document_extract', tenant_id: 'tenant-1', payload: { document_id: 'doc-1' },
      requested_by: 'user-1', dedupe_key: 'doc-1',
    })
  })

  it('omits the api key header when none is configured', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    delete process.env.SDS_PARSER_API_KEY
    const fetchMock = stubFetch(async () => ({ status: 202, json: async () => ({ job_id: 'j' }) }))
    await enqueueServiceJob(JOB)
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(init.headers).not.toHaveProperty('x-api-key')
  })

  it.each([
    ['jobs switched off (503)', { status: 503 }],
    ['an unknown kind (400)', { status: 400 }],
    ['a rejected payload (422)', { status: 422 }],
    ['a bad api key (401)', { status: 401 }],
    ['a reply without a job id', { status: 202, json: async () => ({}) }],
    ['a non-string job id', { status: 202, json: async () => ({ job_id: 7 }) }],
  ])('returns null for %s', async (_name, response) => {
    process.env.SDS_PARSER_URL = 'http://svc'
    stubFetch(async () => response)
    expect(await enqueueServiceJob(JOB)).toBeNull()
  })

  it('returns null instead of throwing when the service is unreachable or slow', async () => {
    process.env.SDS_PARSER_URL = 'http://svc'
    stubFetch(async () => { throw new Error('ECONNREFUSED') })
    expect(await enqueueServiceJob(JOB)).toBeNull()
  })
})
