// Shared HTML shell for transactional + digest emails. The doctype / page
// background / 560px white card / brand header bar / footer bar were inlined
// — byte-for-byte — in ~15 senders (twice inside sendInvite). This collapses
// that to one place; each sender now builds only its inner content.
//
// Callers pass already-escaped HTML for heading/eyebrow/content/footer (use
// escapeHtml for any user-supplied value), mirroring how the inline shells
// worked. The layout itself interpolates verbatim.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
const BRAND_NAVY = '#214488'

// HTML-escape user-supplied content. The canonical escaper for every sender —
// replaces the per-file `safe()` copies. Escapes the five HTML-significant
// characters (including both quote styles, since values land in attributes).
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

export interface EmailLayoutArgs {
  /** White title line in the header bar. */
  heading:     string
  /** Inner HTML between header and footer (the sender's unique body). */
  contentHtml: string
  /** Inner HTML of the footer bar (e.g. "Sent from SoteriaField" + unsub). */
  footerHtml:  string
  /** Header background — defaults to brand navy; alerts pass a severity tint. */
  headerBg?:   string
  /** Uppercase eyebrow above the heading. Defaults to "SoteriaField". */
  eyebrow?:    string
}

export function renderEmailLayout(args: EmailLayoutArgs): string {
  const headerBg = args.headerBg ?? BRAND_NAVY
  const eyebrow = args.eyebrow ?? 'SoteriaField'
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f6f8fb;font-family:${FONT};color:#1a2230;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f8fb;padding:32px 16px;">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
    <tr><td style="background:${headerBg};padding:24px 28px;color:#ffffff;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;opacity:.85;">${eyebrow}</div>
      <div style="font-size:22px;font-weight:800;margin-top:4px;">${args.heading}</div>
    </td></tr>
    <tr><td style="padding:28px;">
      ${args.contentHtml}
    </td></tr>
    <tr><td style="background:#f6f8fb;padding:16px 28px;text-align:center;font-size:11px;color:#5b6675;border-top:1px solid #e6ebf2;">
      ${args.footerHtml}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`
}
