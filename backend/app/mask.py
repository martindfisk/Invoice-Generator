import json
import re
import shlex

SECRET_KEYS = frozenset({"secret", "password", "pin", "bearer", "tax_id_number"})
BASE64_RE = re.compile(r"^[A-Za-z0-9+/_-]+={0,2}$")
BASE64_LIMIT = 2048
TOKEN_PLACEHOLDER = "Bearer $FISKALY_TOKEN"


def mask_key(value):
    return f"{value[:4]}***" if len(value) > 8 else "***"


def mask_headers(headers):
    return {
        name: _mask_authorization(value) if name.lower() == "authorization" else value
        for name, value in headers.items()
    }


def mask_json(value, key=None):
    if isinstance(value, dict):
        return {
            k: "***" if str(k).lower() in SECRET_KEYS else mask_json(v, str(k).lower())
            for k, v in value.items()
        }
    if isinstance(value, list):
        return [mask_json(item, key) for item in value]
    if isinstance(value, str):
        if key == "key":
            return mask_key(value)
        if len(value) > BASE64_LIMIT and BASE64_RE.match(value):
            return f"<base64 {len(value) * 3 // 4 - value.count('=')} bytes>"
    return value


def to_curl(method, url, headers, body=None):
    lines = [f"curl -X {method.upper()} {shlex.quote(str(url))}"]
    for name, value in headers.items():
        if name.lower() == "authorization":
            lines.append(f'-H "{name}: {TOKEN_PLACEHOLDER}"')
        else:
            lines.append(f"-H {shlex.quote(f'{name}: {value}')}")
    if body is not None:
        lines.append(f"--data {shlex.quote(json.dumps(body))}")
    return " \\\n  ".join(lines)


def _mask_authorization(value):
    scheme, _, token = value.partition(" ")
    if not token:
        return f"****{value[-4:]}"
    return f"{scheme} ****{token[-4:]}"
