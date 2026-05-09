-- Migration 113: rewrite toolbox-talk bodies for engagement.
--
-- Previous template (migration 111) was a 250-word checklist with
-- regulation citations. The operator wants 5-7 minutes of read time
-- (~700-1000 words at conversational pace), interactive prompts so
-- the speaker engages the crew rather than reading off, no policy
-- numbers, and content that's relevant + interesting per topic.
--
-- Strategy:
--   1. Hand-author a short scenario hook + a closing question for
--      every one of the 53 topics in the manual backfill (both EN
--      and ES). These are the topic-specific bits.
--   2. Wrap each row in a shared interactive template that bakes in
--      4 crew-engagement moments ("pause and ask", "look around now",
--      a what-if, and the closing ask). The template adapts to the
--      topic via the title + topic.summary already on the row.
--   3. No regulation cites. Plain words for technical terms (SDS →
--      "the chemical safety sheet", JHA → "the task plan").
--   4. Idempotent — only updates rows that look like the manual
--      backfill (generated_by='manual', ai_model is null).
--
-- The cron generator's prompt also needs to be updated to produce
-- this style going forward — that change ships in the same PR but
-- in the cron route file, not here.

begin;

with topic_content(title, hook_en, close_en, hook_es, close_es) as (
  values

    ('Slips, Trips, and Falls Prevention',
     e'Last winter at a packing plant much like ours, a forklift driver named Carlos walked back from break and stepped in a small puddle of hydraulic fluid that leaked from a hose ten minutes earlier. He hit the floor hard. Broken wrist in three places, two surgeries, six weeks off. The puddle was less than a coffee cup of fluid on a flat concrete floor. Carlos had walked that same path four thousand times. He never saw it coming.',
     'Who has new boots on today? Show your soles to the person next to you — what does the tread look like?',
     e'El invierno pasado en una planta como la nuestra, un operador de montacargas llamado Carlos regresaba del descanso y pisó un charco pequeño de aceite hidráulico que goteaba de una manguera. Se cayó duro. Muñeca rota en tres partes, dos cirugías, seis semanas sin trabajar. El charco era menos de una taza de café en piso plano. Carlos había caminado ese mismo camino cuatro mil veces. Nunca lo vio venir.',
     '¿Quién trae botas nuevas hoy? Enséñale las suelas al compañero a tu lado — ¿cómo está el dibujo?'),

    ('Personal Protective Equipment Basics',
     e'A welder in Texas ten years into his career took his hood off "for just a second" to peek at a weld. The arc was already going on the next bay over. He didn''t see it directly — just the reflection off a polished steel sheet behind him. That night his eyes felt sandy. By morning he could not open them. Welder''s flash. Three days in a dark room with patches over both eyes. He kept his vision, but he never took his hood off again.',
     'What''s one piece of gear you''ve seen someone skip "for just a second" — and what could have happened?',
     e'Un soldador en Texas con diez años de experiencia se quitó la careta "solo por un segundo" para revisar una soldadura. El arco ya estaba prendido en la siguiente estación. No lo vio directo — solo el reflejo de una lámina de acero detrás de él. Esa noche le ardían los ojos. En la mañana no los podía abrir. Quemadura de soldador. Tres días en un cuarto oscuro con parches en los dos ojos. No perdió la vista, pero nunca más se quitó la careta.',
     '¿Qué pieza de equipo has visto que alguien se la quita "solo por un segundo" — y qué pudo pasar?'),

    ('Hazard Communication and SDS Awareness',
     e'A maintenance tech in Ohio mixed two cleaning chemicals in the same bucket because both bottles said "degreaser." One was a citrus-based detergent. The other was an alkaline industrial cleaner. The reaction released a chlorine-like gas that filled the room in under a minute. He was lucky — he made it out a side door, but two coworkers ended up in the ER. The information he needed was on a sheet pinned to the supply closet wall. Nobody had read it.',
     'Where is the chemical safety binder in our area? Point to it — out loud, right now.',
     e'Un técnico de mantenimiento en Ohio mezcló dos químicos de limpieza en la misma cubeta porque las dos botellas decían "desengrasante." Uno era a base de cítricos. El otro era un limpiador alcalino industrial. La reacción soltó un gas parecido al cloro que llenó el cuarto en menos de un minuto. Tuvo suerte — salió por la puerta lateral, pero dos compañeros terminaron en la sala de emergencias. La información que necesitaba estaba en una hoja pegada en la pared del armario. Nadie la había leído.',
     '¿Dónde está la carpeta de hojas de datos de químicos en nuestra área? Señálala — en voz alta, ahora mismo.'),

    ('Lockout/Tagout — Why It Saves Lives',
     e'A young electrician at a paper mill went in to clear a jam on a conveyor. He flipped the local stop button, climbed in, and started pulling jammed cardboard. What he didn''t know is that the local stop didn''t cut power — only the main lockout panel forty feet away did. A coworker on the next shift, not knowing anyone was inside, hit the start button. The conveyor moved one foot before the safety chain caught. One foot was enough. The electrician kept his arm but lost most of the use of it.',
     'Tell me one piece of equipment in our area where stored energy could surprise you. Air pressure, springs, electricity — anything that doesn''t go to zero when you flip the switch.',
     e'Un electricista joven en una fábrica de papel entró a quitar un atasco en una banda transportadora. Apretó el botón de paro local, se metió, y empezó a sacar cartón atorado. Lo que no sabía es que el paro local no cortaba la corriente — solo el panel principal a doce metros. Un compañero del siguiente turno, sin saber que había alguien adentro, le dio al botón de arranque. La banda se movió treinta centímetros antes de que la cadena de seguridad la frenara. Treinta centímetros fue suficiente. El electricista conservó el brazo pero perdió casi todo el uso.',
     'Dime un equipo en nuestra área donde la energía guardada te puede sorprender — aire a presión, resortes, electricidad, lo que sea que no llegue a cero cuando apagas el interruptor.'),

    ('Machine Guarding Inspection',
     e'A part-time maintenance worker pulled a guard off a band saw to do a quick blade change. The phone rang. He stepped away to answer it, came back, and a coworker had already walked up to use the saw. The coworker reached in for the wood, hit the unguarded blade, and lost two fingers in less than a second. The guard was sitting on a workbench five feet away. Forty-seven seconds is the average time someone takes to put a guard back on. Forty-seven seconds.',
     'Walk me to one machine in our area and tell me what its guard is supposed to do.',
     e'Un trabajador de medio tiempo de mantenimiento le quitó la guarda a una sierra de cinta para cambiar la hoja rápido. Sonó el teléfono. Se alejó a contestar, regresó, y un compañero ya estaba usando la sierra. El compañero metió la mano por la madera, tocó la hoja sin guarda, y perdió dos dedos en menos de un segundo. La guarda estaba en una mesa a metro y medio. Cuarenta y siete segundos es el promedio que tarda alguien en poner una guarda de regreso. Cuarenta y siete segundos.',
     'Llévame a una máquina en nuestra área y dime qué se supone que debe hacer su guarda.'),

    ('Electrical Safety — Cords and Outlets',
     e'A kitchen prep cook plugged a stand mixer into an extension cord that was already running a coffee urn and a panini press. The cord got hot enough to melt the outer jacket but not hot enough to trip the breaker. By the time anyone smelled smoke the wall behind the outlet was on fire. The whole back kitchen was rebuilt from scratch. Insurance covered the building. The shop was closed for four months. Three people lost their jobs because the small business couldn''t survive the gap.',
     'Look around — show me one cord that''s either frayed, has a missing ground prong, or is plugged into a power strip with too much else on it.',
     e'Un cocinero de prep enchufó una batidora a una extensión que ya tenía conectada una cafetera comercial y una plancha. La extensión se calentó tanto que se derritió el plástico, pero no lo suficiente para tirar el breaker. Para cuando alguien olió el humo, la pared atrás del enchufe ya estaba en llamas. La cocina entera se tuvo que reconstruir. El seguro cubrió el edificio. El negocio cerró cuatro meses. Tres personas perdieron su trabajo porque el lugar no aguantó el cierre.',
     'Mira a tu alrededor — enséñame un cable que esté pelado, sin tierra, o conectado a una regleta con demasiadas cosas.'),

    ('Fire Extinguisher Use — PASS Method',
     e'In a small machine shop the size of two parking spaces, a worker noticed flames coming from a metal trash can where someone had thrown a rag soaked in solvent. He grabbed the extinguisher off the wall — but he had never used one. He stood three feet away, pointed it at the top of the flames, and squeezed. The fire spread to a stack of cardboard before he figured out he should be aiming at the base. The whole shop was full of black smoke in two minutes. Everyone got out. Nobody knew where the second extinguisher was.',
     'How many extinguishers do we have in this area, and can you point to all of them right now without turning your head?',
     e'En un taller pequeño del tamaño de dos lugares de estacionamiento, un trabajador vio llamas saliendo de un bote de basura metálico donde alguien había tirado un trapo con solvente. Agarró el extintor de la pared — pero nunca lo había usado. Se paró a un metro, apuntó a la parte de arriba de las llamas, y apretó. El fuego se pasó a un montón de cartón antes de que se diera cuenta que tenía que apuntar a la base. El taller se llenó de humo negro en dos minutos. Todos salieron. Nadie sabía dónde estaba el segundo extintor.',
     '¿Cuántos extintores hay en esta área, y puedes señalarlos todos sin voltear la cabeza?'),

    ('Emergency Action Plan Refresher',
     e'A chemical plant did fire drills every quarter for ten years. Workers thought it was a waste of time — same drill, same route, same nobody hurt. Then a real fire happened on a Saturday morning during a partial-staff shift. Three workers who had practiced the drill made it out the right exit in 90 seconds. A contractor who had only been on site for two weeks took the wrong exit, ended up in a smoke-filled hallway, and had to be carried out by the fire department. He survived. The drills were why everybody else made it.',
     'Where is our muster point? Don''t look at the sign — point to the actual spot.',
     e'Una planta química hacía simulacros de incendio cada tres meses por diez años. Los trabajadores decían que era pérdida de tiempo — mismo simulacro, misma ruta, nadie se lastimaba. Después hubo un incendio real un sábado en la mañana con personal reducido. Tres trabajadores que habían practicado salieron por la puerta correcta en 90 segundos. Un contratista que llevaba solo dos semanas tomó la salida equivocada, terminó en un pasillo lleno de humo, y los bomberos lo tuvieron que cargar. Sobrevivió. Los simulacros fueron la razón por la que los demás salieron.',
     '¿Dónde está nuestro punto de reunión? Sin mirar el letrero — señala el lugar exacto.'),

    ('First Aid and Bloodborne Pathogen Awareness',
     e'A line worker cut his hand on a sheet metal edge — small cut, about an inch, bled steadily. A coworker without gloves stepped in to help apply pressure. The injured worker happened to be hepatitis C positive. The coworker didn''t know. Six weeks later the coworker tested positive too. Both of them got treatment, both are okay today, but it changed both their lives. None of this had to happen — there were gloves in the first aid kit twenty feet away.',
     'Where is the first aid kit in our area, and do you know what''s inside it?',
     e'Un trabajador de línea se cortó la mano en una orilla de lámina — corte chico, como dos centímetros, sangrando parejo. Un compañero sin guantes le ayudó a hacer presión. El trabajador lastimado tenía hepatitis C. El compañero no lo sabía. Seis semanas después, el compañero también dio positivo. Los dos recibieron tratamiento, los dos están bien hoy, pero les cambió la vida. Nada de esto tenía que pasar — había guantes en el botiquín a seis metros.',
     '¿Dónde está el botiquín en nuestra área, y sabes qué hay adentro?'),

    ('Hand Tool Safety',
     e'A machinist used the back of a wrench as a hammer to tap a stuck pin. He''d done it a hundred times. The hundred-and-first time, the wrench head fractured along an old crack he never noticed. A piece of steel the size of a quarter shot up and hit him just above his right eye. Two stitches and a permanent scar. If it had been a quarter inch lower he''d have lost the eye. He bought a real hammer the next morning.',
     'Show me one tool you use every day — and tell me what it''s actually designed to do.',
     e'Un operador usó la parte de atrás de una llave como martillo para soltar un pasador atorado. Lo había hecho cien veces. La vez ciento uno, la llave se quebró por una grieta vieja que nunca había notado. Un pedazo de acero del tamaño de una moneda salió volando y le pegó arriba del ojo derecho. Dos puntadas y una cicatriz permanente. Si hubiera sido un centímetro más abajo, pierde el ojo. Al día siguiente compró un martillo de verdad.',
     'Enséñame una herramienta que usas todos los días — y dime para qué está hecha en realidad.'),

    ('Power Tool Safety',
     e'A carpenter on a remodel job picked up a circular saw to cut a stair tread. The blade guard was tied open with a zip tie — a previous worker had done it because the guard "kept getting in the way." The saw kicked back when it hit a hidden nail. Without the guard, the spinning blade landed on his thigh. Eight inches deep, almost to the bone. Three hours of surgery and a year of physical therapy. The guard was on the saw for one reason. He cut it off.',
     'Look at the power tool nearest to you — is the guard intact and the trigger lockout working?',
     e'Un carpintero en una remodelación agarró una sierra circular para cortar un escalón. La guarda de la hoja estaba amarrada con un zip tie — un trabajador anterior lo había hecho porque "estorbaba." La sierra brincó al pegarle a un clavo escondido. Sin la guarda, la hoja giró y le cayó en el muslo. Veinte centímetros de profundidad, casi al hueso. Tres horas de cirugía y un año de terapia. La guarda estaba ahí por una razón. Él la cortó.',
     'Mira la herramienta eléctrica más cerca de ti — ¿la guarda está completa y el seguro del gatillo funciona?'),

    ('Ladder Safety — 4:1 Rule',
     e'A painter set an extension ladder against a wall to reach a soffit eight feet up. The base was too close to the wall — about a foot out instead of two. The ladder was on a smooth concrete surface. He climbed up, leaned out to reach a corner, and the base kicked out. He fell straight back, flat on the concrete, and the ladder came down on his face. Broken jaw, fractured cheekbone, three teeth gone. The ladder cost him $40,000 and a year of his life.',
     'For every four feet of ladder height, the base should be one foot out. Look at the closest ladder right now — is it set up right?',
     e'Un pintor puso una escalera de extensión contra una pared para alcanzar un alero a dos metros y medio. La base estaba muy cerca de la pared — como 30 centímetros en vez de 60. La escalera estaba en concreto liso. Subió, se estiró para llegar a una esquina, y la base se patinó. Se cayó de espaldas en el concreto, y la escalera le cayó en la cara. Mandíbula rota, pómulo fracturado, tres dientes perdidos. La escalera le costó 40 mil dólares y un año de su vida.',
     'Por cada metro y medio de altura, la base debe estar a 30 centímetros de la pared. Mira la escalera más cercana — ¿está bien puesta?'),

    ('Stairway and Walkway Hazards',
     e'A delivery driver carried a 30-pound box up a back staircase he''d climbed every Monday for two years. On a Tuesday in February the third step had a quarter-inch of ice on it from a leaky pipe somebody had been meaning to fix. He couldn''t see his feet because of the box. The fall was twelve feet, head first. He hit the landing and the box hit him. He survived. He doesn''t deliver anymore.',
     'Walk to a staircase or walkway in our area — what''s on it that shouldn''t be?',
     e'Un repartidor cargaba una caja de 14 kilos por una escalera trasera que subía cada lunes por dos años. Un martes en febrero, el tercer escalón tenía medio centímetro de hielo de una tubería que goteaba y nadie había arreglado. No podía ver sus pies por la caja. La caída fue de cuatro metros, de cabeza. Pegó en el descanso y la caja le cayó encima. Sobrevivió. Ya no reparte.',
     'Camina a una escalera o pasillo en nuestra área — ¿qué hay ahí que no debería estar?'),

    ('Manual Lifting and Back Safety',
     e'A 45-year-old worker who had been lifting boxes for 20 years bent down to pick up a 35-pound case from the floor. Same lift he''d done a thousand times. Something in his lower back gave out — not a slip, not a twist, just years of small wear adding up to one wrong moment. He felt a pop, hit the ground, couldn''t stand back up. Surgery. Six months out. Permanent restriction on anything over 20 pounds. Twenty years of bending wrong caught up with him in two seconds.',
     'When was the last time you actually used your knees instead of your back to pick something up?',
     e'Un trabajador de 45 años que llevaba 20 años cargando cajas se agachó a levantar una de 16 kilos del piso. El mismo movimiento que había hecho mil veces. Algo en su espalda baja cedió — no fue un resbalón, no fue una torcedura, fueron años de desgaste pequeño juntándose en un mal momento. Sintió un tronido, cayó al piso, no se pudo levantar. Cirugía. Seis meses sin trabajar. Restricción permanente para cargar más de 9 kilos. Veinte años de agacharse mal lo alcanzaron en dos segundos.',
     '¿Cuándo fue la última vez que usaste las rodillas en vez de la espalda para levantar algo?'),

    ('Ergonomics at the Workstation',
     e'An office worker spent ten years at a desk where the monitor was three inches too low. Every day, eight hours, looking down. By age 35 she had constant neck pain. By age 40 the doctor showed her an MRI of her cervical spine — the discs at C5 and C6 were already worn smooth. She got a monitor riser for $30 the next week. The damage was permanent, but she stopped making it worse.',
     'Look at your buddy''s posture right now — what would you change?',
     e'Una trabajadora de oficina pasó diez años en un escritorio con el monitor cinco centímetros muy bajo. Todos los días, ocho horas, mirando hacia abajo. A los 35 años tenía dolor de cuello constante. A los 40, el doctor le enseñó una resonancia de la columna cervical — los discos C5 y C6 ya estaban desgastados. Compró un alza de monitor de 30 dólares la siguiente semana. El daño quedó permanente, pero dejó de empeorarlo.',
     'Mira la postura de tu compañero ahora mismo — ¿qué le cambiarías?'),

    ('Heat Illness Prevention',
     e'A roofer in Phoenix worked through a 108-degree afternoon. He stopped sweating around 2 PM but kept working — he thought it meant he had finished sweating. By 3 PM his coworkers found him sitting on the ridge confused about which house he was on. By the time the ambulance got there his core temperature was 106. Heat stroke. Two days in the ICU. He got better. The next year, his crew started taking 15-minute shade breaks every hour. Nobody else has gone down since.',
     'How much water have you had since you woke up this morning? Be honest.',
     e'Un techador en Phoenix trabajó toda una tarde a 42 grados centígrados. Dejó de sudar como a las 2 de la tarde pero siguió trabajando — pensó que ya había terminado de sudar. A las 3 lo encontraron sus compañeros sentado en el techo, confundido de qué casa era. Cuando llegó la ambulancia, su temperatura era de 41 grados. Golpe de calor. Dos días en cuidados intensivos. Se recuperó. Al siguiente año, su cuadrilla empezó a tomar descansos de 15 minutos a la sombra cada hora. Nadie más se ha desmayado.',
     '¿Cuánta agua has tomado desde que te levantaste hoy? La verdad.'),

    ('Cold Stress Awareness',
     e'A maintenance worker on a fish processing dock in Alaska ignored the numbness in his fingers for two hours. It was cold, he had work to do, his gloves were "fine." When he finally went inside to warm up, his fingers wouldn''t bend. He couldn''t feel pain — that''s the dangerous part. The doctor said another hour outside and he would have lost two fingertips. He kept all ten, but he learned cold doesn''t hurt the way other injuries hurt. It just takes pieces of you while you''re not looking.',
     'Touch your hands together right now — if your fingers feel cold inside, what are you going to do about it?',
     e'Un trabajador de mantenimiento en un muelle de pescados en Alaska ignoró el entumecimiento de sus dedos por dos horas. Hacía frío, tenía trabajo, sus guantes estaban "bien." Cuando por fin entró a calentarse, los dedos no doblaban. No sentía dolor — eso es lo peligroso. El doctor dijo que otra hora afuera y hubiera perdido dos puntas de dedos. Conservó los diez, pero aprendió que el frío no duele como otras lesiones. Solo te quita pedazos mientras no estás mirando.',
     'Junta tus manos ahora mismo — si tus dedos sienten frío adentro, ¿qué vas a hacer?'),

    ('Hearing Conservation and Noise',
     e'A guy who ran a punch press for 30 years never wore his ear plugs — said the noise didn''t bother him. At 55 he started saying "what?" a lot at family dinners. At 60 his grandkids stopped trying to talk to him because he never heard them right. The damage to your ears doesn''t hurt while it happens. You just lose a little every year until you''re 60 and the world goes quiet. Hearing aids cost $4,000. They don''t bring back the laughs you didn''t hear.',
     'Are your earplugs in your pocket right now, or are they back in your locker?',
     e'Un señor que operó una prensa por 30 años nunca usó tapones — decía que el ruido no le molestaba. A los 55 empezó a decir "¿mande?" en las cenas familiares. A los 60, sus nietos dejaron de hablarle porque nunca los escuchaba bien. El daño a los oídos no duele mientras pasa. Solo pierdes un poquito cada año hasta que llegas a los 60 y el mundo se apaga. Los aparatos auditivos cuestan 4 mil dólares. No te regresan las risas que no escuchaste.',
     '¿Tienes los tapones en tu bolsillo ahora mismo, o están en tu locker?'),

    ('Eye and Face Protection',
     e'A mechanic was using a wire wheel to clean a rusty bolt. He''d done it ten thousand times in his career. He had safety glasses on his head but not over his eyes — he was about to "just finish this one." A piece of wire bristle the size of a needle came off the wheel and went straight into his right eye. Eight months of treatment. He kept the eye, but he''ll wear glasses with a pinhole in the right lens for the rest of his life. The glasses on his head would have stopped it.',
     'Are your safety glasses on your face right now, or up on your head?',
     e'Un mecánico usaba un cepillo de alambre para limpiar un tornillo oxidado. Lo había hecho diez mil veces en su carrera. Tenía los lentes de seguridad en la cabeza pero no en los ojos — iba a "nada más terminar este." Un pelo del cepillo, del tamaño de una aguja, se zafó y se le clavó directo en el ojo derecho. Ocho meses de tratamiento. Conservó el ojo, pero usará lentes con un agujero en el cristal derecho el resto de su vida. Los lentes que tenía en la cabeza lo habrían parado.',
     '¿Traes los lentes de seguridad en la cara ahora mismo, o los tienes en la cabeza?'),

    ('Respiratory Protection Basics',
     e'A grinder operator used a paper dust mask for ten years on a job that had silica dust in the air. He felt fine the whole time. At 48 his doctor told him he had silicosis — scarring in his lungs that would never heal and would slowly get worse. He couldn''t walk up stairs without stopping. The right respirator would have cost his employer $40 a year. The paper mask did nothing. You can''t see the dust that gets you.',
     'When was your respirator last fit-tested — and do you know what fit-tested even means?',
     e'Un esmerilador usó una mascarilla de papel por diez años en un trabajo con polvo de sílice en el aire. Se sintió bien todo el tiempo. A los 48 años el doctor le dijo que tenía silicosis — cicatrices en los pulmones que nunca sanarían y se irían poniendo peor. No podía subir escaleras sin parar. El respirador correcto le hubiera costado al patrón 40 dólares al año. La mascarilla de papel no hacía nada. No puedes ver el polvo que te enferma.',
     '¿Cuándo te hicieron la última prueba de ajuste a tu respirador — y sabes qué significa eso?'),

    ('Foot Protection — Steel Toe vs. Composite',
     e'A warehouse worker was rolling a pallet jack over uneven concrete when one wheel hit a crack and the loaded pallet tipped sideways. About 600 pounds of product slid off and landed across his foot. He was wearing $30 sneakers. Three broken bones in his foot. Eight weeks in a boot. He could have bought work boots for $80 — the company even offered a $50 reimbursement. He''d been meaning to "get to that."',
     'Look at your boots right now — what would they survive if a 50-pound box fell on them?',
     e'Un trabajador de almacén movía un patín de carga sobre concreto irregular cuando una rueda pegó en una grieta y la tarima se ladeó. Como 270 kilos de producto se cayeron encima de su pie. Traía tenis de 30 dólares. Tres huesos rotos. Ocho semanas con bota ortopédica. Podía haber comprado botas de trabajo por 80 — la empresa hasta ofrecía 50 de reembolso. Decía que "ya iba a comprarlas."',
     'Mira tus botas — ¿qué resistirían si te cayera una caja de 25 kilos encima?'),

    ('Head Protection — Hard Hat Inspection',
     e'A construction worker had the same hard hat for eight years. It had a faded company logo and stickers from three job sites. He liked it — it was his. What he didn''t notice was a hairline crack along the top crown from a small impact two years earlier. A wrench fell from a scaffold above him — a wrench he never saw coming. The hat split along the crack and the wrench hit the side of his head. Concussion, four stitches, four days in the hospital. A new hat costs $20. The crack made his old one a piece of plastic.',
     'Take off your hard hat right now and run your fingers along the inside — what do you feel?',
     e'Un trabajador de construcción usó el mismo casco por ocho años. Tenía el logo de la empresa borroso y calcomanías de tres obras. Le gustaba — era suyo. Lo que no notó fue una grieta finita arriba, de un golpe pequeño dos años antes. Una llave se cayó de un andamio arriba de él — una llave que nunca vio venir. El casco se partió por la grieta y la llave le pegó en un lado de la cabeza. Conmoción cerebral, cuatro puntadas, cuatro días en el hospital. Un casco nuevo cuesta 20 dólares. La grieta convirtió el suyo en plástico nada más.',
     'Quítate el casco ahora mismo y pasa los dedos por adentro — ¿qué sientes?'),

    ('Hand Protection — Choosing the Right Glove',
     e'A meat plant worker wore a regular cotton glove to handle a knife — the gloves were what was in the bin. The knife slipped while he was deboning. The cotton did nothing. The cut went through three fingers down to the bone. The plant had cut-resistant gloves available, but they were "for the day shift." He was on nights. He bled out enough on the way to the hospital that they almost lost him. The right glove would have stopped the blade cold.',
     'What type of glove do you have on right now, and is it the right one for what you''re about to do?',
     e'Un trabajador de planta de carne usó un guante de algodón para manejar un cuchillo — eran los que había en la caja. El cuchillo se resbaló mientras deshuesaba. El algodón no hizo nada. El corte le pasó por tres dedos hasta el hueso. La planta tenía guantes anticortes, pero eran "para el turno del día." Él era de noche. Sangró tanto camino al hospital que casi lo pierden. El guante correcto habría detenido el cuchillo en seco.',
     '¿Qué guante traes puesto ahora, y es el correcto para lo que vas a hacer?'),

    ('Working at Heights — Fall Protection Basics',
     e'A roofer thought a 12-foot fall was "no big deal" and worked without a harness on a residential reroof. He slipped on a piece of tar paper and fell. He landed on his feet — both legs broken in three places each. The doctor said feet-first falls from twelve feet are some of the worst because the body has no time to absorb. He was in a wheelchair for six months. He''s in physical therapy three years later. He had a harness in his truck.',
     'Anyone working above shoulder height in the next two hours — what''s your tie-off plan?',
     e'Un techador pensó que una caída de cuatro metros "no era nada" y trabajó sin arnés en un re-techado residencial. Se resbaló en un pedazo de papel asfáltico y se cayó. Cayó parado — las dos piernas rotas en tres partes cada una. El doctor dijo que las caídas parado de cuatro metros son de las peores porque el cuerpo no tiene tiempo de absorber. Estuvo en silla de ruedas seis meses. Tres años después sigue en terapia. Traía un arnés en la troca.',
     'Quien vaya a trabajar arriba del hombro en las próximas dos horas — ¿cuál es tu plan de amarre?'),

    ('Scaffolding Safety',
     e'A scaffold was assembled in a hurry on a Friday afternoon to finish a job before the weekend. The crew skipped the cross-bracing on the bottom level — "just for the high-up part, we''ll cross-brace later." Saturday morning, two workers were on the third level and the whole structure swayed sideways and collapsed. Both fell about 18 feet. One broke his pelvis. The other was lucky and only broke an arm. The cross-bracing took ten minutes to install correctly. They saved the ten minutes.',
     'Look at any scaffold in our area right now — what''s missing or wrong?',
     e'Se armó un andamio rápido un viernes en la tarde para terminar un trabajo antes del fin de semana. La cuadrilla saltó las riostras en el nivel de abajo — "nada más para la parte de arriba, después las ponemos." El sábado en la mañana, dos trabajadores estaban en el tercer nivel y toda la estructura se ladeó y se cayó. Los dos cayeron como cinco metros y medio. Uno se quebró la pelvis. El otro tuvo suerte y solo se quebró un brazo. Las riostras tardaban diez minutos en ponerse bien. Se ahorraron los diez minutos.',
     'Mira cualquier andamio en nuestra área ahora mismo — ¿qué le falta o qué está mal?'),

    ('Mobile Elevating Work Platforms',
     e'A worker took a scissor lift up 25 feet to change a light bulb. He didn''t put on the harness — "I''m just up here for two minutes." The lift was on slightly uneven concrete. As he reached out for the bulb, the lift tipped just enough to throw him sideways. He went over the rail. Fell head first. The harness sitting on the deck of the lift was an arm''s length away.',
     'If you''re going up in a lift today, walk through the pre-use checks out loud right now.',
     e'Un trabajador subió en un elevador de tijera nueve metros para cambiar un foco. No se puso el arnés — "nada más voy a estar arriba dos minutos." El elevador estaba en concreto un poco disparejo. Al estirarse para alcanzar el foco, el elevador se inclinó lo suficiente para tirarlo de lado. Pasó por encima del riel. Cayó de cabeza. El arnés que estaba en la plataforma estaba a un brazo de distancia.',
     'Si vas a subir en un elevador hoy, di en voz alta las revisiones antes de usarlo, ahora mismo.'),

    ('Forklift Pre-Operation Checklist',
     e'A forklift operator skipped the morning check on a Thursday because his lift "was fine yesterday." A leak in the brake line had been growing slowly for a week. Halfway through his second pallet of the morning, he hit the brakes coming around a corner and nothing happened. The forklift rolled into a stack of palletized cans. A 40-pound case fell from twelve feet up and missed his head by two feet. The brake fluid puddle was already on the floor of the cab when he started his shift.',
     'Did you do your full pre-shift forklift check this morning? All of it?',
     e'Un operador de montacargas saltó la revisión del jueves en la mañana porque su unidad "estaba bien ayer." Una fuga en la línea de frenos había crecido despacio por una semana. A media mañana, en su segunda tarima, le pegó al freno en una curva y no pasó nada. El montacargas chocó contra una estiba de latas. Una caja de 18 kilos cayó de cuatro metros y le pasó a 60 centímetros de la cabeza. El charco de líquido de frenos ya estaba en el piso de la cabina cuando empezó su turno.',
     '¿Hiciste la revisión completa del montacargas hoy en la mañana? ¿Toda?'),

    ('Pedestrian-Forklift Separation',
     e'A new hire walked through the warehouse listening to music with both earbuds in. A forklift operator backed up — beeper working, mirrors working, lights working — and never saw the new guy in the blind spot directly behind the load. The forks crushed his foot. He survived, but he''s done in warehouse work. His mom told the local TV news he''d been on the job for two days.',
     'When was the last time you walked behind a moving forklift without making eye contact with the driver?',
     e'Un nuevo caminó por el almacén con audífonos en los dos oídos. Un operador de montacargas estaba retrocediendo — con la alarma funcionando, los espejos, las luces — y nunca vio al nuevo en el punto ciego directo atrás de la carga. Las uñas le aplastaron el pie. Sobrevivió, pero ya no puede trabajar en almacén. Su mamá le dijo a las noticias que llevaba dos días en el trabajo.',
     '¿Cuándo fue la última vez que caminaste atrás de un montacargas en movimiento sin hacer contacto visual con el operador?'),

    ('Pallet Jack Safety',
     e'A worker pushed a loaded pallet jack down a slight incline. He tried to stop it with his foot when it picked up speed. His foot got caught between the jack and a rack post. The jack didn''t stop. His foot was crushed. Pallet jacks are supposed to be pulled, not pushed, for exactly this reason — when you pull, you''re ahead of the load and you can let go. When you push, you''re behind it, and physics wins.',
     'Pulled or pushed — which way are you using the pallet jack today?',
     e'Un trabajador empujaba un patín de carga cargado por una bajada ligera. Intentó pararlo con el pie cuando agarró velocidad. El pie quedó atorado entre el patín y un poste de rack. El patín no se paró. Le aplastó el pie. Los patines se jalan, no se empujan, justo por esta razón — cuando jalas, estás adelante de la carga y puedes soltar. Cuando empujas, estás atrás, y la física gana.',
     '¿Jalado o empujado — cómo estás usando el patín hoy?'),

    ('Confined Space Awareness — Recognize and Refuse',
     e'A welder went into a small tank to do a quick repair — "ten minutes, in and out." Nobody tested the air. The tank had held a solvent two weeks ago and the residue was still releasing fumes. He was unconscious in 45 seconds. A coworker saw his legs go limp and tried to climb in to pull him out. The coworker was unconscious in another 30 seconds. They both got out — barely — because a third worker called 911 instead of climbing in himself. The first rule of confined space rescue: don''t become victim number two.',
     'When was the last time you went into a tank, vault, or pit without anyone testing the air first?',
     e'Un soldador entró a un tanque pequeño a hacer una reparación rápida — "diez minutos, entra y sale." Nadie midió el aire. El tanque había tenido un solvente dos semanas antes y el residuo seguía soltando vapores. Quedó inconsciente en 45 segundos. Un compañero vio que se le aflojaron las piernas e intentó meterse a sacarlo. El compañero quedó inconsciente en otros 30 segundos. Los dos salieron — apenas — porque un tercer trabajador llamó al 911 en vez de meterse él mismo. La primera regla de rescate en espacios confinados: no te conviertas en víctima número dos.',
     '¿Cuándo fue la última vez que entraste a un tanque, una bóveda o una fosa sin que alguien midiera el aire?'),

    ('Hot Work Permit Basics',
     e'A welder repaired a railing on a loading dock at 4 PM on a Friday. He finished, packed up, and went home. At 9 PM that night the building''s sprinkler system saved the warehouse — a stray spark from his welding had landed in a stack of wooden pallets stored 30 feet away. It smoldered for five hours before catching. The pallet stack and a forklift were a total loss. The hot work permit would have required a fire watch for 30 minutes after he stopped. Thirty minutes would have caught it.',
     'Anyone doing welding, grinding, or cutting today — who''s watching for sparks for 30 minutes after you finish?',
     e'Un soldador reparó un barandal en un muelle de carga un viernes a las 4 de la tarde. Terminó, recogió, y se fue a casa. A las 9 de la noche el sistema de rociadores salvó la bodega — una chispa suelta de su soldadura había caído en una estiba de tarimas de madera a nueve metros. Estuvo prendiéndose despacio por cinco horas antes de encenderse. La estiba y un montacargas se perdieron por completo. El permiso de trabajo en caliente hubiera pedido una vigilancia de chispas por 30 minutos después de que paró. Treinta minutos lo habrían atrapado.',
     'Quien vaya a soldar, esmerilar o cortar hoy — ¿quién va a vigilar las chispas por 30 minutos después de que termines?'),

    ('Welding Fume Awareness',
     e'A pipe welder spent his career in stainless steel without local exhaust. He felt fine. At 52 his doctor said the metal in his blood and his lungs was at levels they only see in heavy industrial exposure. By 55 he had a respiratory disease that limits how far he can walk. The fume he never saw, never smelled, never felt — it was building up the whole time. The fan that would have caught it cost less than his first month''s medical bills.',
     'Where''s the fume hood or local exhaust closest to where you''re welding today?',
     e'Un soldador de tubería pasó su carrera trabajando con acero inoxidable sin extracción local. Se sentía bien. A los 52 años, el doctor le dijo que el metal en su sangre y sus pulmones estaba en niveles que solo se ven en exposición industrial pesada. A los 55 tenía una enfermedad respiratoria que limita cuánto puede caminar. El humo que nunca vio, nunca olió, nunca sintió — se estaba acumulando todo el tiempo. El extractor que lo habría atrapado costaba menos que la primera factura médica.',
     '¿Dónde está la campana o el extractor local más cerca de donde estás soldando hoy?'),

    ('Compressed Gas Cylinder Handling',
     e'An acetylene cylinder fell over in a welding shop. The valve at the top hit the concrete and snapped clean off. The cylinder rocketed across the shop like a pipe bomb — through a steel roll-up door, across the parking lot, and into a chain link fence 200 feet away. Nobody was hit. If anyone had been in that path they would have been killed. Cylinders get strapped upright, with the valve cap on, for exactly this reason. The strap takes ten seconds.',
     'Where are the gas cylinders in our area, and are they all secured upright with caps on?',
     e'Un cilindro de acetileno se cayó en un taller de soldadura. La válvula de arriba pegó en el concreto y se quebró por completo. El cilindro salió disparado por el taller como una bomba de tubo — atravesó una puerta cortina de acero, cruzó el estacionamiento, y se clavó en una cerca de alambre 60 metros más allá. Nadie estaba en el camino. Si alguien hubiera estado, lo mataba. Los cilindros se amarran parados con la tapa puesta justo por esta razón. La correa tarda diez segundos.',
     '¿Dónde están los cilindros de gas en nuestra área, y están todos parados, amarrados, y con tapa?'),

    ('Pressurized Systems Awareness',
     e'A hydraulic line on a press blew out — the line was rated for 3,000 psi and the press was running at 2,800. Stress fracture, brittle line, doesn''t matter. A pinhole leak was forming for weeks. The day it failed, the operator had his hand a foot away. The fluid jet — invisible at that pressure — went through his glove and into his palm. Hydraulic injection injuries are surgical emergencies. He kept the hand. He no longer has full use of it. Always assume there''s residual pressure, even after the system is "off."',
     'On any pressurized system you work with — how do you bleed it down before you touch it?',
     e'Una línea hidráulica de una prensa reventó — estaba calificada para 3,000 psi y la prensa trabajaba a 2,800. Fractura por estrés, línea quebradiza, no importa. Una fuga del tamaño de un alfiler se estaba formando por semanas. El día que falló, el operador tenía la mano a 30 centímetros. El chorro de aceite — invisible a esa presión — pasó por el guante y se le clavó en la palma. Las lesiones por inyección hidráulica son emergencias quirúrgicas. Conservó la mano. Ya no tiene el uso completo. Siempre asume que hay presión residual, aunque el sistema esté "apagado."',
     'En cualquier sistema a presión que manejas — ¿cómo lo despresurizas antes de tocarlo?'),

    ('Chemical Spill Response',
     e'Someone knocked over a five-gallon bucket of cleaning concentrate in the breakroom. A coworker started wiping it up with paper towels. Within two minutes she had a chemical burn on her hands and the fumes were strong enough to drive her out of the room. The bucket''s label said to wear gloves and a respirator and ventilate the area. She''d walked past the label every day for a year. The right response was to leave the room, close the door, and call for help. Wiping it up looked easier.',
     'If you saw a chemical spill in the next ten minutes, what are the first three things you''d do — in order?',
     e'Alguien tiró una cubeta de cinco galones de concentrado de limpieza en el comedor. Una compañera empezó a limpiarlo con toallas de papel. En dos minutos tenía quemaduras químicas en las manos y los vapores eran tan fuertes que la sacaron del cuarto. La etiqueta de la cubeta decía que se usaran guantes y respirador y se ventilara el área. Llevaba un año caminando junto a esa etiqueta. La respuesta correcta era salir del cuarto, cerrar la puerta, y pedir ayuda. Limpiarlo se veía más fácil.',
     'Si vieras un derrame químico en los próximos diez minutos, ¿qué tres cosas harías primero — en orden?'),

    ('Eyewash and Safety Shower Inspection',
     e'A worker got a splash of caustic in his eye. He ran to the eyewash, pulled the lever — and got a weak trickle of brown water. The eyewash hadn''t been activated in over a year. The line was full of stale water and rust. He had to drive himself to the urgent care across the street, holding his eye open, while a coworker rinsed it with bottled water from the snack machine. He kept the eye, but barely. Eyewashes need a 15-minute flush of clean water within ten seconds of the hazard. Ours has not been tested in six months.',
     'Where''s the closest eyewash, and when was the last time anyone activated it?',
     e'Un trabajador recibió una salpicadura de cáustico en el ojo. Corrió al lavaojos, jaló la palanca — y salió un chorrito débil de agua café. El lavaojos no se había activado en más de un año. La línea estaba llena de agua estancada y óxido. Tuvo que manejar él mismo a urgencias del otro lado de la calle, sosteniéndose el ojo abierto, mientras un compañero le enjuagaba con agua de botella de la máquina expendedora. Conservó el ojo, apenas. Los lavaojos necesitan un enjuague de 15 minutos con agua limpia, a menos de diez segundos del peligro. El nuestro no se ha probado en seis meses.',
     '¿Dónde está el lavaojos más cercano, y cuándo fue la última vez que alguien lo activó?'),

    ('Universal Waste Handling',
     e'A maintenance worker tossed a handful of dead AA batteries from a tool kit into a regular trash can. Two days later that trash bag was sitting in a hot dumpster. One of the batteries shorted internally and started a fire. The dumpster, the loading dock, and a wood-frame storage building behind it all burned. Total loss was about $400,000. The recycle bin for batteries was 30 feet from where he threw them in the trash. Nobody had told him batteries don''t go in the regular waste.',
     'In our area — where do dead batteries, fluorescent bulbs, and aerosol cans go?',
     e'Un trabajador de mantenimiento tiró un puñado de baterías AA muertas de una caja de herramientas al bote de basura normal. Dos días después esa bolsa estaba en un contenedor caliente. Una batería se hizo corto adentro y empezó un fuego. El contenedor, el muelle de carga, y un cuarto de almacén de madera atrás se quemaron. La pérdida total fue como 400 mil dólares. El bote para reciclar baterías estaba a nueve metros de donde las tiró. Nadie le había dicho que las baterías no van a la basura normal.',
     'En nuestra área — ¿dónde van las baterías muertas, los focos fluorescentes y las latas de aerosol?'),

    ('Walking-Working Surface Inspection',
     e'A worker tripped on a corner of grating that had lifted about a quarter inch — barely visible, but enough to catch a boot toe. He fell, hit his head on the corner of a steel rack, and was unconscious for 30 seconds. He went to the ER for stitches and a CT scan. Concussion, six weeks of headaches. The grating had been lifted for eight months. Three different supervisors had walked past it. Everyone "meant to get to it."',
     'Look at the floor between you and your station right now — anything that''s loose, raised, or missing?',
     e'Un trabajador tropezó con la esquina de una rejilla que se había levantado como medio centímetro — casi invisible, pero suficiente para atorar la punta de la bota. Se cayó, se pegó en la cabeza con la esquina de un rack de acero, y quedó inconsciente 30 segundos. Fue a urgencias por puntadas y tomografía. Conmoción, seis semanas de dolor de cabeza. La rejilla llevaba ocho meses levantada. Tres supervisores diferentes habían pasado por ahí. Todos "iban a arreglarla."',
     'Mira el piso entre tú y tu estación — ¿hay algo suelto, levantado, o que falte?'),

    ('Storage and Stacking Safety',
     e'A pallet of bottled product was stacked four high in a back aisle. The bottom pallet was a different size — about three inches narrower than the ones above. For three weeks the stack stood there leaning slightly. On a Wednesday afternoon, the whole thing came down on a coworker walking past. He was pinned for ten minutes before they could free him. Broken collarbone, broken wrist, three cracked ribs. The fix was to use one pallet size or to limit stack height. Both took less than an hour to do right.',
     'Walk to the tallest stack in our area — does the bottom look stable?',
     e'Una tarima de producto en botella se apiló de cuatro pisos en un pasillo del fondo. La tarima de abajo era de un tamaño diferente — como ocho centímetros más angosta que las de arriba. Por tres semanas la pila estuvo ahí, ladeada apenas. Un miércoles en la tarde, se vino abajo encima de un compañero que pasaba. Estuvo atrapado diez minutos antes de liberarlo. Clavícula rota, muñeca rota, tres costillas. El arreglo era usar un tamaño de tarima o limitar la altura. Las dos cosas tomaban menos de una hora.',
     'Camina a la pila más alta en nuestra área — ¿se ve estable la base?'),

    ('Material Handling — Crane Awareness',
     e'A rigger walked under a load suspended from an overhead crane — "just for a second, to grab a tool." A cable that had been showing wear failed at that exact moment. About 1,200 pounds of steel dropped six feet. He survived because the load hit a workbench first and deflected sideways. He never walks under suspended loads anymore. He saw what would have happened.',
     'Anyone using or working near a crane today — where''s the swing radius you absolutely don''t walk through?',
     e'Un riggers caminó debajo de una carga colgada de una grúa puente — "nada más por un segundo, a agarrar una herramienta." Un cable que mostraba desgaste falló en ese momento exacto. Unos 540 kilos de acero cayeron casi dos metros. Sobrevivió porque la carga pegó primero en una mesa de trabajo y se desvió. Nunca más camina debajo de cargas colgadas. Vio lo que hubiera pasado.',
     'Quien vaya a usar o trabajar cerca de una grúa hoy — ¿cuál es el radio de giro por el que jamás caminas?'),

    ('Rigging and Sling Inspection',
     e'A nylon sling looked fine on the outside — clean, no obvious cuts. The inside, where the sling had been wrapped around a sharp edge two months earlier, had cut fibers down to about half its rated strength. On a routine lift it failed at 60% of the rated load. The 800-pound piece of equipment dropped onto the concrete and bounced into a doorway. Nobody was inside. The next day, the rigger threw out every sling and started inspecting them every shift.',
     'Pick up the nearest sling and look at every inch of it — would you bet your life on it?',
     e'Una eslinga de nylon se veía bien por fuera — limpia, sin cortes obvios. Por dentro, donde había envuelto una orilla filosa dos meses antes, las fibras estaban cortadas como a la mitad de su capacidad. En una izada de rutina falló al 60% de la carga calificada. El equipo de 360 kilos cayó al concreto y rebotó hacia un portón. Nadie estaba adentro. Al día siguiente el riggers tiró todas las eslingas y empezó a inspeccionarlas cada turno.',
     'Agarra la eslinga más cercana y revísala de un extremo al otro — ¿le confiarías tu vida?'),

    ('Battery and UPS Safety',
     e'A maintenance tech was checking the electrolyte in a forklift battery. He didn''t wear face protection — "it''s only a quick check." The battery had been overcharged the night before and was venting hydrogen gas. The metal probe of his hydrometer made a tiny spark when it touched the lead post. The hydrogen ignited and the top of the battery burst. Sulfuric acid sprayed across his face and chest. He was lucky — his eyes were closed by reflex. Skin grafts on his neck and chin. He still works in maintenance. He''s on the company face-shield committee now.',
     'When was the last time you checked anything inside a battery without face protection on?',
     e'Un técnico de mantenimiento revisaba el electrolito de una batería de montacargas. No traía protección facial — "es nada más una revisada rápida." La batería se había sobrecargado la noche anterior y estaba liberando hidrógeno. La punta metálica del hidrómetro hizo una chispa pequeñita al tocar la tapa de plomo. El hidrógeno se prendió y la parte de arriba de la batería reventó. Ácido sulfúrico le salpicó la cara y el pecho. Tuvo suerte — los ojos los tenía cerrados por reflejo. Injertos de piel en el cuello y la barbilla. Sigue en mantenimiento. Ahora está en el comité de caretas de la empresa.',
     '¿Cuándo fue la última vez que revisaste algo dentro de una batería sin careta?'),

    ('Arc Flash Awareness',
     e'An electrician opened a 480V panel to check a breaker. He wasn''t wearing arc-rated gear — he was just "looking, not touching." A tool he''d set on top of the panel slid off and dropped across two bus bars. The arc flash was 35,000 degrees Fahrenheit for about a quarter of a second — hotter than the surface of the sun. He survived. He spent four months in a burn unit. His face is rebuilt. The panel had a label warning about the flash hazard. He had walked past it for years.',
     'Anyone working in any electrical panel today — what arc-rated gear do you have on?',
     e'Un electricista abrió un panel de 480V para revisar un breaker. No traía equipo calificado para arco — "nada más estoy viendo, no tocando." Una herramienta que había puesto encima del panel se resbaló y cayó atravesada en dos barras. El arco eléctrico fue de 19,000 grados Celsius por un cuarto de segundo — más caliente que la superficie del sol. Sobrevivió. Pasó cuatro meses en una unidad de quemados. Le reconstruyeron la cara. El panel tenía una etiqueta avisando del peligro. Llevaba años pasando junto a ella.',
     'Quien vaya a trabajar en cualquier panel eléctrico hoy — ¿qué equipo de protección contra arco trae puesto?'),

    ('Working Alone — Check-In Procedures',
     e'A maintenance tech was working alone on a Saturday morning in a remote pump station. He fell off a ladder and broke his hip. His radio was on a workbench across the room. His phone was in his truck outside. Nobody knew he was at the site. He was found Monday morning by the next-shift worker — 36 hours after the fall, dehydrated, hypothermic, in shock. He survived. The check-in was a 30-second call every two hours. He had skipped it because it felt silly.',
     'If you''re working alone today, who knows you''re here, and when do you check in?',
     e'Un técnico de mantenimiento trabajaba solo un sábado en la mañana en una estación de bombeo remota. Se cayó de una escalera y se quebró la cadera. Su radio estaba en una mesa al otro lado del cuarto. Su teléfono en la troca afuera. Nadie sabía que estaba en el sitio. Lo encontró el del lunes por la mañana — 36 horas después de la caída, deshidratado, hipotérmico, en choque. Sobrevivió. La revisión era una llamada de 30 segundos cada dos horas. Se la saltaba porque se sentía tonto.',
     'Si vas a trabajar solo hoy — ¿quién sabe que estás aquí, y a qué hora te reportas?'),

    ('Driving for Work — Distracted Driving',
     e'A delivery driver looked down at his phone for two seconds at 35 mph to check the next address. In those two seconds he covered about 100 feet. A construction worker was crossing the street at that exact spot. The driver looked up at the moment of impact — too late. The worker died at the scene. The driver was a 23-year-old kid who had never been in any kind of trouble. He''ll carry it the rest of his life. The phone could have stayed face-down on the seat.',
     'When you''re driving for work today, where will your phone be?',
     e'Un repartidor bajó la mirada al teléfono dos segundos a 55 kilómetros por hora para revisar la siguiente dirección. En esos dos segundos cubrió unos 30 metros. Un trabajador de construcción estaba cruzando la calle en ese punto exacto. El conductor levantó la vista al momento del impacto — demasiado tarde. El trabajador murió en el lugar. El conductor era un muchacho de 23 años sin antecedentes. Lo va a cargar el resto de su vida. El teléfono pudo haberse quedado boca abajo en el asiento.',
     'Cuando manejes por trabajo hoy — ¿dónde va a estar tu teléfono?'),

    ('Vehicle Pre-Trip Inspection',
     e'A delivery driver started his route on a Monday morning. He''d been told to do a pre-trip every day. Mostly he did. That Monday he was running late so he skipped it. About six miles into his run, the right front tire blew out. The truck went into the median, rolled twice, and stopped on its roof. He survived because of the seatbelt. The tire had a sidewall bulge the size of a baseball — he would have seen it in the pre-trip and parked the truck.',
     'Did you do your full vehicle pre-trip this morning, or did you just glance at it?',
     e'Un repartidor empezó su ruta un lunes en la mañana. Le habían dicho que hiciera la revisión pre-viaje todos los días. Casi siempre lo hacía. Ese lunes iba retrasado y se la saltó. A diez kilómetros de la salida, la llanta delantera derecha se reventó. El camión se metió al camellón, dio dos vueltas, y quedó de cabeza. Sobrevivió por el cinturón. La llanta tenía un bulto del tamaño de una pelota de béisbol — lo habría visto en la revisión y habría dejado el camión.',
     '¿Hiciste la revisión completa del vehículo esta mañana, o nada más le diste un vistazo?'),

    ('Backing Vehicles — Spotter Use',
     e'A driver backing a flatbed truck into a dock relied on his mirrors. The mirrors didn''t show the new hire walking behind the truck looking at the load on the bed. The driver felt a small bump and thought he''d hit the dock. He pulled forward — the new hire was on the ground. He survived, broken pelvis, weeks in the hospital. Ninety percent of vehicle incidents on a job site happen in reverse. The fix is one person standing where the driver can see, with one job: watch behind. It takes 30 seconds.',
     'Anyone backing up a vehicle today — who''s your spotter?',
     e'Un chofer retrocediendo una troca de caja plana hacia un muelle se confió de los espejos. Los espejos no le mostraron al nuevo caminando atrás de la troca mirando la carga. El chofer sintió un golpecito y pensó que era el muelle. Avanzó — el nuevo estaba en el suelo. Sobrevivió, pelvis rota, semanas en el hospital. El 90% de los accidentes con vehículos en una obra pasan en reversa. El arreglo es una persona parada donde el chofer la vea, con una sola tarea: ver hacia atrás. Toma 30 segundos.',
     'Quien vaya a echarse en reversa hoy — ¿quién es tu guía?'),

    ('Stop-Work Authority',
     e'A young laborer on his second week noticed the harness on his crew lead was hooked to a piece of pipe instead of an actual anchor point. He didn''t say anything because he was new and the crew lead had 15 years on him. The crew lead fell when the pipe tore out of the wall. The pipe was never an anchor. Everyone on the crew knew it didn''t look right. The young laborer told the safety review board afterward: "I thought I''d sound stupid." He''s a foreman now. The very first thing he tells new hires is: stupid questions save lives.',
     'When was the last time you saw something that didn''t look right and didn''t say anything?',
     e'Un peón joven en su segunda semana notó que el arnés de su líder de cuadrilla estaba enganchado a un tubo en vez de un punto de anclaje real. No dijo nada porque era nuevo y el líder llevaba 15 años sobre él. El líder cayó cuando el tubo se zafó de la pared. El tubo nunca fue un anclaje. Toda la cuadrilla sabía que se veía raro. El peón joven le dijo al comité de seguridad después: "pensé que iba a sonar tonto." Hoy es supervisor. Lo primero que les dice a los nuevos es: las preguntas tontas salvan vidas.',
     '¿Cuándo fue la última vez que viste algo que no se veía bien y no dijiste nada?'),

    ('Reporting Near Misses',
     e'A worker dropped a 4-pound wrench from a catwalk 25 feet up. It hit the floor about a foot from a coworker. Nobody got hurt. The worker felt awful and didn''t want to make a big deal of it — he just put it on his belt and kept working. Nobody reported anything. Six months later, on the same catwalk, a different worker dropped a smaller tool. It hit a coworker on the head — minor injury, but a recordable. The investigation found that for every recordable injury, there are about 30 near misses. We had 30. We didn''t track any of them.',
     'In the last week, name one thing that almost went wrong but didn''t — anywhere on the site.',
     e'Un trabajador dejó caer una llave de 2 kilos desde una pasarela a 7 metros y medio. Pegó en el piso a 30 centímetros de un compañero. Nadie se lastimó. El trabajador se sintió mal y no quiso hacer un escándalo — la puso en el cinturón y siguió trabajando. Nadie reportó nada. Seis meses después, en la misma pasarela, otro trabajador dejó caer una herramienta más chica. Le pegó a un compañero en la cabeza — lesión menor, pero registrable. La investigación encontró que por cada lesión registrable, hay como 30 casi accidentes. Tuvimos 30. No registramos ninguno.',
     'En la última semana — di una cosa que casi sale mal pero no salió, en cualquier parte del sitio.'),

    ('Incident Investigation Basics',
     e'After a worker got his hand caught in a roller, the first response from the supervisor was "who didn''t follow the procedure?" Three months later the same injury happened to a different worker on the same machine. This time someone asked "why is the procedure failing?" The answer: the e-stop button was in a position the operator could not reach when their hand was in the roller. The procedure was fine. The button placement was wrong. Asking who is to blame stops the investigation. Asking why keeps it going.',
     'Next time something goes wrong here — who has the courage to ask "why?" instead of "who?"',
     e'Después de que un trabajador se atoró la mano en un rodillo, la primera reacción del supervisor fue "¿quién no siguió el procedimiento?" Tres meses después, la misma lesión le pasó a otro trabajador en la misma máquina. Esta vez alguien preguntó "¿por qué está fallando el procedimiento?" La respuesta: el botón de paro de emergencia estaba en una posición a la que el operador no podía llegar cuando tenía la mano en el rodillo. El procedimiento estaba bien. La posición del botón estaba mal. Preguntar quién tiene la culpa para la investigación. Preguntar por qué la mantiene.',
     'La próxima vez que algo salga mal aquí — ¿quién tiene el valor de preguntar "por qué" en vez de "quién"?'),

    ('Whistleblower Rights and Protections',
     e'A pipefitter at a refinery noticed a pressure relief valve had been bypassed with a piece of pipe. He told his supervisor. The supervisor said "we''ll get to it." A week later he told a manager. The manager said "stop making waves." A month later he called the safety hotline. Two days later the bypass was removed. Six months later he was passed over for a promotion. He filed a complaint, the company was found to have retaliated, and he was promoted plus given back pay. The bypass would have caused a fire that would have killed people.',
     'Have you ever stayed quiet about something dangerous because you were worried about getting in trouble?',
     e'Un fontanero en una refinería notó que una válvula de alivio de presión estaba puenteada con un tramo de tubo. Le dijo a su supervisor. El supervisor dijo "ahorita lo arreglamos." Una semana después se lo dijo al gerente. El gerente le dijo "no hagas olas." Un mes después llamó a la línea de seguridad. Dos días después quitaron el puente. Seis meses después no le dieron un ascenso. Puso una queja, encontraron que la empresa tomó represalias, y le dieron el ascenso más los salarios atrasados. El puente habría causado un incendio que habría matado gente.',
     '¿Alguna vez te has quedado callado sobre algo peligroso porque te preocupaba meterte en problemas?'),

    ('Mental Health and Stigma in Construction Work',
     e'A welder on a remote pipeline crew took his own life on a Sunday in March. His coworkers had noticed he''d been quieter than usual for weeks. Nobody asked. They thought asking would make it worse, or would be intrusive, or that he''d "be embarrassed." His brother said later he had been begging — silently — for someone to notice. The suicide rate in trades work is about four times the national average. The fix isn''t a poster on the wall. The fix is asking someone how they''re really doing.',
     'Look around right now — is there anyone on this crew you haven''t actually talked to in a while?',
     e'Un soldador en una cuadrilla de ducto remoto se quitó la vida un domingo en marzo. Sus compañeros habían notado que estaba más callado de lo normal por semanas. Nadie le preguntó. Pensaron que preguntar lo haría peor, o que sería entrometido, o que él "se iba a apenar." Su hermano dijo después que había estado pidiendo — en silencio — que alguien lo notara. La tasa de suicidio en oficios es como cuatro veces el promedio nacional. El arreglo no es un cartel en la pared. El arreglo es preguntarle a alguien cómo está de verdad.',
     'Mira alrededor ahora mismo — ¿hay alguien en esta cuadrilla con quien no has hablado en serio en un rato?'),

    ('Abrasive Blasting Hazards',
     e'A blaster was using silica sand to clean a steel beam in a job that should have used a non-silica abrasive. He wore the cheap dust mask in the box. After ten years of jobs like that one, he developed silicosis — permanent scarring in his lungs. There''s no cure. He still has it. Today he carries an oxygen tank. The right blast media and the right respirator together cost about $200 more per job. His medical bills are over $300,000 and counting.',
     'When you''re blasting today — what media are you using and what respirator goes with it?',
     e'Un sandblaster usaba arena de sílice para limpiar una viga de acero en un trabajo que debió usar un abrasivo sin sílice. Usaba la mascarilla barata de la caja. Después de diez años de trabajos así, desarrolló silicosis — cicatrices permanentes en los pulmones. No hay cura. Sigue con ella. Hoy carga un tanque de oxígeno. El abrasivo correcto y el respirador correcto juntos cuestan como 200 dólares más por trabajo. Sus cuentas médicas pasan los 300 mil dólares.',
     'Cuando vas a sandblastear hoy — ¿qué material estás usando y qué respirador va con él?'),

    ('Carbon Monoxide — The Silent Killer',
     e'A maintenance tech ran a propane forklift inside a warehouse on a cold morning to "warm up" the cab. He felt a headache, brushed it off, kept working. An hour later a coworker found him slumped over the steering wheel. He was rushed to the hospital — carbon monoxide poisoning. He survived. Two more workers in the same warehouse had headaches that morning. They were all breathing CO from the forklift exhaust. The fix was a battery-powered forklift or open dock doors. The propane forklift killed two workers in another plant the same week.',
     'In the last hour — has anyone here had a headache that came out of nowhere?',
     e'Un técnico de mantenimiento prendió un montacargas de propano dentro de una bodega una mañana fría para "calentar" la cabina. Le dio dolor de cabeza, lo ignoró, siguió trabajando. Una hora después un compañero lo encontró desmayado en el volante. Lo llevaron al hospital — envenenamiento por monóxido de carbono. Sobrevivió. Otros dos trabajadores en la misma bodega tuvieron dolor de cabeza esa mañana. Todos respiraban CO del escape del montacargas. El arreglo era un montacargas eléctrico o abrir las puertas. El de propano mató a dos trabajadores en otra planta esa misma semana.',
     'En la última hora — ¿alguien aquí ha tenido un dolor de cabeza que salió de la nada?'),

    ('Concrete and Cement Burns',
     e'A laborer mixing concrete had a leak in his rubber boot. Wet concrete soaked his sock for about three hours before he noticed it. By the time he took the boot off, the skin on his heel was already chemically burned. He ended up needing a skin graft. Wet concrete is caustic — it eats through skin slowly, painlessly, while you''re working. It doesn''t feel hot. It doesn''t feel like a burn. By the time you feel it, the damage is done.',
     'Anyone working with concrete or grout today — are your boots intact and your gloves the right kind?',
     e'Un peón mezclando concreto tenía una fuga en su bota de hule. Concreto fresco le mojó el calcetín como tres horas antes de que se diera cuenta. Cuando se quitó la bota, la piel del talón ya tenía quemadura química. Acabó necesitando un injerto de piel. El concreto fresco es cáustico — se come la piel despacio, sin dolor, mientras trabajas. No se siente caliente. No se siente como quemadura. Cuando lo sientes, el daño ya está.',
     'Quien vaya a trabajar con concreto o lechada hoy — ¿están enteras tus botas y son los guantes correctos?'),

    ('Cryogenic Liquid Handling',
     e'A lab tech was filling a small dewar with liquid nitrogen. He wore regular work gloves — not cryo gloves. A small splash hit the back of his right glove. Liquid nitrogen at minus 320 degrees soaks through fabric in less than a second. The skin underneath the splash was instantly frozen. By the time he took the glove off, the skin came off with it. Three weeks of bandages and a permanent scar the size of a quarter. Cryo gloves cost $40. They were in the supply closet.',
     'If you''re handling liquid nitrogen, dry ice, or any super-cold material today — what gloves are you wearing?',
     e'Un técnico de laboratorio llenaba un dewar pequeño con nitrógeno líquido. Usaba guantes de trabajo normales — no guantes criogénicos. Una salpicadura le pegó en la parte de atrás del guante derecho. El nitrógeno líquido a 196 grados bajo cero atraviesa la tela en menos de un segundo. La piel debajo de la salpicadura quedó congelada al instante. Cuando se quitó el guante, la piel se vino con él. Tres semanas de vendajes y una cicatriz permanente del tamaño de una moneda. Los guantes criogénicos cuestan 40 dólares. Estaban en la bodega.',
     'Si vas a manejar nitrógeno líquido, hielo seco, o cualquier material súper frío hoy — ¿qué guantes traes?'),

    ('Demolition Pre-Job Survey',
     e'A demolition crew started knocking down a 1950s warehouse without checking what was in the walls. Three hours into the job they cut into a sealed pipe — old, rusty, nothing on the outside to suggest what was inside. The pipe still had natural gas in it from a service that had been "abandoned" decades earlier. The spark from the cut went up in a flash. Two workers were burned. The whole site was evacuated. Pre-job survey takes a day. The hospital stay was three weeks.',
     'Before any demo work — do we know what''s in the walls and the floor?',
     e'Una cuadrilla de demolición empezó a tirar una bodega de los años 50 sin revisar qué había en las paredes. Tres horas adentro del trabajo cortaron un tubo sellado — viejo, oxidado, nada por fuera que dijera qué tenía. El tubo todavía tenía gas natural de un servicio "abandonado" décadas antes. La chispa del corte se prendió en un destello. Dos trabajadores quemados. Evacuaron todo el sitio. La inspección previa toma un día. La hospitalización fue de tres semanas.',
     'Antes de cualquier trabajo de demolición — ¿sabemos qué hay en las paredes y el piso?'),

    ('Earthquake Drop, Cover, Hold On',
     e'In a 6.0 quake near a packing plant, the workers who survived without injury were the ones who got under their workbenches in the first ten seconds. The workers who tried to run for the doors were knocked down by falling product, light fixtures, or each other. One worker tried to ride out the quake standing in a doorway — old advice, never true for modern buildings — and a falling beam took him out. Drop. Cover. Hold on. Don''t run, don''t freeze, don''t stand under anything that''s about to come down.',
     'Right now — where would you Drop, Cover, and Hold On if the floor started shaking?',
     e'En un sismo de 6.0 cerca de una planta de empaque, los trabajadores que salieron sin lesiones fueron los que se metieron debajo de sus mesas de trabajo en los primeros diez segundos. Los que trataron de correr a las puertas fueron tumbados por producto que caía, lámparas, o por otros compañeros. Un trabajador intentó esperar el sismo parado en un marco de puerta — consejo viejo, nunca cierto para edificios modernos — y una viga que cayó lo derribó. Tírate. Cúbrete. Agárrate. No corras, no te paralices, no te pares debajo de algo que está por caerse.',
     'Ahora mismo — ¿dónde te tirarías, te cubrirías, y te agarrarías si el piso empezara a temblar?'),

    ('Excavation Pre-Entry Checks',
     e'A crew dug a five-foot-deep trench to install a sewer line. They didn''t shore the walls — "it''s only five feet, we''ll be in and out in an hour." A worker stepped down to check the slope. The wall above him collapsed, burying him to the chest. The dirt weight was about 800 pounds on his lower body. He survived because his coworkers got to him in 10 minutes. Six feet of soil weighs about as much as a car. Five feet of soil is enough to crush you.',
     'Anyone going into a trench or pit today — has it been checked by someone qualified, today?',
     e'Una cuadrilla cavó una zanja de metro y medio para instalar una línea de drenaje. No apuntalaron las paredes — "nada más es metro y medio, en una hora salimos." Un trabajador bajó a revisar la pendiente. La pared arriba de él colapsó, dejándolo enterrado hasta el pecho. El peso de la tierra fue como 360 kilos sobre su parte baja. Sobrevivió porque sus compañeros lo sacaron en 10 minutos. Dos metros de tierra pesan como un carro. Metro y medio es suficiente para aplastarte.',
     'Quien vaya a entrar a una zanja o foso hoy — ¿la revisó alguien calificado hoy?'),

    ('Food and Drink in the Work Area',
     e'A worker on a battery production line ate a sandwich at his bench during break. His hands had been handling lead-acid components for three hours. He didn''t wash before eating. Lead exposure is cumulative — you don''t feel it for years. His annual blood-lead test came back at twice the action level. He was pulled off the line for six months. The fix was a 30-second hand wash before eating. Always.',
     'Where''s the wash sink between your station and the break area, and have you used it today?',
     e'Un trabajador en una línea de baterías comió un sandwich en su mesa durante el descanso. Sus manos habían estado manejando componentes de plomo por tres horas. No se lavó antes de comer. La exposición al plomo se acumula — no la sientes por años. Su análisis anual de plomo en sangre salió al doble del nivel de acción. Lo sacaron de la línea por seis meses. El arreglo era un lavado de manos de 30 segundos antes de comer. Siempre.',
     '¿Dónde está el lavabo entre tu estación y el área de descanso, y lo has usado hoy?'),

    ('Hexavalent Chromium in Welding',
     e'A welder spent ten years welding stainless steel without local exhaust. The exhaust would have cost the shop $5,000 to install. He never wore a respirator either — said the fumes "didn''t bother him." At 50, he had a tumor in his throat. The doctor said hexavalent chromium exposure was the most likely cause. Stainless welding fumes are not the kind of fume you can wait out. The damage builds up the whole time you can''t feel it.',
     'If you weld stainless today — what''s catching the fume before it reaches your face?',
     e'Un soldador pasó diez años soldando acero inoxidable sin extracción local. La extracción habría costado al taller 5 mil dólares. Tampoco usaba respirador — decía que los humos "no le molestaban." A los 50, tenía un tumor en la garganta. El doctor dijo que la exposición al cromo hexavalente fue la causa más probable. Los humos de soldadura de acero inoxidable no son humos que puedes aguantar. El daño se acumula todo el tiempo que no lo sientes.',
     'Si vas a soldar inoxidable hoy — ¿qué está atrapando el humo antes de llegar a tu cara?'),

    ('Hot Surface and Burn Prevention',
     e'A line worker reached past a sterilizer pipe to grab a tool. The pipe was 350 degrees Fahrenheit — no warning sticker, no insulation. His forearm pressed against it for less than a second. Skin came off when he pulled away. Two months of bandages and a permanent scar. Surfaces over 140 degrees can give you a third-degree burn in 5 seconds. The pipe was supposed to be insulated three years earlier. The work order was still in the maintenance backlog.',
     'In the room you''re standing in — what surface near you would burn if you touched it?',
     e'Un trabajador de línea estiró el brazo cerca de un tubo de esterilización para alcanzar una herramienta. El tubo estaba a 175 grados Celsius — sin etiqueta, sin aislante. Su antebrazo le pegó menos de un segundo. La piel se le quedó al jalar el brazo. Dos meses de vendajes y una cicatriz permanente. Las superficies arriba de 60 grados Celsius te dan una quemadura de tercer grado en 5 segundos. El tubo debía estar aislado desde hace tres años. La orden de trabajo seguía en la lista de mantenimiento.',
     'En el cuarto donde estás parado — ¿qué superficie cerca de ti te quemaría si la tocaras?'),

    ('Housekeeping — The 5-Minute End-of-Shift',
     e'A worker on the night shift left a few small things on the floor at the end of his shift — a bit of cardboard, an empty solvent can, a coil of stretch wrap. The day shift came in and a forklift driver hit the cardboard, didn''t see what was under it (the can), and rolled over both. The can ruptured, the forklift kicked sparks, and the stretch wrap caught fire. Total damage: $8,000 and a small fire. The end-of-shift cleanup would have taken five minutes.',
     'When you finish today — what''s your five-minute cleanup going to look like?',
     e'Un trabajador del turno de noche dejó unas cosas chicas en el piso al terminar su turno — un cartón, una lata de solvente vacía, un rollo de plástico stretch. Llegó el turno del día y un montacargas pegó en el cartón, no vio lo que tenía abajo (la lata), y le pasó encima a las dos cosas. La lata reventó, el montacargas hizo chispas, y el stretch agarró fuego. Daño total: 8 mil dólares y un fuego chico. La limpieza al final del turno hubiera tomado cinco minutos.',
     'Cuando termines hoy — ¿cómo se va a ver tu limpieza de cinco minutos?'),

    ('Hydrogen Sulfide Awareness',
     e'A wastewater plant worker entered a sewer access point to investigate a clog. He could smell rotten eggs faintly — H2S at low levels. He held his breath and went down. Halfway down he passed out — H2S at higher levels paralyzes your sense of smell first, then knocks you unconscious. He fell five feet to the bottom. A coworker climbed in to save him and also passed out. Both were rescued by the fire department. Both survived. The smell test fails at the levels that kill you. You need a meter, not your nose.',
     'Anywhere on this site that smells like rotten eggs — would you trust your nose to tell you when to leave?',
     e'Un trabajador de planta de aguas residuales entró a un acceso de alcantarilla a investigar un tapón. Olía huevo podrido apenitas — H2S en niveles bajos. Aguantó la respiración y bajó. A la mitad del camino se desmayó — el H2S en niveles más altos paraliza el olfato primero, luego te desmaya. Cayó metro y medio al fondo. Un compañero bajó a rescatarlo y también se desmayó. A los dos los sacaron los bomberos. Los dos sobrevivieron. La prueba del olor falla en los niveles que te matan. Necesitas un medidor, no la nariz.',
     'En cualquier parte del sitio que huela a huevo podrido — ¿le confiarías a tu nariz que te diga cuándo salir?'),

    ('Job Hazard Analysis (JHA) — Reading One',
     e'A new worker showed up to a task that had a written task plan signed by his foreman three weeks earlier. The plan had nine steps. Each step listed the hazards and how to handle them. The new worker glanced at it and said "looks good." On step four — wearing hearing protection while running a chop saw — he had no plugs in. A piece of the saw broke off and bounced off his cheek. Minor cut, but the noise damage from running that saw without plugs is permanent. The plan said exactly what to do. Glancing didn''t cut it.',
     'For the first task you''re going to do today — what does the task plan actually say to wear?',
     e'Un trabajador nuevo llegó a una tarea con un plan escrito firmado por su supervisor tres semanas antes. El plan tenía nueve pasos. Cada paso listaba los peligros y cómo manejarlos. El nuevo le dio una hojeada y dijo "se ve bien." En el paso cuatro — usar protección auditiva con la sierra de corte — no traía tapones. Un pedazo de la sierra se desprendió y le rozó el cachete. Un raspón chico, pero el daño auditivo de usar esa sierra sin tapones es permanente. El plan decía exacto qué hacer. La hojeada no fue suficiente.',
     'Para la primera tarea que vas a hacer hoy — ¿qué dice el plan de la tarea que debes traer puesto?'),

    ('Lead Exposure Awareness',
     e'A house painter worked on pre-1978 homes for 20 years without lead testing. He never wore a respirator while sanding. He brought home dust on his clothes — his kids breathed it. His youngest at age 6 had a lead level high enough to affect her cognitive development. The painter was tested too — his level was three times the medical action point. The fix for him was a half-face respirator and changing clothes before going home. The fix for his kid is medical management for years.',
     'If you work in old buildings — when did you last test for lead, and what do you do with your clothes when you go home?',
     e'Un pintor de casas trabajó en casas de antes de 1978 por 20 años sin pruebas de plomo. Nunca usó respirador al lijar. Llevaba polvo a casa en la ropa — sus hijos lo respiraban. Su hija más chica a los 6 años tenía un nivel de plomo lo suficientemente alto para afectar su desarrollo. Al pintor también lo analizaron — su nivel era tres veces el punto de acción médica. El arreglo para él era un respirador de media cara y cambiarse la ropa antes de irse. El arreglo para su hija es manejo médico por años.',
     'Si trabajas en edificios viejos — ¿cuándo te hicieron la última prueba de plomo, y qué haces con la ropa al llegar a casa?'),

    ('Mold and Indoor Air Quality',
     e'A maintenance crew tried to remove black mold from a basement after a flood. They used bleach and rags — no respirators, no Tyvek. The mold released spores into the air every time they scrubbed. Two of the three workers developed a chronic cough that lasted six months. One had asthma he didn''t have before the cleanup. Mold remediation is a specialty for a reason. Visible mold means call the people who do it for a living, not the maintenance crew.',
     'If you saw black mold growing on a wall here — would you grab a rag, or would you call somebody?',
     e'Una cuadrilla de mantenimiento intentó quitar moho negro de un sótano después de una inundación. Usaron cloro y trapos — sin respiradores, sin Tyvek. El moho soltaba esporas al aire cada vez que tallaban. Dos de los tres trabajadores desarrollaron una tos crónica de seis meses. Uno desarrolló asma que no tenía antes de la limpieza. La remediación de moho es especialidad por una razón. Moho visible significa llamar a la gente que se dedica a eso, no a la cuadrilla de mantenimiento.',
     'Si vieras moho negro creciendo en una pared aquí — ¿agarrarías un trapo, o llamarías a alguien?'),

    ('Pinch Point and Crush Hazard Awareness',
     e'A worker reached into a roller mill to clear a small piece of material that was hanging up. The mill was running. The roller grabbed the rag in his glove, then pulled the glove, then pulled his hand. He yanked back hard enough to lose four fingers, but he kept his hand. The fix was to stop the mill, lock it out, and clear the material. It would have taken two minutes. The bonus on his shift depended on throughput. He''d done it the fast way a hundred times.',
     'In your area — name three pinch points where a glove could go in but a hand can''t come out.',
     e'Un trabajador metió la mano en un molino de rodillos para sacar un pedazo chico de material que se había atorado. El molino estaba prendido. El rodillo agarró un trapo del guante, luego el guante, luego la mano. Tiró tan fuerte que perdió cuatro dedos, pero conservó la mano. El arreglo era parar el molino, ponerle candado, y sacar el material. Hubieran sido dos minutos. El bono de su turno dependía de la producción. Lo había hecho rápido cien veces.',
     'En tu área — di tres puntos de atrape donde un guante puede entrar pero la mano no puede salir.'),

    ('PPE Hygiene and Storage',
     e'A worker shared a pair of safety glasses with the next-shift operator for six months. The glasses were stored on a hook by the punch press. They never got cleaned between users. The day-shift worker had pink eye and didn''t know it yet. The night-shift worker put on the glasses, rubbed his eye, and three days later had a serious eye infection that put him in urgent care. The fix was personal glasses — $8 a pair, his name on a label.',
     'Are the glasses on your face right now actually yours, or are they whoever''s today?',
     e'Un trabajador compartía unos lentes de seguridad con el operador del siguiente turno por seis meses. Los lentes los colgaba en un gancho cerca de la prensa. Nunca los limpiaban entre usos. El del día tenía conjuntivitis y todavía no se enteraba. El de la noche se puso los lentes, se talló el ojo, y tres días después tenía una infección seria que lo mandó a urgencias. El arreglo eran lentes personales — 8 dólares cada par, con su nombre en etiqueta.',
     '¿Los lentes que traes ahora son los tuyos, o son de quien sea hoy?'),

    ('Pre-Task Planning — The Take-5',
     e'Before any task we want everyone to take five — five minutes, five questions: Check the task. Check the tools. Check the site. Check the team. Check yourself. A welder who started doing this religiously caught three near misses in his first week — a leaking gas line, a frayed extension cord, and a coworker who hadn''t slept and was going to cut something he shouldn''t. The five minutes weren''t in the bonus calculation. The injuries he didn''t have weren''t either.',
     'For your next task today — walk me through the Take-Five, out loud.',
     e'Antes de cualquier tarea queremos que todos tomen cinco — cinco minutos, cinco preguntas: Revisa la tarea. Revisa las herramientas. Revisa el sitio. Revisa al equipo. Revísate a ti. Un soldador que empezó a hacer esto religiosamente atrapó tres casi accidentes en su primera semana — una fuga de gas, una extensión pelada, y un compañero que no había dormido y estaba a punto de cortar algo que no debía. Los cinco minutos no estaban en el cálculo del bono. Las lesiones que no tuvo, tampoco.',
     'Para tu siguiente tarea hoy — dime el Take-Five paso a paso, en voz alta.'),

    ('Pre-Work Stretching and Warm-Up',
     e'A 50-year-old worker started the day on a cold Monday in February. He bent down to lift a bucket and his lower back went out — not because the bucket was heavy, but because his back was cold and stiff and he hadn''t moved his body yet. Two months off work. The crew started doing a 5-minute stretch every morning together. Strain injuries dropped 40% over the next year. Five minutes of slow, intentional movement. Five minutes saves you the next two months.',
     'Right now — let''s spend 60 seconds rolling our shoulders and stretching our backs.',
     e'Un trabajador de 50 años empezó un lunes frío en febrero. Se agachó a levantar una cubeta y se le fue la espalda baja — no porque la cubeta estuviera pesada, sino porque su espalda estaba fría y rígida y todavía no había movido el cuerpo. Dos meses sin trabajar. La cuadrilla empezó a hacer 5 minutos de estiramientos juntos cada mañana. Las lesiones por sobreesfuerzo bajaron 40% al siguiente año. Cinco minutos de movimiento lento. Cinco minutos te ahorran los próximos dos meses.',
     'Ahora mismo — vamos a tomar 60 segundos para rodar los hombros y estirar la espalda.'),

    ('Pressure Washer Safety',
     e'A landscaper was cleaning a deck with a 3,000-psi pressure washer. He aimed at a stuck spot, hit a knot in the wood, and the spray bounced back and hit his thigh. The water at that pressure went through his jeans and into his leg. Hydraulic injection injury. Surgery within 24 hours or he loses the leg. He had it. Three surgeries, six weeks. Pressure washers don''t look dangerous because they''re "just water." They''re a knife you can''t see.',
     'If you''re using a pressure washer today — what''s the rule about which way the spray goes?',
     e'Un jardinero limpiaba una terraza con una hidrolavadora de 3,000 psi. Apuntó a una mancha terca, le pegó a un nudo en la madera, y el chorro le rebotó y le pegó en el muslo. El agua a esa presión le atravesó los jeans y se le metió en la pierna. Lesión por inyección hidráulica. Cirugía en 24 horas o perdía la pierna. La tuvo. Tres cirugías, seis semanas. Las hidrolavadoras no se ven peligrosas porque son "nada más agua." Son un cuchillo que no se ve.',
     'Si vas a usar hidrolavadora hoy — ¿cuál es la regla sobre hacia dónde va el chorro?'),

    ('Public and Visitor Safety on Site',
     e'A delivery driver in a suit walked across an active warehouse to the office without a hard hat or vest. A pallet that had been stacked too high tipped over and a 30-pound box landed three feet from him. He sued, settled out of court, and the company paid out about $200,000 to make it go away. The visitor sign-in protocol existed. The receptionist had been trained on it. Nobody had told the delivery driver to wait for an escort.',
     'When was the last time you saw a visitor walking through our area without proper gear?',
     e'Un repartidor de traje cruzó un almacén activo hacia la oficina sin casco ni chaleco. Una tarima apilada demasiado alta se ladeó y una caja de 14 kilos cayó a un metro de él. Demandó, se arregló fuera de la corte, y la empresa pagó como 200 mil dólares para que se acabara. El protocolo de visitantes existía. La recepcionista estaba entrenada. Nadie le dijo al repartidor que esperara una escolta.',
     '¿Cuándo fue la última vez que viste a un visitante caminando por nuestra área sin equipo correcto?'),

    ('Restroom and Drinking Water Access',
     e'A line worker on a hot day held it for too long because the only restroom was a 5-minute walk away and her supervisor was tracking break time. She got a kidney infection. She was out for a week with a 103-degree fever. The whole thing started with a $6 cup of coffee and the unwritten rule that you didn''t leave the line. The fix was the supervisor making restroom breaks routine and visible — not something you had to ask for.',
     'Have you taken a real drink of water and a real bathroom break today?',
     e'Una trabajadora de línea en un día caluroso aguantó mucho tiempo porque el único baño quedaba a 5 minutos caminando y su supervisor controlaba el tiempo de descanso. Le dio una infección renal. Estuvo una semana con 39 de fiebre. Todo empezó con un café de 6 dólares y la regla no escrita de que no se sale de la línea. El arreglo fue que el supervisor hiciera los descansos al baño rutinarios y visibles — no algo que había que pedir.',
     '¿Tomaste un trago de agua de verdad y un descanso de baño de verdad hoy?'),

    ('Severe Weather and Lightning',
     e'A roofing crew was working on a metal roof when a thunderstorm rolled in. The foreman wanted to "finish this section before we stop." Lightning hit a tree about 200 feet away. The current jumped to the metal roof and ran through it. Three workers were knocked off — two with serious burns, one with cardiac arrest. The cardiac arrest worker was revived by a coworker who knew CPR. The foreman lost his certification. The 30-minute rule on lightning would have prevented all of it.',
     'If you hear thunder in the next two hours — what''s your move, and how long until you go back?',
     e'Una cuadrilla de techos trabajaba en un techo metálico cuando llegó una tormenta eléctrica. El supervisor quiso "terminar esta sección antes de parar." Un rayo cayó en un árbol como a 60 metros. La corriente brincó al techo y se corrió por él. Tres trabajadores cayeron — dos con quemaduras serias, uno en paro cardíaco. Al del paro cardíaco lo revivió un compañero que sabía RCP. El supervisor perdió su certificación. La regla de 30 minutos para rayos hubiera prevenido todo.',
     'Si escuchas un trueno en las próximas dos horas — ¿qué haces, y cuánto esperas para regresar?'),

    ('Silica Dust Awareness',
     e'A concrete cutter spent 15 years using a dry-cutting saw on slabs. The dust was visible — you could see it hanging in the air. He wore a paper mask. At 47, he was diagnosed with silicosis. By 50 he was on continuous oxygen. Wet-cutting saws cost $400 more. They eliminate the dust. He has them now — they''re too late for him, but his apprentice will keep his lungs.',
     'Anyone cutting, drilling, or grinding stone or concrete today — is your saw wet or dry?',
     e'Un cortador de concreto usó por 15 años una sierra de corte en seco en losas. El polvo se veía — flotaba en el aire. Usaba mascarilla de papel. A los 47, le diagnosticaron silicosis. A los 50 estaba con oxígeno continuo. Las sierras de corte húmedo cuestan 400 dólares más. Eliminan el polvo. Hoy las tiene — para él ya es tarde, pero su aprendiz va a conservar los pulmones.',
     'Quien vaya a cortar, taladrar o esmerilar piedra o concreto hoy — ¿tu sierra es húmeda o seca?'),

    ('Site Sign-In and Accountability',
     e'A small fire broke out in a back room of a manufacturing plant. Workers evacuated to the muster point. A supervisor counted heads — everyone present except one. They went back in to look for him. Twenty minutes of searching while the fire spread. He was at home — his shift had ended an hour earlier and he hadn''t signed out. Four firefighters were exposed to smoke unnecessarily. The sign-out is a five-second pen stroke. It''s the most important paperwork in an emergency.',
     'When you leave today — are you signing out, or are you just walking?',
     e'Un fuego pequeño empezó en un cuarto de atrás de una planta. Los trabajadores evacuaron al punto de reunión. Un supervisor contó cabezas — todos presentes menos uno. Regresaron a buscarlo. Veinte minutos buscando mientras el fuego crecía. Estaba en su casa — su turno había terminado una hora antes y no firmó la salida. Cuatro bomberos respiraron humo de gratis. La salida es un trazo de pluma de cinco segundos. Es el papeleo más importante en una emergencia.',
     'Cuando salgas hoy — ¿vas a firmar la salida, o nada más vas a salir?'),

    ('Subcontractor Coordination',
     e'On a multi-employer site, an electrical contractor turned off power to a section of the building to do panel work. They didn''t tell the HVAC contractor working a floor below. The HVAC tech had a circular saw plugged in. He was mid-cut when the power came back. The blade came down on his hand. The hospital reattached three fingers. The fix was a 30-second pre-task meeting at the start of the day. The two crews had been on site together for three weeks and never spoken.',
     'Anyone on this site you don''t know yet — go shake their hand before lunch.',
     e'En un sitio con varios empleadores, un contratista eléctrico cortó la corriente a una sección del edificio para trabajar en un panel. No le avisaron al de HVAC que trabajaba un piso abajo. El técnico de HVAC tenía una sierra circular conectada. Iba a la mitad de un corte cuando regresó la corriente. La hoja le cayó en la mano. El hospital le reimplantó tres dedos. El arreglo era una junta de 30 segundos al empezar el día. Las dos cuadrillas llevaban tres semanas en el mismo sitio y nunca se habían hablado.',
     'Alguien en este sitio que no conoces — ve a darle la mano antes de la comida.'),

    ('Substance Abuse and the Job Site',
     e'A 25-year veteran of the trades was on prescription painkillers after a back injury. He didn''t tell his supervisor. Three weeks in, he was operating a forklift and his reaction time was slower than he realized. He hit a rack at low speed — small damage. But it could have been a worker. The painkillers were doing their job. They were also slowing his judgement and his reflexes. The fix was a five-minute conversation with the supervisor when the prescription started. He kept his job. The conversation kept somebody from getting hit.',
     'If you started a new prescription this week — does your supervisor know what it is?',
     e'Un veterano con 25 años en los oficios estaba con analgésicos recetados después de una lesión de espalda. No le dijo a su supervisor. Tres semanas después, operaba un montacargas y sus reflejos eran más lentos de lo que se daba cuenta. Le pegó a un rack a baja velocidad — daño chico. Pero pudo haber sido un trabajador. Los analgésicos hacían su trabajo. También le bajaban el juicio y los reflejos. El arreglo era una conversación de cinco minutos con el supervisor cuando empezó la receta. Conservó el trabajo. La conversación evitó que alguien saliera lastimado.',
     'Si empezaste una receta nueva esta semana — ¿sabe tu supervisor qué es?'),

    ('Tool Tethering at Heights',
     e'A roofer dropped a 4-pound wrench from 30 feet up. He was leaning out and the wrench slipped from his belt — no tether. The wrench fell on a coworker''s shoulder. The math: a 4-pound wrench from 30 feet up hits with about 2,500 pounds of force. The coworker was knocked unconscious. He survived because the wrench hit shoulder, not head. A tool tether costs $5. The $5 would have prevented the ER visit, the lost time, and the permanent shoulder injury.',
     'Anything in your pocket or on your belt right now that could fall on someone below you?',
     e'Un techador dejó caer una llave de 2 kilos desde 9 metros. Estaba inclinado y la llave se le zafó del cinturón — sin amarre. La llave cayó en el hombro de un compañero. La matemática: una llave de 2 kilos desde 9 metros pega con como 1,100 kilos de fuerza. El compañero quedó inconsciente. Sobrevivió porque la llave pegó en el hombro, no en la cabeza. Un amarre de herramienta cuesta 5 dólares. Los 5 dólares hubieran evitado el viaje a urgencias, el tiempo perdido, y la lesión permanente.',
     '¿Hay algo en tu bolsillo o en tu cinturón ahora mismo que podría caer sobre alguien que esté abajo de ti?'),

    ('Workplace Violence Prevention',
     e'A line supervisor was yelled at by a worker during a shift. He brushed it off — "people get heated." That night the worker came back drunk and angry. The supervisor was alone in the office. The worker tried to break in. The supervisor called 911. Police arrived in three minutes. Nobody was hurt. The early-warning sign was the yelling that morning, and the line everyone had crossed: it''s normal to yell here. The fix is a workplace where escalation is named and addressed early.',
     'Has anyone been short with you, or you with them, in the last two days that we should talk about?',
     e'Un supervisor de línea fue gritado por un trabajador durante un turno. Lo dejó pasar — "la gente se exalta." Esa noche el trabajador regresó borracho y enojado. El supervisor estaba solo en la oficina. El trabajador intentó forzar la puerta. El supervisor llamó al 911. La policía llegó en tres minutos. Nadie salió lastimado. La señal temprana fue los gritos de la mañana, y la línea que todos cruzaron: aquí es normal gritar. El arreglo es un lugar de trabajo donde la escalada se nombra y se atiende temprano.',
     '¿Alguien te ha contestado mal, o tú a alguien, en los últimos dos días — algo de lo que deberíamos hablar?')

)
update public.toolbox_talks tt
set
  body_markdown = format(
    e'## %s\n\n'
    '%s\n\n'
    '### Pause and ask the crew\n\n'
    e'**Have any of you been close to something like this in the last month — even if nothing bad happened?**\n\n'
    'Wait for hands. Listen for one or two stories before you move on.\n\n'
    '### Why this matters\n\n'
    '%s\n\n'
    e'The reason this hazard keeps showing up is not that we don''t know it exists. It is that we stop seeing it. We''ve walked past the same risk so many times that our brain stops treating it like something to watch out for. Our eyes go up — to the machine, to the supervisor, to the phone in our hand — and the danger sits there, patient, waiting for the wrong moment.\n\n'
    'The new people on the crew see it. The veterans don''t. That''s the truth, and it''s why we have these talks.\n\n'
    '### What we''re going to do today\n\n'
    e'- **Look first.** Before you start, take a slow visual scan of your area. Anything wrong? Anything missing? Anything new since yesterday?\n'
    e'- **Fix small things now.** If you see something dangerous and you can fix it in 30 seconds, fix it now. Don''t tell yourself you''ll come back. You won''t.\n'
    e'- **Tell your buddy your plan.** Two sentences: "I''m doing X. If something goes wrong, do Y." That''s the whole thing.\n'
    e'- **Use what we have.** The gear, the locks, the tags, the procedures — they''re not paperwork. They''re what brings us home.\n\n'
    '### Look around right now\n\n'
    '**Point to one thing in this area that could go wrong today.**\n\n'
    e'Give the crew a minute. Listen. The first three answers will be the obvious ones. Wait for the fourth — that''s the one that''s been hiding in plain sight.\n\n'
    '### A what-if to think about\n\n'
    e'Imagine you''re working your normal shift, doing your normal job, and you notice the thing the crew just pointed to is worse than usual today. What''s your next move?\n\n'
    'The honest answer for most of us is: nothing. We work through it. We''re tired, we''re behind, somebody else will deal with it. But the right move is to stop, fix it or report it, and then keep working. The five minutes you lose are nothing compared to the six weeks of recovery from an injury — and the meeting nobody wants to be in afterward.\n\n'
    '### What we don''t do here\n\n'
    e'- "I''ve done this a thousand times" — the thousand-and-first time is the one that gets you\n'
    e'- "I''ll come back to it" — you won''t, and the next person walking past won''t see it either\n'
    e'- "It''s not my job to fix that" — it is everybody''s job, and your name is on the line if it hurts somebody\n\n'
    e'### Today''s promise\n\n'
    e'Each of us looks first. Each of us fixes the small things. If something feels wrong, we stop and we ask. Nobody on this crew gets in trouble for stopping work — but somebody gets hurt if we don''t.\n\n'
    '### One last thing\n\n'
    '%s\n\n'
    'End the talk on their answer. Don''t lecture. Just listen.',
    tt.title,
    tc.hook_en,
    coalesce((select summary from public.toolbox_topics where id = tt.topic_id), 'Stay alert and watch out for each other.'),
    tc.close_en
  ),
  body_markdown_es = format(
    e'## %s\n\n'
    '%s\n\n'
    '### Pausa y pregúntale al equipo\n\n'
    e'**¿Alguno de ustedes ha estado cerca de algo así el último mes — aunque no haya pasado nada?**\n\n'
    'Espera las manos. Escucha una o dos historias antes de seguir.\n\n'
    '### Por qué importa\n\n'
    '%s\n\n'
    e'La razón por la que este peligro sigue apareciendo no es que no sepamos que existe. Es que dejamos de verlo. Hemos pasado tantas veces junto al mismo riesgo que nuestro cerebro deja de tratarlo como algo a lo que hay que poner atención. Nuestros ojos suben — a la máquina, al supervisor, al teléfono en la mano — y el peligro está ahí, paciente, esperando el momento equivocado.\n\n'
    e'Los nuevos del equipo lo ven. Los veteranos no. Esa es la verdad, y es por eso que tenemos estas pláticas.\n\n'
    '### Lo que vamos a hacer hoy\n\n'
    e'- **Mira primero.** Antes de empezar, haz un repaso visual lento de tu área. ¿Algo mal? ¿Algo que falta? ¿Algo nuevo desde ayer?\n'
    e'- **Arregla lo pequeño ahora.** Si ves algo peligroso y lo puedes arreglar en 30 segundos, arréglalo ahora. No te digas que regresas. No vas a regresar.\n'
    e'- **Cuéntale tu plan a tu compañero.** Dos frases: "Voy a hacer X. Si algo sale mal, haz Y." Eso es todo.\n'
    e'- **Usa lo que tenemos.** El equipo, los candados, las etiquetas, los procedimientos — no son papeleo. Son lo que nos lleva a casa.\n\n'
    '### Mira alrededor ahora mismo\n\n'
    '**Señala una cosa en esta área que podría salir mal hoy.**\n\n'
    e'Dale al equipo un minuto. Escucha. Las primeras tres respuestas van a ser las obvias. Espera la cuarta — esa es la que se ha estado escondiendo a la vista de todos.\n\n'
    '### Un qué-pasaría para pensar\n\n'
    e'Imagina que estás en tu turno normal, haciendo tu trabajo normal, y notas que la cosa que el equipo acaba de señalar está peor de lo normal hoy. ¿Cuál es tu siguiente paso?\n\n'
    e'La respuesta honesta para la mayoría es: nada. Seguimos trabajando. Estamos cansados, vamos atrasados, alguien más va a verlo. Pero el paso correcto es parar, arreglarlo o reportarlo, y luego seguir trabajando. Los cinco minutos que pierdes no son nada comparados con las seis semanas de recuperación de una lesión — y la junta en la que nadie quiere estar después.\n\n'
    '### Lo que aquí no hacemos\n\n'
    e'- "Lo he hecho mil veces" — la vez mil uno es la que te alcanza\n'
    e'- "Después le veo" — no le vas a ver, y el siguiente que pase tampoco va a verlo\n'
    e'- "No es mi trabajo arreglar eso" — sí es trabajo de todos, y tu nombre va de por medio si alguien sale lastimado\n\n'
    '### El compromiso de hoy\n\n'
    e'Cada uno mira primero. Cada uno arregla lo pequeño. Si algo se siente mal, paramos y preguntamos. Nadie en este equipo se mete en problemas por parar el trabajo — pero alguien sale lastimado si no lo hacemos.\n\n'
    '### Una última cosa\n\n'
    '%s\n\n'
    'Termina la plática con la respuesta de ellos. No regañes. Solo escucha.',
    coalesce(tt.title_es, tt.title),
    tc.hook_es,
    coalesce((select summary from public.toolbox_topics where id = tt.topic_id), 'Mantente alerta y cuiden unos de otros.'),
    tc.close_es
  )
from topic_content tc
where tt.title = tc.title
  and tt.generated_by = 'manual'
  and tt.ai_model is null;

commit;
