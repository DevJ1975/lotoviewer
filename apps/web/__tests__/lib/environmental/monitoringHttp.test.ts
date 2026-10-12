import { describe, it, expect, vi, beforeEach } from 'vitest'

// The sanitizer reports to Sentry; here it only records what it was given and answers 500.
const sanitized = vi.hoisted(() => ({ calls: [] as Array<{ error: unknown; route: string }> }))
vi.mock('@/lib/security/sanitizeError', () => ({
  sanitizeError: (error: unknown, route: string) => { sanitized.calls.push({ error, route }); return Response.json({ error: 'internal' }, { status: 500 }) },
}))

import { DatabaseError, databaseFailure } from '@/lib/environmental/monitoringHttp'

const fail = (code: string | undefined, message: string) => databaseFailure({ code, message }, 'test route')
const read = async (res: Response) => ({ status: res.status, body: await res.json() as { error: string; details?: string[] } })

beforeEach(() => { sanitized.calls.length = 0 })

describe('databaseFailure', () => {
  describe('23503, a reference that does not hold', () => {
    const violation = (constraint: string) => `insert or update on table "monitoring_x" violates foreign key constraint "${constraint}"`

    it('names the outfall when the same-site key on outfalls refused it, from either table', async () => {
      for (const constraint of ['monitoring_limits_outfall_fk', 'monitoring_results_outfall_fk']) {
        expect(await read(fail('23503', violation(constraint)))).toEqual({ status: 400, body: { error: 'invalid', details: ['outfall_id must be an outfall at this site.'] } })
      }
    })

    it('names the permit when the same-site key on the permit vault refused it', async () => {
      expect(await read(fail('23503', violation('monitoring_limits_permit_fk')))).toEqual({
        status: 400, body: { error: 'invalid', details: ['permit_id must be a permit at this site.'] },
      })
    })

    it('names the site when the site key refused it', async () => {
      expect(await read(fail('23503', violation('monitoring_results_tenant_id_facility_id_fkey')))).toEqual({
        status: 400, body: { error: 'invalid', details: ['facility_id must be a site in this account.'] },
      })
    })

    it('answers a 400 that names every candidate when the database names none', async () => {
      const { status, body } = await read(fail('23503', 'a foreign key failed'))
      expect(status).toBe(400)
      expect(body.error).toBe('invalid_reference')
      expect(body.details?.[0]).toMatch(/facility_id, outfall_id or permit_id/)
    })
  })

  describe('23514, a rule the table holds', () => {
    const violation = (constraint: string) => `new row for relation "monitoring_x" violates check constraint "${constraint}"`

    it('says what is wrong with the evidence file, the dates or the value', async () => {
      expect((await read(fail('23514', violation('monitoring_results_evidence_in_tenant_folder')))).body.details).toEqual(['evidence_id must be a file you uploaded to this account.'])
      expect((await read(fail('23514', violation('monitoring_limits_dates_ordered')))).body.details).toEqual(['effective_to cannot be before effective_from.'])
      expect((await read(fail('23514', violation('monitoring_results_value_check')))).body.details).toEqual(['value must be zero or more.'])
      expect((await read(fail('23514', violation('monitoring_limits_value_check')))).body.details).toEqual(['value must be zero or more.'])
    })

    it('says something useful, and nothing from the database, when it does not know the rule', async () => {
      const { status, body } = await read(fail('23514', violation('monitoring_limits_some_other_check')))
      expect(status).toBe(400)
      expect(body).toEqual({ error: 'invalid', details: ['One of the values is not allowed. Check each field and try again.'] })
    })
  })

  describe('23505, something already there', () => {
    it('answers 409 and says a draft limit is already adopted', async () => {
      expect(await read(fail('23505', 'duplicate key value violates unique constraint "uq_monitoring_limits_library"'))).toEqual({
        status: 409, body: { error: 'duplicate_library_limit', details: ['That draft limit has already been adopted here.'] },
      })
    })

    it('answers a plain 409 for any other conflict', async () => {
      expect(await read(fail('23505', 'duplicate key value violates unique constraint "x"'))).toEqual({ status: 409, body: { error: 'conflict' } })
    })
  })

  it('answers 403 for 42501, a row-level security refusal', async () => {
    expect(await read(fail('42501', 'new row violates row-level security policy for table "monitoring_results"'))).toEqual({
      status: 403, body: { error: 'forbidden', details: ['You do not have permission to do that.'] },
    })
  })

  describe('never leaks the database', () => {
    const MESSAGES = [
      'insert or update on table "monitoring_results" violates foreign key constraint "monitoring_results_outfall_fk"',
      'new row for relation "monitoring_results" violates check constraint "monitoring_results_value_check"',
      'duplicate key value violates unique constraint "uq_monitoring_limits_library"',
      'new row violates row-level security policy for table "monitoring_results"',
      'relation "monitoring_results" does not exist',
    ]
    it('puts no table, constraint or SQL text in any answer', async () => {
      for (const code of ['23503', '23514', '23505', '42501', '42P01', undefined]) {
        for (const message of MESSAGES) {
          const text = JSON.stringify((await read(fail(code, message))).body)
          expect(text, `${code}: ${message}`).not.toMatch(/monitoring_|violates|relation|constraint|policy/i)
        }
      }
    })
  })

  it('hands any other error to the sanitizer with the route, and answers 500', async () => {
    const error = { code: '42P01', message: 'relation "monitoring_results" does not exist' }
    const res = databaseFailure(error, 'GET /somewhere')
    expect(res.status).toBe(500)
    expect(sanitized.calls).toEqual([{ error, route: 'GET /somewhere' }])
  })

  it('treats a thrown Error with no code like any other unknown failure', () => {
    expect(databaseFailure(new Error('boom'), 'r').status).toBe(500)
  })

  it('reads the code off a DatabaseError that was thrown out of a helper', async () => {
    expect(await read(databaseFailure(new DatabaseError('42501', 'denied'), 'r'))).toMatchObject({ status: 403 })
  })
})
