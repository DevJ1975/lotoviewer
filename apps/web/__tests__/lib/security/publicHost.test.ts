import { describe, expect, it } from 'vitest'
import { isPrivateAddress } from '@/lib/security/publicHost'

// The SSRF guard for tenant-supplied URLs (LRS endpoints, SDS links). A miss
// here lets a tenant aim the server at loopback, the metadata service or a
// private network.

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', '100.127.255.254', '198.18.0.1', '192.0.0.8', '224.0.0.1', '255.255.255.255',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::127.0.0.1',
    '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2001:db8::1',
    'not-an-ip', '',
  ])('refuses %s', addr => {
    expect(isPrivateAddress(addr)).toBe(true)
  })

  it.each(['93.184.216.34', '8.8.8.8', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])('allows the public address %s', addr => {
    expect(isPrivateAddress(addr)).toBe(false)
  })
})
