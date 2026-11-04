"""Optional Muse Image illustrations for validated primary Picks only.

Generation is disabled by default. Authenticated GETs never call Meta; a validated
recommendation response may enqueue at most its three primary dishes after the
owner explicitly configures a bounded image allowance.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from hashlib import sha256
from pathlib import Path
from uuid import UUID
import base64
import os
import re
import sqlite3

import httpx
from openai import OpenAI

from ..culinary.errors import CulinaryError
from ..usage_budget import CUMULATIVE_LIMIT, UsageBudget
from ..validation_spend import ValidationSpend
from .models import RealPicksResult

MODEL = 'muse-image-1.0'
MILESTONE = '4D.IMAGE'
ROOT = Path(__file__).resolve().parents[3] / '.local' / 'real_picks'
PROMPT_VERSION = 'editorial-v1'


@dataclass(frozen=True)
class ImagePolicy:
    cap_usd: Decimal
    max_images: int

    @classmethod
    def from_environment(cls):
        if os.getenv('DINETUNED_MUSE_IMAGE_ENABLED') != 'true': return None
        try:
            approval = os.getenv('DINETUNED_MUSE_IMAGE_APPROVAL_ID', '')
            cap = Decimal(os.getenv('DINETUNED_MUSE_IMAGE_CAP_USD', ''))
            count = int(os.getenv('DINETUNED_MUSE_IMAGE_MAX_IMAGES', ''))
        except (ValueError, InvalidOperation):
            return None
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,80}', approval) or not cap.is_finite() \
                or not Decimal('0.01') <= cap <= CUMULATIVE_LIMIT or not 1 <= count <= 100 \
                or not os.getenv('MODEL_API_KEY'):
            return None
        return cls(cap_usd=cap, max_images=count)


def image_prompt(name: str, description: str, *, legacy_cache_key: bool = False) -> str:
    # Source text is untrusted data, not instructions. No user profile, branch
    # name, claim of authenticity, or imagined ingredient is sent to the model.
    if legacy_cache_key:
        # Preserve the exact v1 cache identity: changing the art direction must
        # never rebill a guest for an illustration already generated for this dish.
        return ("Create a luxury restaurant editorial food illustration, not a photograph of an actual restaurant dish. "
            "Use only the supplied dish name and menu description as visual references. "
            "Do not add identifiable ingredients, garnishes, sauces, logos, text, or people not supported by that description. "
            "A beautifully composed plate, natural cinematic side light, forest-green and warm-ivory setting, restrained bronze accents, "
            "appetizing texture and a sophisticated editorial mood. Keep the same visual art direction across the series. "
            f"Dish name (data): {name[:120]}. Menu description (data): {description[:450]}.")
    return ("Create a photorealistic, menu-inspired editorial food illustration; never imply it is a photograph from the restaurant. "
        "Use only the supplied dish name and menu description as visual references. "
        "Do not add identifiable ingredients, garnishes, sauces, logos, text, or people not supported by that description. "
        "If no description is supplied, depict only what the dish name directly entails. "
        "Plausible plating, natural edible textures, appetizing color, soft cinematic restaurant light, "
        "forest-green and warm-ivory surroundings, restrained bronze accents. Avoid plastic texture, floating food, "
        "impossible arrangements or ornate garnishes. Keep the art direction consistent across the series. "
        f"Dish name (data): {name[:120]}. Menu description (data): {description[:450]}.")


class MuseImageProvider:
    def __init__(self, transport: httpx.MockTransport | None = None): self.transport = transport

    def generate(self, prompt: str) -> bytes:
        key = 'offline-mock-key' if self.transport else os.getenv('MODEL_API_KEY', '')
        if not key: raise CulinaryError('missing_credentials', 'Muse Image credentials are unavailable.')
        http = httpx.Client(transport=self.transport or httpx.HTTPTransport(retries=0),
            timeout=90, follow_redirects=False, trust_env=False)
        with OpenAI(api_key=key, base_url='https://api.meta.ai/v1', max_retries=0, timeout=90, http_client=http) as client:
            response = client.images.generate(model=MODEL, prompt=prompt, n=1, size='1024x1024',
                response_format='b64_json', extra_body={'output_format': 'webp', 'reasoning_strength': 'low',
                    'tool_enablement': {'enable_image_search': False, 'enable_web_search': False, 'enable_shell': False}})
        if len(response.data) != 1 or not response.data[0].b64_json:
            raise CulinaryError('invalid_image', 'Muse Image returned no usable illustration.')
        try: data = base64.b64decode(response.data[0].b64_json, validate=True)
        except (ValueError, TypeError): raise CulinaryError('invalid_image', 'Muse Image returned invalid image data.') from None
        if not 100 <= len(data) <= 6_000_000 or data[:4] != b'RIFF' or data[8:12] != b'WEBP':
            raise CulinaryError('invalid_image', 'Muse Image did not return a supported WebP illustration.')
        return data


class ImageStore:
    def __init__(self, root: Path = ROOT): self.root = Path(root)

    def _connect(self):
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        db_path = self.root / 'images.sqlite3'
        if db_path.is_symlink(): raise CulinaryError('image_cache', 'The private illustration cache is unavailable.')
        db = sqlite3.connect(db_path, timeout=5)
        os.chmod(db_path, 0o600)
        db.execute('''CREATE TABLE IF NOT EXISTS illustrations (
            guest_id TEXT NOT NULL, context_digest TEXT NOT NULL, item_id TEXT NOT NULL,
            file_key TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','ready','failed')),
            created_at TEXT NOT NULL, PRIMARY KEY(guest_id, context_digest, item_id))''')
        return db

    def prepare(self, guest: UUID, result: RealPicksResult):
        work = []
        if result.mode != 'meta' or result.status != 'ready': return work
        try:
            with self._connect() as db:
                db.execute('BEGIN IMMEDIATE')
                for pick in result.recommendations[:3]:
                    prompt = image_prompt(pick.dish.name, pick.dish.description)
                    # The illustration is tied to verified menu text, not the
                    # guest's changing budget or temporary refinements.
                    cache_prompt = image_prompt(pick.dish.name, pick.dish.description, legacy_cache_key=True)
                    file_key = sha256(f'{PROMPT_VERSION}:{guest}:{result.restaurant_id}:{result.menu_version}:{pick.dish.id}:{cache_prompt}'.encode()).hexdigest()
                    reusable = db.execute('SELECT 1 FROM illustrations WHERE guest_id=? AND file_key=? AND status=? LIMIT 1',
                        (str(guest), file_key, 'ready')).fetchone()
                    ready = bool(reusable and (self.root / 'images' / f'{file_key}.webp').is_file())
                    cursor = db.execute('INSERT OR IGNORE INTO illustrations VALUES (?,?,?,?,?,?)',
                        (str(guest), result.context_digest, pick.dish.id, file_key,
                         'ready' if ready else 'pending', datetime.now(timezone.utc).isoformat()))
                    if cursor.rowcount and not ready: work.append((result.context_digest, pick.dish.id, file_key, prompt))
        except sqlite3.Error:
            raise CulinaryError('image_cache', 'The private illustration cache is unavailable.') from None
        return work

    def read(self, guest: UUID, digest: str, item_id: str):
        if not re.fullmatch(r'[0-9a-f]{64}', digest): return None
        try:
            with self._connect() as db:
                row = db.execute('SELECT file_key, status FROM illustrations WHERE guest_id=? AND context_digest=? AND item_id=?',
                    (str(guest), digest, item_id)).fetchone()
        except sqlite3.Error:
            return None
        if not row: return None
        path = self.root / 'images' / f'{row[0]}.webp'
        # A later validated recommendation may have generated the same dish
        # after this context failed. The key includes guest, menu and prompt;
        # reuse its actual cached bytes without another billable generation.
        try: return 'ready', path.read_bytes()
        except OSError: return (row[1], None) if row[1] != 'ready' else ('failed', None)

    def finish(self, guest: UUID, digest: str, item_id: str, file_key: str, data: bytes | None):
        try:
            if data:
                directory = self.root / 'images'; directory.mkdir(mode=0o700, exist_ok=True)
                target = directory / f'{file_key}.webp'
                temporary = directory / f'{file_key}.tmp-{os.getpid()}'
                with open(temporary, 'xb') as handle: handle.write(data)
                os.chmod(temporary, 0o600); os.replace(temporary, target)
            with self._connect() as db:
                db.execute('UPDATE illustrations SET status=? WHERE guest_id=? AND context_digest=? AND item_id=? AND file_key=? AND status=?',
                    ('ready' if data else 'failed', str(guest), digest, item_id, file_key, 'pending'))
        except (OSError, sqlite3.Error):
            # Pending is intentionally not retried after a crash or write error.
            return


def generate_prepared_images(guest: UUID, work, policy: ImagePolicy, *, store: ImageStore | None = None,
                             provider: MuseImageProvider | None = None, budget: UsageBudget | None = None):
    store = store or ImageStore()
    provider = provider or MuseImageProvider()
    budget = budget or UsageBudget(extra_limits={MILESTONE: (policy.cap_usd, policy.max_images)})
    phase = None if not isinstance(provider, MuseImageProvider) or provider.transport is not None else ValidationSpend.from_environment()
    for position, (digest, item_id, file_key, prompt) in enumerate(work):
        phase_id = None
        try:
            if phase: phase_id = phase.reserve('meta', MODEL, 'pick_illustration', Decimal('0.01'))
            reservation = budget.reserve_image(MILESTONE)
        except CulinaryError:
            if phase and phase_id: phase.finish(phase_id, 'cancelled')
            store.finish(guest, digest, item_id, file_key, None); continue
        data = None
        try: data = provider.generate(prompt)
        except Exception: pass  # Never log a prompt, key, response body or private record.
        finally:
            budget.finish_image(reservation, success=data is not None)
            if phase and phase_id: phase.finish(phase_id, 'success' if data is not None else 'failed', Decimal('0.01') if data else None)
        store.finish(guest, digest, item_id, file_key, data)
        if data is None:
            # A common provider/configuration failure should not consume the
            # remaining distinct-image allowance automatically.
            for rest_digest, rest_item, rest_key, _ in work[position + 1:]:
                store.finish(guest, rest_digest, rest_item, rest_key, None)
            break
