#!/usr/bin/env node
/**
 * scripts/ingest-cal-osha-t8.mjs
 *
 * Fetches California Code of Regulations, Title 8 (Cal/OSHA) General
 * Industry Safety Orders — the control-of-hazardous-energy provision
 * §3314 — from the DIR website, converts each per-section HTML page to
 * a single RAG-ready markdown file, and (with --ingest) pushes it
 * through /api/superadmin/knowledge/seed-regulations to embed and
 * ingest into the assistant's knowledge base.
 *
 * Why a CLI script and not an in-app crawler (same rationale as the
 * federal scripts/ingest-osha-1910.mjs sibling):
 *   - DIR has no rate-limit contract; we don't want a web request
 *     hanging while a user clicks "ingest" in the UI.
 *   - Fetch + strip in a Vercel function would routinely time out.
 *   - The script can be re-run whenever DIR republishes a section
 *     without a deploy.
 *
 * Why a SEPARATE script from ingest-osha-1910.mjs:
 *   - California Title 8 is NOT on the federal eCFR. eCFR only covers
 *     the federal CFR; Cal/OSHA's state plan lives on the DIR site as
 *     per-section HTML pages (e.g. https://www.dir.ca.gov/title8/3314.html).
 *   - eCFR serves XSD-backed XML with a stable, validated schema. DIR
 *     serves hand-tagged HTML whose layout is less stable, so the
 *     parser below is BEST-EFFORT: it strips chrome and unwraps the
 *     section body, but the output should be SPOT-CHECKED after each
 *     run. If DIR changes its template, adjust SECTION_BODY_RE.
 *   - Network access to dir.ca.gov depends on the environment's egress
 *     policy; a fetch failure exits non-zero (see below).
 *
 * Usage:
 *   # 1. Fetch HTML, write markdown to apps/web/seed/, no DB writes:
 *   node scripts/ingest-cal-osha-t8.mjs
 *
 *   # 2. Generate AND ingest in one shot. Requires SOTERIA_BASE_URL
 *   #    and SOTERIA_SUPERADMIN_TOKEN env vars:
 *   SOTERIA_BASE_URL=https://soteriafield.app \
 *   SOTERIA_SUPERADMIN_TOKEN=<bearer> \
 *   node scripts/ingest-cal-osha-t8.mjs --ingest
 *
 * Output:
 *   apps/web/seed/cal-osha-title-8-loto-master.md
 *
 * After ingest, the assistant's RAG corpus will include §3314 as a
 * `state_reg` source with tenant_id = NULL (visible to every tenant).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const REPO_ROOT  = path.resolve(__dirname, '..')
const SEED_FILE  = path.join(REPO_ROOT, 'apps', 'web', 'seed', 'cal-osha-title-8-loto-master.md')

// The sections to fetch, in document order. Scope is deliberately tight:
// §3314 is the Cal/OSHA Lockout/Tagout requirement (the state analogue of
// 29 CFR 1910.147). DIR serves each section at title8/<n>.html. To add a
// related GISO section later, append it here — the build loop below
// handles the rest.
const SECTIONS = [
  {
    citation: '3314',
    title:    'The Control of Hazardous Energy (Lockout/Blockout/Tagout) — Cleaning, Repairing, Servicing, Setting-Up and Adjusting Operations of Prime Movers, Machinery and Equipment',
    url:      'https://www.dir.ca.gov/title8/3314.html',
  },
]

// Public DIR browse URL for the GISO subchapter — recorded in the
// front-matter so a reader can navigate to the live source.
const SUBCHAPTER_URL = 'https://www.dir.ca.gov/title8/sb7g2.html'

// ── arg parse ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
let doIngest = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--ingest' || a === '-i') { doIngest = true }
  else if (a === '--help' || a === '-h') {
    console.error(`Usage: node scripts/ingest-cal-osha-t8.mjs [--ingest]`)
    process.exit(0)
  }
  else { console.error(`unknown arg: ${a}`); process.exit(2) }
}

// ── parse helpers ──────────────────────────────────────────────────
//
// DIR section pages are simple HTML: a chrome wrapper around a single
// content block holding the section heading and numbered paragraphs.
// Unlike eCFR's validated XML, there's no schema to lean on, so we
// strip to text rather than trying to reconstruct structure. RAG
// indexes for retrieval; coverage matters more than perfect layout.

function decodeEntities(s) {
  // Decode common HTML entities (a superset of XML's five — DIR uses
  // &nbsp; liberally) plus numeric character references.
  //
  // &sect; is load-bearing: it is the § symbol DIR emits in every
  // section heading and cross-reference, so leaving it raw would litter
  // the RAG text and break citation matching. The rest (em/en dashes,
  // smart quotes, degree) are the named entities DIR's regulatory prose
  // actually uses; numeric references are handled generically below.
  return s
    .replace(/&nbsp;/gi,  ' ')
    .replace(/&amp;/gi,   '&')
    .replace(/&lt;/gi,    '<')
    .replace(/&gt;/gi,    '>')
    .replace(/&quot;/gi,  '"')
    .replace(/&apos;/gi,  "'")
    .replace(/&sect;/gi,  '§')
    .replace(/&deg;/gi,   '°')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rsquo;/gi, '’')
    .replace(/&ldquo;/gi, '“')
    .replace(/&rdquo;/gi, '”')
    .replace(/&#x?[0-9a-fA-F]+;/g, m => {
      const isHex = /^&#x/i.test(m)
      const hex   = m.slice(isHex ? 3 : 2, -1)
      const code  = parseInt(hex, isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })
}

function stripToText(html) {
  // Drop script/style wholesale, turn block-level tags into newline
  // breaks so paragraphs survive, strip remaining tags, decode
  // entities, and collapse runaway whitespace.
  return decodeEntities(
    html
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// DIR wraps the regulation body in a content container. Templates vary,
// so try the most specific selector first and fall back to <body>. The
// fallback keeps some chrome text, which is why the header tells the
// operator to spot-check the output.
const SECTION_BODY_RE = /<div\b[^>]*\bid=["']?(?:content|maincontent|main_content)["']?[^>]*>([\s\S]*?)<\/div>\s*(?:<\/div>|<footer)/i

function extractBody(html) {
  const m = SECTION_BODY_RE.exec(html)
  const scope = m ? m[1] : (/<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html)
  return stripToText(scope)
}

// ── fetch each section ─────────────────────────────────────────────
async function fetchSection(section) {
  console.error(`→ fetching ${section.url}`)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 90_000)
  try {
    const resp = await fetch(section.url, {
      signal:  ctrl.signal,
      headers: { 'user-agent': 'SoteriaField-RAG/1.0 (+https://soteriafield.app)' },
    })
    if (!resp.ok) {
      console.error(`  ✗ HTTP ${resp.status} ${resp.statusText}`)
      return null
    }
    const html = await resp.text()
    console.error(`  ✓ ${(html.length / 1024).toFixed(1)} KB`)
    return extractBody(html)
  } catch (e) {
    console.error(`  ✗ fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    return null
  } finally {
    clearTimeout(timer)
  }
}

const retrievedDate = new Date().toISOString().slice(0, 10)

// ── build the master markdown ──────────────────────────────────────
const lines = []
lines.push('---')
lines.push(`title: "Cal/OSHA Title 8 §3314 — The Control of Hazardous Energy (Lockout/Blockout/Tagout)"`)
lines.push(`jurisdiction: "California DIR / Cal/OSHA"`)
lines.push(`agency: "Division of Occupational Safety and Health, California Department of Industrial Relations"`)
lines.push(`citation: "8 CCR §3314"`)
lines.push(`source_url: "${SECTIONS[0].url}"`)
lines.push(`subchapter_url: "${SUBCHAPTER_URL}"`)
lines.push(`retrieved_date: "${retrievedDate}"`)
lines.push(`generator: "scripts/ingest-cal-osha-t8.mjs"`)
lines.push(`source_status: "Cal/OSHA Title 8 is not on the federal eCFR. DIR's HTML is authoritative but unofficial; the parser is best-effort — spot-check the output against the live page."`)
lines.push('---')
lines.push('')
lines.push('# Cal/OSHA Title 8 — Control of Hazardous Energy (Lockout/Tagout)')
lines.push('')
lines.push(`> Generated from the California DIR site on ${retrievedDate}. See ${SUBCHAPTER_URL} for the live General Industry Safety Orders source. DIR's HTML layout is less stable than eCFR's XSD-backed XML, so this output is best-effort and should be spot-checked.`)
lines.push('')

let fetched = 0
let failed  = 0
for (const section of SECTIONS) {
  const body = await fetchSection(section)
  if (body === null) {
    failed++
    continue
  }
  lines.push(`## § ${section.citation} — ${section.title}`)
  lines.push('')
  lines.push(`> Source: ${section.url}`)
  lines.push('')
  lines.push(body)
  lines.push('')
  fetched++
}

if (fetched === 0) {
  console.error('error: no sections fetched — nothing to write (check network egress to dir.ca.gov)')
  process.exit(3)
}

const md = lines.join('\n').replace(/\n{3,}/g, '\n\n')
console.error(`→ fetched ${fetched}/${SECTIONS.length} sections (${failed} failed)`)

// ── write ──────────────────────────────────────────────────────────
await fs.mkdir(path.dirname(SEED_FILE), { recursive: true })
await fs.writeFile(SEED_FILE, md, 'utf-8')
const stat = await fs.stat(SEED_FILE)
console.error(`→ wrote ${SEED_FILE} (${(stat.size / 1024).toFixed(1)} KB)`)

// ── ingest ────────────────────────────────────────────────────────
if (!doIngest) {
  console.error('')
  console.error('Done. Skipping --ingest. Add --ingest to also embed + insert into the RAG corpus.')
  console.error('')
  console.error('Before --ingest, confirm the MANIFEST entry in:')
  console.error('  apps/web/app/api/superadmin/knowledge/seed-regulations/route.ts')
  console.error('references file: "cal-osha-title-8-loto-master.md"')
  process.exit(failed > 0 ? 6 : 0)
}

const baseUrl = process.env.SOTERIA_BASE_URL
const token   = process.env.SOTERIA_SUPERADMIN_TOKEN
if (!baseUrl || !token) {
  console.error('error: --ingest requires SOTERIA_BASE_URL and SOTERIA_SUPERADMIN_TOKEN env vars')
  process.exit(4)
}

console.error(`→ POST ${baseUrl}/api/superadmin/knowledge/seed-regulations`)
const ingestResp = await fetch(`${baseUrl}/api/superadmin/knowledge/seed-regulations`, {
  method: 'POST',
  headers: {
    'authorization': `Bearer ${token}`,
    'content-type':  'application/json',
  },
})
const ingestBody = await ingestResp.text()
console.error(`  HTTP ${ingestResp.status}`)
console.error(ingestBody)
process.exit(ingestResp.ok ? 0 : 5)
