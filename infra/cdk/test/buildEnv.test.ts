import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildEnvFile, valuesToMask } from '../lib/buildEnv'

const identity = { commitSha: 'abc123', deployEnvironment: 'aws-production' }

test('carries public and Sentry build keys plus the build identity', () => {
  const file = buildEnvFile({
    NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
    SENTRY_AUTH_TOKEN: 'sntrys_token',
    SUPABASE_SERVICE_ROLE_KEY: 'server-only',
  }, identity)

  assert.match(file, /^NEXT_PUBLIC_SUPABASE_URL=https:\/\/x\.supabase\.co$/m)
  assert.match(file, /^SENTRY_AUTH_TOKEN=sntrys_token$/m)
  assert.match(file, /^NEXT_PUBLIC_VERCEL_ENV=aws-production$/m)
  assert.match(file, /^NEXT_PUBLIC_COMMIT_SHA=abc123$/m)
  assert.match(file, /^SENTRY_RELEASE=abc123$/m)
})

test('server-only secrets never reach the build', () => {
  assert.doesNotMatch(buildEnvFile({ SUPABASE_SERVICE_ROLE_KEY: 'server-only' }, identity), /SERVICE_ROLE/)
})

test('omits empty values instead of writing them', () => {
  assert.doesNotMatch(buildEnvFile({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: '' }, identity), /TURNSTILE/)
})

test('refuses values the .env loader would rewrite', () => {
  for (const value of ['a$b', 'a#b', 'a"b', "a'b", 'a\\b', 'a\nb']) {
    assert.throws(() => buildEnvFile({ NEXT_PUBLIC_X: value }, identity), /NEXT_PUBLIC_X contains/)
  }
})

test('masks secret values but not browser-visible ones', () => {
  assert.deepEqual(
    valuesToMask({ NEXT_PUBLIC_SUPABASE_URL: 'public', ANTHROPIC_API_KEY: 'sk-ant', EMPTY: '' }),
    ['sk-ant'],
  )
})
