import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { z } from 'zod'
import { requireTenantMember } from '@/lib/auth/tenantGate'
import { emit } from '@/lib/xapi/service'
import {
  equipmentEditedStatement,
  equipmentViewedStatement,
  mboxAgent,
  photoUploadedStatement,
  photoValidatedStatement,
  reviewSignedStatement,
} from '@/lib/xapi/statements'
import type { XapiStatement } from '@/lib/xapi/types'

// POST /api/xapi/emit — translate a domain event into an xAPI
// Statement and forward it to the tenant's configured LRS. Auth and
// tenant scope come from the standard tenant gate (JWT +
// x-active-tenant header); the request body never specifies who the
// actor is, so the endpoint can't be used to forge statements for
// another user.
//
// Body shape is a discriminated union on `event`. New event types
// land here as new branches — keep the runtime schema and the
// builders in lib/xapi/statements.ts in lockstep.

export const runtime = 'nodejs'

const ReviewSignedSchema = z.object({
  event:        z.literal('loto.review.signed'),
  department:   z.string().min(1).max(120),
  reviewId:     z.string().uuid(),
  approved:     z.boolean(),
  notesPresent: z.boolean().default(false),
})

const PhotoUploadedSchema = z.object({
  event:       z.literal('loto.photo.uploaded'),
  equipmentId: z.string().min(1).max(200),
  slot:        z.string().min(1).max(60),
  byteSize:    z.number().int().positive().optional(),
})

const PhotoValidatedSchema = z.object({
  event:       z.literal('loto.photo.validated'),
  equipmentId: z.string().min(1).max(200),
  slot:        z.string().min(1).max(60),
  passed:      z.boolean(),
  reason:      z.string().max(500).optional(),
})

const EquipmentViewedSchema = z.object({
  event:       z.literal('equipment.viewed'),
  equipmentId: z.string().min(1).max(200),
  name:        z.string().max(200).optional(),
  department:  z.string().max(120).optional(),
})

const EquipmentEditedSchema = z.object({
  event:         z.literal('equipment.edited'),
  equipmentId:   z.string().min(1).max(200),
  name:          z.string().max(200).optional(),
  fieldsChanged: z.array(z.string().min(1).max(80)).min(1).max(50),
})

const BodySchema = z.discriminatedUnion('event', [
  ReviewSignedSchema,
  PhotoUploadedSchema,
  PhotoValidatedSchema,
  EquipmentViewedSchema,
  EquipmentEditedSchema,
])

export async function POST(req: Request) {
  const gate = await requireTenantMember(req)
  if (!gate.ok) {
    return NextResponse.json({ error: gate.message }, { status: gate.status })
  }
  if (!gate.userEmail) {
    return NextResponse.json({ error: 'Authenticated user has no email' }, { status: 400 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const parsed = BodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const actor = mboxAgent(gate.userEmail)
  const base = {
    statementId: crypto.randomUUID(),
    timestamp:   new Date().toISOString(),
    actor,
  }
  const statement: XapiStatement = buildStatement(base, parsed.data)

  try {
    const outcome = await emit({ tenantId: gate.tenantId, statement })
    return NextResponse.json(outcome, { status: outcome.ok ? 200 : 502 })
  } catch (err) {
    Sentry.captureException(err, { tags: { route: 'xapi/emit' } })
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    )
  }
}

type EventBody = z.infer<typeof BodySchema>

function buildStatement(
  base: { statementId: string; timestamp: string; actor: ReturnType<typeof mboxAgent> },
  body: EventBody,
): XapiStatement {
  switch (body.event) {
    case 'loto.review.signed':
      return reviewSignedStatement({
        ...base,
        department:   body.department,
        reviewId:     body.reviewId,
        approved:     body.approved,
        notesPresent: body.notesPresent,
      })
    case 'loto.photo.uploaded':
      return photoUploadedStatement({
        ...base,
        equipmentId: body.equipmentId,
        slot:        body.slot,
        byteSize:    body.byteSize,
      })
    case 'loto.photo.validated':
      return photoValidatedStatement({
        ...base,
        equipmentId: body.equipmentId,
        slot:        body.slot,
        passed:      body.passed,
        reason:      body.reason,
      })
    case 'equipment.viewed':
      return equipmentViewedStatement({
        ...base,
        equipmentId: body.equipmentId,
        name:        body.name,
        department:  body.department,
      })
    case 'equipment.edited':
      return equipmentEditedStatement({
        ...base,
        equipmentId:   body.equipmentId,
        name:          body.name,
        fieldsChanged: body.fieldsChanged,
      })
  }
}
