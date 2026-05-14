import { z } from 'zod'
import {
  OBLIGATION_CATEGORIES,
  OBLIGATION_FREQUENCIES,
  LEGAL_STATUSES,
  REVIEW_FREQUENCIES,
} from '@soteria/core/compliance'

// Boundary validators for the /api/compliance/* routes. Strict-by-
// default: unknown fields rejected so a stale client can't silently
// poison rows with phantom columns.

const DATE_RE     = /^\d{4}-\d{2}-\d{2}$/
const TRIM_NONEMPTY = (max: number) => z.string().trim().min(1).max(max)

export const legalRegisterCreateSchema = z.object({
  citation:           TRIM_NONEMPTY(120),
  title:              TRIM_NONEMPTY(300),
  jurisdiction:       TRIM_NONEMPTY(60),
  authority:          z.string().trim().max(120).nullish(),
  source_url:         z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)),
  summary:            z.string().trim().max(8000).nullish(),
  applicability_note: z.string().trim().max(4000).nullish(),
  status:             z.enum(LEGAL_STATUSES).optional(),
  effective_date:     z.string().regex(DATE_RE).nullish(),
  last_reviewed_at:   z.string().datetime().nullish(),
  next_review_due:    z.string().regex(DATE_RE).nullish(),
  review_frequency:   z.enum(REVIEW_FREQUENCIES).nullish(),
  tags:               z.array(z.string().trim().min(1).max(40)).max(20).optional(),
}).strict()

export const legalRegisterUpdateSchema = legalRegisterCreateSchema.partial().strict()

export const obligationCreateSchema = z.object({
  legal_register_id:  z.string().uuid().nullish(),
  title:              TRIM_NONEMPTY(200),
  description:        z.string().trim().max(4000).nullish(),
  category:           z.enum(OBLIGATION_CATEGORIES).default('other'),
  jurisdiction:       z.string().trim().max(60).nullish(),
  frequency:          z.enum(OBLIGATION_FREQUENCIES).default('annual'),
  frequency_days:     z.number().int().positive().max(3650).nullish(),
  next_due_date:      z.string().regex(DATE_RE),
  lead_days:          z.number().int().min(0).max(365).default(14),
  snoozed_until:      z.string().regex(DATE_RE).nullish(),
  not_applicable:     z.boolean().default(false),
  responsible_party:  z.string().trim().max(120).nullish(),
  evidence_required:  z.boolean().default(false),
  notes:              z.string().trim().max(4000).nullish(),
}).strict().refine(
  v => v.frequency !== 'custom_days' || (typeof v.frequency_days === 'number' && v.frequency_days > 0),
  { message: 'frequency_days is required when frequency=custom_days', path: ['frequency_days'] },
)

export const obligationUpdateSchema = z.object({
  legal_register_id:  z.string().uuid().nullish(),
  title:              TRIM_NONEMPTY(200).optional(),
  description:        z.string().trim().max(4000).nullish(),
  category:           z.enum(OBLIGATION_CATEGORIES).optional(),
  jurisdiction:       z.string().trim().max(60).nullish(),
  frequency:          z.enum(OBLIGATION_FREQUENCIES).optional(),
  frequency_days:     z.number().int().positive().max(3650).nullish(),
  next_due_date:      z.string().regex(DATE_RE).optional(),
  lead_days:          z.number().int().min(0).max(365).optional(),
  snoozed_until:      z.string().regex(DATE_RE).nullish(),
  not_applicable:     z.boolean().optional(),
  responsible_party:  z.string().trim().max(120).nullish(),
  evidence_required:  z.boolean().optional(),
  notes:              z.string().trim().max(4000).nullish(),
}).strict()

export const obligationCompletionSchema = z.object({
  completed_at:  z.string().datetime().optional(),
  notes:         z.string().trim().max(2000).nullish(),
  evidence_url:  z.string().trim().url().max(500).nullish().or(z.literal('').transform(() => null)),
}).strict()

export type LegalRegisterCreate = z.infer<typeof legalRegisterCreateSchema>
export type LegalRegisterUpdate = z.infer<typeof legalRegisterUpdateSchema>
export type ObligationCreate    = z.infer<typeof obligationCreateSchema>
export type ObligationUpdate    = z.infer<typeof obligationUpdateSchema>
export type ObligationCompletion = z.infer<typeof obligationCompletionSchema>
