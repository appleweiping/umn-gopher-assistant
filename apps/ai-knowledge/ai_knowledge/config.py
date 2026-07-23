from __future__ import annotations

import base64
import binascii
import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal
from urllib.parse import parse_qs, urlsplit

_FALSE_VALUES = frozenset({"0", "false", "no", "off", "disabled"})
_TRUE_VALUES = frozenset({"1", "true", "yes", "on", "enabled"})
_ENVIRONMENTS = frozenset({"development", "production", "test"})
_BACKENDS = frozenset({"file", "postgres"})
_BASE64URL_RE = re.compile(r"^[A-Za-z0-9_-]+$")
_PRODUCTION_SSL_MODES = frozenset({"require", "verify-ca", "verify-full"})
_DEVELOPMENT_SERVICE_HMAC_KEY = b"development-only-ai-service-hmac-key-v1"

RuntimeEnvironment = Literal["development", "production", "test"]
KnowledgeBackend = Literal["file", "postgres"]


class ConfigurationError(RuntimeError):
    """Runtime configuration is incomplete or unsafe for the selected environment."""


def _decode_service_hmac_key(encoded: str, *, name: str) -> bytes:
    if not encoded or encoded.strip() != encoded or not _BASE64URL_RE.fullmatch(encoded):
        raise ConfigurationError(f"{name} must be canonical base64url")
    try:
        decoded = base64.b64decode(
            encoded + ("=" * (-len(encoded) % 4)), altchars=b"-_", validate=True
        )
    except (ValueError, binascii.Error) as error:
        raise ConfigurationError(f"{name} must be canonical base64url") from error
    canonical = base64.urlsafe_b64encode(decoded).rstrip(b"=").decode("ascii")
    if canonical != encoded or not 32 <= len(decoded) <= 64:
        raise ConfigurationError(
            f"{name} must encode between 32 and 64 bytes as canonical base64url"
        )
    return decoded


@dataclass(frozen=True, slots=True)
class Settings:
    corpus_path: Path
    environment: RuntimeEnvironment = "development"
    backend: KnowledgeBackend = "file"
    database_url: str | None = field(default=None, repr=False)
    database_connect_timeout_seconds: int = 5
    database_pool_min_size: int = 1
    database_pool_max_size: int = 10
    database_pool_wait_seconds: float = 3.0
    snapshot_cache_ttl_seconds: float = 30.0
    revision_check_interval_seconds: float = 1.0
    max_request_bytes: int = 8_192
    top_k: int = 3
    service_hmac_key: bytes = field(default=_DEVELOPMENT_SERVICE_HMAC_KEY, repr=False)
    service_auth_max_skew_seconds: int = 60
    enabled_environment_variable: str = "AI_KNOWLEDGE_ENABLED"
    enabled_default: bool = True

    def __post_init__(self) -> None:
        if self.environment not in _ENVIRONMENTS:
            raise ConfigurationError("NODE_ENV must be development, production, or test")
        if self.backend not in _BACKENDS:
            raise ConfigurationError("AI_KNOWLEDGE_BACKEND must be file or postgres")
        if not 1 <= self.database_connect_timeout_seconds <= 30:
            raise ConfigurationError("database connect timeout must be between 1 and 30 seconds")
        if not 0 <= self.database_pool_min_size <= 20:
            raise ConfigurationError("database pool minimum size must be between 0 and 20")
        if not 1 <= self.database_pool_max_size <= 100:
            raise ConfigurationError("database pool maximum size must be between 1 and 100")
        if self.database_pool_min_size > self.database_pool_max_size:
            raise ConfigurationError("database pool minimum size cannot exceed its maximum")
        if not 0.1 <= self.database_pool_wait_seconds <= 30:
            raise ConfigurationError("database pool wait must be between 0.1 and 30 seconds")
        if not 1 <= self.snapshot_cache_ttl_seconds <= 300:
            raise ConfigurationError("snapshot cache TTL must be between 1 and 300 seconds")
        if not 0.1 <= self.revision_check_interval_seconds <= 10:
            raise ConfigurationError("revision check interval must be between 0.1 and 10 seconds")
        if self.revision_check_interval_seconds > self.snapshot_cache_ttl_seconds:
            raise ConfigurationError("revision check interval cannot exceed snapshot cache TTL")
        if self.environment == "production" and self.backend != "postgres":
            raise ConfigurationError("production requires the postgres knowledge backend")
        if not 32 <= len(self.service_hmac_key) <= 64:
            raise ConfigurationError(
                "AI knowledge service HMAC key must contain 32 through 64 bytes"
            )
        if (
            self.environment == "production"
            and self.service_hmac_key == _DEVELOPMENT_SERVICE_HMAC_KEY
        ):
            raise ConfigurationError(
                "production must not use the fixed development service HMAC key"
            )
        if not 10 <= self.service_auth_max_skew_seconds <= 300:
            raise ConfigurationError(
                "service authentication clock skew must be between 10 and 300 seconds"
            )
        if self.backend == "postgres":
            if not self.database_url or not self.database_url.strip():
                raise ConfigurationError("DATABASE_URL is required for the postgres backend")
            parsed = urlsplit(self.database_url)
            if parsed.scheme not in {"postgres", "postgresql"} or not parsed.path.strip("/"):
                raise ConfigurationError(
                    "DATABASE_URL must be a PostgreSQL URL with a database name"
                )
            if self.environment == "production":
                ssl_modes = parse_qs(parsed.query, keep_blank_values=True).get("sslmode", [])
                if len(ssl_modes) != 1 or ssl_modes[0] not in _PRODUCTION_SSL_MODES:
                    raise ConfigurationError(
                        "production DATABASE_URL must set sslmode=require, "
                        "verify-ca, or verify-full"
                    )

    @classmethod
    def from_environment(cls, environment: Mapping[str, str] | None = None) -> Settings:
        values = os.environ if environment is None else environment
        default_corpus = Path(__file__).resolve().parent / "data" / "corpus.json"
        configured_path = values.get("AI_KNOWLEDGE_CORPUS_PATH")
        runtime_environment = values.get("NODE_ENV", "development").strip().casefold()
        default_backend = "postgres" if runtime_environment == "production" else "file"
        backend = values.get("AI_KNOWLEDGE_BACKEND", default_backend).strip().casefold()
        database_url = values.get("DATABASE_URL")
        encoded_service_hmac_key = values.get("AI_KNOWLEDGE_SERVICE_HMAC_KEY")
        if encoded_service_hmac_key is None:
            if runtime_environment == "production":
                raise ConfigurationError("AI_KNOWLEDGE_SERVICE_HMAC_KEY is required in production")
            service_hmac_key = _DEVELOPMENT_SERVICE_HMAC_KEY
        else:
            service_hmac_key = _decode_service_hmac_key(
                encoded_service_hmac_key, name="AI_KNOWLEDGE_SERVICE_HMAC_KEY"
            )
        try:
            database_connect_timeout_seconds = int(
                values.get("AI_KNOWLEDGE_DATABASE_CONNECT_TIMEOUT_SECONDS", "5")
            )
            database_pool_min_size = int(values.get("AI_KNOWLEDGE_DATABASE_POOL_MIN_SIZE", "1"))
            database_pool_max_size = int(values.get("AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE", "10"))
            database_pool_wait_seconds = float(
                values.get("AI_KNOWLEDGE_DATABASE_POOL_WAIT_SECONDS", "3")
            )
            snapshot_cache_ttl_seconds = float(
                values.get("AI_KNOWLEDGE_SNAPSHOT_CACHE_TTL_SECONDS", "30")
            )
            revision_check_interval_seconds = float(
                values.get("AI_KNOWLEDGE_REVISION_CHECK_INTERVAL_SECONDS", "1")
            )
        except ValueError as error:
            raise ConfigurationError("numeric AI knowledge configuration is invalid") from error
        return cls(
            corpus_path=Path(configured_path).resolve() if configured_path else default_corpus,
            environment=runtime_environment,  # type: ignore[arg-type]
            backend=backend,  # type: ignore[arg-type]
            database_url=database_url,
            database_connect_timeout_seconds=database_connect_timeout_seconds,
            database_pool_min_size=database_pool_min_size,
            database_pool_max_size=database_pool_max_size,
            database_pool_wait_seconds=database_pool_wait_seconds,
            snapshot_cache_ttl_seconds=snapshot_cache_ttl_seconds,
            revision_check_interval_seconds=revision_check_interval_seconds,
            service_hmac_key=service_hmac_key,
        )

    def is_enabled(self) -> bool:
        raw_value = os.environ.get(self.enabled_environment_variable)
        if raw_value is None:
            return self.enabled_default
        normalized = raw_value.strip().casefold()
        if normalized in _TRUE_VALUES:
            return True
        if normalized in _FALSE_VALUES:
            return False
        # Unknown values fail closed instead of silently enabling retrieval.
        return False
