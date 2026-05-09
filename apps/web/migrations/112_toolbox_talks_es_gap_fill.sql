-- Migration 112: fill the ES translation gap left by 111.
--
-- Migration 111 hand-translated 53 topic titles, but the 53 backfilled
-- talks happened to draw 29 more topic titles (the `limit 53 order by
-- id` window doesn't match the order I built the translation table
-- against). 58 of 106 backfilled rows ended up with NULL title_es +
-- body_markdown_es. This adds the missing 29 + applies the fallback
-- so 100 % of backfilled rows have Spanish content.
--
-- Idempotent — only writes to rows where title_es IS NULL.

begin;

with title_translations(en, es) as (
  values
    ('Abrasive Blasting Hazards',                          'Peligros del Chorreado Abrasivo'),
    ('Carbon Monoxide — The Silent Killer',                'Monóxido de Carbono: El Asesino Silencioso'),
    ('Concrete and Cement Burns',                          'Quemaduras de Concreto y Cemento'),
    ('Cryogenic Liquid Handling',                          'Manejo de Líquidos Criogénicos'),
    ('Demolition Pre-Job Survey',                          'Inspección Antes de Demoler'),
    ('Earthquake Drop, Cover, Hold On',                    'Terremoto: Tírate, Cúbrete, Agárrate'),
    ('Excavation Pre-Entry Checks',                        'Revisiones Antes de Entrar a una Excavación'),
    ('Food and Drink in the Work Area',                    'Comer y Beber en el Área de Trabajo'),
    ('Hexavalent Chromium in Welding',                     'Cromo Hexavalente en la Soldadura'),
    ('Hot Surface and Burn Prevention',                    'Superficies Calientes y Prevención de Quemaduras'),
    ('Housekeeping — The 5-Minute End-of-Shift',           'Limpieza: Los 5 Minutos al Final del Turno'),
    ('Hydrogen Sulfide Awareness',                         'Cuidado con el Sulfuro de Hidrógeno'),
    ('Job Hazard Analysis (JHA) — Reading One',            'Análisis de Peligros del Trabajo (JHA): Cómo Leer Uno'),
    ('Lead Exposure Awareness',                            'Cuidado con la Exposición al Plomo'),
    ('Mold and Indoor Air Quality',                        'Moho y Calidad del Aire Interior'),
    ('Pinch Point and Crush Hazard Awareness',             'Puntos de Atrape y Aplastamiento'),
    ('PPE Hygiene and Storage',                            'Higiene y Guardado del Equipo de Protección'),
    ('Pre-Task Planning — The Take-5',                     'Planeación Antes de la Tarea: El Take-5'),
    ('Pre-Work Stretching and Warm-Up',                    'Estiramientos y Calentamiento Antes del Trabajo'),
    ('Pressure Washer Safety',                             'Seguridad con la Hidrolavadora'),
    ('Public and Visitor Safety on Site',                  'Seguridad del Público y Visitantes en el Sitio'),
    ('Restroom and Drinking Water Access',                 'Acceso al Baño y al Agua Potable'),
    ('Severe Weather and Lightning',                       'Clima Severo y Rayos'),
    ('Silica Dust Awareness',                              'Cuidado con el Polvo de Sílice'),
    ('Site Sign-In and Accountability',                    'Registro de Entrada al Sitio y Responsabilidad'),
    ('Subcontractor Coordination',                         'Coordinación con Subcontratistas'),
    ('Substance Abuse and the Job Site',                   'Abuso de Sustancias en el Trabajo'),
    ('Tool Tethering at Heights',                          'Amarrar Herramientas en Alturas'),
    ('Workplace Violence Prevention',                      'Prevención de Violencia en el Trabajo')
)
update public.toolbox_talks tt
set
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
    t.es,
    t.es,
    coalesce((select reference from public.toolbox_topics where id = tt.topic_id), 'OSHA Cláusula General § 5(a)(1)')
  ),
  title_es = t.es,
  key_points_es = array[
    'Lee el plan de trabajo o la hoja de datos antes de empezar',
    'Revisa herramientas, equipo, guardas y botones de paro',
    'Cuéntale a tu compañero tu plan',
    'Para el trabajo si algo se siente mal',
    'Firma la hoja al final de la plática'
  ],
  delivery_notes_es = 'Después de leer el título, pregúntale a tu equipo: "¿Qué podría salir mal en este trabajo hoy?" Espera dos o tres respuestas antes de continuar.'
from title_translations t
where tt.title = t.en
  and tt.title_es is null;

commit;
