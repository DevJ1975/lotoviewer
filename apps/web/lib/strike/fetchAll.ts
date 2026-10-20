// STRIKE's service-role reads that must see every row (the scorecard, the
// package importer's media check) go through here, so none of them is
// silently cut off at the API's row cap.

/** Rows asked for per request; the API may return fewer (its max_rows cap). */
const PAGE_SIZE = 1000
/** PostgREST's answer to a page that starts past the last row. */
const RANGE_NOT_SATISFIABLE = 'PGRST103'

export type PageQuery = { range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }> }

/**
 * Every row a query matches, a page at a time. A short page doesn't prove
 * the end (the cap may be below PAGE_SIZE), so it reads until a page comes
 * back empty. `build` must return a fresh query with a stable order.
 */
export async function fetchAll<T>(build: () => PageQuery): Promise<T[]> {
  const rows: T[] = []
  for (;;) {
    const { data, error } = await build().range(rows.length, rows.length + PAGE_SIZE - 1)
    if (error?.code === RANGE_NOT_SATISFIABLE) return rows
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    if (page.length === 0) return rows
    rows.push(...page)
  }
}
