---
title: "Federal OSHA 29 CFR Part 1910 — Claude Code Source Map"
jurisdiction: "Federal OSHA"
agency: "Occupational Safety and Health Administration, Department of Labor"
citation: "29 CFR Part 1910"
source_current: "https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910"
source_api_pattern: "https://www.ecfr.gov/api/versioner/v1/full/{date}/title-29.xml?part=1910"
created_utc: "2026-05-09T05:19:05.090174+00:00"
purpose: "Single Markdown file for Claude Code to fetch/build Federal OSHA 1910 regulation text into RAG-ready Markdown."
---

# Federal OSHA 29 CFR Part 1910 — Claude Code Source Map

> **Important:** This file is a Claude Code source map/build brief, not a fake full-text dump. Use it to fetch the current eCFR XML and generate the final RAG Markdown file(s). The eCFR page states that Part 1910 is too large to display as one browser page, so Claude Code should fetch via the eCFR API instead of scraping partial page text.

## Build Goal

Create **one RAG-ready Markdown file** named:

```text
federal_osha_29_cfr_1910_master.md
```

The file should contain the full text of **29 CFR Part 1910 — Occupational Safety and Health Standards**, preserving subparts, sections, appendices, tables, authority notes, source notes, and reserved sections.

## Source Status

- Current online source: `https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910`

- eCFR API pattern: `https://www.ecfr.gov/api/versioner/v1/full/{date}/title-29.xml?part=1910`

- eCFR is authoritative but unofficial; the official legal print CFR is updated annually through govinfo.gov.

- Pin the build to a date when possible. Recommended current date from the source-check session: `2026-05-07`.

## Claude Code Task Prompt

Copy/paste this instruction into Claude Code after uploading this file:

```text
Use this Markdown file as the source map. Fetch the current Federal OSHA 29 CFR Part 1910 XML from the eCFR API using this URL pattern:
https://www.ecfr.gov/api/versioner/v1/full/{date}/title-29.xml?part=1910

Use date 2026-05-07 unless the project owner asks for the latest available date. Parse the XML for Part 1910 only. Generate one RAG-ready Markdown file named federal_osha_29_cfr_1910_master.md. Preserve headings, subparts, sections, appendices, authority notes, source notes, reserved sections, and tables. Add YAML front matter with jurisdiction, agency, CFR title, CFR part, source URL, API URL, retrieved date, and source-status caveat. Do not summarize the regulation text. Do not omit appendices.
```

## Subpart Source Map

| Subpart | Title | Range | Status | Source URL |
|---|---|---:|---|---|
| A | General | 1910.1-1910.9 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-A |
| B | Adoption and Extension of Established Federal Standards | 1910.11-1910.19 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-B |
| C | Reserved | Reserved | reserved | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-C |
| D | Walking-Working Surfaces | 1910.21-1910.30 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-D |
| E | Exit Routes and Emergency Planning | 1910.33-1910.39 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-E |
| F | Powered Platforms, Manlifts, and Vehicle-Mounted Work Platforms | 1910.66-1910.68 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-F |
| G | Occupational Health and Environmental Control | 1910.94-1910.98 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-G |
| H | Hazardous Materials | 1910.101-1910.126 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-H |
| I | Personal Protective Equipment | 1910.132-1910.140 + Appendices A-D | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-I |
| J | General Environmental Controls | 1910.141-1910.147 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-J |
| K | Medical and First Aid | 1910.151-1910.152 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-K |
| L | Fire Protection | 1910.155-1910.165 + Appendices A-E | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-L |
| M | Compressed Gas and Compressed Air Equipment | 1910.166-1910.169 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-M |
| N | Materials Handling and Storage | 1910.176-1910.184 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-N |
| O | Machinery and Machine Guarding | 1910.211-1910.219 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-O |
| P | Hand and Portable Powered Tools and Other Hand-Held Equipment | 1910.241-1910.244 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-P |
| Q | Welding, Cutting and Brazing | 1910.251-1910.255 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-Q |
| R | Special Industries | 1910.261-1910.272 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-R |
| S | Electrical | 1910.301-1910.399 + Appendix A | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-S |
| T | Commercial Diving Operations | 1910.401-1910.440 + Appendices A-C | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-T |
| U | COVID-19 | 1910.501-1910.509 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-U |
| V-Y | Reserved | Reserved | reserved | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910 |
| Z | Toxic and Hazardous Substances | 1910.901-1910.1499 | active | https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910/subpart-Z |

## Section / Appendix Checklist

Use this checklist to validate that the generated master Markdown contains every listed section or appendix.

| Subpart | Citation / Item | Title |
|---|---|---|
| A | 1910.1 | Purpose and scope |
| A | 1910.2 | Definitions |
| A | 1910.3 | Petitions for the issuance, amendment, or repeal of a standard |
| A | 1910.4 | Amendments to this part |
| A | 1910.5 | Applicability of standards |
| A | 1910.6 | Incorporation by reference |
| A | 1910.7 | Definition and requirements for a nationally recognized testing laboratory |
| A | 1910.8 | OMB control numbers under the Paperwork Reduction Act |
| A | 1910.9 | Compliance duties owed to each employee |
| B | 1910.11 | Scope and purpose |
| B | 1910.12 | Construction work |
| B | 1910.15 | Shipyard employment |
| B | 1910.16 | Longshoring and marine terminals |
| B | 1910.17 | Effective dates |
| B | 1910.18 | Changes in established Federal standards |
| B | 1910.19 | Special provisions for air contaminants |
| C | Reserved | Subpart C [Reserved] |
| D | 1910.21 | Scope and definitions |
| D | 1910.22 | General requirements |
| D | 1910.23 | Ladders |
| D | 1910.24 | Step bolts and manhole steps |
| D | 1910.25 | Stairways |
| D | 1910.26 | Dockboards |
| D | 1910.27 | Scaffolds and rope descent systems |
| D | 1910.28 | Duty to have fall protection and falling object protection |
| D | 1910.29 | Fall protection systems and falling object protection—criteria and practices |
| D | 1910.30 | Training requirements |
| E | 1910.33 | Table of contents |
| E | 1910.34 | Coverage and definitions |
| E | 1910.35 | Compliance with alternate exit-route codes |
| E | 1910.36 | Design and construction requirements for exit routes |
| E | 1910.37 | Maintenance, safeguards, and operational features for exit routes |
| E | 1910.38 | Emergency action plans |
| E | 1910.39 | Fire prevention plans |
| E | Appendix to Subpart E | Exit Routes, Emergency Action Plans, and Fire Prevention Plans |
| F | 1910.66 | Powered platforms for building maintenance |
| F | 1910.67 | Vehicle-mounted elevating and rotating work platforms |
| F | 1910.68 | Manlifts |
| G | 1910.94 | Ventilation |
| G | 1910.95 | Occupational noise exposure |
| G | 1910.97 | Nonionizing radiation |
| G | 1910.98 | Effective dates |
| H | 1910.101 | Compressed gases (general requirements) |
| H | 1910.102 | Acetylene |
| H | 1910.103 | Hydrogen |
| H | 1910.104 | Oxygen |
| H | 1910.105 | Nitrous oxide |
| H | 1910.106 | Flammable liquids |
| H | 1910.107 | Spray finishing using flammable and combustible materials |
| H | 1910.108 | [Reserved] |
| H | 1910.109 | Explosives and blasting agents |
| H | 1910.110 | Storage and handling of liquefied petroleum gases |
| H | 1910.111 | Storage and handling of anhydrous ammonia |
| H | 1910.112-1910.113 | [Reserved] |
| H | 1910.119 | Process safety management of highly hazardous chemicals |
| H | 1910.120 | Hazardous waste operations and emergency response |
| H | 1910.121 | [Reserved] |
| H | 1910.122 | Table of contents |
| H | 1910.123 | Dipping and coating operations: Coverage and definitions |
| H | 1910.124 | General requirements for dipping and coating operations |
| H | 1910.125 | Additional requirements for dipping and coating operations that use flammable liquids or liquids with flashpoints greater than 199.4 °F (93 °C) |
| H | 1910.126 | Additional requirements for special dipping and coating operations |
| I | 1910.132 | General requirements |
| I | 1910.133 | Eye and face protection |
| I | 1910.134 | Respiratory protection |
| I | 1910.135 | Head protection |
| I | 1910.136 | Foot protection |
| I | 1910.137 | Electrical protective equipment |
| I | 1910.138 | Hand protection |
| I | 1910.139 | [Reserved] |
| I | 1910.140 | Personal fall protection systems |
| I | Appendix A to Subpart I | References for Further Information (Non-mandatory) |
| I | Appendix B to Subpart I | Nonmandatory Compliance Guidelines for Hazard Assessment and Personal Protective Equipment Selection |
| I | Appendix C to Subpart I | Personal Fall Protection Systems Non-Mandatory Guidelines |
| I | Appendix D to Subpart I | Test Methods and Procedures for Personal Fall Protection Systems Non-Mandatory Guidelines |
| J | 1910.141 | Sanitation |
| J | 1910.142 | Temporary labor camps |
| J | 1910.143 | Nonwater carriage disposal systems [Reserved] |
| J | 1910.144 | Safety color code for marking physical hazards |
| J | 1910.145 | Specifications for accident prevention signs and tags |
| J | 1910.146 | Permit-required confined spaces |
| J | 1910.147 | The control of hazardous energy (lockout/tagout) |
| K | 1910.151 | Medical services and first aid |
| K | 1910.152 | [Reserved] |
| L | 1910.155 | Scope, application and definitions applicable to this subpart |
| L | 1910.156 | Fire brigades |
| L | 1910.157 | Portable fire extinguishers |
| L | 1910.158 | Standpipe and hose systems |
| L | 1910.159 | Automatic sprinkler systems |
| L | 1910.160 | Fixed extinguishing systems, general |
| L | 1910.161 | Fixed extinguishing systems, dry chemical |
| L | 1910.162 | Fixed extinguishing systems, gaseous agent |
| L | 1910.163 | Fixed extinguishing systems, water spray and foam |
| L | 1910.164 | Fire detection systems |
| L | 1910.165 | Employee alarm systems |
| L | Appendix A to Subpart L | Fire Protection |
| L | Appendix B to Subpart L | National Consensus Standards |
| L | Appendix C to Subpart L | Fire Protection References For Further Information |
| L | Appendix D to Subpart L | Availability of Publications Incorporated by Reference in Section 1910.156 Fire Brigades |
| L | Appendix E to Subpart L | Test Methods for Protective Clothing |
| M | 1910.166-1910.168 | [Reserved] |
| M | 1910.169 | Air receivers |
| N | 1910.176 | Handling materials—general |
| N | 1910.177 | Servicing multi-piece and single piece rim wheels |
| N | 1910.178 | Powered industrial trucks |
| N | 1910.179 | Overhead and gantry cranes |
| N | 1910.180 | Crawler locomotive and truck cranes |
| N | 1910.181 | Derricks |
| N | 1910.183 | Helicopters |
| N | 1910.184 | Slings |
| O | 1910.211 | Definitions |
| O | 1910.212 | General requirements for all machines |
| O | 1910.213 | Woodworking machinery requirements |
| O | 1910.214 | Cooperage machinery [Reserved] |
| O | 1910.215 | Abrasive wheel machinery |
| O | 1910.216 | Mills and calenders in the rubber and plastics industries |
| O | 1910.217 | Mechanical power presses |
| O | 1910.218 | Forging machines |
| O | 1910.219 | Mechanical power-transmission apparatus |
| P | 1910.241 | Definitions |
| P | 1910.242 | Hand and portable powered tools and equipment, general |
| P | 1910.243 | Guarding of portable powered tools |
| P | 1910.244 | Other portable tools and equipment |
| Q | 1910.251 | Definitions |
| Q | 1910.252 | General requirements |
| Q | 1910.253 | Oxygen-fuel gas welding and cutting |
| Q | 1910.254 | Arc welding and cutting |
| Q | 1910.255 | Resistance welding |
| R | 1910.261 | Pulp, paper, and paperboard mills |
| R | 1910.262 | Textiles |
| R | 1910.263 | Bakery equipment |
| R | 1910.264 | Laundry machinery and operations |
| R | 1910.265 | Sawmills |
| R | 1910.266 | Logging operations |
| R | 1910.268 | Telecommunications |
| R | 1910.269 | Electric power generation, transmission, and distribution |
| R | 1910.272 | Grain handling facilities |
| S | 1910.301 | Introduction |
| S | 1910.302 | Electric utilization systems |
| S | 1910.303 | General |
| S | 1910.304 | Wiring design and protection |
| S | 1910.305 | Wiring methods, components, and equipment for general use |
| S | 1910.306 | Specific purpose equipment and installations |
| S | 1910.307 | Hazardous (classified) locations |
| S | 1910.308 | Special systems |
| S | 1910.309-1910.330 | [Reserved] |
| S | 1910.331 | Scope |
| S | 1910.332 | Training |
| S | 1910.333 | Selection and use of work practices |
| S | 1910.334 | Use of equipment |
| S | 1910.335 | Safeguards for personnel protection |
| S | 1910.336-1910.360 | [Reserved] |
| S | 1910.361-1910.380 | [Reserved] |
| S | 1910.381-1910.398 | [Reserved] |
| S | 1910.399 | Definitions applicable to this subpart |
| S | Appendix A to Subpart S | References for Further Information |
| T | 1910.401 | Scope and application |
| T | 1910.402 | Definitions |
| T | 1910.410 | Qualifications of dive team |
| T | 1910.420 | Safe practices manual |
| T | 1910.421 | Pre-dive procedures |
| T | 1910.422 | Procedures during dive |
| T | 1910.423 | Post-dive procedures |
| T | 1910.424 | SCUBA diving |
| T | 1910.425 | Surface-supplied air diving |
| T | 1910.426 | Mixed-gas diving |
| T | 1910.427 | Liveboating |
| T | 1910.430 | Equipment |
| T | 1910.440 | Recordkeeping requirements |
| T | Appendix A to Subpart T | Examples of Conditions Which May Restrict or Limit Exposure to Hyperbaric Conditions |
| T | Appendix B to Subpart T | Guidelines for Scientific Diving |
| T | Appendix C to Subpart T | Alternative Conditions Under § 1910.401(a)(3) for Recreational Diving Instructors and Diving Guides (Mandatory) |
| U | 1910.501 | [Reserved] |
| U | 1910.502 | Healthcare |
| U | 1910.504 | Mini Respiratory Protection Program |
| U | 1910.505 | Severability |
| U | 1910.509 | Incorporation by reference |
| V-Y | Reserved | Subparts V-Y [Reserved] |
| V-Y | 1910.901-1910.999 | [Reserved] |
| Z | 1910.1000 | Air contaminants |
| Z | 1910.1001 | Asbestos |
| Z | 1910.1002 | Coal tar pitch volatiles; interpretation of term |
| Z | 1910.1003 | 13 Carcinogens (4-Nitrobiphenyl, etc.) |
| Z | 1910.1004 | alpha-Naphthylamine |
| Z | 1910.1005 | [Reserved] |
| Z | 1910.1006 | Methyl chloromethyl ether |
| Z | 1910.1007 | 3,′-Dichlorobenzidine (and its salts) |
| Z | 1910.1008 | bis-Chloromethyl ether |
| Z | 1910.1009 | beta-Naphthylamine |
| Z | 1910.1010 | Benzidine |
| Z | 1910.1011 | 4-Aminodiphenyl |
| Z | 1910.1012 | Ethyleneimine |
| Z | 1910.1013 | beta-Propiolactone |
| Z | 1910.1014 | 2-Acetylaminofluorene |
| Z | 1910.1015 | 4-Dimethylaminoazobenzene |
| Z | 1910.1016 | N-Nitrosodimethylamine |
| Z | 1910.1017 | Vinyl chloride |
| Z | 1910.1018 | Inorganic arsenic |
| Z | 1910.1020 | Access to employee exposure and medical records |
| Z | 1910.1024 | Beryllium |
| Z | 1910.1025 | Lead |
| Z | 1910.1026 | Chromium (VI) |
| Z | 1910.1027 | Cadmium |
| Z | 1910.1028 | Benzene |
| Z | 1910.1029 | Coke oven emissions |
| Z | 1910.1030 | Bloodborne pathogens |
| Z | 1910.1043 | Cotton dust |
| Z | 1910.1044 | 1,2-dibromo-3-chloropropane |
| Z | 1910.1045 | Acrylonitrile |
| Z | 1910.1047 | Ethylene oxide |
| Z | 1910.1048 | Formaldehyde |
| Z | 1910.1050 | Methylenedianiline |
| Z | 1910.1051 | 1,3-Butadiene |
| Z | 1910.1052 | Methylene chloride |
| Z | 1910.1053 | Respirable crystalline silica |
| Z | 1910.1096 | Ionizing radiation |
| Z | 1910.1200 | Hazard communication |
| Z | 1910.1201 | Retention of DOT markings, placards and labels |
| Z | 1910.1450 | Occupational exposure to hazardous chemicals in laboratories |
| Z | 1910.1451-1910.1499 | [Reserved] |

## Required RAG Formatting

The final generated `federal_osha_29_cfr_1910_master.md` should use this pattern:

```markdown
---
source_type: federal_regulation
jurisdiction: Federal OSHA
agency: Occupational Safety and Health Administration, Department of Labor
cfr_title: 29
cfr_part: 1910
citation: 29 CFR Part 1910
source_url: https://www.ecfr.gov/current/title-29/subtitle-B/chapter-XVII/part-1910
source_api: https://www.ecfr.gov/api/versioner/v1/full/2026-05-07/title-29.xml?part=1910
retrieved_at_utc: <UTC timestamp>
source_status: eCFR authoritative but unofficial; official annual CFR available on govinfo.gov.
---

# 29 CFR Part 1910 — Occupational Safety and Health Standards

## Subpart A—General

### § 1910.1 — Purpose and scope
...
```

## Validation Checklist for Claude Code

- Confirm the XML contains `PART 1910` before writing output.

- Confirm Subparts A through Z are represented, including reserved Subparts C and V-Y.

- Confirm Subpart Z includes 1910.1000 through 1910.1450 and reserved ranges.

- Preserve appendices for Subparts E, I, L, S, and T where present.

- Preserve tables as Markdown tables when practical; otherwise use fenced `text` blocks.

- Do not create training interpretations inside the regulation file. Keep the source file pure.

- Put any notes or interpretations in separate files, not in the regulatory corpus.
