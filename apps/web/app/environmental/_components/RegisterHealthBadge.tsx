import type { RegisterHealth } from '@soteria/core/managementSystem'

// A register's traffic light in the app's safety-tag vocabulary, so it reads
// the same as every other status tag. The rules behind the colour live in
// packages/core (registerHealthFromCounts, scopeAndPolicyHealth).

const LOOK: Record<RegisterHealth, { label: string; className: string }> = {
  green: { label: 'Current',         className: 'safety-tag-cleared' },
  amber: { label: 'Needs attention', className: 'safety-tag-caution' },
  red:   { label: 'Missing',         className: 'safety-tag-danger' },
}

/**
 * The permits register is judged on dates and names, not on whether records exist,
 * so "Missing" and "Current" would say more than the light knows.
 */
export const PERMIT_LIGHT_LABELS: Partial<Record<RegisterHealth, string>> = { red: 'Action needed', green: 'Nothing due' }

export function RegisterHealthBadge({ health, labels }: { health: RegisterHealth; labels?: Partial<Record<RegisterHealth, string>> }) {
  const { label, className } = LOOK[health]
  return <span className={`safety-tag ${className}`}>{labels?.[health] ?? label}</span>
}
