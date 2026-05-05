// Knowledge-base resolver for the AI support assistant.
//
// The KB is plain markdown under lib/support/kb/. Files are read once at
// cold start (server-side only — this module must never be imported from
// a client component) and held in memory thereafter.
//
// Resolution rules (mirror docs/ai-support-bot-plan.md):
//   1. Always include `general`.
//   2. If the pathname maps to a known module AND that module is enabled
//      for the tenant, include the module file too.
//   3. Module gating uses moduleVisibility — the bot must never offer
//      help for a feature a tenant doesn't have.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isModuleVisible } from '@soteria/core/moduleVisibility'

// Each entry pairs a feature ID (from packages/core/src/features.ts) with
// the markdown filename and the route-prefix patterns that should auto-
// load it. Add new modules here as their KB files are authored.
interface KbModule {
  id:           string        // mirrors a feature id; 'general' is the always-on baseline
  featureId:    string | null // null = always show (general)
  pathPrefixes: string[]      // pathname startsWith → auto-include
  file:         string        // markdown filename inside lib/support/kb/
}

const MODULE_DEFS: KbModule[] = [
  {
    id:           'general',
    featureId:    null,
    pathPrefixes: [],
    file:         'general.md',
  },
  {
    id:           'loto',
    featureId:    'loto',
    // /loto, /equipment, /departments, /print, /import, /decommission, /status
    // all belong to the LOTO module per features.ts.
    pathPrefixes: ['/loto', '/equipment', '/departments', '/print', '/import', '/decommission', '/status'],
    file:         'loto.md',
  },
  {
    id:           'confined-spaces',
    featureId:    'confined-spaces',
    // The CS module owns /confined-spaces/* including its sub-pages.
    pathPrefixes: ['/confined-spaces'],
    file:         'confined-spaces.md',
  },
  {
    id:           'hot-work',
    featureId:    'hot-work',
    pathPrefixes: ['/hot-work'],
    file:         'hot-work.md',
  },
  {
    id:           'risk',
    // The Risk module's top-level feature id is 'risk-assessment'; the
    // /risk routes are children but moduleVisibility walks the parent
    // chain, so this is the right id to gate on.
    featureId:    'risk-assessment',
    pathPrefixes: ['/risk'],
    file:         'risk.md',
  },
]

// Lazy-loaded once per process. process.cwd() inside Next route handlers
// is the apps/web directory — KB files live alongside the resolver.
let cache: Record<string, string> | null = null
function loadAll(): Record<string, string> {
  if (cache) return cache
  const out: Record<string, string> = {}
  const baseDir = join(process.cwd(), 'lib', 'support', 'kb')
  for (const m of MODULE_DEFS) {
    out[m.id] = readFileSync(join(baseDir, m.file), 'utf8')
  }
  cache = out
  return out
}

export interface ResolveKbArgs {
  pathname:      string | null
  tenantModules: Record<string, boolean> | null | undefined
}

export interface ResolvedKb {
  loadedIds:     string[]
  systemContext: string
}

export function resolveKb({ pathname, tenantModules }: ResolveKbArgs): ResolvedKb {
  const path  = (pathname ?? '').toLowerCase()
  const files = loadAll()
  const picks: KbModule[] = []
  for (const m of MODULE_DEFS) {
    if (m.id === 'general') { picks.push(m); continue }
    const matchesPath = m.pathPrefixes.some(p => path === p || path.startsWith(p + '/'))
    if (!matchesPath) continue
    if (m.featureId && !isModuleVisible(m.featureId, tenantModules ?? null)) continue
    picks.push(m)
  }
  return {
    loadedIds:     picks.map(p => p.id),
    systemContext: picks
      .map(p => `### ${p.id.toUpperCase()}\n\n${(files[p.id] ?? '').trim()}`)
      .join('\n\n---\n\n'),
  }
}

export function listKbIds(): string[] {
  return MODULE_DEFS.map(m => m.id)
}

// Test seam: lets the resolver be exercised without disk I/O. The unit
// tests inject deterministic fixtures via this hook so they run in jsdom.
export function _setKbCacheForTests(c: Record<string, string> | null): void {
  cache = c
}
