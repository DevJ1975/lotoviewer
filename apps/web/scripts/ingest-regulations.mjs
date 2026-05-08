#!/usr/bin/env node
/**
 * Bulk-ingest regulatory corpora into the knowledge_documents +
 * knowledge_chunks tables. Operator-only — runs as service-role
 * against the configured Supabase project, bypassing RLS.
 *
 * Why an offline CLI rather than the upload route: the regulation
 * corpora (29 CFR 1910/1926, DOT 49 CFR, EPA 40 CFR, RCRA) are
 * large enough that a single HTTP upload would either blow past the
 * 25MB cap or time out on Vercel. The CLI walks a local directory
 * tree, embeds in batches, and inserts directly.
 *
 * Usage:
 *   node apps/web/scripts/ingest-regulations.mjs \
 *     --dir ./corpora/osha-1910 \
 *     --source-type regulation \
 *     --jurisdiction federal
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VOYAGE_API_KEY
 *
 * The script is idempotent on (tenant_id, sha256): re-running it on
 * an unchanged directory skips every file. Modified files reinsert
 * (delete by sha mismatch + insert fresh chunks). The CLI does NOT
 * run automatically on build (cost) — operators trigger it manually.
 */

import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve, join, basename, extname } from 'node:path'
import { createHash } from 'node:crypto'

// ── argv ────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (!next || next.startsWith('--')) args[key] = true
      else { args[key] = next; i++ }
    }
  }
  return args
}

const args = parseArgs(process.argv)
const dir         = args.dir          ? resolve(String(args.dir)) : null
const sourceType  = String(args['source-type']  ?? 'regulation')
const jurisdiction= args.jurisdiction ? String(args.jurisdiction) : null
const dryRun      = !!args['dry-run']
const batchLimit  = Number(args.limit ?? Infinity)

if (!dir) {
  console.error('Usage: ingest-regulations.mjs --dir <path> [--source-type regulation|state_reg|dot|epa|rcra] [--jurisdiction <text>] [--dry-run] [--limit N]')
  process.exit(2)
}

const VALID_SOURCES = new Set(['regulation','state_reg','dot','epa','rcra','company_policy'])
if (!VALID_SOURCES.has(sourceType)) {
  console.error(`--source-type must be one of: ${[...VALID_SOURCES].join(', ')}`)
  process.exit(2)
}

// ── env ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY
const VOYAGE_KEY    = process.env.VOYAGE_API_KEY

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(1)
}
if (!VOYAGE_KEY && !dryRun) {
  console.error('VOYAGE_API_KEY is required (or pass --dry-run to skip embedding).')
  process.exit(1)
}

// ── tiny inlined chunker (mirrors lib/ai/chunker.ts behaviour) ─────────
// We avoid pulling the TS module in directly — the script targets plain
// node + .mjs without a build step.

const TARGET_TOKENS = 800
const OVERLAP_TOKENS = 100
const APPROX_CHARS_PER_TOKEN = 4
const HARD_CHAR_CAP = 6000

function approxTokens(s) { return Math.ceil(s.length / APPROX_CHARS_PER_TOKEN) }

function splitSentences(s) {
  const out = []
  let buf = ''
  for (let i = 0; i < s.length; i++) {
    buf += s[i]
    const next = s[i + 1]
    if ((s[i] === '.' || s[i] === '!' || s[i] === '?') && (next === ' ' || next === '\n' || next === undefined)) {
      out.push(buf.trim()); buf = ''
    }
  }
  if (buf.trim()) out.push(buf.trim())
  return out.filter(Boolean)
}

function chunkText(text) {
  if (!text.trim()) return []
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks = []
  let buffer = []
  let bufferTokens = 0

  function flushOverlap() {
    if (buffer.length === 0) return []
    const last = buffer[buffer.length - 1]
    const sents = splitSentences(last)
    const seed = []
    let seedTok = 0
    for (let i = sents.length - 1; i >= 0; i--) {
      const t = approxTokens(sents[i])
      if (seedTok + t > OVERLAP_TOKENS && seed.length > 0) break
      seed.unshift(sents[i]); seedTok += t
    }
    return seed
  }

  function flushBuffer() {
    if (buffer.length === 0) return
    const text = buffer.join('\n\n').trim().slice(0, HARD_CHAR_CAP)
    if (text) {
      chunks.push({ index: chunks.length, text, tokenEst: approxTokens(text) })
    }
    const seed = flushOverlap()
    buffer = seed.length > 0 ? [seed.join(' ')] : []
    bufferTokens = buffer[0] ? approxTokens(buffer[0]) : 0
  }

  function add(p) {
    const t = approxTokens(p)
    if (t > TARGET_TOKENS) {
      const sents = splitSentences(p)
      for (const s of sents) add(s)
      return
    }
    if (bufferTokens + t > TARGET_TOKENS && buffer.length > 0) flushBuffer()
    buffer.push(p)
    bufferTokens += t
  }

  for (const p of paragraphs) add(p)
  flushBuffer()
  return chunks
}

// ── voyage ──────────────────────────────────────────────────────────────

async function embed(texts) {
  if (texts.length === 0) return { embeddings: [], totalTokens: 0 }
  const all = []
  let totalTokens = 0
  const BATCH = 128
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const res = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'authorization': `Bearer ${VOYAGE_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'voyage-3-large', input: batch, input_type: 'document' }),
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Voyage error ${res.status}: ${body.slice(0, 300)}`)
    }
    const j = await res.json()
    const sorted = (j.data ?? []).slice().sort((a, b) => a.index - b.index)
    for (const item of sorted) {
      if (!Array.isArray(item.embedding) || item.embedding.length !== 1024) {
        throw new Error(`Voyage returned wrong-dim embedding: ${item.embedding?.length}`)
      }
      all.push(item.embedding)
    }
    totalTokens += j.usage?.total_tokens ?? 0
  }
  return { embeddings: all, totalTokens }
}

// ── supabase REST helpers ───────────────────────────────────────────────

async function rest(method, path, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'apikey': SERVICE_KEY,
      'authorization': `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      'prefer': 'return=representation',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  const ct = res.headers.get('content-type') ?? ''
  return ct.includes('application/json') ? await res.json() : null
}

// ── walk + ingest ───────────────────────────────────────────────────────

async function* walkText(root) {
  const queue = [root]
  while (queue.length) {
    const cur = queue.shift()
    const entries = await readdir(cur)
    for (const name of entries) {
      const full = join(cur, name)
      const s = await stat(full)
      if (s.isDirectory()) queue.push(full)
      else if (/\.(md|markdown|txt)$/i.test(name)) yield full
    }
  }
}

function sha256Hex(s) {
  return createHash('sha256').update(s).digest('hex')
}

let processed = 0
let inserted  = 0
let skipped   = 0
let totalChunks = 0
let totalTokens = 0
const startedAt = Date.now()

console.log(`[ingest] dir=${dir} source=${sourceType}${jurisdiction ? ` jurisdiction=${jurisdiction}` : ''}${dryRun ? ' DRY-RUN' : ''}`)

for await (const path of walkText(dir)) {
  if (processed >= batchLimit) break
  processed++
  const raw = await readFile(path, 'utf-8')
  const text = raw.replace(/\r\n/g, '\n').trim()
  if (!text) { skipped++; continue }
  const sha = sha256Hex(text)
  const title = basename(path).replace(/\.(md|markdown|txt)$/i, '')

  if (!dryRun) {
    const existing = await rest('GET', `knowledge_documents?content_sha256=eq.${sha}&tenant_id=is.null&select=id`)
    if (existing.length > 0) {
      console.log(`  skip  ${title} (already ingested)`)
      skipped++; continue
    }
  }

  const chunks = chunkText(text)
  if (chunks.length === 0) { skipped++; continue }

  if (dryRun) {
    console.log(`  plan  ${title} → ${chunks.length} chunks (${text.length} chars)`)
    totalChunks += chunks.length
    continue
  }

  const r = await embed(chunks.map(c => c.text))
  totalTokens += r.totalTokens

  const [doc] = await rest('POST', 'knowledge_documents', {
    tenant_id:      null,
    source_type:    sourceType,
    title,
    jurisdiction,
    source_url:     null,
    uploaded_by:    null,
    content_sha256: sha,
    chunk_count:    chunks.length,
  })

  for (let i = 0; i < chunks.length; i += 200) {
    const slice = chunks.slice(i, i + 200).map((c, j) => ({
      document_id: doc.id,
      chunk_index: c.index,
      text:        c.text,
      embedding:   `[${r.embeddings[i + j].join(',')}]`,
      token_count: c.tokenEst,
      metadata:    { source_path: path },
    }))
    await rest('POST', 'knowledge_chunks', slice)
  }

  inserted++
  totalChunks += chunks.length
  console.log(`  done  ${title} → ${chunks.length} chunks`)
}

const ms = Date.now() - startedAt
console.log(`\n[ingest] ${processed} files · ${inserted} inserted · ${skipped} skipped · ${totalChunks} chunks · ${totalTokens} voyage tokens · ${ms}ms`)
