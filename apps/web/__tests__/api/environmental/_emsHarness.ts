// Shared harness for the /api/environmental register routes.
//
// Import this BEFORE the route under test so its vi.mock calls register.
//
// The Supabase stand-in stores rows and really applies the filters a route
// sends, so a route that forgets `.eq('tenant_id', …)` reads another
// tenant's rows here exactly as it would through a service-role key. It also
// enforces the handful of constraints these routes rely on (version
// uniqueness, same-tenant links), answering with Postgres's SQLSTATEs. RLS
// is not modelled: the gate stand-in applies the real gate's rules instead,
// and the PGlite suite proves the policies themselves.

import { vi } from 'vitest'
import { currentScoresByCondition, scoreAspect, type AspectOperatingCondition } from '@soteria/core/environmentalAspect'
import { addCalendarDays } from '@soteria/core/managementSystem'

// ── tenant gate ───────────────────────────────────────────────────────
export const TENANT_A = '11111111-1111-4111-8111-111111111111'
export const TENANT_B = '22222222-2222-4222-8222-222222222222'
export const ADMIN_A  = '00000000-0000-4000-8000-0000000000a1'
export const MEMBER_A = '00000000-0000-4000-8000-0000000000a2'
export const ADMIN_B  = '00000000-0000-4000-8000-0000000000b1'
export const FACILITY_A = '33333333-3333-4333-8333-333333333333'

export interface Caller {
  userId:      string
  tenantId:    string
  role:        'owner' | 'admin' | 'member' | 'viewer' | 'superadmin'
  facilityId?: string | null
  moduleOn?:   boolean
}

let caller: Caller | { ok: false; status: number; message: string } = { userId: ADMIN_A, tenantId: TENANT_A, role: 'admin' }

export function callAs(next: Caller): void {
  caller = next
}
export const asAdminA  = () => callAs({ userId: ADMIN_A,  tenantId: TENANT_A, role: 'admin', facilityId: FACILITY_A })
export const asMemberA = () => callAs({ userId: MEMBER_A, tenantId: TENANT_A, role: 'member', facilityId: FACILITY_A })
export const asAdminB  = () => callAs({ userId: ADMIN_B,  tenantId: TENANT_B, role: 'admin' })

export function gateRejects(status: number, message: string): void {
  caller = { ok: false, status, message }
}

type GateFailure = { ok: false; status: number; message: string }
type GatePass = { ok: true; userId: string; tenantId: string; facilityId: string | null; role: Caller['role'] } & Record<string, unknown>

function memberGate(): GateFailure | GatePass {
  if ('ok' in caller) return caller
  if (caller.moduleOn === false) return { ok: false, status: 403, message: 'Module is not enabled for this tenant' }
  return {
    ok: true,
    userId:       caller.userId,
    userEmail:    `${caller.userId}@example.test`,
    tenantId:     caller.tenantId,
    facilityId:   caller.facilityId ?? null,
    role:         caller.role,
    authedClient: client,
    tenantName:   'Northfield Forge & Finish',
    tenantModules: { environmental: true },
    tenantSettings: null,
  }
}

vi.mock('@/lib/auth/tenantGate', () => ({
  requireTenantModuleMember: async () => memberGate(),
  requireTenantModuleAdmin:  async () => {
    const gate = memberGate()
    if (!gate.ok) return gate
    return ['owner', 'admin', 'superadmin'].includes(gate.role)
      ? gate
      : { ok: false, status: 403, message: 'Tenant admin or owner required' }
  },
}))

export const captureExceptionMock = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}))

// ── in-memory Postgres stand-in ───────────────────────────────────────
export type Row = Record<string, unknown>
type Filter = (row: Row) => boolean
interface DbError { message: string; code: string }

const store = new Map<string, Row[]>()

/** Unique keys a route depends on, per table; `where` makes one partial, like a partial unique index. */
export const UNIQUE_KEYS: Record<string, { columns: string[]; where?: (row: Row) => boolean }[]> = {
  ms_scope_statements: [{ columns: ['tenant_id', 'discipline', 'version'] }],
  ms_policies:         [{ columns: ['tenant_id', 'discipline', 'version'] }],
  // uq_ms_scoring_methods_default (migration 296)
  ms_scoring_methods:  [{ columns: ['tenant_id', 'discipline'], where: row => row.is_default === true && row.retired_at == null }],
  environmental_aspect_obligations: [{ columns: ['aspect_id', 'obligation_id'] }],
  // uq_ms_compliance_evaluations_open (migration 298)
  ms_compliance_evaluations: [{ columns: ['obligation_id'], where: row => row.completed_at == null }],
  ms_evidence: [{ columns: ['tenant_id', 'subject_type', 'subject_id', 'sha256'] }],
  ms_responsibilities: [{ columns: ['tenant_id', 'discipline', 'responsibility_key'] }],
}

/** Same-tenant composite foreign keys, per table: (columns) → table(references). */
export const FOREIGN_KEYS: Record<string, { columns: string[]; table: string; references: string[] }[]> = {
  ms_interested_parties: [
    { columns: ['tenant_id', 'obligation_id'], table: 'compliance_calendar_obligations', references: ['tenant_id', 'id'] },
  ],
  environmental_aspect_obligations: [
    { columns: ['tenant_id', 'aspect_id'], table: 'environmental_aspects', references: ['tenant_id', 'id'] },
    { columns: ['tenant_id', 'obligation_id'], table: 'compliance_calendar_obligations', references: ['tenant_id', 'id'] },
  ],
  environmental_aspect_scores: [
    { columns: ['tenant_id', 'aspect_id'], table: 'environmental_aspects', references: ['tenant_id', 'id'] },
    { columns: ['tenant_id', 'method_id'], table: 'ms_scoring_methods', references: ['tenant_id', 'id'] },
  ],
  ms_policy_communications: [
    { columns: ['tenant_id', 'policy_id', 'discipline'], table: 'ms_policies', references: ['tenant_id', 'id', 'discipline'] },
  ],
}

export function rowsIn(table: string): Row[] {
  return store.get(table) ?? []
}

export function seed(table: string, rows: Row[]): void {
  store.set(table, [...rowsIn(table), ...rows.map(r => ({ ...r }))])
}

/** Every write attempted since the last reset, in order, including refused ones. */
export const writes: { table: string; mode: 'insert' | 'update' | 'delete'; payload: unknown }[] = []

let failures: { table: string; mode: QueryState['mode'] | 'any'; error: DbError }[] = []
/** The next query against `table` (optionally only the next insert, update or select) fails with `error`. */
export function failNext(table: string, error: DbError, mode: QueryState['mode'] | 'any' = 'any'): void {
  failures.push({ table, mode, error })
}

let hooks: { table: string; mode: QueryState['mode']; action: () => void }[] = []
/** Run `action` just before the next `mode` query against `table`: how a test stages a race. */
export function beforeNext(table: string, mode: QueryState['mode'], action: () => void): void {
  hooks.push({ table, mode, action })
}

let idCounter = 0
export function resetStore(): void {
  store.clear()
  writes.length = 0
  failures = []
  hooks = []
  objects.clear()
  idCounter = 0
  captureExceptionMock.mockReset()
  asAdminA()
}

// Column defaults the migrations declare and the routes rely on: a new
// register row's first review falls a year out (migrations 295, 297, 298),
// and a new obligation is open (migration 192).
const reviewDueInAYear = (): Row => ({ next_review_due: addCalendarDays(new Date().toISOString().slice(0, 10), 365) })
const COLUMN_DEFAULTS: Record<string, () => Row> = {
  ms_context_issues:               reviewDueInAYear,
  ms_interested_parties:           reviewDueInAYear,
  environmental_aspects:           reviewDueInAYear,
  compliance_calendar_obligations: () => ({ status: 'open', ...reviewDueInAYear() }),
}

function nextId(): string {
  idCounter += 1
  return `aaaaaaaa-0000-4000-8000-${String(idCounter).padStart(12, '0')}`
}

function violation(table: string, candidate: Row, others: Row[]): DbError | null {
  for (const { columns, where = () => true } of UNIQUE_KEYS[table] ?? []) {
    if (!where(candidate)) continue
    if (others.some(r => where(r) && columns.every(col => r[col] === candidate[col]))) {
      return { code: '23505', message: `duplicate key value violates unique constraint on ${table} (${columns.join(', ')})` }
    }
  }
  for (const fk of FOREIGN_KEYS[table] ?? []) {
    const values = fk.columns.map(col => candidate[col])
    if (values.some(v => v === null || v === undefined)) continue
    const found = rowsIn(fk.table).some(r => fk.references.every((col, i) => r[col] === values[i]))
    if (!found) return { code: '23503', message: `insert or update on table "${table}" violates foreign key constraint` }
  }
  return null
}

interface QueryState {
  table:    string
  mode:     'select' | 'insert' | 'update' | 'delete'
  payload:  Row | Row[] | null
  filters:  Filter[]
  orders:   { column: string; ascending: boolean }[]
  limit:    number | null
  offset:   number
  /** select(…, { count: 'exact', head }) */
  count:    boolean
  head:     boolean
  columns:  string[] | null
}

function parseColumns(columns: unknown): string[] | null {
  if (typeof columns !== 'string' || columns.trim() === '*') return null
  return columns.split(',').map(c => c.trim()).filter(Boolean)
}

function project(row: Row, columns: string[] | null): Row {
  if (!columns) return { ...row }
  return Object.fromEntries(columns.map(c => [c, row[c]]))
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0
  if (a === null || a === undefined) return 1
  if (b === null || b === undefined) return -1
  return String(a) < String(b) ? -1 : 1
}

// ── views ─────────────────────────────────────────────────────────────
// Computed from stored rows the way migration 297's views compute them,
// using core's scoreAspect(), which the PGlite suite pins to the database.

function scoreHistory(): Row[] {
  return rowsIn('environmental_aspect_scores').map(score => {
    const method = rowsIn('ms_scoring_methods').find(m => m.id === score.method_id)
    if (!method) throw new Error(`harness: score ${String(score.id)} names no stored method`)
    const { score: value, significant } = scoreAspect(Number(score.severity), Number(score.likelihood), {
      severityLevels:        Number(method.severity_levels),
      likelihoodLevels:      Number(method.likelihood_levels),
      matrix:                (method.matrix ?? null) as number[][] | null,
      significanceThreshold: Number(method.significance_threshold),
    })
    return {
      ...score, score: value, significant,
      method_name: method.name, method_version: method.version, significance_threshold: method.significance_threshold,
    }
  })
}

function currentScores(): Row[] {
  const byAspect = new Map<unknown, Row[]>()
  for (const row of scoreHistory()) byAspect.set(row.aspect_id, [...(byAspect.get(row.aspect_id) ?? []), row])
  return [...byAspect.values()].flatMap(rows => Object.values(currentScoresByCondition(rows.map(r => ({
    ...r, id: String(r.id), operatingCondition: r.operating_condition as AspectOperatingCondition, scoredAt: String(r.scored_at),
  })))))
}

const CONDITION_ORDER = ['normal', 'abnormal', 'emergency']

function aspectRegister(): Row[] {
  const current = currentScores()
  return rowsIn('environmental_aspects').map(aspect => {
    const mine = current
      .filter(c => c.aspect_id === aspect.id)
      .sort((a, b) => CONDITION_ORDER.indexOf(String(a.operating_condition)) - CONDITION_ORDER.indexOf(String(b.operating_condition)))
    return {
      ...aspect,
      significant:    mine.some(c => c.significant === true),
      max_score:      mine.length > 0 ? Math.max(...mine.map(c => Number(c.score))) : null,
      current_scores: mine.map(c => ({
        operating_condition: c.operating_condition, severity: c.severity, likelihood: c.likelihood,
        score: c.score, significant: c.significant, method_id: c.method_id, scored_at: c.scored_at,
      })),
    }
  })
}

function obligationRegister(): Row[] {
  const evaluations = rowsIn('ms_compliance_evaluations')
  return rowsIn('compliance_calendar_obligations').map(obligation => {
    const mine = evaluations.filter(e => e.tenant_id === obligation.tenant_id && e.obligation_id === obligation.id)
    const last = mine
      .filter(e => e.completed_at != null)
      .sort((a, b) => compare(b.completed_at, a.completed_at) || compare(b.id, a.id))[0]
    const open = mine.find(e => e.completed_at == null)
    return {
      ...obligation,
      last_evaluation_id:       last?.id ?? null,
      last_evaluated_at:        last?.completed_at ?? null,
      last_result:              last?.result ?? null,
      last_nonconformity_id:    last?.nonconformity_id ?? null,
      open_evaluation_id:       open?.id ?? null,
      open_evaluation_due:      open?.scheduled_for ?? null,
      open_evaluation_assignee: open?.assigned_to ?? null,
    }
  })
}

const VIEWS: Partial<Record<string, () => Row[]>> = {
  environmental_aspect_score_history:  scoreHistory,
  environmental_aspect_current_scores: currentScores,
  environmental_aspect_register:       aspectRegister,
  ms_obligation_register:              obligationRegister,
}

function run(state: QueryState): { data: unknown; error: DbError | null; count?: number | null } {
  const hook = hooks.findIndex(h => h.table === state.table && h.mode === state.mode)
  if (hook >= 0) hooks.splice(hook, 1)[0].action()
  const failure = failures.findIndex(f => f.table === state.table && (f.mode === 'any' || f.mode === state.mode))
  if (failure >= 0) {
    const [{ error }] = failures.splice(failure, 1)
    return { data: null, error }
  }
  const view = VIEWS[state.table]
  if (view && state.mode !== 'select') throw new Error(`harness: ${state.table} is a view`)
  const rows = view ? view() : store.get(state.table) ?? (store.set(state.table, []), store.get(state.table)!)
  const matches = () => rows.filter(row => state.filters.every(f => f(row)))

  if (state.mode === 'insert') {
    writes.push({ table: state.table, mode: 'insert', payload: state.payload })
    const now = new Date().toISOString()
    const incoming = (Array.isArray(state.payload) ? state.payload : [state.payload!])
      .map(raw => ({ id: nextId(), created_at: now, updated_at: now, ...COLUMN_DEFAULTS[state.table]?.(), ...raw }))
    for (const [i, row] of incoming.entries()) {
      const error = violation(state.table, row, [...rows, ...incoming.slice(0, i)])
      if (error) return { data: null, error }
    }
    rows.push(...incoming)
    return { data: incoming.map(r => project(r, state.columns)), error: null }
  }

  if (state.mode === 'update') {
    writes.push({ table: state.table, mode: 'update', payload: state.payload })
    const targets = matches()
    for (const target of targets) {
      const error = violation(state.table, { ...target, ...(state.payload as Row) }, rows.filter(r => r !== target))
      if (error) return { data: null, error }
    }
    for (const target of targets) Object.assign(target, state.payload, { updated_at: new Date().toISOString() })
    return { data: targets.map(r => project(r, state.columns)), error: null }
  }

  if (state.mode === 'delete') {
    writes.push({ table: state.table, mode: 'delete', payload: null })
    const doomed = new Set(matches())
    store.set(state.table, rows.filter(r => !doomed.has(r)))
    return { data: [...doomed].map(r => project(r, state.columns)), error: null }
  }

  let result = matches()
  for (const { column, ascending } of [...state.orders].reverse()) {
    result = [...result].sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]))
  }
  const matched = result.length
  result = result.slice(state.offset, state.limit === null ? undefined : state.offset + state.limit)
  return {
    data:  state.head ? null : result.map(r => project(r, state.columns)),
    error: null,
    ...(state.count ? { count: matched } : {}),
  }
}

function builder(table: string) {
  const state: QueryState = {
    table, mode: 'select', payload: null, filters: [], orders: [], limit: null, offset: 0, columns: null,
    count: false, head: false,
  }
  const settle = () => run(state)
  const one = (allowNone: boolean) => {
    const { data, error } = settle()
    if (error) return Promise.resolve({ data: null, error })
    const rows = data as Row[]
    if (rows.length === 1) return Promise.resolve({ data: rows[0], error: null })
    if (rows.length === 0 && allowNone) return Promise.resolve({ data: null, error: null })
    return Promise.resolve({ data: null, error: { code: 'PGRST116', message: `expected one row, got ${rows.length}` } })
  }
  const chain = {
    select(columns?: string, options: { count?: 'exact'; head?: boolean } = {}) {
      state.columns = parseColumns(columns ?? '*')
      state.count = options.count === 'exact'
      state.head = options.head === true
      return chain
    },
    insert(payload: Row | Row[]) { state.mode = 'insert'; state.payload = payload; return chain },
    update(payload: Row) { state.mode = 'update'; state.payload = payload; return chain },
    delete() { state.mode = 'delete'; return chain },
    eq(column: string, value: unknown) { state.filters.push(r => r[column] === value); return chain },
    neq(column: string, value: unknown) { state.filters.push(r => r[column] !== value); return chain },
    in(column: string, values: readonly unknown[]) { state.filters.push(r => values.includes(r[column])); return chain },
    is(column: string, value: null) { state.filters.push(r => (r[column] ?? null) === value); return chain },
    not(column: string, operator: 'is', value: null) {
      if (operator !== 'is') throw new Error(`harness: not(${operator}) is not modelled`)
      state.filters.push(r => (r[column] ?? null) !== value)
      return chain
    },
    lt(column: string, value: unknown)  { state.filters.push(r => compare(r[column], value) < 0); return chain },
    lte(column: string, value: unknown) { state.filters.push(r => compare(r[column], value) <= 0); return chain },
    gt(column: string, value: unknown)  { state.filters.push(r => compare(r[column], value) > 0); return chain },
    gte(column: string, value: unknown) { state.filters.push(r => compare(r[column], value) >= 0); return chain },
    order(column: string, options: { ascending?: boolean } = {}) {
      state.orders.push({ column, ascending: options.ascending ?? true })
      return chain
    },
    limit(n: number) { state.limit = n; return chain },
    range(from: number, to: number) { state.offset = from; state.limit = to - from + 1; return chain },
    single: () => one(false),
    maybeSingle: () => one(true),
    then<T>(onFulfilled: (value: { data: unknown; error: DbError | null; count?: number | null }) => T, onRejected?: (reason: unknown) => T) {
      return Promise.resolve(settle()).then(onFulfilled, onRejected)
    },
  }
  return chain
}

const client = { from: (table: string) => builder(table) }
/** The same store as a plain client, for code that takes the browser `supabase` export. */
export const emsClient = client

// ── storage (the private ms-evidence bucket) ──────────────────────────
/** Stored objects by `${bucket}/${path}`. */
export const objects = new Map<string, Uint8Array<ArrayBuffer>>()

function storageBucket(bucket: string) {
  const key = (path: string) => `${bucket}/${path}`
  return {
    async upload(path: string, bytes: Uint8Array, options: { upsert?: boolean } = {}) {
      if (objects.has(key(path)) && !options.upsert) return { data: null, error: { message: 'The resource already exists' } }
      objects.set(key(path), new Uint8Array(bytes))
      return { data: { path }, error: null }
    },
    async download(path: string) {
      const stored = objects.get(key(path))
      return stored
        ? { data: new Blob([stored]), error: null }
        : { data: null, error: { message: 'Object not found' } }
    },
    async remove(paths: string[]) {
      for (const path of paths) objects.delete(key(path))
      return { data: paths.map(name => ({ name })), error: null }
    },
  }
}

vi.mock('@/lib/supabaseAdmin', () => ({
  supabaseAdmin: () => ({ from: (table: string) => builder(table), storage: { from: storageBucket } }),
}))

// ── requests ──────────────────────────────────────────────────────────
export function jsonRequest(path: string, method: string, body?: unknown): Request {
  return new Request(`https://app.test${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
}

export function idContext(id: string) {
  return { params: Promise.resolve({ id }) }
}
