import type { XapiActivity } from './types'

// Activity IRIs follow a hierarchical scheme rooted at the Soteria
// namespace. Each kind of thing the user touches gets its own
// activity-type IRI; instance IRIs append a stable id (equipment id,
// department slug) so the LRS can group statements by object.
const ROOT = 'https://soteria.field/xapi/activities'

const ActivityTypes = {
  equipment:        `${ROOT}/types/equipment`,
  department:       `${ROOT}/types/department`,
  lotoReview:       `${ROOT}/types/loto-review`,
  equipmentPhoto:   `${ROOT}/types/equipment-photo`,
} as const

export function equipmentActivity(id: string, name?: string): XapiActivity {
  return {
    objectType: 'Activity',
    id: `${ROOT}/equipment/${encodeURIComponent(id)}`,
    definition: {
      type: ActivityTypes.equipment,
      name: name ? { 'en-US': name } : { 'en-US': id },
    },
  }
}

export function departmentActivity(department: string): XapiActivity {
  return {
    objectType: 'Activity',
    id: `${ROOT}/departments/${encodeURIComponent(department)}`,
    definition: {
      type: ActivityTypes.department,
      name: { 'en-US': department },
    },
  }
}

export function lotoReviewActivity(department: string, reviewId: string): XapiActivity {
  return {
    objectType: 'Activity',
    id: `${ROOT}/loto-reviews/${encodeURIComponent(reviewId)}`,
    definition: {
      type: ActivityTypes.lotoReview,
      name: { 'en-US': `LOTO review — ${department}` },
    },
  }
}

export function equipmentPhotoActivity(
  equipmentId: string,
  slot: string,
): XapiActivity {
  return {
    objectType: 'Activity',
    // The slot (placard / front / back / locks) qualifies the activity
    // so an LRS dashboard can break "photo uploaded" down by photo kind.
    id: `${ROOT}/equipment/${encodeURIComponent(equipmentId)}/photos/${encodeURIComponent(slot)}`,
    definition: {
      type: ActivityTypes.equipmentPhoto,
      name: { 'en-US': `${slot} photo on ${equipmentId}` },
    },
  }
}
