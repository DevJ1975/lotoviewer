// Small builders for authoring pack content. They only fill in defaults; they
// add no behaviour, so a pack file still reads as the data it is.

import type { ChecklistItemDef, Citation } from '../content'

export const cite = (ref: string, verify?: string, title?: string): Citation =>
  ({ ref, ...(title ? { title } : {}), ...(verify ? { verify } : {}) })

type ItemOptions = Partial<Omit<ChecklistItemDef, 'id' | 'section' | 'prompt' | 'itemType' | 'citations'>> & { cite: Citation[] }

const base = (id: string, section: string, prompt: string, itemType: ChecklistItemDef['itemType'], o: ItemOptions): ChecklistItemDef => ({
  id, section, prompt, itemType,
  weight: o.weight ?? 1,
  required: o.required ?? true,
  failCreatesAction: o.failCreatesAction ?? false,
  critical: o.critical ?? false,
  ...(o.clauseRef ? { clauseRef: o.clauseRef } : {}),
  ...(o.numeric ? { numeric: o.numeric } : {}),
  ...(o.guidance ? { guidance: o.guidance } : {}),
  ...(o.appliesWhen ? { appliesWhen: o.appliesWhen } : {}),
  citations: o.cite,
})

/** A pass / fail / not-applicable question. Pass means "no problem found". */
export const passFail = (id: string, section: string, prompt: string, o: ItemOptions): ChecklistItemDef =>
  base(id, section, prompt, 'pass_fail_na', o)

export const textItem = (id: string, section: string, prompt: string, o: ItemOptions): ChecklistItemDef =>
  base(id, section, prompt, 'text', o)

export const photoItem = (id: string, section: string, prompt: string, o: ItemOptions): ChecklistItemDef =>
  base(id, section, prompt, 'photo', o)

export const signatureItem = (id: string, section: string, prompt: string, o: ItemOptions): ChecklistItemDef =>
  base(id, section, prompt, 'signature', o)

export const numericItem = (id: string, section: string, prompt: string, o: ItemOptions): ChecklistItemDef =>
  base(id, section, prompt, 'numeric', o)

import type { ChecklistTemplateDef } from '../content'

/**
 * A state's version of a federal template: the same questions, the state's own
 * citations and any renamed fields. Deriving it (rather than copying the item
 * list) keeps the wording in one place, so a federal fix reaches every state.
 * `itemCitations` replaces the citations on EVERY item, because a federal permit
 * citation under a state's heading would misstate the legal basis.
 */
export function rebase(
  source: ChecklistTemplateDef,
  overrides: Partial<Omit<ChecklistTemplateDef, 'id' | 'items'>> & { itemCitations: Citation[] },
): ChecklistTemplateDef {
  const { itemCitations, ...fields } = overrides
  return {
    ...source,
    ...fields,
    items: source.items.map(item => ({ ...item, citations: itemCitations })),
  }
}
