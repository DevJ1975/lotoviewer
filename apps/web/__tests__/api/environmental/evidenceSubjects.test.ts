// @vitest-environment node
//
// Evidence for the Phase 2 records (plan D15, Q2, Q3): a permit's documents, a change
// impact's evidence, proof a condition was done, an obligation's rule text; who may
// attach to each; the export-control flag; and the direct-to-storage upload for files
// too large for a request body. Node environment: FormData and File are the real ones.

import { describe, it, expect, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ADMIN_A, FACILITY_A, MEMBER_A, TENANT_A,
  asAdminA, asAdminB, asMemberA, idContext, jsonRequest, objects, resetStore, rowsIn, seed,
} from './_emsHarness'

import * as upload from '@/app/api/environmental/evidence/route'
import * as download from '@/app/api/environmental/evidence/[id]/download/route'
import * as startUpload from '@/app/api/environmental/evidence/uploads/route'
import * as finalize from '@/app/api/environmental/evidence/uploads/finalize/route'
import { MAX_DIRECT_EVIDENCE_BYTES } from '@/lib/environmental/evidence'

const PERMIT = 'f0000000-0000-4000-8000-00000000000a'
const RETIRED = 'f0000000-0000-4000-8000-0000000000a9'
const CHANGE = 'c0000000-0000-4000-8000-00000000000a'
const IMPACT = 'c1000000-0000-4000-8000-00000000000a'
const RESOLVED = 'c1000000-0000-4000-8000-00000000000b'
const OBLIGATION = 'b0000000-0000-4000-8000-00000000000a'
const EVENT = 'e0000000-0000-4000-8000-00000000000e'

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function uploadRequest(fields: Record<string, string>, bytes: Uint8Array<ArrayBuffer> = PDF): Request {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  form.append('file', new File([bytes], 'Permit scan.pdf', { type: 'application/pdf' }))
  return new Request('https://app.test/api/environmental/evidence', { method: 'POST', body: form })
}

beforeEach(() => {
  resetStore()
  seed('environmental_permits', [
    { id: PERMIT, tenant_id: TENANT_A, facility_id: FACILITY_A, retired_at: null },
    { id: RETIRED, tenant_id: TENANT_A, facility_id: FACILITY_A, retired_at: '2026-01-01T00:00:00Z' },
  ])
  seed('ms_changes', [{ id: CHANGE, tenant_id: TENANT_A, facility_id: null, status: 'open' }])
  seed('ms_change_impacts', [
    { id: IMPACT, tenant_id: TENANT_A, change_id: CHANGE, resolved_at: null },
    { id: RESOLVED, tenant_id: TENANT_A, change_id: CHANGE, resolved_at: '2026-10-01T00:00:00Z' },
  ])
  seed('compliance_calendar_obligations', [
    { id: OBLIGATION, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', owner_user_id: MEMBER_A },
  ])
  seed('compliance_calendar_events', [{ id: EVENT, tenant_id: TENANT_A, obligation_id: OBLIGATION }])
})

describe('POST /evidence: the Phase 2 subjects', () => {
  it('files a permit document under the permit, at the permit\'s site', async () => {
    const res = await upload.POST(uploadRequest({ subject_type: 'environmental_permit', subject_id: PERMIT, kind: 'document' }))
    expect(res.status).toBe(201)
    expect(rowsIn('ms_evidence')[0]).toMatchObject({
      subject_type: 'environmental_permit', subject_id: PERMIT, facility_id: FACILITY_A, export_controlled: false,
      storage_path: `${TENANT_A}/environmental_permit/${PERMIT}/${sha(PDF)}.pdf`, uploaded_by: ADMIN_A,
    })
  })

  it.each([
    ['a retired permit', 'environmental_permit', RETIRED],
    ['a resolved impact', 'ms_change_impact', RESOLVED],
  ])('refuses %s, which takes no more evidence', async (_label, subjectType, subjectId) => {
    const res = await upload.POST(uploadRequest({ subject_type: subjectType, subject_id: subjectId, kind: 'document' }))
    expect(res.status).toBe(409)
    expect(rowsIn('ms_evidence')).toEqual([])
  })

  it('refuses an impact once its change has ended', async () => {
    rowsIn('ms_changes')[0].status = 'cancelled'
    expect((await upload.POST(uploadRequest({ subject_type: 'ms_change_impact', subject_id: IMPACT, kind: 'document' }))).status).toBe(409)
  })

  it('lets a condition\'s owner attach proof to an occurrence of it, and no other member', async () => {
    asMemberA()
    expect((await upload.POST(uploadRequest({ subject_type: 'compliance_calendar_event', subject_id: EVENT, kind: 'sample_result' }))).status).toBe(201)
    rowsIn('compliance_calendar_obligations')[0].owner_user_id = null
    const res = await upload.POST(uploadRequest({ subject_type: 'compliance_calendar_event', subject_id: EVENT, kind: 'photo' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/condition's owner/)
  })

  it.each([
    ['environmental_permit', PERMIT],
    ['ms_change_impact', IMPACT],
    ['compliance_obligation', OBLIGATION],
  ])('keeps %s to admins', async (subjectType, subjectId) => {
    asMemberA()
    expect((await upload.POST(uploadRequest({ subject_type: subjectType, subject_id: subjectId, kind: 'document' }))).status).toBe(403)
    asAdminA()
    expect((await upload.POST(uploadRequest({ subject_type: subjectType, subject_id: subjectId, kind: 'document' }))).status).toBe(201)
  })

  it('answers 404 for another tenant\'s record', async () => {
    asAdminB()
    expect((await upload.POST(uploadRequest({ subject_type: 'environmental_permit', subject_id: PERMIT, kind: 'document' }))).status).toBe(404)
  })

  it('records the export-control flag, and refuses a flag that is not true or false', async () => {
    expect((await upload.POST(uploadRequest({ subject_type: 'environmental_permit', subject_id: PERMIT, kind: 'document', export_controlled: 'true' }))).status).toBe(201)
    expect(rowsIn('ms_evidence')[0].export_controlled).toBe(true)
    expect((await upload.POST(uploadRequest({ subject_type: 'environmental_permit', subject_id: PERMIT, kind: 'document', export_controlled: 'maybe' }))).status).toBe(400)
  })
})

describe('GET /evidence/[id]/download: export-controlled files', () => {
  const EVIDENCE = 'e1de0000-0000-4000-8000-000000000001'

  beforeEach(() => {
    const path = `${TENANT_A}/environmental_permit/${PERMIT}/${sha(PDF)}.pdf`
    objects.set(`ms-evidence/${path}`, new Uint8Array(PDF))
    seed('ms_evidence', [{
      id: EVIDENCE, tenant_id: TENANT_A, subject_type: 'environmental_permit', subject_id: PERMIT, storage_path: path,
      sha256: sha(PDF), mime_type: 'application/pdf', file_name: 'Drawing.pdf', export_controlled: true,
    }])
  })

  it('serves an export-controlled file to an admin, and to no other member', async () => {
    expect((await download.GET(jsonRequest('/x', 'GET'), idContext(EVIDENCE))).status).toBe(200)
    asMemberA()
    const res = await download.GET(jsonRequest('/x', 'GET'), idContext(EVIDENCE))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toMatch(/export-controlled/)
  })

  it('serves an ordinary file to any member', async () => {
    rowsIn('ms_evidence')[0].export_controlled = false
    asMemberA()
    expect((await download.GET(jsonRequest('/x', 'GET'), idContext(EVIDENCE))).status).toBe(200)
  })
})

describe('direct-to-storage upload', () => {
  const start = (body: Record<string, unknown>) => startUpload.POST(jsonRequest('/x', 'POST', body))
  const permitFields = { subject_type: 'environmental_permit', subject_id: PERMIT, kind: 'document' }
  const LARGE = new Uint8Array([...PDF, ...new Uint8Array(5 * 1024 * 1024)])

  /** Starts an upload, then puts the bytes where the browser's signed upload would. */
  async function uploaded(bytes: Uint8Array): Promise<string> {
    const res = await start({ ...permitFields, file_size: bytes.byteLength })
    expect(res.status).toBe(201)
    const { path, token } = await res.json()
    expect(token).toBeTruthy()
    objects.set(`ms-evidence/${path}`, new Uint8Array(bytes))
    return path
  }

  it('issues a signed upload into a pending folder that names the tenant and the uploader', async () => {
    const res = await start({ ...permitFields, file_size: LARGE.byteLength })
    const { path } = await res.json()
    expect(path).toMatch(new RegExp(`^pending/${TENANT_A}/${ADMIN_A}--[0-9a-f-]{36}$`))
  })

  it('refuses a file over 25 MB, or of no size, before any upload', async () => {
    expect((await start({ ...permitFields, file_size: MAX_DIRECT_EVIDENCE_BYTES + 1 })).status).toBe(400)
    expect((await start({ ...permitFields, file_size: 0 })).status).toBe(400)
  })

  it('checks the record before any upload, as the multipart route does', async () => {
    expect((await start({ ...permitFields, subject_id: RETIRED, file_size: 100 })).status).toBe(409)
    asMemberA()
    expect((await start({ ...permitFields, file_size: 100 })).status).toBe(403)
  })

  it('files a large upload like any other evidence, and removes the pending copy', async () => {
    const path = await uploaded(LARGE)
    const res = await finalize.POST(jsonRequest('/x', 'POST', { ...permitFields, path, file_name: 'Title V permit.pdf', export_controlled: true }))
    expect(res.status).toBe(201)
    expect(rowsIn('ms_evidence')[0]).toMatchObject({
      subject_id: PERMIT, sha256: sha(LARGE), file_size_bytes: LARGE.byteLength, file_name: 'Title V permit.pdf', export_controlled: true,
    })
    expect(objects.has(`ms-evidence/${TENANT_A}/environmental_permit/${PERMIT}/${sha(LARGE)}.pdf`)).toBe(true)
    expect(objects.has(`ms-evidence/${path}`)).toBe(false)
  })

  it('finalizes only an upload the caller started, in their tenant', async () => {
    const path = await uploaded(PDF)
    asAdminB()
    expect((await finalize.POST(jsonRequest('/x', 'POST', { ...permitFields, path, file_name: 'x.pdf' }))).status).toBe(400)
    expect(rowsIn('ms_evidence')).toEqual([])
    expect(objects.has(`ms-evidence/${path}`)).toBe(true)
  })

  it('refuses a file that is not really a PDF or image, and discards it', async () => {
    const path = await uploaded(new TextEncoder().encode('<html><script>alert(1)</script></html>'))
    expect((await finalize.POST(jsonRequest('/x', 'POST', { ...permitFields, path, file_name: 'scan.pdf' }))).status).toBe(415)
    expect(rowsIn('ms_evidence')).toEqual([])
    expect(objects.has(`ms-evidence/${path}`)).toBe(false)
  })

  it('refuses when the record was sealed while the file uploaded, and discards it', async () => {
    const path = await uploaded(PDF)
    rowsIn('environmental_permits')[0].retired_at = '2026-10-02T00:00:00Z'
    expect((await finalize.POST(jsonRequest('/x', 'POST', { ...permitFields, path, file_name: 'scan.pdf' }))).status).toBe(409)
    expect(objects.has(`ms-evidence/${path}`)).toBe(false)
  })

  it('says so when the upload never arrived', async () => {
    const res = await start({ ...permitFields, file_size: 100 })
    const { path } = await res.json()
    expect((await finalize.POST(jsonRequest('/x', 'POST', { ...permitFields, path, file_name: 'scan.pdf' }))).status).toBe(404)
  })
})
