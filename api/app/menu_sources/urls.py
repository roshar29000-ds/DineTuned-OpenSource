import ipaddress
import re
from urllib.parse import urlsplit, urlunsplit, quote, parse_qsl


class SourceBlocked(Exception):
    """Safe, static explanation. Never include response bodies or secrets."""


BLOCKED_HOSTS = ("google.com", "googleapis.com", "googleusercontent.com", "gstatic.com", "maps.app.goo.gl",
                 "meta.ai", "facebook.com", "instagram.com", "openai.com", "anthropic.com")


def public_hostname(host):
    if not host or "." not in host or host.endswith((".local", ".internal", ".localhost", ".test", ".invalid")):
        raise SourceBlocked("Only public restaurant website addresses are supported.")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise SourceBlocked("IP-address URLs are not supported.")
    if (not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host)
            or re.search(r"(?:^|\.)google\.[a-z.]+$", host)
            or any(host == h or host.endswith("." + h) for h in BLOCKED_HOSTS)):
        raise SourceBlocked("This source is outside restaurant website discovery. No platform scraping or paid API requests are supported.")


def source_url(value: str) -> str:
    if len(value) > 2048 or re.search(r"[\x00-\x20\x7f\\]", value):
        raise SourceBlocked("Use a complete HTTPS website address without spaces or control characters.")
    try:
        parts = urlsplit(value)
        host = (parts.hostname or "").encode("idna").decode().lower().rstrip(".")
        if parts.scheme != "https" or parts.port not in (None, 443) or parts.username or parts.password:
            raise SourceBlocked("Only HTTPS websites without embedded credentials or custom ports are supported.")
        public_hostname(host)
        if re.search(r"%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)", parts.path, re.I):
            raise SourceBlocked("Encoded path separators or traversal are not supported.")
        if any(re.search(r"(?:key|token|secret|password|signature|authorization|credential)", k, re.I) for k, _ in parse_qsl(parts.query)):
            raise SourceBlocked("Private or signed links are not supported. Use a public restaurant website link.")
        path = quote(parts.path or "/", safe="/%:@!$&'()*+,;=-._~")
        # Normalize dot segments before both robots evaluation and network dispatch.
        segments = []
        for segment in path.split("/"):
            if segment == "..":
                if segments: segments.pop()
            elif segment not in ("", "."):
                segments.append(segment)
        normalized = "/" + "/".join(segments)
        if path.endswith("/") and normalized != "/": normalized += "/"
        return urlunsplit(("https", host, normalized, quote(parts.query, safe="%=&?/:;+,-._~"), ""))
    except (ValueError, UnicodeError):
        raise SourceBlocked("This website address could not be validated.") from None


def origin(url):
    p = urlsplit(url)
    return f"{p.scheme}://{p.netloc}"


def same_site(a, b):
    # Only an exact host or its www alias. Never guess ownership by suffix alone.
    return urlsplit(a).hostname.removeprefix("www.") == urlsplit(b).hostname.removeprefix("www.")
