from __future__ import annotations

import pytest

from ai_knowledge.url_policy import is_official_umn_url


@pytest.mark.parametrize(
    "value",
    [
        "https://umn.edu/",
        "https://www.umn.edu/path",
        "https://ROCHESTER.UMN.EDU:443/campus/",
    ],
)
def test_official_umn_url_policy_accepts_only_canonical_navigation_links(value: str) -> None:
    assert is_official_umn_url(value)


@pytest.mark.parametrize(
    "value",
    [
        None,
        42,
        "",
        "http://umn.edu/",
        "https://umn.edu.evil.example/",
        "https://evil.example/?next=https://umn.edu/",
        "https://user@umn.edu/",
        "https://umn.edu:444/",
        "https://umn.edu:not-a-port/",
        "https://umn.edu/path?query=1",
        "https://umn.edu/path#fragment",
        "https://umn.edu./",
        "https://\u043c\u043d.edu/",
        "https://umn.edu/ newline",
        "//umn.edu/path",
    ],
)
def test_official_umn_url_policy_rejects_lookalikes_and_noncanonical_urls(value: object) -> None:
    assert not is_official_umn_url(value)
