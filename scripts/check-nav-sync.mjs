#!/usr/bin/env node
//
// check-nav-sync — fails CI when the admin landing's catalog drifts
// from the directory tree, or when FEATURES references an admin route
// that doesn't exist on disk.
//
// Post-Phase-B admin routes are section-nested:
//   apps/web/app/admin/<section>/<slug>/page.tsx
// where <section> matches ADMIN_SECTIONS[*].urlSegment in
// lib/adminCatalog.ts. This check walks that two-level layout.
//
// Checks:
//
//   1. Every directory under apps/web/app/admin/<section>/ appears in
//      lib/adminCatalog.ts exactly once. New admin routes that ship
//      without a tile fail this check.
//
//   2. Every tile in the catalog references a directory that actually
//      exists.
//
//   3. Every FEATURES entry whose href starts with /admin/ resolves to
//      a real route (top-level admin dirs no longer accept leaves;
//      every admin route is now /admin/<section>/<slug>).
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
  // Two-level walk: /admin/<section>/<slug>. Returns the pair of
  // segments so the catalog comparison can join them into a path.
  const out = []
  const sectionDirs = readdirSync(adminDir)
    .filter(name => !name.startsWith('.') && !name.startsWith('_'))
    .filter(name => !ADMIN_NON_TILE_DIRS.has(name))
    .filter(name => statSync(resolve(adminDir, name)).isDirectory())
  for (const section of sectionDirs) {
    const sectionPath = resolve(adminDir, section)
    const slugs = readdirSync(sectionPath)
      .filter(name => !name.startsWith('.') && !name.startsWith('_'))
      .filter(name => statSync(resolve(sectionPath, name)).isDirectory())
    for (const slug of slugs) {
      out.push({ section, slug, path: `${section}/${slug}` })
    }
  }
  return out
}

function loadCatalogPaths() {
  if (!existsSync(catalogPath)) {
    fail(`adminCatalog.ts missing at ${catalogPath}`)
    return []
  }
  const text = readFileSync(catalogPath, 'utf8')
  // Post-Phase-B tile syntax (helper-driven):
  //   tile('<section>', '<slug>', '<legacySlug>'|null, Icon, '...', '...')
  // We extract (section, slug) pairs from those calls. The catalog also
  // has the legacy `slug: 'x', href: '/admin/x'` literal for
  // SETTINGS_NOTIFICATIONS_TILE which lives outside /admin/ — that one
  // is filtered out below.
  const calls = [...text.matchAll(/tile\(\s*'([a-z0-9-]+)'\s*,\s*'([a-z0-9-]+)'/g)]
  return calls.map(m => ({ section: m[1], slug: m[2], path: `${m[1]}/${m[2]}` }))
}

function loadFeatureAdminHrefs() {
  if (!existsSync(featuresPath)) {
    fail(`features.ts missing at ${featuresPath}`)
    return []
  }
  const text = readFileSync(featuresPath, 'utf8')
  // Match: href: '/admin/<section>/<slug>' or any deeper sub-route.
  const matches = [...text.matchAll(/href:\s*'(\/admin\/[a-z0-9-]+(?:\/[a-z0-9-]+)*)'/g)]
  return matches.map(m => m[1])
}

const dirs           = loadAdminDirs()
const catalogEntries = loadCatalogPaths()
const featureAdminHrefs = loadFeatureAdminHrefs()

const dirPathSet     = new Set(dirs.map(d => d.path))
const catalogPathSet = new Set(catalogEntries.map(c => c.path))

// Check 1 — every dir is in the catalog.
const missingTile = dirs.filter(d => !catalogPathSet.has(d.path))
if (missingTile.length > 0) {
  fail(`${missingTile.length} admin route(s) missing a catalog tile:`)
  missingTile.forEach(d => console.error(`        - apps/web/app/admin/${d.path}/`))
  console.error('      Add an entry to apps/web/lib/adminCatalog.ts.\n')
}

// Check 2 — every catalog tile resolves to a real directory.
const orphanTile = catalogEntries.filter(c => !dirPathSet.has(c.path))
if (orphanTile.length > 0) {
  fail(`${orphanTile.length} catalog tile(s) reference a missing directory:`)
  orphanTile.forEach(c => console.error(`        - ${c.path} (no apps/web/app/admin/${c.path}/)`))
  console.error('      Remove the tile from apps/web/lib/adminCatalog.ts or restore the route.\n')
}

// Check 3 — catalog path uniqueness (section + slug pair).
const seen = new Set()
const dupes = []
for (const c of catalogEntries) {
  if (seen.has(c.path)) dupes.push(c.path)
  else seen.add(c.path)
}
if (dupes.length > 0) {
  fail(`catalog has duplicate <section>/<slug> path(s): ${[...new Set(dupes)].join(', ')}`)
}

// Check 4 — FEATURES href: /admin/<section>/<slug> resolves. Only the
// first two segments after /admin/ are required; deeper paths are
// owned by the route's own routing.
const featureBrokenHrefs = []
for (const href of featureAdminHrefs) {
  const parts = href.split('/').filter(Boolean) // ['admin', '<section>', '<slug>', ...]
  if (parts.length < 3) continue                 // /admin/<bare> — legacy shape; skip
  const path = `${parts[1]}/${parts[2]}`
  if (!dirPathSet.has(path)) featureBrokenHrefs.push({ href, path })
}
if (featureBrokenHrefs.length > 0) {
  fail(`${featureBrokenHrefs.length} FEATURES entry/entries link to a missing admin route:`)
  featureBrokenHrefs.forEach(f => console.error(`        - href: '${f.href}' (no apps/web/app/admin/${f.path}/)`))
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

ok(`${dirs.length} admin route(s); ${catalogEntries.length} catalog tile(s); ${featureAdminHrefs.length} FEATURES admin link(s) — all aligned.`)
