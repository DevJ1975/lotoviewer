// A scriptable stand-in for the Supabase query builder, shared by the environmental
// route and cron tests. It installs no mocks of its own: tests wire it in where they need it.

export interface Result { data?: unknown; error?: { message: string; code?: string } | null }
export interface Op { method: string; args: unknown[] }
export interface Call { table: string; ops: Op[] }

/**
 * A scriptable stand-in for the Supabase client. `script` maps a table to the
 * results its queries return, in order (the last one repeats), or to a function
 * that decides from the recorded call. Every builder method returns the builder;
 * awaiting it (or .single()/.maybeSingle()) yields the next scripted result.
 */
export function fakeSupabase(script: Record<string, Result[] | ((call: Call) => Result)> = {}) {
  const calls: Call[] = []
  const queues = new Map(Object.entries(script).map(([table, entry]) => [table, Array.isArray(entry) ? [...entry] : entry]))

  const next = (call: Call): Result => {
    const entry = queues.get(call.table)
    if (typeof entry === 'function') return entry(call)
    if (Array.isArray(entry) && entry.length > 0) return entry.length > 1 ? entry.shift()! : entry[0]!
    return { data: null, error: null }
  }

  const builder = (call: Call): unknown => new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: Result) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(next(call)).then(resolve, reject)
      }
      return (...args: unknown[]) => { call.ops.push({ method: String(prop), args }); return builder(call) }
    },
  })

  const client = {
    from(table: string) { const call: Call = { table, ops: [] }; calls.push(call); return builder(call) },
    rpc(name: string, args?: unknown) { const call: Call = { table: `rpc:${name}`, ops: [{ method: 'rpc', args: [args] }] }; calls.push(call); return builder(call) },
  }

  return {
    client,
    calls,
    /** The calls made against `table` that used `method`, e.g. every insert. */
    used: (table: string, method: string) => calls.filter(c => c.table === table && c.ops.some(o => o.method === method)),
    /** The first argument of the first `method` call on `table`, e.g. the inserted row(s). */
    arg: (table: string, method: string) => calls.find(c => c.table === table && c.ops.some(o => o.method === method))
      ?.ops.find(o => o.method === method)?.args[0],
    /** Whether a query on `table` filtered with `.eq(column, value)`. */
    filtered: (table: string, column: string, value: unknown) =>
      calls.some(c => c.table === table && c.ops.some(o => o.method === 'eq' && o.args[0] === column && o.args[1] === value)),
  }
}


