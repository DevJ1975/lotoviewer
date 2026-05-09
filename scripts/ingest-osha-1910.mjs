#!/usr/bin/env node
/**
 * scripts/ingest-osha-1910.mjs
 *
 * Fetches Federal OSHA 29 CFR Part 1910 from the eCFR API, converts
 * the XML to a single RAG-ready markdown file, and (with --ingest)
 * pushes it through /api/superadmin/knowledge/seed-regulations to
 * embed and ingest into the assistant's knowledge base.
 *
 * Why a CLI script and not an in-app crawler:
 *   - eCFR rate-limits and we don't want a web request hanging while
 *     a user clicks "ingest" in the UI.
 *   - The whole Part 1910 XML is several MB; parsing it in a Vercel
 *     function would routinely time out.
 *   - The script can be re-run after each annual eCFR update without
 *     a deploy.
 *
 * Usage:
 *   # 1. Fetch XML, write markdown to apps/web/seed/, no DB writes:
 *   node scripts/ingest-osha-1910.mjs
 *
 *   # 2. Pin to a specific eCFR date (default: 2026-05-07 per the
 *   #    source map):
 *   node scripts/ingest-osha-1910.mjs --date 2026-05-07
 *
 *   # 3. Generate AND ingest in one shot. Requires SOTERIA_BASE_URL
 *   #    and SOTERIA_SUPERADMIN_TOKEN env vars:
 *   SOTERIA_BASE_URL=https://soteriafield.app \
 *   SOTERIA_SUPERADMIN_TOKEN=<bearer> \
 *   node scripts/ingest-osha-1910.mjs --ingest
 *
 * Output:
 *   apps/web/seed/federal-osha-29-cfr-1910-master.md
 *
 * After ingest, the assistant's RAG corpus will include every
 * section of Part 1910 as a `regulation` source with
 * tenant_id = NULL (visible to every tenant).
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const REPO_ROOT  = path.resolve(__dirname, '..')
const SEED_FILE  = path.join(REPO_ROOT, 'apps', 'web', 'seed', 'federal-osha-29-cfr-1910-master.md')

// ── arg parse ──────────────────────────────────────────────────────
const args = process.argv.slice(2)
let pinDate = '2026-05-07'
let doIngest = false
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--date' || a === '-d') { pinDate = args[++i] }
  else if (a === '--ingest' || a === '-i') { doIngest = true }
  else if (a === '--help' || a === '-h') {
    console.error(`Usage: node scripts/ingest-osha-1910.mjs [--date YYYY-MM-DD] [--ingest]`)
    process.exit(0)
  }
  else { console.error(`unknown arg: ${a}`); process.exit(2) }
}

const ECFR_URL = `https://www.ecfr.gov/api/versioner/v1/full/${pinDate}/title-29.xml?part=1910`

// ── fetch eCFR XML ─────────────────────────────────────────────────
console.error(`→ fetching ${ECFR_URL}`)
const ctrl = new AbortController()
const timer = setTimeout(() => ctrl.abort(), 90_000)
let xml
try {
  const resp = await fetch(ECFR_URL, {
    signal:  ctrl.signal,
    headers: { 'user-agent': 'SoteriaField-RAG/1.0 (+https://soteriafield.app)' },
  })
  if (!resp.ok) {
    console.error(`  ✗ HTTP ${resp.status} ${resp.statusText}`)
    process.exit(3)
  }
  xml = await resp.text()
  console.error(`  ✓ ${(xml.length / 1024 / 1024).toFixed(1)} MB`)
} finally {
  clearTimeout(timer)
}

// ── parse: walk DIV5 (PART) → DIV6 (SUBPART) → DIV8 (SECTION) ──────
//
// eCFR's CFRGRANULE.XSD shape:
//   <DIV5 TYPE="PART" N="1910"> <HEAD>...</HEAD> ... </DIV5>
//   <DIV6 TYPE="SUBPART" N="A"> <HEAD>Subpart A—General</HEAD> ... </DIV6>
//   <DIV8 TYPE="SECTION" N="1910.1"> <HEAD>§ 1910.1 Purpose and scope</HEAD>
//     <P>(a) ...</P>
//   </DIV8>
//
// Regex-based extraction works here because the eCFR schema is flat
// at the SECTION level — each DIV8 is self-contained, no nested DIV8s.
// For appendices and tables, we keep raw text content (RAG indexes
// for retrieval; perfect formatting matters less than coverage).

function unwrapTags(s) {
  // Decode common XML entities, strip tags, collapse whitespace.
  return s
    .replace(/<\/?(?:P|HEAD|FP|HD\d?|EM|E[^>]*|I|B|GPOTABLE|BOXHD|CHED|ENT|ROW|EXTRACT|NOTE|FTREF|FTNT|CITA|AUTH|SOURCE|XREF|EAR|FL-2|EDNOTE)[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x?[0-9a-fA-F]+;/g, m => {
      const isHex = /^&#x/i.test(m)
      const hex   = m.slice(isHex ? 3 : 2, -1)
      const code  = parseInt(hex, isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ' '
    })
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function extractParagraphs(div) {
  // Pull each <P> as a paragraph block; preserve <FP> (flush
  // paragraphs, used in headers + intro material) too. Tables get
  // a "[Table follows; see eCFR for formatting]" placeholder since
  // GPO tables don't render well in plain markdown — the section
  // still indexes the surrounding text for retrieval.
  const out = []
  const re = /<(P|FP|GPOTABLE|APPENDIX|EXTRACT|NOTE)\b[^>]*>([\s\S]*?)<\/\1>/gi
  let m
  while ((m = re.exec(div)) !== null) {
    const tag  = m[1].toUpperCase()
    const body = m[2]
    if (tag === 'GPOTABLE') {
      out.push('_[Table follows; see eCFR for formatted layout]_')
      const text = unwrapTags(body)
      if (text) out.push(text)
    } else {
      const text = unwrapTags(body)
      if (text) out.push(text)
    }
  }
  return out
}

function extractHead(div) {
  const m = /<HEAD\b[^>]*>([\s\S]*?)<\/HEAD>/i.exec(div)
  return m ? unwrapTags(m[1]) : ''
}

// Walk DIV5 (the part wrapper). We don't strictly need DIV5 — eCFR's
// XML may or may not include it depending on the API path. Fall back
// to the document root if no DIV5 is found.
let partXml = xml
const partMatch = /<DIV5\b[^>]*>([\s\S]*?)<\/DIV5>/i.exec(xml)
if (partMatch) partXml = partMatch[1]

// Walk DIV6 (subparts) so the markdown carries Subpart headings.
const subpartRe = /<DIV6\b[^>]*N="([^"]+)"[^>]*>([\s\S]*?)<\/DIV6>/gi
const subparts  = []
let sm
while ((sm = subpartRe.exec(partXml)) !== null) {
  subparts.push({ letter: sm[1], xml: sm[2] })
}

// Walk DIV8 (sections) inside each subpart. If no DIV6 was matched
// (older XML), walk DIV8 against the whole part.
function walkSections(scope) {
  const out = []
  const re = /<DIV8\b[^>]*N="([^"]+)"[^>]*>([\s\S]*?)<\/DIV8>/gi
  let m
  while ((m = re.exec(scope)) !== null) {
    const citation = m[1]
    const body     = m[2]
    out.push({
      citation,
      head:       extractHead(body),
      paragraphs: extractParagraphs(body),
    })
  }
  return out
}

// ── build the master markdown ──────────────────────────────────────
const lines = []
lines.push('---')
lines.push(`title: "Federal OSHA 29 CFR Part 1910 — Occupational Safety and Health Standards"`)
lines.push(`jurisdiction: "Federal OSHA"`)
lines.push(`agency: "Occupational Safety and Health Administration, Department of Labor"`)
lines.push(`citation: "29 CFR Part 1910"`)
lines.push(`source_url: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910"`)
lines.push(`api_url: "${ECFR_URL}"`)
lines.push(`retrieved_date: "${pinDate}"`)
lines.push(`generator: "scripts/ingest-osha-1910.mjs"`)
lines.push(`source_status: "eCFR is authoritative but unofficial; the official legal print CFR is updated annually through govinfo.gov."`)
lines.push('---')
lines.push('')
lines.push('# 29 CFR Part 1910 — Occupational Safety and Health Standards')
lines.push('')
lines.push(`> Generated from eCFR ${pinDate}. See https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910 for the live source.`)
lines.push('')

let totalSections = 0
const groupingScope = subparts.length > 0 ? subparts : [{ letter: null, xml: partXml }]
for (const sp of groupingScope) {
  if (sp.letter) {
    const head = extractHead(sp.xml) || `Subpart ${sp.letter}`
    lines.push(`## ${head}`)
    lines.push('')
  }
  const sections = walkSections(sp.xml)
  for (const sec of sections) {
    const cite = `§ ${sec.citation}`
    const heading = sec.head ? `${cite} — ${sec.head.replace(/^§\s*\d+(?:\.\d+)*\s*/, '')}` : cite
    lines.push(`### ${heading}`)
    lines.push('')
    for (const p of sec.paragraphs) {
      lines.push(p)
      lines.push('')
    }
    totalSections++
  }
}

const md = lines.join('\n').replace(/\n{3,}/g, '\n\n')
console.error(`→ parsed ${subparts.length} subparts, ${totalSections} sections`)

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
  console.error('Before --ingest, add an entry to the MANIFEST in:')
  console.error('  apps/web/app/api/superadmin/knowledge/seed-regulations/route.ts')
  console.error('with file: "federal-osha-29-cfr-1910-master.md"')
  process.exit(0)
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
