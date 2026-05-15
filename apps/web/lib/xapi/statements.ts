import { Verbs } from './verbs'
import {
  equipmentActivity,
  equipmentPhotoActivity,
  lotoReviewActivity,
} from './activities'
import type { XapiAgent, XapiStatement } from './types'

// Pure functions that translate domain events into xAPI Statements.
// No I/O, no Date.now(), no randomness — the caller passes timestamp
// and statement id so tests are deterministic and the audit row can
// dedupe replays via statement.id.

interface BuilderBase {
  statementId: string
  timestamp:   string
  actor:       XapiAgent
}

export interface ReviewSignedInput extends BuilderBase {
  department:   string
  reviewId:     string
  approved:     boolean
  notesPresent: boolean
}

export function reviewSignedStatement(input: ReviewSignedInput): XapiStatement {
  return {
    id:        input.statementId,
    actor:     input.actor,
    verb:      Verbs.completed,
    object:    lotoReviewActivity(input.department, input.reviewId),
    result: {
      completion: true,
      success:    input.approved,
      response:   input.notesPresent ? 'with-notes' : 'no-notes',
    },
    context: {
      platform:   'soteria-field',
      extensions: {
        'https://soteria.field/xapi/ext/department': input.department,
      },
    },
    timestamp: input.timestamp,
  }
}

export interface PhotoUploadedInput extends BuilderBase {
  equipmentId: string
  slot:        string                  // 'placard' | 'front' | 'back' | 'locks' | …
  byteSize?:   number
}

export function photoUploadedStatement(input: PhotoUploadedInput): XapiStatement {
  return {
    id:        input.statementId,
    actor:     input.actor,
    verb:      Verbs.interacted,
    object:    equipmentPhotoActivity(input.equipmentId, input.slot),
    result: input.byteSize !== undefined
      ? { extensions: { 'https://soteria.field/xapi/ext/byte-size': input.byteSize } }
      : undefined,
    context: { platform: 'soteria-field' },
    timestamp: input.timestamp,
  }
}

export interface PhotoValidatedInput extends BuilderBase {
  equipmentId: string
  slot:        string
  passed:      boolean
  reason?:     string                  // Haiku's rejection reason, when failed
}

export function photoValidatedStatement(input: PhotoValidatedInput): XapiStatement {
  return {
    id:        input.statementId,
    actor:     input.actor,
    verb:      input.passed ? Verbs.validated : Verbs.rejected,
    object:    equipmentPhotoActivity(input.equipmentId, input.slot),
    result: {
      success: input.passed,
      ...(input.reason ? { response: input.reason } : {}),
    },
    context: { platform: 'soteria-field' },
    timestamp: input.timestamp,
  }
}

export interface EquipmentViewedInput extends BuilderBase {
  equipmentId: string
  name?:       string
  department?: string
}

export function equipmentViewedStatement(input: EquipmentViewedInput): XapiStatement {
  return {
    id:        input.statementId,
    actor:     input.actor,
    verb:      Verbs.experienced,
    object:    equipmentActivity(input.equipmentId, input.name),
    context: {
      platform: 'soteria-field',
      ...(input.department
        ? {
            extensions: {
              'https://soteria.field/xapi/ext/department': input.department,
            },
            // contextActivities would be more spec-correct, but adds
            // serialization complexity without changing what an LRS
            // can filter on. Revisit if a customer asks.
          }
        : {}),
    },
    timestamp: input.timestamp,
  }
}

export interface EquipmentEditedInput extends BuilderBase {
  equipmentId: string
  name?:       string
  fieldsChanged: string[]
}

export function equipmentEditedStatement(input: EquipmentEditedInput): XapiStatement {
  return {
    id:        input.statementId,
    actor:     input.actor,
    verb:      Verbs.updated,
    object:    equipmentActivity(input.equipmentId, input.name),
    result: {
      extensions: {
        'https://soteria.field/xapi/ext/fields-changed': input.fieldsChanged,
      },
    },
    context: { platform: 'soteria-field' },
    timestamp: input.timestamp,
  }
}

// Convenience: build an Agent from a user's email + display name.
// xAPI 1.0.3 requires exactly one Inverse Functional Identifier; we
// use mbox so it's interoperable with every off-the-shelf LRS.
export function mboxAgent(email: string, name?: string): XapiAgent {
  return {
    objectType: 'Agent',
    ...(name ? { name } : {}),
    mbox: `mailto:${email}`,
  }
}

// Department-scoped "anonymous reviewer" agent for review-portal
// sign-offs where we don't have a logged-in user, only a typed name.
// Falls back to an account-based identifier in the Soteria namespace.
export function reviewerAgent(name: string, department: string): XapiAgent {
  return {
    objectType: 'Agent',
    name,
    account: {
      homePage: 'https://soteria.field/xapi/accounts/reviewers',
      name:     `${department}:${name}`,
    },
  }
}
