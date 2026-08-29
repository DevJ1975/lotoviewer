import { describe, it, expect } from 'vitest'
import { buildEcfaChartPdf } from '@/lib/pdfEcfaChart'
import type { EcfaLayoutNode } from '@soteria/core/ecfaSchemas'

// Exercises the pdf-lib drawing path end-to-end (rectangles, ellipses, the
// diamond svg-path, dashed borders, and text) so a broken primitive or
// option is caught here rather than in the browser.

const NODES: EcfaLayoutNode[] = [
  { id: 'a', node_type: 'event', sequence_index: 0, parent_event_id: null, lane: null,
    title: 'Operator opened the guard door', verification_status: 'verified', is_causal_factor: false, cf_category: null },
  { id: 'b', node_type: 'event', sequence_index: 1, parent_event_id: null, lane: null,
    title: 'Reached into the running machine', verification_status: 'presumptive', is_causal_factor: true, cf_category: 'organisational_factors' },
  { id: 'c', node_type: 'condition', sequence_index: 0, parent_event_id: 'a', lane: 'below',
    title: 'Interlock was bypassed', verification_status: 'presumptive', is_causal_factor: true, cf_category: 'absent_failed_defences' },
  { id: 'L', node_type: 'incident', sequence_index: 0, parent_event_id: null, lane: null,
    title: 'Amputation of index finger', verification_status: 'verified', is_causal_factor: false, cf_category: null },
]

describe('buildEcfaChartPdf', () => {
  it('produces a non-empty PDF document from a mixed chart', async () => {
    const bytes = await buildEcfaChartPdf(NODES, { title: 'ECFA', subtitle: 'INC-2026-0001' })
    expect(bytes.byteLength).toBeGreaterThan(500)
    // PDF magic header "%PDF"
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x25, 0x50, 0x44, 0x46])
  })

  it('handles an empty chart without throwing', async () => {
    const bytes = await buildEcfaChartPdf([], { title: 'ECFA' })
    expect(bytes.byteLength).toBeGreaterThan(300)
  })
})
