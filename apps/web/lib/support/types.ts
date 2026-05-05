// Shared types for the AI support assistant. The chat route, the widget,
// and the unit tests all import from here.
//
// The DB shape is the source of truth (migration 045) — these are the
// in-memory representations the API route hands to the model and emits to
// the client.

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool'

export interface ChatMessage {
  role:    ChatRole
  content: string
}

export type EscalationReason = 'user_requested' | 'low_confidence' | 'safety_critical'

export const ESCALATION_REASONS: readonly EscalationReason[] = [
  'user_requested', 'low_confidence', 'safety_critical',
] as const

export function isEscalationReason(s: unknown): s is EscalationReason {
  return s === 'user_requested' || s === 'low_confidence' || s === 'safety_critical'
}

// Tool input from the model when it decides to escalate. Validated before
// we touch the DB or send the email.
export interface CreateTicketInput {
  subject: string
  summary: string
  reason:  EscalationReason
}

export interface CreateTicketValidationError {
  field:  keyof CreateTicketInput
  reason: string
}

export function validateCreateTicketInput(
  raw: Partial<CreateTicketInput> | null | undefined,
): CreateTicketValidationError[] {
  const errs: CreateTicketValidationError[] = []
  if (!raw || typeof raw !== 'object') {
    return [{ field: 'subject', reason: 'Tool input was empty.' }]
  }
  const subject = typeof raw.subject === 'string' ? raw.subject.trim() : ''
  const summary = typeof raw.summary === 'string' ? raw.summary.trim() : ''
  if (subject.length === 0)        errs.push({ field: 'subject', reason: 'Subject is required.' })
  else if (subject.length > 200)   errs.push({ field: 'subject', reason: 'Subject must be 200 characters or fewer.' })
  if (summary.length === 0)        errs.push({ field: 'summary', reason: 'Summary is required.' })
  else if (summary.length > 4000)  errs.push({ field: 'summary', reason: 'Summary is too long (max 4,000 characters).' })
  if (!isEscalationReason(raw.reason)) {
    errs.push({ field: 'reason', reason: 'Reason must be user_requested / low_confidence / safety_critical.' })
  }
  return errs
}

export interface SupportTicketContext {
  ticket_id:      string
  reason:         EscalationReason
  subject:        string
  summary:        string
  user_email:     string | null
  user_name:      string | null
  tenant_name:    string | null
  origin_path:    string | null
  opened_at:      string  // ISO timestamp
  transcript:     ChatMessage[]
}

// Plain-text email body sent to the support inbox. Mirrors the
// renderBugReportText pattern: the text version is the source of truth so
// it can be unit-tested without parsing HTML.
export function renderSupportTicketEmail(ctx: SupportTicketContext): string {
  const lines: string[] = []
  lines.push(`Ticket: ${ctx.ticket_id}`)
  lines.push(`Reason: ${ctx.reason}`)
  lines.push(`User:   ${ctx.user_name ?? '(unknown)'} <${ctx.user_email ?? 'unknown'}>`)
  lines.push(`Tenant: ${ctx.tenant_name ?? '(none)'}`)
  if (ctx.origin_path) lines.push(`Page:   ${ctx.origin_path}`)
  lines.push(`Opened: ${ctx.opened_at}`)
  lines.push('')
  lines.push('— Summary (from the bot) —')
  lines.push(ctx.summary.trim())
  lines.push('')
  lines.push('— Conversation transcript —')
  for (const m of ctx.transcript) {
    const tag =
      m.role === 'user'      ? '[user]     '
    : m.role === 'assistant' ? '[assistant]'
    : m.role === 'tool'      ? '[tool]     '
    :                          '[system]   '
    lines.push(`${tag} ${m.content.replace(/\n/g, '\n             ')}`)
  }
  lines.push('')
  lines.push('Reply directly to this email to respond to the user — Reply-To is set to their address.')
  return lines.join('\n')
}
