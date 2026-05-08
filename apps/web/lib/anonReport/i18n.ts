// Lightweight in-tree i18n catalog for the anonymous-report form.
//
// We intentionally don't pull in next-intl: the entire surface that
// needs translation is one public route (/report/[token]) and one
// printable poster string. A 60-line catalog beats a routing
// rewrite. If a third public-facing surface ever needs i18n, swap
// this out for next-intl in one PR.
//
// Locale resolution order at runtime:
//   1. ?locale=es query param (admin override / testing)
//   2. tenants.default_report_locale (from /verify response)
//   3. browser navigator.language
//   4. 'en'

export type Locale = 'en' | 'es'

export const SUPPORTED_LOCALES: Locale[] = ['en', 'es']

export function pickLocale(
  candidates: Array<string | null | undefined>,
): Locale {
  for (const c of candidates) {
    if (!c) continue
    const short = c.toLowerCase().slice(0, 2)
    if (SUPPORTED_LOCALES.includes(short as Locale)) return short as Locale
  }
  return 'en'
}

interface Catalog {
  brand:                    string
  pageTitle:                string
  shieldNote:               string
  reportingFrom:            string
  retaliationDefault:       string
  fieldEventKind:           string
  fieldWhen:                string
  fieldWhat:                string
  fieldWhatPlaceholder:     string
  fieldImmediate:           string
  hintOptional:             string
  severityHeading:          string
  severityHint:             string
  severityGreen:            string
  severityAmber:            string
  severityRed:              string
  attachmentsHeading:       string
  attachmentsHint:          string
  addPhoto:                 string
  addVoice:                 string
  recording:                string
  stopRecording:            string
  receiptHeading:           string
  receiptHint:              string
  receiptOptIn:             string
  receiptShown:             string
  submit:                   string
  submitting:               string
  thankYou:                 string
  thankYouRecorded:         string
  thankYouAt:               string
  thankYouTeam:             string
  errorPickType:            string
  errorPickDescription:     string
  errorRequired:            string
  errorTokenInvalid:        string
  errorRateLimit:           string
  errorCaptcha:             string
  errorGeneric:             string
  privacyFooter:            string
  statusLookupCta:          string
}

const en: Catalog = {
  brand:                    'SoteriaField',
  pageTitle:                'Anonymous incident report',
  shieldNote:               'No login. We don’t collect your name.',
  reportingFrom:            'Reporting from',
  retaliationDefault:       'Anonymous reports are protected from retaliation under OSHA 1904.35(b)(1)(iv).',
  fieldEventKind:           'What kind of event?',
  fieldWhen:                'When did it happen?',
  fieldWhat:                'What happened?',
  fieldWhatPlaceholder:     'Describe in your own words. Specifics are most useful — what, where, who was nearby, what almost went wrong.',
  fieldImmediate:           'Anything done in the moment?',
  hintOptional:             'optional',
  severityHeading:          'How serious is it?',
  severityHint:             'You can submit with just this.',
  severityGreen:            'Minor',
  severityAmber:            'Concerning',
  severityRed:              'Urgent',
  attachmentsHeading:       'Photos / voice note',
  attachmentsHint:          'Up to 3 photos and 1 voice memo. Max 10MB each.',
  addPhoto:                 'Add photo',
  addVoice:                 'Record voice',
  recording:                'Recording…',
  stopRecording:            'Stop',
  receiptHeading:           'Want to check status later?',
  receiptHint:              'We’ll show a 6-character code on the next screen. Write it down. You can use it on /report/status to see updates without logging in.',
  receiptOptIn:             'Yes, give me a code',
  receiptShown:             'Your tracking code',
  submit:                   'Submit anonymously',
  submitting:               'Submitting…',
  thankYou:                 'Thank you',
  thankYouRecorded:         'Your report has been recorded',
  thankYouAt:               'at',
  thankYouTeam:             'The safety team will review it. You can close this page.',
  errorPickType:            'Please pick an incident type.',
  errorPickDescription:     'Please describe what happened.',
  errorRequired:            'This field is required.',
  errorTokenInvalid:        'This QR code is no longer active. Please ask your supervisor for an updated sign.',
  errorRateLimit:           'Too many reports from this location in the last hour. Please try again later.',
  errorCaptcha:             'We couldn’t verify the security check. Please reload and try again.',
  errorGeneric:             'Something went wrong submitting your report. Please try again.',
  privacyFooter:            'Your report is sent to the safety team without your name. You may submit additional details by reloading this page.',
  statusLookupCta:          'Check status of an existing report',
}

const es: Catalog = {
  brand:                    'SoteriaField',
  pageTitle:                'Reporte de incidente anónimo',
  shieldNote:               'Sin inicio de sesión. No registramos su nombre.',
  reportingFrom:            'Reportando desde',
  retaliationDefault:       'Los reportes anónimos están protegidos contra represalias bajo OSHA 1904.35(b)(1)(iv).',
  fieldEventKind:           '¿Qué tipo de evento?',
  fieldWhen:                '¿Cuándo ocurrió?',
  fieldWhat:                '¿Qué sucedió?',
  fieldWhatPlaceholder:     'Descríbalo con sus propias palabras. Los detalles son lo más útil — qué, dónde, quién estaba cerca, qué estuvo a punto de salir mal.',
  fieldImmediate:           '¿Hizo algo en el momento?',
  hintOptional:             'opcional',
  severityHeading:          '¿Qué tan grave es?',
  severityHint:             'Puede enviarlo solo con esto.',
  severityGreen:            'Leve',
  severityAmber:            'Preocupante',
  severityRed:              'Urgente',
  attachmentsHeading:       'Fotos / nota de voz',
  attachmentsHint:          'Hasta 3 fotos y 1 nota de voz. Máximo 10 MB cada una.',
  addPhoto:                 'Agregar foto',
  addVoice:                 'Grabar voz',
  recording:                'Grabando…',
  stopRecording:            'Detener',
  receiptHeading:           '¿Desea verificar el estado más tarde?',
  receiptHint:              'Le mostraremos un código de 6 caracteres en la siguiente pantalla. Anótelo. Puede usarlo en /report/status para ver actualizaciones sin iniciar sesión.',
  receiptOptIn:             'Sí, dame un código',
  receiptShown:             'Su código de seguimiento',
  submit:                   'Enviar anónimamente',
  submitting:               'Enviando…',
  thankYou:                 'Gracias',
  thankYouRecorded:         'Su reporte ha sido registrado',
  thankYouAt:               'en',
  thankYouTeam:             'El equipo de seguridad lo revisará. Puede cerrar esta página.',
  errorPickType:            'Por favor seleccione un tipo de incidente.',
  errorPickDescription:     'Por favor describa qué sucedió.',
  errorRequired:            'Este campo es obligatorio.',
  errorTokenInvalid:        'Este código QR ya no está activo. Pida a su supervisor un letrero actualizado.',
  errorRateLimit:           'Demasiados reportes desde esta ubicación en la última hora. Por favor intente más tarde.',
  errorCaptcha:             'No pudimos verificar el control de seguridad. Recargue la página e intente de nuevo.',
  errorGeneric:             'Algo salió mal al enviar su reporte. Por favor intente de nuevo.',
  privacyFooter:            'Su reporte se envía al equipo de seguridad sin su nombre. Puede enviar detalles adicionales recargando esta página.',
  statusLookupCta:          'Verificar estado de un reporte existente',
}

const CATALOGS: Record<Locale, Catalog> = { en, es }

export function t(locale: Locale): Catalog {
  return CATALOGS[locale] ?? CATALOGS.en
}
