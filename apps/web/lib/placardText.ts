// Shared text used by both the on-screen placard view and the printed PDF.
//
// The application + removal step wording matches the Snak King canonical
// LOTO procedure (April 2026). For other tenants who need different
// wording, the override path is loto_org_config.lockout_application_steps_*
// and lockout_removal_steps_* (jsonb arrays) — add when a customer asks.

export const PLACARD_TEXT = {
  title: {
    en: 'LOCKOUT/TAGOUT PROCEDURE',
    es: 'PROCEDIMIENTO DE BLOQUEO/ETIQUETADO',
  },
  equipmentLabel: {
    en: 'EQUIPMENT:',
    es: 'EQUIPO:',
  },
  warningHeader: {
    en: 'KEEP OUT! HAZARDOUS VOLTAGE AND MOVING PARTS',
    es: '¡MANTÉNGASE ALEJADO! VOLTAJE PELIGROSO Y PIEZAS EN MOVIMIENTO',
  },
  warningFallback: {
    en: 'This equipment must be locked out and tagged out before servicing or maintenance. Follow the procedure below to isolate all energy sources.',
    es: 'Este equipo debe bloquearse y etiquetarse antes de darle servicio o mantenimiento. Siga el procedimiento a continuación para aislar todas las fuentes de energía.',
  },
  purposeHeader: {
    en: 'PURPOSE',
    es: 'PROPÓSITO',
  },
  purposeBody: {
    en: 'This procedure establishes the minimum requirements for lockout of energy-isolating devices. It ensures equipment is stopped, isolated from all potentially hazardous energy sources, and locked out before any servicing or maintenance activities are performed.',
    es: 'Este procedimiento establece los requisitos mínimos para el bloqueo de los dispositivos de aislamiento de energía. Garantiza que el equipo se detenga, se aísle de todas las fuentes de energía potencialmente peligrosas y se bloquee antes de realizar actividades de servicio o mantenimiento.',
  },

  // ── Lockout APPLICATION process — verbatim Snak King wording ──────
  applicationHeader: {
    en: 'LOCKOUT APPLICATION PROCESS',
    es: 'PROCESO DE APLICACIÓN DE BLOQUEO',
  },
  applicationSteps: {
    en: [
      'Communicate to all AFFECTED employees',
      'Shut down the equipment using normal stopping procedures',
      'Isolate energy sources',
      'Apply lockout devices, locks, and tags',
      'Release all stored energy',
      'Verify equipment is de-energized by attempting to start up',
      'After test, place controls in a neutral position',
    ],
    es: [
      'Comunicar a todos los empleados AFECTADOS',
      'Apagar el equipo usando procedimientos normales de parada',
      'Aislar las fuentes de energía',
      'Aplicar dispositivos de bloqueo, candados y etiquetas',
      'Liberar toda la energía almacenada',
      'Verificar que el equipo esté desenergizado intentando arrancarlo',
      'Después de la prueba, colocar los controles en posición neutral',
    ],
  },

  // ── Lockout REMOVAL process — OSHA 1910.147(e) standard order ─────
  removalHeader: {
    en: 'LOCKOUT REMOVAL PROCESS',
    es: 'PROCESO DE REMOCIÓN DE BLOQUEO',
  },
  removalSteps: {
    en: [
      'Notify all AFFECTED employees that lockout is being removed',
      'Inspect the work area to ensure tools and items have been removed',
      'Verify that all employees are clear of the equipment',
      'Verify that controls are in the neutral or off position',
      'Remove lockout devices, locks, and tags',
      'Re-energize the equipment',
      'Notify all AFFECTED employees that the equipment is back in service',
    ],
    es: [
      'Notificar a todos los empleados AFECTADOS que se está retirando el bloqueo',
      'Inspeccionar el área de trabajo para asegurar que se hayan retirado herramientas y objetos',
      'Verificar que todos los empleados estén lejos del equipo',
      'Verificar que los controles estén en posición neutral o apagada',
      'Retirar los dispositivos de bloqueo, candados y etiquetas',
      'Volver a energizar el equipo',
      'Notificar a los empleados AFECTADOS que el equipo está de vuelta en servicio',
    ],
  },

  // ── Color Codes legend header ────────────────────────────────────
  colorCodesHeader: {
    en: 'COLOR CODES',
    es: 'CÓDIGOS DE COLOR',
  },

  sectionHeader: {
    en: 'EQUIPMENT IDENTIFICATION AND ENERGY ISOLATION PROCEDURE',
    es: 'IDENTIFICACIÓN DEL EQUIPO Y PROCEDIMIENTO DE AISLAMIENTO DE ENERGÍA',
  },
  photoCaptions: {
    en: { equipment: 'Photo of Equipment', isolation: 'Photo of Isolation / Disconnect' },
    es: { equipment: 'Foto del Equipo',     isolation: 'Foto de Aislamiento / Desconexión' },
  },
  tableHeaders: {
    en: ['Energy Tag & Description',    'Isolation Procedure & Lockout Devices',        'Method of Verification'] as const,
    es: ['Etiqueta y Descripción',       'Procedimiento de Aislamiento y Dispositivos',  'Método de Verificación'] as const,
  },
  signature: {
    en: ['Signature', 'Date', 'Dept', 'See PM Store in PT Folder'] as const,
    es: ['Firma',     'Fecha', 'Depto', 'Ver PM Store en carpeta PT'] as const,
  },
  noSteps: {
    en: 'No energy steps defined for this equipment.',
    es: 'No hay pasos de energía definidos para este equipo.',
  },

  // ── Footer note on page 1 of the bilingual PDF ───────────────────
  printNote: {
    en: 'Spanish translation on reverse — print double-sided.',
    es: 'Traducción al inglés al reverso — imprimir a doble cara.',
  },

  // ── Backward-compat aliases — kept so existing call-sites that
  //    import stepsHeader / steps keep compiling without forcing
  //    every site to update at once. New code should use
  //    applicationHeader / applicationSteps directly.
  stepsHeader: {
    en: 'LOCKOUT APPLICATION PROCESS',
    es: 'PROCESO DE APLICACIÓN DE BLOQUEO',
  },
  steps: {
    en: [
      'Communicate to all AFFECTED employees',
      'Shut down the equipment using normal stopping procedures',
      'Isolate energy sources',
      'Apply lockout devices, locks, and tags',
      'Release all stored energy',
      'Verify equipment is de-energized by attempting to start up',
      'After test, place controls in a neutral position',
    ],
    es: [
      'Comunicar a todos los empleados AFECTADOS',
      'Apagar el equipo usando procedimientos normales de parada',
      'Aislar las fuentes de energía',
      'Aplicar dispositivos de bloqueo, candados y etiquetas',
      'Liberar toda la energía almacenada',
      'Verificar que el equipo esté desenergizado intentando arrancarlo',
      'Después de la prueba, colocar los controles en posición neutral',
    ],
  },
} as const
