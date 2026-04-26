// Helpers for the singleton loto_org_config row from migration 014.
// Pure / no I/O — lets tests pass fixtures and lets the UI compute a
// hyperlink without an extra DB roundtrip per permit.

// Compose a clickable URL from a stored template and a free-text ref.
// Returns null when the template isn't set (caller renders plain text)
// or when the ref is blank. The {ref} placeholder is required: a template
// without it would produce identical URLs for every permit, which is
// almost certainly a configuration mistake — return null in that case
// rather than silently emitting a useless link.
export function formatWorkOrderUrl(template: string | null | undefined, ref: string | null | undefined): string | null {
  if (!template || !ref) return null
  if (!template.includes('{ref}')) return null
  return template.replace(/\{ref\}/g, encodeURIComponent(ref.trim()))
}
