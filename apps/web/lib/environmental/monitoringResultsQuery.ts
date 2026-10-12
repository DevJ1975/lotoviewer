import { isRealDate, UUID_PATTERN } from '@soteria/core/environmental/validation'

// What the results list may be asked: validated before any of it reaches a query. The cursor
// goes into a PostgREST filter string, so it is taken apart and checked piece by piece rather
// than passed through.

export const DEFAULT_PAGE_SIZE = 50
export const MAX_PAGE_SIZE = 200

export interface ResultsCursor {
  sampledAt: string
  id:        string
}

export type ResultsQuery =
  | {
      ok:         true
      facilityId: string | null
      outfallId:  string | null
      parameter:  string | null
      /** First and last day (YYYY-MM-DD, inclusive) to list. */
      from:       string | null
      to:         string | null
      pageSize:   number
      cursor:     ResultsCursor | null
    }
  | { ok: false; errors: string[] }

// What Postgres sends for a timestamptz: a date, a time (microseconds at most) and an offset.
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2}))\|([0-9a-f-]{36})$/i

export function parseResultsQuery(params: URLSearchParams): ResultsQuery {
  const errors: string[] = []
  const get = (key: string) => params.get(key)?.trim() || null

  const id = (key: string): string | null => {
    const value = get(key)
    if (value === null) return null
    if (UUID_PATTERN.test(value)) return value.toLowerCase()
    errors.push(`${key} must be an id.`)
    return null
  }
  const day = (key: string): string | null => {
    const value = get(key)
    if (value === null) return null
    if (isRealDate(value)) return value
    errors.push(`${key} must be a date such as 2026-07-01.`)
    return null
  }

  const facilityId = id('facility_id')
  const outfallId = id('outfall_id')
  const from = day('from')
  const to = day('to')
  if (from && to && to < from) errors.push('to cannot be before from.')

  const parameter = get('parameter')
  if (parameter !== null && parameter.length > 80) errors.push('parameter is too long (the limit is 80 characters).')

  let pageSize = DEFAULT_PAGE_SIZE
  const rawSize = get('limit')
  if (rawSize !== null) {
    const size = Number(rawSize)
    if (Number.isInteger(size) && size >= 1 && size <= MAX_PAGE_SIZE) pageSize = size
    else errors.push(`limit must be a whole number from 1 to ${MAX_PAGE_SIZE}.`)
  }

  let cursor: ResultsCursor | null = null
  const rawCursor = get('cursor')
  if (rawCursor !== null) {
    const match = CURSOR.exec(rawCursor)
    if (match && UUID_PATTERN.test(match[2]!) && !Number.isNaN(Date.parse(match[1]!))) cursor = { sampledAt: match[1]!, id: match[2]!.toLowerCase() }
    else errors.push('cursor is not one this list gave out.')
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, facilityId, outfallId, parameter, from, to, pageSize, cursor }
}
