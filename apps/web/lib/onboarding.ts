import type { Profile } from '@soteria/core/types'

// First-login onboarding walkthrough. Pure config + a single gating
// predicate so the show/hide decision is testable without rendering.

export interface OnboardingStep {
  title:    string
  body:     string
  bullets?: string[]
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    title: 'Welcome to SoteriaField',
    body: 'Safety where the work happens. Report hazards, run permits, and pull up the right procedure right from the floor.',
  },
  {
    title: 'Find your way around',
    body: 'Everything is a tap or a search away.',
    bullets: [
      'Open the menu (top-left) to reach every module.',
      'Use the search bar to jump straight to equipment, permits, or people.',
      'Press ⌘K / Ctrl+K anywhere for the command palette.',
      'Tap Help (?) in the header for step-by-step manuals.',
    ],
  },
  {
    title: 'Do the everyday things',
    body: 'The common safety actions are built to take seconds.',
    bullets: [
      'Report a hazard or near-miss in under a minute.',
      'Scan a QR placard to see a machine’s hazards and isolation steps.',
      'Ask the assistant — it answers with cited OSHA and company sources.',
      'Remember: AI drafts are a starting point. A qualified person verifies and signs off.',
    ],
  },
]

/**
 * Whether to show the first-login onboarding walkthrough.
 *
 * Hidden while the user still has a forced password change pending (that
 * setup flow at /welcome comes first) and once they've completed/dismissed
 * the walkthrough.
 */
export function shouldShowOnboarding(profile: Profile | null | undefined): boolean {
  if (!profile) return false
  if (profile.must_change_password) return false
  return profile.onboarding_completed_at == null
}
