"""Operator-only SAM 3.1 still-image demonstrator for original demo artwork.

SAM returns geometry and encoded masks, never dish names or ingredient claims.
No public route imports this module, and live dispatch is disabled by default.
"""
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
from typing import Literal
import base64
import os
import re
import sqlite3
import stat

import httpx
from pydantic import Field

from ..culinary.errors import CulinaryError
from ..culinary.meta import LiveConsent
from ..schemas import Contract
from ..usage_budget import CUMULATIVE_LIMIT, SAM_MODEL, UsageBudget
from ..validation_spend import ValidationSpend

MILESTONE = '4D.SAM'
ASSET_DIR = Path(__file__).resolve().parents[3] / 'web/public/demo-food'
CACHE_PATH = Path(__file__).resolve().parents[3] / '.local/optional_models/sam.sqlite3'
ASSETS = frozenset({
    'baja-fish-tacos.jpg', 'chicken-karaage.jpg', 'chickpea-fritters.jpg',
    'crispy-mushroom-banh-mi.jpg', 'crispy-mushroom-tacos.jpg',
    'lemon-calamari.jpg', 'onion-bhaji.jpg', 'roasted-cauliflower-tacos.jpg',
})
CONCEPTS = frozenset({'food', 'plate'})
RECORD = re.compile(
    r'(?P<id>\d+)<\|box;x1=(?P<x1>\d+);y1=(?P<y1>\d+);x2=(?P<x2>\d+);y2=(?P<y2>\d+);'
    r'w=(?P<w>\d+);h=(?P<h>\d+)(?:;c=(?P<box_c>\d+(?:\.\d+)?))?\|>'
    r'<\|mask;x=0;y=0(?:;c=(?P<mask_c>\d+(?:\.\d+)?))?;'
    r'data=(?P<mh>\d+),(?P<mw>\d+),(?P<enc>[~!])(?P<payload>.*?)\|>', re.S)


class SamRegion(Contract):
    object_id: int = Field(ge=0)
    box: tuple[int, int, int, int]
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)
    mask_width: int = Field(gt=0)
    mask_height: int = Field(gt=0)
    mask_encoding: Literal['lossless', 'one_bit']
    mask_payload_base85: str
    confidence: float | None = Field(default=None, ge=0, le=1)


class SamResult(Contract):
    model: Literal['sam-3.1'] = SAM_MODEL
    mode: Literal['meta', 'mock']
    asset_name: str
    image_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    concept: Literal['food', 'plate']
    regions: list[SamRegion] = Field(max_length=32)
    provenance: str = 'Original AI-generated fictional-dish illustration; segmentation is geometry, not food identification.'


def parse_image_output(text: str) -> list[SamRegion]:
    """Parse the documented <0f> box/mask grammar without guessing image meaning."""
    if text == '':
        return []  # A completed zero-match response is valid.
    if len(text) > 2_000_000 or not text.startswith('<0f>') or '\n' in text:
        raise CulinaryError('sam_output', 'SAM returned unsupported still-image segmentation output.')
    remaining, regions, seen = text[4:], [], set()
    while remaining:
        match = RECORD.match(remaining)
        if not match:
            raise CulinaryError('sam_output', 'SAM returned malformed box or mask tokens.')
        values = {key: int(match[key]) for key in ('id', 'x1', 'y1', 'x2', 'y2', 'w', 'h', 'mh', 'mw')}
        confidence = float(match['box_c']) if match['box_c'] is not None else None
        mask_confidence = float(match['mask_c']) if match['mask_c'] is not None else None
        payload = match['payload']
        if (values['id'] in seen or len(regions) >= 32
                or not 0 <= values['x1'] <= values['x2'] < values['w'] <= 4096
                or not 0 <= values['y1'] <= values['y2'] < values['h'] <= 4096
                or not 0 < values['mw'] <= values['w'] or not 0 < values['mh'] <= values['h']
                or confidence != mask_confidence or confidence is not None and not 0 <= confidence <= 1
                or not payload or len(payload) > 1_000_000
                or any(not 33 <= ord(char) <= 126 for char in payload)):
            raise CulinaryError('sam_output', 'SAM returned inconsistent or unbounded segmentation geometry.')
        seen.add(values['id'])
        regions.append(SamRegion(object_id=values['id'],
            box=(values['x1'], values['y1'], values['x2'], values['y2']),
            image_width=values['w'], image_height=values['h'],
            mask_width=values['mw'], mask_height=values['mh'],
            mask_encoding='lossless' if match['enc'] == '~' else 'one_bit',
            mask_payload_base85=payload, confidence=confidence))
        remaining = remaining[match.end():]
        if remaining:
            if not remaining.startswith(','):
                raise CulinaryError('sam_output', 'SAM returned an invalid record separator.')
            remaining = remaining[1:]
    return regions


def response_text(body: dict) -> str:
    if body.get('status') != 'completed' or body.get('model') != SAM_MODEL:
        raise CulinaryError('sam_output', 'SAM did not complete with the expected model.')
    output = body.get('output')
    if not isinstance(output, list):
        raise CulinaryError('sam_output', 'SAM returned no output lane.')
    parts = [part.get('text') for item in output if isinstance(item, dict)
             for part in item.get('content', []) if isinstance(part, dict) and part.get('type') == 'output_text']
    if len(parts) > 1 or any(not isinstance(part, str) for part in parts):
        raise CulinaryError('sam_output', 'SAM returned multiple or malformed still-image output lanes.')
    return parts[0] if parts else ''


@dataclass(frozen=True)
class SamPolicy:
    cap_usd: Decimal
    max_images: int

    @classmethod
    def from_environment(cls):
        if os.getenv('DINETUNED_SAM_ENABLED') != 'true':
            return None
        try:
            approval = os.getenv('DINETUNED_SAM_APPROVAL_ID', '')
            cap = Decimal(os.getenv('DINETUNED_SAM_CAP_USD', ''))
            count = int(os.getenv('DINETUNED_SAM_MAX_IMAGES', ''))
        except (ValueError, InvalidOperation):
            raise CulinaryError('sam_disabled', 'SAM lacks a complete owner-approved spending policy.') from None
        if (not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', approval) or not cap.is_finite()
                or not Decimal('0.0025') <= cap <= CUMULATIVE_LIMIT
                or not 1 <= count <= 100 or not os.getenv('MODEL_API_KEY')):
            raise CulinaryError('sam_disabled', 'SAM lacks a complete owner-approved spending policy.')
        return cls(cap, count)


class SamCache:
    def __init__(self, path: Path = CACHE_PATH):
        self.path = Path(path)

    def _connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if self.path.is_symlink():
            raise CulinaryError('sam_cache', 'The private segmentation cache is unavailable.')
        db = sqlite3.connect(self.path, timeout=5)
        os.chmod(self.path, 0o600)
        db.execute('''CREATE TABLE IF NOT EXISTS results (
            digest TEXT PRIMARY KEY, status TEXT NOT NULL, result TEXT)''')
        return db

    def start_or_get(self, digest: str):
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                row = db.execute('SELECT status, result FROM results WHERE digest=?', (digest,)).fetchone()
                if row:
                    if row[0] == 'ready' and row[1]:
                        return SamResult.model_validate_json(row[1])
                    raise CulinaryError('sam_attempted', 'This segmentation was already attempted; no new call was made.')
                db.execute('INSERT INTO results VALUES (?,?,NULL)', (digest, 'pending'))
            return None
        except (sqlite3.Error, OSError, ValueError):
            raise CulinaryError('sam_cache', 'The private segmentation cache is unavailable.') from None

    def finish(self, digest: str, result: SamResult | None):
        try:
            with self._connect() as db:
                db.execute('UPDATE results SET status=?, result=? WHERE digest=? AND status=?',
                    ('ready' if result else 'failed', result.model_dump_json() if result else None, digest, 'pending'))
        except (sqlite3.Error, OSError):
            raise CulinaryError('sam_cache', 'The segmentation could not be cached; no retry is allowed.') from None


class SamImageSegmenter:
    def __init__(self, *, mock_transport: httpx.MockTransport | None = None,
                 consent: LiveConsent = LiveConsent(), budget: UsageBudget | None = None,
                 cache: SamCache | None = None, asset_dir: Path = ASSET_DIR):
        self.mock_transport, self.consent, self.budget = mock_transport, consent, budget
        self.cache, self.asset_dir = cache or SamCache(), Path(asset_dir)

    def segment(self, asset_name: str, concept: str = 'food') -> SamResult:
        if asset_name not in ASSETS or concept not in CONCEPTS:
            raise CulinaryError('sam_input', 'Only bundled original food artwork and one supported concept are accepted.')
        asset = self.asset_dir / asset_name
        try:
            descriptor = os.open(asset, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, 'rb') as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or not 100 <= info.st_size <= 1_000_000:
                    raise CulinaryError('sam_input', 'The demonstrator requires a bounded original JPEG asset.')
                data = stream.read(1_000_001)
        except OSError:
            raise CulinaryError('sam_input', 'The original food artwork is unavailable.') from None
        if not 100 <= len(data) <= 1_000_000 or not data.startswith(b'\xff\xd8\xff') or not data.endswith(b'\xff\xd9'):
            raise CulinaryError('sam_input', 'The demonstrator requires a bounded original JPEG asset.')
        offline = self.mock_transport is not None
        policy = None
        if not offline:
            self.consent.require()
            policy = SamPolicy.from_environment()
            if policy is None:
                raise CulinaryError('sam_disabled', 'Optional SAM segmentation is disabled.')
        mode = 'mock' if offline else 'meta'
        image_hash = sha256(data).hexdigest()
        digest = sha256(f'{mode}:{SAM_MODEL}:{image_hash}:{concept}:v1'.encode()).hexdigest()
        cached = self.cache.start_or_get(digest)
        if cached is not None:
            return cached
        key = 'offline-mock-key' if offline else os.getenv('MODEL_API_KEY', '')
        body = {'model': SAM_MODEL, 'input': [{'type': 'message', 'role': 'user',
            'content': [{'type': 'input_text', 'text': concept},
                        {'type': 'input_image', 'image_url': 'data:image/jpeg;base64,' +
                         base64.b64encode(data).decode('ascii')}]}],
            'stream': False, 'metadata': {'mask_encoding': 'one_bit'}}
        budget_id = phase_id = None
        phase = ValidationSpend.from_environment() if not offline else None
        try:
            if phase:
                phase_id = phase.reserve('meta', SAM_MODEL, 'optional_food_segmentation', Decimal('0.0025'))
            if not offline:
                budget = self.budget or UsageBudget(extra_limits={MILESTONE: (policy.cap_usd, policy.max_images)})
                budget_id = budget.reserve_sam_image(MILESTONE)
            with httpx.Client(transport=self.mock_transport or httpx.HTTPTransport(retries=0),
                              timeout=30, follow_redirects=False, trust_env=False) as client:
                response = client.post('https://api.meta.ai/v1/responses',
                    headers={'Authorization': 'Bearer ' + key}, json=body)
            response.raise_for_status()
            if len(response.content) > 2_000_000:
                raise CulinaryError('sam_output', 'SAM returned an oversized segmentation response.')
            regions = parse_image_output(response_text(response.json()))
            result = SamResult(mode=mode, asset_name=asset_name, image_sha256=image_hash,
                concept=concept, regions=regions)
            if budget_id:
                budget.finish_sam_image(budget_id, success=True)
                budget_id = None
            if phase_id:
                phase.finish(phase_id, 'success', Decimal('0.0025'))
                phase_id = None
            self.cache.finish(digest, result)
            return result
        except Exception as error:
            if budget_id:
                budget.finish_sam_image(budget_id, success=False)
            if phase_id:
                phase.finish(phase_id, 'failed' if budget_id else 'cancelled')
            self.cache.finish(digest, None)
            if isinstance(error, CulinaryError):
                raise
            raise CulinaryError('sam_provider', 'SAM request or response failed; no retry was attempted.') from None
