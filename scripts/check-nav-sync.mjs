#!/usr/bin/env node
//
// check-nav-sync — fails CI when the admin landing's catalog drifts
// from the directory tree, or when FEATURES references an admin route
// that doesn't exist on disk.
//
// Three checks:
//
//   1. Every directory under apps/web/app/admin/ appears in
//      lib/adminCatalog.ts exactly once. New admin routes that ship
//      without a tile fail this check — the catalog stays the
//      curated single source of truth.
//
//   2. Every tile in the catalog references a directory that actually
//      exists. Removing a route without removing the tile leaves a
//      broken link on the landing page.
//
//   3. Every FEATURES entry whose href starts with /admin/ has a
//      corresponding admin directory. Catches drift the other way —
//      a feature row pointing at a deleted admin route.
//
// Reads adminCatalog.ts and features.ts as text — no tsc dependency,
// keeps the script fast and CI-friendly. The slug + href patterns
// below are deliberately strict to avoid false positives.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')

const adminDir       = resolve(repo, 'apps/web/app/admin')
const catalogPath    = resolve(repo, 'apps/web/lib/adminCatalog.ts')
const featuresPath   = resolve(repo, 'packages/core/src/features.ts')
const wikiManifest   = resolve(repo, 'apps/web/app/wiki/_lib/manifest.json')
const appDir         = resolve(repo, 'apps/web/app')

// Directories under apps/web/app/admin/ that aren't user-facing tiles
// but are routing helpers. The landing should NOT list these.
const ADMIN_NON_TILE_DIRS = new Set([
  '_components',
])

function fail(msg) {
  console.error(`[nav-sync] ✗ ${msg}`)
  process.exitCode = 1
}
function ok(msg) {
  console.log(`[nav-sync] ✓ ${msg}`)
}

function loadAdminDirs() {
  if (!existsSync(adminDir)) {
    fail(`admin directory missing at ${adminDir}`)
    return []
  }
  return readdirSync(adminDir)
    .filter(name => !name.startsWith('.'))
    .filter(name => !name.startsWith('_'))
    .filter(name => !ADMIN_NON_TILE_DIRS.has(name))
    .filter(name => statSync(resolve(adminDir, name)).isDirectory())
}

function loadCatalogSlugs() {
  if (!existsSync(catalogPath)) {
    fail(`adminCatalog.ts missing at ${catalogPath}`)
    return []
  }
  const text = readFileSync(catalogPath, 'utf8')
  // We want tiles whose URL lives under /admin/ only. The convenience
  // tile for /settings/notifications also appears in this file (as a
  // surfaced tile on the admin landing) but is not an admin route, so
  // we filter by href to scope the check.
  //
  // Tile shape we accept:
  //   slug:  'foo-bar',
  //   href:  '/admin/foo-bar',
  //
  // Adjacency-tolerant: any whitespace / newlines between slug and
  // href. Anything between them other than ASCII whitespace ends the
  // match early — keeping the regex deliberately strict.
  const matches = [...text.matchAll(/slug:\s*'([a-z0-9-]+)'\s*,\s*href:\s*'(\/[a-z0-9/-]+)'/g)]
  return matches
    .filter(m => m[2].startsWith('/admin/'))
    .map(m => m[1])
}

function loadFeatureAdminHrefs() {
  if (!existsSync(featuresPath)) {
    fail(`features.ts missing at ${featuresPath}`)
    return []
  }
  const text = readFileSync(featuresPath, 'utf8')
  // Match: href: '/admin/something' or '/admin/something/sub'.
  const matches = [...text.matchAll(/href:\s*'(\/admin\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)'/g)]
  return matches.map(m => m[1])
}

const dirs = loadAdminDirs()
const catalogSlugs = loadCatalogSlugs()
const featureAdminHrefs = loadFeatureAdminHrefs()

// Check 1 — every dir is in the catalog.
const dirSet      = new Set(dirs)
const catalogSet  = new Set(catalogSlugs)
const missingTile = [...dirSet].filter(d => !catalogSet.has(d))
if (missingTile.length > 0) {
  fail(`${missingTile.length} admin route(s) missing a catalog tile:`)
  missingTile.forEach(d => console.error(`        - apps/web/app/admin/${d}/`))
  console.error('      Add an entry to apps/web/lib/adminCatalog.ts.\n')
}

// Check 2 — every catalog slug resolves to a real directory.
const orphanTile = catalogSlugs.filter(s => !dirSet.has(s))
if (orphanTile.length > 0) {
  fail(`${orphanTile.length} catalog tile(s) reference a missing directory:`)
  orphanTile.forEach(s => console.error(`        - slug: '${s}' (no apps/web/app/admin/${s}/)`))
  console.error('      Remove the tile from apps/web/lib/adminCatalog.ts or restore the route.\n')
}

// Check 3 — catalog slug uniqueness.
const seen = new Set()
const dupes = []
for (const s of catalogSlugs) {
  if (seen.has(s)) dupes.push(s)
  else seen.add(s)
}
if (dupes.length > 0) {
  fail(`catalog has duplicate slug(s): ${[...new Set(dupes)].join(', ')}`)
}

// Check 4 — FEATURES href: /admin/* points at a real directory. Only
// the top-level segment (slug) is checked; deeper paths are owned by
// the module's own routing.
const featureBrokenHrefs = []
for (const href of featureAdminHrefs) {
  const slug = href.split('/')[2] // /admin/<slug>
  if (!slug) continue
  if (!dirSet.has(slug)) featureBrokenHrefs.push({ href, slug })
}
if (featureBrokenHrefs.length > 0) {
  fail(`${featureBrokenHrefs.length} FEATURES entry/entries link to a missing admin route:`)
  featureBrokenHrefs.forEach(f => console.error(`        - href: '${f.href}' (no apps/web/app/admin/${f.slug}/)`))
  console.error('      Update or remove the entry in packages/core/src/features.ts.\n')
}

// Check 5 — wiki manifest integrity. Every entry must have:
//   - a wikiPage that exists on disk
//   - an href that resolves to a real app route (page.tsx)
//   - a unique slug
// External URLs (http(s)://) are not validated.
function checkWikiManifest() {
  if (!existsSync(wikiManifest)) {
    fail(`wiki manifest missing at ${wikiManifest}`)
    return
  }
  let manifest
  try {
    manifest = JSON.parse(readFileSync(wikiManifest, 'utf8'))
  } catch (err) {
    fail(`wiki manifest is not valid JSON: ${err.message}`)
    return
  }
  const entries = Array.isArray(manifest.entries) ? manifest.entries : []
  if (entries.length === 0) return

  const seenSlugs   = new Set()
  const dupeSlugs   = []
  const missingWiki = []
  const brokenHref  = []

  for (const entry of entries) {
    if (typeof entry.slug !== 'string' || !entry.slug) {
      fail(`wiki manifest entry missing slug: ${JSON.stringify(entry)}`)
      continue
    }
    if (seenSlugs.has(entry.slug)) dupeSlugs.push(entry.slug)
    else seenSlugs.add(entry.slug)

    if (typeof entry.wikiPage === 'string') {
      const wp = resolve(repo, entry.wikiPage)
      if (!existsSync(wp)) missingWiki.push(entry)
    } else {
      fail(`wiki manifest entry "${entry.slug}" missing wikiPage`)
    }

    if (typeof entry.href === 'string' && entry.href.startsWith('/')) {
      // Map the href to a candidate page file. Next.js App Router
      // expects /foo to resolve to apps/web/app/foo/page.tsx (or .ts).
      // Trailing dynamic segments [param] are rare in wiki hrefs and
      // not validated here.
      const segments = entry.href.split('/').filter(Boolean)
      const candidates = [
        resolve(appDir, ...segments, 'page.tsx'),
        resolve(appDir, ...segments, 'page.ts'),
      ]
      const hit = candidates.some(c => existsSync(c))
      if (!hit) brokenHref.push(entry)
    }
  }

  if (dupeSlugs.length > 0) {
    fail(`wiki manifest has duplicate slug(s): ${[...new Set(dupeSlugs)].join(', ')}`)
  }
  if (missingWiki.length > 0) {
    fail(`${missingWiki.length} wiki manifest entry/entries reference a missing wikiPage:`)
    missingWiki.forEach(e => console.error(`        - slug: '${e.slug}' (no ${e.wikiPage})`))
  }
  if (brokenHref.length > 0) {
    fail(`${brokenHref.length} wiki manifest entry/entries reference a missing route:`)
    brokenHref.forEach(e => console.error(`        - slug: '${e.slug}' → href '${e.href}' (no apps/web/app${e.href}/page.tsx)`))
  }

  if (!process.exitCode) {
    console.log(`[nav-sync] ✓ ${entries.length} wiki manifest entry/entries — all wikiPages + hrefs resolve.`)
  }
}

checkWikiManifest()

if (process.exitCode) {
  process.exit(process.exitCode)
}

ok(`${dirs.length} admin route(s); ${catalogSlugs.length} catalog tile(s); ${featureAdminHrefs.length} FEATURES admin link(s) — all aligned.`)
