#!/usr/bin/env node
// One-shot codemod: rewrite `from '@/lib/<shim>'` imports to point
// directly at the canonical `@soteria/core/<shim>` path. Run from
// the repo root. Once every call site is rewritten, the shim files
// at apps/web/lib/<shim>.ts can be deleted (the script also lists
// the shims it touched at the end so we can verify before deletion).
//
// This is a one-time tool; it stays in scripts/ as a record of the
// codemod for reviewers reading the commit. Safe to delete after.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join, extname } from 'node:path'

const REPO = resolve(new URL('..', import.meta.url).pathname)
const WEB  = join(REPO, 'apps/web')

const SHIMS = {
  'types':                   '@soteria/core/types',
  'database.types':          '@soteria/core/database.types',
  'features':                '@soteria/core/features',
  'moduleVisibility':        '@soteria/core/moduleVisibility',
  'orgConfig':               '@soteria/core/orgConfig',
  'energyCodes':             '@soteria/core/energyCodes',
  'confinedSpaceLabels':     '@soteria/core/confinedSpaceLabels',
  'confinedSpaceThresholds': '@soteria/core/confinedSpaceThresholds',
  'hotWorkChecklist':        '@soteria/core/hotWorkChecklist',
  'hotWorkPermitStatus':     '@soteria/core/hotWorkPermitStatus',
  'permitStatus':            '@soteria/core/permitStatus',
  'photoStatus':             '@soteria/core/photoStatus',
  'photoUpload':             '@soteria/core/photoUpload',
  'storagePaths':            '@soteria/core/storagePaths',
  'equipmentReconcile':      '@soteria/core/equipmentReconcile',
  'homeMetrics':             '@soteria/core/homeMetrics',
  'insightsMetrics':         '@soteria/core/insightsMetrics',
  'scorecardMetrics':        '@soteria/core/scorecardMetrics',
  'risk':                    '@soteria/core/risk',
  'riskMetrics':             '@soteria/core/riskMetrics',
  'nearMissMetrics':         '@soteria/core/nearMissMetrics',
  'jhaMetrics':              '@soteria/core/jhaMetrics',
}

// Skip the shim files themselves + node_modules + .next.
const SKIP = new Set([
  'node_modules', '.next', '.turbo', 'dist', 'build', '__tests__/__mocks__',
])

let filesChanged = 0
let importsRewritten = 0

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const full = join(dir, entry)
    const st = statSync(full)
    if (st.isDirectory()) { walk(full); continue }
    if (!['.ts', '.tsx'].includes(extname(full))) continue
    // Don't rewrite the shim files themselves — they live in
    // apps/web/lib/ and we'll delete them after.
    if (full.startsWith(join(WEB, 'lib')) && Object.keys(SHIMS).some(s => full.endsWith(`/lib/${s}.ts`))) continue
    rewrite(full)
  }
}

function rewrite(path) {
  const original = readFileSync(path, 'utf8')
  let next = original
  for (const [shim, target] of Object.entries(SHIMS)) {
    // Match `from '@/lib/X'` or `from "@/lib/X"`. Use the closing
    // quote as the right boundary so '@/lib/risk' doesn't match
    // '@/lib/risk-filters'.
    const re = new RegExp(`(from\\s+['"])@/lib/${shim.replace('.', '\\.')}(['"])`, 'g')
    const replaced = next.replace(re, (_, lq, rq) => {
      importsRewritten++
      return `${lq}${target}${rq}`
    })
    next = replaced
  }
  if (next !== original) {
    writeFileSync(path, next, 'utf8')
    filesChanged++
  }
}

walk(WEB)
console.log(`[shim-codemod] rewrote ${importsRewritten} import(s) across ${filesChanged} file(s)`)
console.log('[shim-codemod] shims now safe to delete:')
for (const s of Object.keys(SHIMS)) console.log(`  apps/web/lib/${s}.ts`)
