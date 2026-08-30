// Best-effort client IP for rate-limit keys.
//
// X-Forwarded-For is a chain: each proxy appends the peer it received from.
// The leftmost entry is the original client ONLY if no client sent the header
// themselves — a caller who sets `X-Forwarded-For: <random>` on every request
// prepends their own value, so reading position 0 hands the attacker a fresh
// rate-limit bucket per request. The trustworthy entries are the ones a proxy
// appended, at the right-hand end.
//
// So prefer headers the platform sets and strips inbound copies of, and fall
// back to the rightmost X-Forwarded-For hop rather than the leftmost.
//
// On Vercel today this is belt-and-braces: the platform overwrites
// X-Forwarded-For rather than appending to a client-supplied value, so the
// old leftmost read was not exploitable there. It becomes exploitable behind
// any proxy that appends — which is what this guards against.

export function clientIp(req: Request): string {
  // Platform-set, and stripped from inbound requests by the platform itself.
  const vercel = req.headers.get('x-vercel-forwarded-for')
  if (vercel) return vercel.trim()

  const cloudflare = req.headers.get('cf-connecting-ip')
  if (cloudflare) return cloudflare.trim()

  const real = req.headers.get('x-real-ip')
  if (real) return real.trim()

  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) {
    const hops = forwarded.split(',').map(h => h.trim()).filter(Boolean)
    const nearest = hops[hops.length - 1]
    if (nearest) return nearest
  }

  return '0.0.0.0'
}
