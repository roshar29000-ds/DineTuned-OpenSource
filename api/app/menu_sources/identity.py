"""Opaque, user-bound proof that a branch snapshot came from our Places adapter.

Contains only hashes, expiry and version; Google content stays in browser memory.
The stable local signing key is unrelated to all API credentials and usage ledgers.
"""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import time
from ..discovery.config import DiscoveryError
from ..discovery.models import DiscoveredRestaurant

KEY_PATH = Path(__file__).resolve().parents[3] / ".local/menu-sources/selection.key"


class SelectionProof:
    TTL = 3600

    def __init__(self, key: bytes, clock=time.time):
        if len(key) != 32:
            raise ValueError("Invalid selection signing key")
        self.key, self.clock = key, clock

    @classmethod
    def local(cls):
        try:
            KEY_PATH.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            try:
                fd = os.open(KEY_PATH, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            except FileExistsError:
                pass
            else:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(os.urandom(32))
            return cls(KEY_PATH.read_bytes())
        except (OSError, ValueError):
            raise DiscoveryError(503, "Restaurant identity verification is unavailable. No website was accessed.") from None

    @staticmethod
    def digest(value):
        return hashlib.sha256(value.encode()).hexdigest()

    def claims(self, restaurant, user):
        snapshot = json.dumps(restaurant.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return {"identity": self.digest(snapshot), "owner": self.digest(str(user))}

    def issue(self, restaurant: DiscoveredRestaurant, user) -> str:
        data = {**self.claims(restaurant, user), "v": 1, "expires": int(self.clock()) + self.TTL}
        payload = base64.urlsafe_b64encode(json.dumps(data, separators=(",", ":")).encode()).decode().rstrip("=")
        return payload + "." + hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()

    def verify(self, token: str, restaurant: DiscoveredRestaurant, user, *, grace_seconds: int = 0):
        # A narrowly scoped caller may accept a recently expired, still signed
        # branch snapshot. This never reissues Places identity or changes owner,
        # restaurant, address, or source claims.
        if not isinstance(grace_seconds, int) or not 0 <= grace_seconds <= 23 * 3600:
            raise ValueError("Invalid selection proof grace period")
        try:
            payload, signature = token.split(".")
            expected = hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signature):
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            if data.get("v") != 1 or type(data.get("expires")) is not int or data["expires"] + grace_seconds <= self.clock():
                raise ValueError()
            if any(data.get(k) != v for k, v in self.claims(restaurant, user).items()):
                raise ValueError()
            if (restaurant.provider != "google_places" or restaurant.source.provider != "google_places"
                    or restaurant.source.api != "places_new" or restaurant.source.place_id != restaurant.place_id):
                raise ValueError()
        except (ValueError, TypeError, KeyError, AttributeError):
            raise DiscoveryError(409, "This branch selection is missing, changed or expired. A new verified selection is needed; no Google request will be made automatically.") from None
