import { describe, it, expect } from 'vitest'
import {
  canVerifyAction,
  summarizeActions,
  type ActionStatus,
} from '@soteria/core/nonconformity'

describe('canVerifyAction (separation of duty)', () => {
  it('allows a different user to verify a completed action', () => {
    expect(canVerifyAction({ status: 'completed', completed_by_user_id: 'alice' }, 'bob')).toBe(true)
  })

  it('blocks the completer from verifying their own work', () => {
    expect(canVerifyAction({ status: 'completed', completed_by_user_id: 'alice' }, 'alice')).toBe(false)
  })

  it('blocks verification until the action is completed', () => {
    expect(canVerifyAction({ status: 'open', completed_by_user_id: null }, 'bob')).toBe(false)
    expect(canVerifyAction({ status: 'in_progress', completed_by_user_id: null }, 'bob')).toBe(false)
  })

  it('requires both a recorded completer and a current user', () => {
    expect(canVerifyAction({ status: 'completed', completed_by_user_id: null }, 'bob')).toBe(false)
    expect(canVerifyAction({ status: 'completed', completed_by_user_id: 'alice' }, null)).toBe(false)
  })
})

describe('summarizeActions', () => {
  const mk = (...statuses: ActionStatus[]) => statuses.map(status => ({ status }))

  it('counts outstanding as anything not verified or cancelled', () => {
    expect(summarizeActions(mk('open', 'in_progress', 'completed'))).toEqual({
      total: 3, outstanding: 3, verified: 0,
    })
  })

  it('excludes verified and cancelled from outstanding', () => {
    expect(summarizeActions(mk('verified', 'cancelled', 'open'))).toEqual({
      total: 3, outstanding: 1, verified: 1,
    })
  })

  it('handles an empty list', () => {
    expect(summarizeActions([])).toEqual({ total: 0, outstanding: 0, verified: 0 })
  })
})
