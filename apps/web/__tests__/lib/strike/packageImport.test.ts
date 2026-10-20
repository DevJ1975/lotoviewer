import { describe, expect, it } from 'vitest'
import { decideImport, type ExistingModule } from '@/lib/strike/packageImport'
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
})
