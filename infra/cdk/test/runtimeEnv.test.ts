import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRED_SECRET_KEYS, isVercelSystemKey, runtimeSecretKeys } from '../lib/runtimeEnv'
import { secretValuesFromDotenv } from '../scripts/sync-env-secret'

test('injects present keys, sorted, minus build-only ones', () => {
  const keys = runtimeSecretKeys([...REQUIRED_SECRET_KEYS, 'SUPPORT_EMAIL', 'SENTRY_AUTH_TOKEN', 'SENTRY_ORG'])
  assert.ok(keys.includes('SUPPORT_EMAIL'))
  assert.ok(!keys.includes('SENTRY_AUTH_TOKEN'))
  assert.ok(!keys.includes('SENTRY_ORG'))
  assert.deepEqual(keys, [...keys].sort())
})

test('optional keys absent from the secret are not injected', () => {
  assert.ok(!runtimeSecretKeys([...REQUIRED_SECRET_KEYS]).includes('INVITE_LINK_TTL_DAYS'))
})

test('names every missing required key', () => {
  const withoutTwo = REQUIRED_SECRET_KEYS.filter(k => k !== 'ANTHROPIC_API_KEY' && k !== 'SUPERADMIN_EMAILS')
  assert.throws(() => runtimeSecretKeys(withoutTwo), /missing required keys: SUPERADMIN_EMAILS, ANTHROPIC_API_KEY/)
})

test('rejects keys that are not valid environment variable names', () => {
  assert.throws(() => runtimeSecretKeys([...REQUIRED_SECRET_KEYS, 'bad-key']), /invalid key names: bad-key/)
})

test('never injects Vercel system variables, which the stack sets itself', () => {
  const keys = runtimeSecretKeys([...REQUIRED_SECRET_KEYS, 'VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'NEXT_PUBLIC_VERCEL_ENV'])
  assert.ok(!keys.some(isVercelSystemKey))
  assert.ok(keys.includes('NEXT_PUBLIC_SUPABASE_URL'))
})

test('sync-env keeps app settings and drops empty and Vercel-only entries', () => {
  const { values, dropped } = secretValuesFromDotenv([
    '# Created by Vercel CLI',
    'NEXT_PUBLIC_SUPABASE_URL="https://x.supabase.co"',
    'ANTHROPIC_API_KEY="sk-ant"',
    'SUPPORT_EMAIL=""',
    'VERCEL="1"',
    'VERCEL_GIT_COMMIT_SHA="abc"',
    'NEXT_PUBLIC_VERCEL_ENV="production"',
  ].join('\n'))
  assert.deepEqual(values, { NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', ANTHROPIC_API_KEY: 'sk-ant' })
  assert.deepEqual([...dropped].sort(), ['NEXT_PUBLIC_VERCEL_ENV', 'SUPPORT_EMAIL', 'VERCEL', 'VERCEL_GIT_COMMIT_SHA'])
})

test('a key that merely starts with VERCEL is not a system key', () => {
  assert.equal(isVercelSystemKey('VERCELLO_API_KEY'), false)
  assert.equal(isVercelSystemKey('VERCEL_URL'), true)
})
