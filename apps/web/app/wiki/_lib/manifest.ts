// Wiki manifest — single source of truth lives in manifest.json so the
// `npm run check:wiki` script (scripts/check-wiki-sync.mjs) can read it
// without parsing TypeScript. This file types it for the React side.
//
// To add a new module:
//   1. Append an entry to manifest.json.
//   2. Create apps/web/app/wiki/<slug>/page.tsx.
//   3. The wiki index card and the check script pick it up automatically.

import data from './manifest.json'

export interface ManifestEntry {
  slug:     string
  module:   string
  tagline:  string
  category: 'safety' | 'reports' | 'admin' | 'workspace' | 'public'
  href:     string | null
  wikiPage: string
  sources:  string[]
}

export const WIKI_MANIFEST: ManifestEntry[] = data.entries as ManifestEntry[]

export function manifestBySlug(slug: string): ManifestEntry | undefined {
  return WIKI_MANIFEST.find(e => e.slug === slug)
}

export const WIKI_CATEGORIES: { id: ManifestEntry['category']; label: string; blurb: string }[] = [
  { id: 'safety',    label: 'Safety modules',     blurb: 'Day-to-day field workflows.' },
  { id: 'reports',   label: 'Reports & exports',  blurb: 'Roll-ups, KPIs, and audit packages.' },
  { id: 'admin',     label: 'Admin',              blurb: 'Org-level configuration. Admin role required.' },
  { id: 'workspace', label: 'Your workspace',     blurb: 'Per-user settings and account flows.' },
  { id: 'public',    label: 'Public portals',     blurb: 'Tokenized links sent to people without a Soteria account.' },
]
