// Word-level text diff. Used by /manuals/[id]/changelog to render a
// side-by-side or inline comparison between two manual versions.
// Pure, dependency-free. Implements Myers' shortest-edit-script in
// O((n+m)·d) time where d is the number of edits — fast in practice
// for the sizes our manuals will reach (a few thousand words).
//
// We tokenise on whitespace + punctuation boundaries so word-level
// changes don't get reported as "the entire paragraph changed."

export type DiffOp = 'equal' | 'insert' | 'delete'

export interface DiffSegment {
  op:    DiffOp
  /** Tokens (with their original spacing baked in) reassembled as a string. */
  text:  string
}

// Tokenise into words + the whitespace/punctuation between them.
// Each token is preserved verbatim; concatenating all tokens yields
// the original input. That property is what makes the diff render
// look natural.
const TOKEN_RE = /(\s+|[^\s\w]+|\w+)/g

export function tokenize(s: string): string[] {
  return s.match(TOKEN_RE) ?? []
}

/** Compute a word-level diff between `a` and `b`. */
export function diffWords(a: string, b: string): DiffSegment[] {
  const A = tokenize(a)
  const B = tokenize(b)
  const ops = myers(A, B)
  // Coalesce adjacent ops of the same kind so the rendered diff has
  // ${TEXT} chunks rather than 1-token spans.
  const out: DiffSegment[] = []
  for (const o of ops) {
    if (out.length === 0 || out[out.length - 1].op !== o.op) {
      out.push({ op: o.op, text: o.text })
    } else {
      out[out.length - 1].text += o.text
    }
  }
  return out
}

interface InternalOp { op: DiffOp; text: string }

// Myers' algorithm. Returns a sequence of (op, token) pairs that
// transform A into B.
function myers(A: string[], B: string[]): InternalOp[] {
  const N = A.length
  const M = B.length
  const max = N + M
  if (max === 0) return []
  // V[k] = furthest x reached on diagonal k. We snapshot V at each d
  // so we can walk back at the end.
  const trace: Array<Map<number, number>> = []
  const V = new Map<number, number>()
  V.set(1, 0)

  outer: for (let d = 0; d <= max; d++) {
    const snapshot = new Map(V)
    trace.push(snapshot)
    for (let k = -d; k <= d; k += 2) {
      let x: number
      if (k === -d || (k !== d && (V.get(k - 1) ?? -1) < (V.get(k + 1) ?? -1))) {
        x = V.get(k + 1) ?? 0
      } else {
        x = (V.get(k - 1) ?? 0) + 1
      }
      let y = x - k
      while (x < N && y < M && A[x] === B[y]) { x++; y++ }
      V.set(k, x)
      if (x >= N && y >= M) {
        // Walk back through the trace to recover the path.
        const ops: InternalOp[] = []
        let curX = N, curY = M
        for (let dd = d; dd > 0; dd--) {
          const snap = trace[dd]
          const kk = curX - curY
          let prevK: number
          if (kk === -dd || (kk !== dd && (snap.get(kk - 1) ?? -1) < (snap.get(kk + 1) ?? -1))) {
            prevK = kk + 1
          } else {
            prevK = kk - 1
          }
          const prevX = snap.get(prevK) ?? 0
          const prevY = prevX - prevK
          while (curX > prevX && curY > prevY) {
            ops.push({ op: 'equal', text: A[curX - 1] })
            curX--; curY--
          }
          if (dd > 0) {
            if (curX === prevX) {
              ops.push({ op: 'insert', text: B[curY - 1] })
              curY--
            } else {
              ops.push({ op: 'delete', text: A[curX - 1] })
              curX--
            }
          }
        }
        while (curX > 0 && curY > 0) {
          ops.push({ op: 'equal', text: A[curX - 1] })
          curX--; curY--
        }
        return ops.reverse()
      }
    }
    if (d === max) break outer
  }
  return []
}
