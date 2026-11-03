// Words a person reads while filing a report — shared by the web forms,
// the printed QR poster, the anonymous QR form, and the mobile app so the
// safety-critical lines cannot drift apart between surfaces.
//
// Why this lives in core: the "get help first" notice must say the same
// thing on a poster at ten feet and on a phone in a glove. One source, one
// review, one translation to check.

export type GuidanceLocale = 'en' | 'es'

export interface ReporterEmergencyNotice {
  /** Shown large. Readable at a glance, before anything else on the screen. */
  heading: string
  body:    string
}

// Deliberately names no phone number: the number is a site fact the tenant
// owns. "Your site emergency number" is true everywhere; a placeholder
// shipped to a worker is not.
export const REPORTER_EMERGENCY_NOTICE: Record<GuidanceLocale, ReporterEmergencyNotice> = {
  en: {
    heading: 'Someone hurt or in danger right now?',
    body:    'Stop the job and get help first: call your site emergency number or tell your supervisor. '
           + 'If you can do it safely, keep people out of the area. '
           + 'Don’t restart equipment or clean up until the safety team says so. '
           + 'This form can wait. Someone in danger can’t.',
  },
  es: {
    heading: '¿Alguien herido o en peligro ahora mismo?',
    body:    'Pare el trabajo y pida ayuda primero: llame al número de emergencias de su lugar de trabajo o avise a su supervisor. '
           + 'Si puede hacerlo con seguridad, mantenga a la gente fuera del área. '
           + 'No reinicie equipos ni limpie hasta que el equipo de seguridad lo indique. '
           + 'Este formulario puede esperar; una persona en peligro no.',
  },
}

// Anchors for "what's the worst that could have happened?". The same four
// bands the incident and near-miss forms share, described by outcome rather
// than by recordkeeping category: a reporter can say "it could have put
// someone in the hospital" but cannot reliably say "lost-time injury
// possible", and a bare "high" means something different to every reader.
// "Extreme" names life-altering injury, not only death — an amputation or a
// crush is not a lost-time event, and a scale that stops at "fatal" teaches
// people to under-call exactly the injuries that change a life.
export const SEVERITY_POTENTIAL_HELP: Record<'low' | 'moderate' | 'high' | 'extreme', string> = {
  low:      'Wouldn’t have hurt anyone',
  moderate: 'Could have needed first aid or a clinic visit',
  high:     'Could have put someone in the hospital or off work',
  extreme:  'Could have killed someone or changed their life: amputation, crushing, fall from height, electrocution, serious burn, caught in a machine',
}
