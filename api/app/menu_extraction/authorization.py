"""Authenticate a source manifest without trusting client-supplied candidate URLs."""
import base64
import hashlib
import hmac
import json
from ..discovery.config import DiscoveryError
from ..menu_sources.identity import SelectionProof


class ExtractionPermit:
    def __init__(self, proof: SelectionProof):
        self.proof = proof
        self.key = hmac.new(proof.key, b"dinetuned-menu-extraction-v1", hashlib.sha256).digest()

    def claims(self, restaurant, sources, user):
        raw = sources.model_dump_json(exclude={"extraction_token"})
        return {**self.proof.claims(restaurant, user), "sources": hashlib.sha256(raw.encode()).hexdigest()}

    def issue(self, restaurant, sources, user):
        data = {**self.claims(restaurant, sources, user), "expires": int(self.proof.clock()) + self.proof.TTL}
        payload = base64.urlsafe_b64encode(json.dumps(data, sort_keys=True).encode()).decode()
        return payload + "." + hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()

    def verify(self, restaurant, sources, user):
        try:
            payload, signature = (sources.extraction_token or "").split(".")
            if not hmac.compare_digest(signature, hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()):
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(payload))
            if type(data.get("expires")) is not int or data["expires"] <= self.proof.clock():
                raise ValueError()
            if sources.restaurant_id != restaurant.place_id or any(data.get(k) != v for k, v in self.claims(restaurant, sources, user).items()):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise DiscoveryError(409, "Menu sources are missing, changed or expired. Run an explicitly approved source check again; no lookup was repeated.") from None
