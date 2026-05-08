// Token-aware text chunker for the RAG knowledge base.
//
// Strategy: paragraph-first splitting with a soft token budget. We
// chunk on paragraph boundaries (double-newline) when they fit, and
// fall back to sentence-level splits for paragraphs that exceed the
// budget. Each chunk gets a small overlap (last few sentences of the
// prior chunk) to preserve context across boundaries — which matters
// a lot for regulation text where a citation can straddle a paragraph
// break.
//
// Token estimation: we don't ship a tokenizer (cost in deps); use a
// well-known approximation — ~4 chars per token for English. That's
// good enough for budgeting; the embedder enforces the real cap and
// will reject oversized inputs.

const APPROX_CHARS_PER_TOKEN = 4
const DEFAULT_TARGET_TOKENS = 800
const DEFAULT_OVERLAP_TOKENS = 100
// pgvector chunk text column is capped at 8000 chars — keep chunks
// well under that even after overlap. ~1500 tokens × 4 chars/token
// = 6000 chars, which leaves headroom.
const HARD_CHAR_CAP = 6000

export interface Chunk {
  index:      int
  text:       string
  tokenEst:   int
  /** First/last position in the source text. Useful for citing back
   *  to a page or section number; passed through as metadata. */
  startChar:  int
  endChar:    int
}

type int = number

interface ChunkArgs {
  text:           string
  /** Target token count per chunk. Default 800. */
  targetTokens?:  int
  /** How many tokens of overlap to carry from the previous chunk's
   *  end into the next chunk's start. Default 100. */
  overlapTokens?: int
}

function approxTokens(s: string): int {
  return Math.ceil(s.length / APPROX_CHARS_PER_TOKEN)
}

// Split `s` into sentences. Naive — splits on `. `, `! `, `? ` and
// preserves the punctuation. Good enough for English regulatory
// prose; specialised text (Spanish, line-broken regs) may want a
// smarter split, but that's a follow-up.
function splitSentences(s: string): string[] {
  const out: string[] = []
  let buffer = ''
  for (let i = 0; i < s.length; i++) {
    buffer += s[i]
    const ch = s[i]
    const next = s[i + 1]
    if ((ch === '.' || ch === '!' || ch === '?') && (next === ' ' || next === '\n' || next === undefined)) {
      out.push(buffer.trim())
      buffer = ''
    }
  }
  if (buffer.trim()) out.push(buffer.trim())
  return out.filter(p => p.length > 0)
}

/**
 * Chunks `text` for embedding. Returns chunks in source order.
 *
 * Algorithm:
 *   1. Split on double newlines into paragraphs.
 *   2. Walk paragraphs accumulating into a chunk until the next
 *      paragraph would exceed targetTokens.
 *   3. If a single paragraph exceeds targetTokens on its own, split
 *      it sentence-by-sentence.
 *   4. After flushing a chunk, carry the last ~overlapTokens of
 *      sentences forward into the next chunk's seed.
 */
export function chunkText(args: ChunkArgs): Chunk[] {
  const { text } = args
  const targetTokens  = args.targetTokens  ?? DEFAULT_TARGET_TOKENS
  const overlapTokens = args.overlapTokens ?? DEFAULT_OVERLAP_TOKENS

  if (!text.trim()) return []

  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const chunks: Chunk[] = []

  let buffer:        string[] = []
  let bufferTokens:  number   = 0
  let bufferStart:   number   = -1
  let cursor:        number   = 0

  // Helper: flush the current buffer as a chunk, prepare overlap for
  // the next chunk.
  function flush(): string[] {
    if (buffer.length === 0) return []
    const text = buffer.join('\n\n').trim()
    if (!text) { buffer = []; bufferTokens = 0; return [] }
    const idx = chunks.length
    const startChar = bufferStart === -1 ? 0 : bufferStart
    const endChar   = startChar + text.length
    chunks.push({
      index:     idx,
      text:      text.slice(0, HARD_CHAR_CAP),
      tokenEst:  approxTokens(text),
      startChar,
      endChar,
    })

    // Build the overlap seed: take the last sentences of the buffer
    // until we hit overlapTokens.
    const lastBlock = buffer[buffer.length - 1]
    const sentences = splitSentences(lastBlock)
    const seed: string[] = []
    let seedTokens = 0
    for (let i = sentences.length - 1; i >= 0; i--) {
      const s = sentences[i]
      const t = approxTokens(s)
      if (seedTokens + t > overlapTokens && seed.length > 0) break
      seed.unshift(s)
      seedTokens += t
    }
    buffer = []
    bufferTokens = 0
    bufferStart = -1
    return seed
  }

  // Add a paragraph to the current chunk. If adding it would blow
  // past the target AND the buffer isn't empty, flush first and seed
  // the new buffer with overlap.
  function addParagraph(p: string, posInSource: number): void {
    const pTokens = approxTokens(p)

    // Single paragraph longer than target → sentence-split.
    if (pTokens > targetTokens) {
      const sentences = splitSentences(p)
      for (const s of sentences) addParagraph(s, posInSource)
      return
    }

    if (bufferTokens + pTokens > targetTokens && buffer.length > 0) {
      const seed = flush()
      if (seed.length > 0) {
        buffer.push(seed.join(' '))
        bufferTokens = approxTokens(buffer[0])
        bufferStart = posInSource
      }
    }
    if (bufferStart === -1) bufferStart = posInSource
    buffer.push(p)
    bufferTokens += pTokens
  }

  for (const p of paragraphs) {
    const pos = text.indexOf(p, cursor)
    cursor = pos === -1 ? cursor : pos + p.length
    addParagraph(p, pos === -1 ? cursor : pos)
  }
  flush()

  return chunks
}
