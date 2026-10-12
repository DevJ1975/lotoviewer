// Layer jurisdiction packs into the library a site actually sees.
//
// Packs are applied in chain order (federal first, then the state). Within one
// pack the operations run remove -> replace -> patch -> add, so a pack can drop a
// federal item and add its own under a different id, and `add` can never silently
// shadow something already there. A pack that points at an id that does not exist
// is a bug in the pack and fails loudly, at load, with the pack and id named:
// silently skipping it would ship a state that quietly isn't what its author meant.

import type {
  ChecklistItemDef, ChecklistTemplateDef, JurisdictionPack, LegalRequirementDef, ObligationDef,
  GuideDef, Overlay, PackMeta, Resolved, ResolvedChecklistTemplate, ResolvedLibrary,
} from './content'
import type { JurisdictionCode } from './jurisdiction'

export class PackError extends Error {
  constructor(layer: JurisdictionCode, message: string) {
    super(`pack ${layer}: ${message}`)
    this.name = 'PackError'
  }
}

type Keyed = { id: string }

function applyOverlay<T extends Keyed, R extends Keyed = Resolved<T>>(
  current: R[],
  overlay: Overlay<T> | undefined,
  layer: JurisdictionCode,
  what: string,
  build: (item: T, layer: JurisdictionCode, replaced?: R) => R,
  patchInto: (existing: R, fields: Partial<Omit<T, 'id'>>, layer: JurisdictionCode) => R,
): R[] {
  if (!overlay) return current
  let items = [...current]
  const indexOf = (id: string) => items.findIndex(i => i.id === id)

  for (const { id, reason } of overlay.remove ?? []) {
    if (!reason.trim()) throw new PackError(layer, `removing ${what} '${id}' needs a reason`)
    const at = indexOf(id)
    if (at < 0) throw new PackError(layer, `cannot remove ${what} '${id}': no such id in the layers below`)
    items.splice(at, 1)
  }
  for (const replacement of overlay.replace ?? []) {
    const at = indexOf(replacement.id)
    if (at < 0) throw new PackError(layer, `cannot replace ${what} '${replacement.id}': no such id in the layers below`)
    items[at] = build(replacement, layer, items[at])
  }
  for (const { id, fields } of overlay.patch ?? []) {
    if ('id' in fields) throw new PackError(layer, `a patch cannot change the id of ${what} '${id}'`)
    const at = indexOf(id)
    if (at < 0) throw new PackError(layer, `cannot patch ${what} '${id}': no such id in the layers below`)
    items[at] = patchInto(items[at]!, fields, layer)
  }
  for (const added of overlay.add ?? []) {
    if (indexOf(added.id) >= 0) {
      throw new PackError(layer, `cannot add ${what} '${added.id}': that id already exists (use replace or patch)`)
    }
    items.push(build(added, layer))
  }
  return items
}

const stamp = <T extends Keyed>(item: T, layer: JurisdictionCode, replaced?: Resolved<Keyed>): Resolved<T> =>
  ({ ...item, source: layer, ...(replaced ? { overrides: replaced.source } : {}) })

const patchFlat = <T extends Keyed>(existing: Resolved<T>, fields: Partial<Omit<T, 'id'>>, layer: JurisdictionCode): Resolved<T> =>
  ({ ...existing, ...fields, source: layer, overrides: existing.source })

function resolveItems(
  items: Resolved<ChecklistItemDef>[], overlay: Overlay<ChecklistItemDef> | undefined, layer: JurisdictionCode, templateId: string,
): Resolved<ChecklistItemDef>[] {
  return applyOverlay<ChecklistItemDef>(items, overlay, layer, `item of '${templateId}'`, stamp, patchFlat)
}

export function resolveLibrary(
  chain: readonly JurisdictionCode[],
  packs: Readonly<Partial<Record<JurisdictionCode, JurisdictionPack>>>,
): ResolvedLibrary {
  let checklists: ResolvedChecklistTemplate[] = []
  let obligations: Resolved<ObligationDef>[] = []
  let legal: Resolved<LegalRequirementDef>[] = []
  let guides: Resolved<GuideDef>[] = []
  const metas: PackMeta[] = []

  const buildTemplate = (def: ChecklistTemplateDef, layer: JurisdictionCode, replaced?: ResolvedChecklistTemplate): ResolvedChecklistTemplate => ({
    ...def, source: layer, ...(replaced ? { overrides: replaced.source } : {}),
    items: def.items.map(item => stamp(item, layer)),
  })
  const patchTemplate = (
    existing: ResolvedChecklistTemplate, fields: Partial<Omit<ChecklistTemplateDef, 'id'>>, layer: JurisdictionCode,
  ): ResolvedChecklistTemplate => {
    const { items, ...rest } = fields
    return {
      ...existing, ...rest, source: layer, overrides: existing.source,
      items: items ? items.map(item => stamp(item, layer)) : existing.items,
    }
  }

  for (const layer of chain) {
    const pack = packs[layer]
    if (!pack) throw new PackError(layer, 'is in the jurisdiction chain but no pack is registered for it')
    if (pack.meta.jurisdiction !== layer) {
      throw new PackError(layer, `is registered under '${layer}' but declares jurisdiction '${pack.meta.jurisdiction}'`)
    }
    metas.push(pack.meta)

    checklists = applyOverlay<ChecklistTemplateDef, ResolvedChecklistTemplate>(
      checklists, pack.checklists, layer, 'checklist', buildTemplate, patchTemplate,
    )
    for (const [templateId, overlay] of Object.entries(pack.checklistItems ?? {})) {
      const at = checklists.findIndex(t => t.id === templateId)
      if (at < 0) throw new PackError(layer, `item changes target checklist '${templateId}', which does not exist`)
      const template = checklists[at]!
      checklists[at] = { ...template, source: layer, overrides: template.source, items: resolveItems(template.items, overlay, layer, templateId) }
    }
    obligations = applyOverlay<ObligationDef>(obligations, pack.obligations, layer, 'obligation', stamp, patchFlat)
    legal = applyOverlay<LegalRequirementDef>(legal, pack.legal, layer, 'legal requirement', stamp, patchFlat)
    guides = applyOverlay<GuideDef>(guides, pack.guides, layer, 'guide', stamp, patchFlat)
  }

  return { chain: [...chain], packs: metas, checklists, obligations, legal, guides }
}
