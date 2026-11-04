"""Offline guest table recovery; reading a snapshot must never invoke inference."""
from uuid import uuid4

from fastapi.testclient import TestClient

from app.discovery.models import MenuDiscoveryHandoff
from app.main import app
from app.menu_sources.identity import SelectionProof
from app.menu_sources.routes import get_proof
from app.persistence.auth import UserIdentity
from app.persistence.routes import get_user
from app.real_picks.routes import get_provider
from app.real_picks.table_store import GuestTableStore, get_table_store
from app.real_picks.pipeline import recommend
from test_real_picks import fixture, mocked_provider, proposal, USER


def test_guest_table_survives_new_request_and_guest_isolation(tmp_path):
    proof = SelectionProof(b'p' * 32)
    request = fixture()
    provider, calls = mocked_provider(proposal(request))
    result = recommend(request, provider)
    assert result.status == 'ready' and len(calls) == 1
    restaurant = request.extraction.menu.restaurant
    handoff = MenuDiscoveryHandoff(restaurant=restaurant, limitations=[],
        source_discovery_token=proof.issue(restaurant, USER))
    store = GuestTableStore(tmp_path / 'private.sqlite3')
    store.save_selection(USER, handoff)
    store.save_extraction(USER, restaurant, handoff.source_discovery_token, request.extraction)
    store.save_picks(USER, request, result)

    # A new store instance represents a new tab/process; GET never calls Meta.
    restored = GuestTableStore(store.path).load(USER, proof)
    assert restored.selection == handoff
    assert restored.extraction == request.extraction
    assert restored.request == request
    assert restored.picks == result
    assert GuestTableStore(store.path).load(uuid4(), proof).selection is None
    assert len(calls) == 1

    client = TestClient(app)
    app.dependency_overrides[get_table_store] = lambda: GuestTableStore(store.path)
    app.dependency_overrides[get_proof] = lambda: proof
    app.dependency_overrides[get_provider] = lambda: (_ for _ in ()).throw(AssertionError('GET must not resolve a provider'))
    try:
        assert client.get('/api/v2/real-picks/table').status_code == 401
        app.dependency_overrides[get_user] = lambda: UserIdentity(USER, True, 'offline.test.signature')
        response = client.get('/api/v2/real-picks/table')
        assert response.status_code == 200 and response.json()['picks']['status'] == 'ready'
        assert response.headers['cache-control'] == 'private, no-store'
        app.dependency_overrides[get_user] = lambda: UserIdentity(uuid4(), True, 'offline.test.signature')
        assert client.get('/api/v2/real-picks/table').json()['selection'] is None
    finally:
        app.dependency_overrides.clear()

    store.clear_if_selected(USER, 'wrong-token')
    assert store.load(USER, proof).picks == result
    store.clear_if_selected(USER, handoff.source_discovery_token)
    assert store.load(USER, proof).selection is None


def test_invalid_or_expired_selection_proof_never_restores(tmp_path):
    request = fixture()
    restaurant = request.extraction.menu.restaurant
    proof = SelectionProof(b'p' * 32, clock=lambda: 1000)
    handoff = MenuDiscoveryHandoff(restaurant=restaurant, limitations=[],
        source_discovery_token=proof.issue(restaurant, USER))
    store = GuestTableStore(tmp_path / 'private.sqlite3')
    store.save_selection(USER, handoff)
    assert store.load(USER, SelectionProof(b'q' * 32, clock=lambda: 1000)).selection is None
    assert store.load(USER, SelectionProof(b'p' * 32, clock=lambda: 1000)).selection == handoff
    assert store.load(USER, SelectionProof(b'p' * 32, clock=lambda: 1000 + 24 * 3600)).selection is None
