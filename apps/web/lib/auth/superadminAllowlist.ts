// The one parser for SUPERADMIN_EMAILS.
//
// Every gate that consults the allowlist — requireSuperadmin, tenantGate's
// superadmin shortcut, the manuals reader, the daily-report mailer — goes
// through here so the format (comma-separated, whitespace-tolerant,
// case-insensitive) cannot drift between copies. Kept free of Supabase
// imports so it can be used, and mocked, independently of the gates.

export function superadminAllowlist(): string[] {
  return (process.env.SUPERADMIN_EMAILS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

export function isAllowlistedSuperadminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const needle = email.toLowerCase()
  return superadminAllowlist().some(entry => entry.toLowerCase() === needle)
}
