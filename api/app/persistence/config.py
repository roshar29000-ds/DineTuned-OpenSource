from dataclasses import dataclass, field
import os
import re
from urllib.parse import urlsplit


class PersistenceError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    publishable_key: str = field(repr=False)

    @classmethod
    def from_environment(cls):
        url = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
        key = os.getenv("SUPABASE_PUBLISHABLE_KEY", "").strip()
        if not url and not key:
            raise PersistenceError(503, "Cloud storage is not configured. Your browser data remains local.")
        try:
            parsed = urlsplit(url)
            hosted = parsed.scheme == "https" and bool(re.fullmatch(r"[a-z0-9-]+\.supabase\.co", parsed.hostname or "")) and parsed.port in (None, 443)
            local = parsed.scheme == "http" and parsed.hostname in ("localhost", "127.0.0.1") and parsed.port == 54321
        except ValueError:
            raise PersistenceError(503, "Cloud storage configuration is invalid.") from None
        if (not (hosted or local) or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment
                or not re.fullmatch(r"sb_publishable_[A-Za-z0-9_-]{16,256}", key)):
            raise PersistenceError(503, "Cloud storage configuration is invalid. Use the project URL and publishable key, never a secret or service-role key.")
        return cls(url, key)
