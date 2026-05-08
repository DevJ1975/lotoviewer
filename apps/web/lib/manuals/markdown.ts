// Markdown renderer for module manuals. Same posture as the
// existing release-note + toolbox-talk renderers in
// apps/web/lib/markdown.ts: pre-escape the entire input, then
// re-allow only known-safe constructs. The XSS surface stays
// "anything that came from a superadmin's keyboard, sanitised."
//
// Supported syntax:
//   ## H2 / ### H3 / #### H4    — section headings, slugged for #anchors
//   `inline code`               — <code>
//   ```\nfenced\n```            — pre/code block
//   - bullet item               — <ul><li>
//   1. ordered item             — <ol><li>
//   **bold**                    — <strong>
//   *italic* (single asterisk)  — <em>
//   [text](url)                 — <a> (http/https + relative paths only)
//   ![alt](url)                 — <img> (only the configured Supabase
//                                 storage host or relative paths)
//   | a | b |\n|---|---|        — <table>
//   :::video youtube:abc123 ::: — sandboxed <iframe> (allow-list embeds)
//   blank line                  — paragraph break
//
// Heading anchors: each heading gets an `id="slug"` so
// /manuals/loto#group-lock deep-links work. The TOC builder
// (extractToc below) walks the same parser.

const URL_RE      = /^(https?:)\/\//i
const PATH_RE     = /^\//                             // local path

// Default allow-list for inline images. Includes the Supabase storage
// public URL pattern; superadmins can also paste relative paths
// (e.g. /brand/...). Override at call time via opts.imageHosts.
const DEFAULT_IMAGE_HOSTS = [
  'supabase.co',
  'supabase.in',
]

interface RenderOpts {
  /** Hostname allow-list for inline `![]()` images. */
  imageHosts?: string[]
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Slug a heading text for use as an id. Lowercase, dashes between
// words, only [a-z0-9-]. Stable across calls so deep-links survive
// edits that don't touch the heading itself.
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'section'
}

// Embed allow-list. We accept a small fenced syntax instead of raw
// URLs so the user can never inject an arbitrary iframe src. Form:
//   :::video youtube:VIDEO_ID :::
//   :::video loom:VIDEO_ID :::
//   :::video vimeo:VIDEO_ID :::
//   :::video wistia:VIDEO_ID :::
const VIDEO_PROVIDERS: Record<string, (id: string) => string> = {
  youtube: id => `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
  loom:    id => `https://www.loom.com/embed/${encodeURIComponent(id)}`,
  vimeo:   id => `https://player.vimeo.com/video/${encodeURIComponent(id)}`,
  wistia:  id => `https://fast.wistia.net/embed/iframe/${encodeURIComponent(id)}`,
}
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{4,32}$/

interface Heading {
  level: 2 | 3 | 4
  text:  string
  slug:  string
}

/** Walk the markdown for top-level headings — used by the TOC. */
export function extractToc(md: string): Heading[] {
  const out: Heading[] = []
  // We split on lines (cheap) and look for ## / ### / #### at start
  // of a line. The full renderer below is more thorough; the TOC
  // doesn't need to be.
  for (const raw of md.split('\n')) {
    const line = raw.trim()
    let level: 2 | 3 | 4 | null = null
    let text = ''
    if      (line.startsWith('#### ')) { level = 4; text = line.slice(5) }
    else if (line.startsWith('### '))  { level = 3; text = line.slice(4) }
    else if (line.startsWith('## '))   { level = 2; text = line.slice(3) }
    if (!level) continue
    out.push({ level, text, slug: slugify(text) })
  }
  return out
}

/**
 * Render a module-manual body to HTML. Output is safe to inject via
 * dangerouslySetInnerHTML: every code path either escapes the input
 * or emits known-safe markup against a host allow-list.
 */
export function renderManualMd(md: string, opts: RenderOpts = {}): string {
  const imageHosts = (opts.imageHosts ?? DEFAULT_IMAGE_HOSTS).map(h => h.toLowerCase())

  // ── Pass 1: pull fenced code blocks out of the input so subsequent
  // block-level parsing doesn't touch them. We replace each block
  // with a placeholder, then drop the rendered code back in at the
  // end. (Same pattern as the popular markdown libraries.) ────────
  type Replaced = { kind: 'code' | 'video'; html: string }
  const replaced: Replaced[] = []
  function ph(idx: number) { return `MANUAL_PH_${idx}` }

  let working = md.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_, _lang, body) => {
    const idx = replaced.length
    replaced.push({
      kind: 'code',
      html: `<pre class="rounded-lg bg-slate-900 text-slate-100 dark:bg-slate-800 p-3 text-xs overflow-x-auto"><code>${escape(body.replace(/\n$/, ''))}</code></pre>`,
    })
    return ph(idx)
  })

  working = working.replace(/:::video\s+([a-z]+):([A-Za-z0-9_-]+)\s+:::/g, (_full, provider, id) => {
    const idx = replaced.length
    const make = VIDEO_PROVIDERS[provider]
    if (!make || !VIDEO_ID_RE.test(id)) {
      replaced.push({ kind: 'video', html: '' })  // strip silently
      return ph(idx)
    }
    const src = make(id)
    replaced.push({
      kind: 'video',
      html: `<div class="my-3 aspect-video"><iframe src="${escape(src)}" loading="lazy" allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation" class="w-full h-full rounded-lg ring-1 ring-slate-200 dark:ring-slate-700"></iframe></div>`,
    })
    return ph(idx)
  })

  // ── Pass 2: pre-escape the rest. From here on we only re-allow
  // specific constructs in the escaped string. ────────────────────
  const escaped = escape(working)

  // ── Pass 3: block-level parsing (paragraphs / lists / tables /
  // headings). Split on blank lines. ───────────────────────────────
  const blocks = escaped.split(/\n\s*\n/)
  const html: string[] = []

  for (const raw of blocks) {
    const trimmed = raw.trim()
    if (!trimmed) continue

    // Reinject any placeholder block as-is (a video or fenced code
    // sitting on its own line).
    const phMatch = trimmed.match(/^MANUAL_PH_(\d+)$/)
    if (phMatch) {
      html.push(replaced[parseInt(phMatch[1], 10)].html)
      continue
    }

    const lines = trimmed.split('\n').map(l => l.trimEnd())

    // Single-line headings (h2 / h3 / h4).
    if (lines.length === 1) {
      const h = parseHeading(lines[0])
      if (h) {
        const slug = slugify(stripInlineMarks(h.text))
        const cls = h.level === 2
          ? 'text-xl font-bold mt-6 mb-3 text-slate-900 dark:text-slate-100'
          : h.level === 3
            ? 'text-base font-semibold mt-4 mb-2 text-slate-900 dark:text-slate-100'
            : 'text-sm font-semibold mt-3 mb-1 text-slate-700 dark:text-slate-200'
        html.push(`<h${h.level} id="${slug}" class="${cls}">${renderInline(h.text, imageHosts)}</h${h.level}>`)
        continue
      }
    }

    // Markdown table: at least 2 lines, every line starts/ends with `|`,
    // and the second line is the separator (---|---).
    if (lines.length >= 2 && /^\|.*\|$/.test(lines[0]) && /^\|[\s\-:|]+\|$/.test(lines[1])) {
      html.push(renderTable(lines, imageHosts))
      continue
    }

    // Bullet list.
    if (lines.every(l => /^- /.test(l))) {
      const items = lines.map(l => `<li>${renderInline(l.slice(2), imageHosts)}</li>`).join('')
      html.push(`<ul class="list-disc ml-5 space-y-1 mb-3">${items}</ul>`)
      continue
    }

    // Ordered list.
    if (lines.every(l => /^\d+\.\s/.test(l))) {
      const items = lines.map(l => `<li>${renderInline(l.replace(/^\d+\.\s/, ''), imageHosts)}</li>`).join('')
      html.push(`<ol class="list-decimal ml-5 space-y-1 mb-3">${items}</ol>`)
      continue
    }

    // Default: paragraph. Soft line breaks → <br>.
    const para = lines.map(l => renderInline(l, imageHosts)).join('<br>')
    html.push(`<p class="mb-3 leading-relaxed">${para}</p>`)
  }

  // Reinject any remaining placeholders that landed mid-paragraph.
  let out = html.join('')
  out = out.replace(/MANUAL_PH_(\d+)/g, (_full, idxStr) => {
    return replaced[parseInt(idxStr, 10)]?.html ?? ''
  })
  return out
}

// ── Helpers ───────────────────────────────────────────────────────────────

function parseHeading(line: string): { level: 2 | 3 | 4; text: string } | null {
  if (line.startsWith('#### ')) return { level: 4, text: line.slice(5) }
  if (line.startsWith('### '))  return { level: 3, text: line.slice(4) }
  if (line.startsWith('## '))   return { level: 2, text: line.slice(3) }
  return null
}

// Strip inline marks for slugging purposes. Operates on the
// already-escaped text, so we look for the raw markers (not their
// HTML form).
function stripInlineMarks(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
}

function renderTable(lines: string[], imageHosts: string[]): string {
  const headerCells = splitRow(lines[0])
  const bodyRows = lines.slice(2)
    .filter(l => /^\|.*\|$/.test(l))
    .map(splitRow)

  const thead = `<tr>${headerCells.map(c => `<th class="px-2 py-1 border-b border-slate-200 dark:border-slate-700 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300">${renderInline(c, imageHosts)}</th>`).join('')}</tr>`
  const tbody = bodyRows.map(row =>
    `<tr>${row.map(c => `<td class="px-2 py-1 border-b border-slate-100 dark:border-slate-800 text-sm">${renderInline(c, imageHosts)}</td>`).join('')}</tr>`,
  ).join('')

  return `<div class="my-3 overflow-x-auto"><table class="w-full border-collapse">${thead}${tbody}</table></div>`
}

function splitRow(line: string): string[] {
  // Strip leading + trailing pipes, then split. Trim each cell. Empty
  // cells are preserved (rendered as blank).
  return line.replace(/^\||\|$/g, '').split('|').map(s => s.trim())
}

function renderInline(text: string, imageHosts: string[]): string {
  let out = text

  // Inline code: `foo`. Escaped already, so we just wrap.
  out = out.replace(/`([^`]+)`/g, (_full, body: string) => `<code class="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[0.85em]">${body}</code>`)

  // Image: ![alt](src)
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_full, alt: string, src: string) => {
    if (!isAllowedImage(src, imageHosts)) return alt
    return `<img src="${src}" alt="${alt}" class="my-2 max-w-full rounded-lg ring-1 ring-slate-200 dark:ring-slate-700" loading="lazy" />`
  })

  // Link: [text](href). http/https or relative path only.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_full, label: string, href: string) => {
    if (!URL_RE.test(href) && !PATH_RE.test(href)) return label
    const target = URL_RE.test(href) ? ' target="_blank" rel="noopener noreferrer"' : ''
    return `<a href="${href}"${target} class="text-brand-navy dark:text-brand-yellow underline">${label}</a>`
  })

  // Bold then italic. Bold first so **a** doesn't get eaten by *a*.
  out = out.replace(/\*\*([^*]+)\*\*/g, (_full, inner: string) => `<strong>${inner}</strong>`)
  out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, (_full, lead: string, inner: string) => `${lead}<em>${inner}</em>`)

  return out
}

function isAllowedImage(src: string, imageHosts: string[]): boolean {
  if (PATH_RE.test(src)) return true
  if (!URL_RE.test(src)) return false
  try {
    const u = new URL(src)
    const host = u.hostname.toLowerCase()
    return imageHosts.some(h => host === h || host.endsWith('.' + h))
  } catch {
    return false
  }
}
