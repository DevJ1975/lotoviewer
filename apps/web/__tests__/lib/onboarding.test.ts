import { describe, it, expect } from 'vitest'
import { shouldShowOnboarding, ONBOARDING_STEPS } from '@/lib/onboarding'
import type { Profile } from '@soteria/core/types'

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 'u1',
    email: 'u@example.com',
    full_name: 'U',
    avatar_url: null,
    is_admin: false,
    is_superadmin: false,
    must_change_password: false,
    onboarding_completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('shouldShowOnboarding', () => {
  it('is false when there is no profile yet', () => {
    expect(shouldShowOnboarding(null)).toBe(false)
    expect(shouldShowOnboarding(undefined)).toBe(false)
  })

  it('is false while a forced password change is pending (setup comes first)', () => {
    expect(shouldShowOnboarding(profile({ must_change_password: true }))).toBe(false)
  })

  it('is false once onboarding has been completed/dismissed', () => {
    expect(shouldShowOnboarding(profile({ onboarding_completed_at: '2026-05-01T00:00:00Z' }))).toBe(false)
  })

  it('is true for a freshly set-up user who has not seen it yet', () => {
    expect(shouldShowOnboarding(profile())).toBe(true)
  })
})

describe('ONBOARDING_STEPS', () => {
  it('has at least one step and every step has a title and body', () => {
    expect(ONBOARDING_STEPS.length).toBeGreaterThan(0)
    for (const s of ONBOARDING_STEPS) {
      expect(s.title.length).toBeGreaterThan(0)
      expect(s.body.length).toBeGreaterThan(0)
    }
  })
})
