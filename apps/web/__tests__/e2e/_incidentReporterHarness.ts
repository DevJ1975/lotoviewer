// Shared harness for the incident-reporter end-to-end suites.
//
// Pattern matches __tests__/api/ai/_helpers.ts: import this BEFORE the
// route under test so the vi.mock calls are registered, seed state with
// the exported helpers, then dynamically import the handler.
//
// The Supabase stand-in is deliberately not a bag of canned responses.
// It stores rows, applies filters, and enforces the constraints
// migration 059/067 put on `incidents` — the report-number trigger, the
// incident_type CHECK, and the is_anonymous ↔ reported_by pairing. A
// route that violates one of those fails here the way it would fail in
// Postgres, which is the whole point of an end-to-end test that never
// reaches a database.

import { vi } from 'vitest'

// ── tenant gate ───────────────────────────────────────────────────────
export const requireTenantMemberMock = vi.fn()

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantMember: (req: Request) => requireTenantMemberMock(req),
  requireTenantAdmin:  (req: Request) => requireTenantMemberMock(req),
}))

export const TENANT_ID = '11111111-1111-1111-1111-111111111111'
export const MEMBER_ID = '22222222-2222-2222-2222-222222222222'
export const ADMIN_ID  = '33333333-3333-3333-3333-333333333333'

export function gateOk(opts: { userId?: string; tenantId?: string; userEmail?: string } = {}) {
  requireTenantMemberMock.mockResolvedValue({
    ok:           true,
    userId:       opts.userId    ?? MEMBER_ID,
    tenantId:     opts.tenantId  ?? TENANT_ID,
    userEmail:    opts.userEmail ?? 'reporter@example.test',
    role:         'member',
    authedClient: {} as never,
  })
}

export function gateRejects(status: number, message: string) {
  requireTenantMemberMock.mockResolvedValue({ ok: false, status, message })
}

// ── email + Sentry seams ──────────────────────────────────────────────
export const sendIncidentAlertEmailMock =
  vi.fn<(args: Record<string, unknown>) => Promise<boolean>>(async () => true)
export const captureExceptionMock = vi.fn<(...args: unknown[]) => void>()

vi.mock('@/lib/email/sendIncidentAlert', () => ({
  sendIncidentAlertEmail: (args: Record<string, unknown>) => sendIncidentAlertEmailMock(args),
}))
vi.mock('@/lib/email/sendInvite', () => ({
  computeLoginUrl: () => 'https://app.example.test',
}))
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

// ── anonymous-intake seams ────────────────────────────────────────────
export const isOverIpLimitMock =
  vi.fn<(ipHash: string) => Promise<boolean>>(async () => false)
export const verifyTurnstileMock =
  vi.fn<(token: string | undefined, ip: string) => Promise<{ ok: boolean }>>(async () => ({ ok: true }))
export const recordAttemptMock =
  vi.fn<(...args: unknown[]) => Promise<void>>(async () => {})

vi.mock('@/lib/anonReport/ipThrottle', () => ({
  clientIp:      () => '203.0.113.7',
  hashIp:        (ip: string) => `sha256:${ip}`,
  isOverIpLimit: (ipHash: string) => isOverIpLimitMock(ipHash),
  recordAttempt: (...args: unknown[]) => recordAttemptMock(...args),
}))
vi.mock('@/lib/anonReport/turnstile', () => ({
  verifyTurnstile: (token: string | undefined, ip: string) => verifyTurnstileMock(token, ip),
}))

// ── in-memory Postgres stand-in ───────────────────────────────────────

type Row = Record<string, unknown>
type Filter = (row: Row) => boolean

const INCIDENT_TYPES = ['injury_illness', 'near_miss', 'property_damage', 'environmental']
const SEVERITY_ACTUAL = ['none', 'first_aid', 'medical', 'lost_time', 'fatality', 'catastrophic']

export const store = new Map<string, Row[]>()
export const signedUploadPaths: string[] = []

export function rowsIn(table: string): Row[] {
  return store.get(table) ?? []
}

export function seed(table: string, rows: Row[]): void {
  store.set(table, rows.map(r => ({ ...r })))
}

export function resetStore(): void {
  store.clear()
  signedUploadPaths.length = 0
  for (const table of ['incidents', 'command_center_safety_alerts', 'incident_notifications']) {
    store.set(table, [])
  }
}

let idCounter = 0
function nextId(prefix: string): string {
  idCounter += 1
  return `${prefix}-${String(idCounter).padStart(8, '0')}-0000-0000-0000-000000000000`.slice(0, 36)
}

// Mirrors migration 059's set_incident_number trigger: a per-tenant,
// per-year counter formatted INC-YYYY-NNNN. The year comes from
// created_at (when it was filed), not from when the event happened.
function nextReportNumber(tenantId: string, createdIso: string): string {
  const year = new Date(createdIso).getUTCFullYear()
  const priorForTenant = rowsIn('incidents').filter(r => r.tenant_id === tenantId).length
  return `INC-${year}-${String(priorForTenant + 1).padStart(4, '0')}`
}

// The CHECK constraints a bad INSERT would trip in Postgres.
function violatedConstraint(table: string, row: Row): string | null {
  if (table !== 'incidents') return null
  if (!INCIDENT_TYPES.includes(String(row.incident_type)))
    return `new row for relation "incidents" violates check constraint "incidents_incident_type_check"`
  if (!SEVERITY_ACTUAL.includes(String(row.severity_actual)))
    return `new row for relation "incidents" violates check constraint "incidents_severity_actual_check"`
  // Migration 067: is_anonymous = true ↔ reported_by IS NULL.
  const anonymous = row.is_anonymous === true
  const hasReporter = row.reported_by != null
  if (anonymous === hasReporter)
    return `new row for relation "incidents" violates check constraint "incidents_anon_reporter_check"`
  return null
}

function applyInsertDefaults(table: string, row: Row): Row {
  if (table !== 'incidents') return { id: nextId('row'), ...row }
  const nowIso = new Date().toISOString()
  return {
    id:            nextId('inc'),
    report_number: nextReportNumber(String(row.tenant_id), nowIso),
    reported_at:   nowIso,
    status:        'reported',
    created_at:    nowIso,
    updated_at:    nowIso,
    location_geo:  null,
    ...row,
  }
}

interface QueryState {
  table:   string
  filters: Filter[]
  mode:    'select' | 'insert' | 'update'
  payload: Row | Row[] | null
  count:   boolean
  head:    boolean
  columns: string[] | null   // null = '*'
}

// PostgREST returns only the columns you ask for, so the stand-in has
// to as well: a route that reads a field it forgot to select gets
// undefined here exactly as it would in production. Handles the two
// shapes these routes use — a plain comma list and an embedded
// resource (`profiles:profiles!inner(email)`), whose key is the alias.
function parseColumns(cols: unknown): string[] | null {
  if (typeof cols !== 'string' || cols.trim() === '*') return null
  const out: string[] = []
  let depth = 0
  let token = ''
  for (const ch of cols) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { out.push(token); token = '' } else { token += ch }
  }
  out.push(token)
  return out
    .map(t => t.trim().split('(')[0].split(':')[0].split('!')[0].trim())
    .filter(Boolean)
}

function project(row: Row, columns: string[] | null): Row {
  if (!columns) return { ...row }
  const out: Row = {}
  for (const col of columns) out[col] = row[col]
  return out
}

function run(state: QueryState): { data: unknown; error: { message: string } | null; count?: number } {
  const table = state.table
  const rows = store.get(table) ?? (store.set(table, []), store.get(table)!)

  if (state.mode === 'insert') {
    const incoming = Array.isArray(state.payload) ? state.payload : [state.payload as Row]
    const inserted: Row[] = []
    for (const raw of incoming) {
      const row = applyInsertDefaults(table, raw)
      const violation = violatedConstraint(table, row)
      if (violation) return { data: null, error: { message: violation } }
      rows.push(row)
      inserted.push(project(row, state.columns))
    }
    return { data: inserted, error: null }
  }

  const matched = rows.filter(r => state.filters.every(f => f(r)))

  if (state.mode === 'update') {
    for (const row of matched) Object.assign(row, state.payload as Row)
    return { data: matched, error: null }
  }

  if (state.head) return { data: null, error: null, count: matched.length }
  const projected = matched.map(r => project(r, state.columns))
  return { data: projected, error: null, count: state.count ? matched.length : undefined }
}

function builder(table: string) {
  const state: QueryState = {
    table, filters: [], mode: 'select', payload: null, count: false, head: false, columns: null,
  }

  const api: Record<string, unknown> = {
    select(cols?: unknown, opts?: { count?: string; head?: boolean }) {
      state.columns = parseColumns(cols)
      state.count   = opts?.count === 'exact'
      state.head    = opts?.head === true
      return api
    },
    insert(payload: Row | Row[]) { state.mode = 'insert'; state.payload = payload; return api },
    update(payload: Row)         { state.mode = 'update'; state.payload = payload; return api },
    eq(col: string, val: unknown)  { state.filters.push(r => r[col] === val); return api },
    neq(col: string, val: unknown) { state.filters.push(r => r[col] !== val); return api },
    gte(col: string, val: string)  { state.filters.push(r => String(r[col]) >= val); return api },
    in(col: string, vals: unknown[]) { state.filters.push(r => vals.includes(r[col])); return api },
    or()    { return api },
    order() { return api },
    limit() { return api },
    range() { return api },
    single() {
      const res = run(state)
      const list = (res.data ?? []) as Row[]
      if (res.error) return Promise.resolve(res)
      if (list.length !== 1) {
        return Promise.resolve({ data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } })
      }
      return Promise.resolve({ data: list[0], error: null })
    },
    maybeSingle() {
      const res = run(state)
      const list = (res.data ?? []) as Row[]
      if (res.error) return Promise.resolve(res)
      return Promise.resolve({ data: list[0] ?? null, error: null })
    },
    then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
      return Promise.resolve().then(() => run(state)).then(onOk, onErr)
    },
  }
  return api
}

const adminClient = {
  from: (table: string) => builder(table),
  storage: {
    from: () => ({
      createSignedUploadUrl: async (path: string) => {
        signedUploadPaths.push(path)
        return { data: { path, token: `upload-token-${signedUploadPaths.length}` }, error: null }
      },
    }),
  },
}

vi.mock('@/lib/supabaseAdmin', () => ({ supabaseAdmin: () => adminClient }))

// ── fixtures ──────────────────────────────────────────────────────────

export const ANON_TOKEN = 'a'.repeat(64)

/** A tenant with one admin on an email rule — the smallest setup that
 *  exercises intake, alerting, and the notification log end to end. */
export function seedTenantWithEmailRule(overrides: { rule?: Row } = {}): void {
  seed('tenants', [{ id: TENANT_ID, name: 'Northgate Terminal' }])
  seed('tenant_memberships', [
    { user_id: ADMIN_ID,  role: 'admin',  tenant_id: TENANT_ID, profiles: { email: 'safety.lead@example.test' } },
    { user_id: MEMBER_ID, role: 'member', tenant_id: TENANT_ID, profiles: { email: 'reporter@example.test' } },
  ])
  seed('incident_notification_rules', [{
    id:                       'rule-all',
    tenant_id:                TENANT_ID,
    name:                     'Notify safety leads',
    enabled:                  true,
    match_incident_type:      null,
    match_severity_actual:    null,
    match_severity_potential: null,
    match_recordable:         null,
    notify_roles:             ['admin'],
    notify_user_ids:          null,
    notify_emails:            null,
    channels:                 ['email'],
    escalation_minutes:       null,
    ...(overrides.rule ?? {}),
  }])
}

export function seedAnonToken(overrides: Row = {}): void {
  seed('incident_anon_intake_tokens', [{
    id:                            'token-1',
    tenant_id:                     TENANT_ID,
    label:                         'Dock B entrance',
    token:                         ANON_TOKEN,
    enabled:                       true,
    rate_limit_per_hour:           null,
    total_reports:                 0,
    require_captcha:               false,
    default_assigned_investigator: null,
    auto_route_enabled:            false,
    site_geo_lat:                  null,
    site_geo_lng:                  null,
    geofence_radius_m:             null,
    ...overrides,
  }])
}

export function resetHarness(): void {
  resetStore()
  requireTenantMemberMock.mockReset()
  sendIncidentAlertEmailMock.mockClear()
  sendIncidentAlertEmailMock.mockResolvedValue(true)
  captureExceptionMock.mockClear()
  isOverIpLimitMock.mockClear()
  isOverIpLimitMock.mockResolvedValue(false)
  verifyTurnstileMock.mockClear()
  verifyTurnstileMock.mockResolvedValue({ ok: true })
  recordAttemptMock.mockClear()
  gateOk()
}

// Request builders — the exact shape each form posts.
export function intakeRequest(body: unknown): Request {
  return new Request('https://app.example.test/api/incidents', {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-active-tenant': TENANT_ID },
    body:    JSON.stringify(body),
  })
}

export function anonRequest(body: unknown): Request {
  return new Request('https://app.example.test/api/anonymous-report', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}

export function statusRequest(body: unknown): Request {
  return new Request('https://app.example.test/api/anonymous-report/status', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  })
}
