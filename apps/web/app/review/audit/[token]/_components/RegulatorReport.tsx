'use client'

import { useState } from 'react'
import type { RegulatorMachineResult, RegulatorProgramResult } from '@/lib/loto/audit/schemas'

// Cal/OSHA Inspector's Report (migration 221). The reviewer reads this BEFORE
// approving the staged changes: a program-level §3314 audit at the top of the
// page, and a per-machine inspector narrative inline with each machine's
// changes. Read-only — the inspector's critique is context for the human, not a
// decision surface. Style follows the existing reviewer components (slate cards,
// small uppercase labels, status chips).

const ELEMENT_STATUS_CHIP: Record<RegulatorProgramResult['program_elements'][number]['status'], string> = {
  compliant:     'bg-emerald-100 text-emerald-800',
  deficient:     'bg-rose-100 text-rose-800',
  not_evaluable: 'bg-slate-200 text-slate-600',
}

// Program-level report, collapsible, pinned to the top of the reviewer surface.
// `report` is unknown-typed from the API (jsonb); narrow defensively so a run
// that errored its program review (stored {error}) renders nothing rather than
// throwing.
export function RegulatorReportSection({ report }: { report: unknown }) {
  const [open, setOpen] = useState(true)
  const r = asProgramResult(report)
  if (!r) return null

  return (
    <section className="overflow-hidden rounded-xl border border-indigo-200 bg-white">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-2 bg-indigo-50 px-5 py-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
            Cal/OSHA inspector
          </span>
          <span className="text-sm font-bold text-indigo-900">Inspector&apos;s report</span>
        </span>
        <span className="text-xs font-semibold text-indigo-700">{open ? 'Hide' : 'Show'}</span>
      </button>

      {open && (
        <div className="space-y-5 p-5">
          <p className="text-sm leading-relaxed text-slate-700">{r.executive_summary}</p>

          {r.top_priorities.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Top priorities</h3>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-slate-700">
                {r.top_priorities.map((p, i) => <li key={i}>{p}</li>)}
              </ol>
            </div>
          )}

          {r.program_elements.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">§3314 program elements</h3>
              <ul className="mt-2 space-y-2">
                {r.program_elements.map((el, i) => (
                  <li key={i} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${ELEMENT_STATUS_CHIP[el.status]}`}>
                        {el.status.replace('_', ' ')}
                      </span>
                      <span className="text-sm font-semibold text-slate-900">{el.element}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">{el.finding}</p>
                    {el.citation && <p className="mt-0.5 font-mono text-[11px] text-slate-400">{el.citation}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {r.systemic_findings.length > 0 && (
            <div>
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Systemic findings</h3>
              <ul className="mt-2 space-y-2">
                {r.systemic_findings.map((f, i) => (
                  <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-900">
                        {f.severity}
                      </span>
                      <span className="text-sm font-semibold text-amber-900">{f.pattern}</span>
                      <span className="text-[11px] font-semibold text-amber-700">{f.affected_count} affected</span>
                    </div>
                    <p className="mt-1 text-xs text-amber-900">{f.recommended_action}</p>
                    {f.citation && <p className="mt-0.5 font-mono text-[11px] text-amber-700/80">{f.citation}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

// Per-machine inspector narrative + dissent detail, shown inline with a
// machine's staged changes. Renders nothing when the machine has no regulator
// review.
export function MachineRegulatorNote({ payload, concurs }: { payload: RegulatorMachineResult | null; concurs: boolean | null }) {
  if (!payload) return null
  const dissent = concurs === false
  return (
    <div className={`mt-3 rounded-lg border p-3 ${dissent ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-white">
          Cal/OSHA inspector
        </span>
        {dissent && (
          <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800">
            Regulator sharpened
          </span>
        )}
      </div>
      {payload.inspector_narrative && (
        <p className="mt-2 text-xs leading-relaxed text-slate-700">{payload.inspector_narrative}</p>
      )}
      {payload.procedure_deficiencies.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-600">
          {payload.procedure_deficiencies.map((d, i) => <li key={i}>{d}</li>)}
        </ul>
      )}
    </div>
  )
}

// jsonb from the API is unknown. A successful program review is an object with
// the four required arrays/string; a failed one is {error}. Narrow to the
// success shape, returning null otherwise so the section just doesn't render.
function asProgramResult(value: unknown): RegulatorProgramResult | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<RegulatorProgramResult>
  if (typeof v.executive_summary !== 'string') return null
  if (!Array.isArray(v.program_elements) || !Array.isArray(v.systemic_findings) || !Array.isArray(v.top_priorities)) return null
  return v as RegulatorProgramResult
}
