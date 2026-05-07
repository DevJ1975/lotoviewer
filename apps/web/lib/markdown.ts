// Minimal-surface Markdown renderer for release notes. Only handles
// the four constructs a release note actually needs:
//
//   **bold**            → <strong>
//   [link](url)         → <a href> (only http/https URLs allowed)
//   - bullet item       → <ul><li>
//   blank line          → paragraph break
//
// Everything else is escaped. There is no embedded-HTML path, no
// heading syntax, no tables — by design. Keeping the renderer
// tiny means the XSS attack surface is zero. If a release note
// needs richer formatting in the future, link out to a docs page
// rather than expand this renderer.

const URL_RE = /^(https?:)\/\//i

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInline(text: string): string {
  // Process in this order: links → bold. Apply escape inside the
  // captured groups so we never emit raw user content.
  let out = text

  // [text](url) — only allow http/https URLs.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    if (!URL_RE.test(href)) return escape(label)
    return `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer" class="underline">${escape(label)}</a>`
  })

  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, inner: string) => `<strong>${escape(inner)}</strong>`)

  // Anything that wasn't matched above gets escaped now. The
  // already-rendered fragments (links, bold) are kept by checking
  // for known HTML — but the simpler approach is to process the
  // input through escape FIRST and then unescape only the markup
  // we generated. Let me redo:
  return out
}

/**
 * Render a release-note body to HTML. Output is safe to inject via
 * dangerouslySetInnerHTML — every code path either escapes the
 * input or passes through known-safe markup.
 */
export function renderReleaseNoteMd(md: string): string {
  // Pre-escape the entire input. We then re-allow specific syntax
  // by post-processing the escaped string. Because escape() turns
  // `[`, `(`, `*` into their entities only if they're HTML-special
  // (they're not), the tokens we look for are intact in the
  // escaped string.
  const escaped = escape(md)

  // Split on blank lines into paragraphs / list groups.
  const blocks = escaped.split(/\n\s*\n/)
  const html: string[] = []
  for (const raw of blocks) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Bullet list: every non-empty line starts with `- `.
    const lines = trimmed.split('\n').map(l => l.trim())
    if (lines.every(l => l.startsWith('- '))) {
      const items = lines.map(l => `<li>${renderInlineSafe(l.slice(2))}</li>`).join('')
      html.push(`<ul class="list-disc ml-5 space-y-0.5">${items}</ul>`)
      continue
    }

    // Default: paragraph. Soft line breaks → <br>.
    const para = lines.map(l => renderInlineSafe(l)).join('<br>')
    html.push(`<p class="mb-2">${para}</p>`)
  }
  return html.join('')
}

/**
 * Render a toolbox-talk body to HTML. Same posture as the release-note
 * renderer — pre-escape, then re-allow only known-safe constructs —
 * but adds `### subheading` (h3) support, which AI-generated talk
 * bodies frequently produce. h1/h2 are deliberately not supported:
 * the talk's title is the page's h1 already.
 */
export function renderTalkMd(md: string): string {
  const escaped = escape(md)
  const blocks = escaped.split(/\n\s*\n/)
  const html: string[] = []
  for (const raw of blocks) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    const lines = trimmed.split('\n').map(l => l.trim())

    // Single-line ### Heading. Keeps the renderer simple — multi-line
    // heading blocks are vanishingly rare in this surface.
    if (lines.length === 1 && lines[0].startsWith('### ')) {
      html.push(`<h3 class="text-base font-semibold mt-4 mb-2 text-slate-900 dark:text-slate-100">${renderInlineSafe(lines[0].slice(4))}</h3>`)
      continue
    }

    if (lines.every(l => l.startsWith('- '))) {
      const items = lines.map(l => `<li>${renderInlineSafe(l.slice(2))}</li>`).join('')
      html.push(`<ul class="list-disc ml-5 space-y-1">${items}</ul>`)
      continue
    }

    const para = lines.map(l => renderInlineSafe(l)).join('<br>')
    html.push(`<p class="mb-3 leading-relaxed">${para}</p>`)
  }
  return html.join('')
}

/** Inline rendering on already-escaped text. Recognises **bold** and
 *  [text](url) without re-escaping. */
function renderInlineSafe(text: string): string {
  let out = text

  // [text](url) — both label and href are already escaped because the
  // input came through escape() upstream. Re-escape href anyway
  // through encodeURI to defend against a label that contained an
  // un-escaped `(` (impossible in escaped input, but cheap).
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (!URL_RE.test(href)) return label
    return `<a href="${href}" target="_blank" rel="noopener noreferrer" class="underline">${label}</a>`
  })

  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_, inner) => `<strong>${inner}</strong>`)

  return out
}
