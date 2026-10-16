-- Snak King closeout corrections, generated 2026-10-16. Review before running.
-- Backs up every row it touches; the ROLLBACK block at the end restores them.
begin;
create table if not exists loto_energy_steps_backup_20261016 as
  select * from loto_energy_steps where false;
insert into loto_energy_steps_backup_20261016 select * from loto_energy_steps
  where id in ('3d5b94a9-2484-4d04-b7f1-855566f68608', 'c71d2e8a-6fb2-4be9-a157-138b81ba671c', '05270aa4-0154-4bb9-b471-fa1054f1f188', '385b2da1-dfe8-4677-b0a4-dab2b0462c41', 'd7f8a85d-cffb-45d3-88ef-b77d96722d06', '46e761d7-dc21-4d1c-a629-527d3ee3a5b6', 'f4135a09-04cf-4a20-8d95-dea88a6dfb0e', '3ef30e40-c999-4c29-a06b-700f79048604', '44d3739f-cc70-486b-8cd3-2594dcd4a527', '5783b163-8586-4813-9873-af2903602699', 'ad7a40c3-2c6e-466b-9860-77a9bdeff5d8', '29c641e3-6389-4747-ad47-f99549d9f116', '00d37aa0-65a2-487b-9184-b44a84e7e8fc', 'ec9e8198-869f-4451-874a-4e2d1580937f', '572e647c-f672-4244-909c-6d9d755bb944', '0bfc0868-3a0c-48f9-801d-a5d471630e67', '1c2664bc-3d82-45cd-9a0d-98f978b856c9', '42d12461-874a-40a4-b8ed-502d05e3a0c9', '795979e8-8855-4df6-8096-a3f5ad07bce8', '1bd3826b-574e-42f2-a33c-07f84a161def', '2eb86dc1-0153-44bf-b9fd-2ea76c7a9708', '46b313da-214d-4f1c-b0ae-07c724c6992e', 'bde7d312-2245-4263-a0e3-c01365ede57b', 'de88ed95-ccc5-4f85-bd9e-a62d190e6866', '6a33873e-2951-4d7e-948a-a7ca7b772d0e', 'ceb5020e-cc4a-4847-a57a-964ad87bea75', '8c967a11-1059-441d-bdb8-fd890e18187d', '6ea533a7-e5bd-4712-8b7f-b573766ffc46', '67f7139d-4117-4f17-b926-0f39818df9e9', 'dadc9482-fdd6-4ada-b589-1cf9b8b77d97', '1a54d1a8-9031-42bc-9c27-a2de65616ed8', '077d6944-de7d-4058-85d4-b17e144d8db1', 'f8e5fdc6-f49a-488e-ad60-680cc6fff71f', 'dc10590a-5f2e-473d-a155-86a0bfaf2b84', '7b88f66c-b402-4ef5-b52a-98fa7c4f7881', 'e3bd004d-c51f-46cc-950f-2b5978f5499b', '3bf7a7e4-a792-4b53-bf84-e677f20025f9', '05655c76-648c-4bde-b501-5eeed90d8e34', '94a64a70-7552-4717-8aa4-dc69c9978284', 'ef665da5-c48c-423a-94a8-e70b70d2af5e', '64223484-bcdb-4cde-b4da-3196c6fec392', 'd915d468-3212-43b6-beaa-8e91ef1b8278', '8e93527a-4a47-4dcf-997e-3a07a752f5b9', 'e809ec21-55a7-422e-ac07-4b02975a9946', '641f88b6-c5bf-4fa6-a71f-72cb5c457e73', 'f5b16e36-4dbc-48b4-97e3-02da2b69ed73', '20e2890f-ef71-4395-9eb7-e88a6bfbb5dc', 'ae59f0bb-26c9-43af-b79b-6f8cb8a41c76', '93229d4b-14cf-4e1e-86f7-e1b6df56f985', '951d5522-d5f5-4905-bd76-478be7b329c7', '1a09d149-4d1a-45ca-bdca-55bd9f7f47d0', '298f7217-0573-494f-97f0-7c0044c2ac32', '6cc3e120-892e-45ab-8b6f-15f8fd778a23', '7e950289-f534-49b4-88a1-da81ccaeead1', '0525695a-5e3d-47d8-b426-100ad2d03b11', 'aeb5eafd-06a8-41f3-8f89-07c685d96c52', 'f288dabe-8535-4a06-b047-a5ab64c48cd4', 'e13c729f-6ac4-4ef3-b20b-40604a4e12d9', '85c831b0-a179-4dac-94dc-337dab136fad', 'dcdf5792-e56a-4632-ba74-57e5b97f1064', '00ec8dfb-c316-4242-873b-fc8697711163', 'c63c2552-019e-4233-b705-3c1bbd2b7904', 'd28b16fe-894c-4ad8-8a45-0bdb85bf45ce', '3e91d5a0-7716-4ba0-b3e0-88a9aa4981a6', '9418bf36-1e59-441f-85a1-3b82ba5c707c', 'cf0a0ff0-91d4-43f6-9c33-2d15111232af', '3f6357a7-6d3d-4108-ae77-30389643fcbe', 'eef21922-b0fb-4d14-b1af-54c416508d19', 'b611e5de-db31-49d1-b471-c7cb8a7b9f53', '6cab3ea0-37de-411a-86e5-e85321d3f4ce', 'ce67f98b-6796-490d-b833-7f9868210986', '67f7b7cd-8ac9-4db5-806c-3e61280789f2', 'edddd7b5-765c-4b0a-8e89-e5cad66636eb', '64185833-59e3-4e73-b0e8-012af12e96c6', '73d83948-a82e-4f7b-9bc0-06e5e2367f24', '123765e0-8feb-4744-965a-15dec4e087e6', '9cda0f2e-e064-4fa4-9afc-dd1097bc0f09', 'd3ef3e06-30f7-4f82-a04d-a7f464ac4da3', '3a99706d-9098-40d4-9b49-453ff65c3d29', '6ecf15e1-9d4f-45e4-ab7f-8b766b9310db', '3f2cb1da-69e5-4217-95e9-9b74f3bd27bb', 'e97b22e0-6de2-4a4c-8641-6d9511089f28', '0f30e30d-05e9-4e9c-b31e-dedcbd5a77d0', 'ea7c668a-3538-46d9-9c75-c7b57326f89e', '376f2971-6bdd-4498-a7a0-2ee33c1e8e4a', 'a39fd9f1-4ca2-4349-b159-8464d41905cc', '804e92b5-a5ea-47da-b098-3ae54471ac49', '36a445b5-3585-4267-ab0e-58216059b7c1', '849861ac-8963-4d2b-97a6-d8a776428083', '48c0c51f-1d14-44c3-9ee0-00fdd3dd6594', '8e4f2494-c469-4558-9b70-2686a752bd12', '2c00373d-16ae-4c38-bbe7-a4ca031e624f', 'bf9ac1ea-5e74-469e-b285-e3fff9bb5747', 'a26a6c77-7802-4bea-b6e4-4a94d2cc69b8', '0a3fda8e-c712-4939-955c-5289b8f93d13', 'db2087c9-832f-4aa8-ac34-1c20820d2c44', 'db0f825a-4117-4484-bb89-ad4745e4f0b8', 'ab0d938e-7e9e-4a1f-b81b-20bf73d6c0c6', 'e89747c4-2de4-436c-bc2e-286c20e3a2d2', 'b736432e-ac0e-44ef-8076-cc3b66997532', '0fab4239-e062-4ff1-bee1-04ecd01fe363', 'b1e5e456-fbc5-4a74-bf46-7b6d61d0e82b', '6abcd204-9002-484b-b81f-5185afacf65f', 'b634594c-c38b-44b5-96f2-bb68a05df753', '4fb4f265-e42e-4da4-b8bd-107f05daeb00', '47c5530f-b5a7-49d2-af2c-98a06affc318', 'af685c9f-d8fe-4b42-a92c-d8c309d017c2', 'b32a0c3a-a5cd-4cd4-aa2e-071e5fde5059', '7edac0e9-f3ce-407c-8987-48ef1e36b3d2', '4f72c8ef-acbc-4a5c-afc2-27d0ae8d124d', '4e5c2582-2c99-4066-bb58-8b4d8ae8dd07', '0f849b63-7ab3-46ea-ad0c-3c1418783935', 'bec4f3f3-ba38-413d-a6b3-8412200a30c1', '16fba5ca-3a78-46ba-b12d-e7067015ed29', 'ef0d1782-6d4d-47a6-a4b5-eba93bc479ae', '60f5c025-afea-4168-88c7-8d3028461646', '40f9a6f1-fc77-4c71-a7fb-450334c7bf6d', '55381b04-add5-48dd-93ed-53893258ef6e', '021797ba-e041-4821-8cd8-6d84081305a5', '77aea979-9af7-494f-8b3c-ba5b31a654d8', '9ab8358b-aed6-456d-911e-8359afd2b431', 'e098edb4-4ab2-4619-88c4-e18f896f9619', 'c3937ac9-3f11-4f88-a459-76a3ef421fa0', '8ba0e58d-9af2-4b61-8a2b-6b8f0007acf2', '57bd2f69-f9c3-4ca9-b394-6960457f9691', '10ded163-db27-467e-8a6f-91d884b53852', '745ef569-d0a2-4434-9cc1-77d9a05bfc1c', '4b7a143f-9a3a-4146-94ac-e872a8b1ab64', 'a1ffce37-0bbc-46d7-abc6-69323cd7b92a', '1df88d1c-9dd2-4943-a880-14322224e2a2', '10fa638c-1da4-47a5-8a75-83f24eab5a0a', '221fdc07-6b8d-43d3-887f-642298b584fa', '5a429ae8-8c9c-4eca-9506-528856094770', 'ae407bb6-2fc0-4fdd-98c6-bbd5ff00f0cc', 'd434d2d4-43d4-4bc1-8a0f-17c7619d319a', '50f7f1e9-bf04-4676-b4be-a585720e1eda', 'c602795b-4c18-4dbe-9da1-a6cca1047334', '77b6fda8-47a0-4bcd-98bb-194438452804', '924c7a95-379b-4bb0-8124-95ca4209b221', 'a0221bc8-40cd-4838-96eb-9f3d23f3c809', 'e9fee5f2-1e44-41cf-a810-d0176791e604', '45386dba-4fc9-4bef-94d7-313bd9424ba5', '11613646-5bf9-4517-bed5-cce3775a8216', 'b24aa2b8-4b93-4295-b0a5-6b847acd4b8c', '79a19679-29ab-4ae5-8a07-e9eeb2d6d297', '5cf71fa3-8684-4a5e-a870-8f5432de4fcb', '8483e9e7-954a-4f95-9066-198ef58c1b5f', '8b13aac9-ecd9-44ed-aec5-e7db3eedea5a', '1cf4943a-1609-403f-90c0-dc7d4a6ffce3', 'c1ce05b2-76bf-4171-b721-9415d9e7613d', '95709c53-dec1-476e-bdff-bdbfebd13d91', '42c451a9-15b6-418e-abfc-8b367b47ede6', 'ebacdd12-1803-4216-9528-bb0ff069983d', '6401ed0b-2ad6-42db-93fc-d4433428c95c', '8487e6d4-e285-472e-9190-68ee01901a23', 'ae66f574-6bba-45ce-99b5-94efd76779c7', '1e4fc2f8-276b-4493-ac6b-a0c588067d28', '7ba1ad74-50e1-4720-80ff-c625f42d5b1f', '497f2aa2-9137-4ec4-8718-d242cf0b24d2', '675b018f-fbf2-4004-996b-24e9d90389b3', 'b8f4cb5f-6e7a-4092-b1af-ebc93d97ed6f', 'ead8ea4b-0248-4da2-9275-4d6fcfef63ef');
update loto_energy_steps set tag_description = 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — H:

HYDRAULIC (H) — Hydraulic power unit (pump, reservoir, directional valve) driving the compactor ram cylinder(s). Cylinders and hoses hold pressure after the pump stops, and the ram moves if the directional valve shifts. [VERIFY ON SITE: system pressure on HPU gauge/nameplate; accumulator fitted Y/N]', isolation_procedure = 'ISOLATION PROCEDURE — HYDRAULIC (Trash Compactor, BGGN-020):
1. Before lockout, run the ram fully RETRACTED with the normal controls (ram out of the charging chamber).
2. Complete the E procedure — lock the HPU motor disconnect.
3. If the ram or platen is vertical or can move under its own weight, install the RAM SAFETY STRUT/block BEFORE bleeding pressure.
4. Relieve trapped pressure: shift the directional-valve manual override both ways, or open the manual bleed valve, until the pressure gauge reads 0 psi. [VERIFY ON SITE: override/bleed location]
5. If an accumulator is fitted, open its bleed-down valve until its gauge reads 0 psi.
6. Install the ram safety strut (if not already in) before any body part enters the chamber or the area forward of the ram. Never rely on the cylinder to hold the ram.
7. Do not loosen hydraulic fittings until pressure is 0 — fluid-injection hazard.', method_of_verification = 'METHOD OF VERIFICATION — HYDRAULIC:
1. HPU and cylinder pressure gauge(s) read 0 psi; accumulator gauge 0 psi if fitted.
2. Attempt to cycle the ram from the control station — no movement and no pump sound.
3. Ram safety strut installed, tagged and bearing.', tag_description_es = 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — H:

HIDRÁULICA (H) — Unidad de potencia hidráulica (bomba, depósito, válvula direccional) que acciona el/los cilindro(s) del ariete del compactador. Los cilindros y mangueras retienen presión después de que la bomba se detiene, y el ariete se mueve si la válvula direccional cambia de posición. [VERIFICAR EN SITIO: presión del sistema en el manómetro/placa de datos de la HPU; ¿tiene acumulador? S/N]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — HIDRÁULICA (Compactador de Basura, BGGN-020):
1. Antes del bloqueo, lleve el ariete a la posición completamente RETRAÍDA con los controles normales (ariete fuera de la cámara de carga).
2. Complete el procedimiento E — bloquee el desconectador del motor de la HPU.
3. Si el ariete o la placa es vertical o puede moverse por su propio peso, instale el PUNTAL DE SEGURIDAD DEL ARIETE/bloque ANTES de liberar la presión.
4. Libere la presión atrapada: accione la anulación manual de la válvula direccional en ambos sentidos, o abra la válvula de purga manual, hasta que el manómetro marque 0 psi. [VERIFICAR EN SITIO: ubicación de la anulación manual/purga]
5. Si tiene acumulador, abra su válvula de descarga de presión hasta que su manómetro marque 0 psi.
6. Instale el puntal de seguridad del ariete (si aún no está puesto) antes de que cualquier parte del cuerpo entre a la cámara o al área frente al ariete. Nunca dependa del cilindro para sostener el ariete.
7. No afloje las conexiones hidráulicas hasta que la presión esté en 0 — peligro de inyección de fluido.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — HIDRÁULICA:
1. El/los manómetro(s) de la HPU y del cilindro marcan 0 psi; manómetro del acumulador en 0 psi si tiene.
2. Intente ciclar el ariete desde la estación de control — sin movimiento y sin sonido de la bomba.
3. Puntal de seguridad del ariete instalado, etiquetado y soportando la carga.' where id = '3d5b94a9-2484-4d04-b7f1-855566f68608' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to BGGN-064 (A/C Unit 4 – Building Grounds), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a BGGN-064 (A/C Unit 4 – Building Grounds), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'c71d2e8a-6fb2-4be9-a157-138b81ba671c' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to BGGN-065 (A/C Unit 5 – Building Grounds), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a BGGN-065 (A/C Unit 5 – Building Grounds), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '05270aa4-0154-4bb9-b471-fa1054f1f188' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — H:

HYDRAULIC / PRESSURIZED PRODUCT (H) — Transfer pump moving hot caramel from Mix Kettle JECA-530 (combined LOTO group). The discharge line holds pump pressure and the kettle''s gravity head; product and line heaters are hot. [VERIFY ON SITE: confirm no hydraulic drive; product temperature]', isolation_procedure = 'ISOLATION PROCEDURE — PRESSURIZED PRODUCT (Mix Kettle Pump, JECA-540):
1. Complete the E procedure for JECA-540 AND JECA-530 — pump motor, agitator and line heaters locked.
2. Close the kettle outlet (pump suction) valve and the pump discharge valve. Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
3. Open the drain/bleed between the locked valves into a heat-resistant container to relieve trapped pressure; wait until flow stops.
4. Do not open the pump head, seal or line couplings until the T step is verified.', method_of_verification = 'METHOD OF VERIFICATION — PRESSURIZED PRODUCT:
1. Discharge pressure gauge reads 0 (if fitted); bleed open with no flow.
2. Suction and discharge valves closed, locked and tagged.
3. Attempt to start the pump at its control — confirm no rotation and no flow.', tag_description_es = 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — H:

HIDRÁULICA / PRODUCTO PRESURIZADO (H) — Bomba de transferencia que mueve caramelo caliente desde la Marmita de Mezcla JECA-530 (grupo LOTO combinado). La línea de descarga retiene la presión de la bomba y la carga por gravedad de la marmita; el producto y los calentadores de línea están calientes. [VERIFICAR EN SITIO: confirmar que no hay accionamiento hidráulico; temperatura del producto]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — PRODUCTO PRESURIZADO (Bomba de la Marmita de Mezcla, JECA-540):
1. Complete el procedimiento E para JECA-540 Y JECA-530 — motor de la bomba, agitador y calentadores de línea bloqueados.
2. Cierre la válvula de salida de la marmita (succión de la bomba) y la válvula de descarga de la bomba. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
3. Abra el drenaje/purga entre las válvulas bloqueadas hacia un recipiente resistente al calor para liberar la presión atrapada; espere hasta que se detenga el flujo.
4. No abra el cabezal de la bomba, el sello ni los acoples de la línea hasta que el paso T esté verificado.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — PRODUCTO PRESURIZADO:
1. El manómetro de presión de descarga marca 0 (si tiene); purga abierta sin flujo.
2. Válvulas de succión y descarga cerradas, bloqueadas y etiquetadas.
3. Intente arrancar la bomba desde su control — confirme que no hay rotación ni flujo.' where id = '385b2da1-dfe8-4677-b0a4-dab2b0462c41' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JECA-540 (Mix Kettle Pump – Jensen Caramel), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JECA-540 (Mix Kettle Pump – Jensen Caramel), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'd7f8a85d-cffb-45d3-88ef-b77d96722d06' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'S', tag_description = 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — S:

STEAM / HOT CONDENSATE (S) — Condensate return from the steam-jacketed Use Kettle system (combined LOTO with JECA-550, JECA-560). Condensate near 212 °F and flash steam; the receiver can be pressurized by steam blowing through a failed trap. [VERIFY ON SITE: steam supply pressure; pump type — electric vs steam/air pressure-powered]', isolation_procedure = 'ISOLATION PROCEDURE — STEAM / CONDENSATE (Condensate Pump, JECA-570):
1. Complete the E procedure — lock the condensate pump motor disconnect.
2. Close and lock the steam supply valve(s) to the Use Kettle jacket(s) JECA-550/560. [VERIFY ON SITE: valve tags]
3. Close and lock the condensate inlet valve to the pump receiver and the pump discharge valve.
4. If the pump is pressure-powered, also close and lock the motive steam/air valve.
5. Open the receiver vent, then the receiver drain, to relieve pressure to 0 and drain hot condensate to a safe drain; stand clear of the discharge.', method_of_verification = 'METHOD OF VERIFICATION — STEAM / CONDENSATE:
1. Receiver/discharge gauge reads 0 psig; vent open with no steam.
2. Receiver and piping temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
3. Attempt to start the pump — confirm no response.
4. Each steam/condensate valve closed, locked and tagged.', tag_description_es = 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — S:

VAPOR / CONDENSADO CALIENTE (S) — Retorno de condensado del sistema de Marmitas de Uso con chaqueta de vapor (LOTO combinado con JECA-550, JECA-560). Condensado cerca de 212 °F y vapor flash; el tanque receptor puede presurizarse por vapor que pasa a través de una trampa de vapor dañada. [VERIFICAR EN SITIO: presión de suministro de vapor; tipo de bomba — eléctrica vs. accionada por presión de vapor/aire]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — VAPOR / CONDENSADO (Bomba de Condensado, JECA-570):
1. Complete el procedimiento E — bloquee el desconectador del motor de la bomba de condensado.
2. Cierre y bloquee la(s) válvula(s) de suministro de vapor a la(s) chaqueta(s) de las Marmitas de Uso JECA-550/560. [VERIFICAR EN SITIO: etiquetas de las válvulas]
3. Cierre y bloquee la válvula de entrada de condensado al tanque receptor de la bomba y la válvula de descarga de la bomba.
4. Si la bomba es accionada por presión, cierre y bloquee también la válvula de vapor/aire motriz.
5. Abra el venteo del tanque receptor y luego el drenaje del receptor, para liberar la presión a 0 y drenar el condensado caliente a un drenaje seguro; manténgase alejado de la descarga.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — VAPOR / CONDENSADO:
1. El manómetro del receptor/descarga marca 0 psig; venteo abierto sin vapor.
2. Temperatura del receptor y de la tubería a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
3. Intente arrancar la bomba — confirme que no hay respuesta.
4. Cada válvula de vapor/condensado cerrada, bloqueada y etiquetada.' where id = '46e761d7-dc21-4d1c-a629-527d3ee3a5b6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECA-840 (Infeed to Incline Conveyor – Jensen Caramel) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Infeed to Incline Conveyor (JECA-840) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECA-840 (Infeed to Incline Conveyor – Jensen Caramel) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Infeed to Incline Conveyor (JECA-840) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'f4135a09-04cf-4a20-8d95-dea88a6dfb0e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECA-860 (Incline Conveyor to Packaging – Jensen Caramel) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Incline Conveyor to Packaging (JECA-860) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECA-860 (Incline Conveyor to Packaging – Jensen Caramel) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Incline Conveyor to Packaging (JECA-860) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '3ef30e40-c999-4c29-a06b-700f79048604' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECL-100-1 (Incline Helix Conveyor – Jensen Cube Line) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Incline Helix Conveyor #1 (JECL-100-1) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECL-100-1 (Incline Helix Conveyor – Jensen Cube Line) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Incline Helix Conveyor #1 (JECL-100-1) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '44d3739f-cc70-486b-8cd3-2594dcd4a527' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECL-100-2 (Incline Helix Conveyor – Jensen Cube Line) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Incline Helix Conveyor #2 (JECL-100-2) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECL-100-2 (Incline Helix Conveyor – Jensen Cube Line) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Incline Helix Conveyor #2 (JECL-100-2) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '5783b163-8586-4813-9873-af2903602699' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECL-100-3 (Incline Helix Conveyor – Jensen Cube Line) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Incline Helix Conveyor #3 (JECL-100-3) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECL-100-3 (Incline Helix Conveyor – Jensen Cube Line) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Incline Helix Conveyor #3 (JECL-100-3) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'ad7a40c3-2c6e-466b-9860-77a9bdeff5d8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JECL-120 (Small Incline Helix Conveyor – Jensen Cube Line) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Small Incline Helix Conveyor (JECL-120) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JECL-120 (Small Incline Helix Conveyor – Jensen Cube Line) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Small Incline Helix Conveyor (JECL-120) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '29c641e3-6389-4747-ad47-f99549d9f116' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JECL-580 (1st Cooling Tunnel – Jensen Cube Line), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JECL-580 (1st Cooling Tunnel – Jensen Cube Line), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '00d37aa0-65a2-487b-9184-b44a84e7e8fc' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JECL-590 (Slitter – Jensen Cube Line), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'NEUMÁTICA (P) — Suministro de aire comprimido a JECL-590 (Slitter – Jensen Cube Line), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA:
1. Después del aislamiento eléctrico, localice la válvula de aislamiento del suministro neumático que alimenta el 1er Túnel de Enfriamiento (JECL-580) — normalmente montada en la pared junto a la unidad FRL del equipo.
2. Cierre completamente la válvula de suministro de aire.
3. Coloque un dispositivo de bloqueo para válvula de bola y un candado personal en la posición CERRADA.
4. Coloque una etiqueta de bloqueo.
5. Purgue la presión residual del sistema usando el puerto de purga dedicado o ciclando manualmente la válvula de control direccional.
6. Confirme que todos los cilindros se han movido a su posición de reposo sin energía.
7. Según ASME B20.1, cualquier cilindro de acción vertical que sostenga una carga requiere un tope mecánico anticaída independiente además del aislamiento neumático.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. Verifique que la válvula de aislamiento del suministro de aire esté cerrada y bloqueada.
2. Confirme que todos los manómetros aguas abajo de la válvula de bloqueo marquen 0 PSI.
3. Intente ciclar cada actuador neumático desde el panel de control — confirme que no hay movimiento.
4. Opere físicamente la anulación manual de la válvula de control direccional — confirme que no hay movimiento.
5. Verifique físicamente que todos los candados estén asegurados y las etiquetas legibles.' where id = 'ec9e8198-869f-4451-874a-4e2d1580937f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JECL-680 (20 Ton Chiller – Jensen Cube Line), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JECL-680 (20 Ton Chiller – Jensen Cube Line), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '572e647c-f672-4244-909c-6d9d755bb944' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JECL-690 (10 Ton Chiller #1 – Jensen Cube Line), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JECL-690 (10 Ton Chiller #1 – Jensen Cube Line), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '0bfc0868-3a0c-48f9-801d-a5d471630e67' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JEGN-840 (Incline Conveyor – Jensen) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Incline Conveyor (JEGN-840) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JEGN-840 (Incline Conveyor – Jensen) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Incline Conveyor (JEGN-840) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '1c2664bc-3d82-45cd-9a0d-98f978b856c9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator #1 (JEGN-930) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator #1 (JEGN-930) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '42d12461-874a-40a4-b8ed-502d05e3a0c9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JEGN-930 (Bucket Elevator 1 – Jensen), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JEGN-930 (Bucket Elevator 1 – Jensen), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '795979e8-8855-4df6-8096-a3f5ad07bce8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JEGN-970 (Bucket Elevator 5 – Jensen), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JEGN-970 (Bucket Elevator 5 – Jensen), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '1bd3826b-574e-42f2-a33c-07f84a161def' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator #5 (JEGN-970) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator #5 (JEGN-970) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '2eb86dc1-0153-44bf-b9fd-2ea76c7a9708' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JEPK-511 (Metal Detector 1 – Jensen Packaging), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JEPK-511 (Metal Detector 1 – Jensen Packaging), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '46b313da-214d-4f1c-b0ae-07c724c6992e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of JEPL-104 (Hopper Infeed Incline Cvyr – Jensen Peanut Line) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Hopper Infeed Incline Conveyor (JEPL-104) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de JEPL-104 (Hopper Infeed Incline Cvyr – Jensen Peanut Line) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Hopper Infeed Incline Conveyor (JEPL-104) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'bde7d312-2245-4263-a0e3-c01365ede57b' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to JEPL-106 (Sprayers and Blower – Jensen Peanut Line), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a JEPL-106 (Sprayers and Blower – Jensen Peanut Line), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'de88ed95-ccc5-4f85-bd9e-a62d190e6866' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #10 (SHGN-010) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #10 (SHGN-010) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '6a33873e-2951-4d7e-948a-a7ca7b772d0e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #11 (SHGN-011) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #11 (SHGN-011) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'ceb5020e-cc4a-4847-a57a-964ad87bea75' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #12 (SHGN-012) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #12 (SHGN-012) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '8c967a11-1059-441d-bdb8-fd890e18187d' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #13 (SHGN-013) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #13 (SHGN-013) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '6ea533a7-e5bd-4712-8b7f-b573766ffc46' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #14 (SHGN-014) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #14 (SHGN-014) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '67f7139d-4117-4f17-b926-0f39818df9e9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #15 (SHGN-015) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #15 (SHGN-015) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'dadc9482-fdd6-4ada-b589-1cf9b8b77d97' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #1 (SHGN-100) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #1 (SHGN-100) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '1a54d1a8-9031-42bc-9c27-a2de65616ed8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #2 (SHGN-200) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #2 (SHGN-200) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '077d6944-de7d-4058-85d4-b17e144d8db1' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #3 (SHGN-300) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #3 (SHGN-300) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'f8e5fdc6-f49a-488e-ad60-680cc6fff71f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #4 (SHGN-400) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #4 (SHGN-400) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'dc10590a-5f2e-473d-a155-86a0bfaf2b84' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #5 (SHGN-500) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #5 (SHGN-500) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '7b88f66c-b402-4ef5-b52a-98fa7c4f7881' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #6 (SHGN-600) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #6 (SHGN-600) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'e3bd004d-c51f-46cc-950f-2b5978f5499b' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #7 (SHGN-700) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #7 (SHGN-700) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '3bf7a7e4-a792-4b53-bf84-e677f20025f9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #8 (SHGN-800) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #8 (SHGN-800) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '05655c76-648c-4bde-b501-5eeed90d8e34' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Overhead door panel weight (several hundred pounds). If torsion springs fail or counterweights release, the door can fall. Door must be FULLY LOWERED OR braced open with a rated prop-stick before any service work — never trust the drive chain alone.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Shipping Door #9 (SHGN-900) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Peso del panel de puerta elevada (varios cientos de libras). Si los resortes de torsión fallan o se liberan los contrapesos, la puerta puede caer. La puerta debe estar COMPLETAMENTE BAJADA O sostenida abierta con un puntal calificado antes de cualquier trabajo de servicio — nunca confíe únicamente en la cadena de impulsión.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Shipping Door #9 (SHGN-900) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '94a64a70-7552-4717-8aa4-dc69c9978284' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Elevated film carriage will FALL if the drive belt fails. The drive belt is NOT a load-holding device. A mechanical safety strut MUST be installed on the wrapper mast before any work on or beneath the carriage.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Lantech Stretch Wrapper #1 (SKAP-1707) that can descend under gravity.
2. Install the wrapper''s mechanical carriage safety strut on the wrapper mast and confirm it is fully engaged. DO NOT rely on the drive belt to hold the carriage.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El carro de película elevado CAERÁ si falla la banda de impulsión. La banda NO es un dispositivo de soporte de carga. DEBE instalarse un puntal mecánico de seguridad en el mástil antes de cualquier trabajo sobre o debajo del carro.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Lantech Stretch Wrapper #1 (SKAP-1707) que pudieran descender por gravedad.
2. Instale el puntal mecánico de seguridad del carro en el mástil del envolvedor y confirme que esté completamente acoplado. NO confíe en la banda de impulsión para sostener el carro.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'ef665da5-c48c-423a-94a8-e70b70d2af5e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Elevated film carriage will FALL if the drive belt fails. The drive belt is NOT a load-holding device. A mechanical safety strut MUST be installed on the wrapper mast before any work on or beneath the carriage.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Lantech Stretch Wrapper #2 (SKAP-1807) that can descend under gravity.
2. Install the wrapper''s mechanical carriage safety strut on the wrapper mast and confirm it is fully engaged. DO NOT rely on the drive belt to hold the carriage.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El carro de película elevado CAERÁ si falla la banda de impulsión. La banda NO es un dispositivo de soporte de carga. DEBE instalarse un puntal mecánico de seguridad en el mástil antes de cualquier trabajo sobre o debajo del carro.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Lantech Stretch Wrapper #2 (SKAP-1807) que pudieran descender por gravedad.
2. Instale el puntal mecánico de seguridad del carro en el mástil del envolvedor y confirme que esté completamente acoplado. NO confíe en la banda de impulsión para sostener el carro.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '64223484-bcdb-4cde-b4da-3196c6fec392' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKBS-000 (Bulk Flour System - Tortilla TC 1), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKBS-000 (Bulk Flour System - Tortilla TC 1), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'd915d468-3212-43b6-beaa-8e91ef1b8278' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKBS-100 (Bulk Corn System - Tortilla TC 1), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKBS-100 (Bulk Corn System - Tortilla TC 1), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '8e93527a-4a47-4dcf-997e-3a07a752f5b9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Pellet Feed Hopper (SKCC-210) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Pellet Feed Hopper (SKCC-210) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'e809ec21-55a7-422e-ac07-4b02975a9946' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Freidora continua de aceite. 208/480 VAC a la bomba de recirculación de aceite (1–5 HP), accionamiento del transportador de salida, ventilador de aire de combustión / extracción. El panel de supresión de incendios está en un circuito SEPARADO según NFPA 86 — NO lo bloquee durante el LOTO de servicio; se necesita durante el enfriamiento.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (Freidora Cheese Curl, SKCC-610):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKCC-610.
2. Presione STOP; deje que el producto restante salga de la freidora.
3. Abra el desconectador PRINCIPAL en el panel de control de la freidora etiquetado SKCC-610. Coloque candado personal + etiqueta.
4. Abra y bloquee el interruptor del circuito derivado de la BOMBA DE RECIRCULACIÓN DE ACEITE.
5. Abra y bloquee el desconectador del accionamiento del TRANSPORTADOR DE SALIDA.
6. Abra y bloquee los interruptores de los circuitos derivados del VENTILADOR DE AIRE DE COMBUSTIÓN / EXTRACCIÓN.
7. NO bloquee el panel de SUPRESIÓN DE INCENDIOS — está en un circuito NFPA 86 separado y debe permanecer armado durante el enfriamiento.
8. Espere 5 minutos a que se descarguen los capacitores del bus de CD del VFD si hay variadores.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales de los motores de la bomba de aceite y del transportador.
2. Intente arrancar el equipo desde la HMI — confirme que no hay respuesta.
3. Verifique que el panel de supresión de incendios esté en estado NORMAL ARMADO, no puenteado.' where id = '641f88b6-c5bf-4fa6-a71f-72cb5c457e73' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'GAS / TÉRMICA ACEITE CALIENTE (G) — Tren de quemadores de gas natural que calienta el baño de aceite recirculado a 350–400 °F. El aceite se mantiene a >200 °F durante horas después del cierre del gas. LAS SALPICADURAS DE ACEITE CALIENTE SON EL PELIGRO PRINCIPAL DE LA FREIDORA. Se requiere la válvula manual NFPA 86 para el LOTO de servicio.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GAS Y ACEITE CALIENTE (Freidora Cheese Curl, SKCC-610):
1. Cierre la válvula manual de cierre de gas aguas arriba del tren de quemadores.
2. Coloque dispositivo de bloqueo para válvula de bola + candado personal + etiqueta.
3. Purgue el gas entre la válvula manual cerrada y el quemador por el puerto de purga del piloto / puerto de prueba.
4. DEJE ENFRIAR EL ACEITE. NO entre a la tina de aceite ni a la cámara de freído hasta que la temperatura de la SUPERFICIE DEL ACEITE sea <60 °C (use termómetro IR o de contacto). Esto puede requerir varias horas.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GAS Y ACEITE CALIENTE:
1. Válvula manual de gas cerrada y bloqueada.
2. El detector de gas combustible en el puerto de purga marca cero.
3. Intente encender el quemador desde la HMI — confirme que no hay ignición.
4. Temperatura de la SUPERFICIE DEL ACEITE <60 °C verificada con termómetro IR antes de cualquier desarmado del lado del aceite.' where id = 'f5b16e36-4dbc-48b4-97e3-02da2b69ed73' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Cadenas y catarinas del transportador de salida / escurrido. Elevador motorizado de la campana (si lo tiene) — bloqueo del contrapeso si es manual.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (Freidora Cheese Curl):
1. Después del aislamiento eléctrico, bloquee el desconectador del accionamiento del transportador de salida (paso 5 del procedimiento E).
2. Si el elevador de la campana es motorizado: bloquee el desconectador. Si es de contrapeso: asegure la campana con bloques en la posición de servicio.
3. Coloque la etiqueta de aislamiento mecánico.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. Transportador detenido.
2. Elevador de la campana bloqueado o asegurado con bloques.
3. Intente JOG (avance por impulsos) en la HMI — confirme que el transportador no se mueve.' where id = '20e2890f-ef71-4395-9eb7-e88a6bfbb5dc' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a los actuadores del tren de gas y de las compuertas.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (actuadores de la freidora):
1. Cierre y bloquee el suministro neumático en la unidad FRL.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. La compuerta del tren de gas no se mueve con el comando de la HMI.' where id = 'ae59f0bb-26c9-43af-b79b-6f8cb8a41c76' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator to Hopper (SKCC-840) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator to Hopper (SKCC-840) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '93229d4b-14cf-4e1e-86f7-e1b6df56f985' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Retention Hopper (SKCC-850) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Retention Hopper (SKCC-850) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '951d5522-d5f5-4905-bd76-478be7b329c7' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Marmita de palomitas por lotes con agitador. Accionamiento de la paleta 208 VAC, fraccional–2 HP. Encendedor + controles 120 VAC.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (Kettle Corn #1, SKKC-100):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKKC-100.
2. Deje que termine el lote actual; vacíe el producto terminado.
3. Presione STOP en la HMI.
4. Abra el desconectador PRINCIPAL en el panel de control de la marmita etiquetado SKKC-100. Coloque candado personal + etiqueta.
5. Abra y bloquee el desconectador del PANEL DE CONTROL.
6. Si el volteo de descarga es motorizado: abra y bloquee el desconectador del motor de volteo de descarga. Si es manual: asegure con bloque la palanca del seguro de volteo.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor de la paleta.
2. Intente arrancar la paleta en la HMI — confirme que no hay rotación.
3. Candados asegurados en cada punto de aislamiento.' where id = '1a09d149-4d1a-45ca-bdca-55bd9f7f47d0' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'GAS / TÉRMICA (G) — Quemador de gas natural debajo de la marmita, ~100–250 kBTU/hr. La válvula manual de cierre de gas aguas arriba es el punto LOTO según NFPA 86. Superficie de la marmita a 400–450 °F a temperatura de operación; se mantiene a >250 °F durante horas.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GAS Y TÉRMICA (marmita SKKC-100):
1. Cierre la válvula manual de cierre de gas aguas arriba del tren de quemadores.
2. Coloque dispositivo de bloqueo para válvula de bola + candado personal + etiqueta.
3. Purgue la presión residual de gas por el puerto de purga del piloto / puerto de prueba.
4. Deje que las superficies de la marmita se enfríen a <60 °C; verifique con termómetro IR.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GAS Y TÉRMICA:
1. Válvula manual de gas cerrada y bloqueada.
2. El detector de gas combustible en el puerto de purga marca cero.
3. Intente encender el quemador desde la HMI — confirme que no hay ignición.
4. Temperatura de la pared de la marmita <60 °C con termómetro IR antes de tocarla.' where id = '298f7217-0573-494f-97f0-7c0044c2ac32' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Paleta agitadora dentro de la marmita (punto de atrapamiento en el cubo de la paleta). Mecanismo de volteo de descarga (motorizado o con contrapeso manual).', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA:
1. Después del aislamiento eléctrico y de gas, verifique visualmente que la paleta esté detenida.
2. Si el volteo de descarga es motorizado: confirme que el desconectador del motor de volteo esté bloqueado. Si es manual: asegure con bloque la palanca del seguro de volteo.
3. Coloque la etiqueta de aislamiento mecánico.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. Confirme visualmente que la paleta está detenida.
2. Volteo de descarga asegurado con bloque o motor bloqueado.
3. Intente JOG en la HMI — confirme que la paleta no gira.' where id = '6cc3e120-892e-45ab-8b6f-15f8fd778a23' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Elevated carriers descend under load if drive/brake released. Mechanical drop-stop or chain pin required before working inside the casing per ASME B20.1.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Elevator Conveyor (SKKC-340) that can descend under gravity.
2. Lower elevated carriers fully OR install a chain pin / mechanical drop-stop rated for the loaded chain weight per ASME B20.1.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Las paletas elevadas descienden bajo carga si la impulsión/freno se libera. Se requiere tope mecánico anti-caída o pasador de cadena antes de trabajar dentro de la carcasa per ASME B20.1.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Elevator Conveyor (SKKC-340) que pudieran descender por gravedad.
2. Baje las paletas elevadas por completo O instale un pasador de cadena / tope mecánico anti-caída calificado para el peso de la cadena cargada per ASME B20.1.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '7e950289-f534-49b4-88a1-da81ccaeead1' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator to Hopper (SKPC-880) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator to Hopper (SKPC-880) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '0525695a-5e3d-47d8-b426-100ad2d03b11' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKPF-210 (Corn Meal Receiver - Cheese Puff), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKPF-210 (Corn Meal Receiver - Cheese Puff), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'aeb5eafd-06a8-41f3-8f89-07c685d96c52' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Extrusor de doble tornillo Wenger TX/Magnum ST. Accionamiento principal 480 VAC 3Φ, 100–300 HP (verifique en la placa de datos). Zonas de calentadores del barril: calentadores de banda de 480 VAC. Controles 120 VAC / 24 VDC. Accionamiento alimentado por VFD — los capacitores del bus de CD retienen una carga mortal ≥5–15 min después de desconectar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (Wenger serie TX, SKPF-500):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPF-500.
2. Presione STOP y luego E-STOP en la HMI. Deje que el accionamiento principal se detenga por inercia hasta cero.
3. Abra el desconectador del accionamiento PRINCIPAL en el panel MCC de Cheese Puff etiquetado SKPF-500. Coloque candado personal + pasador grupal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de las ZONAS DE CALENTADORES DEL BARRIL.
5. Abra y bloquee el interruptor del circuito derivado del MOTOR DEL CORTADOR — tenga en cuenta que es independiente del accionamiento principal.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥15 minutos a que se descarguen los capacitores del bus de CD del VFD (use el valor de la placa de datos del variador si es mayor).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar según OSHA 1910.333: medidor en fuente energizada conocida → lado línea/carga del desconectador → medidor en fuente energizada conocida.
2. Verifique voltaje cero en las terminales del motor aguas abajo del desconectador.
3. Mida el bus de CD del VFD: debe marcar <50 V en las terminales DC+/DC- antes de abrir el gabinete del variador.
4. Intente arrancar en la HMI — confirme que no hay respuesta.
5. Verifique que cada candado esté asegurado y cada etiqueta legible.' where id = 'f288dabe-8535-4a06-b047-a5ab64c48cd4' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Tornillos gemelos co-rotativos dentro de un barril segmentado con chaqueta. Dado de descarga con CUBO DEL CORTADOR giratorio que lleva 4–18 cuchillas afiladas. Peligro EXTREMO de atrapamiento + laceración. El cubo del cortador puede girar por la presión residual del producto incluso después del aislamiento eléctrico. Superficie del barril a 150–200 °C.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (cortador de cara del dado Wenger, SKPF-500):
1. Después del aislamiento eléctrico según el procedimiento E, verifique manualmente que ambos tornillos se hayan detenido.
2. Gire con barra el acoplamiento de entrada de los tornillos para confirmar cero rotación.
3. Antes de abrir la guarda del dado: inmovilice físicamente el cubo del cortador con el pasador de bloqueo del fabricante o equivalente. NO dependa solo del bloqueo eléctrico del motor del cortador.
4. Deje que las superficies del barril y del dado se enfríen a <60 °C; verifique con termómetro IR antes de tocar.
5. Coloque la etiqueta de aislamiento mecánico en el cubo del cortador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. Confirme visualmente que ambos tornillos y el cubo del cortador están detenidos.
2. Inspeccione que el pasador de inmovilización del cubo del cortador esté enganchado.
3. Confirme que la superficie del barril y del dado está a <60 °C con termómetro IR antes de tocar.
4. Intente girar manualmente el cortador — confirme que no hay movimiento.' where id = 'e13c729f-6ac4-4ef3-b20b-40604a4e12d9' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al tren de gas, compuertas y cualquier actuador de alimentación/descarga.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA:
1. Después del aislamiento eléctrico, localice la válvula de bola del suministro neumático en la unidad FRL del equipo SKPF-500.
2. Ciérrela completamente (manija perpendicular a la tubería).
3. Coloque dispositivo de bloqueo para válvula de bola + candado personal + etiqueta.
4. Ventee aguas abajo hasta 0 psig por la válvula de escape rápido del múltiple.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. Verifique que la válvula de suministro de aire esté cerrada y bloqueada.
2. El manómetro aguas abajo de la FRL marca 0 psig.
3. Intente ciclar cualquier actuador neumático desde la HMI — confirme que no hay movimiento.' where id = '85c831b0-a179-4dac-94dc-337dab136fad' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'VAPOR Y AGUA (H) — Inyección directa de vapor saturado hasta ~150 psig (configuración Wenger thermal-twin). Chaqueta de agua de enfriamiento 60–80 psig. Se registra bajo H porque el esquema Soteria usa E/M/P/G/H/CG.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — VAPOR Y AGUA (inyección térmica Wenger + chaqueta):
1. Cierre y bloquee la válvula de bloqueo de VAPOR en la línea de inyección al barril. Abra la purga/drenaje aguas abajo a la atmósfera hasta que el manómetro de la línea de inyección marque 0 psig.
2. Cierre y bloquee la válvula de suministro de AGUA DE ENFRIAMIENTO. Abra el drenaje de la chaqueta hasta que se detenga el flujo de agua.
3. Deje que la temperatura de la superficie del barril baje a <60 °C antes de cualquier desarmado.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — VAPOR Y AGUA:
1. El manómetro de presión de la línea de vapor marca 0 psig.
2. El drenaje de la chaqueta de enfriamiento no muestra flujo de agua.
3. Temperatura de la superficie del barril <60 °C con termómetro IR.' where id = 'dcdf5792-e56a-4632-ba74-57e5b97f1064' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN:

1. ELÉCTRICA (E)

2. MECÁNICA (M)

3. TÉRMICA (T)

4. NEUMÁTICA (P)', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO Y DISPOSITIVOS DE BLOQUEO:

1. Notifique a todos los empleados afectados que se está realizando LOTO en el Extrusor Wenger 2.
2. Apague el equipo usando los controles normales de operación.
3. Localice y abra (ponga en OFF / apagado) el desconectador eléctrico principal.
4. Coloque el dispositivo de bloqueo y el candado personal en el desconectador en la posición OFF (apagado).
5. Coloque la etiqueta de bloqueo con fecha, hora, nombre y motivo del bloqueo.
6. Cierre la válvula de suministro de aire y purgue la presión residual.
7. Deje que los componentes calientes se enfríen por debajo de 120°F antes de tocarlos.
8. Verifique el estado de energía cero en todos los puntos de aislamiento.
9. Instale un pasador para candados múltiples si varios trabajadores están dando servicio al mismo tiempo.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN:

1. ELÉCTRICA: Use un probador de voltaje calibrado para verificar voltaje cero en el desconectador y en las terminales del motor.
2. MECÁNICA: Confirme visualmente que todas las partes móviles se han detenido.
3. TÉRMICA: Termómetro IR por debajo de 120°F antes de tocar.
4. NEUMÁTICA: Verifique que los manómetros marquen cero.
5. PRUEBA DE ARRANQUE: Intente arrancar — confirme que no hay respuesta.
6. VERIFICACIÓN DE CANDADOS: Verifique físicamente que todos los candados estén asegurados.' where id = '00ec8dfb-c316-4242-873b-fc8697711163' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN:

1. ELÉCTRICA (E)

2. MECÁNICA (M)

3. TÉRMICA (T)

4. NEUMÁTICA (P)', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO Y DISPOSITIVOS DE BLOQUEO:

1. Notifique a todos los empleados afectados que se está realizando LOTO en el Extrusor Wenger 2.
2. Apague el equipo usando los controles normales de operación.
3. Localice y abra (ponga en OFF / apagado) el desconectador eléctrico principal.
4. Coloque el dispositivo de bloqueo y el candado personal en el desconectador en la posición OFF (apagado).
5. Coloque la etiqueta de bloqueo con fecha, hora, nombre y motivo del bloqueo.
6. Cierre la válvula de suministro de aire y purgue la presión residual.
7. Deje que los componentes calientes se enfríen por debajo de 120°F antes de tocarlos.
8. Verifique el estado de energía cero en todos los puntos de aislamiento.
9. Instale un pasador para candados múltiples si varios trabajadores están dando servicio al mismo tiempo.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN:

1. ELÉCTRICA: Use un probador de voltaje calibrado para verificar voltaje cero en el desconectador y en las terminales del motor.
2. MECÁNICA: Confirme visualmente que todas las partes móviles se han detenido.
3. TÉRMICA: Termómetro IR por debajo de 120°F antes de tocar.
4. NEUMÁTICA: Verifique que los manómetros marquen cero.
5. PRUEBA DE ARRANQUE: Intente arrancar — confirme que no hay respuesta.
6. VERIFICACIÓN DE CANDADOS: Verifique físicamente que todos los candados estén asegurados.' where id = 'c63c2552-019e-4233-b705-3c1bbd2b7904' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN:

1. ELÉCTRICA (E)

2. MECÁNICA (M)

3. TÉRMICA (T)

4. NEUMÁTICA (P)', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO Y DISPOSITIVOS DE BLOQUEO:

1. Notifique a todos los empleados afectados que se está realizando LOTO en el Extrusor Wenger 2.
2. Apague el equipo usando los controles normales de operación.
3. Localice y abra (ponga en OFF / apagado) el desconectador eléctrico principal.
4. Coloque el dispositivo de bloqueo y el candado personal en el desconectador en la posición OFF (apagado).
5. Coloque la etiqueta de bloqueo con fecha, hora, nombre y motivo del bloqueo.
6. Cierre la válvula de suministro de aire y purgue la presión residual.
7. Deje que los componentes calientes se enfríen por debajo de 120°F antes de tocarlos.
8. Verifique el estado de energía cero en todos los puntos de aislamiento.
9. Instale un pasador para candados múltiples si varios trabajadores están dando servicio al mismo tiempo.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN:

1. ELÉCTRICA: Use un probador de voltaje calibrado para verificar voltaje cero en el desconectador y en las terminales del motor.
2. MECÁNICA: Confirme visualmente que todas las partes móviles se han detenido.
3. TÉRMICA: Termómetro IR por debajo de 120°F antes de tocar.
4. NEUMÁTICA: Verifique que los manómetros marquen cero.
5. PRUEBA DE ARRANQUE: Intente arrancar — confirme que no hay respuesta.
6. VERIFICACIÓN DE CANDADOS: Verifique físicamente que todos los candados estén asegurados.' where id = 'd28b16fe-894c-4ad8-8a45-0bdb85bf45ce' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Oven Infeed Bucket Elevator (SKPF-600) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Oven Infeed Bucket Elevator (SKPF-600) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '3e91d5a0-7716-4ba0-b3e0-88a9aa4981a6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Secador/horno horizontal Wenger. Controles + Sistema de Gestión del Quemador 480 VAC 3Φ. Ventilador de aire de combustión 5–50 HP, ventilador de extracción 5–50 HP, accionamiento del transportador 5–25 HP.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (horno Wenger, SKPF-610):
1. Inicie el apagado normal del quemador desde el BMS; deje que se complete la post-purga.
2. Abra y bloquee el desconectador eléctrico principal que alimenta CONTROLES + BMS.
3. Abra y bloquee el interruptor del circuito derivado del VENTILADOR DE AIRE DE COMBUSTIÓN.
4. Abra y bloquee el interruptor del circuito derivado del VENTILADOR DE EXTRACCIÓN.
5. Abra y bloquee el desconectador del motor del ACCIONAMIENTO DEL TRANSPORTADOR.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor del accionamiento del transportador.
2. Intente encender el quemador desde el BMS — confirme que no hay ignición (nota: la SSOV puede abrir al recibir el comando; el gas está bloqueado en la válvula manual).
3. Candados asegurados en cada punto de aislamiento.' where id = '9418bf36-1e59-441f-85a1-3b82ba5c707c' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'GAS (G) — Gas natural al tren de quemadores. 2–10 MMBTU/hr típico. Según NFPA 86: la SSOV es automática, NO es un punto de aislamiento bloqueable. El LOTO de servicio requiere que la válvula manual de cierre de combustible AGUAS ARRIBA esté cerrada y bloqueada.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GAS (cierre manual NFPA 86, SKPF-610):
1. Cierre la válvula MANUAL de cierre de combustible aguas arriba del tren de quemadores (el indicador visible de posición debe marcar cerrada).
2. Coloque dispositivo de bloqueo para válvula de bola / cadena y candado + candado personal + etiqueta.
3. Purgue la presión residual de gas entre la válvula manual cerrada y el quemador por el puerto de purga del piloto / puerto de prueba.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GAS:
1. Válvula manual de gas cerrada y bloqueada (manija perpendicular a la tubería).
2. El detector calibrado de gas combustible en el puerto de purga marca cero aguas abajo.
3. Intente encender el quemador en el BMS/HMI — confirme que no hay ignición. La SSOV es automática y NO es el punto LOTO.' where id = 'cf0a0ff0-91d4-43f6-9c33-2d15111232af' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA / TÉRMICA (M) — Cadena/banda del transportador a través de las zonas calientes. Las zonas calientes del pleno a 200–400 °F se mantienen durante horas después del apagado — peligro de quemaduras.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA Y TÉRMICA (cuerpo del horno Wenger):
1. Después del aislamiento eléctrico, bloquee el desconectador del motor del accionamiento del transportador (paso 5 del procedimiento E).
2. Si hay inclinación, calce o asegure con bloques la banda para evitar que se deslice por gravedad.
3. Deje que el pleno y la zona de producto se enfríen. La temperatura de la superficie debe ser <100 °F antes de cualquier contacto.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA Y TÉRMICA:
1. Transportador detenido — verifique visualmente.
2. Bloque/calza colocado donde se necesite.
3. Temperatura de la superficie <100 °F con termómetro IR antes de tocar.' where id = '3f6357a7-6d3d-4108-ae77-30389643fcbe' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a los actuadores del tren de gas y a los actuadores de las compuertas.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (actuadores del horno Wenger):
1. Cierre y bloquee el suministro NEUMÁTICO en la unidad FRL del equipo.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. El actuador de la compuerta / del tren de gas no se mueve con el comando de la HMI.' where id = 'eef21922-b0fb-4d14-b1af-54c416508d19' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator to Hopper (SKPF-830-2) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator to Hopper (SKPF-830-2) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'b611e5de-db31-49d1-b471-c7cb8a7b9f53' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Retention Hopper (SKPF-840) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Retention Hopper (SKPF-840) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '6cab3ea0-37de-411a-86e5-e85321d3f4ce' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKPK-508 (Lima Scale #12 - Scales), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKPK-508 (Lima Scale #12 - Scales), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'ce67f98b-6796-490d-b833-7f9868210986' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKPK-509 (Lima Scale #13 - Scales), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKPK-509 (Lima Scale #13 - Scales), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '67f7b7cd-8ac9-4db5-806c-3e61280789f2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-101):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-101.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-101. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = 'edddd7b5-765c-4b0a-8e89-e5cad66636eb' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-101):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '64185833-59e3-4e73-b0e8-012af12e96c6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA:
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = '73d83948-a82e-4f7b-9bc0-06e5e2367f24' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-102):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-102.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-102. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #2).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-102):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = '123765e0-8feb-4744-965a-15dec4e087e6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-102):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-102.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-102):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '9cda0f2e-e064-4fa4-9afc-dd1097bc0f09' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-102):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-102.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-102):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'd3ef3e06-30f7-4f82-a04d-a7f464ac4da3' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-103):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-103.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-103. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #3).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-103):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = '3a99706d-9098-40d4-9b49-453ff65c3d29' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-103):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-103.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-103):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '6ecf15e1-9d4f-45e4-ab7f-8b766b9310db' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-103):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-103.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-103):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = '3f2cb1da-69e5-4217-95e9-9b74f3bd27bb' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-104):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-104.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-104. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #4).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-104):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = 'e97b22e0-6de2-4a4c-8641-6d9511089f28' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-104):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-104.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-104):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '0f30e30d-05e9-4e9c-b31e-dedcbd5a77d0' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-104):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-104.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-104):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'ea7c668a-3538-46d9-9c75-c7b57326f89e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-105):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-105.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-105. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #5).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-105):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = '376f2971-6bdd-4498-a7a0-2ee33c1e8e4a' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-105):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-105.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-105):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = 'a39fd9f1-4ca2-4349-b159-8464d41905cc' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-105):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-105.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-105):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = '804e92b5-a5ea-47da-b098-3ae54471ac49' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-106):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-106.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-106. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #6).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-106):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = '36a445b5-3585-4267-ab0e-58216059b7c1' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-106):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-106.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-106):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '849861ac-8963-4d2b-97a6-d8a776428083' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-106):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-106.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-106):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = '48c0c51f-1d14-44c3-9ee0-00fdd3dd6594' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-107):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-107.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-107. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #7).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-107):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = '8e4f2494-c469-4558-9b70-2686a752bd12' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-107):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-107.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-107):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '2c00373d-16ae-4c38-bbe7-a4ca031e624f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-107):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-107.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-107):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'bf9ac1ea-5e74-469e-b285-e3fff9bb5747' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-108):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-108.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-108. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #8).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-108):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = 'a26a6c77-7802-4bea-b6e4-4a94d2cc69b8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-108):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-108.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-108):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '0a3fda8e-c712-4939-955c-5289b8f93d13' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-108):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-108.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-108):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'db2087c9-832f-4aa8-ac34-1c20820d2c44' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-109):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-109.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-109. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #9).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-109):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = 'db0f825a-4117-4484-bb89-ad4745e4f0b8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-109):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-109.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-109):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = 'ab0d938e-7e9e-4a1f-b81b-20bf73d6c0c6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-109):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-109.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-109):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'e89747c4-2de4-436c-bc2e-286c20e3a2d2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa de estaciones múltiples Pop Chip. Accionamiento principal 208/480 VAC 3Φ. Zonas de dados calentados — calentadores de banda por zona. Variadores servo / VFD — descarga del bus de CD ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-110):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-110.
2. Complete el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa etiquetado SKPO-110. Coloque candado personal + etiqueta.
4. Abra y bloquee cada interruptor del circuito derivado de los CALENTADORES DE DADOS.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus de CD de los servos / VFD. (Prensa Pop Chip #10).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-110):
1. Pruebe antes de tocar en las terminales del motor del accionamiento de la prensa.
2. Mida el bus de CD del VFD/servo: <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en la HMI — confirme que no hay respuesta.' where id = 'b736432e-ac0e-44ef-8076-cc3b66997532' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dados, punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga por completo por inercia. Superficies de dados calentados a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-110):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia por COMPLETO (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies de los dados se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el seguro de la torreta de SKPO-110.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-110):
1. Confirme visualmente que la torreta está detenida.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté enganchado.
3. Temperatura de la superficie de los dados <60 °C con termómetro IR.
4. Intente girar manualmente la torreta — confirme que no hay movimiento.' where id = '0fab4239-e062-4ff1-bee1-04ecd01fe363' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig al asistente de expulsión de producto, extracción de polvo y vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-110):
1. Cierre y bloquee la válvula de bola neumática en la unidad FRL del equipo SKPO-110.
2. Ventee aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-110):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente ciclar el actuador de expulsión — confirme que no hay movimiento.' where id = 'b1e5e456-fbc5-4a74-bf46-7b6d61d0e82b' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-111):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-111.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-111. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #11).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-111):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '6abcd204-9002-484b-b81f-5185afacf65f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-111):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-111.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-111):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = 'b634594c-c38b-44b5-96f2-bb68a05df753' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-111):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-111.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-111):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '4fb4f265-e42e-4da4-b8bd-107f05daeb00' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-112):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-112.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-112. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #12).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-112):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '47c5530f-b5a7-49d2-af2c-98a06affc318' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-112):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-112.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-112):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = 'af685c9f-d8fe-4b42-a92c-d8c309d017c2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-112):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-112.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-112):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = 'b32a0c3a-a5cd-4cd4-aa2e-071e5fde5059' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-113):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-113.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-113. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #13).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-113):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '7edac0e9-f3ce-407c-8987-48ef1e36b3d2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-113):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-113.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-113):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = '4f72c8ef-acbc-4a5c-afc2-27d0ae8d124d' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-113):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-113.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-113):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '4e5c2582-2c99-4066-bb58-8b4d8ae8dd07' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-114):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-114.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-114. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #14).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-114):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '0f849b63-7ab3-46ea-ad0c-3c1418783935' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-114):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-114.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-114):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = 'bec4f3f3-ba38-413d-a6b3-8412200a30c1' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-114):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-114.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-114):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '16fba5ca-3a78-46ba-b12d-e7067015ed29' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-115):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-115.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-115. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #15).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-115):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = 'ef0d1782-6d4d-47a6-a4b5-eba93bc479ae' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-115):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-115.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-115):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = '60f5c025-afea-4168-88c7-8d3028461646' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-115):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-115.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-115):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '40f9a6f1-fc77-4c71-a7fb-450334c7bf6d' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-116):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-116.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-116. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #16).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-116):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '55381b04-add5-48dd-93ed-53893258ef6e' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-116):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-116.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-116):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = '021797ba-e041-4821-8cd8-6d84081305a5' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-116):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-116.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-116):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '77aea979-9af7-494f-8b3c-ba5b31a654d8' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-117):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-117.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-117. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #17).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-117):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '9ab8358b-aed6-456d-911e-8359afd2b431' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-117):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-117.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-117):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = 'e098edb4-4ab2-4619-88c4-e18f896f9619' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-117):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-117.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-117):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = 'c3937ac9-3f11-4f88-a459-76a3ef421fa0' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-118):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-118.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-118. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #18).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-118):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '8ba0e58d-9af2-4b61-8a2b-6b8f0007acf2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-118):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-118.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-118):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = '57bd2f69-f9c3-4ca9-b394-6960457f9691' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-118):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-118.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-118):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = '10ded163-db27-467e-8a6f-91d884b53852' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Prensa rotativa Pop Chip de múltiples estaciones. Accionamiento principal 208/480 VAC 3Φ. Zonas de dado calentadas — calentadores de banda por zona. Variadores servo / VFD — descarga del bus DC ≥5 min.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (prensa rotativa Pop Chip, SKPO-119):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKPO-119.
2. Termine el ciclo actual; presione STOP y luego E-STOP.
3. Abra el desconectador PRINCIPAL DE LA PRENSA en el panel de control de la prensa rotulado SKPO-119. Coloque candado personal + etiqueta.
4. Abra y bloquee cada breaker del circuito derivado de los CALENTADORES DE DADO.
5. Abra y bloquee el desconectador del motor de ALIMENTACIÓN DE LA TOLVA.
6. Abra y bloquee el desconectador del PANEL DE CONTROL.
7. Espere ≥5 minutos a que se descarguen los capacitores del bus DC del servo / VFD. (Prensa Pop Chip #19).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA (SKPO-119):
1. Pruebe antes de tocar en las terminales del motor de accionamiento de la prensa.
2. Mida con el multímetro que el bus DC del VFD/servo esté <50 V en + / − antes de abrir el gabinete del variador.
3. Intente arrancar en el HMI — confirme que no hay respuesta.' where id = '745ef569-d0a2-4434-9cc1-77d9a05bfc1c' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Torreta rotativa con múltiples estaciones de dado; punzones accionados por leva que generan >30 toneladas de fuerza de aplastamiento por punzón. La torreta conserva inercia rotacional después del E-stop — se requiere que se detenga completamente por inercia. Superficies de dado calentadas a 250–400 °F.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (torreta rotativa, SKPO-119):
1. Después del aislamiento eléctrico, deje que la torreta se detenga por inercia hasta un paro TOTAL (10–30 s típico) — verifique visualmente.
2. Inserte el PASADOR DE BLOQUEO DE LA TORRETA del fabricante antes de meter la mano más allá de la guarda de los punzones.
3. Deje que las superficies del dado se enfríen a <60 °C; verifique con termómetro IR.
4. Coloque la etiqueta de aislamiento mecánico en el bloqueo de la torreta de SKPO-119.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA (SKPO-119):
1. Confirme visualmente que la torreta está inmóvil.
2. Inspeccione que el PASADOR DE BLOQUEO DE LA TORRETA esté insertado.
3. Temperatura de la superficie del dado <60 °C con termómetro IR.
4. Intente girar la torreta manualmente — confirme que no hay movimiento.' where id = '4b7a143f-9a3a-4146-94ac-e872a8b1ab64' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a la asistencia de expulsión de producto, a la extracción de polvo y al vibrador de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (SKPO-119):
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo SKPO-119.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA (SKPO-119):
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el actuador de expulsión — confirme que no hay movimiento.' where id = 'a1ffce37-0bbc-46d7-abc6-69323cd7b92a' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Tambor de volteo OMS FastBack Revolution de Heat & Control. Motorreductor del tambor 460 VAC 3Φ, 3–7.5 HP. Accionamiento del transportador FastBack con contrapeso excéntrico 460 VAC. Soplador del colector de polvo 5–10 HP. Controles 120 VAC.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (tambor AccuFlavor de Heat & Control, SKPO-179):
1. Detenga el flujo de producto aguas arriba; haga funcionar el tambor vacío durante dos ciclos para eliminar el sazonador.
2. Presione el E-stop del tambor y del accionamiento FastBack. Ponga ambos VFD en STOP.
3. Abra el desconectador eléctrico PRINCIPAL en el panel OMS rotulado SKPO-179 (el tambor, el FastBack y el colector de polvo se alimentan de circuitos derivados de este panel). Coloque candado personal + etiqueta.
4. Espere 5 minutos a que se descarguen los capacitores del bus DC del VFD.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motorreductor del tambor.
2. Intente arrancar el tambor y el FastBack desde el HMI — confirme que no hay rotación ni carrera de la bandeja.
3. Candados asegurados.' where id = '1df88d1c-9dd2-4943-a880-14322224e2a2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA + ACEITE CALIENTE (P) — 80–100 psig a las boquillas de aspersión atomizadoras y a la compuerta Revolution Proportional Gate 3.0. Aceite caliente para sazonador a 140–180 °F en el múltiple de boquillas.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA Y ACEITE PARA SAZONADOR (OMS FastBack, SKPO-179):
1. Cierre y bloquee la válvula de bola de aire comprimido que alimenta el skid de aspersión. Libere la presión del regulador hasta 0 psig.
2. Cierre y bloquee la válvula de suministro de aceite para sazonador. Libere la presión del múltiple en el drenaje.
3. Si hay chaqueta de aceite caliente instalada: cierre el suministro/retorno de la chaqueta y deje enfriar a <100 °F antes de tocar.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA Y ACEITE PARA SAZONADOR:
1. El manómetro neumático en el múltiple del skid de aspersión marca 0 psig.
2. No hay flujo de aceite en el múltiple de las boquillas de aspersión.
3. Líneas de la chaqueta de aceite caliente <100 °F con termómetro IR, si aplica.' where id = '10fa638c-1da4-47a5-8a75-83f24eab5a0a' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA + POLVO COMBUSTIBLE (M) — Tambor AccuFlavor giratorio con gran inercia. Punto de atrapamiento en la zona entre la carcasa del tambor y los rodillos locos. Energía almacenada en el excéntrico de la bandeja FastBack. Polvo combustible de sazonador dentro del tambor/ducto — aplica el programa NFPA 652.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA Y POLVO (interior del tambor Heat & Control):
1. Después del aislamiento eléctrico, bloquee el tambor con el pasador o la calza del fabricante; bloquee el excéntrico de la bandeja FastBack.
2. Para entrar al tambor como espacio confinado: conecte equipotencialmente (bonding) y aterrice el tambor y los ductos. Realice el monitoreo atmosférico de polvo combustible según NFPA 652 antes de cualquier entrada.
3. Coloque la etiqueta de aislamiento mecánico.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA Y POLVO:
1. Pasador / calza del tambor colocado.
2. Bandeja FastBack bloqueada.
3. Cable de unión equipotencial/aterrizaje conectado (verificado con medidor de continuidad).
4. El medidor de polvo combustible marca por debajo del límite de entrada de NFPA 652.' where id = '221fdc07-6b8d-43d3-887f-642298b584fa' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of SKT1-200 (Column Screw Lift Elevator - Tortilla TC 1) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Column Screw Lift Elevator (SKT1-200) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de SKT1-200 (Column Screw Lift Elevator - Tortilla TC 1) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Column Screw Lift Elevator (SKT1-200) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '5a429ae8-8c9c-4eca-9506-528856094770' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — H:

HYDRAULIC (H) — Shaffer bowl-tilt cylinder(s) and hydraulic power unit. A tilted bowl held only by the cylinder can rotate if pressure is lost or bled. [VERIFY ON SITE: working pressure on HPU gauge/nameplate; single or dual cylinder; accumulator Y/N]', isolation_procedure = 'ISOLATION PROCEDURE — HYDRAULIC (Shaffer bowl tilt, SKT1-220):
1. With power still on, return the bowl to its upright/home position and lower the cover — OR, if the work needs the bowl tilted, tilt it to the service position and install the Shaffer bowl safety stand / lock pin FIRST. [VERIFY ON SITE: stand/pin device]
2. Complete the E procedure; open and lock the hydraulic power unit disconnect if it is separate from the main.
3. Only after the bowl is upright or mechanically blocked: relieve pressure with the manifold manual bleed (and accumulator bleed, if fitted) until the tilt-cylinder gauge reads 0 psig.
4. Do not loosen hydraulic fittings until pressure is 0 — fluid-injection hazard.', method_of_verification = 'METHOD OF VERIFICATION — HYDRAULIC:
1. Tilt-cylinder (and accumulator) gauge reads 0 psig.
2. Attempt bowl tilt / jog at the HMI — confirm no movement.
3. Bowl upright, or bowl safety stand engaged, pinned and tagged; no bowl drift.', tag_description_es = 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — H:

HIDRÁULICA (H) — Cilindro(s) de inclinación del tazón Shaffer y unidad de potencia hidráulica. Un tazón inclinado sostenido solo por el cilindro puede girar si se pierde o se purga la presión. [VERIFICAR EN SITIO: presión de trabajo en el manómetro/placa de datos de la HPU; uno o dos cilindros; acumulador Sí/No]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — HIDRÁULICA (inclinación del tazón Shaffer, SKT1-220):
1. Con la energía todavía conectada, regrese el tazón a su posición vertical/inicial y baje la tapa — O, si el trabajo requiere el tazón inclinado, inclínelo a la posición de servicio e instale PRIMERO el soporte de seguridad del tazón / pasador de bloqueo Shaffer. [VERIFICAR EN SITIO: dispositivo de soporte/pasador]
2. Complete el procedimiento E; abra y bloquee el desconectador de la unidad de potencia hidráulica si está separado del principal.
3. Solo después de que el tazón esté vertical o bloqueado mecánicamente: libere la presión con la purga manual del múltiple (y la purga del acumulador, si tiene) hasta que el manómetro del cilindro de inclinación marque 0 psig.
4. No afloje conexiones hidráulicas hasta que la presión esté en 0 — peligro de inyección de fluido.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — HIDRÁULICA:
1. El manómetro del cilindro de inclinación (y del acumulador) marca 0 psig.
2. Intente inclinar / mover en jog el tazón desde el HMI — confirme que no hay movimiento.
3. Tazón en posición vertical, o soporte de seguridad del tazón colocado, con pasador y etiquetado; el tazón no se desplaza.' where id = 'ae407bb6-2fc0-4fdd-98c6-bbd5ff00f0cc' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKT1-252 (Masa Hogg A - Tortilla TC 1), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKT1-252 (Masa Hogg A - Tortilla TC 1), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'd434d2d4-43d4-4bc1-8a0f-17c7619d319a' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKT1-255 (Masa Hogg B - Tortilla TC 1), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKT1-255 (Masa Hogg B - Tortilla TC 1), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '50f7f1e9-bf04-4676-b4be-a585720e1eda' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKT2-210 (Flour Receiver - Tortilla TC 2), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKT2-210 (Flour Receiver - Tortilla TC 2), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = 'c602795b-4c18-4dbe-9da1-a6cca1047334' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Product or raised parts of SKT2-220 (Column Screw Lift - Tortilla TC 2) can move under their own weight (back-driving the screw or belt, or dropping) when the drive or brake is released. [VERIFY ON SITE: confirm the gravity hazard and the blocking point.]', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Column Screw Lift (SKT2-220) that can descend under gravity.
2. Lower the elevated component fully OR install a rated mechanical drop-stop / safety strut.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — El producto o las partes elevadas de SKT2-220 (Column Screw Lift - Tortilla TC 2) pueden moverse por su propio peso (retroceso del tornillo o la banda, o caída) al liberar el motor o el freno. [VERIFICAR EN SITIO: confirmar el peligro de gravedad y el punto de bloqueo.]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Column Screw Lift (SKT2-220) que pudieran descender por gravedad.
2. Baje el componente elevado por completo O instale un tope mecánico anti-caída / puntal de seguridad calificado.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '77b6fda8-47a0-4bcd-98bb-194438452804' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Mezcladora horizontal Shaffer Single Sigma. Motor principal 460 VAC 3Φ, 50–150 HP (verifique la placa de datos). Controles 120 VAC.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (Shaffer Single Sigma, SKT2-240):
1. Descargue el lote actual; regrese el tazón a nivel; baje la tapa y asegúrela con el seguro.
2. Detenga la mezcladora en el HMI; ponga el accionamiento en STOP (no en JOG).
3. Abra el desconectador PRINCIPAL con fusibles en el panel de control marca Shaffer rotulado SKT2-240. Coloque candado personal + etiqueta.
4. Abra y bloquee el desconectador del PANEL DE CONTROL.
5. Deje que el agitador llegue al reposo completo (30–60 s).', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor del agitador.
2. Intente JOG en el HMI — el agitador no debe moverse.
3. Candados asegurados en cada punto de aislamiento.' where id = '924c7a95-379b-4bb0-8124-95ca4209b221' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Paleta del agitador sigma (peligro grave de enredo / corte). La inclinación del tazón descarga una carga de hasta 1,600 lb de masa; el tazón soportado hidráulicamente puede caer libremente si se rompe la manguera del cilindro. Aplican las reglas de espacio confinado cuando el tazón tiene >4 ft de profundidad.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (Shaffer Single Sigma, SKT2-240):
1. Después del aislamiento eléctrico, confirme que el agitador está en reposo total.
2. Si el tazón va a permanecer inclinado: instale el SOPORTE DE SEGURIDAD DEL TAZÓN proporcionado por el fabricante antes de cualquier trabajo interno. NO confíe en el cilindro hidráulico para sostener el tazón.
3. Para entrada interna: se requiere el programa de espacio confinado cuando el tazón tiene >4 ft de profundidad.
4. Coloque la etiqueta de aislamiento mecánico.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. Confirme visualmente que el agitador tiene cero rotación.
2. Soporte de seguridad del tazón colocado y con pasador.
3. Interbloqueo de la tapa — NO confíe en él como aislamiento de energía; es solo una guarda.' where id = 'a0221bc8-40cd-4838-96eb-9f3d23f3c809' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
HYDRAULIC (H) — Shaffer bowl-tilt cylinders. The hydraulic-supported bowl can rotate or fall if cylinder pressure is lost — block it before bleeding. [VERIFY ON SITE: working pressure from HPU nameplate]', isolation_procedure = 'ISOLATION PROCEDURE — HYDRAULIC (Shaffer bowl-tilt, SKT2-240):
1. With power still on, return the bowl upright — OR tilt to the service position and install the BOWL SAFETY STAND first.
2. Open and lock the HYDRAULIC POWER UNIT disconnect.
3. Only then bleed the accumulator at the test port until the cylinder gauge reads 0 psig.', method_of_verification = 'METHOD OF VERIFICATION — HYDRAULIC:
1. HPU disconnect locked open.
2. Hydraulic cylinder pressure gauge reads 0 psig.
3. Bowl upright or safety stand engaged and pinned.
4. Attempt bowl tilt at HMI — confirm no movement.', tag_description_es = 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
HIDRÁULICA (H) — Cilindros de inclinación del tazón Shaffer. El tazón soportado hidráulicamente puede girar o caer si se pierde la presión del cilindro — bloquéelo antes de purgar. [VERIFICAR EN SITIO: presión de trabajo según la placa de datos de la HPU]', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — HIDRÁULICA (inclinación del tazón Shaffer, SKT2-240):
1. Con la energía todavía conectada, regrese el tazón a la posición vertical — O inclínelo a la posición de servicio e instale primero el SOPORTE DE SEGURIDAD DEL TAZÓN.
2. Abra y bloquee el desconectador de la UNIDAD DE POTENCIA HIDRÁULICA.
3. Solo entonces purgue el acumulador en el puerto de prueba hasta que el manómetro del cilindro marque 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — HIDRÁULICA:
1. Desconectador de la HPU bloqueado en posición abierta.
2. El manómetro de presión del cilindro hidráulico marca 0 psig.
3. Tazón en posición vertical o soporte de seguridad colocado y con pasador.
4. Intente inclinar el tazón desde el HMI — confirme que no hay movimiento.' where id = 'e9fee5f2-1e44-41cf-a810-d0176791e604' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig a los cilindros de levantamiento de la tapa y a las válvulas CIP donde existan.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA:
1. Cierre y bloquee la válvula de bola neumática en la FRL del equipo.
2. Libere la presión aguas abajo mediante el escape rápido hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Intente accionar el levantamiento de la tapa desde el HMI — confirme que no hay movimiento.' where id = '45386dba-4fc9-4bef-94d7-313bd9424ba5' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — P:

PNEUMATIC (P) — Compressed-air supply to SKT2-280 (Masa Pump - Tortilla TC 2), where fitted. [VERIFY ON SITE: confirm this machine has a compressed-air supply and record its lockout valve; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — P:

NEUMÁTICA (P) — Suministro de aire comprimido a SKT2-280 (Masa Pump - Tortilla TC 2), si lo tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene suministro de aire comprimido y anotar su válvula de bloqueo; eliminar este paso si no lo tiene.]' where id = '11613646-5bf9-4517-bed5-cce3775a8216' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Motor de la HPU de la bomba-extrusora hidráulica de pistón doble Marlen, 230/460 VAC 3Φ. Controles 120 VAC. NOTA: Esta es una unidad MARLEN (hidráulica de pistón doble), NO una extrusora de tornillo. El aislamiento eléctrico por sí solo NO despresuriza el sistema hidráulico.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (Marlen Opti-Xtrude / clase V750, SKT2-500):
1. Notifique a todos los empleados afectados que se está realizando LOTO en SKT2-500.
2. Presione E-STOP en el HMI. Deje que los pistones de bombeo se detengan al final de la carrera actual.
3. Abra el desconectador eléctrico PRINCIPAL en el panel de control de la HPU. Coloque candado personal + etiqueta.
4. Abra y bloquee el desconectador de ENERGÍA DE CONTROL en el panel de la HPU.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor de la HPU según OSHA 1910.333.
2. Intente arrancar la máquina en el HMI — confirme que no hay respuesta.
3. Confirme que los candados están asegurados en cada punto de aislamiento.' where id = 'b24aa2b8-4b93-4295-b0a5-6b847acd4b8c' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'HIDRÁULICA (H) — Dos cilindros de accionamiento de doble efecto + acumulador (si está instalado). Salida de la HPU de hasta ~2,000 psig. Marlen indica: las bombas retienen la misma presión detenidas que en movimiento. DETENER EL MOTOR NO DESPRESURIZA EL SISTEMA HIDRÁULICO. Paso obligatorio de descarga de presión (dump-down).', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — HIDRÁULICA (Marlen de pistón doble, SKT2-500):
1. Abra las válvulas de descarga/purga en el múltiple hidráulico para regresar ambos cilindros a neutral.
2. Confirme que el manómetro de la HPU marca 0 psig.
3. Si hay un acumulador instalado: abra su válvula de aislamiento y luego su válvula de purga. Observe que el manómetro baje a 0 psig.
4. Coloque el bloqueo en la(s) válvula(s) de descarga hidráulica en la posición de descarga.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — HIDRÁULICA:
1. El manómetro de la HPU marca 0 psig.
2. El manómetro del acumulador (si tiene) marca 0 psig.
3. Accione manualmente la válvula de control direccional hidráulica en el múltiple — confirme que no hay movimiento de los pistones.
4. Inspeccione los candados en las posiciones de la válvula de descarga y de la purga del acumulador.' where id = '79a19679-29ab-4ae5-8a07-e9eeb2d6d297' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — Aire de planta a 100 psig / 7 bar a los actuadores de las válvulas de mariposa/laminado (controles de lógica neumática según Marlen).', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA (lógica neumática Marlen):
1. Cierre y bloquee la válvula de suministro NEUMÁTICO en la FRL del equipo.
2. Verifique que el escape rápido haya liberado la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL marca 0 psig.
2. Accione manualmente la válvula de control direccional — confirme que no hay movimiento del actuador.' where id = '5cf71fa3-8684-4a5e-a870-8f5432de4fcb' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA / PRODUCTO RESIDUAL (M) — Puede quedar atrapada una presión residual de masa de hasta 250 psig entre los pistones y la válvula de laminado cerrada. Tolva de masa de hasta 300 lb arriba de los pistones (carga por gravedad). SIN tornillo giratorio; SIN barril calentado.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA Y PRODUCTO RESIDUAL (Marlen, SKT2-500):
1. Vacíe el producto restante de la tolva de masa para eliminar la carga por gravedad arriba de los pistones.
2. Abra la válvula de mariposa de descarga / laminado para liberar la presión residual del producto hacia un recipiente de captación limpio.
3. Confirme que el manómetro de salida marca 0 psig.
4. Deje que el cabezal de producto y el dado se enfríen a temperatura ambiente antes de desarmar.
5. Bloquee cualquier tapa de tolva levantada.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA Y PRODUCTO RESIDUAL:
1. Tolva vacía (confirmación visual).
2. El manómetro de salida (unión en Y) marca 0 psig.
3. Válvula de laminado/mariposa abierta y bloqueada.
4. Cabezal de producto a temperatura ambiente, medido con termómetro IR.' where id = '8483e9e7-954a-4f95-9066-198ef58c1b5f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description = 'ENERGY TAG & DESCRIPTION — M:

MECHANICAL (M) — Moving parts of SKT2-610 (Heat Exchanger - Tortilla TC 2), where fitted. [VERIFY ON SITE: confirm whether this machine has a mechanical drive; delete this step if it has none.]', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — M:

MECÁNICA (M) — Partes móviles de SKT2-610 (Heat Exchanger - Tortilla TC 2), si las tiene. [VERIFICAR EN SITIO: confirmar si esta máquina tiene accionamiento mecánico; eliminar este paso si no lo tiene.]' where id = '8b13aac9-ecd9-44ed-aec5-e7db3eedea5a' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on USDA Product Bucket Elevator (USGN-820) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en USDA Product Bucket Elevator (USGN-820) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '1cf4943a-1609-403f-90c0-dc7d4a6ffce3' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Packaging Hopper #1 (USPK-840) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Packaging Hopper #1 (USPK-840) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'c1ce05b2-76bf-4171-b721-9415d9e7613d' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Packaging Hopper #2 (USPK-850) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Packaging Hopper #2 (USPK-850) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '95709c53-dec1-476e-bdff-bdbfebd13d91' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — STORED PRODUCT MASS. Engulfment hazard — never enter the hopper interior without confined-space permit and full isolation. Discharge-gate must be locked CLOSED OR hopper emptied before entry.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Packaging Hopper #3 (USPK-860) that can descend under gravity.
2. Empty the hopper OR lock the discharge gate in the CLOSED position. NEVER enter the hopper interior under stored product — engulfment hazard. If interior entry is required, treat as a confined-space permit per Cal/OSHA Title 8 §5157.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — MASA DE PRODUCTO ALMACENADO. Peligro de sepultamiento — nunca entre al interior de la tolva sin permiso de espacio confinado y aislamiento completo. La compuerta de descarga debe quedar bloqueada en posición CERRADA O la tolva vaciada antes de entrar.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Packaging Hopper #3 (USPK-860) que pudieran descender por gravedad.
2. Vacíe la tolva O bloquee la compuerta de descarga en la posición CERRADA. NUNCA entre al interior de la tolva bajo producto almacenado — peligro de sepultamiento. Si se requiere entrada interior, trate como permiso de espacio confinado per Cal/OSHA Título 8 §5157.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '42c451a9-15b6-418e-abfc-8b367b47ede6' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator #1 (USPK-900) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator #1 (USPK-900) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = 'ebacdd12-1803-4216-9528-bb0ff069983d' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator #2 (USPK-910) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator #2 (USPK-910) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '6401ed0b-2ad6-42db-93fc-d4433428c95c' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description = 'ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Loaded buckets in the up-leg will descend if drive/brake releases. Anti-runback dog OR a positively-engaged chain pin is required before working inside the casing.', isolation_procedure = 'ISOLATION PROCEDURE — GRAVITY:
1. After electrical and mechanical isolation, identify all elevated or stacked masses on Bucket Elevator #3 (USPK-920) that can descend under gravity.
2. Engage the anti-runback dog OR install a positively-keyed chain pin so loaded buckets in the up-leg cannot descend under product weight.
3. NEVER rely on hydraulic cylinders, pneumatic cylinders, electric brakes, or drive belts to hold an elevated load while LOTO is in place — these are NOT load-holding devices for service work.
4. Verify the drop-stop / strut is rated for the actual load.
5. Apply a lockout tag to the drop-stop / strut identifying the worker.', method_of_verification = 'METHOD OF VERIFICATION — GRAVITY:
1. Physically confirm the elevated mass is either fully lowered to its mechanical bottom hard stop OR a rated mechanical drop-stop / safety strut is engaged.
2. Verify the drop-stop is rated for the actual load (stamped capacity ≥ equipment weight).
3. Visually inspect the drop-stop engagement — no gap between the support and the elevated mass.
4. Tap-test or shake-test the support to confirm it is bearing load.
5. Confirm the drop-stop has its own lockout tag attached so it cannot be removed by anyone other than the authorized worker.', tag_description_es = 'ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Los cangilones cargados en la rama ascendente descenderán si la impulsión/freno se libera. Se requiere el trinquete anti-retroceso O un pasador de cadena positivamente acoplado antes de trabajar dentro de la carcasa.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD:
1. Después del aislamiento eléctrico y mecánico, identifique todas las masas elevadas o apiladas en Bucket Elevator #3 (USPK-920) que pudieran descender por gravedad.
2. Acople el trinquete anti-retroceso O instale un pasador de cadena positivamente fijado para que los cangilones cargados en la rama ascendente no puedan descender bajo el peso del producto.
3. NUNCA confíe en cilindros hidráulicos, cilindros neumáticos, frenos eléctricos o bandas de impulsión para sostener una carga elevada mientras hay LOTO en su lugar — estos NO son dispositivos de soporte de carga para trabajo de servicio.
4. Verifique que el tope/puntal anti-caída esté calificado para la carga real.
5. Aplique etiqueta de bloqueo al tope/puntal anti-caída identificando al trabajador.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Confirme físicamente que la masa elevada está completamente bajada hasta su tope mecánico de fondo O hay un tope mecánico anti-caída / puntal de seguridad calificado acoplado.
2. Verifique que el tope anti-caída esté calificado para la carga real (capacidad estampada ≥ peso del equipo).
3. Inspeccione visualmente el acoplamiento del tope anti-caída — sin espacio entre el soporte y la masa elevada.
4. Realice prueba de golpeo o sacudida del soporte para confirmar que está soportando la carga.
5. Confirme que el tope anti-caída tiene su propia etiqueta de bloqueo adjunta para que no pueda ser removido por nadie más que el trabajador autorizado.' where id = '8487e6d4-e285-472e-9190-68ee01901a23' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'ELÉCTRICA (E) — Alimentador volumétrico Acrison. Servicio del variador SCR 460 VAC 3Φ. Armadura del motor 90 VDC, 9–11 A (1 HP, 1,750 RPM). EL SCR RETIENE DC RESIDUAL EN LA ARMADURA DURANTE ~60 s DESPUÉS DE ABRIR EL DESCONECTADOR PRINCIPAL.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — ELÉCTRICA (alimentador Acrison controlado por SCR, USPK-930):
1. Haga funcionar la tolva hasta vaciarla si es práctico; de lo contrario, tome nota de la carga de la columna de producto.
2. DETENGA el alimentador en el panel local; ponga el variador SCR en OFF.
3. Abra el DESCONECTADOR DEL MOTORREDUCTOR en el panel del alimentador (cubre el servicio de 460 VAC y la armadura de 90 VDC). Coloque candado personal + etiqueta.
4. Abra y bloquee el desconectador del PANEL DE CONTROL.
5. ESPERE ≥60 SEGUNDOS a que se disipe el DC residual del SCR en la armadura del motor.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — ELÉCTRICA:
1. Pruebe antes de tocar en las terminales del motor.
2. VERIFIQUE que TANTO el servicio de AC COMO la armadura de DC marquen cero (el DC puede requerir >60 s después de desconectar — es obligatorio medir antes de abrir la caja de conexiones).
3. Intente arrancar en el HMI — confirme que no hay rotación del sinfín ni del agitador.' where id = 'ae66f574-6bba-45ce-99b5-94efd76779c7' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'MECÁNICA (M) — Sinfín dosificador dentro del tubo de descarga (peligro de punto de atrapamiento de entrada / amputación). Agitador acondicionador de baja velocidad en la tolva (peligro de quedar atrapado).', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — MECÁNICA (sinfín + agitador Acrison):
1. Después del aislamiento eléctrico Y de la espera para que se disipe el DC del SCR, bloquee el eje del sinfín con el PASADOR DEL EJE suministrado por el fabricante antes de retirar la guarda de descarga.
2. Para entrar a la tolva: retire con aspiradora el sazonador residual. Conecte equipotencialmente (bonding) y aterrice la tolva antes de abrirla.
3. Coloque la etiqueta de aislamiento mecánico.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — MECÁNICA:
1. PASADOR DEL EJE DEL SINFÍN colocado antes de retirar la guarda.
2. Intente arrancar el alimentador en el HMI — confirme que no hay rotación del sinfín ni movimiento del agitador.
3. Cable de unión equipotencial/aterrizaje conectado antes de entrar a la tolva.' where id = '1e4fc2f8-276b-4493-ac6b-a0c588067d28' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'NEUMÁTICA (P) — 80–100 psig (opcional) a la limpieza por pulsos del filtro de polvo del venteo del silo y a la asistencia vibratoria de la tolva.', isolation_procedure_es = 'PROCEDIMIENTO DE AISLAMIENTO — NEUMÁTICA:
1. Cierre y bloquee el suministro de aire comprimido al venteo del silo / vibrador.
2. Libere la presión aguas abajo hasta 0 psig.', method_of_verification_es = 'MÉTODO DE VERIFICACIÓN — NEUMÁTICA:
1. El manómetro neumático aguas abajo de la FRL del venteo del silo / vibrador marca 0 psig.
2. El pulso del venteo del silo y la asistencia vibratoria no se activan con el comando del HMI.' where id = '7ba1ad74-50e1-4720-80ff-c625f42d5b1f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'Este Transportador Vertical Reciprocante (VRC #4) funciona con suministro eléctrico trifásico que acciona una unidad de potencia hidráulica (HPU) con un motor eléctrico y cilindro(s) hidráulico(s) que suben y bajan la plataforma del carro entre los niveles de piso. Las fuentes de energía peligrosa incluyen: Eléctrica (E) - energía trifásica al motor de la HPU, al panel de control y a los actuadores de las puertas con interbloqueo; Hidráulica (H) - fluido hidráulico a alta presión en el cilindro, las líneas y las conexiones que impulsa la elevación vertical; Gravedad / Gravedad Controlada (CG) - la plataforma del carro con peso y cualquier carga descenderán sin control si se pierde la presión hidráulica, se rompe una línea o falla una restricción mecánica; y Mecánica (M) - existen puntos de pellizco y peligros de corte en la trayectoria del carro', isolation_procedure_es = 'Notifique a todo el personal afectado del departamento de Embarques y de las áreas de trabajo adyacentes que VRC #4 se está bloqueando para servicio. Apague el VRC usando el botón de paro de la estación de control del operador en el nivel de carga/descarga; confirme que el carro se ha detenido y está en el nivel más bajo. Localice el interruptor de desconexión eléctrica principal en el panel de control del VRC o en el gabinete del arrancador del motor; gírelo a la posición OFF (apagado). Coloque un candado personal y una etiqueta de "Peligro - No Operar" (Danger - Do Not Operate) en el desconectador. Cierre y bloquee la válvula de suministro hidráulico (si cuenta con una válvula de aislamiento aguas arriba de la HPU); coloque un dispositivo de bloqueo y una etiqueta. Purgue la presión hidráulica residual accionando la válvula manual de alivio de presión de la unidad de potencia hidráulica hasta que el manómetro marque 0 PSI.', method_of_verification_es = 'Despeje el área de todo el personal e intente arrancar el VRC presionando los botones de subida y bajada en cada estación de control de nivel para confirmar que el transportador no se energiza ni se mueve. Confirme que el manómetro de presión hidráulica de la HPU marca 0 PSI y que no hay fugas de fluido en las líneas o conexiones. Verifique que la plataforma del carro esté inmóvil - si la plataforma está elevada, confirme que el bloque o puntal mecánico de seguridad esté firmemente colocado y soportando la carga. Realice una "prueba de jalón" en todos los candados para asegurar que estén completamente cerrados y no se puedan zafar. Use un probador de voltaje calibrado (clasificación CAT III) para confirmar 0 volts en las terminales del motor y en el bus principal del panel de control. Una vez confirmado el estado de energía cero verificado, regrese todos los interruptores de contr' where id = '497f2aa2-9137-4ec4-8718-d242cf0b24d2' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'Este Transportador Vertical Reciprocante (VRC #4) funciona con suministro eléctrico trifásico que acciona una unidad de potencia hidráulica (HPU) con un motor eléctrico y cilindro(s) hidráulico(s) que suben y bajan la plataforma del carro entre los niveles de piso. Las fuentes de energía peligrosa incluyen: Eléctrica (E) - energía trifásica al motor de la HPU, al panel de control y a los actuadores de las puertas con interbloqueo; Hidráulica (H) - fluido hidráulico a alta presión en el cilindro, las líneas y las conexiones que impulsa la elevación vertical; Gravedad / Gravedad Controlada (CG) - la plataforma del carro con peso y cualquier carga descenderán sin control si se pierde la presión hidráulica, se rompe una línea o falla una restricción mecánica; y Mecánica (M) - existen puntos de pellizco y peligros de corte en la trayectoria del carro', isolation_procedure_es = 'Notifique a todo el personal afectado del departamento de Embarques y de las áreas de trabajo adyacentes que VRC #4 se está bloqueando para servicio. Apague el VRC usando el botón de paro de la estación de control del operador en el nivel de carga/descarga; confirme que el carro se ha detenido y está en el nivel más bajo. Localice el interruptor de desconexión eléctrica principal en el panel de control del VRC o en el gabinete del arrancador del motor; gírelo a la posición OFF (apagado). Coloque un candado personal y una etiqueta de "Peligro - No Operar" (Danger - Do Not Operate) en el desconectador. Cierre y bloquee la válvula de suministro hidráulico (si cuenta con una válvula de aislamiento aguas arriba de la HPU); coloque un dispositivo de bloqueo y una etiqueta. Purgue la presión hidráulica residual accionando la válvula manual de alivio de presión de la unidad de potencia hidráulica hasta que el manómetro marque 0 PSI.', method_of_verification_es = 'Despeje el área de todo el personal e intente arrancar el VRC presionando los botones de subida y bajada en cada estación de control de nivel para confirmar que el transportador no se energiza ni se mueve. Confirme que el manómetro de presión hidráulica de la HPU marca 0 PSI y que no hay fugas de fluido en las líneas o conexiones. Verifique que la plataforma del carro esté inmóvil - si la plataforma está elevada, confirme que el bloque o puntal mecánico de seguridad esté firmemente colocado y soportando la carga. Realice una "prueba de jalón" en todos los candados para asegurar que estén completamente cerrados y no se puedan zafar. Use un probador de voltaje calibrado (clasificación CAT III) para confirmar 0 volts en las terminales del motor y en el bus principal del panel de control. Una vez confirmado el estado de energía cero verificado, regrese todos los interruptores de contr' where id = '675b018f-fbf2-4004-996b-24e9d90389b3' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set tag_description_es = 'Este Transportador Vertical Reciprocante (VRC #4) funciona con suministro eléctrico trifásico que acciona una unidad de potencia hidráulica (HPU) con un motor eléctrico y cilindro(s) hidráulico(s) que suben y bajan la plataforma del carro entre los niveles de piso. Las fuentes de energía peligrosa incluyen: Eléctrica (E) - energía trifásica al motor de la HPU, al panel de control y a los actuadores de las puertas con interbloqueo; Hidráulica (H) - fluido hidráulico a alta presión en el cilindro, las líneas y las conexiones que impulsa la elevación vertical; Gravedad / Gravedad Controlada (CG) - la plataforma del carro con peso y cualquier carga descenderán sin control si se pierde la presión hidráulica, se rompe una línea o falla una restricción mecánica; y Mecánica (M) - existen puntos de pellizco y peligros de corte en la trayectoria del carro', isolation_procedure_es = 'Notifique a todo el personal afectado del departamento de Embarques y de las áreas de trabajo adyacentes que VRC #4 se está bloqueando para servicio. Apague el VRC usando el botón de paro de la estación de control del operador en el nivel de carga/descarga; confirme que el carro se ha detenido y está en el nivel más bajo. Localice el interruptor de desconexión eléctrica principal en el panel de control del VRC o en el gabinete del arrancador del motor; gírelo a la posición OFF (apagado). Coloque un candado personal y una etiqueta de "Peligro - No Operar" (Danger - Do Not Operate) en el desconectador. Cierre y bloquee la válvula de suministro hidráulico (si cuenta con una válvula de aislamiento aguas arriba de la HPU); coloque un dispositivo de bloqueo y una etiqueta. Purgue la presión hidráulica residual accionando la válvula manual de alivio de presión de la unidad de potencia hidráulica hasta que el manómetro marque 0 PSI.', method_of_verification_es = 'Despeje el área de todo el personal e intente arrancar el VRC presionando los botones de subida y bajada en cada estación de control de nivel para confirmar que el transportador no se energiza ni se mueve. Confirme que el manómetro de presión hidráulica de la HPU marca 0 PSI y que no hay fugas de fluido en las líneas o conexiones. Verifique que la plataforma del carro esté inmóvil - si la plataforma está elevada, confirme que el bloque o puntal mecánico de seguridad esté firmemente colocado y soportando la carga. Realice una "prueba de jalón" en todos los candados para asegurar que estén completamente cerrados y no se puedan zafar. Use un probador de voltaje calibrado (clasificación CAT III) para confirmar 0 volts en las terminales del motor y en el bus principal del panel de control. Una vez confirmado el estado de energía cero verificado, regrese todos los interruptores de contr' where id = 'b8f4cb5f-6e7a-4092-b1af-ebc93d97ed6f' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
update loto_energy_steps set energy_type = 'GR', tag_description_es = 'Este Transportador Vertical Reciprocante (VRC #4) funciona con suministro eléctrico trifásico que acciona una unidad de potencia hidráulica (HPU) con un motor eléctrico y cilindro(s) hidráulico(s) que suben y bajan la plataforma del carro entre los niveles de piso. Las fuentes de energía peligrosa incluyen: Eléctrica (E) - energía trifásica al motor de la HPU, al panel de control y a los actuadores de las puertas con interbloqueo; Hidráulica (H) - fluido hidráulico a alta presión en el cilindro, las líneas y las conexiones que impulsa la elevación vertical; Gravedad / Gravedad Controlada (CG) - la plataforma del carro con peso y cualquier carga descenderán sin control si se pierde la presión hidráulica, se rompe una línea o falla una restricción mecánica; y Mecánica (M) - existen puntos de pellizco y peligros de corte en la trayectoria del carro', isolation_procedure_es = 'Notifique a todo el personal afectado del departamento de Embarques y de las áreas de trabajo adyacentes que VRC #4 se está bloqueando para servicio. Apague el VRC usando el botón de paro de la estación de control del operador en el nivel de carga/descarga; confirme que el carro se ha detenido y está en el nivel más bajo. Localice el interruptor de desconexión eléctrica principal en el panel de control del VRC o en el gabinete del arrancador del motor; gírelo a la posición OFF (apagado). Coloque un candado personal y una etiqueta de "Peligro - No Operar" (Danger - Do Not Operate) en el desconectador. Cierre y bloquee la válvula de suministro hidráulico (si cuenta con una válvula de aislamiento aguas arriba de la HPU); coloque un dispositivo de bloqueo y una etiqueta. Purgue la presión hidráulica residual accionando la válvula manual de alivio de presión de la unidad de potencia hidráulica hasta que el manómetro marque 0 PSI.', method_of_verification_es = 'Despeje el área de todo el personal e intente arrancar el VRC presionando los botones de subida y bajada en cada estación de control de nivel para confirmar que el transportador no se energiza ni se mueve. Confirme que el manómetro de presión hidráulica de la HPU marca 0 PSI y que no hay fugas de fluido en las líneas o conexiones. Verifique que la plataforma del carro esté inmóvil - si la plataforma está elevada, confirme que el bloque o puntal mecánico de seguridad esté firmemente colocado y soportando la carga. Realice una "prueba de jalón" en todos los candados para asegurar que estén completamente cerrados y no se puedan zafar. Use un probador de voltaje calibrado (clasificación CAT III) para confirmar 0 volts en las terminales del motor y en el bus principal del panel de control. Una vez confirmado el estado de energía cero verificado, regrese todos los interruptores de contr' where id = 'ead8ea4b-0248-4da2-9275-4d6fcfef63ef' and tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('08f5ee03-9d3d-4642-9c7d-e69742c78e30', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKCC-580', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Main Oil Pump - Cheese Curl, SKCC-580):
1. Complete the E and G procedures for EVERY unit in the Cheese Curl fryer oil loop (SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the pump SUCTION valve (fryer side) and DISCHARGE valve (heat-exchanger side). Apply a valve lockout + personal padlock + tag to each. An open suction valve floods the pump with hot oil from the fryer pan. [VERIFY ON SITE: valve tags]
4. Open the pump casing / strainer drain into a metal catch container to relieve trapped oil; wait until flow stops.
5. Do not loosen flanges, the seal gland or the strainer cover until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN SOLO circuito cerrado: SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620. La tina de la freidora contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite permanece por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Bomba Principal de Aceite - Cheese Curl, SKCC-580):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite de la freidora Cheese Curl (SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SUCCIÓN de la bomba (lado de la freidora) y la válvula de DESCARGA (lado del intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Una válvula de succión abierta inunda la bomba con aceite caliente de la tina de la freidora. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el drenaje de la carcasa de la bomba / del colador hacia un recipiente metálico de recolección para liberar el aceite atrapado; espere hasta que se detenga el flujo.
5. No afloje las bridas, el prensaestopas del sello ni la tapa del colador hasta que se cumpla la verificación de abajo.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde la HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('a20320fd-0144-43f1-9367-a1ed53aa95cd', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKCC-610', 2, 5, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Fryer - Cheese Curl, SKCC-610):
1. Complete the E and G procedures for EVERY unit in the Cheese Curl fryer oil loop (SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the fryer oil OUTLET valve (to main-oil-pump suction) and oil RETURN valve (from the heat exchanger). Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. If the work opens the pan, the drain or any oil-side piping: drain the pan to the oil holding tank through the fryer drain valve, then close and lock the drain valve. [VERIFY ON SITE: drain destination]
5. Before breaking any oil-side connection, slowly open the low-point bleed between the locked valves into a metal catch pan. Stand out of the line of fire.
6. Do not touch oil, pan, conveyor or oil piping until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN SOLO circuito cerrado: SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620. La tina de la freidora contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite permanece por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Freidora - Cheese Curl, SKCC-610):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite de la freidora Cheese Curl (SKCC-580, SKCC-590, SKCC-600, SKCC-610, SKCC-620) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SALIDA de aceite de la freidora (hacia la succión de la bomba principal de aceite) y la válvula de RETORNO de aceite (desde el intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Si el trabajo abre la tina, el drenaje o cualquier tubería del lado del aceite: drene la tina al tanque de almacenamiento de aceite a través de la válvula de drenaje de la freidora; luego cierre y bloquee la válvula de drenaje. [VERIFICAR EN SITIO: destino del drenaje]
5. Antes de abrir cualquier conexión del lado del aceite, abra lentamente la purga del punto bajo entre las válvulas bloqueadas hacia una charola metálica de recolección. Manténgase fuera de la línea de fuego.
6. No toque el aceite, la tina, el transportador ni la tubería de aceite hasta que se cumpla la verificación de abajo.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde la HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('a333d263-fb34-4cfe-af2f-4b0ffb2aa281', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT1-550', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT1-540, SKT1-550, SKT1-560, SKT1-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Fryer - Tortilla TC 1, SKT1-550):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 1 fryer oil loop (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the fryer oil OUTLET valve (to main-oil-pump suction) and oil RETURN valve (from the heat exchanger). Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. If the work opens the pan, the drain or any oil-side piping: drain the pan to the oil holding tank through the fryer drain valve, then close and lock the drain valve. [VERIFY ON SITE: drain destination]
5. Before breaking any oil-side connection, slowly open the low-point bleed between the locked valves into a metal catch pan. Stand out of the line of fire.
6. Do not touch oil, pan, conveyor or oil piping until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT1-540, SKT1-550, SKT1-560, SKT1-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Freidor - Tortilla TC 1, SKT1-550):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 1 (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SALIDA de aceite del freidor (hacia la succión de la bomba principal de aceite) y la válvula de RETORNO de aceite (desde el intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Si el trabajo abre la tina, el drenaje o cualquier tubería del lado del aceite: drene la tina al tanque de almacenamiento de aceite a través de la válvula de drenaje del freidor; luego cierre y bloquee la válvula de drenaje. [VERIFICAR EN SITIO: destino del drenaje]
5. Antes de abrir cualquier conexión del lado del aceite, abra lentamente la purga del punto bajo entre las válvulas bloqueadas hacia una charola metálica de captación. Manténgase fuera de la línea de fuego.
6. No toque el aceite, la tina, el transportador ni la tubería de aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('96927d12-8717-4bb8-8728-b91263c1ea48', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT1-570', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT1-540, SKT1-550, SKT1-560, SKT1-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Heat Exchanger - Tortilla TC 1, SKT1-570):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 1 fryer oil loop (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the heat exchanger oil-side INLET and OUTLET valves. Apply a valve lockout + personal padlock + tag to each. If the coil carries a separate thermal fluid, also lock its supply and return valves. [VERIFY ON SITE: valve tags; frying oil vs thermal fluid in the coil]
4. Open the low-point bleed/drain between the locked valves into a metal catch container; wait until flow stops.
5. The tube bundle, firebox and flue stay hot longer than the oil — do not open the burner housing, flue or oil-side connections until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT1-540, SKT1-550, SKT1-560, SKT1-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Intercambiador de Calor - Tortilla TC 1, SKT1-570):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 1 (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA del lado del aceite del intercambiador de calor. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Si el serpentín lleva un fluido térmico separado, bloquee también sus válvulas de suministro y retorno. [VERIFICAR EN SITIO: etiquetas de las válvulas; aceite de freír vs. fluido térmico en el serpentín]
4. Abra la purga/drenaje del punto bajo entre las válvulas bloqueadas hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El haz de tubos, la cámara de combustión y la chimenea permanecen calientes más tiempo que el aceite — no abra la carcasa del quemador, la chimenea ni las conexiones del lado del aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('68a6d894-d03d-404d-89dd-021060d2b1a4', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-580', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT2-580, SKT2-590, SKT2-600, SKT2-610. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Main Oil Pump - Tortilla TC 2, SKT2-580):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 2 fryer oil loop (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the pump SUCTION valve (fryer side) and DISCHARGE valve (heat-exchanger side). Apply a valve lockout + personal padlock + tag to each. An open suction valve floods the pump with hot oil from the fryer pan. [VERIFY ON SITE: valve tags]
4. Open the pump casing / strainer drain into a metal catch container to relieve trapped oil; wait until flow stops.
5. Do not loosen flanges, the seal gland or the strainer cover until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT2-580, SKT2-590, SKT2-600, SKT2-610. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Bomba Principal de Aceite - Tortilla TC 2, SKT2-580):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 2 (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SUCCIÓN de la bomba (lado del freidor) y la válvula de DESCARGA (lado del intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Una válvula de succión abierta inunda la bomba con aceite caliente de la tina del freidor. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el drenaje de la carcasa de la bomba / del colador hacia un recipiente metálico de captación para liberar el aceite atrapado; espere hasta que deje de fluir.
5. No afloje las bridas, el prensaestopas del sello ni la tapa del colador hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('0e378944-cfe7-4bba-a2af-12b39298ecdd', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-590', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT2-580, SKT2-590, SKT2-600, SKT2-610. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Fryer - Tortilla TC 2, SKT2-590):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 2 fryer oil loop (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the fryer oil OUTLET valve (to main-oil-pump suction) and oil RETURN valve (from the heat exchanger). Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. If the work opens the pan, the drain or any oil-side piping: drain the pan to the oil holding tank through the fryer drain valve, then close and lock the drain valve. [VERIFY ON SITE: drain destination]
5. Before breaking any oil-side connection, slowly open the low-point bleed between the locked valves into a metal catch pan. Stand out of the line of fire.
6. Do not touch oil, pan, conveyor or oil piping until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT2-580, SKT2-590, SKT2-600, SKT2-610. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Freidor - Tortilla TC 2, SKT2-590):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 2 (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SALIDA de aceite del freidor (hacia la succión de la bomba principal de aceite) y la válvula de RETORNO de aceite (desde el intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Si el trabajo abre la tina, el drenaje o cualquier tubería del lado del aceite: drene la tina al tanque de almacenamiento de aceite a través de la válvula de drenaje del freidor; luego cierre y bloquee la válvula de drenaje. [VERIFICAR EN SITIO: destino del drenaje]
5. Antes de abrir cualquier conexión del lado del aceite, abra lentamente la purga del punto bajo entre las válvulas bloqueadas hacia una charola metálica de captación. Manténgase fuera de la línea de fuego.
6. No toque el aceite, la tina, el transportador ni la tubería de aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('271ad49a-0c81-4b10-b312-82f7df46991b', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-600', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT2-580, SKT2-590, SKT2-600, SKT2-610. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Fryer Filter - Tortilla TC 2, SKT2-600):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 2 fryer oil loop (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the filter INLET and OUTLET (return) valves. Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. Open the filter housing vent, then the housing drain into a metal catch container; wait until flow stops.
5. Filter media, belt and sludge are as hot as the oil — do not open the housing or handle media until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT2-580, SKT2-590, SKT2-600, SKT2-610. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Filtro del Freidor - Tortilla TC 2, SKT2-600):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 2 (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA (retorno) del filtro. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el venteo de la carcasa del filtro y luego el drenaje de la carcasa hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El medio filtrante, la banda y los lodos están tan calientes como el aceite — no abra la carcasa ni manipule el medio filtrante hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('b6887c04-3d15-4fa4-98a6-9d19cf9a4ec9', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-610', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT2-580, SKT2-590, SKT2-600, SKT2-610. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Heat Exchanger - Tortilla TC 2, SKT2-610):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 2 fryer oil loop (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the heat exchanger oil-side INLET and OUTLET valves. Apply a valve lockout + personal padlock + tag to each. If the coil carries a separate thermal fluid, also lock its supply and return valves. [VERIFY ON SITE: valve tags; frying oil vs thermal fluid in the coil]
4. Open the low-point bleed/drain between the locked valves into a metal catch container; wait until flow stops.
5. The tube bundle, firebox and flue stay hot longer than the oil — do not open the burner housing, flue or oil-side connections until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT2-580, SKT2-590, SKT2-600, SKT2-610. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Intercambiador de Calor - Tortilla TC 2, SKT2-610):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 2 (SKT2-580, SKT2-590, SKT2-600, SKT2-610) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA del lado del aceite del intercambiador de calor. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Si el serpentín lleva un fluido térmico separado, bloquee también sus válvulas de suministro y retorno. [VERIFICAR EN SITIO: etiquetas de las válvulas; aceite de freír vs. fluido térmico en el serpentín]
4. Abra la purga/drenaje del punto bajo entre las válvulas bloqueadas hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El haz de tubos, la cámara de combustión y la chimenea permanecen calientes más tiempo que el aceite — no abra la carcasa del quemador, la chimenea ni las conexiones del lado del aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('3e5ed468-0317-4651-b255-db67620d4719', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'USGN-350', 3, 3, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: USGN-350, USGN-500, USGN-520, USGN-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (MAIN OIL PUMP - USDA Process, USGN-350):
1. Complete the E and G procedures for EVERY unit in the USDA Process fryer oil loop (USGN-350, USGN-500, USGN-520, USGN-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the pump SUCTION valve (fryer side) and DISCHARGE valve (heat-exchanger side). Apply a valve lockout + personal padlock + tag to each. An open suction valve floods the pump with hot oil from the fryer pan. [VERIFY ON SITE: valve tags]
4. Open the pump casing / strainer drain into a metal catch container to relieve trapped oil; wait until flow stops.
5. Do not loosen flanges, the seal gland or the strainer cover until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: USGN-350, USGN-500, USGN-520, USGN-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (BOMBA PRINCIPAL DE ACEITE - Proceso USDA, USGN-350):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Proceso USDA (USGN-350, USGN-500, USGN-520, USGN-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SUCCIÓN de la bomba (lado del freidor) y la válvula de DESCARGA (lado del intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Una válvula de succión abierta inunda la bomba con aceite caliente de la tina del freidor. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el drenaje de la carcasa de la bomba / del colador hacia un recipiente metálico de captación para liberar el aceite atrapado; espere hasta que deje de fluir.
5. No afloje las bridas, el prensaestopas del sello ni la tapa del colador hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('6f57d5c2-d441-43c7-abdd-1a5fd1caf4a8', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'USGN-500', 4, 4, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: USGN-350, USGN-500, USGN-520, USGN-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (FRYER - USDA Process, USGN-500):
1. Complete the E and G procedures for EVERY unit in the USDA Process fryer oil loop (USGN-350, USGN-500, USGN-520, USGN-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the fryer oil OUTLET valve (to main-oil-pump suction) and oil RETURN valve (from the heat exchanger). Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. If the work opens the pan, the drain or any oil-side piping: drain the pan to the oil holding tank through the fryer drain valve, then close and lock the drain valve. [VERIFY ON SITE: drain destination]
5. Before breaking any oil-side connection, slowly open the low-point bleed between the locked valves into a metal catch pan. Stand out of the line of fire.
6. Do not touch oil, pan, conveyor or oil piping until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: USGN-350, USGN-500, USGN-520, USGN-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (FREIDOR - Proceso USDA, USGN-500):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Proceso USDA (USGN-350, USGN-500, USGN-520, USGN-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SALIDA de aceite del freidor (hacia la succión de la bomba principal de aceite) y la válvula de RETORNO de aceite (desde el intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Si el trabajo abre la tina, el drenaje o cualquier tubería del lado del aceite: drene la tina al tanque de almacenamiento de aceite a través de la válvula de drenaje del freidor; luego cierre y bloquee la válvula de drenaje. [VERIFICAR EN SITIO: destino del drenaje]
5. Antes de abrir cualquier conexión del lado del aceite, abra lentamente la purga del punto bajo entre las válvulas bloqueadas hacia una charola metálica de captación. Manténgase fuera de la línea de fuego.
6. No toque el aceite, la tina, el transportador ni la tubería de aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('57fae132-44ff-4811-8efc-349058fe8c03', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'USGN-520', 3, 3, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: USGN-350, USGN-500, USGN-520, USGN-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (FRYER FINE FILTER - USDA Process, USGN-520):
1. Complete the E and G procedures for EVERY unit in the USDA Process fryer oil loop (USGN-350, USGN-500, USGN-520, USGN-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the filter INLET and OUTLET (return) valves. Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. Open the filter housing vent, then the housing drain into a metal catch container; wait until flow stops.
5. Filter media, belt and sludge are as hot as the oil — do not open the housing or handle media until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: USGN-350, USGN-500, USGN-520, USGN-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (FILTRO FINO DEL FREIDOR - Proceso USDA, USGN-520):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Proceso USDA (USGN-350, USGN-500, USGN-520, USGN-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA (retorno) del filtro. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el venteo de la carcasa del filtro y luego el drenaje de la carcasa hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El medio filtrante, la banda y los lodos están tan calientes como el aceite — no abra la carcasa ni manipule el medio filtrante hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('5a24712e-9950-4600-b89c-3825e6c0a2b2', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'USGN-570', 3, 3, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: USGN-350, USGN-500, USGN-520, USGN-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (HEAT EXCHANGER - USDA Process, USGN-570):
1. Complete the E and G procedures for EVERY unit in the USDA Process fryer oil loop (USGN-350, USGN-500, USGN-520, USGN-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the heat exchanger oil-side INLET and OUTLET valves. Apply a valve lockout + personal padlock + tag to each. If the coil carries a separate thermal fluid, also lock its supply and return valves. [VERIFY ON SITE: valve tags; frying oil vs thermal fluid in the coil]
4. Open the low-point bleed/drain between the locked valves into a metal catch container; wait until flow stops.
5. The tube bundle, firebox and flue stay hot longer than the oil — do not open the burner housing, flue or oil-side connections until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: USGN-350, USGN-500, USGN-520, USGN-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (INTERCAMBIADOR DE CALOR - Proceso USDA, USGN-570):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Proceso USDA (USGN-350, USGN-500, USGN-520, USGN-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA del lado del aceite del intercambiador de calor. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Si el serpentín lleva un fluido térmico separado, bloquee también sus válvulas de suministro y retorno. [VERIFICAR EN SITIO: etiquetas de las válvulas; aceite de freír vs. fluido térmico en el serpentín]
4. Abra la purga/drenaje del punto bajo entre las válvulas bloqueadas hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El haz de tubos, la cámara de combustión y la chimenea permanecen calientes más tiempo que el aceite — no abra la carcasa del quemador, la chimenea ni las conexiones del lado del aceite hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('833182ca-5f56-4282-8769-fbc9c63972a9', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT1-540', 13, 13, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT1-540, SKT1-550, SKT1-560, SKT1-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Main Oil Pump - Tortilla TC 1, SKT1-540):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 1 fryer oil loop (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the pump SUCTION valve (fryer side) and DISCHARGE valve (heat-exchanger side). Apply a valve lockout + personal padlock + tag to each. An open suction valve floods the pump with hot oil from the fryer pan. [VERIFY ON SITE: valve tags]
4. Open the pump casing / strainer drain into a metal catch container to relieve trapped oil; wait until flow stops.
5. Do not loosen flanges, the seal gland or the strainer cover until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT1-540, SKT1-550, SKT1-560, SKT1-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Bomba Principal de Aceite - Tortilla TC 1, SKT1-540):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 1 (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre la válvula de SUCCIÓN de la bomba (lado del freidor) y la válvula de DESCARGA (lado del intercambiador de calor). Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. Una válvula de succión abierta inunda la bomba con aceite caliente de la tina del freidor. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el drenaje de la carcasa de la bomba / del colador hacia un recipiente metálico de captación para liberar el aceite atrapado; espere hasta que deje de fluir.
5. No afloje las bridas, el prensaestopas del sello ni la tapa del colador hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('90be0b43-d188-4318-91a8-c2b5cc831be9', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT1-560', 13, 13, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL / HOT OIL (T) — Frying oil at 350 °F+ circulates in ONE closed loop: SKT1-540, SKT1-550, SKT1-560, SKT1-570. The fryer pan holds a large oil volume ABOVE the pump, filter and heat exchanger — opening any loop component with its valves open releases hot oil by gravity and residual pump pressure. Oil stays above 200 °F for hours after the heat source is locked out.', 'ISOLATION PROCEDURE — THERMAL / HOT OIL (Fryer Filter - Tortilla TC 1, SKT1-560):
1. Complete the E and G procedures for EVERY unit in the Tortilla TC 1 fryer oil loop (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — heat source and all oil pumps locked out.
2. Allow the oil to cool with the fire-suppression system left ARMED. Do NOT drain oil hotter than 250 °F (121 °C).
3. Close the filter INLET and OUTLET (return) valves. Apply a valve lockout + personal padlock + tag to each. [VERIFY ON SITE: valve tags]
4. Open the filter housing vent, then the housing drain into a metal catch container; wait until flow stops.
5. Filter media, belt and sludge are as hot as the oil — do not open the housing or handle media until the verification below passes.', 'METHOD OF VERIFICATION — THERMAL / HOT OIL:
1. Oil and surface temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Each oil-loop valve listed above is closed, locked and tagged.
3. Bleed/drain point open with no flow — no trapped pressure and no gravity feed.
4. Attempt to start the main oil pump from the HMI — confirm no flow and the oil-pressure gauge stays at 0.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA / ACEITE CALIENTE (T) — El aceite de freír a 350 °F+ circula en UN solo circuito cerrado: SKT1-540, SKT1-550, SKT1-560, SKT1-570. La tina del freidor contiene un gran volumen de aceite POR ENCIMA de la bomba, el filtro y el intercambiador de calor — abrir cualquier componente del circuito con sus válvulas abiertas libera aceite caliente por gravedad y por la presión residual de la bomba. El aceite se mantiene por encima de 200 °F durante horas después de bloquear la fuente de calor.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA / ACEITE CALIENTE (Filtro del Freidor - Tortilla TC 1, SKT1-560):
1. Complete los procedimientos E y G para CADA unidad del circuito de aceite del freidor de Tortilla TC 1 (SKT1-540, SKT1-550, SKT1-560, SKT1-570) — fuente de calor y todas las bombas de aceite bloqueadas.
2. Deje enfriar el aceite con el sistema de supresión de incendios ARMADO. NO drene aceite a más de 250 °F (121 °C).
3. Cierre las válvulas de ENTRADA y SALIDA (retorno) del filtro. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta en cada una. [VERIFICAR EN SITIO: etiquetas de las válvulas]
4. Abra el venteo de la carcasa del filtro y luego el drenaje de la carcasa hacia un recipiente metálico de captación; espere hasta que deje de fluir.
5. El medio filtrante, la banda y los lodos están tan calientes como el aceite — no abra la carcasa ni manipule el medio filtrante hasta que la verificación de abajo resulte satisfactoria.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA / ACEITE CALIENTE:
1. Temperatura del aceite y de la superficie igual o menor a 140 °F (60 °C) [VERIFICAR EN SITIO: umbral de contacto seguro de la planta], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan menos de lo real en acero inoxidable brillante y en superficies de aceite.
2. Cada válvula del circuito de aceite indicada arriba está cerrada, bloqueada y etiquetada.
3. Punto de purga/drenaje abierto sin flujo — sin presión atrapada y sin alimentación por gravedad.
4. Intente arrancar la bomba principal de aceite desde el HMI — confirme que no hay flujo y que el manómetro de presión de aceite se mantiene en 0.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('803eb497-36e3-4b66-b7e8-f610cc327b53', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT1-550', 2, 2, 'isolate', 'GR', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Fryer hood and takeout/submerger conveyor raised by the hood hoist. A raised hood is a suspended load; locking the hoist motor does not hold it up.', 'ISOLATION PROCEDURE — GRAVITY (fryer hood, SKT1-550):
1. If the work needs the hood raised, raise it with the hoist to service height BEFORE electrical lockout.
2. Install the hood mechanical safety supports / lock pins at EVERY lift point. Tag each support. [VERIFY ON SITE: support device and number of lift points]
3. Then lock the hoist motor disconnect per the E procedure.
4. Never place any part of the body under a hood held only by the hoist, screw jacks or chains.', 'METHOD OF VERIFICATION — GRAVITY:
1. A safety support is engaged and bearing at every lift point.
2. Attempt hood UP/DOWN at the hoist control — confirm no movement.
3. Each support carries a lockout tag.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Campana del freidor y transportador de extracción/sumergidor levantados por el polipasto de la campana. Una campana levantada es una carga suspendida; bloquear el motor del polipasto no la sostiene.', 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD (campana del freidor, SKT1-550):
1. Si el trabajo requiere la campana levantada, levántela con el polipasto a la altura de servicio ANTES del bloqueo eléctrico.
2. Instale los soportes mecánicos de seguridad / pasadores de bloqueo de la campana en CADA punto de levantamiento. Etiquete cada soporte. [VERIFICAR EN SITIO: dispositivo de soporte y número de puntos de levantamiento]
3. Luego bloquee el desconectador del motor del polipasto según el procedimiento E.
4. Nunca coloque ninguna parte del cuerpo debajo de una campana sostenida solo por el polipasto, gatos de tornillo o cadenas.', 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Hay un soporte de seguridad colocado y cargando el peso en cada punto de levantamiento.
2. Intente SUBIR/BAJAR (UP/DOWN) la campana desde el control del polipasto — confirme que no hay movimiento.
3. Cada soporte tiene una etiqueta de bloqueo.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('0476a2e6-3580-45d4-adcb-e2d49a6eadff', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-590', 2, 2, 'isolate', 'GR', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Fryer hood and takeout/submerger conveyor raised by the hood hoist. A raised hood is a suspended load; locking the hoist motor does not hold it up.', 'ISOLATION PROCEDURE — GRAVITY (fryer hood, SKT2-590):
1. If the work needs the hood raised, raise it with the hoist to service height BEFORE electrical lockout.
2. Install the hood mechanical safety supports / lock pins at EVERY lift point. Tag each support. [VERIFY ON SITE: support device and number of lift points]
3. Then lock the hoist motor disconnect per the E procedure.
4. Never place any part of the body under a hood held only by the hoist, screw jacks or chains.', 'METHOD OF VERIFICATION — GRAVITY:
1. A safety support is engaged and bearing at every lift point.
2. Attempt hood UP/DOWN at the hoist control — confirm no movement.
3. Each support carries a lockout tag.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Campana del freidor y transportador de extracción/sumergidor levantados por el polipasto de la campana. Una campana levantada es una carga suspendida; bloquear el motor del polipasto no la sostiene.', 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD (campana del freidor, SKT2-590):
1. Si el trabajo requiere la campana levantada, levántela con el polipasto a la altura de servicio ANTES del bloqueo eléctrico.
2. Instale los soportes mecánicos de seguridad / pasadores de bloqueo de la campana en CADA punto de levantamiento. Etiquete cada soporte. [VERIFICAR EN SITIO: dispositivo de soporte y número de puntos de levantamiento]
3. Luego bloquee el desconectador del motor del polipasto según el procedimiento E.
4. Nunca coloque ninguna parte del cuerpo debajo de una campana sostenida solo por el polipasto, gatos de tornillo o cadenas.', 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Hay un soporte de seguridad colocado y cargando el peso en cada punto de levantamiento.
2. Intente SUBIR/BAJAR (UP/DOWN) la campana desde el control del polipasto — confirme que no hay movimiento.
3. Cada soporte tiene una etiqueta de bloqueo.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('fc109f37-aede-458c-959f-b2296b88f131', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'USGN-500', 4, 4, 'isolate', 'GR', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Fryer hood and takeout/submerger conveyor raised by the hood hoist. A raised hood is a suspended load; locking the hoist motor does not hold it up.', 'ISOLATION PROCEDURE — GRAVITY (fryer hood, USGN-500):
1. If the work needs the hood raised, raise it with the hoist to service height BEFORE electrical lockout.
2. Install the hood mechanical safety supports / lock pins at EVERY lift point. Tag each support. [VERIFY ON SITE: support device and number of lift points]
3. Then lock the hoist motor disconnect per the E procedure.
4. Never place any part of the body under a hood held only by the hoist, screw jacks or chains.', 'METHOD OF VERIFICATION — GRAVITY:
1. A safety support is engaged and bearing at every lift point.
2. Attempt hood UP/DOWN at the hoist control — confirm no movement.
3. Each support carries a lockout tag.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Campana del freidor y transportador de extracción/sumergidor levantados por el polipasto de la campana. Una campana levantada es una carga suspendida; bloquear el motor del polipasto no la sostiene.', 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD (campana del freidor, USGN-500):
1. Si el trabajo requiere la campana levantada, levántela con el polipasto a la altura de servicio ANTES del bloqueo eléctrico.
2. Instale los soportes mecánicos de seguridad / pasadores de bloqueo de la campana en CADA punto de levantamiento. Etiquete cada soporte. [VERIFICAR EN SITIO: dispositivo de soporte y número de puntos de levantamiento]
3. Luego bloquee el desconectador del motor del polipasto según el procedimiento E.
4. Nunca coloque ninguna parte del cuerpo debajo de una campana sostenida solo por el polipasto, gatos de tornillo o cadenas.', 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Hay un soporte de seguridad colocado y cargando el peso en cada punto de levantamiento.
2. Intente SUBIR/BAJAR (UP/DOWN) la campana desde el control del polipasto — confirme que no hay movimiento.
3. Cada soporte tiene una etiqueta de bloqueo.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('bab1a1ae-da59-49de-b4ad-287bd6f8108e', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKCC-610', 2, 5, 'isolate', 'GR', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — GR:

GRAVITY (GR) — Fryer hood and takeout/submerger conveyor raised by the hood hoist. A raised hood is a suspended load; locking the hoist motor does not hold it up.', 'ISOLATION PROCEDURE — GRAVITY (fryer hood, SKCC-610):
1. If the work needs the hood raised, raise it with the hoist to service height BEFORE electrical lockout.
2. Install the hood mechanical safety supports / lock pins at EVERY lift point. Tag each support. [VERIFY ON SITE: support device and number of lift points]
3. Then lock the hoist motor disconnect per the E procedure.
4. Never place any part of the body under a hood held only by the hoist, screw jacks or chains.', 'METHOD OF VERIFICATION — GRAVITY:
1. A safety support is engaged and bearing at every lift point.
2. Attempt hood UP/DOWN at the hoist control — confirm no movement.
3. Each support carries a lockout tag.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — GR:

GRAVEDAD (GR) — Campana de la freidora y transportador de salida/sumergidor elevados por el polipasto de la campana. Una campana elevada es una carga suspendida; bloquear el motor del polipasto no la sostiene.', 'PROCEDIMIENTO DE AISLAMIENTO — GRAVEDAD (campana de la freidora, SKCC-610):
1. Si el trabajo requiere la campana elevada, súbala con el polipasto a la altura de servicio ANTES del bloqueo eléctrico.
2. Instale los soportes mecánicos de seguridad / pasadores de seguro de la campana en CADA punto de elevación. Etiquete cada soporte. [VERIFICAR EN SITIO: dispositivo de soporte y número de puntos de elevación]
3. Luego bloquee el desconectador del motor del polipasto según el procedimiento E.
4. Nunca coloque ninguna parte del cuerpo debajo de una campana sostenida solo por el polipasto, gatos de tornillo o cadenas.', 'MÉTODO DE VERIFICACIÓN — GRAVEDAD:
1. Hay un soporte de seguridad colocado y soportando la carga en cada punto de elevación.
2. Intente SUBIR/BAJAR la campana desde el control del polipasto — confirme que no hay movimiento.
3. Cada soporte tiene una etiqueta de bloqueo.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('5d5944d9-dfc2-4e0b-af5e-aea1d34572e5', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'SKT2-610', 2, 2, 'isolate', 'G', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — G:

GAS (G) — Natural-gas supply to the TC2 heat-exchanger burner. The manual upstream gas valve is the LOTO point — NOT the automatic safety shut-off valve (SSOV). [VERIFY ON SITE: confirm the heat source is a gas burner; if thermal fluid or steam, recode this step]', 'ISOLATION PROCEDURE — GAS (Heat Exchanger, SKT2-610):
1. Shut the burner down normally at its control and let post-purge complete.
2. Close the MANUAL gas-shutoff valve upstream of the SKT2-610 burner train (handle perpendicular to pipe). [VERIFY ON SITE: valve tag]
3. Apply a valve lockout + personal padlock + tag.
4. Bleed gas between the locked valve and the burner through the test port with a hose vented to a safe outdoor location; no ignition sources nearby.', 'METHOD OF VERIFICATION — GAS:
1. Manual gas valve closed, locked and tagged.
2. Manometer at the downstream test port reads 0.
3. Combustible-gas indicator at the test port and burner area reads 0 % LEL.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — G:

GAS (G) — Suministro de gas natural al quemador del intercambiador de calor de TC2. La válvula manual de gas aguas arriba es el punto de LOTO — NO la válvula automática de cierre de seguridad (SSOV). [VERIFICAR EN SITIO: confirme que la fuente de calor es un quemador de gas; si es fluido térmico o vapor, recodifique este paso]', 'PROCEDIMIENTO DE AISLAMIENTO — GAS (Intercambiador de Calor, SKT2-610):
1. Apague el quemador normalmente desde su control y deje que termine la post-purga.
2. Cierre la válvula MANUAL de cierre de gas aguas arriba del tren de quemador de SKT2-610 (manija perpendicular a la tubería). [VERIFICAR EN SITIO: etiqueta de la válvula]
3. Coloque un dispositivo de bloqueo de válvula + candado personal + etiqueta.
4. Purgue el gas entre la válvula bloqueada y el quemador a través del puerto de prueba con una manguera ventilada hacia un lugar seguro al exterior; sin fuentes de ignición cerca.', 'MÉTODO DE VERIFICACIÓN — GAS:
1. Válvula manual de gas cerrada, bloqueada y etiquetada.
2. El manómetro en el puerto de prueba aguas abajo marca 0.
3. El detector de gas combustible en el puerto de prueba y en el área del quemador marca 0 % LEL.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('5fca252c-6b06-43dc-93fd-7c1fa9445eea', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-011', 2, 2, 'isolate', 'S', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — S:

STEAM (S) — Saturated steam from Boiler #1 (BGGN-011) to the plant steam header shared with BGGN-012 and BGGN-013. The header stays live from the other boilers — shutting this burner off does NOT remove steam pressure. Required for any work on pressure parts, steam/blowdown piping, or internal entry. [VERIFY ON SITE: operating psig / MAWP]', 'ISOLATION PROCEDURE — STEAM (Boiler #1 (BGGN-011)):
1. Complete the E and G procedures for BGGN-011 first (burner off, fuel locked).
2. Close the boiler MAIN STEAM STOP valve AND the second stop / non-return valve between this boiler and the common header. Apply a valve lockout (wheel cover or chain-and-lock) + personal padlock + tag to EACH. [VERIFY ON SITE: valve tags]
3. Open the free-blow drain between the two closed stop valves and leave it open (double block and bleed). [VERIFY ON SITE: drain valve]
4. Close and lock the surface (continuous) blowdown and bottom blowdown valves. If the blowdown line is shared with the other boilers, lock the shared-line valve too. [VERIFY ON SITE]
5. Open the boiler top vent to atmosphere and let pressure fall to 0 psig. Open the vent BEFORE any draining so the boiler cannot pull a vacuum.
6. For internal entry (manway/handhole): permit-required confined space — steps 2–4, the W step and the T step must all be complete.', 'METHOD OF VERIFICATION — STEAM:
1. Boiler steam pressure gauge reads 0 psig and the top vent is open with no steam discharge.
2. Bleed between the two stop valves is open with no steam or condensate flow (proves the header-side valve is holding).
3. Each steam stop and blowdown valve physically closed, locked and tagged.
4. Do not open any manway, handhole or flange until the gauge reads 0 psig AND the T step is verified.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — S:

VAPOR (S) — Vapor saturado de la Caldera #1 (BGGN-011) al cabezal de vapor de la planta, compartido con BGGN-012 y BGGN-013. El cabezal permanece energizado por las otras calderas — apagar este quemador NO elimina la presión de vapor. Requerido para cualquier trabajo en partes a presión, tubería de vapor/purga, o entrada al interior. [VERIFICAR EN SITIO: psig de operación / MAWP]', 'PROCEDIMIENTO DE AISLAMIENTO — VAPOR (Caldera #1 (BGGN-011)):
1. Primero complete los procedimientos E y G para BGGN-011 (quemador apagado, combustible bloqueado).
2. Cierre la válvula de CIERRE PRINCIPAL DE VAPOR de la caldera Y la segunda válvula de cierre / antirretorno entre esta caldera y el cabezal común. Coloque un dispositivo de bloqueo de válvula (cubierta de volante o cadena y candado) + candado personal + etiqueta en CADA UNA. [VERIFICAR EN SITIO: etiquetas de las válvulas]
3. Abra el drenaje libre a la atmósfera entre las dos válvulas de cierre cerradas y déjelo abierto (doble bloqueo y purga). [VERIFICAR EN SITIO: válvula de drenaje]
4. Cierre y bloquee las válvulas de purga de superficie (continua) y de purga de fondo. Si la línea de purga es compartida con las otras calderas, bloquee también la válvula de la línea compartida. [VERIFICAR EN SITIO]
5. Abra el venteo superior de la caldera a la atmósfera y deje que la presión baje a 0 psig. Abra el venteo ANTES de cualquier drenado para que la caldera no pueda hacer vacío.
6. Para entrada al interior (registro de hombre/registro de mano): espacio confinado que requiere permiso — los pasos 2–4, el paso W y el paso T deben estar todos completos.', 'MÉTODO DE VERIFICACIÓN — VAPOR:
1. El manómetro de presión de vapor de la caldera marca 0 psig y el venteo superior está abierto sin descarga de vapor.
2. La purga entre las dos válvulas de cierre está abierta sin flujo de vapor ni de condensado (comprueba que la válvula del lado del cabezal está sellando).
3. Cada válvula de cierre de vapor y de purga físicamente cerrada, bloqueada y etiquetada.
4. No abra ningún registro de hombre, registro de mano ni brida hasta que el manómetro marque 0 psig Y el paso T esté verificado.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('c64d556e-f483-4117-aea9-0a0d9ad5b12b', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-011', 2, 2, 'isolate', 'W', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — W:

WATER (W) — Feedwater pump, makeup and chemical-feed lines to Boiler #1 (BGGN-011). Feedwater is pumped above boiler pressure and is hot from the feed/deaerator tank. [VERIFY ON SITE: feedwater temperature; whether the feed pump is shared]', 'ISOLATION PROCEDURE — WATER (Boiler #1 (BGGN-011)):
1. If the feedwater pump is dedicated to this boiler, lock its disconnect per the E procedure. If it is shared, do NOT rely on it — lock the valves below.
2. Close and lock the feedwater stop valve to BGGN-011. [VERIFY ON SITE: valve tag]
3. Close and lock the chemical-feed injection valve and any makeup/bypass valve to this boiler.
4. Open the drain between the feedwater stop valve and the boiler check valve to relieve pressure; wait until flow stops.', 'METHOD OF VERIFICATION — WATER:
1. Feedwater line gauge downstream of the locked valve reads 0 psig; drain open with no flow.
2. Attempt a level-control feed call — the gauge glass level does not rise.
3. Each feedwater and chemical-feed valve closed, locked and tagged.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — W:

AGUA (W) — Bomba de agua de alimentación, líneas de reposición y de alimentación de químicos a la Caldera #1 (BGGN-011). El agua de alimentación se bombea a una presión mayor que la de la caldera y viene caliente del tanque de alimentación/desaireador. [VERIFICAR EN SITIO: temperatura del agua de alimentación; si la bomba de alimentación es compartida]', 'PROCEDIMIENTO DE AISLAMIENTO — AGUA (Caldera #1 (BGGN-011)):
1. Si la bomba de agua de alimentación es exclusiva de esta caldera, bloquee su desconectador según el procedimiento E. Si es compartida, NO dependa de ella — bloquee las válvulas indicadas abajo.
2. Cierre y bloquee la válvula de cierre del agua de alimentación a BGGN-011. [VERIFICAR EN SITIO: etiqueta de la válvula]
3. Cierre y bloquee la válvula de inyección de químicos y cualquier válvula de reposición/bypass a esta caldera.
4. Abra el drenaje entre la válvula de cierre del agua de alimentación y la válvula de retención (check) de la caldera para liberar la presión; espere hasta que se detenga el flujo.', 'MÉTODO DE VERIFICACIÓN — AGUA:
1. El manómetro de la línea de agua de alimentación, aguas abajo de la válvula bloqueada, marca 0 psig; drenaje abierto sin flujo.
2. Intente una demanda de alimentación desde el control de nivel — el nivel en el visor de vidrio no sube.
3. Cada válvula de agua de alimentación y de alimentación de químicos cerrada, bloqueada y etiquetada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('739baa82-f1c3-48b8-a5a3-f00a6de4ccd8', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-011', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL (T) — Boiler water, pressure parts, refractory and flue of Boiler #1 (BGGN-011) stay above 212 °F for hours. Opening a hot boiler releases scalding water and flash steam.', 'ISOLATION PROCEDURE — THERMAL (Boiler #1 (BGGN-011)):
1. After the S and W steps, let the boiler cool naturally per the manufacturer''s cool-down rate. Do NOT force-cool with cold water.
2. Drain only after the gauge reads 0 psig, the top vent is open, and boiler water is at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold]. Drain to the blowdown separator/tank, not to an open floor drain.
3. Before fireside entry, confirm the flue/refractory has cooled and the combustion chamber is ventilated (confined-space atmospheric test).', 'METHOD OF VERIFICATION — THERMAL:
1. Shell and drain-water temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Steam gauge 0 psig and top vent open.
3. Confined-space atmospheric test recorded before any entry.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA (T) — El agua, las partes a presión, el refractario y la chimenea de la Caldera #1 (BGGN-011) permanecen por encima de 212 °F durante horas. Abrir una caldera caliente libera agua hirviendo y vapor flash.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA (Caldera #1 (BGGN-011)):
1. Después de los pasos S y W, deje que la caldera se enfríe de forma natural según la velocidad de enfriamiento del fabricante. NO la enfríe a la fuerza con agua fría.
2. Drene solo después de que el manómetro marque 0 psig, el venteo superior esté abierto y el agua de la caldera esté a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro]. Drene al separador/tanque de purga, no a una coladera abierta del piso.
3. Antes de entrar por el lado de fuego, confirme que la chimenea/refractario se ha enfriado y que la cámara de combustión está ventilada (prueba atmosférica de espacio confinado).', 'MÉTODO DE VERIFICACIÓN — TÉRMICA:
1. Temperatura de la envolvente y del agua de drenaje a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
2. Manómetro de vapor en 0 psig y venteo superior abierto.
3. Prueba atmosférica de espacio confinado registrada antes de cualquier entrada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('d97ba313-2ded-410a-a7cc-928b967b3837', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-012', 2, 2, 'isolate', 'S', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — S:

STEAM (S) — Saturated steam from Boiler #2 (BGGN-012) to the plant steam header shared with BGGN-011 and BGGN-013. The header stays live from the other boilers — shutting this burner off does NOT remove steam pressure. Required for any work on pressure parts, steam/blowdown piping, or internal entry. [VERIFY ON SITE: operating psig / MAWP]', 'ISOLATION PROCEDURE — STEAM (Boiler #2 (BGGN-012)):
1. Complete the E and G procedures for BGGN-012 first (burner off, fuel locked).
2. Close the boiler MAIN STEAM STOP valve AND the second stop / non-return valve between this boiler and the common header. Apply a valve lockout (wheel cover or chain-and-lock) + personal padlock + tag to EACH. [VERIFY ON SITE: valve tags]
3. Open the free-blow drain between the two closed stop valves and leave it open (double block and bleed). [VERIFY ON SITE: drain valve]
4. Close and lock the surface (continuous) blowdown and bottom blowdown valves. If the blowdown line is shared with the other boilers, lock the shared-line valve too. [VERIFY ON SITE]
5. Open the boiler top vent to atmosphere and let pressure fall to 0 psig. Open the vent BEFORE any draining so the boiler cannot pull a vacuum.
6. For internal entry (manway/handhole): permit-required confined space — steps 2–4, the W step and the T step must all be complete.', 'METHOD OF VERIFICATION — STEAM:
1. Boiler steam pressure gauge reads 0 psig and the top vent is open with no steam discharge.
2. Bleed between the two stop valves is open with no steam or condensate flow (proves the header-side valve is holding).
3. Each steam stop and blowdown valve physically closed, locked and tagged.
4. Do not open any manway, handhole or flange until the gauge reads 0 psig AND the T step is verified.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — S:

VAPOR (S) — Vapor saturado de la Caldera #2 (BGGN-012) al cabezal de vapor de la planta, compartido con BGGN-011 y BGGN-013. El cabezal permanece energizado por las otras calderas — apagar este quemador NO elimina la presión de vapor. Requerido para cualquier trabajo en partes a presión, tubería de vapor/purga, o entrada al interior. [VERIFICAR EN SITIO: psig de operación / MAWP]', 'PROCEDIMIENTO DE AISLAMIENTO — VAPOR (Caldera #2 (BGGN-012)):
1. Primero complete los procedimientos E y G para BGGN-012 (quemador apagado, combustible bloqueado).
2. Cierre la válvula de CIERRE PRINCIPAL DE VAPOR de la caldera Y la segunda válvula de cierre / antirretorno entre esta caldera y el cabezal común. Coloque un dispositivo de bloqueo de válvula (cubierta de volante o cadena y candado) + candado personal + etiqueta en CADA UNA. [VERIFICAR EN SITIO: etiquetas de las válvulas]
3. Abra el drenaje libre a la atmósfera entre las dos válvulas de cierre cerradas y déjelo abierto (doble bloqueo y purga). [VERIFICAR EN SITIO: válvula de drenaje]
4. Cierre y bloquee las válvulas de purga de superficie (continua) y de purga de fondo. Si la línea de purga es compartida con las otras calderas, bloquee también la válvula de la línea compartida. [VERIFICAR EN SITIO]
5. Abra el venteo superior de la caldera a la atmósfera y deje que la presión baje a 0 psig. Abra el venteo ANTES de cualquier drenado para que la caldera no pueda hacer vacío.
6. Para entrada al interior (registro de hombre/registro de mano): espacio confinado que requiere permiso — los pasos 2–4, el paso W y el paso T deben estar todos completos.', 'MÉTODO DE VERIFICACIÓN — VAPOR:
1. El manómetro de presión de vapor de la caldera marca 0 psig y el venteo superior está abierto sin descarga de vapor.
2. La purga entre las dos válvulas de cierre está abierta sin flujo de vapor ni de condensado (comprueba que la válvula del lado del cabezal está sellando).
3. Cada válvula de cierre de vapor y de purga físicamente cerrada, bloqueada y etiquetada.
4. No abra ningún registro de hombre, registro de mano ni brida hasta que el manómetro marque 0 psig Y el paso T esté verificado.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('b6533e13-ffba-48e3-9cd9-320f75e7d0ad', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-012', 2, 2, 'isolate', 'W', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — W:

WATER (W) — Feedwater pump, makeup and chemical-feed lines to Boiler #2 (BGGN-012). Feedwater is pumped above boiler pressure and is hot from the feed/deaerator tank. [VERIFY ON SITE: feedwater temperature; whether the feed pump is shared]', 'ISOLATION PROCEDURE — WATER (Boiler #2 (BGGN-012)):
1. If the feedwater pump is dedicated to this boiler, lock its disconnect per the E procedure. If it is shared, do NOT rely on it — lock the valves below.
2. Close and lock the feedwater stop valve to BGGN-012. [VERIFY ON SITE: valve tag]
3. Close and lock the chemical-feed injection valve and any makeup/bypass valve to this boiler.
4. Open the drain between the feedwater stop valve and the boiler check valve to relieve pressure; wait until flow stops.', 'METHOD OF VERIFICATION — WATER:
1. Feedwater line gauge downstream of the locked valve reads 0 psig; drain open with no flow.
2. Attempt a level-control feed call — the gauge glass level does not rise.
3. Each feedwater and chemical-feed valve closed, locked and tagged.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — W:

AGUA (W) — Bomba de agua de alimentación, líneas de reposición y de alimentación de químicos a la Caldera #2 (BGGN-012). El agua de alimentación se bombea a una presión mayor que la de la caldera y viene caliente del tanque de alimentación/desaireador. [VERIFICAR EN SITIO: temperatura del agua de alimentación; si la bomba de alimentación es compartida]', 'PROCEDIMIENTO DE AISLAMIENTO — AGUA (Caldera #2 (BGGN-012)):
1. Si la bomba de agua de alimentación es exclusiva de esta caldera, bloquee su desconectador según el procedimiento E. Si es compartida, NO dependa de ella — bloquee las válvulas indicadas abajo.
2. Cierre y bloquee la válvula de cierre del agua de alimentación a BGGN-012. [VERIFICAR EN SITIO: etiqueta de la válvula]
3. Cierre y bloquee la válvula de inyección de químicos y cualquier válvula de reposición/bypass a esta caldera.
4. Abra el drenaje entre la válvula de cierre del agua de alimentación y la válvula de retención (check) de la caldera para liberar la presión; espere hasta que se detenga el flujo.', 'MÉTODO DE VERIFICACIÓN — AGUA:
1. El manómetro de la línea de agua de alimentación, aguas abajo de la válvula bloqueada, marca 0 psig; drenaje abierto sin flujo.
2. Intente una demanda de alimentación desde el control de nivel — el nivel en el visor de vidrio no sube.
3. Cada válvula de agua de alimentación y de alimentación de químicos cerrada, bloqueada y etiquetada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('0616b389-3f7b-4552-a6cd-08feb27b3d88', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-012', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL (T) — Boiler water, pressure parts, refractory and flue of Boiler #2 (BGGN-012) stay above 212 °F for hours. Opening a hot boiler releases scalding water and flash steam.', 'ISOLATION PROCEDURE — THERMAL (Boiler #2 (BGGN-012)):
1. After the S and W steps, let the boiler cool naturally per the manufacturer''s cool-down rate. Do NOT force-cool with cold water.
2. Drain only after the gauge reads 0 psig, the top vent is open, and boiler water is at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold]. Drain to the blowdown separator/tank, not to an open floor drain.
3. Before fireside entry, confirm the flue/refractory has cooled and the combustion chamber is ventilated (confined-space atmospheric test).', 'METHOD OF VERIFICATION — THERMAL:
1. Shell and drain-water temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Steam gauge 0 psig and top vent open.
3. Confined-space atmospheric test recorded before any entry.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA (T) — El agua, las partes a presión, el refractario y la chimenea de la Caldera #2 (BGGN-012) permanecen por encima de 212 °F durante horas. Abrir una caldera caliente libera agua hirviendo y vapor flash.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA (Caldera #2 (BGGN-012)):
1. Después de los pasos S y W, deje que la caldera se enfríe de forma natural según la velocidad de enfriamiento del fabricante. NO la enfríe a la fuerza con agua fría.
2. Drene solo después de que el manómetro marque 0 psig, el venteo superior esté abierto y el agua de la caldera esté a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro]. Drene al separador/tanque de purga, no a una coladera abierta del piso.
3. Antes de entrar por el lado de fuego, confirme que la chimenea/refractario se ha enfriado y que la cámara de combustión está ventilada (prueba atmosférica de espacio confinado).', 'MÉTODO DE VERIFICACIÓN — TÉRMICA:
1. Temperatura de la envolvente y del agua de drenaje a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
2. Manómetro de vapor en 0 psig y venteo superior abierto.
3. Prueba atmosférica de espacio confinado registrada antes de cualquier entrada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('37501ae4-951a-43aa-b358-9a68c935d7c8', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-013', 2, 2, 'isolate', 'S', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — S:

STEAM (S) — Saturated steam from Boiler #3 (BGGN-013) to the plant steam header shared with BGGN-011 and BGGN-012. The header stays live from the other boilers — shutting this burner off does NOT remove steam pressure. Required for any work on pressure parts, steam/blowdown piping, or internal entry. [VERIFY ON SITE: operating psig / MAWP]', 'ISOLATION PROCEDURE — STEAM (Boiler #3 (BGGN-013)):
1. Complete the E and G procedures for BGGN-013 first (burner off, fuel locked).
2. Close the boiler MAIN STEAM STOP valve AND the second stop / non-return valve between this boiler and the common header. Apply a valve lockout (wheel cover or chain-and-lock) + personal padlock + tag to EACH. [VERIFY ON SITE: valve tags]
3. Open the free-blow drain between the two closed stop valves and leave it open (double block and bleed). [VERIFY ON SITE: drain valve]
4. Close and lock the surface (continuous) blowdown and bottom blowdown valves. If the blowdown line is shared with the other boilers, lock the shared-line valve too. [VERIFY ON SITE]
5. Open the boiler top vent to atmosphere and let pressure fall to 0 psig. Open the vent BEFORE any draining so the boiler cannot pull a vacuum.
6. For internal entry (manway/handhole): permit-required confined space — steps 2–4, the W step and the T step must all be complete.', 'METHOD OF VERIFICATION — STEAM:
1. Boiler steam pressure gauge reads 0 psig and the top vent is open with no steam discharge.
2. Bleed between the two stop valves is open with no steam or condensate flow (proves the header-side valve is holding).
3. Each steam stop and blowdown valve physically closed, locked and tagged.
4. Do not open any manway, handhole or flange until the gauge reads 0 psig AND the T step is verified.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — S:

VAPOR (S) — Vapor saturado de la Caldera #3 (BGGN-013) al cabezal de vapor de la planta, compartido con BGGN-011 y BGGN-012. El cabezal permanece energizado por las otras calderas — apagar este quemador NO elimina la presión de vapor. Requerido para cualquier trabajo en partes a presión, tubería de vapor/purga, o entrada al interior. [VERIFICAR EN SITIO: psig de operación / MAWP]', 'PROCEDIMIENTO DE AISLAMIENTO — VAPOR (Caldera #3 (BGGN-013)):
1. Primero complete los procedimientos E y G para BGGN-013 (quemador apagado, combustible bloqueado).
2. Cierre la válvula de CIERRE PRINCIPAL DE VAPOR de la caldera Y la segunda válvula de cierre / antirretorno entre esta caldera y el cabezal común. Coloque un dispositivo de bloqueo de válvula (cubierta de volante o cadena y candado) + candado personal + etiqueta en CADA UNA. [VERIFICAR EN SITIO: etiquetas de las válvulas]
3. Abra el drenaje libre a la atmósfera entre las dos válvulas de cierre cerradas y déjelo abierto (doble bloqueo y purga). [VERIFICAR EN SITIO: válvula de drenaje]
4. Cierre y bloquee las válvulas de purga de superficie (continua) y de purga de fondo. Si la línea de purga es compartida con las otras calderas, bloquee también la válvula de la línea compartida. [VERIFICAR EN SITIO]
5. Abra el venteo superior de la caldera a la atmósfera y deje que la presión baje a 0 psig. Abra el venteo ANTES de cualquier drenado para que la caldera no pueda hacer vacío.
6. Para entrada al interior (registro de hombre/registro de mano): espacio confinado que requiere permiso — los pasos 2–4, el paso W y el paso T deben estar todos completos.', 'MÉTODO DE VERIFICACIÓN — VAPOR:
1. El manómetro de presión de vapor de la caldera marca 0 psig y el venteo superior está abierto sin descarga de vapor.
2. La purga entre las dos válvulas de cierre está abierta sin flujo de vapor ni de condensado (comprueba que la válvula del lado del cabezal está sellando).
3. Cada válvula de cierre de vapor y de purga físicamente cerrada, bloqueada y etiquetada.
4. No abra ningún registro de hombre, registro de mano ni brida hasta que el manómetro marque 0 psig Y el paso T esté verificado.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('8885ff87-d962-44b2-bb1e-bd21f9f018d7', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-013', 2, 2, 'isolate', 'W', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — W:

WATER (W) — Feedwater pump, makeup and chemical-feed lines to Boiler #3 (BGGN-013). Feedwater is pumped above boiler pressure and is hot from the feed/deaerator tank. [VERIFY ON SITE: feedwater temperature; whether the feed pump is shared]', 'ISOLATION PROCEDURE — WATER (Boiler #3 (BGGN-013)):
1. If the feedwater pump is dedicated to this boiler, lock its disconnect per the E procedure. If it is shared, do NOT rely on it — lock the valves below.
2. Close and lock the feedwater stop valve to BGGN-013. [VERIFY ON SITE: valve tag]
3. Close and lock the chemical-feed injection valve and any makeup/bypass valve to this boiler.
4. Open the drain between the feedwater stop valve and the boiler check valve to relieve pressure; wait until flow stops.', 'METHOD OF VERIFICATION — WATER:
1. Feedwater line gauge downstream of the locked valve reads 0 psig; drain open with no flow.
2. Attempt a level-control feed call — the gauge glass level does not rise.
3. Each feedwater and chemical-feed valve closed, locked and tagged.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — W:

AGUA (W) — Bomba de agua de alimentación, líneas de reposición y de alimentación de químicos a la Caldera #3 (BGGN-013). El agua de alimentación se bombea a una presión mayor que la de la caldera y viene caliente del tanque de alimentación/desaireador. [VERIFICAR EN SITIO: temperatura del agua de alimentación; si la bomba de alimentación es compartida]', 'PROCEDIMIENTO DE AISLAMIENTO — AGUA (Caldera #3 (BGGN-013)):
1. Si la bomba de agua de alimentación es exclusiva de esta caldera, bloquee su desconectador según el procedimiento E. Si es compartida, NO dependa de ella — bloquee las válvulas indicadas abajo.
2. Cierre y bloquee la válvula de cierre del agua de alimentación a BGGN-013. [VERIFICAR EN SITIO: etiqueta de la válvula]
3. Cierre y bloquee la válvula de inyección de químicos y cualquier válvula de reposición/bypass a esta caldera.
4. Abra el drenaje entre la válvula de cierre del agua de alimentación y la válvula de retención (check) de la caldera para liberar la presión; espere hasta que se detenga el flujo.', 'MÉTODO DE VERIFICACIÓN — AGUA:
1. El manómetro de la línea de agua de alimentación, aguas abajo de la válvula bloqueada, marca 0 psig; drenaje abierto sin flujo.
2. Intente una demanda de alimentación desde el control de nivel — el nivel en el visor de vidrio no sube.
3. Cada válvula de agua de alimentación y de alimentación de químicos cerrada, bloqueada y etiquetada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('f9c5690c-9fb2-4b61-8c16-a582508dd8ba', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'BGGN-013', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL (T) — Boiler water, pressure parts, refractory and flue of Boiler #3 (BGGN-013) stay above 212 °F for hours. Opening a hot boiler releases scalding water and flash steam.', 'ISOLATION PROCEDURE — THERMAL (Boiler #3 (BGGN-013)):
1. After the S and W steps, let the boiler cool naturally per the manufacturer''s cool-down rate. Do NOT force-cool with cold water.
2. Drain only after the gauge reads 0 psig, the top vent is open, and boiler water is at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold]. Drain to the blowdown separator/tank, not to an open floor drain.
3. Before fireside entry, confirm the flue/refractory has cooled and the combustion chamber is ventilated (confined-space atmospheric test).', 'METHOD OF VERIFICATION — THERMAL:
1. Shell and drain-water temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.
2. Steam gauge 0 psig and top vent open.
3. Confined-space atmospheric test recorded before any entry.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA (T) — El agua, las partes a presión, el refractario y la chimenea de la Caldera #3 (BGGN-013) permanecen por encima de 212 °F durante horas. Abrir una caldera caliente libera agua hirviendo y vapor flash.', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA (Caldera #3 (BGGN-013)):
1. Después de los pasos S y W, deje que la caldera se enfríe de forma natural según la velocidad de enfriamiento del fabricante. NO la enfríe a la fuerza con agua fría.
2. Drene solo después de que el manómetro marque 0 psig, el venteo superior esté abierto y el agua de la caldera esté a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro]. Drene al separador/tanque de purga, no a una coladera abierta del piso.
3. Antes de entrar por el lado de fuego, confirme que la chimenea/refractario se ha enfriado y que la cámara de combustión está ventilada (prueba atmosférica de espacio confinado).', 'MÉTODO DE VERIFICACIÓN — TÉRMICA:
1. Temperatura de la envolvente y del agua de drenaje a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.
2. Manómetro de vapor en 0 psig y venteo superior abierto.
3. Prueba atmosférica de espacio confinado registrada antes de cualquier entrada.');
insert into loto_energy_steps (id, tenant_id, equipment_id, step_number, sequence_order, step_type, energy_type, tryout_required, tag_description, isolation_procedure, method_of_verification, tag_description_es, isolation_procedure_es, method_of_verification_es) values ('99ffcbfa-8ca8-4adb-83b4-65b6f6164bb0', 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e', 'JECA-540', 2, 2, 'isolate', 'T', false, 'DRAFT — VERIFY AT THE MACHINE BEFORE USE
ENERGY TAG & DESCRIPTION — T:

THERMAL (T) — Hot caramel, heat-traced lines and pump body. Molten sugar sticks to skin and causes deep burns. [VERIFY ON SITE: product temperature]', 'ISOLATION PROCEDURE — THERMAL (Mix Kettle Pump, JECA-540):
1. After the E and H steps, keep the line heaters locked off and let the pump and lines cool.
2. Drain residual product only into a heat-resistant container, wearing face shield and insulated gloves.', 'METHOD OF VERIFICATION — THERMAL:
1. Pump body and line temperature at or below 140 °F (60 °C) [VERIFY ON SITE: plant safe-touch threshold], measured with a CONTACT or IMMERSION probe thermometer at the work point — IR guns under-read shiny stainless steel and oil surfaces.', 'BORRADOR — VERIFICAR EN LA MÁQUINA ANTES DE USAR
ETIQUETA DE ENERGÍA Y DESCRIPCIÓN — T:

TÉRMICA (T) — Caramelo caliente, líneas con traceado térmico y cuerpo de la bomba. El azúcar fundido se pega a la piel y causa quemaduras profundas. [VERIFICAR EN SITIO: temperatura del producto]', 'PROCEDIMIENTO DE AISLAMIENTO — TÉRMICA (Bomba de la Marmita de Mezcla, JECA-540):
1. Después de los pasos E y H, mantenga los calentadores de línea bloqueados en apagado y deje que la bomba y las líneas se enfríen.
2. Drene el producto residual solo hacia un recipiente resistente al calor, usando careta y guantes aislantes.', 'MÉTODO DE VERIFICACIÓN — TÉRMICA:
1. Temperatura del cuerpo de la bomba y de la línea a 140 °F (60 °C) o menos [VERIFICAR EN SITIO: límite de la planta para contacto seguro], medida con un termómetro de sonda de CONTACTO o de INMERSIÓN en el punto de trabajo — las pistolas IR marcan de menos en superficies de acero inoxidable brillante y de aceite.');
commit;

-- ROLLBACK (run only to undo):
-- begin;
-- delete from loto_energy_steps where id in ('08f5ee03-9d3d-4642-9c7d-e69742c78e30', 'a20320fd-0144-43f1-9367-a1ed53aa95cd', 'a333d263-fb34-4cfe-af2f-4b0ffb2aa281', '96927d12-8717-4bb8-8728-b91263c1ea48', '68a6d894-d03d-404d-89dd-021060d2b1a4', '0e378944-cfe7-4bba-a2af-12b39298ecdd', '271ad49a-0c81-4b10-b312-82f7df46991b', 'b6887c04-3d15-4fa4-98a6-9d19cf9a4ec9', '3e5ed468-0317-4651-b255-db67620d4719', '6f57d5c2-d441-43c7-abdd-1a5fd1caf4a8', '57fae132-44ff-4811-8efc-349058fe8c03', '5a24712e-9950-4600-b89c-3825e6c0a2b2', '833182ca-5f56-4282-8769-fbc9c63972a9', '90be0b43-d188-4318-91a8-c2b5cc831be9', '803eb497-36e3-4b66-b7e8-f610cc327b53', '0476a2e6-3580-45d4-adcb-e2d49a6eadff', 'fc109f37-aede-458c-959f-b2296b88f131', 'bab1a1ae-da59-49de-b4ad-287bd6f8108e', '5d5944d9-dfc2-4e0b-af5e-aea1d34572e5', '5fca252c-6b06-43dc-93fd-7c1fa9445eea', 'c64d556e-f483-4117-aea9-0a0d9ad5b12b', '739baa82-f1c3-48b8-a5a3-f00a6de4ccd8', 'd97ba313-2ded-410a-a7cc-928b967b3837', 'b6533e13-ffba-48e3-9cd9-320f75e7d0ad', '0616b389-3f7b-4552-a6cd-08feb27b3d88', '37501ae4-951a-43aa-b358-9a68c935d7c8', '8885ff87-d962-44b2-bb1e-bd21f9f018d7', 'f9c5690c-9fb2-4b61-8c16-a582508dd8ba', '99ffcbfa-8ca8-4adb-83b4-65b6f6164bb0');
-- update loto_energy_steps t set energy_type = b.energy_type, tag_description = b.tag_description, isolation_procedure = b.isolation_procedure, method_of_verification = b.method_of_verification, tag_description_es = b.tag_description_es, isolation_procedure_es = b.isolation_procedure_es, method_of_verification_es = b.method_of_verification_es from loto_energy_steps_backup_20261016 b where t.id = b.id;
-- commit;

-- Isolation photos relocated to the machine their tag names (verify at the machine).
begin;
create table if not exists loto_equipment_photo_backup_20261016 as
  select equipment_id, iso_photo_url from loto_equipment where false;
insert into loto_equipment_photo_backup_20261016 select equipment_id, iso_photo_url from loto_equipment
  where tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' and equipment_id in ('SKPF-590', 'JEGN-970', 'SNK-611', 'SKAP-1505');
update loto_equipment set iso_photo_url = 'https://zwtnpyjifbdytlektxlc.supabase.co/storage/v1/object/public/loto-photos/SKPF-500-IP.jpg' where tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' and equipment_id = 'SKPF-590';
update loto_equipment set iso_photo_url = 'https://zwtnpyjifbdytlektxlc.supabase.co/storage/v1/object/public/loto-photos/JEGN-970-EQ.jpg' where tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' and equipment_id = 'JEGN-970';
update loto_equipment set iso_photo_url = 'https://zwtnpyjifbdytlektxlc.supabase.co/storage/v1/object/public/loto-photos/ae3f1973-4c3e-4b6e-b91f-9de5ff10529e/SNK-602/SNK-602_ISO_1778545501781.jpg' where tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' and equipment_id = 'SNK-611';
update loto_equipment set iso_photo_url = 'https://zwtnpyjifbdytlektxlc.supabase.co/storage/v1/object/public/loto-photos/SKAP-1501-IP.jpg' where tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e' and equipment_id = 'SKAP-1505';
commit;
-- ROLLBACK: update loto_equipment e set iso_photo_url = b.iso_photo_url from loto_equipment_photo_backup_20261016 b
--   where e.equipment_id = b.equipment_id and e.tenant_id = 'ae3f1973-4c3e-4b6e-b91f-9de5ff10529e';
