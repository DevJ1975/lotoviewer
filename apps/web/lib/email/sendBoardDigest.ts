// Per-user safety-board activity digest. Fires daily or weekly per
// user_digest_preferences.cadence. Bundles new/updated threads in a
// tenant into a single email so off-shift workers (who miss Web
// Push) still see what's happening.

import { Resend } from 'resend'
import * as Sentry from '@sentry/nextjs'
import { logEmailSend } from '@/lib/email/instrument'

export interface BoardDigestThreadEntry {
  board_id:      string
  board_name:    string
  thread_id:     string
  title:         string
  kind:          string
  pinned:        boolean
  ack_required:  boolean
  created_at:    string
  last_reply_at: string
  reply_count:   number
}

export interface BoardDigestArgs {
  to:           string
  recipientName?: string | null
  tenantId:     string
  tenantName:   string | null
  cadence:      'daily' | 'weekly'
  windowStart:  string
  threads:      BoardDigestThreadEntry[]
  unackedCount: number  // threads requiring ack that this user hasn't acked
  appUrl:       string
}

export async function sendBoardDigest(args: BoardDigestArgs): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const subject = `[${args.cadence === 'daily' ? 'Daily' : 'Weekly'}] Safety boards digest`
  if (!apiKey) {
    await logEmailSend({
      kind: 'board-digest', to: args.to, subject,
      tenantId: args.tenantId, status: 'skipped', errorText: 'RESEND_API_KEY not set',
    })
    return false
  }
  const from = process.env.INVITE_FROM_EMAIL
            ?? process.env.SUPPORT_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const name = args.recipientName?.trim() || args.to.split('@')[0]!
  const baseUrl = args.appUrl.replace(/\/$/, '')

  // Group by board for readability.
  const byBoard = new Map<string, { board_name: string; entries: BoardDigestThreadEntry[] }>()
  for (const t of args.threads) {
    const cur = byBoard.get(t.board_id) ?? { board_name: t.board_name, entries: [] }
    cur.entries.push(t)
    byBoard.set(t.board_id, cur)
  }

  const textLines: string[] = []
  textLines.push(`Hi ${name},`)
  textLines.push('')
  textLines.push(`Here's what changed on safety boards${args.tenantName ? ' at ' + args.tenantName : ''} since ${new Date(args.windowStart).toLocaleString()}.`)
  if (args.unackedCount > 0) {
    textLines.push('')
    textLines.push(`⚠ ${args.unackedCount} thread${args.unackedCount === 1 ? '' : 's'} require your acknowledgement.`)
  }
  textLines.push('')
  if (args.threads.length === 0) {
    textLines.push('No board activity in the digest window.')
  } else {
    for (const [boardId, group] of byBoard.entries()) {
      textLines.push(`## ${group.board_name}`)
      for (const t of group.entries) {
        const flag = t.pinned ? '📌 ' : ''
        const ack  = t.ack_required ? ' [ACK REQUIRED]' : ''
        textLines.push(`  ${flag}${t.title}${ack}`)
        textLines.push(`     ${baseUrl}/safety-boards/${boardId}/${t.thread_id}`)
        if (t.reply_count > 0) {
          textLines.push(`     ${t.reply_count} repl${t.reply_count === 1 ? 'y' : 'ies'} — last activity ${new Date(t.last_reply_at).toLocaleString()}`)
        }
      }
      textLines.push('')
    }
  }
  textLines.push(`— SoteriaField`)
  textLines.push(`Manage your digest preferences: ${baseUrl}/settings/digest`)
  const text = textLines.join('\n')

  // Lightweight HTML — same content, slightly nicer formatting.
  const html = textToHtml(text, baseUrl)

  try {
    const resend = new Resend(apiKey)
    const result = await resend.emails.send({ from, to: args.to, subject, text, html })
    if (result.error) {
      Sentry.captureMessage('board-digest send error', { extra: { error: result.error } })
      await logEmailSend({
        kind: 'board-digest', to: args.to, subject,
        tenantId: args.tenantId, status: 'failed', errorText: String(result.error),
      })
      return false
    }
    await logEmailSend({
      kind: 'board-digest', to: args.to, subject,
      tenantId: args.tenantId, status: 'sent',
    })
    return true
  } catch (e) {
    Sentry.captureException(e, { tags: { kind: 'board-digest' } })
    await logEmailSend({
      kind: 'board-digest', to: args.to, subject,
      tenantId: args.tenantId, status: 'failed',
      errorText: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}

function textToHtml(text: string, baseUrl: string): string {
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const lines = text.split('\n').map(l => {
    if (l.startsWith('## ')) return `<h2 style="font-size:14px;margin:12px 0 4px;">${escape(l.slice(3))}</h2>`
    if (/^https?:\/\//.test(l.trim())) {
      const url = l.trim()
      return `<div style="font-size:12px;color:#3b6cb6;"><a href="${escape(url)}">${escape(url.replace(baseUrl + '/', ''))}</a></div>`
    }
    return `<div>${escape(l)}</div>`
  })
  return `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:13px;color:#1f2937;">${lines.join('')}</div>`
}
