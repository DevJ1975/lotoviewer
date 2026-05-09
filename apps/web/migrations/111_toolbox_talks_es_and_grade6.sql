-- Migration 111: bilingual toolbox talks + 6th-grade English rewrite
--
-- Two changes for the on-floor reading experience:
--
--   1. Plain language. Migration 110's body template used phrases
--      like "stop-work authority" and "no retaliation" — clean
--      compliance language but reads at a 9th-10th grade level. The
--      operator's crews need 6th-grade. We rewrite the body for
--      every backfilled row (generated_by='manual', ai_model is
--      null) to short sentences and concrete words.
--
--   2. Spanish option. Adds title_es / body_markdown_es /
--      key_points_es / delivery_notes_es columns and populates them
--      for the 53×N backfilled rows so a tenant with a Spanish-
--      speaking crew can flip the toggle on the detail page.
--      Translation strategy:
--        - Title: per-topic, hand-translated (53 pairs in the CTE).
--        - Body: standard 6th-grade Spanish boilerplate that
--          opens with the topic title; per-topic English summaries
--          are not auto-translated (the next sentence in the
--          template restates the take-home in plain words anyway).
--        - Key points / delivery notes: same Spanish boilerplate
--          for every row.
--
-- Idempotent — only updates rows that look like the migration-110
-- backfill (generated_by='manual', ai_model is null). A real cron-
-- generated row (with ai_model set) is never touched.

begin;

-- Add new columns. NOT NULL with default '{}' for the array so the
-- API never has to coalesce.
alter table public.toolbox_talks
  add column if not exists title_es          text,
  add column if not exists body_markdown_es  text,
  add column if not exists key_points_es     text[] not null default '{}',
  add column if not exists delivery_notes_es text;

-- ── Title translations: 53 hand-mapped pairs ────────────────────
with title_translations(en, es) as (
  values
    ('Slips, Trips, and Falls Prevention',                 'Prevención de Resbalones, Tropiezos y Caídas'),
    ('Personal Protective Equipment Basics',               'Equipo de Protección Personal: Conceptos Básicos'),
    ('Hazard Communication and SDS Awareness',             'Comunicación de Peligros y Hojas de Datos (SDS)'),
    ('Lockout/Tagout — Why It Saves Lives',                'Bloqueo y Etiquetado: Por Qué Salva Vidas'),
    ('Machine Guarding Inspection',                        'Revisión de Protecciones de Máquinas'),
    ('Electrical Safety — Cords and Outlets',              'Seguridad Eléctrica: Cables y Tomacorrientes'),
    ('Fire Extinguisher Use — PASS Method',                'Uso del Extintor: Método PASS'),
    ('Emergency Action Plan Refresher',                    'Repaso del Plan de Emergencia'),
    ('First Aid and Bloodborne Pathogen Awareness',        'Primeros Auxilios y Patógenos en la Sangre'),
    ('Hand Tool Safety',                                   'Seguridad con Herramientas de Mano'),
    ('Power Tool Safety',                                  'Seguridad con Herramientas Eléctricas'),
    ('Ladder Safety — 4:1 Rule',                           'Seguridad con Escaleras: Regla 4 a 1'),
    ('Stairway and Walkway Hazards',                       'Peligros en Escaleras y Pasillos'),
    ('Manual Lifting and Back Safety',                     'Levantar Cargas y Cuidar la Espalda'),
    ('Ergonomics at the Workstation',                      'Ergonomía en la Estación de Trabajo'),
    ('Heat Illness Prevention',                            'Prevención de Enfermedades por Calor'),
    ('Cold Stress Awareness',                              'Cuidado con el Frío Extremo'),
    ('Hearing Conservation and Noise',                     'Cuidado del Oído y el Ruido'),
    ('Eye and Face Protection',                            'Protección de Ojos y Cara'),
    ('Respiratory Protection Basics',                      'Protección Respiratoria: Conceptos Básicos'),
    ('Foot Protection — Steel Toe vs. Composite',          'Protección de Pies: Acero o Compuesto'),
    ('Head Protection — Hard Hat Inspection',              'Protección de Cabeza: Revisar el Casco'),
    ('Hand Protection — Choosing the Right Glove',         'Protección de Manos: Elegir el Guante Correcto'),
    ('Working at Heights — Fall Protection Basics',        'Trabajo en Alturas: Protección contra Caídas'),
    ('Scaffolding Safety',                                 'Seguridad en Andamios'),
    ('Mobile Elevating Work Platforms',                    'Plataformas Elevadoras Móviles'),
    ('Forklift Pre-Operation Checklist',                   'Revisión del Montacargas Antes de Usar'),
    ('Pedestrian-Forklift Separation',                     'Separar Peatones y Montacargas'),
    ('Pallet Jack Safety',                                 'Seguridad con el Patín de Carga'),
    ('Confined Space Awareness — Recognize and Refuse',    'Espacios Confinados: Reconocer y Rechazar'),
    ('Hot Work Permit Basics',                             'Permiso de Trabajo en Caliente: Lo Básico'),
    ('Welding Fume Awareness',                             'Cuidado con los Humos de Soldadura'),
    ('Compressed Gas Cylinder Handling',                   'Manejo de Cilindros de Gas Comprimido'),
    ('Pressurized Systems Awareness',                      'Cuidado con Sistemas a Presión'),
    ('Chemical Spill Response',                            'Respuesta a Derrames Químicos'),
    ('Eyewash and Safety Shower Inspection',               'Revisión de Lavaojos y Duchas de Seguridad'),
    ('Universal Waste Handling',                           'Manejo de Residuos Universales'),
    ('Walking-Working Surface Inspection',                 'Revisión de Pisos y Áreas de Trabajo'),
    ('Storage and Stacking Safety',                        'Seguridad al Almacenar y Apilar'),
    ('Material Handling — Crane Awareness',                'Manejo de Materiales: Cuidado con Grúas'),
    ('Rigging and Sling Inspection',                       'Revisión de Eslingas y Aparejos'),
    ('Battery and UPS Safety',                             'Seguridad con Baterías y UPS'),
    ('Arc Flash Awareness',                                'Cuidado con el Arco Eléctrico'),
    ('Working Alone — Check-In Procedures',                'Trabajar Solo: Reglas para Reportarse'),
    ('Driving for Work — Distracted Driving',              'Manejar por el Trabajo: Distracciones al Volante'),
    ('Vehicle Pre-Trip Inspection',                        'Revisión del Vehículo Antes de Salir'),
    ('Backing Vehicles — Spotter Use',                     'Reversa de Vehículos: Usar un Guía'),
    ('Stop-Work Authority',                                'Autoridad para Parar el Trabajo'),
    ('Reporting Near Misses',                              'Reportar Casi Accidentes'),
    ('Incident Investigation Basics',                      'Investigación de Incidentes: Lo Básico'),
    ('OSHA Recordkeeping for Workers',                     'Registros de OSHA para Trabajadores'),
    ('Whistleblower Rights and Protections',               'Derechos del Denunciante'),
    ('Mental Health and Stigma in Construction Work',      'Salud Mental y el Estigma en el Trabajo')
)
update public.toolbox_talks tt
set
  -- 6th-grade English body. Short sentences, concrete words.
  body_markdown = format(
    e'## %s\n\n'
    '%s\n\n'
    '### Why this matters today\n\n'
    'Take two minutes before you start work. Think about how this danger could happen in your job today.\n\n'
    'The line above is the rule for everyone. But the details that keep YOU safe are in your task plan, the safety sheet (SDS), the label on the machine, or the steps your supervisor signed. Read them. Do not guess.\n\n'
    '### What we ask from each crew\n\n'
    '- Read the task plan or safety sheet before you start\n'
    '- Check your tools, gear, guards, and the emergency stop buttons\n'
    '- Tell your buddy what you will do. Make sure they can help if something goes wrong.\n'
    '- Anyone can stop work at any time. No one will get in trouble for it.\n'
    '- Sign the sheet below after the talk.\n\n'
    '### What to avoid\n\n'
    '- Skipping the plan because "we did this yesterday"\n'
    '- Going around a guard or a lock "just for a second"\n'
    '- Thinking a machine is off when no one checked\n\n'
    '### Reference\n\n'
    '%s\n\n'
    e'### Today''s promise\n\n'
    'We take the two minutes. We check. We sign. If something feels wrong, we stop and ask.',
    tt.title,
    -- Use the existing topic summary if we can derive it; for the
    -- backfilled rows, the topic summary is already the second
    -- paragraph of the prior body. Re-fetch from toolbox_topics so
    -- the rewrite is clean.
    (select summary from public.toolbox_topics where id = tt.topic_id),
    coalesce((select reference from public.toolbox_topics where id = tt.topic_id), 'OSHA General Duty Clause § 5(a)(1)')
  ),

  -- 6th-grade Spanish body. Topic-specific title; boilerplate the rest.
  body_markdown_es = format(
    e'## %s\n\n'
    '### Por qué importa hoy\n\n'
    'Hoy hablamos sobre **%s**.\n\n'
    'Toma dos minutos antes de empezar a trabajar. Piensa en cómo este peligro puede pasar en tu tarea hoy.\n\n'
    'La regla general es para todos. Pero los detalles que TE mantienen seguro están en tu plan de trabajo, en la hoja de datos (SDS), en la etiqueta de la máquina, o en los pasos que tu supervisor firmó. Léelos. No adivines.\n\n'
    '### Lo que pedimos a cada equipo\n\n'
    '- Lee el plan de trabajo o la hoja de datos antes de empezar\n'
    '- Revisa tus herramientas, equipo, guardas y botones de paro de emergencia\n'
    '- Avísale a tu compañero qué vas a hacer. Asegúrate de que pueda ayudarte si algo sale mal.\n'
    '- Cualquier persona puede parar el trabajo en cualquier momento. Nadie se mete en problemas por hacerlo.\n'
    '- Firma la hoja al final de la plática.\n\n'
    '### Qué evitar\n\n'
    '- Saltarte el plan porque "ayer hicimos lo mismo"\n'
    '- Pasar por encima de una guarda o un candado "solo por un segundo"\n'
    '- Pensar que una máquina está apagada sin verificarlo\n\n'
    '### Referencia\n\n'
    '%s\n\n'
    '### El compromiso de hoy\n\n'
    'Tomamos los dos minutos. Verificamos. Firmamos. Si algo se siente mal, paramos y preguntamos.',
    coalesce(t.es, tt.title),
    coalesce(t.es, tt.title),
    coalesce((select reference from public.toolbox_topics where id = tt.topic_id), 'OSHA Cláusula General § 5(a)(1)')
  ),

  title_es = coalesce(t.es, tt.title),

  key_points = array[
    'Read the task plan or safety sheet before you start',
    'Check tools, gear, guards, and emergency stops',
    'Tell your buddy your plan',
    'Stop work if something feels wrong',
    'Sign the sheet after the talk'
  ],

  key_points_es = array[
    'Lee el plan de trabajo o la hoja de datos antes de empezar',
    'Revisa herramientas, equipo, guardas y botones de paro',
    'Cuéntale a tu compañero tu plan',
    'Para el trabajo si algo se siente mal',
    'Firma la hoja al final de la plática'
  ],

  delivery_notes = 'After you read the title, ask your crew: "What could go wrong on this job today?" Wait for two or three answers before you go on.',

  delivery_notes_es = 'Después de leer el título, pregúntale a tu equipo: "¿Qué podría salir mal en este trabajo hoy?" Espera dos o tres respuestas antes de continuar.'

from title_translations t
where tt.title = t.en
  and tt.generated_by = 'manual'
  and tt.ai_model is null;

-- Even if a title doesn't match the translations CTE (a future
-- backfill might use topics 54-100), still set title_es to the EN
-- title so the page never shows blank when ES is selected. Same for
-- body_markdown_es using a generic Spanish opening.
update public.toolbox_talks tt
set
  title_es = tt.title,
  body_markdown_es = format(
    e'## %s\n\n'
    '### Por qué importa hoy\n\n'
    'Hoy hablamos sobre **%s**. (Traducción al español pendiente.)\n\n'
    'Toma dos minutos antes de empezar a trabajar. Piensa en cómo este peligro puede pasar en tu tarea hoy. Lee el plan de trabajo, la hoja de datos (SDS), o el procedimiento de tu supervisor. No adivines.\n\n'
    '### Lo que pedimos\n\n'
    '- Lee el plan o la hoja de datos antes de empezar\n'
    '- Revisa herramientas, equipo y guardas\n'
    '- Avísale a tu compañero\n'
    '- Para el trabajo si algo se siente mal\n'
    '- Firma la hoja al final de la plática',
    tt.title,
    tt.title
  ),
  key_points_es = array[
    'Lee el plan de trabajo o la hoja de datos antes de empezar',
    'Revisa herramientas, equipo, guardas y botones de paro',
    'Cuéntale a tu compañero tu plan',
    'Para el trabajo si algo se siente mal',
    'Firma la hoja al final de la plática'
  ],
  delivery_notes_es = 'Después de leer el título, pregúntale a tu equipo: "¿Qué podría salir mal en este trabajo hoy?" Espera dos o tres respuestas antes de continuar.'
where tt.generated_by = 'manual'
  and tt.ai_model is null
  and tt.title_es is null;

notify pgrst, 'reload schema';

commit;
