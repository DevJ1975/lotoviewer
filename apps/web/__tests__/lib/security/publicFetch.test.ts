import { describe, expect, it, vi } from 'vitest'

// DNS rebinding: the name resolves public when checked and private when the
// connection resolves it again. publicFetch resolves inside the connection,
// so the second answer is the one that gets checked.

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns', async orig => {
  const real = await orig<typeof import('node:dns')>()
  return { ...real, lookup, default: { ...real, lookup } }
})

import { publicFetch, publicLookup } from '@/lib/security/publicHost'

type Records = Array<{ address: string; family: number }>
const answer = (records: Records) => lookup.mockImplementationOnce((_h: string, _o: unknown, cb: (e: null, r: Records) => void) => cb(null, records))

describe('publicLookup', () => {
  it('passes a public answer through, in either callback shape', async () => {
    answer([{ address: '93.184.216.34', family: 4 }])
    const single = await new Promise(resolve => publicLookup('lrs.example.com', {}, (err, address, family) => resolve({ err, address, family })))
    expect(single).toEqual({ err: null, address: '93.184.216.34', family: 4 })

    answer([{ address: '93.184.216.34', family: 4 }])
    const all = await new Promise(resolve => publicLookup('lrs.example.com', { all: true }, (err, address) => resolve({ err, address })))
    expect(all).toEqual({ err: null, address: [{ address: '93.184.216.34', family: 4 }] })
  })

  it.each([
    [[{ address: '169.254.169.254', family: 4 }]],
    [[{ address: '93.184.216.34', family: 4 }, { address: '::ffff:7f00:1', family: 6 }]],
    [[]],
  ])('refuses to connect when the answer is %j', async records => {
    answer(records)
    const err = await new Promise<NodeJS.ErrnoException | null>(resolve => publicLookup('rebind.attacker.example', {}, e => resolve(e)))
    expect(err?.code).toBe('ENONPUBLIC')
  })
})

describe('publicFetch', () => {
  it('never opens a connection to a host that now resolves privately', async () => {
    answer([{ address: '127.0.0.1', family: 4 }])
    await expect(publicFetch('https://rebind.attacker.example/xapi/statements')).rejects.toThrow(/public address/)
  })

  it('refuses anything but https', async () => {
    await expect(publicFetch('http://lrs.example.com/')).rejects.toThrow(/https/)
  })
})
