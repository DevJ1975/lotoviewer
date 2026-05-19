// Regression suite. Each test here pins a specific behavior that was
// broken at some point in this session and fixed by a referenced PR.
// If a future refactor re-introduces the original bug, the matching
// test fails with a message that names both the bug and the fix.
//
// Adding a new regression test: include the PR number and a one-line
// summary of the original failure mode in the test's first comment
// so the reader can reach back through the history.

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ADMIN_SECTIONS, getAdminRedirects, getAllAdminTiles, SETTINGS_NOTIFICATIONS_TILE } from '@/lib/adminCatalog'
import { calculateRequiredClearance } from '@soteria/core/workingAtHeights'
import { daysUntil, expiryBand, EXPIRY_BAND_CLASS } from '@/lib/wah/inventoryHelpers'
import { resolveHref } from '@/lib/resolveHref'
import { pushRecent, loadRecents, clearRecents } from '@/lib/recentRoutes'

const REPO_APPS_WEB = resolve(__dirname, '../..')

// ─────────────────────────────────────────────────────────────────────────
// #105 — PlacardPdfPreview silently swallowed generation errors
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #105 — placard error surfacing', () => {
  // The fix replaced `catch { /* swallow */ }` with `catch (err) { ... }`
  // that surfaces err.message to the toast + console + Sentry. If a
  // future refactor reverts to the silent pattern, this grep-based
  // test catches it.
  const placardPreview = readFileSync(
    resolve(REPO_APPS_WEB, 'components/placard/PlacardPdfPreview.tsx'),
    'utf8',
  )

  it('catch block binds the error variable', () => {
    // The bug was `} catch {` (no error binding). The fix is
    // `} catch (err) {` so the message can be surfaced.
    expect(placardPreview).toMatch(/\}\s*catch\s*\(\s*err\s*\)/m)
    expect(placardPreview).not.toMatch(/\}\s*catch\s*\{[\s\S]{0,500}setUploadState\('error'\)[\s\S]{0,500}'Could not generate placard\.'/m)
  })

  it('logs to console.error for devtools triage', () => {
    expect(placardPreview).toMatch(/console\.error\(['"]\[placard\]/i)
  })

  it('captures to Sentry with the placard-pdf source tag', () => {
    expect(placardPreview).toMatch(/Sentry\.captureException/)
    expect(placardPreview).toMatch(/source:\s*['"]placard-pdf['"]/)
  })

  it('renders the real error message in the modal body (not the generic line)', () => {
    // The fix replaced `Could not generate placard.` in the empty-
    // state pane with `{errorMessage ?? 'Could not generate placard.'}`.
    expect(placardPreview).toMatch(/errorMessage\s*\?\?\s*['"]Could not generate placard\.['"]/)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// #104 — Phase B URL renames + 301 redirects
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #104 — admin URL renames + 301 redirects', () => {
  // The fix moved 29 admin routes from /admin/<slug> to
  // /admin/<section>/<slug> and added a 301 redirect table. A future
  // edit that flattens the URLs again, or drops the redirect
  // generator, breaks these.

  it('every admin tile lives at /admin/<section>/<slug> (no flat URLs)', () => {
    for (const tile of getAllAdminTiles()) {
      expect(tile.href.split('/').filter(Boolean).length).toBe(3) // ['admin', section, slug]
      expect(tile.href.startsWith('/admin/')).toBe(true)
    }
  })

  it('SETTINGS_NOTIFICATIONS_TILE is exempt (lives outside /admin)', () => {
    // The convenience tile for /settings/notifications appears on
    // the admin landing but is NOT an admin route. The check-nav
    // gate excludes it. Keep that exemption pinned.
    expect(SETTINGS_NOTIFICATIONS_TILE.href.startsWith('/settings/')).toBe(true)
  })

  it('every renamed tile carries a legacyHref the 301 generator consumes', () => {
    // PR #104 added `legacyHref` to every existing tile. New tiles
    // (Phase 2 Working at Heights) have legacyHref:null because they
    // were authored under the new URL shape from day one.
    const legacy = getAllAdminTiles().filter(t => t.legacyHref !== null)
    expect(legacy.length).toBeGreaterThan(0)
    for (const t of legacy) {
      expect(t.legacyHref!.startsWith('/admin/')).toBe(true)
      // Legacy URLs are flat — they should NOT have a section segment.
      expect(t.legacyHref!.split('/').filter(Boolean).length).toBe(2)
    }
  })

  it('the redirect table is non-empty + every entry is permanent (301)', () => {
    const redirects = getAdminRedirects()
    expect(redirects.length).toBeGreaterThan(20)
    for (const r of redirects) {
      expect(r.permanent).toBe(true)
    }
  })

  it('tile redirects carry :path* wildcards on both sides (preserves deep links)', () => {
    const tileRedirects = getAdminRedirects().filter(r => r.destination !== '/admin')
    for (const r of tileRedirects) {
      expect(r.source.endsWith('/:path*')).toBe(true)
      expect(r.destination.endsWith('/:path*')).toBe(true)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// #106 — resolveHref aligned with Phase B URL shape
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #106 — resolveHref after Phase B', () => {
  // resolveHref backs the drawer Recents section. After Phase B, the
  // canonical URL for the Members tile is /admin/people/members, NOT
  // /admin/members. The legacy URL must return null (server-side 301
  // catches it before the client sees it).

  it('resolves the post-Phase-B canonical', () => {
    const r = resolveHref('/admin/people/members')
    expect(r?.label).toBe('Members')
    expect(r?.source).toBe('admin')
  })

  it('returns null for the legacy URL (no fuzzy fallback)', () => {
    expect(resolveHref('/admin/members')).toBeNull()
  })

  it('still resolves top-level safety routes', () => {
    // The LOTO module home is /loto — should still resolve to a
    // FEATURE-source entry regardless of the admin reshape.
    const r = resolveHref('/loto')
    expect(r?.label).toBe('LOTO')
    expect(r?.source).toBe('feature')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// #103 — Recents store filters bare admin/superadmin landings
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #103 — Recents filters bare admin/superadmin landings', () => {
  // PR #103 added the drawer Recents section. The bug it pre-empts:
  // a user clicking around in admin would fill Recents with /admin
  // and /superadmin landings, crowding out actual feature surfaces.
  // The fix excludes those bare paths.

  const tenant = 'regression-tenant'

  it('/admin is excluded from Recents', () => {
    clearRecents(tenant)
    pushRecent(tenant, '/admin')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('/superadmin is excluded from Recents', () => {
    clearRecents(tenant)
    pushRecent(tenant, '/superadmin')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('deeper admin paths ARE included', () => {
    clearRecents(tenant)
    pushRecent(tenant, '/admin/people/members')
    expect(loadRecents(tenant)).toEqual(['/admin/people/members'])
  })

  it('dashboard root is excluded', () => {
    clearRecents(tenant)
    pushRecent(tenant, '/')
    expect(loadRecents(tenant)).toEqual([])
  })

  it('query strings and trailing slashes normalise (dedupe semantics)', () => {
    clearRecents(tenant)
    pushRecent(tenant, '/loto?from=qr')
    pushRecent(tenant, '/loto/')
    pushRecent(tenant, '/loto')
    expect(loadRecents(tenant)).toEqual(['/loto'])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Migration 186 — anon role revoke on destructive RPCs
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #186 — anon revoked from destructive RPCs', () => {
  // The Phase 1 identity work shipped merge_members /
  // reconcile_members_backfill / audit_member_drift as security-
  // definer RPCs. Migration 184 revoked from public + authenticated
  // but missed anon — the Supabase advisor caught that in production.
  // Migration 186 fixed it. Pin the SQL so a future migration that
  // re-grants anon execute on these functions fails here.
  const mig186 = readFileSync(
    resolve(REPO_APPS_WEB, 'migrations/186_member_rpc_anon_revoke.sql'),
    'utf8',
  )

  it('revokes anon from merge_members', () => {
    expect(mig186).toMatch(/revoke[\s\S]+merge_members[\s\S]+from anon/i)
  })

  it('revokes anon from reconcile_members_backfill', () => {
    expect(mig186).toMatch(/revoke[\s\S]+reconcile_members_backfill[\s\S]+from anon/i)
  })

  it('revokes anon from audit_member_drift', () => {
    expect(mig186).toMatch(/revoke[\s\S]+audit_member_drift[\s\S]+from anon/i)
  })

  it('revokes public/anon/authenticated from the three sync trigger functions', () => {
    for (const fn of ['sync_profile_to_members', 'sync_loto_worker_to_members', 'sync_membership_to_members']) {
      expect(mig186, `revoke from ${fn}`).toMatch(new RegExp(`revoke[\\s\\S]+${fn}\\(\\)[\\s\\S]+from public, anon, authenticated`, 'i'))
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// #102 / Phase 1 — admin landing index exists with required sections
// ─────────────────────────────────────────────────────────────────────────

describe('Regression #102 — admin landing sections are stable', () => {
  // The Phase 1 UI/UX work introduced /admin as a landing page with
  // 8 sections. Phase 2 added a 9th. The contract: the section ids
  // below MUST exist on every render so adminCatalog.test + the
  // landing page render cleanly.

  it('eight historical section ids are present', () => {
    // The `compliance` section was originally id `compliance-ops` in
    // PR #102; PR #104's Phase B URL renames also normalised the id
    // to match the cleaner urlSegment.
    const required = ['people', 'loto', 'observations', 'chemicals', 'evidence', 'compliance', 'platform', 'insights']
    const present = ADMIN_SECTIONS.map(s => s.id)
    for (const id of required) {
      expect(present, `section ${id} dropped`).toContain(id)
    }
  })

  it('Phase 2 working-at-heights section is present (post-#109)', () => {
    expect(ADMIN_SECTIONS.find(s => s.id === 'working-at-heights')).toBeDefined()
  })

  it('every section has a non-empty title + description', () => {
    for (const s of ADMIN_SECTIONS) {
      expect(s.title.length, `${s.id} title`).toBeGreaterThan(0)
      expect(s.description.length, `${s.id} description`).toBeGreaterThan(20)
    }
  })

  it('section urlSegment matches /^[a-z0-9-]+$/ — no spaces, no caps, no underscores', () => {
    for (const s of ADMIN_SECTIONS) {
      expect(s.urlSegment, `${s.id} urlSegment`).toMatch(/^[a-z0-9-]+$/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Industry-standard clearance numbers — don't let the math drift
// ─────────────────────────────────────────────────────────────────────────

describe('Regression — clearance math matches ANSI Z359 worked examples', () => {
  // The numbers below are from ANSI Z359 design guides and reproduced
  // in the Working at Heights manual. If any of these drift, both the
  // assistant's answers and the manual lose their authority.

  it('6-ft shock lanyard → 18 ft required clearance', () => {
    const r = calculateRequiredClearance({ system: 'shock_lanyard', lanyardLengthFt: 6 })
    expect(r.requiredClearanceFt).toBe(18)
  })

  it('Class 1 SRL → 10.5 ft required clearance', () => {
    const r = calculateRequiredClearance({ system: 'srl_class1' })
    expect(r.requiredClearanceFt).toBe(10.5)
  })

  it('restraint mode → 7 ft (worker + margin, no fall geometry)', () => {
    const r = calculateRequiredClearance({ system: 'restraint' })
    expect(r.requiredClearanceFt).toBe(7)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Helper regressions — the bugs the unit suite already caught,
// re-asserted here so a refactor that consolidates the helpers
// can't accidentally regress the behaviour.
// ─────────────────────────────────────────────────────────────────────────

describe('Regression — inventory helpers preserve behaviour', () => {
  it('daysUntil treats malformed input as NaN, not 0 or null', () => {
    // The early implementation returned `null` for malformed input,
    // which collapsed to "unknown" — but ALSO collapsed to null in
    // the rendering branch that distinguishes null (no expiry on
    // file) from NaN (date present but unparseable). Two failure
    // modes should render differently; pin that NaN passes through.
    expect(Number.isNaN(daysUntil('garbage'))).toBe(true)
    expect(daysUntil(null)).toBeNull()
  })

  it('expiryBand collapses both null and NaN to "unknown"', () => {
    // The rendering only cares about the band; null and NaN both
    // mean "no actionable date". Pin that the band collapse is
    // consistent.
    expect(expiryBand(null)).toBe('unknown')
    expect(expiryBand(NaN)).toBe('unknown')
  })

  it('EXPIRY_BAND_CLASS.unknown carries the dark-mode counterpart', () => {
    // The edge-case suite added dark:text-slate-500 for the unknown
    // band. A previous version had only text-slate-400. Pin both.
    expect(EXPIRY_BAND_CLASS.unknown).toMatch(/text-slate-400/)
    expect(EXPIRY_BAND_CLASS.unknown).toMatch(/dark:text-slate-500/)
  })
})
