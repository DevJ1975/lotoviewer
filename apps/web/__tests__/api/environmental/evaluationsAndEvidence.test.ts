// @vitest-environment node
//
// Compliance evaluation (clause 9.1.2) and its evidence. An evaluation
// opens, collects evidence the server hashes and stores privately, and
// closes once with a result; a file is served only if it still matches the
// hash recorded when it was filed. Node environment: FormData and File are
// the real undici ones the route receives in production.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createHash } from 'node:crypto'
import {
  ADMIN_A, FACILITY_A, MEMBER_A, TENANT_A, TENANT_B,
  asAdminB, asMemberA, beforeNext, callAs, captureExceptionMock, failNext, gateRejects, idContext, jsonRequest,
  objects, resetStore, rowsIn, seed, writes,
} from './_emsHarness'

import * as upload from '@/app/api/environmental/evidence/route'
import * as download from '@/app/api/environmental/evidence/[id]/download/route'
import * as openEvaluation from '@/app/api/environmental/obligations/[id]/evaluations/route'
import * as complete from '@/app/api/environmental/evaluations/[id]/complete/route'
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_REQUEST_BYTES } from '@/lib/environmental/evidence'

const OBLIGATION = 'b0000000-0000-4000-8000-00000000000a'
const OBLIGATION_B = 'b0000000-0000-4000-8000-00000000000b'
const EVALUATION = 'e7000000-0000-4000-8000-00000000000a'
const EVALUATION_B = 'e7000000-0000-4000-8000-00000000000b'

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

function evaluationRow(over: Record<string, unknown> = {}) {
  return {
    id: EVALUATION, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', obligation_id: OBLIGATION,
    scheduled_for: '2026-10-01', assigned_to: ADMIN_A, completed_at: null, evaluator_id: null, result: null,
    notes: null, nonconformity_id: null, ...over,
  }
}

function uploadRequest(fields: Record<string, string | File>): Request {
  const form = new FormData()
  for (const [name, value] of Object.entries(fields)) form.append(name, value)
  return new Request('https://app.test/api/environmental/evidence', { method: 'POST', body: form })
}

function evidenceFields(over: Record<string, string | File> = {}) {
  return {
    subject_type: 'compliance_evaluation', subject_id: EVALUATION, kind: 'document',
    file: new File([PDF], 'DMR Q3.pdf', { type: 'application/pdf' }), ...over,
  }
}

beforeEach(() => {
  resetStore()
  seed('compliance_calendar_obligations', [
    { id: OBLIGATION, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'ems', status: 'open', title: 'Stormwater DMRs' },
    { id: OBLIGATION_B, tenant_id: TENANT_B, facility_id: null, discipline: 'ems', status: 'open', title: 'Not yours' },
  ])
  seed('ms_compliance_evaluations', [
    evaluationRow(),
    evaluationRow({ id: EVALUATION_B, tenant_id: TENANT_B, obligation_id: OBLIGATION_B }),
  ])
  seed('tenant_memberships', [
    { tenant_id: TENANT_A, user_id: ADMIN_A, invite_cancelled_at: null },
    { tenant_id: TENANT_A, user_id: MEMBER_A, invite_cancelled_at: null },
  ])
})

describe('POST /evidence', () => {
  it('stores the file privately under the tenant, typed, named and hashed by the server', async () => {
    const res = await upload.POST(uploadRequest(evidenceFields({
      file: new File([PDF], 'site photo.jpg', { type: 'image/jpeg' }),   // declared type is a lie
    })))
    expect(res.status).toBe(201)
    const { evidence } = await res.json()
    expect(evidence).toMatchObject({
      tenant_id: TENANT_A, facility_id: FACILITY_A, subject_id: EVALUATION, kind: 'document',
      // Named for what it is: a saved download opens by its extension, not its content type.
      mime_type: 'application/pdf', file_name: 'site photo.pdf', file_size_bytes: PDF.byteLength,
      sha256: sha(PDF), uploaded_by: ADMIN_A,
    })
    expect(evidence).not.toHaveProperty('storage_path')
    const path = `${TENANT_A}/compliance_evaluation/${EVALUATION}/${sha(PDF)}.pdf`
    expect(rowsIn('ms_evidence')[0].storage_path).toBe(path)
    expect(objects.get(`ms-evidence/${path}`)).toEqual(PDF)
  })

  it('refuses a file that is not a PDF, JPEG, PNG or WebP, whatever it claims to be', async () => {
    const res = await upload.POST(uploadRequest(evidenceFields({
      file: new File(['<script>alert(1)</script>'], 'scan.pdf', { type: 'application/pdf' }),
    })))
    expect(res.status).toBe(415)
    expect(objects.size).toBe(0)
    expect(rowsIn('ms_evidence')).toEqual([])
  })

  it('refuses a file over 4 MB, which would not fit the platform\'s request limit', async () => {
    const res = await upload.POST(uploadRequest(evidenceFields({
      file: new File([new Uint8Array(MAX_EVIDENCE_BYTES + 1)], 'huge.pdf'),
    })))
    expect(res.status).toBe(413)
    expect(objects.size).toBe(0)
  })

  it('refuses an oversized request from its declared length, without reading the body', async () => {
    const formData = vi.fn()
    const oversized = { headers: new Headers({ 'content-length': String(MAX_EVIDENCE_REQUEST_BYTES + 1) }), formData } as unknown as Request
    const res = await upload.POST(oversized)
    expect(res.status).toBe(413)
    expect(formData).not.toHaveBeenCalled()
  })

  it('reports every missing field by name', async () => {
    const res = await upload.POST(uploadRequest({ subject_type: 'aspect', subject_id: 'x', kind: 'selfie' }))
    expect(res.status).toBe(400)
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field))
      .toEqual(['subject_type', 'subject_id', 'kind', 'file'])
  })

  it('lets the assignee attach, but not another member', async () => {
    asMemberA()
    expect((await upload.POST(uploadRequest(evidenceFields()))).status).toBe(403)
    seed('ms_compliance_evaluations', [evaluationRow({ id: 'e7000000-0000-4000-8000-0000000000aa', assigned_to: MEMBER_A, obligation_id: 'other' })])
    const res = await upload.POST(uploadRequest(evidenceFields({ subject_id: 'e7000000-0000-4000-8000-0000000000aa' })))
    expect(res.status).toBe(201)
  })

  it('refuses evidence for a sealed evaluation and for another tenant\'s', async () => {
    seed('ms_compliance_evaluations', [evaluationRow({
      id: 'e7000000-0000-4000-8000-0000000000cc', obligation_id: 'other', completed_at: '2026-09-01T00:00:00Z', result: 'undetermined',
    })])
    expect((await upload.POST(uploadRequest(evidenceFields({ subject_id: 'e7000000-0000-4000-8000-0000000000cc' })))).status).toBe(409)
    expect((await upload.POST(uploadRequest(evidenceFields({ subject_id: EVALUATION_B })))).status).toBe(404)
    expect(objects.size).toBe(0)
  })

  it('answers 409 for the same file twice, keeping the stored object', async () => {
    await upload.POST(uploadRequest(evidenceFields()))
    const again = await upload.POST(uploadRequest(evidenceFields()))
    expect(again.status).toBe(409)
    expect(objects.size).toBe(1)
    expect(rowsIn('ms_evidence')).toHaveLength(1)
  })

  it('removes the stored object when the row cannot be written', async () => {
    failNext('ms_evidence', { code: 'XX000', message: 'disk full' }, 'insert')
    const res = await upload.POST(uploadRequest(evidenceFields()))
    expect(res.status).toBe(500)
    expect(objects.size).toBe(0)
  })

  it('never removes a stored object that filed evidence already points to', async () => {
    const filed = (await (await upload.POST(uploadRequest(evidenceFields()))).json()).evidence
    failNext('ms_evidence', { code: 'XX000', message: 'connection reset' }, 'insert')
    expect((await upload.POST(uploadRequest(evidenceFields()))).status).toBe(500)
    expect(objects.size).toBe(1)
    expect((await download.GET(jsonRequest('/x', 'GET'), idContext(filed.id))).status).toBe(200)
  })

  it('answers 409 when the evaluation is completed while the file uploads', async () => {
    failNext('ms_evidence', { code: '23000', message: 'evaluation is complete and sealed' }, 'insert')
    const res = await upload.POST(uploadRequest(evidenceFields()))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/sealed/)
    expect(objects.size).toBe(0)
  })

  it('supersedes an earlier file on the same evaluation, once, with a reason', async () => {
    const first = (await (await upload.POST(uploadRequest(evidenceFields()))).json()).evidence

    const noReason = await upload.POST(uploadRequest(evidenceFields({
      file: new File([PNG], 'retake.png'), supersedes_id: first.id,
    })))
    expect((await noReason.json()).fieldErrors).toEqual([{ field: 'superseded_reason', message: 'is required' }])

    const res = await upload.POST(uploadRequest(evidenceFields({
      file: new File([PNG], 'retake.png'), supersedes_id: first.id, superseded_reason: 'First scan was of the wrong quarter',
    })))
    expect(res.status).toBe(201)
    const second = (await res.json()).evidence
    expect(rowsIn('ms_evidence').find(e => e.id === first.id)).toMatchObject({
      superseded_by: second.id, superseded_reason: 'First scan was of the wrong quarter',
    })

    const twice = await upload.POST(uploadRequest(evidenceFields({
      file: new File([PDF, ' '], 'third.pdf'), supersedes_id: first.id, superseded_reason: 'Again',
    })))
    expect(twice.status).toBe(409)
  })

  it('says so when someone else replaced the file first, and keeps the new one alongside', async () => {
    const first = (await (await upload.POST(uploadRequest(evidenceFields()))).json()).evidence
    beforeNext('ms_evidence', 'update', () => {
      Object.assign(rowsIn('ms_evidence').find(e => e.id === first.id)!, {
        superseded_by: 'someone-else', superseded_at: '2026-10-02T00:00:00Z', superseded_reason: 'Their reason',
      })
    })
    const res = await upload.POST(uploadRequest(evidenceFields({
      file: new File([PNG], 'retake.png'), supersedes_id: first.id, superseded_reason: 'My reason',
    })))
    expect(res.status).toBe(409)
    expect((await res.json()).evidence.file_name).toBe('retake.png')
    expect(rowsIn('ms_evidence').find(e => e.id === first.id)).toMatchObject({ superseded_reason: 'Their reason' })
  })

  it('refuses to supersede evidence that belongs to another evaluation', async () => {
    seed('ms_evidence', [{ id: 'e1de0000-0000-4000-8000-000000000001', tenant_id: TENANT_A, subject_type: 'compliance_evaluation', subject_id: 'elsewhere', superseded_by: null }])
    const res = await upload.POST(uploadRequest(evidenceFields({
      supersedes_id: 'e1de0000-0000-4000-8000-000000000001', superseded_reason: 'x',
    })))
    expect((await res.json()).fieldErrors).toEqual([{ field: 'supersedes_id', message: 'is not evidence on this evaluation' }])
  })

  it('passes gate failures through', async () => {
    gateRejects(401, 'Invalid session')
    expect((await upload.POST(uploadRequest(evidenceFields()))).status).toBe(401)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'owner', moduleOn: false })
    expect((await upload.POST(uploadRequest(evidenceFields()))).status).toBe(403)
  })
})

describe('GET /evidence/[id]/download', () => {
  let evidenceId: string
  const path = () => `ms-evidence/${rowsIn('ms_evidence')[0].storage_path}`

  beforeEach(async () => {
    evidenceId = (await (await upload.POST(uploadRequest(evidenceFields()))).json()).evidence.id
  })

  it('serves the file with its hash once the bytes check out', async () => {
    asMemberA()
    const res = await download.GET(jsonRequest('/x', 'GET'), idContext(evidenceId))
    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF)
    expect(Object.fromEntries(res.headers)).toMatchObject({
      'content-type': 'application/pdf',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'x-evidence-sha256': sha(PDF),
    })
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="DMR Q3\.pdf"/)
  })

  it('refuses to serve a file that no longer matches its hash, and reports it', async () => {
    const tampered = new Uint8Array(PDF)
    tampered[10] ^= 0xff
    objects.set(path(), tampered)
    const res = await download.GET(jsonRequest('/x', 'GET'), idContext(evidenceId))
    expect(res.status).toBe(409)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(captureExceptionMock).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ level: 'fatal' }))
  })

  it('answers 404 to another tenant, and a generic error when the object is gone', async () => {
    asAdminB()
    expect((await download.GET(jsonRequest('/x', 'GET'), idContext(evidenceId))).status).toBe(404)
    callAs({ userId: ADMIN_A, tenantId: TENANT_A, role: 'admin' })
    objects.clear()
    const res = await download.GET(jsonRequest('/x', 'GET'), idContext(evidenceId))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
  })
})

describe('POST /obligations/[id]/evaluations', () => {
  const OPEN_FREE = 'b0000000-0000-4000-8000-0000000000f1'

  beforeEach(() => {
    seed('compliance_calendar_obligations', [
      { id: OPEN_FREE, tenant_id: TENANT_A, facility_id: FACILITY_A, discipline: 'integrated', status: 'open', title: 'Air permit' },
    ])
  })

  it('opens an evaluation today, assigned to the caller, on the obligation\'s facility and discipline', async () => {
    const res = await openEvaluation.POST(jsonRequest('/x', 'POST', {}), idContext(OPEN_FREE))
    expect(res.status).toBe(201)
    expect((await res.json()).evaluation).toMatchObject({
      tenant_id: TENANT_A, obligation_id: OPEN_FREE, facility_id: FACILITY_A, discipline: 'integrated',
      assigned_to: ADMIN_A, created_by: ADMIN_A, scheduled_for: new Date().toISOString().slice(0, 10),
    })
  })

  it('assigns it to a member of the organization, and no one else', async () => {
    expect((await openEvaluation.POST(jsonRequest('/x', 'POST', { assigned_to: MEMBER_A }), idContext(OPEN_FREE))).status).toBe(201)
    const outsider = await openEvaluation.POST(
      jsonRequest('/x', 'POST', { assigned_to: '00000000-0000-4000-8000-0000000000ff' }), idContext(OBLIGATION))
    expect((await outsider.json()).fieldErrors).toEqual([{ field: 'assigned_to', message: 'is not a member of this organization' }])
  })

  it('answers 409 while another evaluation of the obligation is open, or once it is dismissed', async () => {
    expect((await openEvaluation.POST(jsonRequest('/x', 'POST', {}), idContext(OBLIGATION))).status).toBe(409)
    seed('compliance_calendar_obligations', [
      { id: 'b0000000-0000-4000-8000-0000000000d1', tenant_id: TENANT_A, discipline: 'ems', status: 'dismissed' },
    ])
    expect((await openEvaluation.POST(jsonRequest('/x', 'POST', {}), idContext('b0000000-0000-4000-8000-0000000000d1'))).status).toBe(409)
  })

  it('answers 404 for another tenant\'s obligation and refuses a member', async () => {
    expect((await openEvaluation.POST(jsonRequest('/x', 'POST', {}), idContext(OBLIGATION_B))).status).toBe(404)
    asMemberA()
    expect((await openEvaluation.POST(jsonRequest('/x', 'POST', {}), idContext(OPEN_FREE))).status).toBe(403)
    expect(writes).toEqual([])
  })
})

describe('POST /evaluations/[id]/complete', () => {
  const close = (body: unknown, id = EVALUATION) => complete.POST(jsonRequest('/x', 'POST', body), idContext(id))
  const attach = () => upload.POST(uploadRequest(evidenceFields()))

  it('will not close as compliant without evidence', async () => {
    const res = await close({ result: 'compliant' })
    expect(res.status).toBe(422)
    expect((await res.json()).gaps).toEqual(['evidence_required'])
    expect(rowsIn('ms_compliance_evaluations')[0]).toMatchObject({ completed_at: null })
  })

  it('closes as compliant once evidence is attached, recording who and when', async () => {
    await attach()
    const res = await close({ result: 'compliant', notes: 'All four DMRs filed on time' })
    expect(res.status).toBe(200)
    expect((await res.json()).evaluation).toMatchObject({
      result: 'compliant', evaluator_id: ADMIN_A, completed_at: expect.any(String), nonconformity_id: null,
    })
  })

  it('does not count superseded evidence', async () => {
    seed('ms_evidence', [{
      id: 'gone', tenant_id: TENANT_A, subject_type: 'compliance_evaluation', subject_id: EVALUATION, superseded_by: 'x',
    }])
    expect((await close({ result: 'compliant' })).status).toBe(422)
  })

  it('closes as not applicable only with notes saying why', async () => {
    expect((await (await close({ result: 'not_applicable' })).json()).gaps).toEqual(['notes_required'])
    expect((await close({ result: 'not_applicable', notes: 'Outfall sealed in 2025' })).status).toBe(200)
  })

  it('opens a linked nonconformity for a noncompliant result', async () => {
    await attach()
    expect((await close({ result: 'noncompliant' })).status).toBe(400)

    const res = await close({
      result: 'noncompliant', nonconformity: { title: 'Q2 DMR filed late', classification: 'major' },
    })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(rowsIn('nonconformities')).toEqual([expect.objectContaining({
      id: body.nonconformity.id, tenant_id: TENANT_A, facility_id: FACILITY_A, title: 'Q2 DMR filed late',
      classification: 'major', source_type: 'compliance', source_reference: OBLIGATION, clause_ref: '9.1.2',
      identified_by: ADMIN_A,
    })])
    expect(body.evaluation.nonconformity_id).toBe(body.nonconformity.id)
  })

  it('refuses an unknown result and a malformed nonconformity, by field', async () => {
    expect((await (await close({ result: 'mostly' })).json()).fieldErrors).toEqual([
      { field: 'result', message: 'must be one of compliant, noncompliant, not_applicable, undetermined' },
    ])
    const res = await close({ result: 'noncompliant', nonconformity: { title: '', classification: 'grave' } })
    expect((await res.json()).fieldErrors.map((e: { field: string }) => e.field))
      .toEqual(['nonconformity.title', 'nonconformity.classification'])
  })

  it('lets the assignee close it, but not another member', async () => {
    asMemberA()
    expect((await close({ result: 'undetermined' })).status).toBe(403)
    rowsIn('ms_compliance_evaluations')[0].assigned_to = MEMBER_A
    expect((await close({ result: 'undetermined' })).status).toBe(200)
  })

  it('answers 409 once sealed and 404 for another tenant\'s evaluation', async () => {
    await close({ result: 'undetermined' })
    expect((await close({ result: 'undetermined' })).status).toBe(409)
    expect((await close({ result: 'undetermined' }, EVALUATION_B)).status).toBe(404)
  })

  it('takes the nonconformity back when someone else closes the evaluation first', async () => {
    await attach()
    beforeNext('ms_compliance_evaluations', 'update', () => {
      rowsIn('ms_compliance_evaluations')[0].completed_at = '2026-10-01T00:00:00Z'
    })
    const res = await close({ result: 'noncompliant', nonconformity: { title: 'Late filing' } })
    expect(res.status).toBe(409)
    expect(rowsIn('nonconformities')).toEqual([])
  })

  it('takes the nonconformity back when the database refuses the close', async () => {
    await attach()
    failNext('ms_compliance_evaluations', { code: '23514', message: 'cannot close without evidence' }, 'update')
    const res = await close({ result: 'noncompliant', nonconformity: { title: 'Late filing' } })
    expect(res.status).toBe(422)
    expect(rowsIn('nonconformities')).toEqual([])
  })
})
