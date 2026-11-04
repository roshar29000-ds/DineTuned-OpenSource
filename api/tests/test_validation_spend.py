"""Offline validation-phase spending and local-only technical mode checks."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from threading import Barrier
import pytest
from starlette.requests import Request

from app.culinary.errors import CulinaryError
from app.real_picks.routes import _local_technical_mode, get_request_policy
from app.real_picks.live_gate import LocalValidationDietPolicy
from app.schemas import DietaryRestriction
from test_real_picks import fixture
from app.validation_spend import ValidationSpend


def test_validation_phase_reserves_inflight_and_preserves_failed_cost(tmp_path):
    budget = ValidationSpend(tmp_path)
    first = budget.reserve('meta', 'muse-spark-1.3', 'test', Decimal('2.70'))
    with pytest.raises(CulinaryError, match='limit'):
        budget.reserve('meta', 'muse-image-1.0', 'test', Decimal('0.06'))
    budget.finish(first, 'failed')
    assert budget.summary()['upper_accounted_usd'] == Decimal('2.70')
    with pytest.raises(CulinaryError, match='limit'):
        budget.reserve('google_places', 'places_new', 'details', Decimal('0.06'))


def test_validation_phase_cancellation_and_concurrency(tmp_path):
    budget = ValidationSpend(tmp_path)
    cancelled = budget.reserve('meta', 'muse-spark-1.3', 'blocked-before-transport', Decimal('2.5'))
    budget.finish(cancelled, 'cancelled')
    gate = Barrier(4)
    def reserve_one(_):
        gate.wait()
        try: return budget.reserve('meta', 'muse-spark-1.3', 'parallel', Decimal('1.0'))
        except CulinaryError: return None
    with ThreadPoolExecutor(max_workers=4) as pool:
        ids = list(pool.map(reserve_one, range(4)))
    assert sum(value is not None for value in ids) == 2
    assert budget.summary()['upper_accounted_usd'] == Decimal('2.0')


def test_technical_policy_only_on_explicit_loopback_validation(monkeypatch):
    local = Request({'type': 'http', 'path': '/', 'headers': [], 'client': ('127.0.0.1', 0), 'server': ('127.0.0.1', 8000)})
    remote = Request({'type': 'http', 'path': '/', 'headers': [], 'client': ('203.0.113.5', 0), 'server': ('api.example.com', 443)})
    monkeypatch.setenv('DINETUNED_LOCAL_TECHNICAL_TEST', 'true')
    monkeypatch.setenv('DINETUNED_VALIDATION_PHASE_ENABLED', 'true')
    assert _local_technical_mode(local) and get_request_policy(local) is not None
    assert not _local_technical_mode(remote) and get_request_policy(remote) is None
    proxied = Request({'type': 'http', 'path': '/', 'headers': [], 'client': ('127.0.0.1', 0), 'server': ('api.example.com', 443)})
    assert not _local_technical_mode(proxied)
    monkeypatch.delenv('DINETUNED_VALIDATION_PHASE_ENABLED')
    assert get_request_policy(local) is None


def test_local_validation_preserves_normal_hard_diet_for_other_guests():
    policy = LocalValidationDietPolicy()
    request = fixture()
    request.profile.dietary_restrictions = [DietaryRestriction.vegetarian]
    assert policy.prepare(request) is request and not policy.applied
    request.profile.dietary_restrictions = [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
    assert policy.prepare(request) is not request and policy.applied
    assert request.profile.dietary_restrictions == [DietaryRestriction.no_beef, DietaryRestriction.no_pork]
