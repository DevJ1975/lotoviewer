// Land Disposal Restrictions (LDR) one-time notice — 40 CFR 268.7(a).
//
// A generator of LDR-restricted waste must send a one-time notice/certification
// to the receiving treatment/storage/disposal facility with the FIRST shipment
// of each waste stream (and re-issue it when the waste or treatment standard
// changes). Missing LDR paperwork is a frequent audit finding.
//
// There is no shipments/manifest table yet, so this module does two things:
//   1. ldrNoticeStatus — is a notice required, and is it still outstanding?
//   2. buildLdrNotice  — assemble the notice content from a stream + facility
//                        so the UI can render/print a preparation packet.
//
// Like the rest of the module, the generated notice is a PREPARATION RECORD,
// not a substitute for the generator's own certified submission to the TSDF.

import { partitionWasteCodes } from './wasteCodes'
import type { HazardousWasteStreamRow } from './hazardousWaste'

export interface LdrNoticeStatus {
  /** The stream is flagged LDR-restricted. */
  required: boolean
  /** A notice has been recorded as sent. */
  sent: boolean
  /** Required but not yet sent — the actionable state. */
  outstanding: boolean
  /** ISO date the notice was sent, when known. */
  sentDate: string | null
}

export function ldrNoticeStatus(
  stream: Pick<HazardousWasteStreamRow, 'ldr_restricted' | 'ldr_notice_sent' | 'ldr_notice_date'>,
): LdrNoticeStatus {
  const required = stream.ldr_restricted === true
  const sent = stream.ldr_notice_sent === true
  return {
    required,
    sent,
    outstanding: required && !sent,
    sentDate: stream.ldr_notice_date ?? null,
  }
}

export interface LdrNoticeGeneratorInfo {
  generatorName: string | null
  epaIdNumber: string | null
}

export interface LdrNotice {
  generatorName: string | null
  epaIdNumber: string | null
  wasteStreamName: string
  /** Federal EPA waste codes (D/F/K/P/U) carried by the stream. */
  epaWasteCodes: string[]
  /** California 3-digit codes carried by the stream. */
  californiaWasteCodes: string[]
  /** Optional manifest tracking number, when issued with a shipment. */
  manifestTrackingNumber: string | null
  /** ISO date the notice is dated. */
  noticeDate: string
  /** The certification language a generator signs (40 CFR 268.7(a)). */
  certificationStatement: string
}

const LDR_CERTIFICATION =
  'This waste is subject to the Land Disposal Restrictions of 40 CFR Part 268. ' +
  'The applicable EPA waste codes and treatment standards are identified above. ' +
  'The generator certifies that the information is accurate to the best of their knowledge.'

/**
 * Assemble an LDR notice from a stream + generator info. Pure: the caller
 * supplies `noticeDate` and any `manifestTrackingNumber` so the output is
 * deterministic and testable.
 */
export function buildLdrNotice(
  stream: Pick<HazardousWasteStreamRow, 'name' | 'waste_codes'>,
  generator: LdrNoticeGeneratorInfo,
  noticeDate: string,
  manifestTrackingNumber: string | null = null,
): LdrNotice {
  const { epa, california } = partitionWasteCodes(stream.waste_codes)
  return {
    generatorName: generator.generatorName,
    epaIdNumber: generator.epaIdNumber,
    wasteStreamName: stream.name,
    epaWasteCodes: epa,
    californiaWasteCodes: california,
    manifestTrackingNumber,
    noticeDate,
    certificationStatement: LDR_CERTIFICATION,
  }
}
