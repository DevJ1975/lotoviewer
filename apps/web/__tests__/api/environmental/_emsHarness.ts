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

function memberGate() {
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

/** Unique keys a route depends on, per table. */
export const UNIQUE_KEYS: Record<string, string[][]> = {
  ms_scope_statements: [['tenant_id', 'discipline', 'version']],
  ms_policies:         [['tenant_id', 'discipline', 'version']],
}

/** Same-tenant composite foreign keys, per table: (columns) → table(references). */
export const FOREIGN_KEYS: Record<string, { columns: string[]; table: string; references: string[] }[]> = {
  ms_interested_parties: [
    { columns: ['tenant_id', 'obligation_id'], table: 'compliance_calendar_obligations', references: ['tenant_id', 'id'] },
  ],
}

export function rowsIn(table: string): Row[] {
  return store.get(table) ?? []
}

export function seed(table: string, rows: Row[]): void {
  store.set(table, [...rowsIn(table), ...rows.map(r => ({ ...r }))])
}

/** Every write attempted since the last reset, in order, including refused ones. */
export const writes: { table: string; mode: 'insert' | 'update'; payload: unknown }[] = []

let failures: { table: string; mode: QueryState['mode'] | 'any'; error: DbError }[] = []
/** The next query against `table` (optionally only the next insert, update or select) fails with `error`. */
export function failNext(table: string, error: DbError, mode: QueryState['mode'] | 'any' = 'any'): void {
  failures.push({ table, mode, error })
}

let idCounter = 0
export function resetStore(): void {
  store.clear()
  writes.length = 0
  failures = []
  idCounter = 0
  captureExceptionMock.mockReset()
  asAdminA()
}

function nextId(): string {
  idCounter += 1
  return `aaaaaaaa-0000-4000-8000-${String(idCounter).padStart(12, '0')}`
}

function violation(table: string, candidate: Row, others: Row[]): DbError | null {
  for (const key of UNIQUE_KEYS[table] ?? []) {
    if (others.some(r => key.every(col => r[col] === candidate[col]))) {
      return { code: '23505', message: `duplicate key value violates unique constraint on ${table} (${key.join(', ')})` }
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
  mode:     'select' | 'insert' | 'update'
  payload:  Row | Row[] | null
  filters:  Filter[]
  orders:   { column: string; ascending: boolean }[]
  limit:    number | null
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

function run(state: QueryState): { data: unknown; error: DbError | null } {
  const failure = failures.findIndex(f => f.table === state.table && (f.mode === 'any' || f.mode === state.mode))
  if (failure >= 0) {
    const [{ error }] = failures.splice(failure, 1)
    return { data: null, error }
  }
  const rows = store.get(state.table) ?? (store.set(state.table, []), store.get(state.table)!)
  const matches = () => rows.filter(row => state.filters.every(f => f(row)))

  if (state.mode === 'insert') {
    writes.push({ table: state.table, mode: 'insert', payload: state.payload })
    const now = new Date().toISOString()
    const incoming = (Array.isArray(state.payload) ? state.payload : [state.payload!])
      .map(raw => ({ id: nextId(), created_at: now, updated_at: now, ...raw }))
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

  let result = matches()
  for (const { column, ascending } of [...state.orders].reverse()) {
    result = [...result].sort((a, b) => (ascending ? 1 : -1) * compare(a[column], b[column]))
  }
  if (state.limit !== null) result = result.slice(0, state.limit)
  return { data: result.map(r => project(r, state.columns)), error: null }
}

function builder(table: string) {
  const state: QueryState = {
    table, mode: 'select', payload: null, filters: [], orders: [], limit: null, columns: null,
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
    select(columns?: string) { state.columns = parseColumns(columns ?? '*'); return chain },
    insert(payload: Row | Row[]) { state.mode = 'insert'; state.payload = payload; return chain },
    update(payload: Row) { state.mode = 'update'; state.payload = payload; return chain },
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
    single: () => one(false),
    maybeSingle: () => one(true),
    then<T>(onFulfilled: (value: { data: unknown; error: DbError | null }) => T, onRejected?: (reason: unknown) => T) {
      return Promise.resolve(settle()).then(onFulfilled, onRejected)
    },
  }
  return chain
}

const client = { from: (table: string) => builder(table) }

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
