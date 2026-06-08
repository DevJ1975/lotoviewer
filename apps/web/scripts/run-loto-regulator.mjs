#!/usr/bin/env node
// Operator CLI for the LOTO audit's Cal/OSHA Regulator review phase.
//
// Analog of scripts/run-loto-audit.mjs: a standalone script that drives the
// phase over HTTP against a running Soteria deployment (not an import of the
// app's TS internals). It:
//
//   1. POSTs to kick the regulator phase for an existing, already-audited run.
//   2. Polls the run, printing how many machines have been reviewed and whether
//      the program-level report has landed.
//   3. RE-KICKS on a stall — the phase is resumable (a machine whose
//      regulator_payload is set is skipped), so this is safe + idempotent. This
//      is the reliable path for the full ~500-machine run (no serverless window).
//
// Nothing here writes to the live LOTO tables: the regulator's critique +
// corrections are STAGED for the same human review link the audit uses. Approval
// + Apply remain the only path to a live write.
//
// Env:
//   SOTERIA_BASE_URL      e.g. https://soteriafield.app  (default http://localhost:3000)
//   SOTERIA_BEARER_TOKEN  a tenant owner/admin access token (required)
//   SOTERIA_TENANT_ID     the active tenant UUID          (required)
//
// Usage:
//   node apps/web/scripts/run-loto-regulator.mjs --run <run_id>

const BASE   = (process.env.SOTERIA_BASE_URL || 'http://localhost:3000').replace(/\/$/, '')
const TOKEN  = process.env.SOTERIA_BEARER_TOKEN || ''
const TENANT = process.env.SOTERIA_TENANT_ID || ''

function parseArgs(argv) {
  const args = { pollSec: 10, maxStalls: 3 }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--help' || a === '-h') args.help = true
    else if (a === '--run') args.run = argv[++i]
    else if (a === '--poll-interval') args.pollSec = Number(argv[++i])
    else if (a === '--max-stalls') args.maxStalls = Number(argv[++i])
  }
  return args
}

function usage() {
  console.log(`Run the LOTO audit's Cal/OSHA regulator review phase.

Env:  SOTERIA_BASE_URL, SOTERIA_BEARER_TOKEN (owner/admin), SOTERIA_TENANT_ID
Flags:
  --run <run_id>           The audited run to review (required)
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

// How many machines carry a regulator verdict so far. The admin detail GET
// returns each result's agent_phase but not regulator_payload, so we read the
// public-shaped count from the run header instead: regulator_concurs lands on
// each reviewed result. We approximate progress with the program report's
// presence + a reviewed counter derived from the results we can see.
async function snapshot(runId) {
  const { run, results } = await api(`/api/admin/loto/audit/${runId}`)
  const audited = (results ?? []).filter(r => r.agent_phase === 'ehs_done').length
  return {
    status:      run.status,
    audited,
    reportReady: run.regulator_report != null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) { usage(); return }
  if (!TOKEN || !TENANT) {
    console.error('ERROR: SOTERIA_BEARER_TOKEN and SOTERIA_TENANT_ID are required.')
    process.exit(2)
  }
  if (!args.run) {
    console.error('ERROR: --run <run_id> is required.')
    process.exit(2)
  }

  console.log(`Kicking the Cal/OSHA regulator review for run ${args.run} …`)
  await api(`/api/admin/loto/audit/${args.run}/regulator`, { method: 'POST', body: '{}' })

  // Poll until the program-level report lands, re-kicking on a stall. The phase
  // is resumable, so re-POSTing the trigger only picks up machines not yet
  // reviewed (and re-runs the program review at the end).
  let last = -1
  let stalls = 0
  for (;;) {
    await sleep(Math.max(2, args.pollSec) * 1000)
    const snap = await snapshot(args.run)
    console.log(`  audited=${snap.audited} program_report=${snap.reportReady ? 'ready' : 'pending'}`)
    if (snap.reportReady) break

    if (snap.audited === last) {
      stalls += 1
      if (stalls >= args.maxStalls) {
        console.log('  (stalled — re-kicking)')
        await api(`/api/admin/loto/audit/${args.run}/regulator`, { method: 'POST', body: '{}' })
        stalls = 0
      }
    } else {
      stalls = 0
      last = snap.audited
    }
  }

  console.log('\nRegulator review complete — program report stored on the run. Open the audit review link to read it.\n')
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1) })
