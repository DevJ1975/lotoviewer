// Format a Supabase / Postgrest / Storage error (or any unknown thrown
// value) into a user-facing string. Replaces the
//   `error?.message ?? 'Could not …'`
// pattern that was scattered across permit pages and admin screens —
// keeps the fallback wording consistent and makes it easy to add e.g.
// offline-aware messaging in one place later.
//
// Pass a `fallback` that completes the sentence "Could not …" naturally,
// e.g. 'save' produces 'Could not save.' on a null/empty error.

export function formatSupabaseError(
  err: { message?: string | null } | string | null | undefined,
  fallback: string,
): string {
  if (typeof err === 'string' && err.trim()) return err
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = err.message
    if (typeof msg === 'string' && msg.trim()) return msg
  }
  return `Could not ${fallback}.`
}
