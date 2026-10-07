import type { RegulationJobRow } from '@/app/api/superadmin/regulation-status/route'

// How a regulation_ingest job reads to the operator. The service reports counts;
// this turns them into a sentence, and is where a suspicious parse (sections it
// skipped, a part that found nothing) is made visible rather than buried.

const num = (v: unknown): number => (typeof v === 'number' ? v : 0)

export function describeJob(job: RegulationJobRow): string {
  if (job.status === 'failed') return job.last_error ?? 'Failed.'
  if (job.status === 'queued') return 'Waiting for the service to pick it up.'
  if (job.status === 'running') {
    const p = job.progress ?? {}
    return typeof p.stage === 'string'
      ? `Running: ${p.stage}${num(p.total) ? ` (${num(p.loaded)} of ${num(p.total)} sections)` : ''}.`
      : 'Running.'
  }
  const r = job.result ?? {}
  const sections = `${num(r.sections)} sections found, ${num(r.to_load)} new or changed (${num(r.chunks)} chunks, about ${num(r.estimated_tokens).toLocaleString()} tokens)`
  const skipped = [
    num(r.reserved) ? `${num(r.reserved)} reserved` : '',
    num(r.unrecognized) ? `${num(r.unrecognized)} with a section number the parser did not understand` : '',
  ].filter(Boolean).join(', ')
  const sample = Array.isArray(r.sample) && typeof r.sample[0] === 'string' ? ` First: ${r.sample[0]}.` : ''
  if (job.payload.dry_run) return `${sections}.${skipped ? ` Skipped: ${skipped}.` : ''}${sample} Nothing was written.`
  return `Loaded ${num(r.loaded)} sections, ${num(r.unchanged)} unchanged, ${num(r.removed)} removed.${skipped ? ` Skipped: ${skipped}.` : ''}`
}
