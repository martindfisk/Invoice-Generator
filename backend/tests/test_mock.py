import io
import json
import uuid
import zipfile

import pytest

from app.mock import MockTransport
from app.recorder import Recorder
from app.session import SessionStore
from app.uapi import UapiClient
from app.workflow import (
    ArtifactMissing,
    create_correction,
    create_invoice,
    fetch_artifact,
    fetch_files,
    list_records,
    wait_for_transmission,
)
from tests.conftest import (
    PEPPOL_INVOICING,
    SDI_INVOICING,
    invoice_operation,
    make_settings,
)

SELLER_IT = "seller-system-it"
SELLER_BE = "seller-system-be"
BUYER_IT = "buyer-system-it"


@pytest.fixture
def transport():
    return MockTransport()


@pytest.fixture
def clients(transport):
    store = SessionStore(make_settings(poll_interval_s=0.0, buyer_system_id_it=BUYER_IT))
    recorder = Recorder(200)
    return {name: UapiClient(name, store, recorder, transport) for name in ("seller", "buyer")}


async def send(clients, system_id=SELLER_IT, **kwargs):
    seller = clients["seller"]
    created = await create_invoice(seller, system_id, invoice_operation(**kwargs))
    return created, await wait_for_transmission(seller, created["transaction_id"], timeout=5.0)


async def list_receptions(client, system_id):
    response = await client.request(
        "GET", f"/records?type=E_INVOICE::RECEPTION&system_id={system_id}"
    )
    return [result["content"] for result in response.json().get("results") or []]


async def test_intention_is_accepted_and_processing_with_deterministic_ids(clients):
    seller = clients["seller"]
    body = {
        "content": {
            "type": "INTENTION",
            "system": {"id": SELLER_IT},
            "operation": {"type": "TRANSACTION"},
        }
    }
    response = await seller.request("POST", "/records", json=body, step="intention")
    content = response.json()["content"]
    assert content["id"] == "00000000-0000-4000-8000-000000000002"
    assert content["type"] == "INTENTION::TRANSACTION"
    assert (content["state"], content["mode"]) == ("ACCEPTED", "PROCESSING")
    assert content["system"] == {"id": SELLER_IT}
    assert content["journal"]["signed_at"] == "2026-08-26T09:00:02Z"
    assert response.headers["X-Idempotency-Replayed"] == "false"

    again = await seller.request("POST", "/records", json=body, step="intention")
    assert again.json()["content"]["id"] == "00000000-0000-4000-8000-000000000003"


async def test_italian_round_trip_reaches_finished_and_serves_fatturapa(clients):
    created, waited = await send(clients, number="2026-042")
    assert created["state"] == "ACCEPTED"
    assert waited["finished"] is True
    assert waited["transmission"]["state"] == "COMPLETED"
    assert waited["transmission"]["mode"] == "FINISHED"

    artifact = await fetch_artifact(clients["seller"], waited["transmission_id"])
    assert artifact["type"] == "application/xml"
    assert 'versione="FPR12"' in artifact["xml"]
    assert "<Numero>2026-042</Numero>" in artifact["xml"]


async def test_belgian_send_serves_peppol_ubl(clients):
    _, waited = await send(
        clients, system_id=SELLER_BE, invoicing=PEPPOL_INVOICING, inclusive="121.00"
    )
    artifact = await fetch_artifact(clients["seller"], waited["transmission_id"])
    assert "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" in artifact["xml"]
    assert "urn:fdc:peppol.eu:2017:poacc:billing:3.0" in artifact["xml"]


async def test_used_in_appears_on_the_second_read_and_finishes_on_the_third(clients, transport):
    seller = clients["seller"]
    created = await create_invoice(seller, SELLER_IT, invoice_operation())
    transaction_id = created["transaction_id"]

    first = (await seller.request("GET", f"/records/{transaction_id}")).json()["content"]
    assert "used_in" not in first
    second = (await seller.request("GET", f"/records/{transaction_id}")).json()["content"]
    transmission_id = second["used_in"]["id"]

    modes = []
    for _ in range(3):
        content = (await seller.request("GET", f"/records/{transmission_id}")).json()["content"]
        modes.append((content["state"], content["mode"]))
    assert modes == [
        ("ACCEPTED", "PROCESSING"),
        ("ACCEPTED", "PROCESSING"),
        ("COMPLETED", "FINISHED"),
    ]


async def test_fail_prefix_ends_in_failed_with_the_sdi_log(clients):
    _, waited = await send(clients, number="FAIL-001")
    assert waited["finished"] is True
    assert waited["transmission"]["state"] == "FAILED"
    assert waited["transmission"]["logs"] == [
        {"severity": "ERROR", "message": "00471 Cessionario uguale al cedente"}
    ]


async def test_recipient_without_invoicing_completes_without_transmission(clients):
    _, waited = await send(clients, invoicing=None)
    assert waited["finished"] is True
    assert waited["transmission"] is None
    assert waited["state"] == "COMPLETED"
    assert waited["logs"] == [
        {"severity": "ERROR", "message": "no recipient with invoicing configuration found"}
    ]


async def test_reception_reaches_the_buyer_system_only(clients):
    await send(clients, number="2026-777")
    buyer_receptions = await list_receptions(clients["buyer"], BUYER_IT)
    assert len(buyer_receptions) == 1
    seller_receptions = await list_receptions(clients["seller"], SELLER_IT)
    assert seller_receptions == []


async def test_failed_transmission_produces_no_reception(clients):
    await send(clients, number="FAIL-002")
    assert await list_receptions(clients["buyer"], BUYER_IT) == []


async def test_reception_carries_artifact_and_operation(clients):
    await send(clients, number="2026-778")
    entry = (await list_receptions(clients["buyer"], BUYER_IT))[0]
    response = await clients["buyer"].request(
        "GET", f"/records/{entry['id']}?compliance-artifact&operation"
    )
    content = response.json()["content"]
    assert content["type"] == "E_INVOICE::RECEPTION"
    assert (content["state"], content["mode"]) == ("COMPLETED", "FINISHED")
    assert content["system"] == {"id": BUYER_IT}
    assert json.loads(content["operation"])["document"]["number"] == "2026-778"


async def test_receipt_of_transmission_is_italian_only(clients):
    _, italian = await send(clients, number="2026-779")
    receipt = await fetch_artifact(clients["seller"], italian["transmission_id"], "receipt")
    assert "RicevutaConsegna" in receipt["xml"]

    _, belgian = await send(
        clients, system_id=SELLER_BE, invoicing=PEPPOL_INVOICING, inclusive="121.00"
    )
    with pytest.raises(ArtifactMissing):
        await fetch_artifact(clients["seller"], belgian["transmission_id"], "receipt")


async def test_receipt_and_compliance_artifacts_are_two_different_documents(clients):
    _, waited = await send(clients, number="2026-780")
    invoice = await fetch_artifact(clients["seller"], waited["transmission_id"], "compliance")
    receipt = await fetch_artifact(clients["seller"], waited["transmission_id"], "receipt")

    assert "FatturaElettronica" in invoice["xml"]
    assert "<Numero>2026-780</Numero>" in invoice["xml"]
    assert "FatturaElettronica" not in receipt["xml"]
    assert "<NomeFile>2026-780.xml</NomeFile>" in receipt["xml"]
    assert f"<Codice>{SDI_INVOICING['destination_code']}</Codice>" in receipt["xml"]
    assert invoice["label"] != receipt["label"]


async def test_correction_creates_its_own_record_transmission_and_reception(clients):
    seller = clients["seller"]
    created, waited = await send(clients, number="2026-781")
    corrected = await create_correction(
        seller,
        SELLER_IT,
        created["transaction_id"],
        invoice_operation(number="2026-781-NC"),
        "two covers were never served",
    )
    assert corrected["corrected_record_id"] == created["transaction_id"]

    record = (
        await seller.request("GET", f"/records/{corrected['transaction_id']}?operation")
    ).json()
    content = record["content"]
    assert content["type"] == "TRANSACTION::CORRECTION"
    assert content["record"] == {"id": corrected["intention_id"]}
    operation = json.loads(content["operation"])
    assert operation["type"] == "CORRECTION"
    assert operation["record"] == {"id": created["transaction_id"]}
    assert operation["reason"] == "two covers were never served"
    assert operation["data"]["document"]["number"] == "2026-781-NC"

    finished = await wait_for_transmission(seller, corrected["transaction_id"], timeout=5.0)
    assert finished["finished"] is True
    assert finished["transmission_id"] != waited["transmission_id"]
    assert finished["transmission"]["state"] == "COMPLETED"

    artifact = await fetch_artifact(seller, finished["transmission_id"])
    assert "<Numero>2026-781-NC</Numero>" in artifact["xml"]

    receptions = await list_receptions(clients["buyer"], BUYER_IT)
    assert len(receptions) == 2


async def test_correction_of_a_record_that_does_not_exist_is_a_404(clients):
    body = {
        "content": {
            "type": "INTENTION",
            "system": {"id": SELLER_IT},
            "operation": {"type": "TRANSACTION"},
        }
    }
    intention = (await clients["seller"].request("POST", "/records", json=body)).json()["content"]
    response = await clients["seller"].request(
        "POST",
        "/records",
        json={
            "content": {
                "type": "TRANSACTION",
                "record": {"id": intention["id"]},
                "operation": {
                    "type": "CORRECTION",
                    "record": {"id": "does-not-exist"},
                    "data": invoice_operation(),
                },
            }
        },
    )
    assert response.status_code == 404
    assert response.json()["content"]["code"] == "E_NOT_FOUND"
    assert "does-not-exist" in response.json()["content"]["message"]


async def test_corrections_are_listed_only_when_asked_for(clients):
    seller = clients["seller"]
    created, _ = await send(clients, number="2026-782")
    await create_correction(
        seller, SELLER_IT, created["transaction_id"], invoice_operation(number="2026-782-NC")
    )
    invoices = await list_records(seller, "TRANSACTION::INVOICE", SELLER_IT)
    assert [item["type"] for item in invoices["results"]] == ["TRANSACTION::INVOICE"]
    assert invoices["pagination"] is None

    both = await list_records(seller, "TRANSACTION::INVOICE,TRANSACTION::CORRECTION", SELLER_IT)
    assert sorted(item["type"] for item in both["results"]) == [
        "TRANSACTION::CORRECTION",
        "TRANSACTION::INVOICE",
    ]


async def test_listing_pages_through_records_with_a_token(clients):
    seller = clients["seller"]
    for number in ("2026-901", "2026-902", "2026-903"):
        await send(clients, number=number)

    first = await list_records(seller, "TRANSACTION::INVOICE", SELLER_IT, limit=2)
    assert len(first["results"]) == 2
    assert first["pagination"]["limit"] == 2
    assert "token=" in first["pagination"]["next"]

    second = await list_records(
        seller, "TRANSACTION::INVOICE", SELLER_IT, limit=2, token=first["pagination"]["token"]
    )
    assert len(second["results"]) == 1
    assert second["pagination"] is None
    ids = [item["id"] for item in first["results"] + second["results"]]
    assert len(set(ids)) == 3


async def test_listing_refuses_a_limit_outside_the_documented_range(clients):
    response = await clients["seller"].request(
        "GET", f"/records?type=TRANSACTION::INVOICE&system_id={SELLER_IT}&limit=500"
    )
    assert response.status_code == 400
    assert response.json()["content"]["code"] == "E_BAD_REQUEST"


async def test_files_zip_bundles_every_artifact(clients):
    _, waited = await send(clients, number="2026-783")
    payload = await fetch_files(clients["seller"], waited["transmission_id"])
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert sorted(archive.namelist()) == [
            "invoice.xml",
            "receipt-of-transmission.xml",
            "record.json",
        ]
        assert "<Numero>2026-783</Numero>" in archive.read("invoice.xml").decode()
        assert "RicevutaConsegna" in archive.read("receipt-of-transmission.xml").decode()
        record = json.loads(archive.read("record.json"))["content"]
        assert record["id"] == waited["transmission_id"]
        assert record["type"] == "E_INVOICE::TRANSMISSION"


async def test_belgian_zip_carries_no_receipt_of_transmission(clients):
    _, waited = await send(
        clients, system_id=SELLER_BE, invoicing=PEPPOL_INVOICING, inclusive="121.00"
    )
    payload = await fetch_files(clients["seller"], waited["transmission_id"])
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        assert sorted(archive.namelist()) == ["invoice.xml", "record.json"]
        assert "urn:oasis:names" in archive.read("invoice.xml").decode()


async def test_files_zip_of_an_unknown_record_is_a_404(clients):
    response = await clients["seller"].request("GET", "/files/does-not-exist.zip")
    assert response.status_code == 404
    assert response.json()["content"]["code"] == "E_NOT_FOUND"


async def test_idempotency_key_replays_the_stored_record(clients):
    seller = clients["seller"]
    key = str(uuid.uuid4())
    body = {
        "content": {
            "type": "INTENTION",
            "system": {"id": SELLER_IT},
            "operation": {"type": "TRANSACTION"},
        }
    }
    first = await seller.request("POST", "/records", json=body, idempotency_key=key)
    second = await seller.request("POST", "/records", json=body, idempotency_key=key)
    assert first.json() == second.json()
    assert second.headers["X-Idempotency-Replayed"] == "true"


async def test_unknown_record_bodies_and_ids_still_fall_back_to_fixtures(clients):
    seller = clients["seller"]
    unknown_body = await seller.request("POST", "/records", json={"content": {}})
    assert unknown_body.status_code == 404
    assert unknown_body.json()["content"]["code"] == "E_NOT_FOUND"
    assert "POST_records.json" in unknown_body.json()["content"]["message"]

    unknown_id = await seller.request("GET", "/records/does-not-exist")
    assert unknown_id.status_code == 404
    assert unknown_id.json()["content"]["code"] == "E_NOT_FOUND"

    orphan = await seller.request(
        "POST", "/records", json={"content": {"type": "TRANSACTION", "record": {"id": "nope"}}}
    )
    assert orphan.status_code == 404
    assert "does not exist" in orphan.json()["content"]["message"]


async def test_systems_fixture_still_answers(clients):
    response = await clients["buyer"].request("GET", f"/systems/{BUYER_IT}")
    assert response.status_code == 200
    assert response.json()["content"]["compliance"]["state"] == "TRANSMISSION_RECEPTION"
    assert "_fixture" not in response.json()
