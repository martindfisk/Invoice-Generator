import json
import os
from urllib.parse import urlparse

from app.mask import mask_key
from app.settings import COUNTRIES, Account

BASE_URLS = {"test": "https://test.api.fiskaly.com", "live": "https://live.api.fiskaly.com"}


def environment_of(base_url):
    host = urlparse(base_url).hostname or ""
    return "live" if host.startswith("live.") else "test"


def known_country(country):
    if country not in COUNTRIES:
        raise ValueError(f"unknown country {country!r}; expected one of {COUNTRIES}")
    return country


class SettingsStore:
    """Runtime settings, persisted to a git-ignored JSON file so they survive restarts.

    A key present in the file is authoritative — an explicit null means "cleared", so the
    UI can override or clear a value that .env still carries. A key absent from the file
    falls back to the .env default. The minted bearer token is persisted too and carried
    over on restart until it expires or the credentials/environment change.
    """

    def __init__(self, settings):
        self.settings = settings
        self._path = settings.uapi_settings_file
        self._data = self._load()
        self._revision = 0

    @property
    def api_version(self):
        return self.settings.uapi_api_version

    @property
    def base_url(self):
        environment = self._data.get("environment")
        if environment in BASE_URLS:
            return BASE_URLS[environment]
        return self.settings.uapi_base_url

    @property
    def environment(self):
        return environment_of(self.base_url)

    @property
    def mode(self):
        stored = self._data.get("mode")
        return stored if stored in ("live", "mock") else self.settings.uapi_mode

    def revision(self):
        return self._revision

    def account(self):
        env = self.settings.account()
        if "api_key" in self._data:
            key = self._data.get("api_key")
            secret = self._data.get("api_secret")
            source = "stored" if key else "none"
        else:
            key, secret = env.api_key, env.api_secret
            source = "env" if key or secret else "none"
        return Account(key, secret, self._systems(env.systems), source)

    def credential_state(self):
        account = self.account()
        configured = not account.missing_credentials
        return {
            "configured": configured,
            "source": account.source if configured else "none",
            "fingerprint": mask_key(account.api_key) if configured else None,
        }

    def token(self):
        stored = self._data.get("token") or {}
        return stored.get("bearer"), stored.get("expires_at") or 0.0

    def set_token(self, bearer, expires_at):
        self._data["token"] = {"bearer": bearer, "expires_at": expires_at}
        self._save()

    def clear_token(self):
        if self._data.pop("token", None) is not None:
            self._save()

    def set_mode(self, mode):
        self._data["mode"] = mode
        self._save()

    def set_credentials(self, api_key, api_secret):
        self._data["api_key"] = api_key
        self._data["api_secret"] = api_secret
        self._data.pop("token", None)
        self._save()
        self._revision += 1

    def clear_credentials(self):
        self.set_credentials(None, None)

    def set_systems(self, systems):
        stored = self._data.setdefault("systems", {})
        for country, values in systems.items():
            target = stored.setdefault(known_country(country), {})
            target.update({field: value for field, value in values.items() if value is not None})
        self._save()

    def set_environment(self, environment):
        if BASE_URLS[environment] == self.base_url:
            return
        self._data["environment"] = environment
        # The bearer is environment-scoped: a token minted on TEST is invalid on LIVE.
        self._data.pop("token", None)
        self._save()
        self._revision += 1

    def _systems(self, env_systems):
        stored = self._data.get("systems") or {}
        merged = {}
        for country in COUNTRIES:
            env = env_systems.get(country) or {}
            override = stored.get(country, {})
            system_id = override["system_id"] if "system_id" in override else env.get("system_id")
            taxpayer_id = (
                override["taxpayer_id"] if "taxpayer_id" in override else env.get("taxpayer_id")
            )
            merged[country] = (
                {"system_id": system_id, "taxpayer_id": taxpayer_id} if system_id else None
            )
        return merged

    def _load(self):
        if not self._path.exists():
            return {}
        try:
            data = json.loads(self._path.read_text())
        except ValueError as exc:
            raise RuntimeError(
                f"{self._path} is not valid JSON ({exc}); fix or delete it and restart"
            ) from exc
        if not isinstance(data, dict):
            raise RuntimeError(f"{self._path} must hold a JSON object; fix or delete it")
        return data

    def _save(self):
        tmp = self._path.with_suffix(".tmp")
        self._path.parent.mkdir(parents=True, exist_ok=True)
        tmp.write_text(json.dumps(self._data, indent=2) + "\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, self._path)
