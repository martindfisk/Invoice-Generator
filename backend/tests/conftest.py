import contextlib

import httpx
import pytest

from app.main import create_app, lifespan
from app.settings import Settings

SELLER_KEY = "seller-key-0123456789"
SELLER_SECRET = "seller-secret-0123456789"
BUYER_KEY = "buyer-key-0123456789"
BUYER_SECRET = "buyer-secret-0123456789"


def make_settings(**overrides):
    values = {
        "uapi_mode": "mock",
        "uapi_api_version": "2026-06-01",
        "allow_mode_override": True,
        "seller_api_key": SELLER_KEY,
        "seller_api_secret": SELLER_SECRET,
        "seller_system_id_it": "seller-system-it",
        "seller_taxpayer_id_it": "seller-taxpayer-it",
        "seller_system_id_be": "seller-system-be",
        "seller_taxpayer_id_be": "seller-taxpayer-be",
        "buyer_api_key": BUYER_KEY,
        "buyer_api_secret": BUYER_SECRET,
        "buyer_system_id_be": "buyer-system-be",
        "buyer_taxpayer_id_be": "buyer-taxpayer-be",
        "buyer_peppol_id": "0208:0123456789",
    }
    return Settings(_env_file=None, **{**values, **overrides})


@contextlib.asynccontextmanager
async def api_for(settings):
    app = create_app(settings)
    async with lifespan(app):
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield app, client


@pytest.fixture
async def api():
    async with api_for(make_settings()) as (app, client):
        yield app, client


SDI_INVOICING = {"type": "SDI", "destination_code": "ABC1234", "pec": "beta@pec.example.it"}
PEPPOL_INVOICING = {"type": "PEPPOL", "identifier": "0208:0987654321"}


def invoice_operation(number="2026-001", invoicing=SDI_INVOICING, inclusive="122.00"):
    recipient = {
        "type": "BUSINESS",
        "name": {"legal": "Beta Distribuzione S.p.A."},
        "address": {
            "line": {"type": "STREET_NUMBER", "street": "Via Milano", "number": "2"},
            "code": "20100",
            "city": "Milano",
            "country": "IT",
            "region": "MI",
        },
        "identification": {"type": "VAT", "number": "IT09876543210"},
    }
    if invoicing is not None:
        recipient["invoicing"] = invoicing
    return {
        "type": "INVOICE",
        "document": {"number": number, "issued_at": "2026-08-26T09:00:00Z"},
        "entries": [
            {
                "type": "SALE",
                "data": {
                    "type": "ITEM",
                    "text": "Servizio di consulenza",
                    "unit": {"quantity": "1", "measure": "C62", "price": "122.00"},
                    "value": {"base": "100.00"},
                    "vat": {
                        "type": "VAT_RATE",
                        "code": "STANDARD",
                        "percentage": "22.00",
                        "amount": "22.00",
                        "exclusive": "100.00",
                        "inclusive": "122.00",
                    },
                },
                "details": {"concept": "SERVICE"},
            }
        ],
        "recipients": [recipient],
        "payments": [
            {
                "type": "OUTSTANDING",
                "concept": "INVOICE",
                "details": {"amount": inclusive, "currency": "EUR"},
            }
        ],
        "breakdown": [
            {
                "type": "VAT_RATE",
                "code": "STANDARD",
                "percentage": "22.00",
                "amount": "22.00",
                "exclusive": "100.00",
                "inclusive": inclusive,
            }
        ],
        "totals": {"vat": {"amount": "22.00", "exclusive": "100.00", "inclusive": inclusive}},
    }
