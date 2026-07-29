// Regulation-freshness alert — emailed by /api/cron/check-regulation-updates when
// eCFR has amended a tracked regulation (e.g. 29 CFR Part 1910) more recently than
// the snapshot the RAG corpus reflects. The fix is an operator action, not an
// in-app one: re-run scripts/osha_1910_ingest.py, so the email carries the command
// rather than a dashboard link. Same posture as the other senders (boolean return,
// never throws, every send logged via instrument.ts).

import { sendEmail } from '@/lib/email/core'

export interface RegulationUpdateAlertArgs {
  to:                string
  title:             string        // "Federal OSHA 29 CFR Part 1910 (General Industry)"
  ecfrPart:          string        // "1910"
  latestAmendment:   string        // eCFR's newest amendment date for the part (ISO)
  ingestedSnapshot:  string | null // the snapshot the corpus currently reflects (ISO), or null
}

export async function sendRegulationUpdateAlert(args: RegulationUpdateAlertArgs): Promise<boolean> {
  const subject = `[Regulations] ${args.title} has a newer eCFR amendment (${args.latestAmendment})`

  const from = process.env.SUPPORT_FROM_EMAIL
            ?? process.env.INVITE_FROM_EMAIL
            ?? 'SoteriaField <invites@soteriafield.app>'

  const have = args.ingestedSnapshot ?? 'never ingested'
  const cmd  = `python scripts/osha_1910_ingest.py all --date ${args.latestAmendment}`

  const text = `A tracked regulation in the assistant's knowledge base is out of date.

  Regulation:        ${args.title}
  eCFR part:         29 CFR ${args.ecfrPart}
  Latest amendment:  ${args.latestAmendment}
  Corpus reflects:   ${have}

To refresh the RAG corpus, run the ingester with the new snapshot date and apply
the generated SQL batches to Supabase:

  ${cmd}

The ingest is idempotent — only changed sections are rewritten.

— SoteriaField
`

  const safe = (s: string) => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:#214488;padding:24px 28px;color:#fff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">SoteriaField · Regulation update</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">Knowledge base is out of date</div>
    </td></tr>
    <tr><td style="padding:28px;">
      <p style="margin:0 0 14px 0;font-size:15px;line-height:1.55;">
        eCFR has a newer amendment for <strong>${safe(args.title)}</strong> than the snapshot the assistant's RAG corpus reflects.
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;font-size:13px;color:#1a2230;">
        <tr><td style="padding:2px 12px 2px 0;color:#5b6675;">eCFR part</td><td>29 CFR ${safe(args.ecfrPart)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5b6675;">Latest amendment</td><td><strong>${safe(args.latestAmendment)}</strong></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#5b6675;">Corpus reflects</td><td>${safe(have)}</td></tr>
      </table>
      <p style="margin:0 0 8px 0;font-size:13px;color:#5b6675;">Refresh the corpus by re-running the ingester (idempotent — only changed sections are rewritten):</p>
      <pre style="margin:0;background:#0f1729;color:#e6edf7;padding:12px 14px;border-radius:8px;font-size:12px;overflow:auto;">${safe(cmd)}</pre>
    </td></tr>
  </table>
</td></tr>
</table></body></html>`

  const { sent } = await sendEmail({
    kind: 'regulation-update-alert',
    to: args.to,
    subject, text, html,
    tenantId: null,
    from,
  })
  return sent
}
