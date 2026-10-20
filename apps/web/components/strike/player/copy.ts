import { createContext, useContext } from 'react'
import type { StrikeInteractionHint } from '@soteria/core/strikeContent'

// Every word the STRIKE player shows, per language. Typed so a language that
// misses a string fails the build instead of showing English to a worker
// who chose Spanish. Course content (scenes, questions) is translated per
// module version; this is only the player's own chrome.

export const STRIKE_LOCALES = ['en', 'es'] as const
export type StrikeLocale = typeof STRIKE_LOCALES[number]

export const STRIKE_LOCALE_LABEL: Record<StrikeLocale, string> = { en: 'English', es: 'Español' }

export function isStrikeLocale(value: unknown): value is StrikeLocale {
  return typeof value === 'string' && (STRIKE_LOCALES as readonly string[]).includes(value)
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** [before, emphasized, after]: lets the player bold the module title inside a translated sentence. */
type Sentence = [string, string, string]

const en = {
  /** BCP 47 tag for captions tracks and lang attributes. */
  lang: 'en' as StrikeLocale,
  // Shell and hints
  check: 'Check',
  hint: 'Hint',
  anotherHint: 'Another hint',
  hintsLabel: 'Hints',
  hintN: (n: number) => `Hint ${n}:`,
  solved: 'Solved',
  review: (title: string) => `Review: ${title}`,
  relatedScene: 'the related scene',
  hintText: (hint: StrikeInteractionHint): string => {
    switch (hint.kind) {
      case 'authored': return hint.text
      case 'sort_ends': return `“${hint.first}” comes first and “${hint.last}” comes last.`
      case 'match_one': return `“${hint.prompt}” goes with “${hint.answer}”.`
      case 'hotspot_count': return hint.correctCount === 1
        ? `Only one point is correct: “${hint.example}”.`
        : `${hint.correctCount} points are correct. “${hint.example}” is one of them.`
      case 'scenario_not': return `You can rule out: “${hint.label}”`
    }
  },
  // Drag-sort
  sortLabel: 'Drag to order',
  sortInstructions: 'Drag a step by its handle, or use the arrows to move it up or down.',
  sortCorrect: 'Correct order. That sequence is what keeps you safe.',
  sortWrong: (n: number) => `${n} ${plural(n, 'step is', 'steps are')} out of place. The highlighted steps need to move.`,
  move: (label: string) => `Move ${label}`,
  moveUp: (label: string) => `Move ${label} up`,
  moveDown: (label: string) => `Move ${label} down`,
  // Drag-match
  matchLabel: 'Drag to match',
  matchInstructions: 'Tap an answer, then tap the row it belongs to. You can also drag it.',
  matchCorrect: 'All matched. Each energy source has the right way to isolate it.',
  matchWrong: (n: number) => `${n} ${plural(n, 'match is', 'matches are')} wrong. Fix the highlighted rows.`,
  answers: 'Answers',
  tapToPlace: (answer: string) => `Tap to place “${answer}”`,
  empty: 'Empty',
  slotEmpty: (prompt: string, armed: string | null) => `${prompt}: empty. ${armed ? `Press to place ${armed}.` : 'Select an answer first.'}`,
  clear: (prompt: string) => `Clear ${prompt}`,
  // Hotspot
  hotspotLabel: 'Find the hazard',
  hotspotInstructions: 'Tap the numbered markers on the photo, or tick them in the list below.',
  hotspotCorrect: 'Exactly right. Only a device that physically blocks energy is an isolation point.',
  hotspotDecoys: (n: number) => `${n} of your picks ${plural(n, 'is a control, not an isolation point', 'are controls, not isolation points')}.`,
  hotspotMissed: (n: number) => `You missed ${n} isolation ${plural(n, 'point', 'points')}.`,
  // Scenario
  scenarioLabel: 'What would you do?',
  theScenario: 'the scenario',
  // Scenes and progress
  sceneN: (n: number) => `Scene ${n}`,
  done: 'Done',
  transcript: 'Transcript',
  play: (title: string) => `Play ${title}`,
  pause: (title: string) => `Pause ${title}`,
  replay: 'Replay scene',
  showCaptions: 'Show captions',
  hideCaptions: 'Hide captions',
  sections: (done: number, total: number) => `${done} of ${total} sections`,
  videos: (done: number, total: number) => `${done} of ${total} videos`,
  toGo: (n: number) => `${n} to go`,
  readyForCheck: 'Ready for the knowledge check',
  readyForSignOff: 'Ready for supervisor sign-off',
  lockedBehindScene: (title: string) => `the scene “${title}”`,
  lockedBehindCallout: (title: string) => `“${title}”`,
  lockedBehindPractice: 'the practice check above',
  locked: (what: string) => `Locked. Finish ${what} to unlock this.`,
  calloutDanger: 'Danger',
  calloutWarning: 'Warning',
  calloutInfo: 'Note',
  // Knowledge check and results
  knowledgeCheck: (pass: number) => `Knowledge check · pass ${pass}%`,
  finishSections: (n: number) => `Finish every section above to unlock the knowledge check (${n} remaining).`,
  reviewedAck: 'I reviewed the instruction and understand the task expectations.',
  acknowledgeRequirement: 'I acknowledge this requirement.',
  submit: 'Submit',
  tryAgain: 'Try again',
  scoreShort: (score: number, pass: number) => `${score}%. You need ${pass}%. Review the notes above, then try again.`,
  reviewTopic: 'Review this topic and try again.',
  downloadVideo: 'Download video',
  loadingModule: 'Loading module',
  trainingComplete: 'Training complete',
  niceWork: (name: string | null) => (name ? `Nice work, ${name}.` : 'Nice work.'),
  passedWith: (title: string, score: number): Sentence => ['You passed ', title, ` with ${score}%. Your training record is updated.`],
  verifiedComplete: (title: string): Sentence => ['Your supervisor verified ', title, '. Your training record is updated.'],
  // Delivery mode
  deliveryQuestion: 'How will this worker take the training?',
  deliveryStandard: 'Standard',
  deliveryStandardHelp: 'Videos, practice checks and a knowledge check.',
  deliveryAssisted: 'Assisted (ADA)',
  deliveryAssistedHelp: 'Videos only. A supervisor checks understanding in person and signs.',
  // Supervisor sign-off
  signOffTitle: 'Supervisor sign-off',
  signOffLocked: (n: number) => `${n} ${plural(n, 'video', 'videos')} left. The supervisor signs after the last one.`,
  watchedAll: (name: string) => `${name} watched every video in full.`,
  signOffIntro: 'Sign in as the supervisor. This does not sign the worker out.',
  supervisorEmail: 'Supervisor email',
  supervisorPassword: 'Password',
  signInAsSupervisor: 'Sign in to verify',
  signedInAs: (email: string) => `Signed in as ${email}`,
  useDifferentSupervisor: 'Use a different supervisor',
  checklist: 'Checklist',
  readAloud: 'Read aloud:',
  questionsToAsk: 'Questions you can ask aloud',
  acknowledgment: 'Acknowledgment',
  signHere: 'Sign with your finger or mouse',
  clearSignature: 'Clear signature',
  signAndComplete: 'Sign and complete',
  tickEverything: 'Tick every item and sign to complete.',
  // Certificate
  downloadCertificate: 'Download certificate',
  emailCertificate: 'Email my certificate',
  emailLabel: 'Personal or work email',
  send: 'Send',
  sentTo: (email: string) => `Sent to ${email}. Check your inbox.`,
  // LOTO Coach
  askCoach: 'Ask LOTO Coach',
  coachTitle: 'LOTO Coach',
  coachAttemptOpen: 'Knowledge check open: I’ll explain, not answer',
  coachIdle: 'Ask anything about lockout/tagout',
  closeCoach: 'Close LOTO Coach',
  tryThese: 'Try one of these:',
  coachStarters: ["What's the difference between authorized and affected?", 'Can I use just a tag?', '¿Qué hago al cambio de turno?'],
  sources: 'Sources',
  askCoachLabel: 'Ask the LOTO Coach',
  coachPlaceholder: 'Ask about lockout/tagout…',
  coachFooter: 'Coach explains; your site procedure and supervisor decide.',
  // Language
  language: 'Language',
}

export type StrikeCopy = typeof en

const es: StrikeCopy = {
  lang: 'es',
  check: 'Revisar',
  hint: 'Pista',
  anotherHint: 'Otra pista',
  hintsLabel: 'Pistas',
  hintN: n => `Pista ${n}:`,
  solved: 'Resuelto',
  review: title => `Repase: ${title}`,
  relatedScene: 'la escena relacionada',
  hintText: hint => {
    switch (hint.kind) {
      case 'authored': return hint.text
      case 'sort_ends': return `“${hint.first}” va primero y “${hint.last}” va al final.`
      case 'match_one': return `“${hint.prompt}” va con “${hint.answer}”.`
      case 'hotspot_count': return hint.correctCount === 1
        ? `Solo un punto es correcto: “${hint.example}”.`
        : `Hay ${hint.correctCount} puntos correctos. “${hint.example}” es uno de ellos.`
      case 'scenario_not': return `Puede descartar: “${hint.label}”`
    }
  },
  sortLabel: 'Arrastre para ordenar',
  sortInstructions: 'Arrastre un paso por su agarradera, o use las flechas para subirlo o bajarlo.',
  sortCorrect: 'Orden correcto. Esa secuencia es la que lo mantiene seguro.',
  sortWrong: n => `${n} ${plural(n, 'paso está', 'pasos están')} fuera de lugar. Mueva los pasos marcados.`,
  move: label => `Mover ${label}`,
  moveUp: label => `Subir ${label}`,
  moveDown: label => `Bajar ${label}`,
  matchLabel: 'Arrastre para relacionar',
  matchInstructions: 'Toque una respuesta y luego toque la fila donde va. También puede arrastrarla.',
  matchCorrect: 'Todo relacionado. Cada fuente de energía tiene su forma correcta de aislarse.',
  matchWrong: n => `${n} ${plural(n, 'relación está mal', 'relaciones están mal')}. Corrija las filas marcadas.`,
  answers: 'Respuestas',
  tapToPlace: answer => `Toque para poner “${answer}”`,
  empty: 'Vacío',
  slotEmpty: (prompt, armed) => `${prompt}: vacío. ${armed ? `Presione para poner ${armed}.` : 'Primero elija una respuesta.'}`,
  clear: prompt => `Quitar ${prompt}`,
  hotspotLabel: 'Encuentre el peligro',
  hotspotInstructions: 'Toque los marcadores numerados en la foto, o márquelos en la lista de abajo.',
  hotspotCorrect: 'Exacto. Solo un dispositivo que bloquea físicamente la energía es un punto de aislamiento.',
  hotspotDecoys: n => `${n} de sus selecciones ${plural(n, 'es un control, no un punto de aislamiento', 'son controles, no puntos de aislamiento')}.`,
  hotspotMissed: n => `Le ${plural(n, 'faltó', 'faltaron')} ${n} ${plural(n, 'punto', 'puntos')} de aislamiento.`,
  scenarioLabel: '¿Qué haría usted?',
  theScenario: 'el escenario',
  sceneN: n => `Escena ${n}`,
  done: 'Listo',
  transcript: 'Transcripción',
  play: title => `Reproducir ${title}`,
  pause: title => `Pausar ${title}`,
  replay: 'Repetir escena',
  showCaptions: 'Mostrar subtítulos',
  hideCaptions: 'Ocultar subtítulos',
  sections: (done, total) => `${done} de ${total} secciones`,
  videos: (done, total) => `${done} de ${total} videos`,
  toGo: n => `Faltan ${n}`,
  readyForCheck: 'Listo para la evaluación',
  readyForSignOff: 'Listo para la firma del supervisor',
  lockedBehindScene: title => `la escena “${title}”`,
  lockedBehindCallout: title => `“${title}”`,
  lockedBehindPractice: 'la práctica de arriba',
  locked: what => `Bloqueado. Termine ${what} para desbloquear esto.`,
  calloutDanger: 'Peligro',
  calloutWarning: 'Advertencia',
  calloutInfo: 'Nota',
  knowledgeCheck: pass => `Evaluación · aprobar con ${pass}%`,
  finishSections: n => `Termine todas las secciones de arriba para abrir la evaluación (faltan ${n}).`,
  reviewedAck: 'Revisé la instrucción y entiendo lo que se espera de la tarea.',
  acknowledgeRequirement: 'Reconozco este requisito.',
  submit: 'Enviar',
  tryAgain: 'Intentar de nuevo',
  scoreShort: (score, pass) => `${score}%. Necesita ${pass}%. Repase las notas de arriba e intente de nuevo.`,
  reviewTopic: 'Repase este tema e intente de nuevo.',
  downloadVideo: 'Descargar video',
  loadingModule: 'Cargando el módulo',
  trainingComplete: 'Capacitación completa',
  niceWork: name => (name ? `¡Buen trabajo, ${name}!` : '¡Buen trabajo!'),
  passedWith: (title, score) => ['Aprobó ', title, ` con ${score}%. Su registro de capacitación está actualizado.`],
  verifiedComplete: title => ['Su supervisor verificó ', title, '. Su registro de capacitación está actualizado.'],
  deliveryQuestion: '¿Cómo tomará este trabajador la capacitación?',
  deliveryStandard: 'Estándar',
  deliveryStandardHelp: 'Videos, prácticas y una evaluación.',
  deliveryAssisted: 'Asistida (ADA)',
  deliveryAssistedHelp: 'Solo videos. Un supervisor verifica en persona que entendió y firma.',
  signOffTitle: 'Firma del supervisor',
  signOffLocked: n => `${plural(n, 'Falta', 'Faltan')} ${n} ${plural(n, 'video', 'videos')}. El supervisor firma después del último.`,
  watchedAll: name => `${name} vio todos los videos completos.`,
  signOffIntro: 'Inicie sesión como supervisor. Esto no cierra la sesión del trabajador.',
  supervisorEmail: 'Correo del supervisor',
  supervisorPassword: 'Contraseña',
  signInAsSupervisor: 'Iniciar sesión para verificar',
  signedInAs: email => `Sesión iniciada como ${email}`,
  useDifferentSupervisor: 'Usar otro supervisor',
  checklist: 'Lista de verificación',
  readAloud: 'Lea en voz alta:',
  questionsToAsk: 'Preguntas que puede hacer en voz alta',
  acknowledgment: 'Declaración',
  signHere: 'Firme con el dedo o el mouse',
  clearSignature: 'Borrar firma',
  signAndComplete: 'Firmar y completar',
  tickEverything: 'Marque cada punto y firme para completar.',
  downloadCertificate: 'Descargar certificado',
  emailCertificate: 'Enviar mi certificado por correo',
  emailLabel: 'Correo personal o del trabajo',
  send: 'Enviar',
  sentTo: email => `Enviado a ${email}. Revise su bandeja de entrada.`,
  askCoach: 'Pregunte al Coach LOTO',
  coachTitle: 'Coach LOTO',
  coachAttemptOpen: 'Evaluación abierta: le explico, no le doy la respuesta',
  coachIdle: 'Pregunte lo que quiera sobre bloqueo y etiquetado',
  closeCoach: 'Cerrar el Coach LOTO',
  tryThese: 'Pruebe una de estas:',
  coachStarters: ['¿Cuál es la diferencia entre un empleado autorizado y uno afectado?', '¿Puedo usar solo una etiqueta?', '¿Qué hago al cambio de turno?'],
  sources: 'Fuentes',
  askCoachLabel: 'Pregunte al Coach LOTO',
  coachPlaceholder: 'Pregunte sobre bloqueo y etiquetado…',
  coachFooter: 'El coach explica; el procedimiento de su planta y su supervisor deciden.',
  language: 'Idioma',
}

export const STRIKE_COPY: Record<StrikeLocale, StrikeCopy> = { en, es }

const StrikeCopyContext = createContext<StrikeCopy>(en)
export const StrikeCopyProvider = StrikeCopyContext.Provider

export function useStrikeCopy(): StrikeCopy {
  return useContext(StrikeCopyContext)
}
