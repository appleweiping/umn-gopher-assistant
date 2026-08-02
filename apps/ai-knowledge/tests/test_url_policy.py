from __future__ import annotations

import pytest

from ai_knowledge.url_policy import is_official_umn_url, is_project_summary_url

PROJECT_CORPUS_PATH = (
    "/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/corpus.json"
)


@pytest.mark.parametrize(
    "value",
    [
        f"https://github.com{PROJECT_CORPUS_PATH}",
        f"https://GITHUB.COM:443{PROJECT_CORPUS_PATH}",
    ],
)
def test_project_summary_url_policy_accepts_canonical_corpus_url(value: str) -> None:
    assert is_project_summary_url(value)


@pytest.mark.parametrize(
    "value",
    [
        None,
        42,
        "",
        f"http://github.com{PROJECT_CORPUS_PATH}",
        f"https://user@github.com{PROJECT_CORPUS_PATH}",
        f"https://github.com:444{PROJECT_CORPUS_PATH}",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/../corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/./corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2e%2e/corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/%2F/corpus.json",
        "https://github.com/appleweiping/other-project/blob/main/corpus.json",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/main/README.md",
        "https://github.com/appleweiping/umn-gopher-assistant/blob/main/apps/ai-knowledge/ai_knowledge/data/CORPUS.json",
        f"https://github.com{PROJECT_CORPUS_PATH}?raw=1",
        f"https://github.com{PROJECT_CORPUS_PATH}#fragment",
    ],
)
def test_project_summary_url_policy_rejects_ambiguous_or_external_paths(
    value: object,
) -> None:
    assert not is_project_summary_url(value)


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
        "https://umn.edu/dept/@current",
        "https://umn.edu./",
        "https://\u043c\u043d.edu/",
        "https://umn.edu/ newline",
        "//umn.edu/path",
    ],
)
def test_official_umn_url_policy_rejects_lookalikes_and_noncanonical_urls(value: object) -> None:
    assert not is_official_umn_url(value)
