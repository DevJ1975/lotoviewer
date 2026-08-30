# Isolation-point reference & verdict rubric

The shared rubric for both `lotoauditors`. It mirrors the in-app vision agent
(`apps/web/lib/loto/audit/prompts.ts` `FPE_SYSTEM`, `schemas.ts` `FpeResult`) so the Claude Code
audit and the production pipeline reach the same conclusions.

## Verdict taxonomy (per photo)

| verdict | meaning |
|---|---|
| `match` | The photo clearly shows what it should — the described machine, or a real, lockable energy-isolation point. |
| `mismatch` | The photo shows something else, or an "isolation" photo that is **not** an energy-isolation point (nameplate, E-stop, HMI, random panel, stock image, or the equipment overview reused as the iso shot). |
| `low_confidence` | Plausibly right but unconfirmable — blurry, dark, partial, ambiguous, or a known reference placeholder. |
| `missing` | No usable photo (null URL or failed fetch). |

`confidence` is `high | medium | low`. **Conservative floor:** if you would not stake a tech's life on
it, it is at most `low_confidence`, never `match`.

For the **isolation photo** also set:
- `shows_isolation_point` — is a real disconnect/valve/breaker/lockable device visible?
- `consistent_with_energy_steps` — does the device shown match the placard's `energy_type`s and
  `isolation_procedure`s?

**Consensus rule (the lotoauditors' safety floor):** a placard's isolation photo is `match` only when
the food-production equipment engineer says `match` AND the Snak King maintenance engineer concurs.
Any disagreement, or either side `low_confidence`, floors to `low_confidence`. A
`reference_placeholder` provenance photo is never `match`.

## Energy codes (from `packages/core/src/energyCodes.ts`)

| code | English | Español |
|---|---|---|
| E | Electrical | Eléctrico |
| G | Gas | Gas |
| H | Hydraulic | Hidráulico |
| P | Pneumatic | Neumático |
| M | Mechanical | Mecánico |
| T | Thermal | Térmico |
| W | Water | Agua |
| S | Steam | Vapor |
| V | Valve | Válvula |
| CG | Compressed Gas | Gas Comprimido |
| CP | Control Panel | Panel Control |
| GR | Gravity | Gravedad |
| N | None (sentinel) | Ninguno |

## What a REAL isolation point looks like in a photo

The defining test: **can a lock be applied here to hold the energy off?** Look for a hasp, a hole in
the handle, an attached lockout device, often with a tag.

- **Electrical (E):** fused disconnect / safety switch (box with a rotary handle), or a breaker with a
  breaker-lockout, or a main disconnect handle with a padlock provision. VFD-fed drives: the disconnect
  is the lockout point, but DC-bus capacitors hold charge after it opens.
- **Pneumatic (P) / Compressed Gas (CG):** a lockout-dump / shutoff valve on the supply or FRL, with a
  bleed to exhaust residual pressure.
- **Gas (G):** a manual gas-train shutoff valve (lockable), upstream of the burner.
- **Hydraulic (H) / hot oil (T):** a pump-motor disconnect plus a manual isolation valve; capped lines
  trap pressure.
- **Steam (S) / Water (W):** a lockable block valve on the supply.
- **Mechanical (M) / Gravity (GR):** blocking pins, gravity blocks on raised carriages/elevators,
  rotating-shaft isolation — not merely a guard interlock.

## Common decoys → call these `mismatch` (or at least not a verified isolation point)

- An **E-stop** mushroom button — a stop control, not an energy-isolation device.
- A **start/stop pushbutton station** or selector switch.
- An **HMI / touchscreen / PLC panel** with no disconnecting means.
- A **nameplate / data plate / asset tag** close-up.
- A **plain junction box** or conduit with no disconnect.
- A **pressure/temperature gauge** by itself.
- A **stock or marketing photo** of the machine model.
- The **equipment overview** shot reused in the isolation slot.

## Inconsistency patterns to flag

- Energy steps list one source (e.g., E 480 V) but the iso photo shows a different one (e.g., a
  pneumatic ball valve) → `consistent_with_energy_steps = false`.
- A multi-source machine (e.g., fryer: E + T + G) whose iso photo shows only one device and the steps
  omit the others → flag the gap.
- **Cross-wiring:** a real isolation point, but plainly for a neighboring machine on the same line
  (very common on Snak King lines) → `mismatch`, note the likely true owner.
- A `reference_placeholder` / watermarked image standing in for a verified isolation point → never
  `match`; recommend capturing a real field photo.
