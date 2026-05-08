// Topic-rotation logic for the toolbox-talks cron. Pulled out of the
// route handler so it's unit-testable without standing up an
// Anthropic mock or Supabase fixture.
//
// Contract: given a pool of topics and a per-topic last-used date,
// return the same pool sorted such that the cron picks each missing
// day's topic by index. Order:
//   - never-used topics first (oldest is "missing date" sentinel)
//   - then by ascending last-used date (oldest used → least-recent first)
//   - tie-broken by topic id for stable ordering across re-runs
//
// The cron walks `sorted[i % sorted.length]` for each missing date,
// so cycling is automatic: a tenant with 3 topics and 7 missing days
// gets days 0,1,2 = topics 0,1,2 then days 3,4,5 = topics 0,1,2 again.

export interface RotationTopic {
  id: string
  // Whatever else the topic carries — pass-through. Generic so the
  // helper doesn't need to import the cron's TopicRow shape.
}

/** Sort topics for the next cron iteration. Returns a new array;
 *  does not mutate the input. */
export function sortTopicsForRotation<T extends RotationTopic>(
  topics: readonly T[],
  /** topic id → ISO date string of the most recent talk that used
   *  it for THIS tenant. Topics not in the map have never been used. */
  lastUsed: ReadonlyMap<string, string>,
): T[] {
  return topics.slice().sort((a, b) => {
    const aDate = lastUsed.get(a.id) ?? ''
    const bDate = lastUsed.get(b.id) ?? ''
    if (aDate === bDate) return a.id.localeCompare(b.id)
    if (aDate === '') return -1
    if (bDate === '') return 1
    return aDate.localeCompare(bDate)
  })
}

/** Walk the missing dates and assign one topic per date, cycling
 *  through the sorted pool. Returns parallel arrays so the cron can
 *  loop over the picks alongside the dates without re-indexing. */
export function pickTopicsForDates<T extends RotationTopic>(
  sorted: readonly T[],
  missingDates: readonly string[],
): Array<{ date: string; topic: T }> {
  if (sorted.length === 0) return []
  return missingDates.map((date, i) => ({
    date,
    topic: sorted[i % sorted.length],
  }))
}
