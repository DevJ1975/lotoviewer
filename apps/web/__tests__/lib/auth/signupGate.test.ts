import { describe, it, expect } from 'vitest'
import { describeSignupGate } from '@/lib/auth/signupGate'

// The daily digest reads GoTrue's own config back to catch the one auth
// setting this repo cannot enforce. A wrong "closed" verdict is the worst
// outcome — it reports the gate as shut while it stands open — so every
// shape that is not an explicit `true` must fail the check.

describe('describeSignupGate', () => {
  it('passes when signup is explicitly disabled', () => {
    const gate = describeSignupGate({ disable_signup: true, external: { email: true } })
    expect(gate.ok).toBe(true)
    expect(gate.line).toMatch(/invite-only holds/)
  })

  it('flags an open signup endpoint with the fix in the message', () => {
    const gate = describeSignupGate({ disable_signup: false })
    expect(gate.ok).toBe(false)
    expect(gate.line).toMatch(/PUBLIC SIGNUP IS OPEN/)
    expect(gate.line).toMatch(/Allow new users to sign up/)
  })

  it('reports unknown rather than passing when the field is absent', () => {
    const gate = describeSignupGate({ mailer_autoconfirm: false })
    expect(gate.ok).toBe(false)
    expect(gate.line).toMatch(/state unknown/)
  })

  it('reports unknown for a non-boolean value', () => {
    for (const value of ['false', 0, null, {}]) {
      const gate = describeSignupGate({ disable_signup: value })
      expect(gate.ok).toBe(false)
      expect(gate.line).toMatch(/state unknown/)
    }
  })

  it('reports unknown for a body that is not an object', () => {
    for (const body of [null, undefined, 'nope', 42]) {
      expect(describeSignupGate(body)).toEqual({
        ok:   false,
        line: 'Could not read disable_signup from /auth/v1/settings — state unknown.',
      })
    }
  })
})
