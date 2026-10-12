import { sanitizeError } from '@/lib/security/sanitizeError'
import { invalid, PG_FOREIGN_KEY_VIOLATION, PG_UNIQUE_VIOLATION } from './http'
import { OUTFALL_AT_SITE, PERMIT_AT_SITE } from './monitoringReferences'

// How the monitoring routes answer when the database refuses a write. Postgres names the
// constraint that failed, so the caller hears which field was wrong instead of a blanket
// failure, and nothing from the database itself (table, column, value) reaches the response.

const PG_CHECK_VIOLATION = '23514'
const PG_INSUFFICIENT_PRIVILEGE = '42501'

/** A database error carried out of a function that does not own the response. */
export class DatabaseError extends Error {
  constructor(readonly code: string | undefined, message: string) {
    super(message)
  }
}

// Constraint names are the ones migration 318 gives, or the default names Postgres derives.
const FOREIGN_KEY_MESSAGES: ReadonlyArray<readonly [constraint: string, message: string]> = [
  ['monitoring_limits_outfall_fk',  OUTFALL_AT_SITE],
  ['monitoring_results_outfall_fk', OUTFALL_AT_SITE],
  ['monitoring_limits_permit_fk',   PERMIT_AT_SITE],
  ['facility_id',                   'facility_id must be a site in this account.'],
]

const CHECK_MESSAGES: ReadonlyArray<readonly [constraint: string, message: string]> = [
  ['evidence_in_tenant_folder', 'evidence_id must be a file you uploaded to this account.'],
  ['dates_ordered',             'effective_to cannot be before effective_from.'],
  ['_value_check',              'value must be zero or more.'],
]

const messageFor = (table: ReadonlyArray<readonly [string, string]>, databaseMessage: string): string | undefined =>
  table.find(([constraint]) => databaseMessage.includes(constraint))?.[1]

export function databaseFailure(error: unknown, route: string): Response {
  const { code, message } = error as { code?: string; message?: string }
  const databaseMessage = typeof message === 'string' ? message : ''

  switch (code) {
    case PG_FOREIGN_KEY_VIOLATION: {
      const field = messageFor(FOREIGN_KEY_MESSAGES, databaseMessage)
      return field
        ? invalid([field])
        : Response.json({ error: 'invalid_reference', details: ['facility_id, outfall_id or permit_id points at something that does not exist.'] }, { status: 400 })
    }
    case PG_CHECK_VIOLATION:
      return invalid([messageFor(CHECK_MESSAGES, databaseMessage) ?? 'One of the values is not allowed. Check each field and try again.'])
    case PG_UNIQUE_VIOLATION:
      return databaseMessage.includes('uq_monitoring_limits_library')
        ? Response.json({ error: 'duplicate_library_limit', details: ['That draft limit has already been adopted here.'] }, { status: 409 })
        : Response.json({ error: 'conflict' }, { status: 409 })
    case PG_INSUFFICIENT_PRIVILEGE:
      return Response.json({ error: 'forbidden', details: ['You do not have permission to do that.'] }, { status: 403 })
    default:
      return sanitizeError(error, route)
  }
}
