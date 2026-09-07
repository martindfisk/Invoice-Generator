from typing import Any, Literal

from pydantic import BaseModel, Field

Mode = Literal["live", "mock"]
ArtifactKind = Literal["compliance", "receipt"]
Environment = Literal["test", "live"]
CredentialSource = Literal["session", "env", "none"]


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
    personas: dict[str, dict[str, SystemRef]]
    spec_source: str | None = None
    spec_sha256: str | None = None
    spec_origin: str | None = None
    spec_ingested_at: str | None = None


class SystemState(BaseModel):
    system_id: str | None = None
    taxpayer_id: str | None = None


class RecipientState(BaseModel):
    sdi_destination_code: str | None = None
    peppol_id: str | None = None


class CredentialState(BaseModel):
    configured: bool
    source: CredentialSource
    fingerprint: str | None = None


class PersonaState(BaseModel):
    credentials: CredentialState
    systems: dict[str, SystemState]
    recipients: RecipientState


class SettingsState(BaseModel):
    mode: Mode
    environment: Environment
    base_url: str
    api_version: str
    personas: dict[str, PersonaState]


class PersonaUpdate(BaseModel):
    api_key: str | None = None
    api_secret: str | None = None
    systems: dict[str, SystemState] | None = None
    recipients: RecipientState | None = None


class SettingsUpdate(BaseModel):
    mode: Mode | None = None
    environment: Environment | None = None
    confirm_live: bool = False
    personas: dict[str, PersonaUpdate] | None = None


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


class SpecApplicability(BaseModel):
    status: Literal["applicable", "not_required", "not_applicable", "not_supported"]
    note: str | None = None


class SpecField(BaseModel):
    pointer: str
    kind: Literal["leaf", "group", "map"]
    type: str | None = None
    schema_name: str | None = Field(default=None, alias="schema")
    required: bool
    optional_ancestor: str | None = None
    constraints: dict[str, Any] = {}
    description: str | None = None
    example: Any = None
    example_source: str | None = None
    bt: list[str] = []
    applicability: dict[str, SpecApplicability] = {}
    applicable: bool = True
    variants: dict[str, list[str]] = {}

    model_config = {"populate_by_name": True}


class SpecUnion(BaseModel):
    pointer: str
    property_name: str | None = None
    values: list[str]


class SpecFields(BaseModel):
    api_version: str
    source: str
    source_sha256: str
    country: str
    operation: Literal["INVOICE", "CORRECTION"]
    profile: str | None = None
    fields: list[SpecField]
    unions: list[SpecUnion]
    warnings: list[str] = []


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
    # None means "not read this slice" (transmission-id short-circuit); [] would mean "cleared".
    logs: list[dict[str, Any]] | None = None
    transmission: TransmissionRef | None = None


class Artifact(BaseModel):
    record_id: str
    kind: ArtifactKind
    label: str
    type: str
    xml: str


class OnboardingCounts(BaseModel):
    organizations: int = 0
    subjects: int = 0
    taxpayers: int = 0
    systems: int = 0


class OnboardingEntity(BaseModel):
    id: str | None = None
    type: str | None = None
    state: str | None = None
    name: str | None = None


class OnboardingTaxpayer(BaseModel):
    id: str | None = None
    state: str | None = None
    country: str | None = None
    name: str | None = None
    vat_id: str | None = None
    fiscalization_type: str | None = None


class OnboardingSystem(BaseModel):
    id: str | None = None
    type: str | None = None
    state: str | None = None
    mode: str | None = None
    taxpayer_id: str | None = None
    location_id: str | None = None
    compliance_state: str | None = None
    peppol_id: str | None = None
    registrations: list[dict[str, Any]] = Field(default_factory=list)
    blocked_by: str | None = None


class OnboardingStatus(BaseModel):
    persona: str
    environment: Environment
    credentials: CredentialState
    counts: OnboardingCounts
    organizations: list[OnboardingEntity]
    subjects: list[OnboardingEntity]
    taxpayers: list[OnboardingTaxpayer]
    systems: list[OnboardingSystem]
    ready: dict[str, bool]
    missing: list[str]


class ProvisionRequest(BaseModel):
    persona: str = "seller"
    country: str
    confirm: bool = False
    reuse: bool = True
    taxpayer: dict[str, Any] = Field(default_factory=dict)


class ProvisionStep(BaseModel):
    name: str
    method: str
    path: str
    status: Literal["passed", "failed", "skipped"]
    id: str | None = None
    error: dict[str, Any] | None = None


class ProvisionCreated(BaseModel):
    taxpayer_id: str | None = None
    location_id: str | None = None
    system_id: str | None = None


class ProvisionResult(BaseModel):
    steps: list[ProvisionStep]
    created: ProvisionCreated
    ready: bool


class StepCapture(BaseModel):
    variable: str
    pointer: str


class StepWait(BaseModel):
    pointer: str
    equals: Any = None
    timeoutS: float


class StepAssert(BaseModel):
    pointer: str
    equals: Any = None


class CollectionStep(BaseModel):
    id: str
    name: str
    folder: str
    method: str
    path: str
    query: dict[str, str | None] = Field(default_factory=dict)
    body: Any = None
    runnable: bool
    skipReason: str | None = None
    captures: list[StepCapture] = Field(default_factory=list)
    waitFor: StepWait | None = None
    asserts: list[StepAssert] = Field(default_factory=list)


class CollectionNote(BaseModel):
    severity: Literal["warning", "info"]
    message: str


class CollectionSummary(BaseModel):
    id: str
    name: str
    version: str
    steps: int
    notes: int


class Collection(BaseModel):
    id: str
    name: str
    version: str
    steps: list[CollectionStep]
    notes: list[CollectionNote] = Field(default_factory=list)
