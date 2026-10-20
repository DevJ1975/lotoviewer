import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { decideImport, loadProtectedMedia, type ExistingModule } from '@/lib/strike/packageImport'
import type { StrikePackagePlan, StrikePackageVersionPlan } from '@/lib/strike/package'

function version(locale: 'en' | 'es'): StrikePackageVersionPlan {
  return {
    documentName: locale === 'en' ? 'module.json' : `module.${locale}.json`,
    locale,
    title: `Title ${locale}`,
    content: { blocks: [] },
    questions: [],
    passingScore: 80,
    retakeLimit: null,
    validityDays: 365,
    downloadPath: null,
  }
}

function plan(locales: Array<'en' | 'es'>): StrikePackagePlan {
  return {
    slug: 'loto-102', title: 'LOTO 102', description: null, category: null, tags: [], estimatedMinutes: 5,
    mediaPrefix: 'global/loto-102/v1', versions: locales.map(version), uploads: [], ignored: [],
  }
}

function existing(versions: Array<{ number: number; status: string; locale: string }>): ExistingModule {
  return {
    id: 'mod-1',
    status: 'published',
    versions: versions.map(v => ({ id: `v${v.number}`, version_number: v.number, status: v.status, locale: v.locale })),
  }
}

describe('decideImport', () => {
  it('creates a module with one version per language, English first', () => {
    const decision = decideImport(plan(['en', 'es']), null)
    expect(decision.moduleAction).toBe('create')
    expect(decision.versions).toEqual([
      { locale: 'en', action: 'create', versionNumber: 1 },
      { locale: 'es', action: 'create', versionNumber: 2 },
    ])
  })

  it('updates a draft in place instead of stacking versions', () => {
    const decision = decideImport(plan(['en']), existing([{ number: 1, status: 'draft', locale: 'en' }]))
    expect(decision.versions).toEqual([{ locale: 'en', action: 'update', versionId: 'v1', versionNumber: 1 }])
  })

  it('refuses to overwrite a language that is only published', () => {
    const decision = decideImport(plan(['en']), existing([{ number: 1, status: 'published', locale: 'en' }]))
    expect(decision.versions[0]!.action).toBe('refused')
    expect((decision.versions[0] as { reason: string }).reason).toMatch(/Version 1 \(en\) is published/)
  })

  it('adds a translation as the next version number of a published module', () => {
    const decision = decideImport(
      plan(['en', 'es']),
      existing([{ number: 1, status: 'published', locale: 'en' }, { number: 2, status: 'in_review', locale: 'en' }]),
    )
    expect(decision.versions).toEqual([
      { locale: 'en', action: 'update', versionId: 'v2', versionNumber: 2 },
      { locale: 'es', action: 'create', versionNumber: 3 },
    ])
  })

  it('lists every upload that would land on media in use elsewhere', () => {
    const withUploads = { ...plan(['en']), uploads: ['a.jpg', 'b.mp3'].map(name => ({ name, bucketPath: `global/loto-102/v1/${name}`, contentType: 'x', size: 1 })) }
    expect(decideImport(withUploads, null, new Set(['global/loto-102/v1/b.mp3'])).conflicts).toEqual(['global/loto-102/v1/b.mp3'])
    expect(decideImport(withUploads, null).conflicts).toEqual([])
  })
})

describe('loadProtectedMedia', () => {
  const scene = (path: string) => ({
    blocks: [{
      kind: 'motion_scene', key: 's1', title: 'Scene', on_screen_text: [],
      image: { path, alt: 'alt', ai_generated: true, approved_by: null, approved_at: null },
      narration: null,
    }],
  })
  function adminWith(rows: unknown[]) {
    const pages = [rows, []]
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'order']) chain[m] = () => chain
    chain.range = async () => ({ data: pages.shift() ?? [], error: null })
    return { from: () => chain } as unknown as SupabaseClient
  }

  it("protects published media and other modules' media, but not this module's own drafts", async () => {
    const admin = adminWith([
      { module_id: 'mine', status: 'published', content: scene('global/m/v1/published.jpg'), download_path: 'global/m/v1/module.mp4' },
      { module_id: 'mine', status: 'superseded', content: scene('global/m/v0/old.jpg'), download_path: null },
      { module_id: 'mine', status: 'draft', content: scene('global/m/v2/my-draft.jpg'), download_path: null },
      { module_id: 'theirs', status: 'draft', content: scene('global/t/v1/their-draft.jpg'), download_path: null },
    ])
    expect([...await loadProtectedMedia(admin, 'mine')].sort()).toEqual([
      'global/m/v0/old.jpg', 'global/m/v1/module.mp4', 'global/m/v1/published.jpg', 'global/t/v1/their-draft.jpg',
    ])
  })

  it('protects everything in the library for a module that does not exist yet', async () => {
    const admin = adminWith([{ module_id: 'theirs', status: 'draft', content: scene('global/t/v1/x.jpg'), download_path: null }])
    expect([...await loadProtectedMedia(admin, null)]).toEqual(['global/t/v1/x.jpg'])
  })
})
