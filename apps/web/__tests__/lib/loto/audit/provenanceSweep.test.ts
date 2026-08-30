// Unit tests for the PURE provenance detector + URL-key helper. No I/O — the
// runProvenanceSweep wrapper (DB reads/inserts) is exercised separately against
// a real tenant; here we pin the detection contract a worklist depends on.

import { describe, expect, it } from 'vitest'
import { buildProvenanceFindings, objectKeyFromUrl } from '@/lib/loto/audit/provenanceSweep'

const eq = (equipment_id: string, department: string | null, iso_obj: string | null) =>
  ({ equipment_id, department, iso_obj })

describe('objectKeyFromUrl', () => {
  it('strips the public storage prefix to the bare object key', () => {
    expect(objectKeyFromUrl('https://x.supabase.co/storage/v1/object/public/loto-photos/SKT1-500/ISO.jpg'))
      .toBe('SKT1-500/ISO.jpg')
    expect(objectKeyFromUrl('https://x.supabase.co/storage/v1/object/public/loto-photos/SKCC-FRYER-IP.jpg'))
      .toBe('SKCC-FRYER-IP.jpg')
  })
  it('returns null for a null url', () => {
    expect(objectKeyFromUrl(null)).toBeNull()
  })
})

describe('buildProvenanceFindings', () => {
  it('flags a cross-department shared ISO photo as high severity for every member', () => {
    const findings = buildProvenanceFindings({
      equipment: [eq('A-1', 'Tortilla Tc 1', 'SHARED-IP.jpg'), eq('B-1', 'Cheese Curl', 'SHARED-IP.jpg')],
      steps: [],
    })
    expect(findings).toHaveLength(2)
    expect(findings.every(f => f.severity === 'high' && f.agent === 'FPE' && f.code === 'Cal/OSHA T8 §3314(g)(4)')).toBe(true)
    expect(findings.map(f => f.equipment_id).sort()).toEqual(['A-1', 'B-1'])
    expect(findings[0].text).toContain('across 2 departments')
  })

  it('flags a within-line shared ISO photo as medium severity', () => {
    const findings = buildProvenanceFindings({
      equipment: [
        eq('A-1', 'Pop Chip', 'LINE-IP.jpg'),
        eq('A-2', 'Pop Chip', 'LINE-IP.jpg'),
        eq('A-3', 'Pop Chip', 'LINE-IP.jpg'),
      ],
      steps: [],
    })
    expect(findings).toHaveLength(3)
    expect(findings.every(f => f.severity === 'medium')).toBe(true)
    expect(findings[0].text).toContain('on this line')
  })

  it('does not flag a unique ISO photo or a null ISO slot', () => {
    const findings = buildProvenanceFindings({
      equipment: [eq('A-1', 'Pop Chip', 'A-1-IP.jpg'), eq('A-2', 'Pop Chip', 'A-2-IP.jpg'), eq('A-3', 'Pop Chip', null)],
      steps: [],
    })
    expect(findings).toHaveLength(0)
  })

  it('flags an equipment (-EQ) image sitting in the ISO slot as high severity', () => {
    const findings = buildProvenanceFindings({
      equipment: [eq('A-1', 'Automated Packaging', 'LABELER-EQ.jpg'), eq('A-2', 'Automated Packaging', 'LBLR-1-EQ.jpg')],
      steps: [],
    })
    // Each -EQ image is unique here, so the ONLY findings are the wrong-slot ones.
    expect(findings).toHaveLength(2)
    expect(findings.every(f => f.severity === 'high' && f.text.includes('equipment image'))).toBe(true)
  })

  it('flags template-residue steps (DS, medium) only for in-scope equipment', () => {
    const findings = buildProvenanceFindings({
      equipment: [eq('A-1', 'Jensen', 'A-1-IP.jpg')],
      steps: [
        { equipment_id: 'A-1', tag_description: '(CHEESE_MIXER/H) — detail pending', isolation_procedure: 'Procedure for energy type H not yet implemented.', method_of_verification: null },
        { equipment_id: 'OUT-OF-SCOPE', tag_description: 'x', isolation_procedure: 'not yet implemented', method_of_verification: null },
      ],
    })
    const ds = findings.filter(f => f.agent === 'DS')
    expect(ds).toHaveLength(1)
    expect(ds[0]).toMatchObject({ equipment_id: 'A-1', severity: 'medium', code: 'data-quality' })
  })

  it('dedups identical findings (e.g. two residue steps on one machine)', () => {
    const findings = buildProvenanceFindings({
      equipment: [eq('A-1', 'Jensen', 'A-1-IP.jpg')],
      steps: [
        { equipment_id: 'A-1', tag_description: 'not yet implemented', isolation_procedure: null, method_of_verification: null },
        { equipment_id: 'A-1', tag_description: 'not yet implemented', isolation_procedure: null, method_of_verification: null },
      ],
    })
    expect(findings.filter(f => f.agent === 'DS')).toHaveLength(1)
  })
})
