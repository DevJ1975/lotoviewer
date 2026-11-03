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
  receiptSaved:             string
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
  errorPickWhen:            string
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
  shieldNote:               'No login. We don’t ask for your name.',
  reportingFrom:            'Reporting from',
  retaliationDefault:       'Retaliation against anyone for raising a safety concern is not allowed. You can tell us without giving your name.',
  fieldEventKind:           'What kind of event?',
  fieldWhen:                'When did it happen?',
  fieldWhat:                'What happened?',
  fieldWhatPlaceholder:     'In your own words: what happened, where, and what was going on around it. No names needed.',
  fieldImmediate:           'Anything done in the moment?',
  hintOptional:             'optional',
  severityHeading:          'How serious is it?',
  severityHint:             'Tap one, then add what and where if you can.',
  severityGreen:            'Minor: unlikely to hurt anyone',
  severityAmber:            'Could hurt someone',
  severityRed:              'Could seriously hurt someone',
  attachmentsHeading:       'Photos / voice note',
  attachmentsHint:          'Up to 3 photos and 1 voice memo, 10MB each. A voice recording can identify you. Photos can show faces, hands and name badges, so frame the hazard, not people.',
  addPhoto:                 'Add photo',
  addVoice:                 'Record voice',
  recording:                'Recording…',
  stopRecording:            'Stop',
  receiptHeading:           'Want to check status later?',
  receiptHint:              'We’ll show a 6-character code on the next screen. Write it down or take a screenshot. Use it with “Check status of an existing report” to see updates, no login needed.',
  receiptSaved:             'Write this code down or take a screenshot. You can use it to check status without logging in.',
  receiptOptIn:             'Yes, give me a code',
  receiptShown:             'Your tracking code',
  submit:                   'Submit anonymously',
  submitting:               'Submitting…',
  thankYou:                 'Thank you',
  thankYouRecorded:         'Your report has been recorded',
  thankYouAt:               'at',
  thankYouTeam:             'The safety team will review it. If this can’t wait, tell your supervisor now.',
  errorPickType:            'Please pick an incident type.',
  errorPickDescription:     'Please describe what happened.',
  errorPickWhen:            'Please enter a valid date and time.',
  errorRequired:            'This field is required.',
  errorTokenInvalid:        'This QR code is no longer active. Please ask your supervisor for an updated sign.',
  errorRateLimit:           'Your report didn’t go through. That’s a limit on our side, not something you did wrong. If it can’t wait, tell your supervisor now. Please try again in a few minutes.',
  errorCaptcha:             'We couldn’t verify the security check. Please reload and try again.',
  errorGeneric:             'Something went wrong submitting your report. Please try again.',
  privacyFooter:            'Your report goes to the safety team without your name. To add something later, send a new report and include your report number.',
  statusLookupCta:          'Check status of an existing report',
}

const es: Catalog = {
  brand:                    'SoteriaField',
  pageTitle:                'Reporte de incidente anónimo',
  shieldNote:               'Sin inicio de sesión. No le pedimos su nombre.',
  reportingFrom:            'Reportando desde',
  retaliationDefault:       'No se permiten represalias contra nadie por avisar de una preocupación de seguridad. Puede avisarnos sin dar su nombre.',
  fieldEventKind:           '¿Qué tipo de evento?',
  fieldWhen:                '¿Cuándo ocurrió?',
  fieldWhat:                '¿Qué sucedió?',
  fieldWhatPlaceholder:     'Con sus propias palabras: qué sucedió, dónde y qué estaba pasando alrededor. No hacen falta nombres.',
  fieldImmediate:           '¿Hizo algo en el momento?',
  hintOptional:             'opcional',
  severityHeading:          '¿Qué tan grave es?',
  severityHint:             'Toque una opción y agregue qué y dónde si puede.',
  severityGreen:            'Leve: poco probable que lastime a alguien',
  severityAmber:            'Podría lastimar a alguien',
  severityRed:              'Podría lastimar gravemente a alguien',
  attachmentsHeading:       'Fotos / nota de voz',
  attachmentsHint:          'Hasta 3 fotos y 1 nota de voz, 10 MB cada una. Su voz grabada puede revelar quién es. Las fotos pueden mostrar caras, manos y gafetes; enfoque el peligro, no a las personas.',
  addPhoto:                 'Agregar foto',
  addVoice:                 'Grabar voz',
  recording:                'Grabando…',
  stopRecording:            'Detener',
  receiptHeading:           '¿Desea verificar el estado más tarde?',
  receiptHint:              'Le mostraremos un código de 6 caracteres en la siguiente pantalla. Anótelo o tómele una captura de pantalla. Úselo con “Verificar estado de un reporte existente” para ver actualizaciones, sin iniciar sesión.',
  receiptSaved:             'Anote este código o tómele una captura de pantalla. Puede usarlo para ver el estado sin iniciar sesión.',
  receiptOptIn:             'Sí, dame un código',
  receiptShown:             'Su código de seguimiento',
  submit:                   'Enviar anónimamente',
  submitting:               'Enviando…',
  thankYou:                 'Gracias',
  thankYouRecorded:         'Su reporte ha sido registrado',
  thankYouAt:               'en',
  thankYouTeam:             'El equipo de seguridad lo revisará. Si no puede esperar, avise a su supervisor ahora.',
  errorPickType:            'Por favor seleccione un tipo de incidente.',
  errorPickDescription:     'Por favor describa qué sucedió.',
  errorPickWhen:            'Por favor ingrese una fecha y hora válidas.',
  errorRequired:            'Este campo es obligatorio.',
  errorTokenInvalid:        'Este código QR ya no está activo. Pida a su supervisor un letrero actualizado.',
  errorRateLimit:           'Su reporte no se envió. Es un límite de nuestro lado, no un error suyo. Si no puede esperar, avise a su supervisor ahora. Intente de nuevo en unos minutos.',
  errorCaptcha:             'No pudimos verificar el control de seguridad. Recargue la página e intente de nuevo.',
  errorGeneric:             'Algo salió mal al enviar su reporte. Por favor intente de nuevo.',
  privacyFooter:            'Su reporte se envía al equipo de seguridad sin su nombre. Para agregar algo después, envíe un nuevo reporte e incluya su número de reporte.',
  statusLookupCta:          'Verificar estado de un reporte existente',
}

const CATALOGS: Record<Locale, Catalog> = { en, es }

export function t(locale: Locale): Catalog {
  return CATALOGS[locale] ?? CATALOGS.en
}
