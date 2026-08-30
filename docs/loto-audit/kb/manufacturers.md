# Equipment Manufacturers — LOTO Energy-Isolation Reference

> **Purpose:** For each equipment maker present in the Snak King (City of Industry, CA) data, this is
> what a **LOTO auditor** needs to grade isolation-point placard photos: the **machine class**, its
> **energy sources**, where the **primary energy-isolation device** usually lives, and the
> **stored-energy** hazards that bite during cleanup/jam-clearing. A **General reference** at the end
> explains how to tell a real isolation point from a decoy in a photo.
>
> **Makers in scope (with counts in the data):** Heat and Control (10) · Focke (15) ·
> Shaffer / AMF Bakery Systems (4) · Marlen (2) · Douglas Machine (2) · Marion Process Solutions (1).

> **Sourcing & honesty note (read first).** In the research environment, **direct page fetch
> (`WebFetch`) was blocked — HTTP 403 on every host**, including manufacturer sites, OSHA, and
> Wikipedia. This was an environment-wide outage, not site blocking. The `WebSearch` tool **did**
> retrieve and quote real on-page content from the cited URLs, so every factual claim below is
> grounded in that search-surfaced page content. **No model numbers, voltages, valve types, or
> isolation hardware were invented.** Anything that an auditor would normally read off a placard,
> nameplate, or manual — and that was not directly confirmed in a retrieved page — is tagged
> **[unverified — confirm against the machine's manual on site]**. Treat those tags as a to-do list,
> not as fact. PDFs/manuals are linked so they can be opened directly on site.

---

## Heat and Control

**Machine class:** Custom snack-processing systems — **continuous & batch fryers, ovens, FastBack®
horizontal-motion conveyors, dry-seasoning/coating systems (Spray Dynamics®)**, plus oil
management/heating/filtration. Privately owned, est. 1950. Brand families include FastBack®,
Mastermatic (fryers), Spray Dynamics® (coating/seasoning).
([heatandcontrol.com](https://www.heatandcontrol.com/); [about](https://www.heatandcontrol.com/about-us))

**Energy sources**
- **Electrical** (documented) — conveyor drives are **VFD**-controlled; electrically heated fryer
  models exist. Concrete data point: a used **Mastermatic GS-700** listed as **3-phase, 60 Hz, 240 V**
  power with **120 V controls**. ([continuous fryers](https://www.heatandcontrol.com/products/continuous-fryers);
  [reseller listing](https://www.wohlassociates.com/used-fryers/heat-control-mastermatic-gs-700-continuous-fryer.html))
  **[unverified per-model — read the machine's nameplate for voltage/phase/amperage]**
- **Thermal / hot oil** (documented, significant) — fryers hold a large hot-oil thermal mass that
  circulates through filter/heat-exchanger loops. Heat and Control explicitly warns oil **"should be
  cooled to 250°F (121°C) or less prior to draining"** to avoid thermal shock — i.e., dangerously hot
  oil persists long after the heat source is off. ([oil management](https://www.heatandcontrol.com/products/oil-management);
  [oil filtration](https://www.heatandcontrol.com/products/oil-filtration))
- **Gas (gas-fired fryers/ovens)** (documented) — the **Mastermatic Compact Fryer Model 700 is
  direct gas-fired (natural gas)**; Models 350/450 are electrically heated. → a gas-fired unit has a
  **gas train** to isolate. ([Mastermatic Compact Fryer](https://www.heatandcontrol.com/model/mastermatic-compact-fryer))
- **Thermal-fluid (hot-oil heat-transfer loop)** (documented) — indirect-heated fryers use a
  **tube-in-tube thermal-fluid heat exchanger** to heat the cooking oil — a *second* hot-fluid energy
  source separate from the cooking oil. ([Mastertherm fryer](https://www.heatandcontrol.com/model/mastertherm-prepared-foods-fryer))
- **Mechanical / rotating** (documented) — FastBack converts **rotational drive into pure horizontal
  pan motion**; fryers/ovens have belt drives; seasoning systems use rotating coating drums.
  ([FastBack 4.0](https://www.heatandcontrol.com/news/latest-revolution-in-horizontal-motion-conveying-fastback-4))
- **Steam / pneumatic / hydraulic / gravity** — not confirmed in retrieved pages. Fryers often have
  lift-up hoods (gravity) and some lines use steam or pneumatic dampers, but none was documented here.
  **[unverified — confirm on site]**

**Primary energy-isolation devices**
- **Main electrical disconnect / safety switch** on the control panel — standard for this class but
  not located in any retrieved page. **[unverified — confirm the lockable disconnect on the panel]**
- **Gas train manual shutoff** — for gas-fired models (e.g., Model 700) and gas ovens, expect an
  upstream **manual gas cock + valve train**. The specific train layout is
  **[unverified — confirm against the gas-train drawing/manual on site]**.
  (General gas-train reference: [Rockford Systems valve train](https://rockfordsystems.com/combustion/valve-train-diagram/))
- **Thermal-fluid loop isolation** (block valves) and **oil drain lockout** — implied by the
  cool-before-drain warning. **[unverified — confirm valve locations on site]**

**Stored-energy hazards**
- **Hot oil / thermal mass — HIGH.** Cooking oil and the thermal-fluid loop retain burn-hazard heat
  **long after electrical/gas isolation**; treat thermal energy as live until verified **≤250°F
  (121°C)**. ([oil management](https://www.heatandcontrol.com/products/oil-management))
- **VFD DC-bus capacitors** — FastBack and belt drives use VFDs, which hold capacitor charge after
  disconnect. No Heat-and-Control-specific discharge time was published.
  **[unverified — observe the drive's capacitor-discharge wait time on the VFD label]**
- **Rotating / linear stored motion** — FastBack pans and conveyor masses can coast; verify zero
  motion before access. ([FastBack 4.0](https://www.heatandcontrol.com/news/latest-revolution-in-horizontal-motion-conveying-fastback-4))
- **Residual gas/pneumatic pressure, gravity on raised hoods** — **[unverified — confirm/bleed on site]**

**Public docs (links surfaced; open on site):**
[Mastermatic Compact Fryer PDF](https://www.heatandcontrol.com/sites/default/files/content/resource/pdf/2019-07/Mastermatic%20Compact%20Fryer.pdf) ·
[Fryer System Technology PDF](https://www.heatandcontrol.com/sites/default/files/content/resource/pdf/2019-05/Fryer%20System%20Technology%20NEW.pdf) ·
[Potato Chip Fryer PDF](https://www.heatandcontrol.com/sites/default/files/content/resource/pdf/2019-05/Potato_Chip_Fryer.pdf)

---

## Focke

**Machine class:** High-speed **packaging & cartoning** machinery — cartoners, **case packers**
(side-load 459/460, 486, 488; top-load 494; robotic HFP; modular HMP), **wrap-around packers**,
**robotic palletizers/bundlers** (Model 540), and end-of-line peripherals (reservoirs, lane
dividers, **case elevators/lowerators**). Family-owned, founded 1955; strong in tobacco and
food/snack/hygiene. Focke also owns **Focke Meler** (hot-melt gluing).
([focke.com](https://www.focke.com/); [case packer side-load](https://www.focke.com/hygiene-tissue-food-consumer/case-packer-side-load/);
[palletizer/bundler](https://www.focke.com/hygiene-tissue-food-consumer/palletizer-bundler/))

> **Note:** Focke is privately held and publishes little machine-level technical detail. The richest
> public, citable safety/isolation language comes from its **Focke Meler** gluing division (below).
> Packer/palletizer electrical and pneumatic specifics are
> **[unverified — confirm against the machine's manual on site]**.

**Energy sources**
- **Electrical / control / servo** — a documented Focke **486** uses an **Allen-Bradley controller +
  PanelView Plus 1000 HMI, E-stop, interlocked guarding**; Focke stresses "advanced drive technology"
  / "motion control" → **servo/VFD-driven axes**. ([Sigma listing — Focke 486](https://www.sigmaequipment.com/equipment/used/focke-486-53611);
  [cigarette packaging](https://www.focke.com/cigarette-packaging-otp/))
- **Pneumatic (dominant secondary source on packaging machines)** — cylinders for pick-and-place /
  ram loaders, vacuum pick heads, blow-off. The 486 uses a "reciprocating pick-and-place… single-arm
  ram case loader" (air-actuated). ([Sigma listing](https://www.sigmaequipment.com/equipment/used/focke-486-53611))
  Exact air-shutoff/regulator hardware is **[unverified — confirm against the machine's manual on site]**.
- **Hot-melt glue (thermal + electrical)** — Focke case packers seal with **hot melt and/or tape**;
  older 486/488 fitted with **Nordson** systems, new lines with **Focke Meler** melters. Focke Meler
  manuals document setpoints of **tank/manifold ~160°C, hoses ~150°C, guns ~160°C, range 40–230°C,
  system can exceed 200°C** — a serious burn hazard. ([Focke Meler Micron+ catalog](https://pdf.directindustry.com/pdf/focke-meler-gluing-solutions-sa/micron-series/60394-674595.html);
  [Focke Meler Micron+ TPD manual PDF](https://www.meler.eu/docs/MA_FockeMeler_melter_Micron+TPD_ENG.pdf))
- **Mechanical / rotating** — servo axes, rotating drums/turrets, flight/transport chains on
  high-speed packers. **[unverified — confirm against the machine's manual on site]**
  ([cigarette packaging](https://www.focke.com/cigarette-packaging-otp/))
- **Gravity** — vertical-lift carriages on **case elevators/lowerators** and palletizer lift columns
  can drop when power/air is removed. **[unverified — confirm against the machine's manual on site]**
  ([end-of-line case packer](https://www.focke.com/cigarette-packaging-otp-2025/end-of-line-case-packer/))
- **Vacuum** — pick heads / end-of-arm tooling on robotic packers and palletizers.
  **[unverified — confirm against the machine's manual on site]**
  ([robotic palletizer](https://www.packworld.com/secondary-packaging/product/13333446/focke-company-robotic-palletizer))

**Primary energy-isolation devices**
- **Main electrical disconnect** on the control cabinet (Allen-Bradley PLC/HMI cabinet). Lock the
  disconnect handle. **[unverified — confirm exact disconnect location/type on site]**
  ([Sigma listing](https://www.sigmaequipment.com/equipment/used/focke-486-53611))
- **Pneumatic main shutoff with bleed/exhaust (lockable)** — lock the air-entry shutoff, then exhaust
  downstream air. Focke Meler explicitly states units use **compressed air up to 6 bar** and to
  "ensure the circuit has fully lost air pressure" before service.
  ([Focke Meler B4 manual PDF](https://www.meler.eu/docs/Manual_Fusores_B4_Meler_ENG.pdf))
  Machine-level air-shutoff specifics: **[unverified — confirm against the machine's manual on site]**.
- **Hot-melt unit power isolation** — Focke Meler instruction: **"Disconnect the equipment
  electrically from the main power switch"** before maintenance.
  ([Focke Meler B4 manual PDF](https://www.meler.eu/docs/Manual_Fusores_B4_Meler_ENG.pdf))

**Stored-energy hazards**
- **VFD/servo DC-bus capacitors** — after the main disconnect, the DC bus can hold high residual
  voltage; honor the drive's discharge wait and **measure before contact**.
  **[unverified for Focke's specific drives — confirm wait time on the drive nameplate/manual]**
- **Residual pneumatic pressure (packaging-machine signature hazard)** — trapped air in
  cylinders/lines/reservoirs must be **bled to zero after isolating air**; closing the valve is not
  enough. ([Focke Meler B4 manual PDF](https://www.meler.eu/docs/Manual_Fusores_B4_Meler_ENG.pdf))
- **Hot-melt thermal mass (burn hazard)** — molten adhesive and heated tank/hoses/guns stay hot after
  power-off. Focke Meler manuals warn **"Hot zone… Risk of burns,"** ">200°C; wear thermal PPE";
  allow to **cool** before service. ([Focke Meler Micron+ TPD PDF](https://www.meler.eu/docs/MA_FockeMeler_melter_Micron+TPD_ENG.pdf);
  [Focke Meler SF4 PDF](https://www.meler.eu/docs/Manual_Fusores_SF4_ENG_v0520.pdf))
- **Gravity on raised axes / lift carriages** — servo Z-axes, case elevators, palletizer columns can
  fall when air/power is removed — block/crib or lower before working under them.
  **[unverified for Focke specifically — confirm mechanical-restraint provisions on site]**

**Public docs:** Focke Meler hot-melt manuals (first-party, richest LOTO detail):
[B4](https://www.meler.eu/docs/Manual_Fusores_B4_Meler_ENG.pdf) ·
[Micron+ TPD](https://www.meler.eu/docs/MA_FockeMeler_melter_Micron+TPD_ENG.pdf) ·
[Streetfighter SF4](https://www.meler.eu/docs/Manual_Fusores_SF4_ENG_v0520.pdf). Focke machine
pages: [focke.com](https://www.focke.com/) · [Packworld](https://www.packworld.com/home/company/13321073/focke-company).

---

## Shaffer (AMF Bakery Systems)

**Machine class:** Industrial **horizontal dough mixers** — roller-bar (triple-roller-bar), Sigma-arm
and double-Sigma-arm agitators; fixed-bowl with **bowl-tilt discharge** (not removable-bowl); large
industrial capacities (Shaffer Triple Roller Bar **HS6 ~600 lb → HS32 ~3,200 lb**).
([shaffermixers.com](https://www.shaffermixers.com/);
[double sigma arm](https://www.shaffermixers.com/product/double-sigma-arm-mixers/))

> **IMPORTANT brand correction for the audit.** The label "Shaffer (AMF Bakery Systems)" conflates two
> *separate* companies that build closely-related horizontal mixers:
> - **Shaffer** is now part of **Coperion (Food, Health & Nutrition) / Bundy Baking Solutions**
>   ([fhn.coperion.com/brands/shaffer](https://fhn.coperion.com/brands/shaffer/);
>   [bundybakingsolutions.com](https://www.bundybakingsolutions.com/shaffer/horizontal-mixers/)).
> - **AMF Bakery Systems (Markel Food Group)** sells its own mixers under the **AMF Fusion** brand
>   (models **TBM, OTBM, OFM, APEX**) ([amfbakery.com/brands](https://amfbakery.com/brands/);
>   [amfbakery.com/equipment/mixing](https://amfbakery.com/equipment/mixing/)).
>
> Shaffer's own service staff state they service **"Shaffer, BEW, BP, Peerless, and AMF brand mixers."**
> **On the placard, identify whether the unit is badged Shaffer or AMF (Fusion)** — model names differ,
> but the isolation principles below apply to both. ([shaffermixers.com](https://www.shaffermixers.com/))

**Energy sources**
- **Electrical (main drive — primary hazard)** — a large main mixing-element drive motor; standard
  agitator speed **35/70 rpm** with VFD/variable-speed options (AMF TBM); Shaffer Double Sigma
  **"variable speed agitator to 80 rpm standard."** Exact HP/voltage: **[unverified — read the mixer
  nameplate/control-panel rating]**. AMF **APEX is "Direct Drive."**
  ([double sigma arm](https://www.shaffermixers.com/product/double-sigma-arm-mixers/);
  [triple roller bar](https://www.shaffermixers.com/product/triple-roller-bar-mixer/))
- **Hydraulic (bowl tilt/dump — major secondary hazard)** — bowl tilt is **hydraulically actuated**:
  "Shaffer's bowl tilt system utilizes a **hydraulic cylinder** for forward tilt and a hydraulic
  actuator or dual cylinders" for two-way tilt; the hybrid frame encloses "the entire tilt system,
  including the **hydraulic cylinder and power unit**." AMF TBM uses an **"air-driven hydraulic pump"**
  (couples **pneumatic → hydraulic**); mechanical overtilt to **140°** on large models.
  ([shaffermixers.com](https://www.shaffermixers.com/);
  [bakingbusiness.com](https://www.bakingbusiness.com/articles/35853-opening-up-horizontal-mixers))
- **Pneumatic** — at least the **air supply driving the hydraulic tilt pump** on AMF TBM; other
  pneumatic uses (covers/clamps/controls) **[unverified — confirm on site]**.
- **Mechanical / rotating (extreme entanglement + stored inertia)** — the **roller-bar / Sigma
  agitator** is a high-torque, high-inertia mixing element; treat as a primary lockout point.
- **Thermal — bowl/jacket cooling (chilled glycol/water, NOT a burn hazard)** — Shaffer **VerTech
  Refrigeration Jacket** (glycol) is standard on Triple Roller Bar mixers; AMF equivalent is
  **DuraBowl**. Isolate jacket supply/return and relieve pressure.
  ([shaffermixers.com/design-innovations](https://www.shaffermixers.com/design-innovations/);
  [amfbakery.com/equipment/mixing](https://amfbakery.com/equipment/mixing/))
- **Gravity (stored)** — a **raised/tilted bowl held by hydraulics** (up to 140°) and any raised cover
  are gravity hazards if hydraulic pressure is released without blocking.

**Primary energy-isolation devices**
- **Main electrical disconnect** on the mixer control panel (Shaffer/AMF supply integrated control
  panels). Exact type/location (e.g., door-interlocked through-the-door disconnect):
  **[unverified — confirm on the actual panel]**. ([parts & service](https://www.shaffermixers.com/parts-and-service/))
- **Hydraulic power-unit isolation + pressure bleed** — isolate the **HPU** serving the tilt
  cylinder(s) and **relieve trapped pressure** before working under a tilted bowl. HPU existence is
  documented; specific isolation-valve/bleed-port location: **[unverified — confirm on the HPU]**.
- **Pneumatic shutoff + bleed** — for AMF TBM, shut off + bleed the air supply to the air-driven
  hydraulic pump. **[unverified — confirm on site]**

**Stored-energy hazards**
- **Rotational inertia of the agitator (signature mixer hazard)** — the heavy roller-bar/Sigma element
  **coasts after power-off**; the OEM manual specifies run-down time.
  **[unverified — confirm rundown time; verify zero motion before reaching in]**
- **Hydraulic pressure holding a raised/tilted bowl/lid (gravity + trapped hydraulic)** — a bowl
  tilted up to **140°** can drop if hydraulic pressure is released without mechanical blocking.
  **Relieve pressure AND mechanically block/support before entering the strike zone.**
  **[unverified — confirm OEM blocking procedure]**
- **VFD DC-bus capacitors** — where a VFD drives the agitator, stored DC-bus charge persists after
  disconnect. **[unverified — confirm drive make/model and discharge time]**
- **Residual pneumatic** — trapped air in the AMF air-driven hydraulic circuit; **bleed after isolating.**

> **Auditor note — safeguards ≠ isolation.** Bowl guards, lid/cover switches, and safety interlock
> switches are **machine safeguards, not LOTO energy-isolation devices.** Do **not** accept an
> interlock as a substitute for a locked disconnect + hydraulic/pneumatic isolation.

**Public docs:**
[Shaffer Eagle Series PDF](https://www.shaffermixers.com/wp-content/uploads/2020/06/Shaffer-Eagle-Series-Mixers.pdf) ·
[Shaffer VerTech Jacket PDF](https://www.shaffermixers.com/wp-content/uploads/2018/10/Shaffer-VerTech-Refrigeration-Jacket.pdf) ·
[AMF Tilt Bowl Mixer data sheet PDF](https://amfbakery.com/wp-content/uploads/2019/09/Tilt_Bowl_Mixer-Data-Sheet.pdf) ·
[AMF Open Frame Mixer brochure PDF](https://amfbakery.com/wp-content/uploads/2021/11/Open-Frame-Mixer-Brochure.pdf)

---

## Marlen

**Machine class:** Food-processing **pumps, vacuum stuffers, portioners, and grinders** (size
reduction). Part of **Duravant** (sister brands: Carruthers slicing/dicing, Afoheat, Unitherm). HQ
Riverside, MO. Key lines: **OPTI-series twin-piston vacuum stuffers/pumps** (Opti 70–340) and the
**Vari-Kut In-Line Electric Grinder**.
([marlen.com/duravant-family](https://marlen.com/duravant-family/marlen/);
[vacuum stuffing/pumping](https://marlen.com/food-processing-equipment/vacuum-stuffing-pumping-portioning/))

> **Note:** "OMET" is **not** a confirmed Marlen/Duravant brand in retrieved sources.
> **[unverified — likely not a Marlen line]**

**Energy sources — OPTI vacuum stuffer/pump**
- **Hydraulic (primary drive)** — the pump is **hydraulically driven**. Opti 200 is "totally
  self-contained" with a **25 hp hydraulic unit**; the **front valve is an "unobstructed patented
  4-inch hydraulically driven front valve."** Hydraulics drive both the pistons and the product/front
  valve. ([Opti 200](https://marlen.com/food-processing-equipment/opti-200-vacuum-stuffer-pump/);
  [Opti 280](https://marlen.com/food-processing-equipment/opti-280-vacuum-stuffer-pump/))
- **Vacuum** — a dedicated **5 hp, 71 cfm vacuum pump** (Opti 200) pulls vacuum on product.
  ([Opti 200](https://marlen.com/food-processing-equipment/opti-200-vacuum-stuffer-pump/))
- **Electrical** — drive motors for the hydraulic power unit and vacuum pump; motor starters;
  touchpad/PLC control. Voltage/VFD details: **[unverified — confirm on nameplate/manual]**.
  ([Opti 200](https://marlen.com/food-processing-equipment/opti-200-vacuum-stuffer-pump/))
- **Mechanical / trapped product pressure** — positive-displacement twin pistons generate high product
  pressure: **Opti 200/340 = 250 psi, Opti 280 = 430 psi**. The product line/chamber can hold pressure.
  ([Opti 340](https://marlen.com/food-processing-equipment/opti-340-vacuum-stuffer-pump/);
  [Opti 280](https://marlen.com/food-processing-equipment/opti-280-vacuum-stuffer-pump/))
- **Gravity / hydraulic hopper** — the **"Power-Tilt Hopper is hydraulically operated from the
  touchpad control panel"** → a raised, hydraulically held hopper = gravity + stored-hydraulic hazard.
  ([vacuum stuffing/pumping](https://marlen.com/food-processing-equipment/vacuum-stuffing-pumping-portioning/))
- **Pneumatic** — not explicitly confirmed in retrieved pages. **[unverified — check for an air supply
  line/shutoff on the unit]**

**Energy sources — Vari-Kut grinder**
- **Electrical (primary drive)** — "Cutting speed is controlled by an **electric motor**." HP:
  **[unverified — confirm on nameplate]**. ([in-line electric grinder](https://marlen.com/food-processing-equipment/in-line-electric-grinder/))
- **Mechanical / rotating — severe** — grinder **feed-screw/worm + knife-and-plate head** (standard
  knives/plates) = extreme amputation/entanglement hazard; **must be isolated and de-energized before
  clearing a jam or reaching the head.** ([Vari-Kut grinder](https://marlen.com/food-processing-equipment/vari-kut-in-line-grinder/))
- **Vacuum (option)** — optional vacuum + automatic bone-collect; if fitted, treat vacuum as an added
  source. ([Vari-Kut grinder](https://marlen.com/food-processing-equipment/vari-kut-in-line-grinder/))

**Primary energy-isolation devices**
- **Main electrical disconnect** at the control panel — expected; specific placard
  **[unverified — confirm the lockable main disconnect on the panel]**.
- **Hydraulic power-unit isolation + pressure relief/bleed** — the **signature isolation point** on
  these hydraulically driven OPTI pumps; covers the **drive, the hydraulic Power-Tilt hopper, and the
  4-inch hydraulic front valve** circuits. **[unverified — confirm HPU lockout + bleed/relief on site;
  inspect for accumulators]**
- **Grinder: electrical disconnect** as primary isolation before opening the head.
  **[unverified — confirm lockable disconnect]**

**Stored-energy hazards**
- **Hydraulic pressure** retained in cylinders/lines/accumulators — *the* signature hazard on the
  OPTI pump, its **hydraulic Power-Tilt hopper**, and **hydraulic front valve**; relieve/bleed after
  isolation.
- **Gravity** — the raised **Power-Tilt hopper** can drop if hydraulics are released without blocking;
  block/lower before service.
- **Trapped product pressure** — up to **250–430 psi** held in the pump chamber/discharge line;
  relieve before opening.
- **Rotational inertia** — grinder worm/knife head and pump pistons can coast; verify zero motion.
- **VFD DC-bus capacitors / residual electrical** — if VFDs are fitted, allow discharge time.
  **[unverified — confirm drive type/discharge wait]**
- **Residual vacuum** — vacuum pump/chamber may hold vacuum after stop.
  **[unverified — confirm vacuum is released]**

**Public docs (open on site):**
[OPTI Vacuum Stuffing & Pumping brochure PDF](https://marlen.com/wp-content/uploads/2024/05/OPTI-Vacuum-Stuffing-Pumping-Brochure_9_29_21_web.pdf) ·
[Vari-Kut In-Line Electric Grinder brochure PDF](https://marlen.com/wp-content/uploads/2019/04/Vari-Kut-In-line-Electric-Grinder-Brochure_Web_4_12_19.pdf)

---

## Douglas Machine

**Machine class:** **End-of-line packaging** — **case & tray packers** (Axiom, TriVex, CpONE, Invex
3S), **cartoners/sleevers/multipackers** (Vantra, Apex, Spectrum), **shrink-wrap systems (OPTX)**, and
**robotic palletizers (Stratum)**. Alexandria, MN; founded 1964; 100% employee-owned.
([douglas-machine.com](https://www.douglas-machine.com/); [case & tray packers](https://www.douglas-machine.com/products-solutions/case-and-tray-packers/);
[shrink-wrap systems](https://www.douglas-machine.com/products-solutions/shrink-wrap-systems/))

> **Useful:** Douglas publishes **its own LOTO guidance page** that enumerates the energy taxonomy —
> "all hazardous energy sources on a machine — **electrical, mechanical, hydraulic, pneumatic, and
> others** — must be de-energized before any maintenance" — using an 8-step model (prepare, shutdown,
> isolate, lock/tag, release stored energy, verify zero, service, restore).
> ([Douglas LOTO Requirements](https://www.douglas-machine.com/lockout-tagout-requirement-for-packaging-equipment/))

**Energy sources**
- **Electrical (servo/PLC — dominant primary source)** — case/tray packers are servo-driven; Axiom DL
  uses **Allen-Bradley motion/logic + PanelView, NEMA12 enclosures** (NEMA 4/4X optional); the Invex
  3S runs **18 servo axes** (Schneider/ELAU). A used Axiom listed **3-phase / 60 Hz / 480 V**
  **[unverified for any specific machine — confirm nameplate]**.
  ([Axiom DL](https://www.douglas-machine.com/products-solutions/horizontal-load-casetray-packers/axiom-dl/);
  [Packaging World — 18 servo modules](https://www.packworld.com/secondary-packaging/news/13344329/18-servo-modules-power-17-cpm-casetray-packer))
- **Pneumatic (dominant secondary source)** — confirmed standard; Douglas ships **pneumatic drawings**
  with every machine and its LOTO guidance lists pneumatic among sources to isolate/bleed. Specific
  cylinder/vacuum/blow-off circuits are model-specific **[unverified — confirm against the pneumatic
  schematic]**. ([Training & Documentation](https://www.douglas-machine.com/support/trainingdocumentation/);
  [LOTO page](https://www.douglas-machine.com/lockout-tagout-requirement-for-packaging-equipment/))
- **Thermal / electrical heat (shrink wrappers — burn hazard)** — OPTX includes a **shrink tunnel in
  electric OR gas-fired versions, operating to ~360°F** (gas version heats 75°F→360°F in ~20 min),
  plus a heated **lap-seal** zone and a servo-driven film knife. So OPTX carries electric-heater and
  (optionally) **gas-fired combustion** energy plus a hot seal/tunnel surface. Heater kW / tunnel
  voltage / gas type: **[unverified — confirm against the OPTX manual/nameplate]**.
  ([OPTX S-80/105](https://www.douglas-machine.com/products-solutions/shrink-wrap-systems/optx-s-80-s-105/))
- **Mechanical / rotating** — servo flight bars, sweep/load heads, film rollers, and articulated
  **robot arms** on Stratum palletizers (vacuum/finger/magnetic end-of-arm tools).
  ([Axiom DL](https://www.douglas-machine.com/products-solutions/horizontal-load-casetray-packers/axiom-dl/);
  [robotic palletizers](https://www.douglas-machine.com/robotic-palletizers-what-are-they-how-do-they-improve-productivity/))
- **Gravity (signature palletizer hazard)** — Stratum systems dispense pallets from a stack and build
  raised pallet loads; elevated stacked loads and the pallet-dispenser magazine are gravity-stored.
  The specific raised-carriage/elevator block requirement is inferred from palletizer design.
  **[unverified — confirm raised-load blocking requirement in the palletizer manual]**
  ([robotic palletizers](https://www.douglas-machine.com/robotic-palletizers-what-are-they-how-do-they-improve-productivity/))

**Primary energy-isolation devices**
- **Main electrical disconnect** on the control cabinet — implied by the NEMA enclosures and
  Allen-Bradley/Schneider drive cabinets; lock the disconnect. Exact location/rating
  **[unverified — confirm on the cabinet/electrical drawing]**.
- **Pneumatic main shutoff with bleed/exhaust (lockable)** — Douglas LOTO requires isolating **and
  venting** pneumatic energy; expect a lockable air-prep/dump valve.
  **[unverified — confirm the lockout-style FRL/air-dump valve on the machine]**
- **Shrink-tunnel heat/power isolation** — separate electrical (and, on gas units, **fuel**) isolation
  for the tunnel heaters. **[unverified — confirm tunnel disconnect / gas shutoff on the OPTX manual]**

**Stored-energy hazards**
- **Gravity** — raised palletizer load / pallet stack / dispenser magazine must be lowered/blocked
  before working underneath. **[unverified — confirm block/lower step in palletizer manual]**
- **Residual pneumatic pressure** — bleed to **zero PSI** after isolating (Douglas "release stored
  energy → verify" steps).
- **Retained heat** — OPTX shrink **tunnel and seal surfaces stay hot after power-off** (operating
  ~360°F); allow cool-down. **[unverified — cool-down time per OPTX manual]**
- **VFD/servo DC-bus capacitors** — Allen-Bradley / Schneider-ELAU servo systems hold DC-bus charge;
  honor the discharge wait before touching the bus. **[unverified — confirm drive-specific discharge
  time on the electrical drawing]**

**Public docs:**
[Douglas LOTO Requirements page](https://www.douglas-machine.com/lockout-tagout-requirement-for-packaging-equipment/) ·
[Training & Documentation (order serial-specific electrical & pneumatic drawings, free w/ proof of ownership)](https://www.douglas-machine.com/support/trainingdocumentation/) ·
[OPTX 80/105 brochure PDF](https://www.douglas-machine.com/wp-content/uploads/OPTX-80-105-brochure-lr-2021.pdf)

> **Best lever for this audit:** pull each Douglas machine's **serial-number-specific electrical and
> pneumatic drawings** from Douglas (free per their documentation page) to confirm exact disconnect
> locations, air-dump valves, heater voltages, and any required gravity blocking before signing off a
> placard.

---

## Marion Process Solutions

**Machine class:** Industrial **horizontal mixers/blenders** — **ribbon mixers, paddle mixers,
fluidizing paddle mixers**, and hybrid agitators, for batch/continuous mixing of dry/wet bulk solids.
Based in Marion, Iowa; builds **custom/customizable** units.
([marionsolutions.com/process/mix](https://www.marionsolutions.com/process/mix/);
[custom options](https://www.marionsolutions.com/resources/all-custom-options/))

**Energy sources**
- **Electrical (main drive — primary hazard)** — a **large main drive motor + gear reducer** turns the
  agitator shaft (across-the-line or VFD). Real used-unit data points: a **250 cu ft ribbon blender,
  100 hp / 460 V / 3-phase / 60 Hz**; a 45 cu ft paddle blender **(SPC3672) 10 hp / 230-460 V**; a
  100 cu ft paddle mixer **(BPA42120) 60 hp, belt drive, 230-460 V**. Exact rating
  **[unverified for a given machine — read the motor nameplate/control panel]**.
  ([Sigma — Marion mixer/blender](https://www.sigmaequipment.com/equipment/manufacturers/marion-process-solutions/mixer-blender/);
  [Federal Equipment SPC3672](https://fedequip.com/inventory/paddle-ribbon-mixers/45-Cu-Ft-Marion-Paddle-Blender-S-S-Model-SPC3672.html);
  [Federal Equipment BPA42120](https://fedequip.com/inventory/paddle-ribbon-mixers/100-cu-ft-marion-paddle-mixer-cs-model-bpa42120.html))
- **Mechanical / rotating (extreme entanglement)** — the **ribbon or paddle agitator** is a heavy
  rotating shaft in a horizontal trough; severe entanglement/crushing hazard and large rotating mass.
  ([process/mix](https://www.marionsolutions.com/process/mix/))
- **Pneumatic (discharge gate)** — Marion blenders commonly have a **bottom outlet with a pneumatic
  slide-gate valve** (e.g., 8" outlets with pneumatic slide gates; larger units with actuated
  closure), driven by a **discharge-gate air cylinder** — a key isolation consideration.
  ([process/mix](https://www.marionsolutions.com/process/mix/);
  [custom options](https://www.marionsolutions.com/resources/all-custom-options/))
- **Thermal (jacket — if equipped)** — jacketing can be added for **heating or cooling**, with jackets
  rated e.g. **125 PSI @ 350°F** or **150 psig @ 400°F** (steam / hot water / chilled). Whether a given
  unit is jacketed (and the medium) **[unverified — confirm on-machine]**.
  ([custom options](https://www.marionsolutions.com/resources/all-custom-options/))
- **Gravity** — material head sitting on the discharge gate; gate/material can fall when released.

**Primary energy-isolation devices**
- **Main electrical disconnect** on/at the control panel for the drive motor.
  **[unverified — confirm the lockable main disconnect]**
- **Pneumatic shutoff + bleed (lockable)** for the **discharge-gate actuator air supply.**
  **[unverified — confirm the air shutoff/bleed valve on site]**
- **If jacketed:** manual line valve(s) for the **steam / hot-water / chilled** supply (and relieve
  pressure; steam/hot water is a burn hazard). **[unverified — confirm valves on site]**

**Stored-energy hazards**
- **Rotational inertia** of the heavy ribbon/paddle agitator — **coasts after power-off**; verify zero
  motion before reaching in.
- **Residual pneumatic pressure** on the discharge-gate cylinder — the gate could move after
  disconnect; **bleed** it.
- **VFD DC-bus capacitors** — if a VFD is fitted, charge persists after power-off.
  **[unverified — confirm drive type/discharge wait]**
- **Gravity** on retained material / the discharge gate.

> **Auditor note — safeguards ≠ isolation.** Cover guards and lid interlocks are **safeguards** (they
> stop motion when opened) — they are **not** energy-isolation devices and do not satisfy lockout.

**Public docs (open on site):**
[Marion — Industrial Mixing Equipment](https://www.marionsolutions.com/process/mix/) ·
[Marion — Custom Options](https://www.marionsolutions.com/resources/all-custom-options/)

---

## General reference: real isolation points vs. decoys

> **Use this to grade the placard photos.** A LOTO placard photo is only valid if it shows a device
> that can **physically isolate energy at the source** and be **locked out**. Many photos instead show
> control devices that *stop* the machine but do **not** isolate energy — these are decoys and must be
> rejected.

### What a real energy-isolating device IS (OSHA definition)

OSHA **29 CFR 1910.147(b)** defines an **"energy-isolating device"** as:

> *"A mechanical device that physically prevents the transmission or release of energy, including but
> not limited to the following: A manually operated electrical circuit breaker; a disconnect switch; a
> manually operated switch by which the conductors of a circuit can be disconnected from all
> ungrounded supply conductors and, in addition, no pole can be operated independently; a line valve;
> a block; and any similar device used to block or isolate energy. **Push buttons, selector switches
> and other control circuit type devices are not energy isolating devices.**"*
> — ([OSHA 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147))

**So a valid isolation point is a source-level device that BLOCKS energy and can take a lock:**
- A **manually operated electrical disconnect switch** or **circuit breaker** (lockable OFF).
- A **line valve** — manual shutoff on gas, compressed air, steam, hydraulic, or water/glycol lines
  (lockable, ideally with a downstream **bleed/vent**).
- A **plug** that can be physically secured (cord-and-plug equipment with a plug lockout).
- A **block** or pin that physically restrains stored mechanical/gravity energy.

### Push-buttons and control devices are NOT isolation devices

OSHA is explicit: **push buttons, selector switches, and other control-circuit devices are not energy
isolating devices** ([OSHA 1910.147](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147)).
An **E-stop cannot be used as a lockout point** — it interrupts a control circuit, does not isolate
energy at the source, does not prevent energy from re-accumulating, and can simply be reset.
([airpf.com — E-stops in lockout](https://www.airpf.com/can-you-use-e-stop-lockout-devices-in-lockout-procedures/);
[Lockout–tagout — Wikipedia](https://en.wikipedia.org/wiki/Lockout%E2%80%93tagout))

### Decoys — REJECT these in a placard photo

These devices control or describe the machine but do **not** isolate energy. A photo of one of these
is **not** a valid isolation-point photo:
- **E-stop buttons** (red mushroom buttons) — control-circuit only.
- **Start/stop push-button stations** and **selector switches** — control-circuit only.
- **HMI / operator touchscreens** — control only.
- **Indicator / pilot lights.**
- **Equipment nameplates / data plates** — informational, not an isolation device.
- **Plain junction boxes / pull boxes** — enclose wiring; no isolating means.
- **A control panel viewed as a whole** — the **lockable disconnect HANDLE on the panel** is the
  isolation point, **not** the panel face, the cabinet, or the HMI.

### What a VALID isolation point looks like in a photo

The tell is a device that can be locked OFF — **a lock, hasp, or lockout hole is the giveaway:**
- A **disconnect switch handle** (often red/yellow) **with a hasp hole** — lockable in OFF.
- A **circuit breaker** with a **breaker lockout** clamping the toggle in OFF (provides a padlock
  point without modifying the breaker).
- A **valve** (gas / air / steam / hydraulic / water) with a **valve lockout bracket or chain** sized
  to the handle, holding it closed — ideally next to a **bleed/vent**.
- A **plug** secured in a **plug lockout** box (cord-and-plug equipment).
- An **energy-isolation/air valve with a bleed** that vents downstream stored pressure to zero.

Hasp devices that accept **multiple padlocks** on one isolation point are used when several workers
lock out the same source. ([Lockout–tagout — Wikipedia](https://en.wikipedia.org/wiki/Lockout%E2%80%93tagout))

> **Grading rule of thumb:** *If the device in the photo cannot be locked OFF and does not physically
> stop energy at the source, it is a decoy — fail the placard and request a photo of the actual
> disconnect/valve.* Then cross-check that the isolation point matches **every** energy source the
> machine has per its section above (e.g., a gas-fired fryer needs the **gas-train valve** photo, not
> just the electrical disconnect; a hydraulically driven Marlen pump needs the **HPU isolation +
> bleed**, not just the panel disconnect; a palletizer needs **gravity blocking**, etc.).

---

### Sources (search-surfaced page content; direct fetch was blocked in-environment)

**OSHA / LOTO general reference**
- OSHA 1910.147 — Control of hazardous energy (lockout/tagout): https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147
- OSHA eTool — Lockout/Tagout definitions: https://www.osha.gov/etools/lockout-tagout/tutorial/definitions
- Lockout–tagout — Wikipedia: https://en.wikipedia.org/wiki/Lockout%E2%80%93tagout
- E-stops in lockout procedures (airpf): https://www.airpf.com/can-you-use-e-stop-lockout-devices-in-lockout-procedures/

**Manufacturers**
- Heat and Control: https://www.heatandcontrol.com/ · oil management: https://www.heatandcontrol.com/products/oil-management · Mastermatic Compact Fryer: https://www.heatandcontrol.com/model/mastermatic-compact-fryer
- Focke: https://www.focke.com/ · Focke 486 listing: https://www.sigmaequipment.com/equipment/used/focke-486-53611 · Focke Meler B4 manual: https://www.meler.eu/docs/Manual_Fusores_B4_Meler_ENG.pdf · Focke Meler Micron+ TPD manual: https://www.meler.eu/docs/MA_FockeMeler_melter_Micron+TPD_ENG.pdf
- Shaffer: https://www.shaffermixers.com/ · Coperion brand page: https://fhn.coperion.com/brands/shaffer/ · AMF Bakery: https://amfbakery.com/equipment/mixing/ · bakingbusiness (horizontal mixers): https://www.bakingbusiness.com/articles/35853-opening-up-horizontal-mixers
- Marlen: https://marlen.com/food-processing-equipment/vacuum-stuffing-pumping-portioning/ · Opti 200: https://marlen.com/food-processing-equipment/opti-200-vacuum-stuffer-pump/ · Opti 280: https://marlen.com/food-processing-equipment/opti-280-vacuum-stuffer-pump/ · Vari-Kut grinder: https://marlen.com/food-processing-equipment/vari-kut-in-line-grinder/
- Douglas Machine: https://www.douglas-machine.com/ · LOTO Requirements: https://www.douglas-machine.com/lockout-tagout-requirement-for-packaging-equipment/ · OPTX S-80/105: https://www.douglas-machine.com/products-solutions/shrink-wrap-systems/optx-s-80-s-105/ · Training & Documentation: https://www.douglas-machine.com/support/trainingdocumentation/
- Marion Process Solutions: https://www.marionsolutions.com/process/mix/ · Custom Options: https://www.marionsolutions.com/resources/all-custom-options/ · Sigma used Marion: https://www.sigmaequipment.com/equipment/manufacturers/marion-process-solutions/mixer-blender/
