from __future__ import annotations

import base64
from pathlib import Path

import pytest

from ai_knowledge.config import ConfigurationError, Settings

PRODUCTION_SERVICE_KEY = base64.urlsafe_b64encode(b"k" * 32).rstrip(b"=").decode("ascii")


def test_production_defaults_to_postgres_and_requires_database_url() -> None:
    with pytest.raises(ConfigurationError, match="DATABASE_URL is required"):
        Settings.from_environment(
            {
                "NODE_ENV": "production",
                "AI_KNOWLEDGE_SERVICE_HMAC_KEY": PRODUCTION_SERVICE_KEY,
            }
        )

    settings = Settings.from_environment(
        {
            "NODE_ENV": "production",
            "DATABASE_URL": "postgresql://gopher:secret@postgres:5432/gopher?sslmode=require",
            "AI_KNOWLEDGE_SERVICE_HMAC_KEY": PRODUCTION_SERVICE_KEY,
        }
    )
    assert settings.backend == "postgres"
    assert settings.environment == "production"
    assert "secret" not in repr(settings)


def test_production_rejects_file_backend_even_when_database_url_exists() -> None:
    with pytest.raises(ConfigurationError, match="production requires"):
        Settings.from_environment(
            {
                "NODE_ENV": "production",
                "AI_KNOWLEDGE_BACKEND": "file",
                "DATABASE_URL": "postgresql://gopher:secret@postgres:5432/gopher",
                "AI_KNOWLEDGE_SERVICE_HMAC_KEY": PRODUCTION_SERVICE_KEY,
            }
        )


def test_production_requires_a_strong_canonical_service_hmac_key() -> None:
    with pytest.raises(ConfigurationError, match="HMAC_KEY is required"):
        Settings.from_environment(
            {
                "NODE_ENV": "production",
                "DATABASE_URL": "postgresql:///gopher?sslmode=verify-full",
            }
        )

    for invalid in ("short", "a" * 43 + "=", "a" * 42, "a" * 87):
        with pytest.raises(ConfigurationError, match=r"canonical base64url|32 and 64 bytes"):
            Settings.from_environment(
                {
                    "NODE_ENV": "production",
                    "DATABASE_URL": "postgresql:///gopher?sslmode=verify-full",
                    "AI_KNOWLEDGE_SERVICE_HMAC_KEY": invalid,
                }
            )

    development_key = (
        base64.urlsafe_b64encode(b"development-only-ai-service-hmac-key-v1")
        .rstrip(b"=")
        .decode("ascii")
    )
    with pytest.raises(ConfigurationError, match="fixed development"):
        Settings.from_environment(
            {
                "NODE_ENV": "production",
                "DATABASE_URL": "postgresql:///gopher?sslmode=verify-full",
                "AI_KNOWLEDGE_SERVICE_HMAC_KEY": development_key,
            }
        )


@pytest.mark.parametrize(
    "database_url",
    [
        "postgresql:///gopher",
        "postgresql:///gopher?sslmode=disable",
        "postgresql:///gopher?sslmode=allow",
        "postgresql:///gopher?sslmode=prefer",
        "postgresql:///gopher?sslmode=require&sslmode=verify-full",
    ],
)
def test_production_rejects_database_connections_without_required_tls(
    database_url: str,
) -> None:
    with pytest.raises(ConfigurationError, match="sslmode"):
        Settings.from_environment(
            {
                "NODE_ENV": "production",
                "DATABASE_URL": database_url,
                "AI_KNOWLEDGE_SERVICE_HMAC_KEY": PRODUCTION_SERVICE_KEY,
            }
        )


@pytest.mark.parametrize("sslmode", ["require", "verify-ca", "verify-full"])
def test_production_accepts_only_encrypted_postgres_ssl_modes(sslmode: str) -> None:
    settings = Settings.from_environment(
        {
            "NODE_ENV": "production",
            "DATABASE_URL": f"postgresql:///gopher?sslmode={sslmode}",
            "AI_KNOWLEDGE_SERVICE_HMAC_KEY": PRODUCTION_SERVICE_KEY,
        }
    )
    assert settings.environment == "production"


@pytest.mark.parametrize("environment", ["development", "test"])
def test_nonproduction_can_explicitly_select_file_backend(environment: str, tmp_path: Path) -> None:
    corpus_path = tmp_path / "release.json"
    settings = Settings.from_environment(
        {
            "NODE_ENV": environment,
            "AI_KNOWLEDGE_BACKEND": "file",
            "AI_KNOWLEDGE_CORPUS_PATH": str(corpus_path),
        }
    )
    assert settings.backend == "file"
    assert settings.corpus_path == corpus_path.resolve()
    assert settings.database_url is None


@pytest.mark.parametrize(
    ("values", "message"),
    [
        ({"NODE_ENV": "preview"}, "NODE_ENV"),
        ({"NODE_ENV": "test", "AI_KNOWLEDGE_BACKEND": "memory"}, "BACKEND"),
        (
            {
                "NODE_ENV": "test",
                "AI_KNOWLEDGE_BACKEND": "postgres",
                "DATABASE_URL": "https://database.example/gopher",
            },
            "PostgreSQL URL",
        ),
    ],
)
def test_invalid_runtime_configuration_fails_closed(values: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigurationError, match=message):
        Settings.from_environment(values)


def test_database_timeout_is_bounded() -> None:
    with pytest.raises(ConfigurationError, match="connect timeout"):
        Settings(
            corpus_path=Path("corpus.json"),
            backend="postgres",
            database_url="postgresql:///gopher",
            database_connect_timeout_seconds=31,
        )


def test_pool_and_cache_configuration_is_explicit_and_bounded() -> None:
    settings = Settings.from_environment(
        {
            "NODE_ENV": "test",
            "AI_KNOWLEDGE_BACKEND": "postgres",
            "DATABASE_URL": "postgresql:///gopher",
            "AI_KNOWLEDGE_DATABASE_CONNECT_TIMEOUT_SECONDS": "7",
            "AI_KNOWLEDGE_DATABASE_POOL_MIN_SIZE": "2",
            "AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE": "12",
            "AI_KNOWLEDGE_DATABASE_POOL_WAIT_SECONDS": "2.5",
            "AI_KNOWLEDGE_SNAPSHOT_CACHE_TTL_SECONDS": "45",
            "AI_KNOWLEDGE_REVISION_CHECK_INTERVAL_SECONDS": "0.5",
        }
    )
    assert settings.database_connect_timeout_seconds == 7
    assert settings.database_pool_min_size == 2
    assert settings.database_pool_max_size == 12
    assert settings.database_pool_wait_seconds == 2.5
    assert settings.snapshot_cache_ttl_seconds == 45
    assert settings.revision_check_interval_seconds == 0.5


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"AI_KNOWLEDGE_DATABASE_POOL_MIN_SIZE": "11"}, "minimum size"),
        ({"AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE": "0"}, "maximum size"),
        ({"AI_KNOWLEDGE_DATABASE_POOL_WAIT_SECONDS": "0"}, "pool wait"),
        ({"AI_KNOWLEDGE_SNAPSHOT_CACHE_TTL_SECONDS": "0"}, "cache TTL"),
        ({"AI_KNOWLEDGE_REVISION_CHECK_INTERVAL_SECONDS": "11"}, "revision check"),
        ({"AI_KNOWLEDGE_DATABASE_POOL_MAX_SIZE": "not-a-number"}, "numeric"),
    ],
)
def test_invalid_pool_and_cache_configuration_fails_closed(
    overrides: dict[str, str], message: str
) -> None:
    values = {
        "NODE_ENV": "test",
        "AI_KNOWLEDGE_BACKEND": "postgres",
        "DATABASE_URL": "postgresql:///gopher",
        **overrides,
    }
    with pytest.raises(ConfigurationError, match=message):
        Settings.from_environment(values)
