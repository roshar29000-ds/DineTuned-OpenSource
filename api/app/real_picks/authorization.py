"""Bind the exact extracted snapshot to the verified user, without storing it."""
import base64
import hashlib
import hmac
import json
from ..culinary.errors import CulinaryError
from ..menu_sources.identity import SelectionProof


class MenuSnapshotPermit:
    def __init__(self, proof: SelectionProof):
        self.proof = proof
        self.key = hmac.new(proof.key, b'dinetuned-real-picks-menu-v1', hashlib.sha256).digest()

    def claims(self, extraction, user):
        snapshot = extraction.model_dump_json(exclude={'recommendation_token'})
        return {'owner': hashlib.sha256(str(user).encode()).hexdigest(), 'snapshot': hashlib.sha256(snapshot.encode()).hexdigest()}

    def issue(self, extraction, user):
        data = {**self.claims(extraction, user), 'expires': int(self.proof.clock()) + self.proof.TTL}
        payload = base64.urlsafe_b64encode(json.dumps(data, sort_keys=True).encode()).decode()
        return payload + '.' + hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()

    def verify(self, extraction, user):
        try:
            payload, signature = (extraction.recommendation_token or '').split('.')
            if not hmac.compare_digest(signature, hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()):
                raise ValueError()
            data = json.loads(base64.urlsafe_b64decode(payload))
            if type(data.get('expires')) is not int or data['expires'] <= self.proof.clock(): raise ValueError()
            if any(data.get(k) != v for k, v in self.claims(extraction, user).items()): raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise CulinaryError('invalid_menu_authorization', 'This menu snapshot is missing, changed or expired. No model or website request was made.') from None
