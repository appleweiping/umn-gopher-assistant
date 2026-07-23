from __future__ import annotations

from urllib.parse import urlsplit


def is_official_umn_url(value: object) -> bool:
    """Match the public TypeScript citation URL policy without resolving the URL.

    Evidence links are navigation-only and must stay on the exact ``umn.edu``
    registrable domain.  No DNS or HTTP request is performed here, avoiding both
    availability coupling and a server-side request forgery primitive.
    """

    if not isinstance(value, str) or not value or any(character.isspace() for character in value):
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
