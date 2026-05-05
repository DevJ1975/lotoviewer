// Support-ticket digest helpers used by the daily health-report cron.
//
// The cron route fetches the rows; this module turns them into a
// rendered text block. Keeping the formatting here means we can
// unit-test the output without booting Supabase or Resend.

import type { EscalationReason } from './types'

export interface DigestTicket {
  id:          string
  subject:     string
  reason:      EscalationReason
  user_email:  string | null
  user_name:   string | null
  tenant_name: string | null
  emailed_ok:  boolean | null
  resolved_at: string | null
  created_at:  string
}

export interface RenderDigestArgs {
  // All tickets created in the digest window (e.g. last 24h). Used for
  // the new-tickets-by-reason breakdown and the recent list.
  recent:     DigestTicket[]
  // Open tickets across all time (resolved_at IS NULL). Drives the
  // headline count so a backlog doesn't disappear from the digest just
  // because nobody opened a new one in the last 24h.
  openCount:  number
}

const REASON_LABEL: Record<EscalationReason, string> = {
  user_requested:  'user',
  low_confidence:  'stuck',
  safety_critical: 'safety',
}

// Plain-text section for the daily digest. Returns lines without a
// trailing newline; the caller joins with '\n'. The shape mirrors the
// neighbouring ▶ BUG REPORTS section so the email reads consistently.
export function renderSupportTicketSection(a: RenderDigestArgs): string[] {
  const lines: string[] = []
  lines.push(`▶ AI SUPPORT TICKETS (last 24h: ${a.recent.length} · open all-time: ${a.openCount})`)

  if (a.recent.length === 0 && a.openCount === 0) {
    lines.push(`  none — quiet day ✅`)
    return lines
  }

  if (a.recent.length > 0) {
    const counts: Record<EscalationReason, number> = {
      user_requested: 0, low_confidence: 0, safety_critical: 0,
    }
    for (const t of a.recent) counts[t.reason] = (counts[t.reason] ?? 0) + 1
    lines.push(
      `  by reason: user=${counts.user_requested}  stuck=${counts.low_confidence}  safety=${counts.safety_critical}`,
    )

    for (const t of a.recent.slice(0, 10)) {
      const tag = `[${REASON_LABEL[t.reason] ?? t.reason}]`
      const reporter = t.user_email ?? t.user_name ?? '(unknown)'
      const tenant   = t.tenant_name ? ` (${t.tenant_name})` : ''
      const flag     = t.emailed_ok === false ? ' (email failed!)' : ''
      const status   = t.resolved_at ? ' ✓' : ''
      lines.push(`  ${tag} ${t.subject} — ${reporter}${tenant}${flag}${status}`)
    }
    if (a.recent.length > 10) {
      lines.push(`  …and ${a.recent.length - 10} more`)
    }
  } else {
    lines.push(`  no new tickets in the last 24h — backlog: ${a.openCount} open`)
  }

  return lines
}
