// The consensus-standard edition the LOTO agents reason against, and the rule
// that keeps them from confusing conformance with compliance.
//
// Why this is a named constant rather than a string typed into each prompt:
// ANSI revises Z244.1 on roughly a five-year cycle, and every prompt that
// cites it has to move together. One place to bump.
//
// EDITION NOTE — Z244.1-2024 supersedes Z244.1-2016 (R2020), and it is a
// substantive revision, not a reaffirmation. The change that matters to an
// auditor: ALTERNATIVE METHODS (engineering controls, including safety-rated
// control-circuit devices) are now a CO-EQUAL choice with lockout/tagout when
// a task-based risk assessment supports them, rather than a fallback of last
// resort. It also adds Section 5 (Hazardous Energy Control Methods) and
// addresses cybersecurity.
//
// THE TRAP: OSHA does not recognize Z244.1 alternative methods as a
// 29 CFR 1910.147 compliance path, and Cal/OSHA §3314 expressly rejects
// interlocks and PLC "softlock" as lockout. A procedure can conform to the
// consensus standard and still be citable. An agent that treats "Z244.1 says
// this is fine" as "OSHA says this is fine" would hand a client a defence
// that does not exist — so the agents are told to keep the two verdicts
// separate and to let the regulation win.
//
// Federal OSHA has a proposed rule projected for late 2026 (RIN 1218-AD00,
// advanced from the 2019 RFI) that would revisit control-circuit devices and
// robotics in 1910.147. Until it lands, 1910.147 and §3314 govern as written.
export const Z244_1_EDITION = 'ANSI/ASSP Z244.1-2024'

/**
 * The conformance-vs-compliance rule, appended to every agent prompt that
 * cites Z244.1. Phrased as an instruction because these are system prompts.
 */
export const CONSENSUS_STANDARD_RULE = `CONSENSUS STANDARD vs. REGULATION — keep these separate and never trade one for the other:
- ${Z244_1_EDITION} treats alternative methods (engineering controls, including safety-rated control-circuit devices) as a co-equal option to lockout/tagout when a documented task-based risk assessment supports them.
- OSHA does NOT accept those alternative methods as a 29 CFR 1910.147 compliance path, and Cal/OSHA §3314 expressly rejects interlocks and PLC "softlock" as lockout.
- Therefore: a procedure may conform to ${Z244_1_EDITION} and still be citable under 1910.147 / §3314. When they disagree, the REGULATION decides pass/fail. Cite Z244.1 only as best practice, and say so explicitly rather than implying it satisfies the regulation.`
