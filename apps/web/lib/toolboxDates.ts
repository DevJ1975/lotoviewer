export const DEFAULT_TOOLBOX_TIME_ZONE = 'America/Los_Angeles'

export function tenantTimeZone(settings: Record<string, unknown> | null | undefined): string {
  const candidate = settings?.toolbox_time_zone ?? settings?.time_zone ?? settings?.timezone
  if (typeof candidate === 'string' && isValidTimeZone(candidate)) return candidate
  const fallback = process.env.DEFAULT_TENANT_TIME_ZONE || DEFAULT_TOOLBOX_TIME_ZONE
  return isValidTimeZone(fallback) ? fallback : DEFAULT_TOOLBOX_TIME_ZONE
}

export function localDateString(now: Date = new Date(), timeZone = DEFAULT_TOOLBOX_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: isValidTimeZone(timeZone) ? timeZone : DEFAULT_TOOLBOX_TIME_ZONE,
    year:  'numeric',
    month: '2-digit',
    day:   '2-digit',
  }).formatToParts(now)

  const year  = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day   = parts.find(part => part.type === 'day')?.value
  if (!year || !month || !day) throw new Error('Unable to resolve local toolbox date')
  return `${year}-${month}-${day}`
}

export function addDaysToDateString(date: string, days: number): string {
  const base = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(base.getTime())) throw new Error(`Invalid date: ${date}`)
  base.setUTCDate(base.getUTCDate() + days)
  return base.toISOString().slice(0, 10)
}

export function dateWindow(startDate: string, days: number): string[] {
  if (!Number.isInteger(days) || days < 1) return []
  return Array.from({ length: days }, (_, index) => addDaysToDateString(startDate, index))
}

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0))
    return true
  } catch {
    return false
  }
}
