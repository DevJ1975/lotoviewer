import { energyCodeFor } from '@soteria/core/energyCodes'

// Ordered energy-control steps for the public QR placard. Server component
// (no interactivity) — renders each step with its color-coded energy badge
// plus the isolation procedure and verification method. The TEXT fields are
// rendered verbatim; the printed packet is checksum-verified against them,
// so we never transform them.

interface EnergyStep {
  energy_type:            string | null
  tag_description:        string | null
  isolation_procedure:    string | null
  method_of_verification: string | null
}

export default function QrEnergySteps({ steps }: { steps: EnergyStep[] }) {
  if (!steps || steps.length === 0) {
    return <p className="text-sm text-slate-500 dark:text-slate-400">No energy-control steps on file.</p>
  }

  return (
    <ol className="space-y-3">
      {steps.map((step, i) => {
        const code = energyCodeFor(step.energy_type)
        return (
          <li
            key={i}
            className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 p-3"
          >
            <div className="flex items-center gap-2">
              <span
                className="inline-flex min-w-7 items-center justify-center rounded-md px-1.5 py-0.5 text-xs font-bold"
                style={{ backgroundColor: code.hex, color: code.textHex }}
              >
                {code.code}
              </span>
              <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                {code.labelEn}
              </span>
              {step.tag_description ? (
                <span className="text-xs text-slate-500 dark:text-slate-400">· {step.tag_description}</span>
              ) : null}
            </div>
            {step.isolation_procedure ? (
              <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Isolate: </span>
                {step.isolation_procedure}
              </p>
            ) : null}
            {step.method_of_verification ? (
              <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold text-slate-500 dark:text-slate-400">Verify: </span>
                {step.method_of_verification}
              </p>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}
