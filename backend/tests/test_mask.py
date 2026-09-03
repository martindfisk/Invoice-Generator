from app.mask import mask_headers, mask_json, mask_key, to_curl


def test_mask_headers_masks_authorization_case_insensitively():
    headers = {"Authorization": "Bearer eyJabc.def.xyz9876", "X-Api-Version": "2026-06-01"}
    assert mask_headers(headers) == {
        "Authorization": "Bearer ****9876",
        "X-Api-Version": "2026-06-01",
    }
    assert mask_headers({"authorization": "Bearer abcd"}) == {"authorization": "Bearer ****abcd"}
    assert mask_headers({"Authorization": "rawtoken1234"}) == {"Authorization": "****1234"}
    assert headers["Authorization"] == "Bearer eyJabc.def.xyz9876"


def test_mask_json_masks_secret_keys_recursively_without_mutating():
    payload = {
        "content": {"type": "API_KEY", "key": "abcd-efgh-ijkl", "secret": "s3cret"},
        "nested": [{"password": "x", "PIN": 1234}, {"authentication": {"bearer": "tok"}}],
        "key": "short",
    }
    masked = mask_json(payload)
    assert masked["content"] == {"type": "API_KEY", "key": "abcd***", "secret": "***"}
    assert masked["nested"] == [
        {"password": "***", "PIN": "***"},
        {"authentication": {"bearer": "***"}},
    ]
    assert masked["key"] == "***"
    assert payload["content"]["secret"] == "s3cret"
    assert mask_json(None) is None


def test_mask_json_masks_the_taxpayer_fiscal_credential():
    payload = {
        "fiscalization": {"credentials": [{"type": "CF", "tax_id_number": "RSSMRA80A01H501U"}]}
    }
    masked = mask_json(payload)
    assert masked["fiscalization"]["credentials"][0]["tax_id_number"] == "***"


def test_mask_json_shortens_large_base64_only():
    data = "QUJD" * 1024
    masked = mask_json({"artifact": {"type": "application/xml", "data": data}, "small": "QUJD"})
    assert masked["artifact"]["data"] == "<base64 3072 bytes>"
    assert masked["small"] == "QUJD"
    prose = "not base64 " * 400
    assert mask_json(prose) == prose


def test_to_curl_uses_token_placeholder_and_quotes_body():
    headers = {
        "Authorization": "Bearer ****9876",
        "X-Api-Version": "2026-06-01",
        "Content-Type": "application/json",
    }
    body = {"content": {"type": "INTENTION", "note": "it's"}}
    curl = to_curl("post", "https://test.api.fiskaly.com/records?limit=1", headers, body)
    assert curl.startswith("curl -X POST 'https://test.api.fiskaly.com/records?limit=1' \\\n  ")
    assert '-H "Authorization: Bearer $FISKALY_TOKEN"' in curl
    assert "9876" not in curl
    assert "-H 'X-Api-Version: 2026-06-01'" in curl
    assert '--data \'{"content": {"type": "INTENTION", "note": "it\'"\'"\'s"}}\'' in curl
    assert "--data" not in to_curl("GET", "https://test.api.fiskaly.com/systems", {})


def test_mask_json_masks_key_values_inside_lists():
    assert mask_json({"key": ["abcd-efgh-ijkl", "short"]}) == {"key": ["abcd***", "***"]}


def test_mask_key_keeps_only_a_four_character_prefix():
    assert mask_key("session-seller-key-9f3a") == "sess***"
    assert mask_key("123456789") == "1234***"
    assert mask_key("12345678") == "***"
    assert mask_key("") == "***"
