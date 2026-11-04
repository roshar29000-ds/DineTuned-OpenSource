"""Muse Image integration tests use only in-memory HTTP mocks and temp ledgers."""
import base64
import json
from decimal import Decimal
from pathlib import Path
from uuid import uuid4

import httpx
import pytest

from app.culinary.errors import CulinaryError
from app.real_picks.illustrations import (ImagePolicy, ImageStore, MuseImageProvider, MILESTONE,
    generate_prepared_images, image_prompt)
from app.real_picks.pipeline import recommend
from app.usage_budget import UsageBudget
from test_real_picks import fixture, mocked_provider, proposal

WEBP = b'RIFF' + b'\x00\x00\x00\x00' + b'WEBP' + b'x' * 100


def test_image_provider_uses_official_endpoint_one_image_and_no_paid_tools():
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={'created': 0, 'data': [{'b64_json': base64.b64encode(WEBP).decode()}],
            'output_format': 'webp'})
    provider = MuseImageProvider(httpx.MockTransport(respond))
    assert provider.generate(image_prompt('Charred chicken', 'Grilled chicken, lemon and potatoes.')) == WEBP
    assert len(requests) == 1
    assert str(requests[0].url) == 'https://api.meta.ai/v1/images/generations'
    body = json.loads(requests[0].content)
    assert body['model'] == 'muse-image-1.0' and body['n'] == 1
    assert body['response_format'] == 'b64_json' and body['reasoning_strength'] == 'low'
    assert body['tool_enablement'] == {'enable_image_search': False, 'enable_web_search': False, 'enable_shell': False}
    assert 'Grilled chicken, lemon and potatoes.' in body['prompt']


def test_disabled_default_and_no_credential_cannot_authorize(monkeypatch):
    monkeypatch.delenv('DINETUNED_MUSE_IMAGE_ENABLED', raising=False)
    for name in ('DINETUNED_MUSE_IMAGE_APPROVAL_ID', 'DINETUNED_MUSE_IMAGE_CAP_USD', 'DINETUNED_MUSE_IMAGE_MAX_IMAGES'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('MODEL_API_KEY', 'offline-key')
    assert ImagePolicy.from_environment() is None
    monkeypatch.setenv('DINETUNED_MUSE_IMAGE_ENABLED', 'true')
    assert ImagePolicy.from_environment() is None
    monkeypatch.setenv('DINETUNED_MUSE_IMAGE_APPROVAL_ID', 'owner-approved-offline')
    monkeypatch.setenv('DINETUNED_MUSE_IMAGE_CAP_USD', '0.03')
    monkeypatch.setenv('DINETUNED_MUSE_IMAGE_MAX_IMAGES', '3')
    assert ImagePolicy.from_environment() == ImagePolicy(Decimal('0.03'), 3)


def test_only_three_validated_primary_picks_are_prepared_and_cached_per_guest(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    store = ImageStore(tmp_path / 'private')
    guest, stranger = uuid4(), uuid4()
    work = store.prepare(guest, result)
    assert len(work) == 3 and store.prepare(guest, result) == []
    assert store.read(guest, result.context_digest, result.recommendations[0].dish.id) == ('pending', None)
    assert store.read(stranger, result.context_digest, result.recommendations[0].dish.id) is None
    digest, item_id, file_key, _ = work[0]
    store.finish(guest, digest, item_id, file_key, WEBP)
    assert store.read(guest, digest, item_id) == ('ready', WEBP)
    assert store.prepare(guest, result) == []
    assert not list((tmp_path / 'private' / 'images').glob('*.tmp-*'))


def test_same_verified_dish_reuses_illustration_after_refinement(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    store = ImageStore(tmp_path / 'private'); guest = uuid4()
    digest, item_id, key, _ = store.prepare(guest, result)[0]
    store.finish(guest, digest, item_id, key, WEBP)
    refined = result.model_copy(deep=True)
    refined.context_digest = 'a' * 64 if digest != 'a' * 64 else 'b' * 64
    work = store.prepare(guest, refined)
    assert item_id not in {entry[1] for entry in work}
    assert store.read(guest, refined.context_digest, item_id) == ('ready', WEBP)


def test_failed_context_can_read_later_cached_identical_dish_without_generation(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    store = ImageStore(tmp_path / 'private'); guest = uuid4()
    digest, item_id, key, _ = store.prepare(guest, result)[0]
    store.finish(guest, digest, item_id, key, None)
    assert store.read(guest, digest, item_id) == ('failed', None)
    refined = result.model_copy(deep=True)
    refined.context_digest = 'a' * 64 if digest != 'a' * 64 else 'b' * 64
    later = next(work for work in store.prepare(guest, refined) if work[1] == item_id)
    store.finish(guest, later[0], item_id, later[2], WEBP)
    assert later[2] == key
    assert store.read(guest, digest, item_id) == ('ready', WEBP)


def test_named_dish_without_description_is_prepared_without_inventing_ingredients(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    result.recommendations[0].dish.description = ''
    work = ImageStore(tmp_path / 'private').prepare(uuid4(), result)
    assert len(work) == 3
    assert 'If no description is supplied' in work[0][3]
    assert 'Menu description (data): .' in work[0][3]


def test_image_attempts_share_cumulative_ledger_and_fail_closed(tmp_path):
    path = tmp_path / 'usage.json'
    budget = UsageBudget(path, extra_limits={MILESTONE: (Decimal('0.03'), 3)})
    ids = [budget.reserve_image(MILESTONE) for _ in range(3)]
    for identifier in ids: budget.finish_image(identifier, success=True)
    assert budget.summary(MILESTONE)['accounted_usd'] == '0.03'
    with pytest.raises(CulinaryError, match='limit'):
        budget.reserve_image(MILESTONE)
    assert UsageBudget(path).summary('4D.5A')['accounted_usd'] == '0.03'


def test_background_generation_stores_mock_image_without_repeat(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    store = ImageStore(tmp_path / 'private'); guest = uuid4(); work = store.prepare(guest, result)
    class FakeImage:
        def __init__(self): self.calls = 0
        def generate(self, prompt): self.calls += 1; return WEBP
    fake = FakeImage()
    budget = UsageBudget(tmp_path / 'usage.json', extra_limits={MILESTONE: (Decimal('0.03'), 3)})
    generate_prepared_images(guest, work, ImagePolicy(Decimal('0.03'), 3), store=store, provider=fake, budget=budget)
    assert fake.calls == 3
    assert all(store.read(guest, result.context_digest, pick.dish.id)[0] == 'ready' for pick in result.recommendations)
    assert store.prepare(guest, result) == []
    assert budget.summary(MILESTONE)['accounted_usd'] == '0.03'


def test_provider_failure_consumes_only_one_image_attempt(tmp_path):
    req = fixture(); provider, _ = mocked_provider(proposal(req))
    result = recommend(req, provider); result.mode = 'meta'
    store = ImageStore(tmp_path / 'private'); guest = uuid4(); work = store.prepare(guest, result)
    class BrokenImage:
        calls = 0
        def generate(self, prompt):
            self.calls += 1
            raise CulinaryError('provider_error', 'Offline simulated failure')
    broken = BrokenImage()
    budget = UsageBudget(tmp_path / 'usage.json', extra_limits={MILESTONE: (Decimal('0.03'), 3)})
    generate_prepared_images(guest, work, ImagePolicy(Decimal('0.03'), 3), store=store, provider=broken, budget=budget)
    assert broken.calls == 1
    assert budget.summary(MILESTONE)['attempts'] == 1
    assert all(store.read(guest, digest, item_id)[0] == 'failed' for digest, item_id, _, _ in work)
