import pytest

from app.collections import CAPTURES, load_collections
from app.settings import Settings
from app.spec import manifest
from tests.conftest import api_for, make_settings

SPEC_DIR = Settings.model_fields["spec_dir"].default
TIMEOUT_S = 60.0


def collection_version(country):
    return next(
        entry["version"]
        for entry in (manifest(SPEC_DIR) or {}).get("collections", [])
        if entry["country"] == country and entry.get("kind") == "collection"
    )


DE_RUNNABLE = [
    "Retrieve a Taxpayer::COMPANY",
    "List Taxpayers",
    "Retrieve a System::E_INVOICE_SERVICE",
    "List Systems",
    "Retrieve System with Peppol ID",
    "Create INTENTION::TRANSACTION",
    "Create TRANSACTION::INVOICE",
    "Retrieve TRANSACTION::INVOICE",
    "Retrieve E_INVOICE::TRANSMISSION",
    "Create INTENTION::TRANSACTION Correction",
    "Create TRANSACTION::CORRECTION INVOICE",
    "Retrieve TRANSACTION::CORRECTION",
    "Retrieve E_INVOICE::TRANSMISSION Correction",
    "List Invoices",
]


@pytest.fixture(scope="module")
def collections():
    return load_collections(SPEC_DIR, TIMEOUT_S)


def test_all_three_collections_parse(collections):
    assert sorted(collections) == ["be", "de", "it"]
    for country, collection in collections.items():
        # Each collection's version is its OWN manifest entry, not the active spec's apiVersion:
        # the dropped all-products spec and the fetched collections can legitimately sit on
        # different CalVers the day fiskaly publishes a new one.
        assert collection["version"] == collection_version(country)
        assert collection["steps"]
        assert collection["name"].startswith("fiskaly E-INVOICE")


def test_de_runnable_steps_in_order(collections):
    # Deliberately exact against the committed collections — CI fetches --frozen (hash-verified),
    # so this can only change when a new collection version is ingested on purpose, and then this
    # list is part of reviewing what changed upstream. The remediation plan offered loosening to
    # invariants instead; the exact list was kept because it doubles as the runner's contract.
    # Only the raw step count is an invariant: skipped steps come and go with upstream edits
    # without changing what the runner executes.
    steps = collections["de"]["steps"]
    assert [step["name"] for step in steps if step["runnable"]] == DE_RUNNABLE
    assert len(steps) >= len(DE_RUNNABLE)


def test_excluded_steps_carry_skip_reason(collections):
    for collection in collections.values():
        for step in collection["steps"]:
            if step["runnable"]:
                assert step["skipReason"] is None
            else:
                assert step["skipReason"] in (
                    "handled by the proxy",
                    "creates or mutates account resources",
                    "the app has no receive step; a live account has no seeded inbox to list",
                )
            if step["path"] == "/tokens":
                assert step["skipReason"] == "handled by the proxy"


def test_every_runnable_capture_is_mapped(collections):
    for collection in collections.values():
        for step in collection["steps"]:
            assert "no capture rule" not in (step["skipReason"] or "")


def test_capture_table_has_no_stale_rows(collections):
    steps = {
        (collection["id"], step["folder"], step["name"])
        for collection in collections.values()
        for step in collection["steps"]
    }
    assert set(CAPTURES) <= steps


def test_de_email_chain_captures_keep_verbatim_variable_names(collections):
    steps = {step["name"]: step for step in collections["de"]["steps"] if step["runnable"]}
    assert steps["Create INTENTION::TRANSACTION"]["captures"] == [
        {"variable": "emailInvoiceIntentionId", "pointer": "/content/id"}
    ]
    assert steps["Create TRANSACTION::INVOICE"]["captures"] == [
        {"variable": "eInvoiceId", "pointer": "/content/id"}
    ]
    assert steps["Retrieve TRANSACTION::INVOICE"]["captures"] == [
        {"variable": "beEmailTransmissionId", "pointer": "/content/used_in/id"}
    ]
    assert steps["Retrieve TRANSACTION::CORRECTION"]["captures"] == [
        {"variable": "bePeppolCorrectionTransmissionId", "pointer": "/content/used_in/id"}
    ]


def test_waits_are_added_where_the_collection_asserts_terminal_state(collections):
    steps = {step["name"]: step for step in collections["de"]["steps"] if step["runnable"]}
    assert steps["Retrieve TRANSACTION::INVOICE"]["waitFor"] == {
        "pointer": "/content/used_in/id",
        "equals": None,
        "timeoutS": TIMEOUT_S,
    }
    assert steps["Retrieve E_INVOICE::TRANSMISSION"]["waitFor"] == {
        "pointer": "/content/mode",
        "equals": "FINISHED",
        "timeoutS": TIMEOUT_S,
    }
    assert steps["Create TRANSACTION::INVOICE"]["waitFor"] is None


def test_asserts_transcribe_the_test_value_not_the_label(collections):
    steps = {step["name"]: step for step in collections["de"]["steps"]}
    assert steps["Create TRANSACTION::CORRECTION INVOICE"]["asserts"] == [
        {"pointer": "/content/type", "equals": "TRANSACTION::CORRECTION"}
    ]
    assert steps["Retrieve System with Peppol ID"]["asserts"] == [
        {"pointer": "/content/annotations/peppol_id", "equals": None}
    ]
    assert steps["Commission System (without proof of ownership)"]["asserts"] == [
        {"pointer": "/content/state", "equals": "COMMISSIONED"},
        {"pointer": "/content/mode", "equals": "DEGRADED"},
    ]


def test_it_reception_folder_is_skipped_with_its_reason(collections):
    reception = [
        step
        for step in collections["it"]["steps"]
        if step["folder"] == "records (E-Invoice Reception)"
    ]
    assert reception
    for step in reception:
        assert step["runnable"] is False
        assert "no receive step" in step["skipReason"]


def test_de_notes_surface_the_published_defects(collections):
    notes = collections["de"]["notes"]
    messages = [note["message"] for note in notes]
    severities = {note["message"]: note["severity"] for note in notes}
    assert len(notes) == 6
    rate = next(m for m in messages if '"22.00"' in m)
    assert "Italian standard rate" in rate and "19 %" in rate
    assert severities[rate] == "warning"
    variables = next(m for m in messages if "beEmailTransmissionId" in m)
    assert "bePeppolCorrectionTransmissionId" in variables and "verbatim" in variables
    assert severities[variables] == "info"
    vat_id = next(m for m in messages if "369204173" in m)
    assert "USt-IdNr" in vat_id
    assert severities[vat_id] == "warning"
    link = next(m for m in messages if "developer.fiskaly.com/api/e-invoice-be/2026-05-04" in m)
    assert "wrong product" in link and "wrong version" in link
    assert "workspace.fiskaly.com" in link
    assert severities[link] == "warning"
    peppol = next(m for m in messages if "proof-of-ownership" in m)
    assert "annotations.peppol_id" in peppol and "invoicing.type PEPPOL" in peppol
    label = next(m for m in messages if "Type is TRANSACTION::INVOICE" in m)
    assert "asserts TRANSACTION::CORRECTION" in label
    assert "asserted value, not the label" in label


def test_all_three_collections_carry_the_label_mismatch_note(collections):
    for collection in collections.values():
        labels = [
            note
            for note in collection["notes"]
            if "Type is TRANSACTION::INVOICE" in note["message"]
        ]
        assert len(labels) == 1
        assert labels[0]["severity"] == "warning"


def test_be_and_it_notes_stay_scoped(collections):
    be = collections["be"]["notes"]
    assert len(be) == 2
    link = next(note for note in be if "developer.fiskaly.com" in note["message"])
    assert "wrong product" not in link["message"]
    assert "wrong version" in link["message"]
    assert link["severity"] == "info"
    assert not any("proof-of-ownership" in note["message"] for note in be)
    it = collections["it"]["notes"]
    assert len(it) == 1
    assert "asserted value, not the label" in it[0]["message"]


async def test_collections_endpoints(api):
    _, client = api
    listing = await client.get("/api/collections")
    assert listing.status_code == 200
    summaries = {entry["id"]: entry for entry in listing.json()}
    assert set(summaries) == {"be", "de", "it"}
    assert summaries["de"]["steps"] == 28
    assert summaries["de"]["version"] == collection_version("de")
    assert summaries["de"]["notes"] == 6
    assert summaries["be"]["notes"] == 2
    assert summaries["it"]["notes"] == 1

    detail = await client.get("/api/collections/de")
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == "de"
    assert len(body["notes"]) == 6
    assert {note["severity"] for note in body["notes"]} == {"warning", "info"}
    step = body["steps"][20]
    assert set(step) == {
        "id",
        "name",
        "folder",
        "method",
        "path",
        "query",
        "body",
        "runnable",
        "skipReason",
        "captures",
        "waitFor",
        "asserts",
    }
    assert step["name"] == "Create TRANSACTION::INVOICE"
    assert step["method"] == "POST"
    assert step["path"] == "/records"
    assert step["body"]["content"]["type"] == "TRANSACTION"

    assert (await client.get("/api/collections/fr")).status_code == 404


async def test_collections_endpoint_503_without_spec(tmp_path):
    async with api_for(make_settings(spec_dir=tmp_path)) as (_, client):
        response = await client.get("/api/collections")
        assert response.status_code == 503
        assert "run: make spec" in response.json()["detail"]


async def test_x_step_and_x_run_id_reach_the_call_record(api):
    _, client = api
    response = await client.get(
        "/api/uapi/systems/seller-system-be",
        headers={"X-Step": "Retrieve a System::E_INVOICE_SERVICE", "X-Run-Id": "run-42"},
    )
    assert response.status_code == 200
    calls = (await client.get("/api/calls")).json()
    named = calls[-1]
    assert named["step"] == "passthrough"
    assert named["step_name"] == "Retrieve a System::E_INVOICE_SERVICE"
    assert named["run_id"] == "run-42"
    token = calls[0]
    assert token["step"] == "token"
    assert token["step_name"] is None
    assert token["run_id"] is None


async def test_passthrough_without_headers_keeps_fields_null(api):
    _, client = api
    await client.get("/api/uapi/systems/seller-system-be")
    record = (await client.get("/api/calls")).json()[-1]
    assert record["step_name"] is None
    assert record["run_id"] is None


async def test_taxpayer_and_system_lists_start_empty_and_fill_after_provisioning(api):
    _, client = api
    for path in ("/api/uapi/taxpayers", "/api/uapi/systems"):
        response = await client.get(path)
        assert response.status_code == 200
        assert response.json() == {"results": []}

    provisioned = await client.post(
        "/api/onboarding/provision", json={"persona": "seller", "country": "BE", "confirm": True}
    )
    assert provisioned.status_code == 200
    taxpayer_id = provisioned.json()["created"]["taxpayer_id"]

    body = (await client.get("/api/uapi/taxpayers")).json()
    assert "_fixture" not in body
    assert body["results"][0]["content"]["type"] == "COMPANY"
    assert body["results"][0]["content"]["id"] == taxpayer_id

    single = await client.get(f"/api/uapi/taxpayers/{taxpayer_id}")
    assert single.status_code == 200
    assert single.json()["content"]["id"] == taxpayer_id

    body = (await client.get(f"/api/uapi/systems?taxpayer_id={taxpayer_id}")).json()
    assert "_fixture" not in body
    assert body["results"][0]["content"]["type"] == "E_INVOICE_SERVICE"
    assert body["results"][0]["content"]["annotations"]["peppol_id"] == "0208:1234567890"
