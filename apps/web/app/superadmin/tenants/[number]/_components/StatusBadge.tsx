// Member-status pill — yellow "Invited" (never signed in) vs green
// "Active" (has signed in). Used by the members table.
export function StatusBadge({ status }: { status: 'invited' | 'active' }) {
  if (status === 'invited') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200">
        Invited
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200">
      Active
    </span>
  )
}
