// Historical-data connector scaffold. The year-over-year scorecard reads
// osha_annual_summaries, today populated by the PDF + CSV history-import flows
// (see app/api/insights/history-import/*). This adds a third source path:
// external EHS systems (Intelex first) pulled via a connector, upserted
// through the SAME validation as the manual flows.
//
// PLUMBING ONLY for now. The Intelex live adapter is BLOCKED on the client's
// credentials + object/field mapping, so its fetch throws a clear ConnectorError
// until those land. Everything around it — the interface, the registry, the
// validation glue, the status/sync routes, and the admin UI — is real, so the
// live adapter is a single-function drop-in later.

import {
  validateAnnualRow,
  annualSummaryUpsertRow,
} from './annualSummaryRow'

// One year's annual rollup for a single establishment, as a connector returns
// it. `fields` carries the raw 300A numbers (ANNUAL_SCALAR_FIELDS + `year` +
// optional `by_injury_type`) and is validated downstream by validateAnnualRow,
// identical to the PDF/CSV import — so a connector can never write looser data.
export interface ConnectorAnnualSummary {
  establishmentId: string
  fields:          Record<string, unknown>
}

export type ConnectorStatus =
  | 'awaiting_credentials' // required env/creds not set
  | 'awaiting_mapping'     // creds present, live adapter/field-map not wired yet
  | 'ready'                // fully operational

export interface HistoryConnector {
  id:    string
  label: string
  /** Credential/env names the operator must supply to configure this source. */
  requirements: readonly string[]
  /** Whether the required env/credentials are present. */
  isConfigured(): boolean
  /** Human status for the admin UI. */
  status(): ConnectorStatus
  /**
   * Pull annual rollups to upsert into osha_annual_summaries. Throws
   * ConnectorError (with an HTTP status) until the live adapter is wired.
   */
  fetchAnnualSummaries(args: { tenantId: string }): Promise<ConnectorAnnualSummary[]>
}

// Connector failures carry an HTTP status so routes can forward them directly.
export class ConnectorError extends Error {
  constructor(
    public readonly connectorId: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'ConnectorError'
  }
}

// ── Intelex (stub adapter) ────────────────────────────────────────────────
// OAuth/token creds + an instance base URL, plus the object/field mapping,
// are required before a live pull can be written. Until then the adapter is
// honest: it reports its status and throws a 501 with the exact next step.

const INTELEX_REQUIREMENTS = ['INTELEX_API_TOKEN', 'INTELEX_BASE_URL'] as const

function intelexIsConfigured(): boolean {
  return INTELEX_REQUIREMENTS.every(key => !!process.env[key]?.trim())
}

export const intelexConnector: HistoryConnector = {
  id:    'intelex',
  label: 'Intelex',
  requirements: INTELEX_REQUIREMENTS,
  isConfigured: intelexIsConfigured,
  status: () => (intelexIsConfigured() ? 'awaiting_mapping' : 'awaiting_credentials'),
  fetchAnnualSummaries: async () => {
    if (!intelexIsConfigured()) {
      throw new ConnectorError(
        'intelex',
        501,
        `Intelex is not configured. Set ${INTELEX_REQUIREMENTS.join(' + ')} in the deployment environment.`,
      )
    }
    // Credentials present but we still need the client's Intelex object/endpoint
    // for the annual rollup and its field → 300A mapping before pulling.
    throw new ConnectorError(
      'intelex',
      501,
      'The Intelex live adapter is pending the client object/field mapping. ' +
      'Provide which Intelex object holds the annual rollup (or per-incident data to aggregate) ' +
      'and how its fields map to the OSHA 300A totals.',
    )
  },
}

export const HISTORY_CONNECTORS: readonly HistoryConnector[] = [intelexConnector]

export function getHistoryConnector(id: string): HistoryConnector | undefined {
  return HISTORY_CONNECTORS.find(c => c.id === id)
}

// ── Validation glue ───────────────────────────────────────────────────────

export interface ConnectorUpsertResult {
  upserts: ReturnType<typeof annualSummaryUpsertRow>[]
  errors:  { establishmentId: string; message: string }[]
}

// Run connector rows through the SAME validation as the manual import and build
// upsert rows. Pure (no I/O) so it's unit-tested and the live Intelex adapter
// inherits identical validation for free — the sync route just writes the
// `upserts` and surfaces the `errors`.
export function connectorRowsToUpserts(
  tenantId: string,
  rows: ConnectorAnnualSummary[],
  thisYear: number = new Date().getUTCFullYear(),
): ConnectorUpsertResult {
  const upserts: ReturnType<typeof annualSummaryUpsertRow>[] = []
  const errors:  { establishmentId: string; message: string }[] = []
  for (const row of rows) {
    const result = validateAnnualRow(row.fields, thisYear)
    if (!result.ok) {
      errors.push({ establishmentId: row.establishmentId, message: result.message })
      continue
    }
    upserts.push(annualSummaryUpsertRow({
      tenantId,
      establishmentId: row.establishmentId,
      totals:          result.totals,
    }))
  }
  return { upserts, errors }
}
