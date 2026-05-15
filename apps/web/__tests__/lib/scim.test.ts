import { describe, it, expect } from 'vitest'
import {
  parseScimUser,
  sha256HexString,
  generateScimToken,
} from '@soteria/core/scim'

// SCIM 2.0 user-payload fixtures cribbed from RFC 7644 §3.3 plus
// real-world payloads from Okta + Azure AD docs. The parser only
// extracts the fields we actually use; anything else is preserved
// in the audit log but not consumed here.

const OKTA_USER_FIXTURE = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
  externalId: '00u1abcdEFGHIJklmn07',
  userName: 'maria.gomez@acme.example',
  name: {
    formatted:  'Maria Gomez',
    givenName:  'Maria',
    familyName: 'Gomez',
  },
  emails: [
    { value: 'maria.gomez@acme.example', primary: true, type: 'work' },
    { value: 'maria@personal.example',   primary: false, type: 'home' },
  ],
  active: true,
}

describe('parseScimUser', () => {
  it('parses a well-formed Okta payload', () => {
    const result = parseScimUser(OKTA_USER_FIXTURE)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.externalId).toBe('00u1abcdEFGHIJklmn07')
    expect(result.user.userName).toBe('maria.gomez@acme.example')
    expect(result.user.fullName).toBe('Maria Gomez')
    expect(result.user.primaryEmail).toBe('maria.gomez@acme.example')
    expect(result.user.active).toBe(true)
  })

  it('falls back to givenName + familyName when name.formatted is missing', () => {
    const result = parseScimUser({
      ...OKTA_USER_FIXTURE,
      name: { givenName: 'Maria', familyName: 'Gomez' },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.fullName).toBe('Maria Gomez')
  })

  it('falls back to displayName when name is absent', () => {
    const result = parseScimUser({
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
      externalId: 'ext-1',
      userName: 'jdoe@acme.example',
      displayName: 'John Doe',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.fullName).toBe('John Doe')
  })

  it('defaults active to true when omitted', () => {
    const { active, ...rest } = OKTA_USER_FIXTURE
    void active
    const result = parseScimUser(rest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.active).toBe(true)
  })

  it('honours active=false (deactivation PATCH)', () => {
    const result = parseScimUser({ ...OKTA_USER_FIXTURE, active: false })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.active).toBe(false)
  })

  it('picks the primary email when multiple are present', () => {
    const result = parseScimUser({
      ...OKTA_USER_FIXTURE,
      emails: [
        { value: 'home@example.com',  primary: false },
        { value: 'work@example.com',  primary: true },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.primaryEmail).toBe('work@example.com')
  })

  it('falls back to the first email when none is marked primary', () => {
    const result = parseScimUser({
      ...OKTA_USER_FIXTURE,
      emails: [{ value: 'only@example.com' }],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.primaryEmail).toBe('only@example.com')
  })

  it('treats a missing emails array as no email', () => {
    const { emails, ...rest } = OKTA_USER_FIXTURE
    void emails
    const result = parseScimUser(rest)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.user.primaryEmail).toBeNull()
  })

  it('rejects a payload missing externalId', () => {
    const { externalId, ...rest } = OKTA_USER_FIXTURE
    void externalId
    const result = parseScimUser(rest)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'externalId')).toBe(true)
  })

  it('rejects a payload missing userName', () => {
    const { userName, ...rest } = OKTA_USER_FIXTURE
    void userName
    const result = parseScimUser(rest)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'userName')).toBe(true)
  })

  it('rejects a payload with no name fields at all', () => {
    const { name, ...rest } = OKTA_USER_FIXTURE
    void name
    const result = parseScimUser(rest)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'name')).toBe(true)
  })

  it('rejects non-object payloads', () => {
    expect(parseScimUser(null).ok).toBe(false)
    expect(parseScimUser('string').ok).toBe(false)
    expect(parseScimUser(42).ok).toBe(false)
  })

  it('rejects schemas that do not include the SCIM core User URN', () => {
    const result = parseScimUser({
      ...OKTA_USER_FIXTURE,
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some(e => e.field === 'schemas')).toBe(true)
  })

  it('accepts a payload with missing schemas (Okta + Azure PATCH habit)', () => {
    const { schemas, ...rest } = OKTA_USER_FIXTURE
    void schemas
    const result = parseScimUser(rest)
    expect(result.ok).toBe(true)
  })
})

describe('sha256HexString', () => {
  it('hashes the empty string to the known SHA-256', async () => {
    const hex = await sha256HexString('')
    expect(hex).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('hashes "abc" to the RFC test vector', async () => {
    const hex = await sha256HexString('abc')
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('returns 64 lowercase hex chars', async () => {
    const hex = await sha256HexString('any-token-here')
    expect(hex).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic across calls', async () => {
    const a = await sha256HexString('soteria')
    const b = await sha256HexString('soteria')
    expect(a).toBe(b)
  })

  it('differentiates by content', async () => {
    const a = await sha256HexString('soteria')
    const b = await sha256HexString('Soteria')
    expect(a).not.toBe(b)
  })
})

describe('generateScimToken', () => {
  it('returns a non-empty URL-safe base64 string', () => {
    const t = generateScimToken()
    expect(t.length).toBeGreaterThanOrEqual(43)
    // Base64url alphabet — no '+', '/', or padding '='.
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('produces different tokens on each call', () => {
    const a = generateScimToken()
    const b = generateScimToken()
    expect(a).not.toBe(b)
  })
})
