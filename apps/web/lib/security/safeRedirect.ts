// Reduce a caller-supplied redirect target to one that can only land on this
// origin.
//
// /login?next=<path> exists so a deep link survives the sign-in bounce, but
// the value arrives from the URL bar — an attacker can hand a victim
// /login?next=https://evil.com and the post-authentication redirect carries
// them off-site with the app's own domain in the referrer chain.
//
// Prefix checks alone are a trap here: "//evil.com" is protocol-relative,
// browsers normalise "\" to "/" so "/\evil.com" is too, and an embedded tab
// or newline is stripped before parsing, which resurrects both. Rather than
// enumerate those, resolve the value against a base the app can never own and
// keep it only if it stayed there — then rebuild it from the parsed parts so
// nothing but path, query, and fragment survives.

const UNOWNABLE_BASE = 'https://redirect-guard.invalid'

export function safeRedirect(
  target: string | null | undefined,
  fallback = '/',
): string {
  if (!target) return fallback

  try {
    const url = new URL(target, UNOWNABLE_BASE)
    if (url.origin !== UNOWNABLE_BASE) return fallback
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    // Not parseable even against a base (e.g. "http://") — never redirect to it.
    return fallback
  }
}
