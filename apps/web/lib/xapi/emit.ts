'use client'

import { supabase, readActiveTenant } from '@/lib/supabase'

// Browser-side fire-and-forget emitter. Posts a domain event to the
// xAPI emit route; the route handles translation, dispatch, and audit.
// Failures are swallowed and logged to the console — a learning-record
// outage must never break the user-facing action (review sign-off,
// photo upload, equipment view).
//
// Each event type is a separate exported function so call sites get
// compile-time guarantees on the payload shape and TypeScript narrows
// the discriminant for free at the API route boundary.

type EmitBody =
  | { event: 'loto.review.signed'
      department: string; reviewId: string; approved: boolean; notesPresent?: boolean }
  | { event: 'loto.photo.uploaded'
      equipmentId: string; slot: string; byteSize?: number }
  | { event: 'loto.photo.validated'
      equipmentId: string; slot: string; passed: boolean; reason?: string }
  | { event: 'equipment.viewed'
      equipmentId: string; name?: string; department?: string }
  | { event: 'equipment.edited'
      equipmentId: string; name?: string; fieldsChanged: string[] }

async function send(body: EmitBody): Promise<void> {
  try {
    const session = await supabase.auth.getSession()
    const token = session.data.session?.access_token
    const tenantId = readActiveTenant()
    if (!token || !tenantId) return        // not signed in / no tenant — silently skip
    await fetch('/api/xapi/emit', {
      method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Authorization':   `Bearer ${token}`,
        'x-active-tenant': tenantId,
      },
      body: JSON.stringify(body),
      // keepalive lets the request survive a page unload, which
      // matters for equipment.viewed (fired from useEffect cleanup
      // on navigation away).
      keepalive: true,
    })
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[xapi] emit failed', err)
    }
  }
}

export function emitReviewSigned(input: {
  department: string; reviewId: string; approved: boolean; notesPresent?: boolean
}): void {
  void send({ event: 'loto.review.signed', ...input })
}

export function emitPhotoUploaded(input: {
  equipmentId: string; slot: string; byteSize?: number
}): void {
  void send({ event: 'loto.photo.uploaded', ...input })
}

export function emitPhotoValidated(input: {
  equipmentId: string; slot: string; passed: boolean; reason?: string
}): void {
  void send({ event: 'loto.photo.validated', ...input })
}

export function emitEquipmentViewed(input: {
  equipmentId: string; name?: string; department?: string
}): void {
  void send({ event: 'equipment.viewed', ...input })
}

export function emitEquipmentEdited(input: {
  equipmentId: string; name?: string; fieldsChanged: string[]
}): void {
  void send({ event: 'equipment.edited', ...input })
}
