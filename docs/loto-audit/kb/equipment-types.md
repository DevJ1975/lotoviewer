# Equipment types → energy sources → isolation points

A field reference for the `lotoauditors`. For each food-production machine class: the energy sources
it carries, where the real energy-isolation (lockout) point usually is, and the stored-energy traps
technicians miss. This is generic engineering knowledge — confirm machine-specific device IDs/locations
against the unit's manual or on site (see `manufacturers.md` for OEM specifics). Energy codes are from
`packages/core/src/energyCodes.ts`.

> A "real isolation point" is a device that **can be locked out** — it has a hasp, a hole in the
> handle, or an attached lockout device. An E-stop, a start/stop station, an HMI screen, a pressure
> gauge, a nameplate, or a plain junction box is **not** an isolation point.

## Continuous fryer (hot oil)
- **Energy:** E (main drive/controls), T (oil 350–375 °F), often G (gas burner) or thermal-oil/steam
  heating, sometimes H (takeout-conveyor lift).
- **Isolation:** main fused disconnect / safety switch for the drives; gas-train manual shutoff valve
  (lockable) upstream of the burner; oil-pump disconnect + isolation valve.
- **Stored energy:** hot oil thermal mass (cool-down required); trapped oil pressure in capped lines;
  gravity on raised take-out conveyors.

## Oven (gas-fired, e.g., band/tunnel or Lanley)
- **Energy:** G (burner) + E (conveyor/controls) ± T.
- **Isolation:** gas manual shutoff valve with lockout; main electrical disconnect.
- **Stored energy:** residual heat; pilot/standing gas pressure downstream of the cock until bled.

## Cooker-extruder (puffed/curl snacks)
- **Energy:** E (large VFD main drive), S/T (steam/thermal), W (water), ± P (pneumatic die/cutter).
- **Isolation:** main disconnect (lockable) — **wait out the VFD DC-bus capacitors**; steam block
  valve; water supply valve.
- **Stored energy:** VFD DC-bus capacitors; trapped steam/condensate; rotating screw inertia; hot die.

## Mixer (horizontal/spiral dough — Shaffer/AMF, Marion)
- **Energy:** E + M (agitator/bowl) ± P (bowl tilt/discharge).
- **Isolation:** main disconnect; pneumatic shutoff + bleed if tilt-assisted.
- **Stored energy:** stored rotational energy in the agitator; gravity on a raised/tilted bowl.

## Sheeter / pre-sheeter / kibbler / masa hogg
- **Energy:** E + M (rolls/cutters) ± P (roll-gap/gates).
- **Isolation:** main disconnect; pneumatic isolation + bleed for roll/gate cylinders.
- **Stored energy:** spring-loaded rolls; pinch points hold residual motion; pneumatic pressure.

## Conveyors (belt, vibratory/Flexcentric, screw, bucket elevator, FastBack horizontal-motion)
- **Energy:** E + M ± GR (gravity on inclines/elevators) ± P (diverter gates).
- **Isolation:** motor disconnect; for elevators/inclines, block the carriage/flight against gravity.
- **Stored energy:** gravity load on inclined/vertical product columns; flywheel/eccentric inertia on
  vibratory and FastBack drives.

## Kettle-corn cooker
- **Energy:** G (gas burner) + E (controls/drive) + M (stirrer) + T.
- **Isolation:** gas manual shutoff valve (lockable) + main disconnect.
- **Stored energy:** residual heat/oil; stirrer rotational energy.

## Oil system / pump / heat exchanger / filter
- **Energy:** E (pump motor) + T (hot oil) ± H (hydraulic) ± S (steam heat exchanger).
- **Isolation:** pump-motor disconnect + manual isolation valves on suction/discharge; steam block
  valve on a heat exchanger.
- **Stored energy:** trapped hot-oil pressure; thermal mass; steam/condensate.

## Bagger / VFFS, case sealer, cartoner (Focke, Douglas)
- **Energy:** E + P (cylinders) + T (seal jaws/heaters).
- **Isolation:** main disconnect; pneumatic shutoff **with bleed** to exhaust residual air.
- **Stored energy:** residual pneumatic pressure; hot seal jaws; spring-loaded film/knife assemblies.

## Metal detector / check-weigher / coder (Video Jet) / scale
- **Energy:** E (mostly low-energy electronics) ± P (rejector).
- **Isolation:** local disconnect / plug; pneumatic bleed on the reject cylinder.
- **Stored energy:** generally minimal; mind the reject air and any UPS-backed electronics.

## Bulk handling (flour/corn systems, screw lifts, receivers, conditioners)
- **Energy:** E + M ± P (aeration/valves) ± GR (vertical columns).
- **Isolation:** motor disconnects; pneumatic isolation on fluidizing/diverter valves; block vertical
  product columns.
- **Stored energy:** gravity on stored bulk columns; rotating screw/airlock inertia; combustible-dust
  considerations (housekeeping, not a LOTO point, but note it).
