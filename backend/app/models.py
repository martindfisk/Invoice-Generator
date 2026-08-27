from typing import Any, Literal

from pydantic import BaseModel, Field

Mode = Literal["live", "mock"]
ArtifactKind = Literal["compliance", "receipt"]


class Health(BaseModel):
    status: str
    mode: Mode
    api_version: str


class SystemRef(BaseModel):
    system_id: str
    taxpayer_id: str | None = None


class Config(BaseModel):
    mode: Mode
    environment: Literal["test", "live"]
    api_version: str
    reception_mode: Literal["live", "simulated"]
    personas: dict[str, dict[str, SystemRef]]


class ModeState(BaseModel):
    mode: Mode
    live_available: bool


class ModeUpdate(BaseModel):
    mode: Mode


class XsdRequest(BaseModel):
    schema_key: str = Field(alias="schema")
    xml: str


class XsdFinding(BaseModel):
    line: int | None
    column: int | None
    message: str
    path: str | None


class XsdResult(BaseModel):
    valid: bool
    findings: list[XsdFinding]


class UapiSchemaRequest(BaseModel):
    operation: dict[str, Any]
    country: str = "IT"


class UapiSchemaFinding(BaseModel):
    pointer: str
    keyword: str
    message: str


class UapiSchemaResult(BaseModel):
    valid: bool
    country: str
    findings: list[UapiSchemaFinding]


class InvoiceRequest(BaseModel):
    persona: str = "seller"
    country: str
    operation: dict[str, Any]
    idempotency_key: str | None = None


class InvoiceCreated(BaseModel):
    intention_id: str
    transaction_id: str
    state: str | None = None
    mode: str | None = None
    logs: list[dict[str, Any]] = Field(default_factory=list)


class CorrectionRequest(BaseModel):
    persona: str = "seller"
    country: str
    operation: dict[str, Any]
    reason: str | None = None
    idempotency_key: str | None = None


class CorrectionCreated(InvoiceCreated):
    corrected_record_id: str


class RecordListing(BaseModel):
    results: list[dict[str, Any]] = Field(default_factory=list)
    pagination: dict[str, Any] | None = None


class TransmissionRef(BaseModel):
    id: str | None = None
    state: str | None = None
    mode: str | None = None
    logs: list[dict[str, Any]] = Field(default_factory=list)


class TransmissionWait(BaseModel):
    transaction_id: str
    transmission_id: str | None = None
    finished: bool
    state: str | None = None
    mode: str | None = None
    logs: list[dict[str, Any]] = Field(default_factory=list)
    transmission: TransmissionRef | None = None


class Artifact(BaseModel):
    record_id: str
    kind: ArtifactKind
    label: str
    type: str
    xml: str


class InboxItem(BaseModel):
    id: str
    source: Literal["uapi", "simulated"]
    received_at: str | None = None
    seller_name: str | None = None
    number: str | None = None
    total: str | None = None
    currency: str | None = None
    xml: str | None = None


class SimulateRequest(BaseModel):
    xml: str
    meta: dict[str, Any] = Field(default_factory=dict)
