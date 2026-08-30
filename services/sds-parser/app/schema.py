"""Pydantic models mirroring ParsedSdsPayload (packages/core/src/chemicals.ts).

FastAPI uses these for request/response validation and the auto-generated
OpenAPI docs. The parser returns plain dicts; FastAPI coerces them through
``ParsedSdsPayload`` on the way out, which doubles as a schema-drift guard — if
the TS payload shape changes and this model isn't updated, responses fail
validation loudly instead of silently shipping the wrong shape to the queue.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

ParseConfidence = Literal["high", "medium", "low"]
PhysicalState = Literal["solid", "liquid", "gas", "aerosol", "mixture", "other"]
GhsSignalWord = Literal["danger", "warning"]
GhsPictogram = Literal["GHS01", "GHS02", "GHS03", "GHS04", "GHS05", "GHS06", "GHS07", "GHS08", "GHS09"]


class CodeStatement(BaseModel):
    code: str
    text: str


class FirstAid(BaseModel):
    inhalation: Optional[str] = None
    skin: Optional[str] = None
    eyes: Optional[str] = None
    ingestion: Optional[str] = None
    notes: Optional[str] = None


class Firefighting(BaseModel):
    suitable_extinguishers: list[str] = Field(default_factory=list)
    unsuitable_extinguishers: list[str] = Field(default_factory=list)
    special_hazards: Optional[str] = None
    protective_equipment: Optional[str] = None


class SpillCleanup(BaseModel):
    personal_precautions: Optional[str] = None
    environmental_precautions: Optional[str] = None
    containment_methods: Optional[str] = None
    cleanup_methods: Optional[str] = None


class Confidence(BaseModel):
    overall: ParseConfidence
    identification: ParseConfidence
    hazards: ParseConfidence
    physical: ParseConfidence
    exposure: ParseConfidence
    first_aid: ParseConfidence
    firefighting: ParseConfidence
    spill_cleanup: ParseConfidence
    transport: ParseConfidence


class ParsedSdsPayload(BaseModel):
    # Section 1 — identification
    product_name: Optional[str] = None
    manufacturer: Optional[str] = None
    product_code: Optional[str] = None
    recommended_use: Optional[str] = None
    emergency_phone: Optional[str] = None

    # Section 3 — composition
    cas_numbers: list[str] = Field(default_factory=list)
    synonyms: list[str] = Field(default_factory=list)

    # Section 9 — physical / chemical
    physical_state: Optional[PhysicalState] = None
    appearance: Optional[str] = None
    flash_point_c: Optional[float] = None
    boiling_point_c: Optional[float] = None
    vapor_pressure_kpa: Optional[float] = None

    # Section 2 — hazards
    ghs_signal_word: Optional[GhsSignalWord] = None
    ghs_pictograms: list[GhsPictogram] = Field(default_factory=list)
    hazard_statements: list[CodeStatement] = Field(default_factory=list)
    precautionary_statements: list[CodeStatement] = Field(default_factory=list)

    # NFPA
    nfpa_health: Optional[int] = None
    nfpa_flammability: Optional[int] = None
    nfpa_instability: Optional[int] = None
    nfpa_special: Optional[str] = None

    # Section 8 — exposure controls
    pel_twa_ppm: Optional[float] = None
    stel_ppm: Optional[float] = None
    idlh_ppm: Optional[float] = None
    ppe_required: list[str] = Field(default_factory=list)

    # Sections 4 / 5 / 6
    first_aid: FirstAid
    firefighting: Firefighting
    spill_cleanup: SpillCleanup

    # Sections 7 / 10
    storage_class: Optional[str] = None
    incompatibilities: list[str] = Field(default_factory=list)

    # Section 14 — transport
    dot_un_number: Optional[str] = None
    dot_hazard_class: Optional[str] = None
    dot_packing_group: Optional[str] = None

    # Metadata
    sds_revision_date: Optional[str] = None
    sds_language: Optional[str] = None

    confidence: Confidence
    parser_notes: Optional[str] = None


# Numeric confidence mirror of the web app's mapping (parse route): the queue
# sorts/gates on this 0..1 score, so a heuristic parse caps at 0.66 (medium).
CONFIDENCE_SCORE = {"high": 1.0, "medium": 0.66, "low": 0.33}


# ── Request bodies ───────────────────────────────────────────────────────────

class ParseTextRequest(BaseModel):
    text: str


class ParseUrlRequest(BaseModel):
    url: str


class ParseStageRequest(BaseModel):
    sds_id: str
    tenant_id: str
    product_id: Optional[str] = None
