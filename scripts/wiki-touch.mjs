#!/usr/bin/env node
// Wiki touch helper.
//
// Bumps `CURRENT_VERSION` (patch) and `LAST_UPDATED` (today, ISO date) on
// the wiki page for the given slug, and prepends a CHANGELOG row built
// from --message (or, by default, a generic placeholder).
//
// Usage:
//   node scripts/wiki-touch.mjs <slug> [--message="What changed"]
//   node scripts/wiki-touch.mjs hot-work --message="Added cooldown override"
//
// Run this immediately after editing a module so the matching wiki page
// has a fresh version + a changelog stub. The CI check (`npm run check:wiki`)
// will then pass on the PR.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const args = process.argv.slice(2)
if (args.length === 0 || args[0].startsWith('-')) {
  console.error('Usage: node scripts/wiki-touch.mjs <slug> [--message="Summary"]')
  process.exit(2)
}

const slug = args[0]
const messageArg = args.find(a => a.startsWith('--message='))
const message = messageArg
  ? messageArg.slice('--message='.length).replace(/^"|"$/g, '')
  : 'Module updated; see PR for details.'

const manifest = JSON.parse(readFileSync(
  resolve(repo, 'apps/web/app/wiki/_lib/manifest.json'),
  'utf8',
))
const entry = manifest.entries.find(e => e.slug === slug)
if (!entry) {
  console.error(`[wiki-touch] no manifest entry for slug "${slug}"`)
  console.error('Known slugs:', manifest.entries.map(e => e.slug).join(', '))
  process.exit(2)
}

const wikiPath = resolve(repo, entry.wikiPage)
if (!existsSync(wikiPath)) {
  console.error(`[wiki-touch] wiki page does not exist: ${entry.wikiPage}`)
  process.exit(2)
}

let src = readFileSync(wikiPath, 'utf8')

// ── Bump CURRENT_VERSION (patch) ───────────────────────────────────────
const versionRe = /const CURRENT_VERSION\s*=\s*'(\d+)\.(\d+)\.(\d+)'/
const versionMatch = src.match(versionRe)
if (!versionMatch) {
  console.error(`[wiki-touch] could not find CURRENT_VERSION in ${entry.wikiPage}`)
  process.exit(2)
}
const [maj, min, patch] = [versionMatch[1], versionMatch[2], versionMatch[3]].map(n => parseInt(n, 10))
const newVersion = `${maj}.${min}.${patch + 1}`
src = src.replace(versionRe, `const CURRENT_VERSION = '${newVersion}'`)

// ── Bump LAST_UPDATED ──────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10)
const dateRe = /const LAST_UPDATED\s*=\s*'\d{4}-\d{2}-\d{2}'/
if (!dateRe.test(src)) {
  console.error(`[wiki-touch] could not find LAST_UPDATED in ${entry.wikiPage}`)
  process.exit(2)
}
src = src.replace(dateRe, `const LAST_UPDATED    = '${today}'`)

// ── Prepend CHANGELOG row ──────────────────────────────────────────────
// Insert after the opening `[` of the CHANGELOG array literal.
// Skip past the `[]` in the type annotation (`ChangelogEntry[] = [`).
const changelogDecl = 'const CHANGELOG: ChangelogEntry[] = ['
const changelogStart = src.indexOf(changelogDecl)
if (changelogStart === -1) {
  console.error(`[wiki-touch] could not find CHANGELOG in ${entry.wikiPage}`)
  process.exit(2)
}
const insertAt = changelogStart + changelogDecl.length

const newEntry =
  `\n  {\n` +
  `    version: '${newVersion}',\n` +
  `    date:    '${today}',\n` +
  `    changes: [\n` +
  `      ${JSON.stringify(message)},\n` +
  `    ],\n` +
  `  },`

src = src.slice(0, insertAt) + newEntry + src.slice(insertAt)

writeFileSync(wikiPath, src)

console.log(`[wiki-touch] ✓ ${entry.module}`)
console.log(`             ${entry.wikiPage}`)
console.log(`             v${versionMatch[0].match(/'(.+)'/)[1]} → v${newVersion}, dated ${today}`)
console.log(`             Edit the new CHANGELOG entry to flesh out the message.`)
