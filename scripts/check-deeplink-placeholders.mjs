#!/usr/bin/env node
// Refuses to ship `apple-app-site-association` / `assetlinks.json` /
// `eas.json` while they still contain `REPLACE_WITH_*` placeholders.
// Wire into CI ahead of `next build` and ahead of `eas submit` so a
// production deploy can never go out with the scaffold values intact.
//
// Skipped when `ALLOW_DEEPLINK_PLACEHOLDERS=1` (so local `next dev` and
// `next build` don't trip on them while we're still wiring secrets).
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const TARGETS = [
  'apps/web/public/.well-known/apple-app-site-association',
  'apps/web/public/.well-known/assetlinks.json',
  'apps/mobile/eas.json',
]

if (process.env.ALLOW_DEEPLINK_PLACEHOLDERS === '1') {
  console.log('[deeplink-check] skipped (ALLOW_DEEPLINK_PLACEHOLDERS=1)')
  process.exit(0)
}

let bad = 0
for (const rel of TARGETS) {
  const path = resolve(repo, rel)
  if (!existsSync(path)) continue
  const text = readFileSync(path, 'utf8')
  const matches = text.match(/REPLACE_WITH_[A-Z0-9_]+/g)
  if (matches && matches.length > 0) {
    bad++
    console.error(`[deeplink-check] ${rel} still has placeholders:`)
    for (const m of new Set(matches)) console.error(`  - ${m}`)
  }
}

if (bad > 0) {
  console.error('\nFix the placeholders above before deploying, or set')
  console.error('ALLOW_DEEPLINK_PLACEHOLDERS=1 to bypass for a local build.')
  process.exit(1)
}
console.log('[deeplink-check] OK')
