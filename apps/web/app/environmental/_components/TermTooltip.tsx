// One-sentence definitions of the ISO 14001 terms the registers use, shown
// on hover so a supervisor new to the standard can read the page unaided.
// A plain <abbr title>: no positioning library, and screen readers that
// expose titles read the definition.

export const EMS_TERMS = {
  aspect: 'An element of an activity, product or service that can interact with the environment, such as an emission, a discharge or the use of a resource.',
  impact: 'The change to the environment that results from an aspect, harmful or beneficial.',
  'operating condition': 'When the aspect occurs: in normal operation, in abnormal conditions such as start-up or maintenance, or in an emergency.',
  'compliance obligation': 'A legal requirement the organization must meet, or another requirement it chooses to adopt, such as a permit condition or a customer contract.',
  'interested party': 'A person or organization that can affect, be affected by, or believe itself affected by the organization\'s environmental decisions.',
  significant: 'An aspect whose score under the scoring method reaches its significance threshold: the aspects the EMS must control first.',
} as const

export type EmsTerm = keyof typeof EMS_TERMS

export function TermTooltip({ term, children }: { term: EmsTerm; children?: React.ReactNode }) {
  return (
    <abbr title={EMS_TERMS[term]} className="cursor-help no-underline decoration-dotted underline-offset-2 hover:underline">
      {children ?? term}
    </abbr>
  )
}
