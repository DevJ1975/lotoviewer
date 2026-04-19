// Shared text used by both the on-screen placard view and the printed PDF.

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
  stepsHeader: {
    en: 'LOCKOUT APPLICATION PROCESS',
    es: 'PROCESO DE APLICACIÓN DE BLOQUEO',
  },
  steps: {
    en: [
      'Notify all affected employees.',
      'Shut down the equipment using normal stop procedures.',
      'Isolate all energy sources at the disconnect.',
      'Apply personal lockout/tagout devices.',
      'Release or block stored energy.',
      'Verify isolation — test for zero energy state.',
      'Remove devices only when work is complete.',
    ],
    es: [
      'Notifique a todos los empleados afectados.',
      'Apague el equipo usando los procedimientos normales.',
      'Aísle todas las fuentes de energía en el desconectador.',
      'Aplique los dispositivos personales de bloqueo/etiquetado.',
      'Libere o bloquee la energía almacenada.',
      'Verifique el aislamiento — pruebe el estado de energía cero.',
      'Retire los dispositivos solo cuando el trabajo esté completo.',
    ],
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
} as const
