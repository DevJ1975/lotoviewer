import type { RegisterHealth } from '@soteria/core/managementSystem'

// A register's traffic light in the app's safety-tag vocabulary, so it reads
// the same as every other status tag. The rules behind the colour live in
// packages/core (registerHealthFromCounts, scopeAndPolicyHealth).

const LOOK: Record<RegisterHealth, { label: string; className: string }> = {
  green: { label: 'Current',         className: 'safety-tag-cleared' },
  amber: { label: 'Needs attention', className: 'safety-tag-caution' },
  red:   { label: 'Missing',         className: 'safety-tag-danger' },
}

export function RegisterHealthBadge({ health }: { health: RegisterHealth }) {
  const { label, className } = LOOK[health]
  return <span className={`safety-tag ${className}`}>{label}</span>
}
