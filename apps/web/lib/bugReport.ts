// Pure types + validation for the support / bug-report form. The send
// path lives in app/api/support/bug-report — this file is what the
// page and the API route share.

export type BugSeverity = 'low' | 'medium' | 'high' | 'critical'

export const SEVERITY_LABELS: Record<BugSeverity, string> = {
  low:      'Low — minor inconvenience',
  medium:   'Medium — feature works but with friction',
  high:     'High — blocking my workflow',
  critical: 'Critical — safety / compliance impact',
}

// What the form posts to /api/support/bug-report. Auto-captured fields
// (page_url, user_agent) come from the browser; the API route fills in
// reporter_email + reporter_name from the authenticated session so the
// client can't spoof them.
export interface BugReportPayload {
  title:           string
  description:     string
  severity:        BugSeverity
  steps?:          string
  page_url?:       string
  user_agent?:     string
}

// Validation result. Empty array means valid; non-empty means at least
// one field has a problem the user has to fix.
export function validateBugReport(p: Partial<BugReportPayload>): string[] {
  const errs: string[] = []
  const title = (p.title ?? '').trim()
  const desc  = (p.description ?? '').trim()

  if (title.length === 0)        errs.push('Title is required.')
  else if (title.length > 200)   errs.push('Title must be 200 characters or fewer.')

  if (desc.length === 0)         errs.push('Description is required.')
  else if (desc.length < 10)     errs.push('Description should be at least a sentence (10+ characters).')
  else if (desc.length > 10_000) errs.push('Description is too long (max 10,000 characters).')

  if (p.severity && !isValidSeverity(p.severity)) {
    errs.push('Severity must be one of low / medium / high / critical.')
  }

  return errs
}

export function isValidSeverity(s: unknown): s is BugSeverity {
  return s === 'low' || s === 'medium' || s === 'high' || s === 'critical'
}

// Render a clean text-only email body. The API route also generates an
// HTML version (see route.ts) but the plain text version is the source
// of truth for content — easier to test than HTML strings, and Resend's
// `text` field is what email clients without HTML support fall back to.
export function renderBugReportText(args: {
  payload:        BugReportPayload
  reporter_email: string | null
  reporter_name:  string | null
  submitted_at:   string  // ISO timestamp
}): string {
  const { payload, reporter_email, reporter_name, submitted_at } = args
  const lines: string[] = []
  lines.push(`Severity: ${payload.severity}`)
  lines.push(`Title: ${payload.title.trim()}`)
  lines.push('')
  lines.push('Description:')
  lines.push(payload.description.trim())
  lines.push('')
  if (payload.steps && payload.steps.trim()) {
    lines.push('Steps to reproduce:')
    lines.push(payload.steps.trim())
    lines.push('')
  }
  lines.push('— Context —')
  lines.push(`Reporter: ${reporter_name ?? '(unknown)'} <${reporter_email ?? 'unknown'}>`)
  lines.push(`Submitted: ${submitted_at}`)
  if (payload.page_url)   lines.push(`Page URL: ${payload.page_url}`)
  if (payload.user_agent) lines.push(`User agent: ${payload.user_agent}`)
  return lines.join('\n')
}
