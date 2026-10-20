import type { StrikeInteractionHint } from '@soteria/core/strikeContent'

export function hintText(hint: StrikeInteractionHint): string {
  switch (hint.kind) {
    case 'authored':
      return hint.text
    case 'sort_ends':
      return `“${hint.first}” comes first and “${hint.last}” comes last.`
    case 'match_one':
      return `“${hint.prompt}” goes with “${hint.answer}”.`
    case 'hotspot_count':
      return hint.correctCount === 1
        ? `Only one point is correct: “${hint.example}”.`
        : `${hint.correctCount} points are correct. “${hint.example}” is one of them.`
    case 'scenario_not':
      return `You can rule out: “${hint.label}”`
  }
}
