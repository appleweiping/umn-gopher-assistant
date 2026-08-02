from __future__ import annotations

import re
from urllib.parse import urlsplit

PROJECT_SUMMARY_URL = (
    "https://github.com/appleweiping/umn-gopher-assistant/"
    "blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json"
)
_PROJECT_SUMMARY_URL_RE = re.compile(
    r"^[Hh][Tt][Tt][Pp][Ss]://[Gg][Ii][Tt][Hh][Uu][Bb]\.[Cc][Oo][Mm](?::443)?/"
    r"appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/"
    r"ai_knowledge/data/corpus\.json$"
)


def is_project_summary_url(value: object) -> bool:
    """Accept only the canonical project-authored corpus artifact.

    The raw URL grammar binds citation provenance to the exact file whose digest
    is reported.  Only scheme and host casing plus the explicit default HTTPS
    port may vary before URL normalization.
    """

    if not isinstance(value, str) or _PROJECT_SUMMARY_URL_RE.fullmatch(value) is None:
        return False
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    return (
        hostname is not None
        and hostname.casefold() == "github.com"
        and parsed.scheme.casefold() == "https"
        and parsed.username is None
        and parsed.password is None
        and port in {None, 443}
        and not parsed.query
        and not parsed.fragment
    )


def is_official_umn_url(value: object) -> bool:
    """Match the public TypeScript citation URL policy without resolving the URL.

    Evidence links are navigation-only and must stay on the exact ``umn.edu``
    registrable domain.  No DNS or HTTP request is performed here, avoiding both
    availability coupling and a server-side request forgery primitive.
    """

    if (
        not isinstance(value, str)
        or not value
        or "@" in value
        or any(character.isspace() for character in value)
    ):
        return False
    try:
        parsed = urlsplit(value)
        hostname = parsed.hostname
        port = parsed.port
    except ValueError:
        return False
    if not hostname or not hostname.isascii():
        return False
    normalized_hostname = hostname.casefold()
    return (
        parsed.scheme.casefold() == "https"
        and (normalized_hostname == "umn.edu" or normalized_hostname.endswith(".umn.edu"))
        and parsed.username is None
        and parsed.password is None
        and port in {None, 443}
        and not parsed.query
        and not parsed.fragment
    )
