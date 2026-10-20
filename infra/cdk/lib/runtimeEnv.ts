// Contract between the `soteria/web/env` secret and the container.
//
// ECS refuses to start a task whose secret lacks a referenced JSON key, and an
// empty-string value is not the same as an unset one (`?? fallback` keeps the
// empty string). So the task injects exactly the keys present in the secret,
// and only these must be present. The list mirrors the "Required" entries in
// apps/web/.env.example; keep the two in step.
export const REQUIRED_SECRET_KEYS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPERADMIN_EMAILS',
  'NEXT_PUBLIC_SENTRY_DSN',
  'SENTRY_DSN',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
  // Also the credential the scheduled cron invoker sends.
  'INTERNAL_PUSH_SECRET',
  'INSPECTOR_TOKEN_SECRET',
  'RESEND_API_KEY',
  'INVITE_FROM_EMAIL',
  'ANTHROPIC_API_KEY',
  'VOYAGE_API_KEY',
  'NEXT_PUBLIC_APP_URL',
] as const

// Only `next build` reads these (Sentry source-map upload). They never reach
// the running container.
export const BUILD_ONLY_KEYS: ReadonlySet<string> = new Set([
  'SENTRY_AUTH_TOKEN',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
])

const ENV_KEY = /^[A-Z][A-Z0-9_]*$/

/**
 * Given the keys present in the secret, returns the ones to inject into the
 * container. Throws, naming every problem at once, if a required key is
 * missing or a key is not a valid environment variable name.
 */
export function runtimeSecretKeys(presentKeys: readonly string[]): string[] {
  const present = new Set(presentKeys)
  const missing = REQUIRED_SECRET_KEYS.filter(key => !present.has(key))
  const invalid = presentKeys.filter(key => !ENV_KEY.test(key))

  const problems = [
    missing.length && `missing required keys: ${missing.join(', ')}`,
    invalid.length && `invalid key names: ${invalid.join(', ')}`,
  ].filter(Boolean)
  if (problems.length) throw new Error(`soteria/web/env secret is ${problems.join('; ')}`)

  return [...present].filter(key => !BUILD_ONLY_KEYS.has(key)).sort()
}
