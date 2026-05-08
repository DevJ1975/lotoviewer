// Text extraction for uploaded policy documents.
//
// Supported inputs:
//   - text/markdown, text/plain, text/x-markdown → read as UTF-8
//   - application/pdf → ask Claude Sonnet to extract plain text from the
//     PDF (matches the parse-sds posture; no new dependency on pdf-parse
//     or pdfjs-dist). Costs tokens, but the route is operator-only and
//     called once per upload.
//   - application/json → reject (not a policy text format)
//
// Returns the extracted text plus optional usage telemetry so the
// upload route can log it to ai_invocations.

import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropic } from '@/lib/ai/client'
import { SONNET } from '@/lib/ai/models'

export type ExtractMime =
  | 'text/markdown'
  | 'text/x-markdown'
  | 'text/plain'
  | 'application/pdf'

export const SUPPORTED_MIMES: ExtractMime[] = [
  'text/markdown', 'text/x-markdown', 'text/plain', 'application/pdf',
]

export const MAX_BYTES = 25 * 1024 * 1024  // 25 MB

export class UnsupportedMimeError extends Error {
  constructor(mime: string) {
    super(`Unsupported MIME type: ${mime}. Supported: ${SUPPORTED_MIMES.join(', ')}.`)
    this.name = 'UnsupportedMimeError'
  }
}

interface ExtractArgs {
  bytes:    Uint8Array
  mime:     string
  /** Tenant id for the upload — passed through to getAnthropic when we
   *  need to extract a PDF. NULL for global-doc uploads. */
  tenantId: string | null
}

interface ExtractResult {
  text: string
  /** Set when the extractor used Claude. */
  usage?: {
    inputTokens:     number
    outputTokens:    number
    cacheReadTokens: number
  }
}

const PDF_EXTRACT_SYSTEM = `You extract plain text from policy and regulation PDF documents. Return the document's text content as faithful plain text:
- Preserve paragraph structure with blank lines between paragraphs.
- Preserve numbered/bulleted lists with their markers.
- Preserve section headings on their own line.
- Drop running headers, footers, page numbers, watermarks.
- Do NOT summarize, paraphrase, or omit content.
- Do NOT add commentary, preamble, or markdown formatting beyond what the original used.

If the PDF appears to be a scanned image rather than searchable text, reply only with: SCAN_NOT_OCRED.`

export async function extractPolicyText(args: ExtractArgs): Promise<ExtractResult> {
  const { bytes, mime, tenantId } = args

  if (bytes.byteLength > MAX_BYTES) {
    throw new Error(`File exceeds the ${MAX_BYTES / 1024 / 1024}MB cap`)
  }

  // Plain-text formats: decode UTF-8 directly. Strip a leading BOM if
  // present (common when Word exports markdown).
  if (mime === 'text/markdown' || mime === 'text/x-markdown' || mime === 'text/plain') {
    let text = Buffer.from(bytes).toString('utf-8')
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1)
    return { text }
  }

  if (mime === 'application/pdf') {
    const client = await getAnthropic(tenantId)
    const base64 = Buffer.from(bytes).toString('base64')
    const response = await client.messages.create({
      model:      SONNET,
      max_tokens: 16000,
      system:     PDF_EXTRACT_SYSTEM,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          {
            type: 'text',
            text: 'Extract the plain text of this document per the system instructions.',
          },
        ],
      }],
    } as Parameters<Anthropic['messages']['create']>[0])

    const textBlock = response.content.find(b => b.type === 'text')
    const extracted = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    return {
      text: extracted,
      usage: {
        inputTokens:     response.usage?.input_tokens ?? 0,
        outputTokens:    response.usage?.output_tokens ?? 0,
        cacheReadTokens: response.usage?.cache_read_input_tokens ?? 0,
      },
    }
  }

  throw new UnsupportedMimeError(mime)
}

/**
 * Compute a hex SHA-256 of the given bytes. Used to dedupe uploads —
 * the unique constraint on knowledge_documents.content_sha256 catches
 * an accidental re-upload of the same file.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Use the Web Crypto API which is available in both Node 20+ and the
  // Edge runtime. crypto.subtle.digest is the cross-runtime path.
  // Wrap the slice into a fresh Uint8Array so SubtleCrypto sees an
  // ArrayBuffer with no offset (some Node builds reject the alias).
  const u8 = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes as ArrayBuffer)
  const buf = await crypto.subtle.digest('SHA-256', u8)
  const hex: string[] = []
  const view = new Uint8Array(buf)
  for (let i = 0; i < view.length; i++) hex.push(view[i].toString(16).padStart(2, '0'))
  return hex.join('')
}
