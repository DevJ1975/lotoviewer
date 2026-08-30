#!/usr/bin/env node
// Operator CLI for the multi-agent LOTO audit.
//
// Drives the audit over HTTP against a running Soteria deployment (same posture
// as scripts/ingest-osha-1910.mjs — a standalone script that talks to the app,
// not an import of the app's TS internals). It:
//
//   1. POSTs to start a run (optionally scoped to a department / id list / limit).
//   2. Polls progress, printing processed/total.
//   3. RESUMES the run if a serverless invocation was reclaimed mid-sweep (the
//      engine skips equipment already finished, so this is safe + idempotent).
//   4. Optionally mints the audit review link and prints its URL.
//
// Nothing here applies anything to the live tables — that happens only after a
// human approves changes through the review link and an admin runs Apply.
//
// Env:
//   SOTERIA_BASE_URL      e.g. https://soteriafield.app  (default http://localhost:3000)
//   SOTERIA_BEARER_TOKEN  a tenant owner/admin access token (required)
//   SOTERIA_TENANT_ID     the active tenant UUID         (required)
//
// Usage:
//   node apps/web/scripts/run-loto-audit.mjs --department "Cheese Curl" --limit 20 --mint-link
//   node apps/web/scripts/run-loto-audit.mjs            # full active sweep
//   node apps/web/scripts/run-loto-audit.mjs --resume <run_id>

const BASE   = (process.env.SOTERIA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN  = process.env.SOTERIA_BEARER_TOKEN || ''
const TENANT = process.env.SOTERIA_TENANT_ID || ''

function parseArgs(argv) {
  const args = { mintLink: false, pollSec: 10, maxStalls: 3 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--department') args.department = argv[++i]
    else if (a === '--limit') args.limit = Number(argv[++i])
    else if (a === '--equipment-ids') args.equipmentIds = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--resume') args.resume = argv[++i]
    else if (a === '--mint-link') args.mintLink = true
    else if (a === '--poll-interval') args.pollSec = Number(argv[++i])
    else if (a === '--max-stalls') args.maxStalls = Number(argv[++i])
  }
  return args
}

function usage() {
  console.log(`Run the multi-agent LOTO audit.

Env:  SOTERIA_BASE_URL, SOTERIA_BEARER_TOKEN (owner/admin), SOTERIA_TENANT_ID
Flags:
  --department <name>      Scope to one department
  --limit <n>              Cap the number of equipment
  --equipment-ids a,b,c    Scope to specific equipment ids
  --resume <run_id>        Continue an existing run
  --mint-link              Print the audit review link when the run is ready
  --poll-interval <sec>    Poll cadence (default 10)
  --max-stalls <n>         Re-kick after N stalled polls (default 3)`)
}

function headers() {
  return {
    'authorization':   `Bearer ${TOKEN}`,
    'x-active-tenant': TENANT,
    'content-type':    'application/json',
  }
}

async function api(path, init = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers || {}) } })
  const text = await res.text()
  let body
  try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${body.error || text}`)
  return body
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }
  if (!TOKEN || !TENANT) {
    console.error('ERROR: SOTERIA_BEARER_TOKEN and SOTERIA_TENANT_ID are required.')
    process.exit(2)
  }

  // Start or resume.
  let runId = args.resume
  if (runId) {
    console.log(`Resuming run ${runId} …`)
    await api('/api/admin/loto/audit', { method: 'POST', body: JSON.stringify({ resume_run_id: runId }) })
  } else {
    const scope = { only_active: true }
    if (args.department) scope.department = args.department
    if (Number.isFinite(args.limit)) scope.limit = args.limit
    if (args.equipmentIds) scope.equipment_ids = args.equipmentIds
    const started = await api('/api/admin/loto/audit', { method: 'POST', body: JSON.stringify(scope) })
    runId = started.run_id
    console.log(`Started run ${runId} (scope: ${JSON.stringify(scope)})`)
  }

  // Poll, resuming on stall.
  let lastProcessed = -1
  let stalls = 0
  for (;;) {
    await sleep(Math.max(2, args.pollSec) * 1000)
    const { run } = await api(`/api/admin/loto/audit/${runId}`)
    console.log(`  status=${run.status} processed=${run.processed_equipment}/${run.total_equipment}`)
    if (run.status === 'awaiting_review' || run.status === 'applied' || run.status === 'partially_applied') break
    if (run.status === 'failed' || run.status === 'cancelled') {
      console.error(`Run ${run.status}: ${run.error || '(no detail)'}`)
      process.exit(1)
    }
    if (run.processed_equipment === lastProcessed) {
      stalls += 1
      if (stalls >= args.maxStalls) {
        console.log('  (stalled — re-kicking)')
        await api('/api/admin/loto/audit', { method: 'POST', body: JSON.stringify({ resume_run_id: runId }) })
        stalls = 0
      }
    } else {
      stalls = 0
      lastProcessed = run.processed_equipment
    }
  }

  console.log('Run finished processing — ready for review.')
  if (args.mintLink) {
    const { review_url } = await api(`/api/admin/loto/audit/${runId}/review-link`, { method: 'POST', body: '{}' })
    console.log(`\nReview link: ${review_url}\n`)
  }
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1) })
