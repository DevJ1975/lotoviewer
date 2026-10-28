import { describe, it, expect } from 'vitest'
import { tilesForDiscipline, type DashboardTile } from '../managementSystemTiles'

const REGISTRY: readonly DashboardTile[] = [
  { id: 'aspects',  discipline: 'ems', title: 'Aspects register', href: '/environmental/aspects' },
  { id: 'hazards',  discipline: 'ohs', title: 'Hazard register',  href: '/ohs/hazards' },
  { id: 'permits',  discipline: 'ems', title: 'Permits',          href: '/environmental/permits' },
]

describe('tilesForDiscipline', () => {
  it('shows only environmental tiles on an EMS dashboard, in registry order', () => {
    expect(tilesForDiscipline(REGISTRY, 'ems').map(t => t.id)).toEqual(['aspects', 'permits'])
  })

  it('shows only OH&S tiles on an OH&S dashboard', () => {
    expect(tilesForDiscipline(REGISTRY, 'ohs').map(t => t.id)).toEqual(['hazards'])
  })

  it('merges every standard on an integrated dashboard, in registry order', () => {
    expect(tilesForDiscipline(REGISTRY, 'integrated').map(t => t.id)).toEqual(['aspects', 'hazards', 'permits'])
  })

  it('returns a copy, so a caller sorting its dashboard cannot reorder the registry', () => {
    const integrated = tilesForDiscipline(REGISTRY, 'integrated')
    integrated.reverse()
    expect(REGISTRY.map(t => t.id)).toEqual(['aspects', 'hazards', 'permits'])
  })

  it('returns no tiles for an empty registry', () => {
    expect(tilesForDiscipline([], 'integrated')).toEqual([])
  })
})
