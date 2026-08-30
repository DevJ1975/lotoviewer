// Shared constants for list-endpoint query params. Seven API routes
// accept a ?dir= param; they validate against this single list so the
// accepted values can't drift between modules.
export const SORT_DIRS = ['asc', 'desc'] as const
export type SortDir = (typeof SORT_DIRS)[number]
