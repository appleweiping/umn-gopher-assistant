from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import re
import time
from collections.abc import Callable
from threading import Lock

_SIGNATURE_RE = re.compile(r"^[a-f0-9]{64}$")
_TIMESTAMP_RE = re.compile(r"^[1-9][0-9]{9}$")
_TRACE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$")

SERVICE_AUTH_SIGNATURE_HEADER = "x-ai-service-signature"
SERVICE_AUTH_TIMESTAMP_HEADER = "x-ai-service-timestamp"
SERVICE_AUTH_NONCE_HEADER = "x-ai-service-nonce"
SERVICE_QUERY_PATH = "/v1/query"


def canonical_service_request(
    *, method: str, path: str, body: bytes, trace_id: str, timestamp: str, nonce: str
) -> bytes:
    body_sha256 = hashlib.sha256(body).hexdigest()
    return f"{method}\n{path}\n{body_sha256}\n{trace_id}\n{timestamp}\n{nonce}".encode()


def sign_service_request(
    key: bytes,
    *,
    body: bytes,
    trace_id: str,
    timestamp: str,
    nonce: str,
    path: str = SERVICE_QUERY_PATH,
) -> str:
    canonical = canonical_service_request(
        method="POST",
        path=path,
        body=body,
        trace_id=trace_id,
        timestamp=timestamp,
        nonce=nonce,
    )
    return hmac.new(key, canonical, hashlib.sha256).hexdigest()


class ServiceRequestAuthenticator:
    """Verify signed private requests and reject same-process replays within the clock window."""

    def __init__(
        self,
        key: bytes,
        *,
        max_skew_seconds: int,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._key = bytes(key)
        self._max_skew_seconds = max_skew_seconds
        self._clock = clock
        self._seen_signatures: dict[str, int] = {}
        self._seen_nonces: dict[str, int] = {}
        self._lock = Lock()

    def verify_once(
        self,
        *,
        method: str,
        path: str,
        body: bytes,
        trace_id: str | None,
        timestamp: str | None,
        nonce: str | None,
        signature: str | None,
    ) -> bool:
        valid_trace = trace_id is not None and _TRACE_ID_RE.fullmatch(trace_id) is not None
        valid_timestamp = timestamp is not None and _TIMESTAMP_RE.fullmatch(timestamp) is not None
        valid_signature = signature is not None and _SIGNATURE_RE.fullmatch(signature) is not None
        valid_nonce = _is_canonical_nonce(nonce)

        canonical_trace = trace_id if valid_trace else "invalid-trace"
        canonical_timestamp = timestamp if valid_timestamp else "0"
        canonical_nonce = nonce if valid_nonce and nonce is not None else "invalid-nonce"
        expected = sign_service_request(
            self._key,
            body=body,
            trace_id=canonical_trace,
            timestamp=canonical_timestamp,
            nonce=canonical_nonce,
            path=path,
        )
        candidate = signature if valid_signature else "0" * 64
        signature_matches = hmac.compare_digest(expected, candidate)

        now = int(self._clock())
        request_time = int(canonical_timestamp) if valid_timestamp else 0
        fresh = abs(now - request_time) <= self._max_skew_seconds
        if method != "POST" or path != SERVICE_QUERY_PATH:
            return False
        if not (
            valid_trace
            and valid_timestamp
            and valid_nonce
            and valid_signature
            and signature_matches
            and fresh
        ):
            return False

        with self._lock:
            expired = [value for value, expiry in self._seen_signatures.items() if expiry < now]
            for value in expired:
                del self._seen_signatures[value]
            expired_nonces = [value for value, expiry in self._seen_nonces.items() if expiry < now]
            for value in expired_nonces:
                del self._seen_nonces[value]
            assert nonce is not None
            if candidate in self._seen_signatures or nonce in self._seen_nonces:
                return False
            self._seen_signatures[candidate] = request_time + self._max_skew_seconds
            self._seen_nonces[nonce] = request_time + self._max_skew_seconds
        return True


def _is_canonical_nonce(value: str | None) -> bool:
    if value is None or len(value) != 22:
        return False
    try:
        decoded = base64.b64decode(value + "==", altchars=b"-_", validate=True)
    except (ValueError, binascii.Error):
        return False
    return len(decoded) == 16 and base64.urlsafe_b64encode(decoded).rstrip(b"=").decode() == value
