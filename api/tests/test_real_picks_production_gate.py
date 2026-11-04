"""No network, paid provider, or live ledger writes in these production-gate tests."""
from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Lock
from time import sleep
from uuid import uuid4
import os

import pytest

from app.culinary.errors import CulinaryError
from app.culinary.meta import MetaConfig, request_body
from app.culinary.smoke_fixture import smoke_context
from app.real_picks.models import RealCulinaryProposal, RealProviderOutput
from app.real_picks.production_gate import ProductionPolicy, ProductionProposalCache, ProductionRealProvider, MILESTONE
from app.real_picks.routes import get_capability
from app.usage_budget import UsageBudget, estimate_request, TokenUsage


class Context:
    def __init__(self, char='a'): self.digest = char * 64


class FakeMeta:
    def __init__(self, *, fail=False): self.calls, self.fail, self.lock = 0, fail, Lock()

    def propose(self, context):
        with self.lock: self.calls += 1
        sleep(.03)
        if self.fail: raise CulinaryError('offline_failure', 'Offline fake failed.')
        return RealProviderOutput(mode='meta', model='muse-spark-1.3',
            proposal=RealCulinaryProposal(restaurant_id='place-one', menu_version='menu-one', candidates=[], pairings=[]))


def policy(): return ProductionPolicy(cap_usd=Decimal('0.50'), max_attempts=3, daily_per_guest=2)


def test_key_alone_never_enables_production(monkeypatch):
    for name in ('DINETUNED_META_PRODUCTION_ENABLED', 'DINETUNED_META_PRODUCTION_APPROVAL_ID',
                 'DINETUNED_META_PRODUCTION_CAP_USD', 'DINETUNED_META_PRODUCTION_MAX_ATTEMPTS',
                 'DINETUNED_META_PRODUCTION_DAILY_PER_GUEST'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('MODEL_API_KEY', 'offline-key-not-real')
    assert ProductionPolicy.from_environment() is None
    assert get_capability().available is False
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_ENABLED', 'true')
    with pytest.raises(CulinaryError, match='owner-approved'):
        ProductionPolicy.from_environment()
    assert get_capability().available is False


def test_complete_explicit_policy_is_bounded(monkeypatch):
    monkeypatch.setenv('MODEL_API_KEY', 'offline-key-not-real')
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_ENABLED', 'true')
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_APPROVAL_ID', 'owner-approved-offline-test')
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_CAP_USD', '0.50')
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_MAX_ATTEMPTS', '3')
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_DAILY_PER_GUEST', '2')
    assert ProductionPolicy.from_environment() == policy()
    monkeypatch.setenv('DINETUNED_META_PRODUCTION_CAP_USD', '11')
    with pytest.raises(CulinaryError): ProductionPolicy.from_environment()


def test_guest_scoped_result_cache_prevents_duplicate_dispatch_and_obeys_daily_limit():
    with TemporaryDirectory() as directory:
        cache = ProductionProposalCache(Path(directory) / 'private' / 'proposals.sqlite3')
        guest, other = uuid4(), uuid4()
        fake = FakeMeta()
        provider = ProductionRealProvider(guest, policy(), cache=cache, delegate=fake)
        first = provider.propose(Context())
        assert provider.propose(Context()) == first
        assert fake.calls == 1
        provider.propose(Context('b'))
        with pytest.raises(CulinaryError, match='daily'):
            provider.propose(Context('c'))
        other_fake = FakeMeta()
        assert ProductionRealProvider(other, policy(), cache=cache, delegate=other_fake).propose(Context()) == first
        assert other_fake.calls == 1
        assert os.stat(cache.path).st_mode & 0o777 == 0o600


def test_failure_and_concurrent_duplicates_never_auto_retry():
    with TemporaryDirectory() as directory:
        cache = ProductionProposalCache(Path(directory) / 'private' / 'proposals.sqlite3')
        guest = uuid4()
        fake = FakeMeta(fail=True)
        provider = ProductionRealProvider(guest, policy(), cache=cache, delegate=fake)
        with pytest.raises(CulinaryError, match='Offline fake failed'):
            provider.propose(Context())
        with pytest.raises(CulinaryError, match='already been attempted'):
            provider.propose(Context())
        assert fake.calls == 1
        working = FakeMeta()
        second = ProductionRealProvider(guest, policy(), cache=cache, delegate=working)
        def try_call():
            try: return second.propose(Context('b'))
            except CulinaryError as error: return error.code
        with ThreadPoolExecutor(max_workers=6) as pool:
            results = list(pool.map(lambda _: try_call(), range(6)))
        assert working.calls == 1
        assert sum(isinstance(value, RealProviderOutput) for value in results) == 1
        assert all(isinstance(value, RealProviderOutput) or value == 'request_pending' for value in results)


def test_new_policy_uses_same_cumulative_ledger_without_resetting_old_entries():
    with TemporaryDirectory() as directory:
        path = Path(directory) / 'usage.json'
        old = UsageBudget(path)
        quote = estimate_request(request_body(smoke_context(), MetaConfig()))
        prior = old.reserve(quote, '4D.1')
        old.finish(prior, 'success', TokenUsage(input_tokens=100, output_tokens=100, total_tokens=200))
        previous_total = Decimal(old.summary('4D.1')['accounted_usd'])
        extra = UsageBudget(path, extra_limits={MILESTONE: (Decimal('0.50'), 3)})
        assert Decimal(extra.summary(MILESTONE)['accounted_usd']) == previous_total
        current = extra.reserve(quote, MILESTONE)
        extra.finish(current, 'success', TokenUsage(input_tokens=100, output_tokens=100, total_tokens=200))
        assert Decimal(extra.summary(MILESTONE)['accounted_usd']) > previous_total
        with pytest.raises(CulinaryError):
            UsageBudget(path, extra_limits={'4D.5A': (Decimal('1'), 2)})
