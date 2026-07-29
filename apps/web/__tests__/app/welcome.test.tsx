import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// The welcome page set-password form is exercised elsewhere; this file
// pins the verification-link failure branch: a dead invite/recovery link
// redirects here with the failure in the URL hash and NO session, and we
// must explain it rather than silently bouncing to /login.

const replace = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace }) }))

const authState = {
  userId: null as string | null,
  email: null as string | null,
  profile: null as unknown,
  loading: false,
  refresh: vi.fn(),
  setProfile: vi.fn(),
}
vi.mock('@/components/AuthProvider', () => ({ useAuth: () => authState }))
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: vi.fn() } } }))
vi.mock('@/components/PasswordField', () => ({
  default: (props: Record<string, unknown>) => <input type="password" {...props} />,
}))

import WelcomePage from '@/app/welcome/page'

function setHash(hash: string) {
  window.location.hash = hash
}

describe('WelcomePage — verification link failure', () => {
  beforeEach(() => {
    replace.mockReset()
    authState.userId = null
    authState.email = null
    authState.profile = null
    authState.loading = false
    setHash('')
  })

  it('shows an "expired" explanation (and does not redirect) when the link hash carries an error', () => {
    setHash('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    render(<WelcomePage />)
    expect(screen.getByText(/Link expired/i)).toBeTruthy()
    expect(screen.getByText(/Email link is invalid or has expired/i)).toBeTruthy()
    expect(replace).not.toHaveBeenCalled()
  })

  it('redirects to /login when there is no session and no error hash (direct visit)', () => {
    render(<WelcomePage />)
    expect(replace).toHaveBeenCalledWith('/login')
  })
})
