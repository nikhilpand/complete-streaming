"""
SSRF-safe JioSaavn URL resolver.

The naive implementation in most open-source wrappers:

    requests.get(user_supplied_url)   ← SSRF vulnerability

This resolver:
  1. Parses the URL locally (no network)
  2. Validates scheme (https only)
  3. Validates hostname against allowlist
  4. Validates path format
  5. Extracts token from path
  6. Only then makes an upstream request to the SAAVN API (not the user URL)

It NEVER fetches:
  - localhost / 127.0.0.1
  - Private IP ranges
  - Link-local addresses
  - Arbitrary domains
  - file:// ftp:// etc.
"""

from __future__ import annotations

import ipaddress
import logging
import re
from urllib.parse import urlparse

from app.config import settings
from app.core.errors import ProviderInvalidRequest, SSRFAttempt

logger = logging.getLogger(__name__)

# Token characters observed in JioSaavn share URLs
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_\-]+$")

# Private/reserved IP ranges (SSRF guard)
_PRIVATE_RANGES = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
]


def _is_private_ip(hostname: str) -> bool:
    """Return True if hostname resolves to (or IS) a private/reserved IP."""
    try:
        addr = ipaddress.ip_address(hostname)
        return any(addr in net for net in _PRIVATE_RANGES)
    except ValueError:
        # Not a raw IP address — hostname must pass allowlist check
        return False


class SaavnURLResolver:
    """
    Validates and parses JioSaavn share URLs.

    Does NOT make upstream calls — returns token + type for the
    caller to resolve via webapi.get.
    """

    RESOURCE_TYPE_MAP: dict[str, str] = {
        "song": "song",
        "s": "song",
        "album": "album",
        "a": "album",
        "featured": "playlist",
        "playlist": "playlist",
        "artist": "artist",
        "shows": "show",
    }

    @classmethod
    def parse(cls, url: str) -> tuple[str, str]:
        """
        Validate a JioSaavn URL and return (token, resource_type).

        Raises SSRFAttempt or ProviderInvalidRequest on failure.
        """
        if len(url) > settings.URL_MAX_LEN:
            raise ProviderInvalidRequest(
                f"URL too long (max {settings.URL_MAX_LEN} chars)",
                provider="saavn",
            )

        try:
            parsed = urlparse(url)
        except ValueError as exc:
            raise ProviderInvalidRequest(f"Malformed URL: {exc}", provider="saavn") from exc

        # 1. Scheme must be https
        if parsed.scheme.lower() != "https":
            raise SSRFAttempt(
                f"Only https:// URLs are accepted, got: {parsed.scheme}://",
                provider="saavn",
            )

        # 2. Hostname must be in the explicit allowlist
        hostname = (parsed.hostname or "").lower()
        if not hostname:
            raise SSRFAttempt("URL has no hostname", provider="saavn")

        if hostname not in settings.SAAVN_ALLOWED_HOSTS:
            raise SSRFAttempt(
                f"Hostname not in allowlist: {hostname}",
                provider="saavn",
            )

        # 3. Reject raw private IPs even if somehow in the allowlist
        if _is_private_ip(hostname):
            raise SSRFAttempt(
                f"Private/reserved IP not allowed: {hostname}",
                provider="saavn",
            )

        # 4. Parse path segments
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) < 2:
            raise ProviderInvalidRequest(
                "JioSaavn URL must have at least 2 path segments",
                provider="saavn",
            )

        path_prefix = parts[0].lower()
        if path_prefix not in cls.RESOURCE_TYPE_MAP:
            logger.warning(
                "Unknown URL path prefix %r \u2014 defaulting resource type to 'song'. "
                "If this is a new JioSaavn resource type, add it to RESOURCE_TYPE_MAP.",
                path_prefix,
            )
        resource_type = cls.RESOURCE_TYPE_MAP.get(path_prefix, "song")
        token = parts[-1]

        # 5. Validate token format
        if not _TOKEN_RE.match(token):
            raise ProviderInvalidRequest(
                f"Invalid URL token format: {token!r}",
                provider="saavn",
            )

        logger.debug("Resolved URL: type=%s token=%s", resource_type, token)
        return token, resource_type
