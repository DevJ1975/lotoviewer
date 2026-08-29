// Builds the slice of stored conversation history that is legal to send to
// the Messages API.
//
// Two API rules constrain the window, and both fail loudly rather than
// degrading, so they are easy to get wrong and hard to notice in review:
//
//   1. The first message must be a `user` turn. A window that opens on an
//      `assistant` turn is rejected.
//   2. The last message must NOT be an `assistant` turn. A trailing assistant
//      message is an assistant prefill, which the Claude 4.6 family and every
//      later model reject outright.
//
// Rule 2 is the one that bites when paging. Callers persist the user's new
// turn and then read the tail of the conversation back, so the window ends on
// that user turn — but only if the read actually returns the tail. Postgres
// applies LIMIT after ORDER BY, so `.order('created_at', { ascending: true })
// .limit(n)` returns the OLDEST n rows. Past n stored messages that window
// freezes at the opening of the conversation: the model stops seeing the
// user's current question AND the window ends on an assistant turn.
//
// So: always read newest-first (`.order('created_at', { ascending: false })
// .limit(n)`) and hand the rows straight to this function.
//
// Rule 1 then needs the trim. Stored turns alternate user/assistant, so the
// tail of an odd-length history begins one turn "too late" — taking the last
// n rows of ...user/assistant/user lands on an assistant turn whenever n is
// even. Dropping leading assistant turns costs at most one turn of context and
// is what keeps the window sendable at every conversation length.

/** A stored turn, narrowed to the two roles the Messages API accepts. */
export interface HistoryTurn {
  role: 'user' | 'assistant'
}

/**
 * Converts a newest-first page of stored turns into the chronological window
 * to send to the Messages API.
 *
 * Returns `[]` when the page holds no user turn — there is no legal window to
 * build from an assistant-only page, and an empty history is a valid request.
 *
 * @param newestFirst Rows as returned by a descending `created_at` query.
 */
export function toSendableHistory<T extends HistoryTurn>(
  newestFirst: readonly T[],
): T[] {
  const chronological = [...newestFirst].reverse()
  const firstUserTurn = chronological.findIndex(turn => turn.role === 'user')
  return firstUserTurn === -1 ? [] : chronological.slice(firstUserTurn)
}
