import { describe, it, expect, vi, beforeEach } from 'vitest'

// uploadEvidence chooses the way a file travels: small files in the request,
// larger ones straight to storage on a signed URL and then finalized by the
// API (which re-reads and hashes them). Either way the same fields describe the
// evidence, and a failed storage upload is surfaced rather than finalized.

const storage = vi.hoisted(() => ({ uploadToSignedUrl: vi.fn() }))
vi.mock('@/lib/supabase', () => ({
  readActiveFacility: () => null,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { access_token: 'token' } } }) },
    storage: { from: (bucket: string) => ({ uploadToSignedUrl: (...args: unknown[]) => storage.uploadToSignedUrl(bucket, ...args) }) },
  },
}))

import { MAX_BODY_EVIDENCE_BYTES, uploadEvidence } from '@/lib/environmental/client'

const fetchMock = vi.fn()
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

const file = (bytes: number, name = 'permit.pdf') => new File([new Uint8Array(bytes)], name, { type: 'application/pdf' })
const input = (over: Partial<Parameters<typeof uploadEvidence>[1]> = {}) => ({
  subjectType: 'environmental_permit' as const, subjectId: 'permit-1', kind: 'document' as const, file: file(10), ...over,
})

beforeEach(() => {
  fetchMock.mockReset()
  storage.uploadToSignedUrl.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('uploadEvidence', () => {
  it('sends a small file in the request body, with the subject it proves', async () => {
    fetchMock.mockResolvedValue(respond({ evidence: { id: 'e1' } }, 201))
    await uploadEvidence('t1', input())
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/environmental/evidence')
    const form = init.body as FormData
    expect(Object.fromEntries([...form.entries()].filter(([name]) => name !== 'file'))).toEqual({
      subject_type: 'environmental_permit', subject_id: 'permit-1', kind: 'document',
    })
    expect((form.get('file') as File).name).toBe('permit.pdf')
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled()
  })

  it('passes the export-control flag and a replacement, and only when they are set', async () => {
    fetchMock.mockResolvedValue(respond({ evidence: { id: 'e1' } }, 201))
    await uploadEvidence('t1', input({ exportControlled: true, supersedes: { id: 'old', reason: 'Wrong file' } }))
    const form = (fetchMock.mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('export_controlled')).toBe('true')
    expect(form.get('supersedes_id')).toBe('old')
    expect(form.get('superseded_reason')).toBe('Wrong file')
  })

  it('sends a file over the body limit straight to storage, then has the API file it', async () => {
    fetchMock
      .mockResolvedValueOnce(respond({ path: 'pending/t1/u1--x', token: 'signed' }, 201))
      .mockResolvedValueOnce(respond({ evidence: { id: 'e1' } }, 201))
    storage.uploadToSignedUrl.mockResolvedValue({ error: null })
    const big = file(MAX_BODY_EVIDENCE_BYTES + 1, 'plan.pdf')

    await uploadEvidence('t1', input({ file: big, exportControlled: true }))

    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      '/api/environmental/evidence/uploads', '/api/environmental/evidence/uploads/finalize',
    ])
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      subject_type: 'environmental_permit', subject_id: 'permit-1', kind: 'document', export_controlled: true, file_size: big.size,
    })
    expect(storage.uploadToSignedUrl).toHaveBeenCalledWith('ms-evidence', 'pending/t1/u1--x', 'signed', big)
    expect(JSON.parse((fetchMock.mock.calls[1][1] as RequestInit).body as string)).toMatchObject({
      path: 'pending/t1/u1--x', file_name: 'plan.pdf', subject_id: 'permit-1', export_controlled: true,
    })
  })

  it('does not finalize when the bytes never reached storage', async () => {
    fetchMock.mockResolvedValueOnce(respond({ path: 'pending/t1/u1--x', token: 'signed' }, 201))
    storage.uploadToSignedUrl.mockResolvedValue({ error: { message: 'bucket unavailable' } })
    await expect(uploadEvidence('t1', input({ file: file(MAX_BODY_EVIDENCE_BYTES + 1) }))).rejects.toThrow(/bucket unavailable/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('surfaces the API\'s refusal to start an upload', async () => {
    fetchMock.mockResolvedValueOnce(respond({ error: 'This permit is retired, so its documents can no longer change.' }, 409))
    await expect(uploadEvidence('t1', input({ file: file(MAX_BODY_EVIDENCE_BYTES + 1) }))).rejects.toThrow(/retired/)
    expect(storage.uploadToSignedUrl).not.toHaveBeenCalled()
  })
})
