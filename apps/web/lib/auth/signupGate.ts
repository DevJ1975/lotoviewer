// Public-signup drift check for the daily health report.
//
// Every account in this product is minted server-side by
// lib/invites/provision.ts with the service-role key, which bypasses
// GoTrue's public /auth/v1/signup endpoint entirely. That endpoint must
// therefore stay closed: while it is open, anyone holding the anon key —
// which ships to every browser — can create an auth user, and the
// trg_on_auth_user_created trigger hands them a profiles row. They land
// with no tenant membership, so RLS still holds the data, but the login
// screen promises "access is by invitation only" and an open signup
// endpoint makes that untrue.
//
// The setting lives in the Supabase dashboard, not in this repo, so
// nothing here can enforce it. Noticing is the next best thing: GoTrue
// publishes its own config unauthenticated at /auth/v1/settings, so the
// daily digest reads it back and says so when it drifts open.

export interface SignupGate {
  /** True only when signup is confirmed closed. Unknown counts as not-ok. */
  ok:   boolean
  line: string
}

const CLOSED = 'Public signup is disabled — invite-only holds. ✅'
const OPEN   =
  'PUBLIC SIGNUP IS OPEN — anyone with the browser-shipped anon key can create an account. ' +
  'Turn off "Allow new users to sign up" in Supabase → Authentication → Sign In / Providers.'

export function describeSignupGate(settings: unknown): SignupGate {
  if (typeof settings !== 'object' || settings === null || !('disable_signup' in settings)) {
    return { ok: false, line: 'Could not read disable_signup from /auth/v1/settings — state unknown.' }
  }

  const disableSignup = (settings as { disable_signup: unknown }).disable_signup
  if (disableSignup === true)  return { ok: true,  line: CLOSED }
  if (disableSignup === false) return { ok: false, line: OPEN }

  // A non-boolean means GoTrue changed shape; report unknown rather than
  // guessing, since a wrong "✅" here is worse than a noisy line.
  return {
    ok:   false,
    line: `Unexpected disable_signup value ${JSON.stringify(disableSignup)} — state unknown.`,
  }
}
