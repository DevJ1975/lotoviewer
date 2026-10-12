import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

// A cron route that is not in vercel.json never fires: it deploys, passes
// review, and sits idle. /api/cron/hazard-hunt-generate shipped that way and
// scheduled Hazard Hunts silently never generated. Nothing failed, so nothing
// said so. This pins the registry against the route tree in both directions.

const WEB_ROOT   = path.resolve(__dirname, '../../..')
const CRON_DIR   = path.join(WEB_ROOT, 'app/api/cron')
const VERCEL_CFG = path.join(WEB_ROOT, 'vercel.json')

// Crons that are deliberately invoked by hand (Superadmin -> Run now) and must
// stay off the schedule. Each needs a reason; "nobody got to it" is not one.
const MANUAL_ONLY: Record<string, string> = {
  '/api/cron/sds-library-seed-drip':
    'autonomous AI spend stays opt-in; an operator drains a seed run via Run now',
  '/api/cron/sds-library-verify':
    'kept opt-in alongside the seed drip; an operator runs it via Run now',
  '/api/cron/strike-recurring-assignments':
    'dormant: nothing writes strike_assignments.recurrence_rule yet, so there is nothing to advance. Schedule it when recurring assignments ship',
}

function scheduledPaths(): string[] {
  const config = JSON.parse(readFileSync(VERCEL_CFG, 'utf8')) as { crons?: { path: string }[] }
  return (config.crons ?? []).map(cron => cron.path)
}

function routePaths(): string[] {
  return readdirSync(CRON_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(path.join(CRON_DIR, entry.name, 'route.ts')))
    .map(entry => `/api/cron/${entry.name}`)
}

describe('vercel.json cron registry', () => {
  const scheduled = scheduledPaths()
  const routes    = routePaths()

  it('schedules every cron route unless it is documented as manual-only', () => {
    const unscheduled = routes.filter(route => !scheduled.includes(route) && !(route in MANUAL_ONLY))
    expect(
      unscheduled,
      `Cron route(s) with no schedule: add each to apps/web/vercel.json "crons", or to MANUAL_ONLY with a reason.`,
    ).toEqual([])
  })

  it('has a route behind every scheduled path', () => {
    const dangling = scheduled.filter(scheduledPath => !routes.includes(scheduledPath))
    expect(
      dangling,
      `vercel.json schedules path(s) with no apps/web/app/api/cron/<name>/route.ts: a typo here 404s on every tick.`,
    ).toEqual([])
  })

  it('does not schedule the same path twice', () => {
    const duplicates = scheduled.filter((scheduledPath, index) => scheduled.indexOf(scheduledPath) !== index)
    expect(duplicates, 'Duplicate vercel.json cron path(s) run the job once per entry.').toEqual([])
  })

  it('keeps MANUAL_ONLY honest: every entry is a real route and is not also scheduled', () => {
    const stale = Object.keys(MANUAL_ONLY).filter(manualPath => !routes.includes(manualPath) || scheduled.includes(manualPath))
    expect(
      stale,
      `MANUAL_ONLY entr(ies) that no longer apply: remove them (the route is gone, or it is now scheduled).`,
    ).toEqual([])
  })
})
