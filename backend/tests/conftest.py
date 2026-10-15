import pytest
from django.core.cache import cache
from rest_framework.test import APIClient

from apps.accounts.models import User
from apps.workspaces.services import create_default_workspace
from services.embeddings import get_embedding_provider
from services.llm import get_llm_provider


@pytest.fixture(autouse=True)
def _media_root(tmp_path, settings):
    # Keep uploaded test files out of the real media directory.
    settings.MEDIA_ROOT = tmp_path / "media"


@pytest.fixture(autouse=True)
def _isolated_cache(settings):
    # Throttle counters live in the cache: use a private in-memory one, emptied
    # for every test, so tests neither need Redis nor rate-limit each other.
    settings.CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
    cache.clear()
    yield
    cache.clear()


@pytest.fixture(autouse=True)
def _fake_embeddings(settings):
    # Never call a real embedding API from tests.
    settings.EMBEDDING_PROVIDER = "fake"
    get_embedding_provider.cache_clear()
    yield
    get_embedding_provider.cache_clear()


@pytest.fixture(autouse=True)
def _fake_llm(settings):
    # Never call a real LLM API from tests.
    settings.LLM_PROVIDER = "fake"
    get_llm_provider.cache_clear()
    yield
    get_llm_provider.cache_clear()


@pytest.fixture
def api_client() -> APIClient:
    return APIClient()


def _make_user(email: str) -> User:
    user = User.objects.create_user(email=email, password="s3cure-pass-123")
    create_default_workspace(user)
    return user


@pytest.fixture
def user(db) -> User:
    return _make_user("alice@example.com")


@pytest.fixture
def other_user(db) -> User:
    return _make_user("bob@example.com")


@pytest.fixture
def auth_client(user) -> APIClient:
    client = APIClient()
    client.force_authenticate(user)
    return client


@pytest.fixture
def workspace(user):
    return user.owned_workspaces.first()


@pytest.fixture
def other_workspace(other_user):
    return other_user.owned_workspaces.first()
