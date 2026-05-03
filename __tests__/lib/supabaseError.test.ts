import { describe, it, expect } from 'vitest'
import { formatSupabaseError } from '@/lib/supabaseError'

// The helper replaces an `error?.message ?? 'Could not …'` pattern that
// was scattered across permit pages and admin screens. Pin the behavior
// so a future change to the fallback wording is loud — those strings
// show up directly in user-facing error banners.

describe('formatSupabaseError', () => {
  it('returns the error message when present', () => {
    expect(formatSupabaseError({ message: 'Row not found' }, 'save'))
      .toBe('Row not found')
  })

  it('returns the fallback when the error is null', () => {
    expect(formatSupabaseError(null, 'save')).toBe('Could not save.')
  })

  it('returns the fallback when the error is undefined', () => {
    expect(formatSupabaseError(undefined, 'create permit'))
      .toBe('Could not create permit.')
  })

  it('returns the fallback when the message is empty / whitespace', () => {
    // Postgrest sometimes returns { message: '' } on RLS denials.
    expect(formatSupabaseError({ message: '' }, 'update'))
      .toBe('Could not update.')
    expect(formatSupabaseError({ message: '   ' }, 'update'))
      .toBe('Could not update.')
  })

  it('returns the fallback when message is null', () => {
    expect(formatSupabaseError({ message: null }, 'sign')).toBe('Could not sign.')
  })

  it('accepts a plain string as the error', () => {
    expect(formatSupabaseError('Network down', 'save')).toBe('Network down')
  })

  it('returns the fallback when the string error is empty', () => {
    expect(formatSupabaseError('   ', 'save')).toBe('Could not save.')
  })
})
