import type { MemberAccessState } from '@soteria/core/memberAccessState'

// Access state → the app's OSHA-coded tag vocabulary: cleared (nothing to
// do), caution (someone is waiting on a step), danger (they cannot work).
// `locked_out` is danger rather than caution deliberately — a member who
// cannot sign in cannot file a near-miss, sign a placard, or close a permit.
const PRESENTATION: Record<MemberAccessState, { label: string; tone: string }> = {
  no_login:      { label: 'roster only',   tone: 'safety-tag-caution' },
  active:        { label: 'login active',  tone: 'safety-tag-cleared' },
  setup_pending: { label: 'setup pending', tone: 'safety-tag-caution' },
  locked_out:    { label: 'locked out',    tone: 'safety-tag-danger'  },
}

export default function MemberAccessBadge({ state }: { state: MemberAccessState }) {
  const { label, tone } = PRESENTATION[state]
  return <span className={`safety-tag ${tone}`}>{label}</span>
}
