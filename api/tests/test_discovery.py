"""Offline Places integration and durable paid-request boundaries."""
from concurrent.futures import ThreadPoolExecutor
import json
import sqlite3
from uuid import uuid4
import httpx
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.discovery import routes
from app.discovery.config import PlacesConfig, DiscoveryError
from app.discovery.limits import DiscoveryLimits
from app.discovery.models import DiscoverySearch, DiscoverySelection, DiscoveryLocation, MenuDiscoveryHandoff
from app.discovery.providers import GooglePlacesProvider, DemoRestaurantDiscoveryProvider, DETAILS_MASK, AUTOCOMPLETE_MASK
from app.persistence import routes as memory_routes

KEY = 'offline_only_google_key_never_real_12345'
USER = uuid4()


def prediction(identifier='branch_north', address='100 North Street, Chicago'):
    return {'placePrediction': {'placeId': identifier, 'structuredFormat': {'mainText': {'text': 'Shared Name'},
        'secondaryText': {'text': address}}, 'types': ['korean_restaurant', 'food'], 'distanceMeters': 410}}


def detail(identifier='branch_north', **updates):
    return {'id': identifier, 'displayName': {'text': 'Shared Name'}, 'formattedAddress': '100 North Street, Chicago',
        'location': {'latitude': 41.9, 'longitude': -87.6}, 'businessStatus': 'OPERATIONAL', 'types': ['korean_restaurant'], **updates}


def adapter(handler, config=None):
    return GooglePlacesProvider(config or PlacesConfig(True, True, KEY), httpx.Client(transport=httpx.MockTransport(handler)))


@pytest.mark.parametrize('location,area,mode', [(None, '', 'global'), (DiscoveryLocation(latitude=41.9, longitude=-87.6), '', 'nearby'), (DiscoveryLocation(latitude=41.9, longitude=-87.6), 'Tokyo', 'area')])
def test_predictions_branch_identity_location_and_minimal_fields(location, area, mode):
    calls = []
    def mock(request):
        calls.append(request)
        return httpx.Response(200, json={'suggestions': [prediction(), prediction('branch_south', '200 South Street, Chicago'), prediction(),
            {'queryPrediction': {'text': 'not a place'}}, {'placePrediction': {'placeId': 'park', 'types': ['park']}}]})
    value = DiscoverySearch(session_token=uuid4(), query='Shared Name', area=area, location=location)
    result = adapter(mock).autocomplete(value)
    assert [p.place_id for p in result.predictions] == ['branch_north', 'branch_south']
    assert result.predictions[0].address != result.predictions[1].address
    assert result.location_mode == mode
    req = calls[0]; body = json.loads(req.content)
    assert str(req.url) == 'https://places.googleapis.com/v1/places:autocomplete'
    assert req.headers['X-Goog-FieldMask'] == AUTOCOMPLETE_MASK
    assert req.headers['X-Goog-Api-Key'] == KEY and KEY not in str(req.url)
    assert body['sessionToken'] == str(value.session_token)
    assert 'locationRestriction' not in body and 'includedRegionCodes' not in body
    if mode == 'nearby':
        assert body['origin'] == location.model_dump() and body['locationBias']['circle']['radius'] == 25000
    else:
        assert 'origin' not in body and body['locationBias']['rectangle']['low']['longitude'] == -180
    assert body['input'] == ('Shared Name in Tokyo' if area else 'Shared Name')


@pytest.mark.parametrize('payload,count', [({}, 0), ({'suggestions': []}, 0), ({'suggestions': [None, {'placePrediction': {'placeId': 'partial'}}]}, 0),
    ({'suggestions': [{'placePrediction': {'placeId': 'partial', 'structuredFormat': {'mainText': {'text': 'Known name'}}}}]}, 1)])
def test_empty_partial_results_never_invent_metadata(payload, count):
    result = adapter(lambda _: httpx.Response(200, json=payload)).autocomplete(DiscoverySearch(session_token=uuid4(), query='Cafe'))
    assert len(result.predictions) == count
    if count:
        assert result.predictions[0].address is None and result.predictions[0].types == []


@pytest.mark.parametrize('status', ['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY', 'UNKNOWN'])
def test_details_handoff_no_menu_and_closed_status(status):
    calls = []
    def mock(req):
        calls.append(req)
        return httpx.Response(200, json=detail(businessStatus=status, attributions=[{'provider': 'Data partner', 'providerUri': 'https://example.org/source'}]))
    value = DiscoverySelection(session_token=uuid4(), place_id='branch_north')
    result = adapter(mock).details(value)
    assert isinstance(result, MenuDiscoveryHandoff) and result.menu_status == 'not_retrieved'
    assert result.restaurant.source.place_id == result.restaurant.place_id == value.place_id
    assert result.restaurant.business_status == status
    assert 'menu_version' not in result.model_dump() and 'dishes' not in result.model_dump()
    assert calls[0].url.params['sessionToken'] == str(value.session_token)
    assert calls[0].headers['X-Goog-FieldMask'] == DETAILS_MASK
    assert not any(field in DETAILS_MASK for field in ['websiteUri', 'rating', 'reviews', 'photos', 'openingHours'])


def test_missing_details_are_honest_and_attribution_urls_safe():
    result = adapter(lambda _: httpx.Response(200, json=detail(formattedAddress=None, location=None,
        attributions=[{'provider': 'Partner', 'providerUri': 'javascript:alert(1)'}]))).details(DiscoverySelection(session_token=uuid4(), place_id='branch_north'))
    assert result.restaurant.location is None and result.restaurant.formatted_address is None
    assert len(result.limitations) == 3 and result.restaurant.attributions[0].uri is None


@pytest.mark.parametrize('payload', [detail('wrong_id'), detail(types=['park']), detail(types=[]), detail(displayName={}), [], {'id': 'branch_north'}])
def test_invalid_identity_is_rejected(payload):
    with pytest.raises(DiscoveryError):
        adapter(lambda _: httpx.Response(200, json=payload)).details(DiscoverySelection(session_token=uuid4(), place_id='branch_north'))


@pytest.mark.parametrize('code', [400, 401, 403, 404, 429, 500])
def test_provider_errors_are_sanitized_without_retry(code):
    calls = []
    def mock(request):
        calls.append(request)
        return httpx.Response(code, json={'error': {'message': KEY + ' private query'}})
    with pytest.raises(DiscoveryError) as error:
        adapter(mock).autocomplete(DiscoverySearch(session_token=uuid4(), query='Cafe'))
    assert len(calls) == 1 and KEY not in str(error.value) and 'private query' not in str(error.value)


def test_timeouts_and_malformed_json_no_retry():
    for exc in [httpx.ReadTimeout('secret'), httpx.ConnectError('secret')]:
        calls = []
        def mock(req):
            calls.append(req); raise exc
        with pytest.raises(DiscoveryError):
            adapter(mock).details(DiscoverySelection(session_token=uuid4(), place_id='branch_north'))
        assert len(calls) == 1
    with pytest.raises(DiscoveryError):
        adapter(lambda _: httpx.Response(200, text='not json')).autocomplete(DiscoverySearch(session_token=uuid4(), query='Cafe'))


@pytest.mark.parametrize('config', [PlacesConfig(), PlacesConfig(api_key=KEY), PlacesConfig(True, False, KEY), PlacesConfig(False, True, KEY), PlacesConfig(True, True, '')])
def test_disabled_by_default_even_with_key(config):
    def forbidden(_):
        pytest.fail('Disabled integration must never call transport')
    with pytest.raises(DiscoveryError):
        adapter(forbidden, config).autocomplete(DiscoverySearch(session_token=uuid4(), query='Cafe'))
    assert KEY not in repr(config)


def test_durable_limits_sessions_expiry_ownership_and_prediction_membership(tmp_path):
    clock = [1800000000.0]
    path = tmp_path / 'usage.sqlite3'; limits = DiscoveryLimits(path, lambda: clock[0])
    session = limits.start(USER); token = session.session_token
    with pytest.raises(DiscoveryError, match='ended'):
        limits.reserve(uuid4(), token, 'autocomplete')
    for _ in range(8):
        limits.reserve(USER, token, 'autocomplete')
    with pytest.raises(DiscoveryError, match='limit'):
        DiscoveryLimits(path, lambda: clock[0]).reserve(USER, token, 'autocomplete')
    with pytest.raises(DiscoveryError, match='Choose a branch'):
        limits.reserve(USER, token, 'details', 'invented')
    limits.remember_ids(token, ['branch_north'])
    limits.reserve(USER, token, 'details', 'branch_north')
    with pytest.raises(DiscoveryError, match='ended'):
        limits.reserve(USER, token, 'details', 'branch_north')
    another = limits.start(USER)
    clock[0] += 301
    with pytest.raises(DiscoveryError, match='ended'):
        limits.reserve(USER, another.session_token, 'autocomplete')


def test_concurrent_details_reserve_once_and_counters_have_no_content(tmp_path):
    path = tmp_path / 'usage.sqlite3'; limits = DiscoveryLimits(path)
    token = limits.start(USER).session_token; limits.remember_ids(token, ['branch_north'])
    def attempt(_):
        try:
            DiscoveryLimits(path).reserve(USER, token, 'details', 'branch_north'); return True
        except DiscoveryError:
            return False
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(executor.map(attempt, range(4))) == 1
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM requests WHERE kind='details'").fetchone()[0] == 1
        dump = '\n'.join(db.iterdump())
    for private in [str(USER), str(token), KEY, 'Shared Name', '100 North Street']:
        assert private not in dump


def test_global_daily_limit_cannot_be_bypassed_by_new_users(tmp_path):
    limits = DiscoveryLimits(tmp_path / 'usage.sqlite3')
    for _ in range(5):
        user = uuid4(); token = limits.start(user).session_token
        limits.remember_ids(token, ['branch_north']); limits.reserve(user, token, 'details', 'branch_north')
    user = uuid4(); token = limits.start(user).session_token; limits.remember_ids(token, ['branch_north'])
    with pytest.raises(DiscoveryError, match='limit'):
        limits.reserve(user, token, 'details', 'branch_north')


def test_per_user_minute_limits_include_failed_or_abandoned_reservations(tmp_path):
    clock = [1800000000.0]
    limits = DiscoveryLimits(tmp_path / 'limits.db', lambda: clock[0])
    for count in [8, 4]:
        token = limits.start(USER).session_token
        for _ in range(count):
            limits.reserve(USER, token, 'autocomplete')
    # There is intentionally no successful response to refund any reservation.
    with pytest.raises(DiscoveryError, match='limit'):
        limits.reserve(USER, token, 'autocomplete')
    clock[0] += 61
    limits.reserve(USER, token, 'autocomplete')


def test_per_user_daily_limit_survives_new_sessions_and_limiter_instances(tmp_path):
    clock = [1800000000.0]; path = tmp_path / 'limits.db'
    limits = DiscoveryLimits(path, lambda: clock[0])
    for _ in range(5):
        token = limits.start(USER).session_token
        for _ in range(8):
            limits.reserve(USER, token, 'autocomplete')
        clock[0] += 61
    token = limits.start(USER).session_token
    with pytest.raises(DiscoveryError, match='limit'):
        DiscoveryLimits(path, lambda: clock[0]).reserve(USER, token, 'autocomplete')


def test_controlled_test_grant_survives_restart_expiry_and_day_change(tmp_path):
    path, run_id, clock = tmp_path / 'limits.db', str(uuid4()), [1800000000.0]
    limits = DiscoveryLimits(path, lambda: clock[0], controlled_test_id=run_id)
    token = limits.start(USER).session_token
    limits.remember_ids(token, ['branch_north'])
    with pytest.raises(DiscoveryError, match='one search session'):
        DiscoveryLimits(path, lambda: clock[0], controlled_test_id=run_id).start(USER)
    with pytest.raises(DiscoveryError, match='one search session'):
        limits.start(uuid4())
    with pytest.raises(DiscoveryError, match='one request'):
        limits.reserve(USER, token, 'details', 'branch_north')
    limits.reserve(USER, token, 'autocomplete')
    with pytest.raises(DiscoveryError, match='one request'):
        DiscoveryLimits(path, lambda: clock[0], controlled_test_id=run_id).reserve(USER, token, 'autocomplete')
    with pytest.raises(DiscoveryError, match='Choose a branch'):
        limits.reserve(USER, token, 'details', 'invented')
    limits.reserve(USER, token, 'details', 'branch_north')
    with pytest.raises(DiscoveryError, match='ended'):
        limits.reserve(USER, token, 'details', 'branch_north')
    clock[0] += 86401
    with pytest.raises(DiscoveryError, match='one search session'):
        DiscoveryLimits(path, lambda: clock[0], controlled_test_id=run_id).start(USER)
    with sqlite3.connect(path) as db:
        assert dict(db.execute('SELECT kind, COUNT(*) FROM requests GROUP BY kind')) == {'session': 1, 'autocomplete': 1, 'details': 1}
        assert db.execute('SELECT autocomplete, details FROM controlled_tests').fetchone() == (1, 1)


def test_one_approved_controlled_detail_can_exceed_only_the_global_daily_cap(tmp_path):
    path, now = tmp_path / 'limits.db', 1800000000.0
    grant = DiscoveryLimits(path, lambda: now, controlled_test_id=str(uuid4()), extra_controlled_details=True)
    # Existing paid reservations remain recorded. The ordinary fifth-Details
    # ceiling is already full before this separately approved one-use grant.
    with grant.transaction() as (db, _):
        db.executemany('INSERT INTO requests VALUES (?,?,?)',
            [(f'other-{i}', 'details', now) for i in range(5)])
    token = grant.start(USER).session_token
    grant.reserve(USER, token, 'autocomplete')
    grant.remember_ids(token, ['branch_north'])
    grant.reserve(USER, token, 'details', 'branch_north')
    with pytest.raises(DiscoveryError, match='ended'):
        grant.reserve(USER, token, 'details', 'branch_north')
    with pytest.raises(DiscoveryError, match='one search session'):
        grant.start(USER)
    ordinary = DiscoveryLimits(path, lambda: now)
    stranger = uuid4()
    another = ordinary.start(stranger).session_token
    ordinary.remember_ids(another, ['branch_north'])
    with pytest.raises(DiscoveryError, match='request limit'):
        ordinary.reserve(stranger, another, 'details', 'branch_north')
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT COUNT(*) FROM requests WHERE kind='details'").fetchone()[0] == 6
        assert db.execute('SELECT autocomplete, details FROM controlled_tests').fetchone() == (1, 1)


def test_controlled_test_grant_is_atomic_under_concurrent_requests(tmp_path):
    path, run_id = tmp_path / 'limits.db', str(uuid4())
    def attempt(operation, token=None):
        limits = DiscoveryLimits(path, controlled_test_id=run_id)
        try:
            if operation == 'session':
                return limits.start(USER).session_token
            limits.reserve(USER, token, operation, 'branch_north' if operation == 'details' else None)
            return True
        except DiscoveryError:
            return None
    with ThreadPoolExecutor(max_workers=4) as executor:
        sessions = list(executor.map(lambda _: attempt('session'), range(4)))
    token = next(value for value in sessions if value)
    assert sum(value is not None for value in sessions) == 1
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(bool(value) for value in executor.map(lambda _: attempt('autocomplete', token), range(4))) == 1
    DiscoveryLimits(path, controlled_test_id=run_id).remember_ids(token, ['branch_north'])
    with ThreadPoolExecutor(max_workers=4) as executor:
        assert sum(bool(value) for value in executor.map(lambda _: attempt('details', token), range(4))) == 1
    with sqlite3.connect(path) as db:
        assert dict(db.execute('SELECT kind, COUNT(*) FROM requests GROUP BY kind')) == {'session': 1, 'autocomplete': 1, 'details': 1}


def test_controlled_test_id_configuration_is_explicit_and_fail_closed(monkeypatch):
    monkeypatch.setenv('GOOGLE_PLACES_ENABLED', 'true')
    monkeypatch.setenv('GOOGLE_PLACES_LIVE_APPROVED', 'true')
    monkeypatch.setenv('GOOGLE_PLACES_API_KEY', KEY)
    monkeypatch.setenv('GOOGLE_PLACES_TEST_RUN_ID', 'invalid-id')
    with pytest.raises(DiscoveryError, match='controlled Google test grant is invalid'):
        PlacesConfig.from_environment().require_live()
    run_id = str(uuid4()); monkeypatch.setenv('GOOGLE_PLACES_TEST_RUN_ID', run_id)
    assert PlacesConfig.from_environment().controlled_test_id == run_id
    assert run_id not in repr(PlacesConfig.from_environment())
    monkeypatch.delenv('GOOGLE_PLACES_TEST_RUN_ID')
    assert PlacesConfig.from_environment().controlled_test_id is None  # Normal search remains available without a test grant.
    monkeypatch.setenv('GOOGLE_PLACES_EXTRA_DETAIL_APPROVED', 'true')
    with pytest.raises(DiscoveryError, match='one-use Google test grant'):
        PlacesConfig.from_environment().require_live()


def test_corrupt_limit_store_fails_closed(tmp_path):
    path = tmp_path / 'limits.db'; path.write_bytes(b'not a database')
    with pytest.raises(DiscoveryError, match='paused to protect usage'):
        DiscoveryLimits(path).start(USER)


def test_api_verified_auth_no_user_id_and_failures_consume_session(tmp_path, monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_offline_only_12345')
    config = PlacesConfig(True, True, KEY, tmp_path / 'limits.db')
    calls = []
    def mock_google(req):
        calls.append(req)
        return httpx.Response(200, json={'suggestions': [prediction()]}) if req.method == 'POST' else httpx.Response(503, json={})
    def mock_auth(req):
        return httpx.Response(200, json={'id': str(USER), 'role': 'authenticated', 'is_anonymous': True})
    app.dependency_overrides[routes.get_config] = lambda: config
    app.dependency_overrides[routes.get_provider] = lambda: adapter(mock_google, config)
    app.dependency_overrides[memory_routes.get_client] = lambda: httpx.Client(transport=httpx.MockTransport(mock_auth))
    try:
        client = TestClient(app)
        assert client.post('/api/v2/discovery/sessions', json={}).status_code == 401 and not calls
        headers = {'Authorization': 'Bearer offline.test.signature'}
        token = client.post('/api/v2/discovery/sessions', json={}, headers=headers).json()['session_token']
        payload = {'session_token': token, 'query': 'Shared'}
        assert client.post('/api/v2/discovery/autocomplete', json={**payload, 'user_id': str(USER)}, headers=headers).status_code == 422
        response = client.post('/api/v2/discovery/autocomplete', json=payload, headers=headers)
        assert response.status_code == 200 and response.headers['cache-control'] == 'private, no-store'
        chosen = {'session_token': token, 'place_id': 'branch_north'}
        assert client.post('/api/v2/discovery/selection', json=chosen, headers=headers).status_code == 502
        assert client.post('/api/v2/discovery/selection', json=chosen, headers=headers).status_code == 409
        assert len(calls) == 2
        assert client.get('/api/v2/restaurants/branch_north/menu').status_code == 404
        assert client.post('/api/v2/discovery/autocomplete', content='x' * 4097, headers=headers).status_code == 413
    finally:
        app.dependency_overrides.clear()


def test_controlled_test_api_stops_duplicate_dispatch_with_mocked_google(tmp_path, monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://offline.supabase.co')
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_offline_only_12345')
    config = PlacesConfig(True, True, KEY, tmp_path / 'limits.db', str(uuid4()))
    calls = []
    def mock_google(req):
        calls.append(req)
        return httpx.Response(200, json={'suggestions': [prediction()]}) if req.method == 'POST' else httpx.Response(200, json=detail())
    def mock_auth(_):
        return httpx.Response(200, json={'id': str(USER), 'role': 'authenticated', 'is_anonymous': True})
    class Proof:
        def issue(self, *_):
            return 'offline-signed-selection'
    monkeypatch.setattr(routes.SelectionProof, 'local', lambda: Proof())
    app.dependency_overrides[routes.get_config] = lambda: config
    app.dependency_overrides[routes.get_provider] = lambda: adapter(mock_google, config)
    app.dependency_overrides[memory_routes.get_client] = lambda: httpx.Client(transport=httpx.MockTransport(mock_auth))
    try:
        client = TestClient(app); headers = {'Authorization': 'Bearer offline.test.signature'}
        token = client.post('/api/v2/discovery/sessions', json={}, headers=headers).json()['session_token']
        assert client.post('/api/v2/discovery/sessions', json={}, headers=headers).status_code == 429
        search = {'session_token': token, 'query': 'Shared Name'}
        assert client.post('/api/v2/discovery/autocomplete', json=search, headers=headers).status_code == 200
        assert client.post('/api/v2/discovery/autocomplete', json=search, headers=headers).status_code == 429
        assert client.post('/api/v2/discovery/selection', json={'session_token': token, 'place_id': 'invented'}, headers=headers).status_code == 422
        chosen = {'session_token': token, 'place_id': 'branch_north'}
        selected = client.post('/api/v2/discovery/selection', json=chosen, headers=headers)
        assert selected.status_code == 200 and selected.json()['restaurant']['place_id'] == 'branch_north'
        assert client.post('/api/v2/discovery/selection', json=chosen, headers=headers).status_code == 409
        assert len(calls) == 2  # One mocked Autocomplete and one mocked Details; no retries.
    finally:
        app.dependency_overrides.clear()


def test_public_config_and_disabled_route_never_contact_auth_or_google(monkeypatch):
    monkeypatch.setenv('GOOGLE_PLACES_ENABLED', 'false'); monkeypatch.setenv('GOOGLE_PLACES_API_KEY', KEY)
    client = TestClient(app)
    response = client.get('/api/v2/discovery/config')
    assert not response.json()['google_enabled'] and KEY not in response.text
    assert client.post('/api/v2/discovery/sessions', json={}).status_code == 503
    # Existing fictional catalog remains usable through its provider adapter.
    assert client.get('/api/v2/restaurants?q=Saigon').json()['mode'] == 'demo'
    demo = DemoRestaurantDiscoveryProvider()
    value = DiscoverySearch(session_token=uuid4(), query='Saigon')
    assert len(demo.autocomplete(value).predictions) == 2
    assert demo.details(DiscoverySelection(session_token=value.session_token, place_id='saigon-table')).restaurant.provider == 'demo'
