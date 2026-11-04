from dataclasses import dataclass, field
from pathlib import Path
import os
import re
from uuid import UUID
from ..persistence.config import SupabaseConfig, PersistenceError


class DiscoveryError(Exception):
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(message)


@dataclass(frozen=True)
class PlacesConfig:
    enabled: bool = False
    live_approved: bool = False
    api_key: str = field(default="", repr=False)
    # No restaurant content, coordinates, queries, credentials or tokens in this file.
    usage_path: Path = Path(__file__).resolve().parents[3] / ".local/google-places/usage.sqlite3"
    # Optional one-use grant for a deliberately approved live test. Keep the ID
    # stable across backend restarts; absence preserves normal search behavior.
    controlled_test_id: str | None = field(default=None, repr=False)
    # Owner-approved exception for one additional Details reservation after
    # the ordinary global daily limit. Requires a fresh one-use test ID.
    extra_controlled_details: bool = False

    @classmethod
    def from_environment(cls):
        return cls(os.getenv("GOOGLE_PLACES_ENABLED", "false").lower() == "true",
                   os.getenv("GOOGLE_PLACES_LIVE_APPROVED", "false").lower() == "true",
                   os.getenv("GOOGLE_PLACES_API_KEY", "").strip(),
                   controlled_test_id=os.getenv("GOOGLE_PLACES_TEST_RUN_ID", "").strip() or None,
                   extra_controlled_details=os.getenv("GOOGLE_PLACES_EXTRA_DETAIL_APPROVED", "false").lower() == "true")

    def require_live(self):
        if not self.enabled or not self.live_approved:
            raise DiscoveryError(503, "Real restaurant search is not enabled. The fictional demo remains available.")
        if not re.fullmatch(r"[A-Za-z0-9_-]{20,256}", self.api_key):
            raise DiscoveryError(503, "Restaurant search is not configured. Please contact the app owner.")
        if self.controlled_test_id:
            try:
                if str(UUID(self.controlled_test_id)) != self.controlled_test_id:
                    raise ValueError
            except ValueError:
                raise DiscoveryError(503, "The controlled Google test grant is invalid. Search is paused.") from None
        if self.extra_controlled_details and not self.controlled_test_id:
            raise DiscoveryError(503, "The additional Details allowance requires a one-use Google test grant.")

    def ready(self):
        self.require_live()
        try:
            SupabaseConfig.from_environment()
        except PersistenceError:
            raise DiscoveryError(503, "Restaurant search requires configured guest authentication.") from None
