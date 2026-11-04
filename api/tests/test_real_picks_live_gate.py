"""Offline approval, one-shot and durable-budget checks; no paid transport."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from uuid import uuid4
import subprocess
import sys
from fastapi.testclient import TestClient
import pytest
from app.main import app
from app.culinary.errors import CulinaryError
from app.culinary.meta import MetaConfig, request_body
from app.culinary.smoke_fixture import smoke_context
from app.usage_budget import UsageBudget, MILESTONES, CUMULATIVE_LIMIT, estimate_request
from app.persistence.auth import UserIdentity
from app.persistence.routes import get_user, get_repository
from app.menu_sources.routes import get_proof
from app.menu_sources.identity import SelectionProof
from app.real_picks.live_gate import OneShotProvider, bind_approved_user
from test_real_picks import fixture, proposal, mocked_provider, USER


def test_one_guest_one_provider_attempt_and_invalid_snapshot_does_not_spend():
    request = fixture(); mocked, calls = mocked_provider(proposal(request))
    provider = OneShotProvider(lambda: mocked)
    app.dependency_overrides[get_proof] = lambda: SelectionProof(b'p'*32)
    app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
    class EmptyMemory:
        reads = 0
        def evidence(self, offset=0):
            self.reads += 1
            return []
        def events(self, offset=0):
            self.reads += 1
            return []
    memory = EmptyMemory()
    app.dependency_overrides[get_repository] = lambda: memory
    bind_approved_user(app, USER, provider)
    client = TestClient(app)
    try:
        assert client.get('/api/v2/real-picks/config').json()['mode'] == 'meta'
        app.dependency_overrides[get_user] = lambda: UserIdentity(uuid4(), True, 'offline.test.signature')
        assert client.post('/api/v2/real-picks/sessions', json=request.model_dump(mode='json')).status_code == 403
        assert not provider.attempted and not calls
        app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
        changed = request.model_dump(mode='json'); changed['extraction']['menu']['version'] = 'forged'
        assert client.post('/api/v2/real-picks/sessions', json=changed).status_code == 409
        assert not provider.attempted and not calls
        first = client.post('/api/v2/real-picks/sessions', json=request.model_dump(mode='json'))
        assert first.status_code == 200 and first.json()['status'] == 'ready' and len(calls) == 1
        assert memory.reads == 2  # The verified guest's Taste Memory reached the route.
        again = client.post('/api/v2/real-picks/sessions', json=request.model_dump(mode='json'))
        assert again.status_code == 200 and again.json()['error_code'] == 'attempt_limit' and len(calls) == 1
    finally:
        app.dependency_overrides.clear()


def test_one_shot_gate_is_thread_safe_even_if_provider_fails():
    calls = []
    class Broken:
        def propose(self, context):
            calls.append(1)
            raise CulinaryError('provider_error', 'Offline failure')
    provider = OneShotProvider(Broken)
    def invoke(_):
        try: provider.propose(None)
        except CulinaryError as error: return error.code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert set(pool.map(invoke, range(2))) == {'provider_error', 'attempt_limit'}
    assert calls == [1]


def test_real_milestone_one_attempt_preserves_ten_dollar_ledger(tmp_path):
    assert MILESTONES['4D.5A'] == (Decimal('1'), 1)
    assert CUMULATIVE_LIMIT == Decimal('10')
    budget = UsageBudget(tmp_path/'usage.json')
    estimate = estimate_request(request_body(smoke_context(), MetaConfig()))
    budget.reserve(estimate, '4D.5A')
    before = budget.path.read_bytes()
    with pytest.raises(CulinaryError, match='at most 1'):
        UsageBudget(budget.path).reserve(estimate, '4D.5A')
    assert budget.path.read_bytes() == before
    assert budget.summary('4D.5A')['attempts'] == 1


def test_runner_defaults_offline_and_rejects_partial_flags():
    script = Path(__file__).resolve().parents[1] / 'scripts/real_picks_live.py'
    offline = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, check=False)
    assert offline.returncode == 0 and 'OFFLINE PREFLIGHT' in offline.stdout
    partial = subprocess.run([sys.executable, str(script), '--live'], capture_output=True, text=True, check=False)
    assert partial.returncode != 0 and '--confirm-spend' in partial.stderr
    image_without_live = subprocess.run([sys.executable, str(script), '--image-review'], capture_output=True, text=True, check=False)
    assert image_without_live.returncode != 0 and '--image-review requires' in image_without_live.stderr


def test_recovery_milestone_allows_one_new_call_without_reusing_spent_allowance(tmp_path):
    estimate = estimate_request(request_body(smoke_context(), MetaConfig()))
    path = tmp_path / 'usage.json'
    legacy = UsageBudget(path)
    legacy.reserve(estimate, '4D.5A')
    recovery = UsageBudget(path, extra_limits={'4D.IMAGE_REVIEW': (Decimal('0.08'), 1)})
    first = recovery.reserve(estimate, '4D.IMAGE_REVIEW')
    assert first and recovery.summary('4D.5A')['attempts'] == 1
    with pytest.raises(CulinaryError, match='at most 1'):
        recovery.reserve(estimate, '4D.IMAGE_REVIEW')
    assert recovery.summary('4D.IMAGE_REVIEW')['attempts'] == 1
