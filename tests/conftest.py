import pytest

from app import guards


@pytest.fixture(autouse=True)
def _fresh_rate_limit():
    """Each test starts with an empty per-client rate limit, so the suite's size never trips it."""
    guards._hits.clear()
    yield
