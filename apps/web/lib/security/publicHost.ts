import { lookup as lookupCallback, promises as dns, type LookupAddress, type LookupOptions } from 'node:dns'
import { request as httpsRequest } from 'node:https'
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

/**
 * Whether every address a host resolves to is public. 'unresolved' (the
 * lookup itself failed) is kept apart from 'private' because a resolver
 * outage is temporary and a private answer is not.
 */
export async function publicHostStatus(hostname: string): Promise<'public' | 'private' | 'unresolved'> {
  let records: LookupAddress[]
  try { records = await dns.lookup(hostname, { all: true, verbatim: true }) }
  catch { return 'unresolved' }
  if (records.length === 0) return 'unresolved'
  return records.every(r => !isPrivateAddress(r.address)) ? 'public' : 'private'
}

export async function resolvesPublicly(hostname: string): Promise<boolean> {
  return (await publicHostStatus(hostname)) === 'public'
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * A `lookup` for an http(s) request that refuses a non-public address. A
 * resolvesPublicly() check before fetch() is not enough on its own: fetch
 * resolves the name again, and a DNS answer with a zero TTL can be public
 * for the check and 169.254.169.254 for the connection. Resolving here, in
 * the connection itself, makes the address checked the address used.
 */
export function publicLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  lookupCallback(hostname, { ...options, all: true }, (err, records) => {
    if (err) return callback(err, '')
    const list = records as LookupAddress[]
    if (list.length === 0 || list.some(r => isPrivateAddress(r.address))) {
      const refused: NodeJS.ErrnoException = new Error(`${hostname} does not resolve to a public address`)
      refused.code = 'ENONPUBLIC'
      return callback(refused, '')
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

/**
 * fetch() for tenant-supplied https URLs, connecting only to public
 * addresses (see publicLookup) and never following a redirect. Covers what
 * those callers use: method, headers, a string body, and an abort signal.
 */
export function publicFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input))
  if (url.protocol !== 'https:') return Promise.reject(new Error('Only https URLs can be fetched'))
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      lookup: publicLookup,
      signal: init.signal ?? undefined,
    }, res => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('error', reject)
      res.on('end', () => {
        const status = res.statusCode ?? 500
        const nullBody = status === 204 || status === 205 || status === 304
        resolve(new Response(nullBody ? null : Buffer.concat(chunks), { status }))
      })
    })
    req.on('error', reject)
    req.end(typeof init.body === 'string' ? init.body : undefined)
  })
}
