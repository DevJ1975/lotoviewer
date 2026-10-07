// How-to guides for the screens, from the resolved library.

import type { GuideDef, Resolved, ResolvedLibrary } from './content'

/** The guides to show on a screen, in library order. Empty when there is none. */
export function getHowTo(pageKey: string, library: ResolvedLibrary): Resolved<GuideDef>[] {
  return library.guides.filter(guide => guide.pageKeys.includes(pageKey))
}

/** One guide by id. */
export function getGuide(id: string, library: ResolvedLibrary): Resolved<GuideDef> | undefined {
  return library.guides.find(guide => guide.id === id)
}
