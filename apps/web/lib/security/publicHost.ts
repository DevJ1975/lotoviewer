import { promises as dns } from 'node:dns'

// SSRF guard for server-side fetches of tenant-supplied URLs (manufacturer
// SDS links, a tenant's LMS endpoint). A host passes only when every address
// it resolves to is public, so a tenant can't point the server at loopback,
// the cloud metadata service or a private network.

// IPv4 + IPv6 ranges that should never be fetchable by a tenant URL.
export function isPrivateAddress(addr: string): boolean {
  // IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(addr)) {
    const [a, b] = addr.split('.').map(n => Number.parseInt(n, 10))
    if (a === 10) return true
    if (a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 0) return true
    if (a >= 224) return true                 // multicast / experimental
    return false
  }
  // IPv6 — collapse to the test-for-prefix form.
  const lower = addr.toLowerCase()
  if (lower === '::1') return true            // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true  // ULA
  if (lower.startsWith('fe80:')) return true   // link-local
  if (lower.startsWith('::ffff:')) {           // IPv4-mapped
    const v4 = lower.split('::ffff:').pop() ?? ''
    if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return isPrivateAddress(v4)
  }
  return false
}

export async function resolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true })
    if (records.length === 0) return false
    return records.every(r => !isPrivateAddress(r.address))
  } catch {
    return false
  }
}
