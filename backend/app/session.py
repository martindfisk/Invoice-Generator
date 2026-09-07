from urllib.parse import urlparse

from app.mask import mask_key
from app.settings import COUNTRIES, PERSONAS, Persona

BASE_URLS = {"test": "https://test.api.fiskaly.com", "live": "https://live.api.fiskaly.com"}
RECIPIENT_FIELDS = ("sdi_destination_code", "peppol_id")


def environment_of(base_url):
    host = urlparse(base_url).hostname or ""
    return "live" if host.startswith("live.") else "test"


def known_persona(name):
    if name not in PERSONAS:
        raise ValueError(f"unknown persona {name!r}; expected one of {PERSONAS}")
    return name


def known_country(country):
    if country not in COUNTRIES:
        raise ValueError(f"unknown country {country!r}; expected one of {COUNTRIES}")
    return country


class SessionStore:
    def __init__(self, settings):
        self.settings = settings
        self._credentials = {}
        self._systems = {name: {} for name in PERSONAS}
        self._recipients = {name: {} for name in PERSONAS}
        self._base_url = None
        self._revisions = dict.fromkeys(PERSONAS, 0)

    @property
    def api_version(self):
        return self.settings.uapi_api_version

    @property
    def base_url(self):
        return self._base_url or self.settings.uapi_base_url

    @property
    def environment(self):
        return environment_of(self.base_url)

    def revision(self, name):
        return self._revisions[known_persona(name)]

    def persona(self, name):
        env = self.settings.persona(known_persona(name))
        key, secret = self._credentials.get(name, (None, None))
        source = "session" if key else "env" if env.api_key or env.api_secret else "none"
        return Persona(
            name=name,
            api_key=key or env.api_key,
            api_secret=secret or env.api_secret,
            systems=self._systems_for(name, env.systems),
            source=source,
        )

    def credential_state(self, name):
        persona = self.persona(name)
        configured = not persona.missing_credentials
        return {
            "configured": configured,
            "source": persona.source if configured else "none",
            "fingerprint": mask_key(persona.api_key) if configured else None,
        }

    def recipients(self, name):
        override = self._recipients[known_persona(name)]
        return {
            field: override.get(field) or getattr(self.settings, f"{name}_{field}", None) or None
            for field in RECIPIENT_FIELDS
        }

    def set_credentials(self, name, api_key, api_secret):
        self._credentials[known_persona(name)] = (api_key, api_secret)
        self._revisions[name] += 1

    def clear_credentials(self, name):
        if self._credentials.pop(known_persona(name), None) is not None:
            self._revisions[name] += 1

    def set_systems(self, name, systems):
        for country, values in systems.items():
            target = self._systems[known_persona(name)].setdefault(known_country(country), {})
            target.update({field: value for field, value in values.items() if value is not None})

    def set_recipients(self, name, recipients):
        self._recipients[known_persona(name)].update(
            {field: value for field, value in recipients.items() if value is not None}
        )

    def set_environment(self, environment):
        base_url = BASE_URLS[environment]
        if base_url == self.base_url:
            return
        self._base_url = base_url
        for name in PERSONAS:
            self._revisions[name] += 1

    def _systems_for(self, name, env_systems):
        merged = {}
        for country in COUNTRIES:
            env = env_systems.get(country) or {}
            override = self._systems[name].get(country, {})
            system_id = override.get("system_id") or env.get("system_id")
            taxpayer_id = override.get("taxpayer_id") or env.get("taxpayer_id")
            merged[country] = (
                {"system_id": system_id, "taxpayer_id": taxpayer_id} if system_id else None
            )
        return merged
