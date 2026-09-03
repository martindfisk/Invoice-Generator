from dataclasses import dataclass
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parents[2]
PERSONAS = ("seller", "buyer")
COUNTRIES = ("IT", "BE", "DE")


def default_api_version():
    version_file = REPO_ROOT / "spec" / "version.txt"
    return version_file.read_text().strip() if version_file.exists() else "2026-06-01"


@dataclass
class Persona:
    name: str
    api_key: str | None
    api_secret: str | None
    systems: dict
    source: str = "env"

    @property
    def missing_credentials(self):
        prefix = self.name.upper()
        values = (("API_KEY", self.api_key), ("API_SECRET", self.api_secret))
        return [f"{prefix}_{suffix}" for suffix, value in values if not value]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=REPO_ROOT / ".env", extra="ignore")

    uapi_base_url: str = "https://test.api.fiskaly.com"
    uapi_api_version: str = Field(default_factory=default_api_version)
    uapi_mode: Literal["live", "mock"] = "mock"
    uapi_record: bool = False
    allow_mode_override: bool = False

    seller_api_key: str | None = None
    seller_api_secret: str | None = None
    seller_system_id_it: str | None = None
    seller_taxpayer_id_it: str | None = None
    seller_system_id_be: str | None = None
    seller_taxpayer_id_be: str | None = None
    seller_system_id_de: str | None = None
    seller_taxpayer_id_de: str | None = None

    buyer_api_key: str | None = None
    buyer_api_secret: str | None = None
    buyer_system_id_it: str | None = None
    buyer_taxpayer_id_it: str | None = None
    buyer_system_id_be: str | None = None
    buyer_taxpayer_id_be: str | None = None
    buyer_system_id_de: str | None = None
    buyer_taxpayer_id_de: str | None = None
    buyer_sdi_destination_code: str | None = None
    buyer_peppol_id: str | None = None

    cors_origins: str = "http://localhost:5173"
    recorder_capacity: int = 500
    poll_interval_s: float = 2.0
    poll_timeout_s: float = 60.0
    log_level: str = "INFO"
    vendor_dir: Path = REPO_ROOT / "vendor"
    spec_dir: Path = REPO_ROOT / "spec"

    @property
    def environment(self):
        host = urlparse(self.uapi_base_url).hostname or ""
        return "live" if host.startswith("live.") else "test"

    @property
    def cors_origin_list(self):
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    def persona(self, name):
        if name not in PERSONAS:
            raise ValueError(f"unknown persona {name!r}; expected one of {PERSONAS}")
        systems = {}
        for country in COUNTRIES:
            system_id = getattr(self, f"{name}_system_id_{country.lower()}")
            taxpayer_id = getattr(self, f"{name}_taxpayer_id_{country.lower()}")
            systems[country] = (
                {"system_id": system_id, "taxpayer_id": taxpayer_id} if system_id else None
            )
        return Persona(
            name, getattr(self, f"{name}_api_key"), getattr(self, f"{name}_api_secret"), systems
        )

    def validate_live(self):
        if self.uapi_mode != "live":
            return
        for name in PERSONAS:
            missing = self.persona(name).missing_credentials
            if missing:
                raise ValueError(f"UAPI_MODE=live but {', '.join(missing)} missing in .env")
