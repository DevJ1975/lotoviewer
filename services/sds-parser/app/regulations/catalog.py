"""The parts of the CFR this service can load into the knowledge base.

Adding a part is one entry here. Its ``regulation_update_checks`` row is created
the first time it is loaded (migration 297), after which the freshness cron
watches it. State regulations (Cal/OSHA Title 8, TCEQ Title 30 TAC) are not on
eCFR; they ship as reviewed markdown through the web app's seed route instead.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class EcfrSource:
    # regulation_update_checks.source: the freshness cron's key for this part.
    key: str
    # How the part is named in regulation_update_checks and the superadmin panel.
    label: str
    ecfr_title: str
    ecfr_part: str
    # knowledge_source_type: how the assistant labels and filters these documents.
    source_type: str
    jurisdiction: str = "federal"

    @property
    def citation_prefix(self) -> str:
        return f"{self.ecfr_title} CFR"

    @property
    def url_prefix(self) -> str:
        """Every document of this part has a source_url starting with this."""
        return f"https://www.ecfr.gov/current/title-{self.ecfr_title}/part-{self.ecfr_part}/"


_SOURCES = (
    EcfrSource("epa-40-cfr-261", "EPA 40 CFR Part 261 (Identification and Listing of Hazardous Waste)", "40", "261", "rcra"),
    EcfrSource("epa-40-cfr-262", "EPA 40 CFR Part 262 (Generators of Hazardous Waste)", "40", "262", "rcra"),
    EcfrSource("epa-40-cfr-263", "EPA 40 CFR Part 263 (Transporters of Hazardous Waste)", "40", "263", "rcra"),
    EcfrSource("epa-40-cfr-112", "EPA 40 CFR Part 112 (Oil Pollution Prevention, SPCC)", "40", "112", "epa"),
    EcfrSource("epa-40-cfr-122", "EPA 40 CFR Part 122 (NPDES Permit Program: stormwater, outfalls)", "40", "122", "epa"),
    EcfrSource("epa-40-cfr-403", "EPA 40 CFR Part 403 (General Pretreatment Regulations)", "40", "403", "epa"),
    EcfrSource("epa-40-cfr-70", "EPA 40 CFR Part 70 (State Operating Permit Programs, Title V air)", "40", "70", "epa"),
)

CATALOG: dict[str, EcfrSource] = {s.key: s for s in _SOURCES}
