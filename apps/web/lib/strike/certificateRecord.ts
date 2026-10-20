import type { SupabaseClient } from '@supabase/supabase-js'
import type { StrikeLearner, StrikeResult } from '@/lib/strike/attempts'
import { certificateFilename, type CertificateData } from '@/lib/strike/certificate'

// What a learner's certificate says, read from their completion record. The
// browser only names the attempt; everything printed comes from here, so a
// certificate can't claim a score or a date the record doesn't hold.

export interface CertificateRecord {
  data: CertificateData
  filename: string
}

interface CompletionRow {
  id: string
  tenant_id: string
  module_id: string
  module_version_id: string
  user_id: string | null
  member_id: string | null
  completed_at: string
  score_percent: number | null
  evidence: Record<string, unknown> | null
}

export async function loadCertificateRecord(
  admin: SupabaseClient,
  learner: Pick<StrikeLearner, 'tenantId' | 'userId' | 'memberId'>,
  attemptId: string,
): Promise<StrikeResult<CertificateRecord>> {
  const { data: completion, error } = await admin
    .from('strike_completions')
    .select('id,tenant_id,module_id,module_version_id,user_id,member_id,completed_at,score_percent,evidence')
    .eq('attempt_id', attemptId)
    .eq('tenant_id', learner.tenantId)
    .eq('passed', true)
    .maybeSingle<CompletionRow>()
  if (error) throw new Error(error.message)
  const owned = !!completion && (learner.userId ? completion.user_id === learner.userId : completion.member_id === learner.memberId)
  if (!completion || !owned) return { ok: false, status: 404, message: 'No completed training found for this session.' }

  const [moduleRes, versionRes, tenantRes, nameRes, signatoryRes] = await Promise.all([
    admin.from('strike_modules').select('title').eq('id', completion.module_id).maybeSingle(),
    admin.from('strike_module_versions').select('title,locale').eq('id', completion.module_version_id).maybeSingle(),
    admin.from('tenants').select('name').eq('id', completion.tenant_id).maybeSingle(),
    completion.user_id
      ? admin.from('profiles').select('full_name,email').eq('id', completion.user_id).maybeSingle()
      : admin.from('members').select('preferred_name,display_name').eq('id', completion.member_id).maybeSingle(),
    admin.from('strike_certificate_signatory').select('signer_name,signer_title,issuer,signature_png').maybeSingle(),
  ])
  const failure = moduleRes.error ?? versionRes.error ?? tenantRes.error ?? nameRes.error ?? signatoryRes.error
  if (failure) throw new Error(failure.message)

  const person = (nameRes.data ?? {}) as Record<string, string | null>
  const learnerName = person.full_name || person.preferred_name || person.display_name || person.email || 'Learner'
  const moduleTitle = (versionRes.data?.title as string | null) || (moduleRes.data?.title as string | undefined) || 'STRIKE module'
  const evidence = completion.evidence ?? {}
  const signatory = signatoryRes.data

  const data: CertificateData = {
    locale: versionRes.data?.locale === 'es' ? 'es' : 'en',
    learnerName,
    moduleTitle,
    organization: (tenantRes.data?.name as string | undefined) ?? '',
    completedAt: new Date(completion.completed_at),
    reference: attemptId,
    result: evidence.mode === 'assisted_verified'
      ? { kind: 'verified', verifierName: String(evidence.verifier_name ?? '') }
      : { kind: 'score', scorePercent: completion.score_percent ?? 100 },
    signatory: signatory
      ? {
          name: signatory.signer_name as string,
          title: signatory.signer_title as string,
          issuer: signatory.issuer as string,
          signaturePng: Buffer.from((signatory.signature_png as string).replace(/^data:image\/png;base64,/, ''), 'base64'),
        }
      : null,
  }
  return { ok: true, value: { data, filename: certificateFilename(moduleTitle) } }
}
