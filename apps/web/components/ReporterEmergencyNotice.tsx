import { AlertTriangle } from 'lucide-react'
import { REPORTER_EMERGENCY_NOTICE, type GuidanceLocale } from '@soteria/core/reporterGuidance'

// "Get help first" notice shown above every form a worker can file a report
// from. Reporting is asynchronous: whoever reads the report may be hours
// away, so the form itself has to say what to do if the event is live.
// role="note" rather than "alert" — it is standing guidance, not a message
// that appeared in response to something the reporter did.
export default function ReporterEmergencyNotice({ locale = 'en' }: { locale?: GuidanceLocale }) {
  const { heading, body } = REPORTER_EMERGENCY_NOTICE[locale]
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-lg border-2 border-rose-300 bg-rose-50 p-3 text-rose-900 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-100"
    >
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        <p className="text-sm font-bold">{heading}</p>
        <p className="mt-0.5 text-sm">{body}</p>
      </div>
    </div>
  )
}
