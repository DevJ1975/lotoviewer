import type { XapiVerb } from './types'

// Canonical xAPI verb IRIs. ADL-defined verbs live under
// http://adlnet.gov/expapi/verbs/ and are preferred when one fits —
// LRS dashboards already know how to render them. Domain-specific
// verbs are namespaced under the Soteria IRI so they don't collide
// with anyone else's vocabulary.
const ADL = 'http://adlnet.gov/expapi/verbs'
const SOTERIA = 'https://soteria.field/xapi/verbs'

export const Verbs = {
  // ADL: the learner finished an activity successfully.
  completed: {
    id: `${ADL}/completed`,
    display: { 'en-US': 'completed' },
  },
  // ADL: the learner viewed / engaged with content without completing.
  experienced: {
    id: `${ADL}/experienced`,
    display: { 'en-US': 'experienced' },
  },
  // ADL: the learner submitted a response (used for photo upload).
  interacted: {
    id: `${ADL}/interacted`,
    display: { 'en-US': 'interacted' },
  },
  // Soteria: a piece of equipment metadata was edited.
  updated: {
    id: `${SOTERIA}/updated`,
    display: { 'en-US': 'updated' },
  },
  // Soteria: an uploaded photo passed automated validation.
  validated: {
    id: `${SOTERIA}/validated`,
    display: { 'en-US': 'validated' },
  },
  // Soteria: an uploaded photo failed automated validation.
  rejected: {
    id: `${SOTERIA}/rejected`,
    display: { 'en-US': 'rejected' },
  },
} as const satisfies Record<string, XapiVerb>

export type VerbName = keyof typeof Verbs
