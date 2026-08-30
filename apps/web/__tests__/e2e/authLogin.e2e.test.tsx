// End-to-end scenarios for authentication — the sign-in journey from a
// cold deep link through to an idle auto-logout.
//
// "End-to-end" here follows the convention set by
// workingAtHeights.e2e.test.ts: no browser is driven, but every layer
// the operator's sign-in actually touches runs through its real code
// path — the login form, AuthProvider's session + profile load,
// AuthGate's route guard, the redirect sanitiser, the welcome-back
// hint in localStorage, and the idle timer that ends the session.
//
// The single substitute is the Supabase backend: `installBackend`
// below stands in for GoTrue plus the `profiles` table, holding one
// in-memory user directory that every layer reads through. Everything
// above that boundary is the shipping code.
//
// Each `it()` reads as a story: "Operator does X, the system should
// reach state Y." When the chain breaks, the failing scenario names
// the step that broke it.

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Profile } from '@soteria/core/types'

const { supabaseAuth, fromMock, router, nav, tenant } = vi.hoisted(() => ({
  // Method identities stay stable across tests; only their
  // implementations are re-installed per scenario.
  supabaseAuth: {
    getSession:         vi.fn(),
    onAuthStateChange:  vi.fn(),
    signInWithPassword: vi.fn(),
    signOut:            vi.fn(),
  },
  fromMock: vi.fn(),
  router:   { replace: vi.fn(), push: vi.fn(), refresh: vi.fn(), back: vi.fn() },
  // Mutable stand-in for the URL the App Router would supply.
  nav:      { pathname: '/', search: '' },
  // AuthGate reads the active-tenant role; a plain member is the
  // default so /admin gating never interferes with these scenarios.
  tenant:   { role: 'member' as string | null, loading: false },
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: supabaseAuth, from: (table: string) => fromMock(table) },
  ACTIVE_TENANT_KEY:   'soteria.activeTenantId',
  ACTIVE_FACILITY_KEY: 'soteria.activeFacilityId',
}))

vi.mock('next/navigation', () => ({
  useRouter:       () => router,
  usePathname:     () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}))

vi.mock('@/components/TenantProvider', () => ({ useTenant: () => tenant }))

import { AuthProvider, LAST_LOGIN_KEY, useAuth } from '@/components/AuthProvider'
import AuthGate from '@/components/AuthGate'
import IdleLogout from '@/components/IdleLogout'
import LoginPage from '@/app/login/page'

// ── Fake Supabase backend ──────────────────────────────────────────────────

interface SeededUser {
  password: string
  profile:  Profile | null
}

interface Backend {
  /** Session currently held by the fake GoTrue, or null when signed out. */
  session:     () => { user: { id: string; email: string } } | null
  /** Puts a user in an already-signed-in state before the first render. */
  startSignedIn: (email: string) => void
}

function makeProfile(over: Partial<Profile> & Pick<Profile, 'id' | 'email'>): Profile {
  return {
    full_name:               'Dana Rivera',
    avatar_url:              null,
    is_admin:                false,
    is_superadmin:           false,
    must_change_password:    false,
    onboarding_completed_at: '2026-01-04T00:00:00.000Z',
    created_at:              '2026-01-01T00:00:00.000Z',
    updated_at:              '2026-01-04T00:00:00.000Z',
    ...over,
  }
}

function installBackend(users: Record<string, SeededUser>): Backend {
  const directory = new Map(
    Object.entries(users).map(([email, u]) => [email.toLowerCase(), u]),
  )
  const listeners = new Set<(event: string, session: unknown) => void>()
  let session: { user: { id: string; email: string } } | null = null

  const emit = (event: string) => { for (const l of [...listeners]) l(event, session) }

  supabaseAuth.getSession.mockImplementation(async () => ({ data: { session } }))

  supabaseAuth.onAuthStateChange.mockImplementation(
    (cb: (event: string, session: unknown) => void) => {
      listeners.add(cb)
      return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
    },
  )

  supabaseAuth.signInWithPassword.mockImplementation(
    async ({ email, password }: { email: string; password: string }) => {
      const user = directory.get(email.toLowerCase())
      // GoTrue deliberately returns one message for both "no such user"
      // and "wrong password" — no account enumeration.
      if (!user || user.password !== password) {
        return { data: { session: null }, error: { message: 'Invalid login credentials' } }
      }
      session = { user: { id: user.profile?.id ?? email, email } }
      emit('SIGNED_IN')
      return { data: { session }, error: null }
    },
  )

  supabaseAuth.signOut.mockImplementation(async () => {
    session = null
    emit('SIGNED_OUT')
    return { error: null }
  })

  fromMock.mockImplementation((table: string) => {
    if (table !== 'profiles') throw new Error(`unexpected table in auth flow: ${table}`)
    return {
      select: () => ({
        eq: (_column: string, id: string) => ({
          maybeSingle: async () => {
            for (const user of directory.values()) {
              if (user.profile?.id === id) return { data: user.profile, error: null }
            }
            return { data: null, error: null }
          },
        }),
      }),
    }
  })

  return {
    session: () => session,
    startSignedIn: (email: string) => {
      const user = directory.get(email.toLowerCase())
      if (!user) throw new Error(`cannot start signed in as unseeded user: ${email}`)
      session = { user: { id: user.profile?.id ?? email, email } }
    },
  }
}

// ── Render helpers ─────────────────────────────────────────────────────────

function Protected() {
  return <div data-testid="protected">Equipment EQ-1</div>
}

/** Renders the login screen exactly as app/layout.tsx composes it. */
async function renderLogin() {
  nav.pathname = '/login'
  const view = render(<AuthProvider><LoginPage /></AuthProvider>)
  // AuthProvider resolves getSession on mount; let that settle so the
  // form is interactive before the scenario types into it.
  await screen.findByRole('button', { name: /sign in/i })
  return view
}

/** Renders a guarded route the way AuthGate wraps every page. */
async function renderGuarded(pathname: string) {
  nav.pathname = pathname
  const view = render(
    <AuthProvider><AuthGate><Protected /></AuthGate></AuthProvider>,
  )
  await waitFor(() => expect(supabaseAuth.getSession).toHaveBeenCalled())
  return view
}

function emailField(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[type="email"]')
  if (!el) throw new Error('email field not rendered')
  return el
}

function passwordField(): HTMLInputElement {
  const el = document.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')
  if (!el) throw new Error('password field not rendered')
  return el
}

/** Destination of the most recent client-side navigation. */
function lastReplace(): string | undefined {
  return router.replace.mock.calls.at(-1)?.[0] as string | undefined
}

async function signInAs(email: string, password: string) {
  fireEvent.change(emailField(), { target: { value: email } })
  fireEvent.change(passwordField(), { target: { value: password } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

const OPERATOR = 'dana.rivera@example.com'
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111'

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  nav.pathname = '/'
  nav.search   = ''
  tenant.role    = 'member'
  tenant.loading = false
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Scenario 1: a signed-out operator deep-links into the app ────────────
//
// A QR code or a shared link drops someone straight onto a protected
// route with no session. They must land on /login, the destination must
// survive the bounce, and the protected UI must never paint — a flash of
// equipment data before the redirect is a disclosure, not a cosmetic bug.

describe('E2E — signed-out deep link bounces to the login screen', () => {
  it('redirects to /login with the destination preserved', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })

    await renderGuarded('/loto/EQ-1')

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/login?next=%2Floto%2FEQ-1'),
    )
  })

  it('never renders the protected page while the redirect is in flight', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })

    await renderGuarded('/loto/EQ-1')

    await waitFor(() => expect(router.replace).toHaveBeenCalled())
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('lets the public sign-in surfaces render without a session', async () => {
    installBackend({})

    for (const path of ['/login', '/forgot-password', '/reset-password', '/accept-invite']) {
      router.replace.mockClear()
      const view = await renderGuarded(path)
      await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument())
      expect(router.replace).not.toHaveBeenCalled()
      view.unmount()
    }
  })
})

// ─── Scenario 2: the wrong password is rejected ───────────────────────────
//
// The failure path has to fail closed: an error the operator can read,
// no session, and nothing cached that would let the next visit skip a
// step. A stale "welcome back" hint written on a failed attempt would
// tell a shared iPad's next holder who tried to sign in.

describe('E2E — a bad password is refused and leaves no trace', () => {
  it('surfaces the GoTrue error and keeps the operator on the form', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })

    await renderLogin()
    await signInAs(OPERATOR, 'battery-staple')

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
    expect(backend.session()).toBeNull()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('writes no welcome-back hint for a failed attempt', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })

    await renderLogin()
    await signInAs(OPERATOR, 'battery-staple')

    await screen.findByText('Invalid login credentials')
    expect(window.localStorage.getItem(LAST_LOGIN_KEY)).toBeNull()
  })

  it('gives the same message for an unknown address — no account enumeration', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })

    await renderLogin()
    await signInAs('nobody@example.com', 'correct-horse')

    expect(await screen.findByText('Invalid login credentials')).toBeInTheDocument()
  })
})

// ─── Scenario 3: the golden path ──────────────────────────────────────────
//
// Correct credentials must carry the operator all the way through:
// session established, profile loaded, deep-link honoured, and the
// avatar hint cached so the next visit greets them by name.

describe('E2E — correct credentials complete the journey', () => {
  it('establishes the session and lands on the deep-linked destination', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    nav.search = 'next=%2Floto%2FEQ-1'

    await renderLogin()
    await signInAs(`  ${OPERATOR}  `, 'correct-horse')

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/loto/EQ-1'))
    expect(backend.session()).not.toBeNull()
    // Surrounding whitespace from an autofill or a barcode scanner must
    // not reach GoTrue, which matches the address verbatim.
    expect(supabaseAuth.signInWithPassword).toHaveBeenCalledWith({
      email:    OPERATOR,
      password: 'correct-horse',
    })
  })

  it('caches the welcome-back hint for the next visit', async () => {
    installBackend({
      [OPERATOR]: {
        password: 'correct-horse',
        profile: makeProfile({
          id:         OPERATOR_ID,
          email:      OPERATOR,
          full_name:  'Dana Rivera',
          avatar_url: 'https://cdn.example.com/dana.png',
        }),
      },
    })

    await renderLogin()
    await signInAs(OPERATOR, 'correct-horse')

    await waitFor(() =>
      expect(JSON.parse(window.localStorage.getItem(LAST_LOGIN_KEY) ?? 'null')).toEqual({
        email:      OPERATOR,
        avatar_url: 'https://cdn.example.com/dana.png',
        full_name:  'Dana Rivera',
      }),
    )
  })

  it('opens the guarded route once the session exists', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    backend.startSignedIn(OPERATOR)

    await renderGuarded('/loto/EQ-1')

    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })

  it('bounces an already-signed-in visitor away from /login', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    backend.startSignedIn(OPERATOR)

    await renderLogin()

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  })
})

// ─── Scenario 4: the returning operator ───────────────────────────────────
//
// Shared field tablets are handed between shifts. The hint speeds up
// the common case (same person, same device) but must step aside the
// moment someone signs in as themselves instead.

describe('E2E — the welcome-back hint recognises the last operator', () => {
  it('prefills the email and greets the cached user by name', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    window.localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({
      email: OPERATOR, avatar_url: null, full_name: 'Dana Rivera',
    }))

    await renderLogin()

    await waitFor(() => expect(emailField().value).toBe(OPERATOR))
    expect(screen.getByText('Dana Rivera')).toBeInTheDocument()
  })

  it('drops the hint as soon as a different address is typed', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    window.localStorage.setItem(LAST_LOGIN_KEY, JSON.stringify({
      email: OPERATOR, avatar_url: null, full_name: 'Dana Rivera',
    }))

    await renderLogin()
    await waitFor(() => expect(screen.getByText('Dana Rivera')).toBeInTheDocument())

    fireEvent.change(emailField(), { target: { value: 'sam.okafor@example.com' } })

    expect(screen.queryByText('Dana Rivera')).toBeNull()
  })

  it('survives a corrupt localStorage entry rather than blocking sign-in', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    window.localStorage.setItem(LAST_LOGIN_KEY, '{not json')

    await renderLogin()

    expect(emailField().value).toBe('')
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument()
  })
})

// ─── Scenario 5: a poisoned ?next= is refused ─────────────────────────────
//
// /login?next=<path> exists so a deep link survives the bounce, and it
// arrives straight from the URL bar. Every one of these values is a
// working off-site redirect if the sanitiser is skipped: browsers
// normalise the backslash, and the tab is stripped before parsing.

describe('E2E — the post-login redirect can only land on this origin', () => {
  const hostile = [
    'https://evil.example.com/steal',
    '//evil.example.com',
    '/\\evil.example.com',
    '/\t/evil.example.com',
    'javascript:alert(1)',
  ]

  for (const target of hostile) {
    it(`sends the operator home instead of ${JSON.stringify(target)}`, async () => {
      installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
      nav.search = `next=${encodeURIComponent(target)}`

      await renderLogin()
      await signInAs(OPERATOR, 'correct-horse')

      await waitFor(() => expect(router.replace).toHaveBeenCalled())
      for (const [dest] of router.replace.mock.calls) {
        expect(dest).toBe('/')
      }
    })
  }

  it('keeps a legitimate in-app deep link intact, query and all', async () => {
    installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    nav.search = `next=${encodeURIComponent('/loto/EQ-1?tab=steps#lockout')}`

    await renderLogin()
    await signInAs(OPERATOR, 'correct-horse')

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/loto/EQ-1?tab=steps#lockout'),
    )
  })
})

// ─── Scenario 6: first login must change the password ─────────────────────
//
// An invited user signs in with the credential an admin issued. Until
// they replace it, /welcome is the only page they may reach — including
// when a deep link says otherwise.

describe('E2E — a first-login account is pinned to /welcome', () => {
  const INVITEE = 'sam.okafor@example.com'
  const INVITEE_ID = '22222222-2222-4222-8222-222222222222'

  function seedInvitee() {
    return installBackend({
      [INVITEE]: {
        password: 'issued-by-admin',
        profile: makeProfile({
          id:                      INVITEE_ID,
          email:                   INVITEE,
          full_name:               'Sam Okafor',
          must_change_password:    true,
          onboarding_completed_at: null,
        }),
      },
    })
  }

  // Not just "ends up at /welcome" — never routed to the deep link at all.
  // AuthProvider holds `loading` until the profile lands, so the page has
  // must_change_password in hand before it decides. Without that the
  // session arrives a tick early and the operator transits the protected
  // route before being pulled back.
  it('ignores the deep link and routes to /welcome after sign-in', async () => {
    seedInvitee()
    nav.search = 'next=%2Floto%2FEQ-1'

    await renderLogin()
    await signInAs(INVITEE, 'issued-by-admin')

    await waitFor(() => expect(lastReplace()).toBe('/welcome'))
    expect(router.replace).not.toHaveBeenCalledWith('/loto/EQ-1')
  })

  it('pulls them back to /welcome from any other route', async () => {
    const backend = seedInvitee()
    backend.startSignedIn(INVITEE)

    await renderGuarded('/loto/EQ-1')

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/welcome'))
  })

  it('leaves them alone once they are on /welcome', async () => {
    const backend = seedInvitee()
    backend.startSignedIn(INVITEE)

    await renderGuarded('/welcome')

    await waitFor(() => expect(screen.getByTestId('protected')).toBeInTheDocument())
    expect(router.replace).not.toHaveBeenCalled()
  })
})

// ─── Scenario 7: privileged areas stay shut ───────────────────────────────
//
// The server is the source of truth for authorization, but a plain
// member who taps an /admin bookmark must not see the admin shell
// render while the API refuses underneath.

describe('E2E — a plain member cannot open the admin areas', () => {
  function seedSignedIn(over: Partial<Profile> = {}) {
    const backend = installBackend({
      [OPERATOR]: {
        password: 'correct-horse',
        profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR, ...over }),
      },
    })
    backend.startSignedIn(OPERATOR)
    return backend
  }

  it('sends a member away from /admin', async () => {
    seedSignedIn()
    await renderGuarded('/admin/people')
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  })

  it('sends a tenant admin away from /superadmin', async () => {
    seedSignedIn({ is_admin: true })
    tenant.role = 'admin'
    await renderGuarded('/superadmin/tenants')
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'))
  })

  it('admits an owner of the active tenant to /admin', async () => {
    seedSignedIn()
    tenant.role = 'owner'
    await renderGuarded('/admin/people')
    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(router.replace).not.toHaveBeenCalled()
  })
})

// ─── Scenario 8: the profile row is missing ───────────────────────────────
//
// A user can exist in auth.users with no `profiles` row — a half-applied
// invite. Authentication still succeeds, so the app must let them in
// rather than hang, but the gap has to be loud: silent profile-fetch
// failures are what made the admin menu vanish more than once.

describe('E2E — authentication survives a missing profile row', () => {
  it('signs the user in and warns about the missing row', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: null } })
    backend.startSignedIn(OPERATOR)

    await renderGuarded('/loto/EQ-1')

    expect(await screen.findByTestId('protected')).toBeInTheDocument()
    expect(warn).toHaveBeenCalledWith(
      '[auth] no profile row for user',
      OPERATOR,
      '— admin/first-login flows will not fire',
    )
  })
})

// ─── Scenario 9: the tablet is left on a bench ────────────────────────────
//
// Shared iPads sit in control rooms and break areas. After 30 minutes
// of no activity the session must end by itself, and the very next
// guarded render must bounce to /login — the chain, not just the timer.

describe('E2E — 30 idle minutes end the session', () => {
  // Testing Library's async helpers poll on real timers, which the fake
  // clock below freezes — so this block advances time by hand and asserts
  // synchronously rather than reaching for waitFor / findBy.
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  function Screenful() {
    return (
      <AuthProvider>
        <IdleLogout />
        <AuthGate><Protected /></AuthGate>
      </AuthProvider>
    )
  }

  /** Lets the session + profile promises resolve on the fake clock. */
  async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  }

  async function idle(ms: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  }

  async function renderIdleScreen() {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    backend.startSignedIn(OPERATOR)
    nav.pathname = '/loto/EQ-1'
    render(<Screenful />)
    await settle()
    await settle()
    expect(screen.getByTestId('protected')).toBeInTheDocument()
    return { backend }
  }

  it('stays quiet through 29 minutes of stillness', async () => {
    await renderIdleScreen()

    await idle(29 * 60_000)

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(screen.getByTestId('protected')).toBeInTheDocument()
  })

  it('warns in the final minute before signing out', async () => {
    await renderIdleScreen()

    await idle(29 * 60_000 + 1_000)

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Signing out soon')
  })

  it('signs out at 30 minutes and bounces to /login with the route preserved', async () => {
    const { backend } = await renderIdleScreen()

    await idle(30 * 60_000 + 1_000)
    await settle()

    expect(backend.session()).toBeNull()
    expect(router.replace).toHaveBeenCalledWith('/login?next=%2Floto%2FEQ-1')
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('a tap at minute 29 buys another full window', async () => {
    const { backend } = await renderIdleScreen()

    await idle(29 * 60_000 + 1_000)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()

    await act(async () => { fireEvent.pointerDown(window) })
    await idle(29 * 60_000)

    expect(backend.session()).not.toBeNull()
    expect(screen.getByTestId('protected')).toBeInTheDocument()
  })
})

// ─── Scenario 10: signing out ─────────────────────────────────────────────
//
// Sign-out must drop the session everywhere at once, but deliberately
// keeps the welcome-back hint so the same person's next visit is one
// password away rather than a full re-entry.

describe('E2E — sign-out clears the session but remembers the face', () => {
  function SignOutButton() {
    const { signOut } = useAuth()
    return <button type="button" onClick={() => { void signOut() }}>Sign out</button>
  }

  it('drops the session and re-guards the route', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    backend.startSignedIn(OPERATOR)
    nav.pathname = '/loto/EQ-1'

    render(
      <AuthProvider>
        <SignOutButton />
        <AuthGate><Protected /></AuthGate>
      </AuthProvider>,
    )
    await screen.findByTestId('protected')

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/login?next=%2Floto%2FEQ-1'),
    )
    expect(backend.session()).toBeNull()
    expect(screen.queryByTestId('protected')).toBeNull()
  })

  it('keeps the welcome-back hint for the next visit', async () => {
    const backend = installBackend({ [OPERATOR]: { password: 'correct-horse', profile: makeProfile({ id: OPERATOR_ID, email: OPERATOR }) } })
    backend.startSignedIn(OPERATOR)
    nav.pathname = '/loto/EQ-1'

    render(<AuthProvider><SignOutButton /><AuthGate><Protected /></AuthGate></AuthProvider>)
    await screen.findByTestId('protected')
    await waitFor(() => expect(window.localStorage.getItem(LAST_LOGIN_KEY)).not.toBeNull())

    fireEvent.click(screen.getByRole('button', { name: /sign out/i }))

    await waitFor(() => expect(backend.session()).toBeNull())
    expect(JSON.parse(window.localStorage.getItem(LAST_LOGIN_KEY) ?? 'null')).toMatchObject({
      email: OPERATOR,
    })
  })
})
