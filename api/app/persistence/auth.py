"""Validate tokens with Supabase Auth; never authorize from decoded browser data."""
from dataclasses import dataclass, field
import re
from uuid import UUID
import httpx
from .config import SupabaseConfig, PersistenceError


@dataclass(frozen=True)
class UserIdentity:
    user_id: UUID
    is_anonymous: bool
    access_token: str = field(repr=False)


def verify_user(client: httpx.Client, config: SupabaseConfig, authorization: str | None) -> UserIdentity:
    if not authorization or len(authorization) > 8192 or not re.fullmatch(r"Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", authorization):
        raise PersistenceError(401, "A valid signed-in session is required.")
    token = authorization[7:]
    try:
        response = client.get(config.url + "/auth/v1/user", headers={"apikey": config.publishable_key, "Authorization": authorization})
        if response.status_code in (401, 403):
            raise PersistenceError(401, "Your cloud session could not be verified. Local data is unchanged.")
        if response.status_code != 200:
            raise PersistenceError(503, "Cloud identity is temporarily unavailable. Local data is unchanged.")
        data = response.json()
        if data.get("role") != "authenticated" or type(data.get("is_anonymous")) is not bool:
            raise ValueError("Unverified identity")
        return UserIdentity(UUID(data["id"]), data["is_anonymous"], token)
    except (httpx.HTTPError, ValueError, KeyError, TypeError, AttributeError):
        raise PersistenceError(503, "Cloud identity could not be verified. No private data was accessed.") from None
