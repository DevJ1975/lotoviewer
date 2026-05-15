import { describe, it, expect } from 'vitest'
import {
  equipmentEditedStatement,
  equipmentViewedStatement,
  mboxAgent,
  photoUploadedStatement,
  photoValidatedStatement,
  reviewSignedStatement,
  reviewerAgent,
} from '@/lib/xapi/statements'
import { Verbs } from '@/lib/xapi/verbs'

const STATEMENT_ID = '00000000-0000-4000-8000-000000000001'
const TIMESTAMP    = '2026-05-15T12:00:00.000Z'
const ACTOR        = mboxAgent('alex@example.com', 'Alex Worker')

describe('mboxAgent', () => {
  it('builds a spec-conformant Agent with mbox prefix', () => {
    expect(ACTOR).toEqual({
      objectType: 'Agent',
      name: 'Alex Worker',
      mbox: 'mailto:alex@example.com',
    })
  })

  it('omits name when not provided', () => {
    expect(mboxAgent('user@example.com')).toEqual({
      objectType: 'Agent',
      mbox: 'mailto:user@example.com',
    })
  })
})

describe('reviewerAgent', () => {
  it('builds an account-based Agent for portal sign-offs', () => {
    const a = reviewerAgent('Pat Reviewer', 'Maintenance')
    expect(a.objectType).toBe('Agent')
    expect(a.name).toBe('Pat Reviewer')
    expect(a.account).toEqual({
      homePage: 'https://soteria.field/xapi/accounts/reviewers',
      name:     'Maintenance:Pat Reviewer',
    })
    expect(a.mbox).toBeUndefined()
  })
})

describe('reviewSignedStatement', () => {
  const REVIEW_ID = '11111111-1111-4111-8111-111111111111'

  it('emits a completed verb with the review-as-Activity object', () => {
    const s = reviewSignedStatement({
      statementId:  STATEMENT_ID,
      timestamp:    TIMESTAMP,
      actor:        ACTOR,
      department:   'Maintenance',
      reviewId:     REVIEW_ID,
      approved:     true,
      notesPresent: true,
    })
    expect(s.id).toBe(STATEMENT_ID)
    expect(s.timestamp).toBe(TIMESTAMP)
    expect(s.verb).toBe(Verbs.completed)
    expect(s.object.id).toContain(REVIEW_ID)
    expect(s.object.definition?.name).toEqual({ 'en-US': 'LOTO review — Maintenance' })
    expect(s.result).toEqual({ completion: true, success: true, response: 'with-notes' })
    expect(s.context?.extensions?.['https://soteria.field/xapi/ext/department']).toBe('Maintenance')
  })

  it('marks success=false when the reviewer did not approve', () => {
    const s = reviewSignedStatement({
      statementId:  STATEMENT_ID,
      timestamp:    TIMESTAMP,
      actor:        ACTOR,
      department:   'Maintenance',
      reviewId:     REVIEW_ID,
      approved:     false,
      notesPresent: false,
    })
    expect(s.result?.success).toBe(false)
    expect(s.result?.response).toBe('no-notes')
  })
})

describe('photoUploadedStatement', () => {
  it('uses the interacted verb and qualifies the activity by slot', () => {
    const s = photoUploadedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
      slot:        'placard',
      byteSize:    98_765,
    })
    expect(s.verb).toBe(Verbs.interacted)
    expect(s.object.id).toMatch(/equipment\/EQ-42\/photos\/placard$/)
    expect(s.result?.extensions?.['https://soteria.field/xapi/ext/byte-size']).toBe(98_765)
  })

  it('omits result entirely when byteSize is absent', () => {
    const s = photoUploadedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
      slot:        'placard',
    })
    expect(s.result).toBeUndefined()
  })
})

describe('photoValidatedStatement', () => {
  it('uses validated verb when the photo passed', () => {
    const s = photoValidatedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
      slot:        'placard',
      passed:      true,
    })
    expect(s.verb).toBe(Verbs.validated)
    expect(s.result?.success).toBe(true)
    expect(s.result?.response).toBeUndefined()
  })

  it('uses rejected verb with reason when the photo failed', () => {
    const s = photoValidatedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
      slot:        'placard',
      passed:      false,
      reason:      'no placard visible',
    })
    expect(s.verb).toBe(Verbs.rejected)
    expect(s.result).toEqual({ success: false, response: 'no placard visible' })
  })
})

describe('equipmentViewedStatement', () => {
  it('uses experienced verb and labels by equipment description', () => {
    const s = equipmentViewedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
      name:        'Air compressor',
      department:  'Utilities',
    })
    expect(s.verb).toBe(Verbs.experienced)
    expect(s.object.definition?.name).toEqual({ 'en-US': 'Air compressor' })
    expect(s.context?.extensions?.['https://soteria.field/xapi/ext/department']).toBe('Utilities')
  })

  it('falls back to equipment id when no description is supplied', () => {
    const s = equipmentViewedStatement({
      statementId: STATEMENT_ID,
      timestamp:   TIMESTAMP,
      actor:       ACTOR,
      equipmentId: 'EQ-42',
    })
    expect(s.object.definition?.name).toEqual({ 'en-US': 'EQ-42' })
    expect(s.context?.extensions).toBeUndefined()
  })
})

describe('equipmentEditedStatement', () => {
  it('uses updated verb and lists changed fields in the result extension', () => {
    const s = equipmentEditedStatement({
      statementId:   STATEMENT_ID,
      timestamp:     TIMESTAMP,
      actor:         ACTOR,
      equipmentId:   'EQ-42',
      fieldsChanged: ['description', 'notes'],
    })
    expect(s.verb).toBe(Verbs.updated)
    expect(s.result?.extensions?.['https://soteria.field/xapi/ext/fields-changed'])
      .toEqual(['description', 'notes'])
  })
})
