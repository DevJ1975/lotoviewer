import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { MicrolearningSummary } from '@soteria/core/strikeScorecard'
import { loadMicrolearningSummary } from '@/lib/strike/scorecardData'

// What the three EHS Scorecard export routes (PDF, Excel, Word) share: the
// window rule, the file formats, and the server-computed microlearning data.

/** The scorecard's window options, in days. */
export const SCORECARD_WINDOWS = [7, 30, 90] as const
const DEFAULT_WINDOW = 30

/** Any value from a client becomes one of the scorecard's own windows. */
export function parseScorecardWindow(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : raw
  return SCORECARD_WINDOWS.find(w => w === n) ?? DEFAULT_WINDOW
}

export type ScorecardExportFormat = 'pdf' | 'xlsx' | 'docx'

export const SCORECARD_EXPORT_MIME: Record<ScorecardExportFormat, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export function scorecardExportResponse(bytes: Uint8Array, format: ScorecardExportFormat, now: Date = new Date()): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      'content-type': SCORECARD_EXPORT_MIME[format],
      'content-disposition': `attachment; filename="ehs-scorecard-${now.toISOString().slice(0, 10)}.${format}"`,
      'cache-control': 'private, no-store',
    },
  })
}

/**
 * The microlearning section for an export, computed on the server (never
 * taken from the client). A failure leaves the section out of the file rather
 * than failing the whole scorecard, and is reported.
 */
export async function loadExportMicrolearning(admin: SupabaseClient, tenantId: string, windowDays: number): Promise<MicrolearningSummary | null> {
  try {
    return await loadMicrolearningSummary(admin, tenantId, windowDays)
  } catch (e) {
    Sentry.captureException(e, { tags: { module: 'scorecard/microlearning-export' } })
    return null
  }
}
