"""
Application configuration.

All tuneable values come from environment variables / .env file.
No magic values are hardcoded in source — except for well-known
public constants (e.g. the JioSaavn API gateway URL).
"""

from __future__ import annotations

import os
from typing import ClassVar

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # ── Application ──────────────────────────────────────
    APP_NAME: str = "saavn-provider"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # ── CORS ─────────────────────────────────────────────
    # Comma-separated list; empty string disables CORS entirely.
    # NEVER default to wildcard in production.
    CORS_ALLOWED_ORIGINS: str = ""

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.CORS_ALLOWED_ORIGINS.split(",") if o.strip()]

    # ── JioSaavn upstream ────────────────────────────────
    SAAVN_BASE_URL: str = "https://www.jiosaavn.com/api.php"
    SAAVN_USER_AGENT: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    )

    # Allowed hostnames for user-supplied URL resolution (SSRF guard).
    SAAVN_ALLOWED_HOSTS: ClassVar[frozenset[str]] = frozenset(
        {
            "www.jiosaavn.com",
            "jiosaavn.com",
            "saavn.com",
            "www.saavn.com",
        }
    )

    # ── HTTP client ──────────────────────────────────────
    HTTP_CONNECT_TIMEOUT: float = 5.0
    HTTP_READ_TIMEOUT: float = 15.0
    HTTP_WRITE_TIMEOUT: float = 5.0
    HTTP_POOL_TIMEOUT: float = 5.0
    HTTP_MAX_CONNECTIONS: int = 20
    HTTP_MAX_KEEPALIVE: int = 10
    HTTP_MAX_RESPONSE_BYTES: int = 10 * 1024 * 1024  # 10 MB

    # ── Retry policy ─────────────────────────────────────
    RETRY_MAX_ATTEMPTS: int = 3
    RETRY_BASE_DELAY: float = 0.5      # seconds
    RETRY_MAX_DELAY: float = 10.0      # seconds
    RETRY_JITTER: float = 0.25         # fraction of delay to randomise

    # ── Concurrency ──────────────────────────────────────
    SAAVN_MAX_CONCURRENCY: int = 5
    SEARCH_ENRICH_LIMIT: int = 5       # max songs enriched per search

    # ── Cache TTLs (seconds) ─────────────────────────────
    CACHE_TTL_SEARCH: int = 300        # 5 min
    CACHE_TTL_SONG: int = 3600         # 1 hr
    CACHE_TTL_ALBUM: int = 3600
    CACHE_TTL_PLAYLIST: int = 600      # 10 min (changes more often)
    CACHE_TTL_ARTIST: int = 3600
    CACHE_TTL_LYRICS: int = 86400      # 24 hr
    CACHE_TTL_MEDIA: int = 300         # 5 min — media URLs expire quickly
    CACHE_STALE_WINDOW: int = 60       # how long stale data is acceptable

    # ── Circuit breaker ──────────────────────────────────
    CB_FAILURE_THRESHOLD: int = 5      # failures before OPEN
    CB_SUCCESS_THRESHOLD: int = 2      # successes to close from HALF_OPEN
    CB_TIMEOUT: float = 30.0           # seconds in OPEN before HALF_OPEN probe

    # ── Input limits ─────────────────────────────────────
    SEARCH_QUERY_MIN_LEN: int = 1
    SEARCH_QUERY_MAX_LEN: int = 200
    SEARCH_MAX_RESULTS: int = 50
    BULK_IDS_MAX: int = 20
    URL_MAX_LEN: int = 2048

    # ── Media resolution ─────────────────────────────────
    # The DES key is public knowledge across all OSS JioSaavn wrappers.
    # Store it here rather than hardcoded in crypto logic so it can be
    # overridden when (not if) it changes.
    MEDIA_DES_KEY: str = "38346591"
    MEDIA_DEFAULT_QUALITY: str = "320kbps"


settings = Settings()
