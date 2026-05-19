#!/usr/bin/env node
/**
 * Seed the Working at Heights manual into the AI knowledge base.
 *
 * Reads the structured manual content from
 * apps/web/app/wiki/working-at-heights/_content.ts, builds one
 * `module_manual` knowledge_document with one knowledge_chunk per
 * section, embeds via Voyage AI, and writes to the same tables the
 * /assistant route reads from. The wiki page renders the same
 * content from the same file — the operator and the assistant always
 * see exactly the same prose.
 *
 * Idempotent: the document is keyed by (tenant_id IS NULL, source_type,
 * title). Re-running with unchanged content matches the existing
 * sha256 and skips. Edits trigger a re-embed and replace.
 *
 * Usage:
 *   node apps/web/scripts/seed-working-at-heights-manual.mjs [--dry-run] [--limit N]
 *
 * Env required:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VOYAGE_API_KEY
 */

import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..', '..', '..')

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
const dryRun = !!args['dry-run']
const limit  = args.limit ? Number(args.limit) : Infinity

// ── env ─────────────────────────────────────────────────────────────────

const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY
const VOYAGE_KEY    = process.env.VOYAGE_API_KEY

if (!dryRun) {
  if (!SUPABASE_URL)  { console.error('NEXT_PUBLIC_SUPABASE_URL not set'); process.exit(2) }
  if (!SERVICE_ROLE)  { console.error('SUPABASE_SERVICE_ROLE_KEY not set'); process.exit(2) }
  if (!VOYAGE_KEY)    { console.error('VOYAGE_API_KEY not set'); process.exit(2) }
}

// ── Load manual content ──────────────────────────────────────────────────
//
// The TS source is plain data — no React, no Node-incompatible
// imports — so a dynamic `import()` will resolve it whenever the
// host loader understands TS. The two supported invocations are:
//
//   npx tsx apps/web/scripts/seed-working-at-heights-manual.mjs
//   node --import tsx apps/web/scripts/seed-working-at-heights-manual.mjs
//
// Either way, tsx's hook is registered before the script runs and the
// import below resolves the TS file. Plain `node script.mjs` will
// fail at the import — we surface a clean error so the operator knows
// which invocation to retry with.

const contentTsPath = resolve(repo, 'apps/web/app/wiki/working-at-heights/_content.ts')

async function loadSections() {
  try {
    const mod = await import(contentTsPath)
    // tsx wraps default + named depending on the source shape; merge both.
    const exports = { ...mod, ...(mod.default ?? {}) }
    if (!Array.isArray(exports.SECTIONS)) {
      throw new Error(`SECTIONS not exported by ${contentTsPath}`)
    }
    return {
      sections:    exports.SECTIONS,
      title:       exports.MANUAL_TITLE,
      version:     exports.MANUAL_VERSION,
      lastUpdated: exports.MANUAL_LAST_UPDATED,
    }
  } catch (err) {
    throw new Error(
      `Could not load ${contentTsPath}. Re-run via:\n` +
      `  npx tsx apps/web/scripts/seed-working-at-heights-manual.mjs\n` +
      `Underlying error: ${err.message}`,
    )
  }
}

// ── Format a section as the text that will be embedded ───────────────────
//
// Concatenate paragraphs, bullets, dodonts, citations into a single
// text block per section. The chunk_index is the section index in
// the manual; the metadata records the section id + title so the
// assistant can cite "Working at Heights manual — Anchor points".

function sectionToText(section) {
  const parts = []
  parts.push(`# ${section.title}`)
  parts.push('')
  for (const p of section.paragraphs) parts.push(p)
  if (section.bullets && section.bullets.length > 0) {
    parts.push('')
    for (const b of section.bullets) parts.push(`- ${b}`)
  }
  if (section.dodonts) {
    parts.push('')
    parts.push('Do:')
    for (const d of section.dodonts.dos)   parts.push(`- ${d}`)
    parts.push('')
    parts.push("Don't:")
    for (const d of section.dodonts.donts) parts.push(`- ${d}`)
  }
  if (section.citations && section.citations.length > 0) {
    parts.push('')
    parts.push('Citations:')
    for (const c of section.citations) parts.push(`- ${c.label} — ${c.url}`)
  }
  return parts.join('\n')
}

// ── Voyage AI embedding ──────────────────────────────────────────────────

async function embed(texts) {
  if (dryRun) return texts.map(() => new Array(1024).fill(0))
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method:  'POST',
    headers: { 'authorization': `Bearer ${VOYAGE_KEY}`, 'content-type': 'application/json' },
    body:    JSON.stringify({
      model:      'voyage-3-large',
      input:      texts,
      input_type: 'document',
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Voyage embed failed: ${res.status} ${body}`)
  }
  const json = await res.json()
  return json.data.map(d => d.embedding)
}

// ── Supabase upsert ──────────────────────────────────────────────────────

async function supabaseFetch(path, init = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      'apikey':        SERVICE_ROLE,
      'authorization': `Bearer ${SERVICE_ROLE}`,
      'content-type':  'application/json',
      'prefer':        'return=representation',
    },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Supabase ${init.method ?? 'GET'} ${path} failed: ${res.status} ${body}`)
  }
  return res.status === 204 ? null : res.json()
}

async function findExistingDoc(title) {
  const path = `/knowledge_documents?source_type=eq.module_manual&tenant_id=is.null&title=eq.${encodeURIComponent(title)}&select=id,content_sha256`
  const rows = await supabaseFetch(path)
  return rows[0] ?? null
}

async function insertDoc({ title, version, lastUpdated, sha, chunkCount }) {
  const row = {
    tenant_id:      null,
    source_type:    'module_manual',
    title,
    jurisdiction:   'federal+ca',
    effective_date: lastUpdated,
    source_url:     '/wiki/working-at-heights',
    content_sha256: sha,
    chunk_count:    chunkCount,
    metadata:       { manual_version: version },
  }
  if (dryRun) return { id: '00000000-0000-0000-0000-000000000000', ...row }
  const inserted = await supabaseFetch('/knowledge_documents', { method: 'POST', body: JSON.stringify(row) })
  return inserted[0]
}

async function deleteDocChunks(documentId) {
  if (dryRun) return
  await supabaseFetch(`/knowledge_chunks?document_id=eq.${documentId}`, { method: 'DELETE' })
}

async function deleteDoc(documentId) {
  if (dryRun) return
  await supabaseFetch(`/knowledge_documents?id=eq.${documentId}`, { method: 'DELETE' })
}

async function insertChunks(documentId, rows) {
  if (dryRun) return
  // Insert in batches of 50 to stay under PostgREST request-size limits.
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50).map(r => ({ ...r, document_id: documentId }))
    await supabaseFetch('/knowledge_chunks', { method: 'POST', body: JSON.stringify(batch) })
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  console.log(`[seed-wah] loading manual from ${contentTsPath}`)
  const { sections, title, version, lastUpdated } = await loadSections()
  console.log(`[seed-wah] ${sections.length} section(s), version ${version}, last updated ${lastUpdated}`)

  // Compose the full text once for sha. The hash is over the
  // operator-visible content, so any edit to a paragraph, bullet,
  // or citation invalidates the cache.
  const texts = sections.slice(0, limit).map(sectionToText)
  const fullText = texts.join('\n\n---\n\n')
  const sha = createHash('sha256').update(fullText).digest('hex')
  console.log(`[seed-wah] content sha256: ${sha.slice(0, 16)}…`)

  const existing = await dryRunOrFind(title)
  if (existing && existing.content_sha256 === sha) {
    console.log('[seed-wah] ✓ no change — manual already at this sha. Done.')
    return
  }
  if (existing) {
    console.log(`[seed-wah] sha mismatch — deleting old document ${existing.id} + chunks before re-insert`)
    await deleteDocChunks(existing.id)
    await deleteDoc(existing.id)
  }

  console.log(`[seed-wah] embedding ${texts.length} chunk(s) via Voyage…`)
  const embeddings = await embed(texts)

  console.log('[seed-wah] inserting document + chunks')
  const doc = await insertDoc({
    title,
    version,
    lastUpdated,
    sha,
    chunkCount: texts.length,
  })
  const rows = texts.map((text, i) => ({
    chunk_index: i,
    text,
    embedding:   embeddings[i],
    token_count: Math.ceil(text.length / 4), // rough estimate
    metadata:    {
      section_id:    sections[i].id,
      section_title: sections[i].title,
      manual_version: version,
    },
  }))
  await insertChunks(doc.id, rows)

  console.log(`[seed-wah] ✓ inserted ${rows.length} chunk(s) as document ${doc.id}${dryRun ? ' (dry-run)' : ''}`)
}

async function dryRunOrFind(title) {
  if (dryRun) return null
  return findExistingDoc(title)
}

main().catch(err => {
  console.error('[seed-wah] FAILED:', err.message)
  if (process.env.DEBUG_SEED) console.error(err.stack)
  process.exit(1)
})
