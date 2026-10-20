import { test } from 'node:test'
import assert from 'node:assert/strict'
import { REQUIRED_SECRET_KEYS, runtimeSecretKeys } from '../lib/runtimeEnv'

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
