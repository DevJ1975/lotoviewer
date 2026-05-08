'use client'

// Minimal markdown renderer for assistant turns.
//
// We intentionally don't pull in react-markdown — the assistant's output is
// constrained (paragraphs, lists, code spans, links, bold, headings up to h3,
// regulation citations like [29 CFR 1910.147(c)(4)]). A small focused renderer
// is ~100 LOC and avoids dep weight for what's effectively a chat surface.
//
// Safety:
//   - Links are rendered as <a> with rel="noreferrer" and target="_blank"
//     for absolute URLs; in-app paths render as react-friendly anchors.
//   - We do NOT render raw HTML. Anything that looks like a tag is escaped.
//   - Code blocks/spans use <code> with whitespace-preserved styling.

import { Fragment } from 'react'

interface Props {
  text: string
  className?: string
}

// Inline tokens: **bold**, *italic*, `code`, [text](url).
function renderInline(s: string, keyPrefix: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  let i = 0
  let buffer = ''
  let key = 0
  const flush = () => { if (buffer) { parts.push(buffer); buffer = '' } }

  while (i < s.length) {
    const ch = s[i]

    // Code span: `...`
    if (ch === '`') {
      const end = s.indexOf('`', i + 1)
      if (end > i) {
        flush()
        parts.push(<code key={`${keyPrefix}-code-${key++}`} className="rounded bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[0.875em] font-mono">{s.slice(i + 1, end)}</code>)
        i = end + 1
        continue
      }
    }

    // Bold: **...**
    if (ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2)
      if (end > i + 1) {
        flush()
        parts.push(<strong key={`${keyPrefix}-b-${key++}`}>{renderInline(s.slice(i + 2, end), `${keyPrefix}-b${key}`)}</strong>)
        i = end + 2
        continue
      }
    }

    // Italic: *...*  (single asterisk, not preceded by backslash)
    if (ch === '*' && s[i + 1] !== '*' && s[i - 1] !== '\\') {
      const end = s.indexOf('*', i + 1)
      if (end > i) {
        flush()
        parts.push(<em key={`${keyPrefix}-i-${key++}`}>{renderInline(s.slice(i + 1, end), `${keyPrefix}-i${key}`)}</em>)
        i = end + 1
        continue
      }
    }

    // Link: [text](url)
    if (ch === '[') {
      const closeBracket = s.indexOf(']', i + 1)
      if (closeBracket > i && s[closeBracket + 1] === '(') {
        const closeParen = s.indexOf(')', closeBracket + 2)
        if (closeParen > closeBracket) {
          flush()
          const linkText = s.slice(i + 1, closeBracket)
          const href     = s.slice(closeBracket + 2, closeParen)
          const isExternal = /^https?:\/\//i.test(href)
          parts.push(
            <a
              key={`${keyPrefix}-a-${key++}`}
              href={href}
              {...(isExternal ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-700 dark:hover:text-blue-300"
            >
              {renderInline(linkText, `${keyPrefix}-a${key}`)}
            </a>,
          )
          i = closeParen + 1
          continue
        }
      }
    }

    buffer += ch
    i++
  }
  flush()
  return parts
}

// Block-level: paragraphs, lists, headings, fenced code.
export function Markdown({ text, className }: Props) {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  while (i < lines.length) {
    const line = lines[i]

    // Fenced code block
    if (line.startsWith('```')) {
      const start = i + 1
      let end = start
      while (end < lines.length && !lines[end].startsWith('```')) end++
      blocks.push(
        <pre key={`pre-${key++}`} className="rounded-md bg-slate-100 dark:bg-slate-800 p-3 my-2 overflow-x-auto text-xs font-mono">
          <code>{lines.slice(start, end).join('\n')}</code>
        </pre>,
      )
      i = end + 1
      continue
    }

    // Heading
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const Tag = (`h${level}` as 'h1' | 'h2' | 'h3')
      const cls = level === 1
        ? 'text-base font-semibold mt-3 mb-1'
        : level === 2
          ? 'text-sm font-semibold mt-3 mb-1'
          : 'text-sm font-medium mt-2 mb-1'
      blocks.push(<Tag key={`h-${key++}`} className={cls}>{renderInline(heading[2], `h${key}`)}</Tag>)
      i++
      continue
    }

    // Unordered list
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push(
        <ul key={`ul-${key++}`} className="list-disc pl-5 my-1 space-y-0.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `li${key}-${idx}`)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push(
        <ol key={`ol-${key++}`} className="list-decimal pl-5 my-1 space-y-0.5">
          {items.map((item, idx) => (
            <li key={idx}>{renderInline(item, `oli${key}-${idx}`)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // Paragraph: collect consecutive non-empty lines.
    if (line.trim() === '') { i++; continue }
    const paraLines: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('```') && !/^(#{1,3})\s/.test(lines[i]) && !/^\s*[-*]\s+/.test(lines[i]) && !/^\s*\d+\.\s+/.test(lines[i])) {
      paraLines.push(lines[i])
      i++
    }
    blocks.push(
      <p key={`p-${key++}`} className="my-1 leading-relaxed">
        {paraLines.map((l, idx) => (
          <Fragment key={idx}>
            {idx > 0 && <br />}
            {renderInline(l, `p${key}-${idx}`)}
          </Fragment>
        ))}
      </p>,
    )
  }

  return <div className={className}>{blocks}</div>
}
