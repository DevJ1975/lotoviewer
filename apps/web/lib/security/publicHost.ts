import { promises as dns } from 'node:dns'
import { BlockList, isIP } from 'node:net'

// SSRF guard for server-side fetches of tenant-supplied URLs (manufacturer
// SDS links, a tenant's LMS endpoint). A host passes only when every address
// it resolves to is public, so a tenant can't point the server at loopback,
// the cloud metadata service or a private network.

// Every range IANA marks as not globally reachable, plus the translation
// prefixes that embed an IPv4 address (NAT64, 6to4, IPv4-compatible) and so
// can reach a private one. net.BlockList matches an IPv4-mapped IPv6 address
// (::ffff:127.0.0.1, ::ffff:7f00:1) against the IPv4 rules itself, which a
// string-prefix test missed in its hex form.
const NON_PUBLIC = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv4')
for (const [net, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23], ['2001:db8::', 32],
  ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv6')

/** True for any address a tenant-supplied URL must not reach. Unparseable counts as private. */
export function isPrivateAddress(addr: string): boolean {
  const family = isIP(addr)
  if (family === 0) return true
  return NON_PUBLIC.check(addr, family === 4 ? 'ipv4' : 'ipv6')
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
