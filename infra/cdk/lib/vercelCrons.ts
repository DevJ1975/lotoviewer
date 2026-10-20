import { readFileSync } from 'node:fs'

// vercel.json stays the single source of truth for cron schedules: the AWS
// stack reads it at synth time, so a schedule added for Vercel is scheduled
// on AWS by the next deploy instead of being silently missing.

export interface CronJob {
  path: string
  /** EventBridge expression, e.g. `cron(0/5 * * * ? *)`. Always UTC, like Vercel. */
  schedule: string
}

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/**
 * Converts a 5-field Unix cron expression (Vercel's format) to EventBridge's
 * 6-field format. Throws on anything outside the supported subset so a
 * schedule can never be mistranslated quietly.
 */
export function toEventBridgeCron(expression: string): string {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) {
    throw new Error(`Expected 5 cron fields, got ${fields.length}: "${expression}"`)
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields

  // EventBridge requires exactly one of the two day fields to be `?`. Unix
  // cron ORs them when both are set; EventBridge cannot express that.
  if (dayOfMonth !== '*' && dayOfWeek !== '*') {
    throw new Error(`Cannot restrict both day-of-month and day-of-week: "${expression}"`)
  }
  const ebDayOfMonth = dayOfWeek === '*' ? convertStep(dayOfMonth, 1) : '?'
  const ebDayOfWeek  = dayOfWeek === '*' ? '?' : convertDayOfWeek(dayOfWeek)

  return `cron(${convertStep(minute, 0)} ${convertStep(hour, 0)} ${ebDayOfMonth} ${convertStep(month, 1)} ${ebDayOfWeek} *)`
}

// `*/n` means "every n starting at the field's minimum". EventBridge spells
// that `min/n`; its documentation only defines `/` with an explicit start.
function convertStep(field: string, fieldMinimum: number): string {
  if (/^[\d,*-]+$/.test(field)) return field
  const step = /^\*\/(\d+)$/.exec(field)
  if (step) return `${fieldMinimum}/${step[1]}`
  throw new Error(`Unsupported cron field "${field}"`)
}

// Unix numbers Sunday 0 (or 7); EventBridge numbers it 1. Names sidestep the
// off-by-one entirely.
function convertDayOfWeek(field: string): string {
  return field
    .split(',')
    .map(part => part.split('-').map(dayName).join('-'))
    .join(',')
}

function dayName(token: string): string {
  if (!/^[0-7]$/.test(token)) throw new Error(`Unsupported day-of-week "${token}"`)
  return DAY_NAMES[Number(token)]
}

export function loadVercelCrons(vercelJsonPath: string): CronJob[] {
  const config = JSON.parse(readFileSync(vercelJsonPath, 'utf8')) as {
    crons?: { path: string; schedule: string }[]
  }
  return (config.crons ?? []).map(({ path, schedule }) => {
    if (!path.startsWith('/api/cron/')) {
      throw new Error(`Cron path must live under /api/cron/: "${path}"`)
    }
    return { path, schedule: toEventBridgeCron(schedule) }
  })
}
