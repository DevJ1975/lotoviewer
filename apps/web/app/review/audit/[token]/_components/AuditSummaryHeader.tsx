import type { AuditSeverity, LotoAuditChange } from '@/lib/loto/audit/schemas'
import {
  SEVERITY_BADGE,
} from '@/app/admin/loto/audit/_lib/changeDisplay'

// Read-only banner at the top of the reviewer surface. Summarizes the change-set
// the reviewer is about to walk: counts by severity, how many reference photos
// are proposed, and the EHS pass/fail tally from the per-equipment results.

export interface AuditResult {
  equipment_id:            string
  iso_photo_verdict:       string | null
  equip_photo_verdict:     string | null
  ds_equipment_confidence: string | null
  ehs_pass:                boolean | null
  ehs_notes:               string | null
}

const SEVERITY_ORDER: AuditSeverity[] = ['critical', 'high', 'medium', 'low', 'info']

export default function AuditSummaryHeader({
  tenantName, changes, results,
}: {
  tenantName: string
  changes:    LotoAuditChange[]
  results:    AuditResult[]
}) {
  const bySeverity: Record<string, number> = {}
  let placeholders = 0
  for (const c of changes) {
    if (c.severity) bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1
    if (c.change_kind === 'placeholder_photo') placeholders += 1
  }
  const ehsPass = results.filter(r => r.ehs_pass === true).length
  const ehsFail = results.filter(r => r.ehs_pass === false).length

  return (
    <header className="rounded-xl bg-brand-navy p-5 text-white">
      <div className="text-[11px] font-bold uppercase tracking-widest opacity-90">
        SoteriaField · LOTO audit review
      </div>
      <h1 className="mt-1 text-2xl font-bold">{tenantName}</h1>
      <p className="mt-2 text-sm opacity-90">
        Our automated audit staged {changes.length} change{changes.length === 1 ? '' : 's'} across {results.length} piece{results.length === 1 ? '' : 's'} of equipment. Approve or reject each one below, then sign off. Nothing is applied until your client&apos;s admin reviews your decisions.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Reference photos" value={placeholders} />
        <Stat label="EHS pass" value={ehsPass} />
        <Stat label="EHS fail" value={ehsFail} />
        <Stat label="Total changes" value={changes.length} />
      </div>

      {SEVERITY_ORDER.some(sev => bySeverity[sev]) && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter(sev => bySeverity[sev]).map(sev => (
            <span key={sev} className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${SEVERITY_BADGE[sev]}`}>
              {bySeverity[sev]} {sev}
            </span>
          ))}
        </div>
      )}
    </header>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/10 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-widest text-white/75">{label}</p>
      <p className="mt-0.5 text-2xl font-black tabular-nums">{value}</p>
    </div>
  )
}
