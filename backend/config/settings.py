"""Django settings for DocuChat. All environment-specific values come from env vars."""

import os
from datetime import timedelta
from pathlib import Path

import dj_database_url

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool = False) -> bool:
    return os.environ.get(name, str(default)).lower() in {"1", "true", "yes"}


def env_list(name: str, default: str = "") -> list[str]:
    return [v.strip() for v in os.environ.get(name, default).split(",") if v.strip()]


DEBUG = env_bool("DJANGO_DEBUG", False)
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or ("dev-insecure-secret-key" if DEBUG else "")
if not SECRET_KEY:
    raise RuntimeError("DJANGO_SECRET_KEY must be set when DEBUG is False")

ALLOWED_HOSTS = env_list("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,backend")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.postgres",
    "rest_framework",
    "corsheaders",
    "apps.accounts",
    "apps.workspaces",
    "apps.documents",
    "apps.chat",
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"

DATABASES = {
    "default": dj_database_url.parse(
        os.environ.get("DATABASE_URL", "postgres://postgres:postgres@localhost:5432/docuchat"),
        conn_max_age=60,
    )
}

AUTH_USER_MODEL = "accounts.User"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = Path(os.environ.get("MEDIA_ROOT", BASE_DIR / "media"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# --- Uploads ---
MAX_UPLOAD_SIZE = 20 * 1024 * 1024  # 20 MB
# Every row becomes embedded text, so cap spreadsheets: 20k rows is roughly
# 1-2M tokens (a few cents with text-embedding-3-small) and a few minutes of work.
MAX_SPREADSHEET_ROWS = 20_000
# Let Django accept the multipart body; our own validator enforces MAX_UPLOAD_SIZE
# per file with a clear error message.
DATA_UPLOAD_MAX_MEMORY_SIZE = MAX_UPLOAD_SIZE + 1024 * 1024

# --- DRF / JWT ---
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_PAGINATION_CLASS": None,
}

SIMPLE_JWT = {
    # Short-lived access token limits damage if one leaks; the frontend silently
    # refreshes using the longer-lived refresh token.
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=7),
    "AUTH_HEADER_TYPES": ("Bearer",),
}

# --- CORS ---
CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000")
# Let the frontend read the server's file name on downloads (answer export).
CORS_EXPOSE_HEADERS = ["Content-Disposition"]

# --- Production (behind a TLS-terminating reverse proxy, e.g. Caddy) ---
# The Django admin's login form is CSRF-protected and checks the Origin header.
CSRF_TRUSTED_ORIGINS = env_list("DJANGO_CSRF_TRUSTED_ORIGINS")
if env_bool("DJANGO_BEHIND_HTTPS_PROXY"):
    # The proxy talks plain HTTP to gunicorn; trust its header so Django knows
    # the original request was HTTPS (secure cookies, correct absolute URLs).
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True

# --- Celery ---
CELERY_BROKER_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = CELERY_BROKER_URL
CELERY_TASK_SERIALIZER = "json"
CELERY_ACCEPT_CONTENT = ["json"]
# Ingestion tasks are long and idempotent: acknowledge only after they finish so
# a crashed worker's task is redelivered, and don't prefetch extra long tasks.
CELERY_TASK_ACKS_LATE = True
CELERY_WORKER_PREFETCH_MULTIPLIER = 1
CELERY_TASK_TIME_LIMIT = 15 * 60

# --- Provider API keys ---
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")  # free tier: aistudio.google.com
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")

# --- Embeddings ---
# EMBEDDING_PROVIDER: "openai" | "gemini" | "fake" (deterministic offline vectors
# for tests and keyless local runs). Leave EMBEDDING_MODEL blank for the default.
# All chunks must be embedded by the same model: after switching provider,
# re-process existing documents, since vectors from different models aren't comparable.
EMBEDDING_PROVIDER = os.environ.get("EMBEDDING_PROVIDER", "openai")
_DEFAULT_EMBEDDING_MODELS = {
    "openai": "text-embedding-3-small",
    "gemini": "gemini-embedding-001",
    "fake": "fake",
}
EMBEDDING_MODEL = os.environ.get("EMBEDDING_MODEL") or _DEFAULT_EMBEDDING_MODELS.get(
    EMBEDDING_PROVIDER, ""
)
# Both default models can output 1536-dim vectors, matching the DB column.
EMBEDDING_DIMENSIONS = 1536
EMBEDDING_BATCH_SIZE = 64
# Also cap each request's total tokens (16 chunks of ~500 tokens). Measured:
# Gemini's free tier 429s on one ~32k-token request but accepts 8k-token ones.
EMBEDDING_BATCH_TOKENS = 8_000

# --- LLM / RAG ---
# LLM_PROVIDER: "openai" | "gemini" | "groq" | "fake" (offline, for tests/local runs).
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "openai")
_DEFAULT_LLM_MODELS = {
    "openai": "gpt-4o-mini",
    "gemini": "gemini-2.5-flash",
    "groq": "openai/gpt-oss-120b",  # Groq retired the Llama 3.3 models
    "fake": "fake",
}
LLM_MODEL = os.environ.get("LLM_MODEL") or _DEFAULT_LLM_MODELS.get(LLM_PROVIDER, "")
RAG_TOP_K = 8
# How many prior messages (user + assistant) to send as conversation history.
RAG_HISTORY_MESSAGES = 6
