import json
from uuid import UUID
import httpx
from fastapi.testclient import TestClient
import pytest
from pydantic import ValidationError
from app.main import app
from app.persistence.auth import UserIdentity, verify_user
from app.persistence.config import SupabaseConfig, PersistenceError
from app.persistence.models import (TasteDocument, TasteBackupWrite, DiningEventWrite, DishFeedbackWrite,
    RecommendationHistoryWrite)
from app.persistence.repository import SupabaseMemoryRepository
from app.persistence.routes import get_client
from app.schemas import TasteProfile, RecommendationTasteEvidence

A = '11111111-1111-4111-8111-111111111111'
B = '22222222-2222-4222-8222-222222222222'
ROW = '33333333-3333-4333-8333-333333333333'
KEY = 'sb_publishable_offline_test_key_only_12345'
TOKEN = 'offline.test.signature'
CONFIG = SupabaseConfig('https://offline-project.supabase.co', KEY)
NOW = '2026-10-28T12:00:00Z'


def document():
    return TasteDocument(profile=TasteProfile(complete=True, favorites='Tacos'), evidence=RecommendationTasteEvidence(),
        detective=None, edited_axes=[], exploration_edited=False)


def profile(owner=A, revision=1):
    return dict(id=ROW, user_id=owner, document=document().model_dump(mode='json'), revision=revision,
        created_at=NOW, updated_at=NOW, source='user_reported')


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', CONFIG.url)
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', KEY)


@pytest.fixture(autouse=True)
def clean_dependencies():
    yield
    app.dependency_overrides.pop(get_client, None)


def transport(callback):
    calls = []
    def respond(request):
        calls.append(request)
        return callback(request)
    client = httpx.Client(transport=httpx.MockTransport(respond))
    app.dependency_overrides[get_client] = lambda: client
    return client, calls


def auth_reply(request):
    return httpx.Response(200, json={'id': A, 'role': 'authenticated', 'is_anonymous': True})


def test_missing_configuration_preserves_demo_and_does_not_make_requests(monkeypatch):
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    monkeypatch.delenv('SUPABASE_PUBLISHABLE_KEY', raising=False)
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/profile')
        assert result.status_code == 503 and 'not configured' in result.json()['detail']
        assert client.get('/api/v2/restaurants?q=Casa').status_code == 200
        assert client.get('/api/v2/health').json()['live_meta_inference'] is False


@pytest.mark.parametrize('url,key', [(CONFIG.url, 'sb_secret_dont_expose'), (CONFIG.url, 'eyJservice-role-token'),
    ('http://example.com', KEY), ('https://offline-project.supabase.co:bad', KEY), ('https://user:password@offline-project.supabase.co', KEY),
    (CONFIG.url + '/wrong', KEY), (CONFIG.url, ''), ('', KEY)])
def test_invalid_or_privileged_config_fails_closed(monkeypatch, url, key):
    monkeypatch.setenv('SUPABASE_URL', url)
    monkeypatch.setenv('SUPABASE_PUBLISHABLE_KEY', key)
    with pytest.raises(PersistenceError) as error: SupabaseConfig.from_environment()
    assert key not in str(error.value) if key else True


def test_verified_anonymous_identity_is_server_owned(configured):
    _, calls = transport(auth_reply)
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/identity', headers={'Authorization': 'Bearer ' + TOKEN, 'X-User-Id': B})
    assert result.status_code == 200 and result.json() == {'user_id': A, 'is_anonymous': True, 'storage': 'supabase'}
    assert calls[0].url.path == '/auth/v1/user'
    assert calls[0].headers['authorization'] == 'Bearer ' + TOKEN
    assert result.headers['cache-control'] == 'private, no-store'
    assert result.headers['vary'] == 'Authorization'
    assert TOKEN not in result.text and KEY not in result.text


@pytest.mark.parametrize('authorization', [None, 'Bearer fake', 'Basic value', 'Bearer ' + 'a'*9000])
def test_missing_or_malformed_bearer_never_reaches_supabase(configured, authorization):
    _, calls = transport(auth_reply)
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/profile', headers={'Authorization': authorization} if authorization else {})
    assert result.status_code == 401 and not calls


@pytest.mark.parametrize('status,expected', [(401,401), (403,401), (429,503), (500,503)])
def test_invalid_expired_wrong_project_tokens_and_provider_errors_are_sanitized(configured, status, expected):
    _, calls = transport(lambda request: httpx.Response(status, json={'private': TOKEN}))
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/profile', headers={'Authorization': 'Bearer ' + TOKEN})
    assert result.status_code == expected and len(calls) == 1
    assert TOKEN not in result.text


def test_auth_timeout_and_spoofed_user_data_fail_closed():
    def timeout(request): raise httpx.ReadTimeout('private token', request=request)
    with httpx.Client(transport=httpx.MockTransport(timeout)) as client:
        with pytest.raises(PersistenceError, match='could not be verified'): verify_user(client, CONFIG, 'Bearer ' + TOKEN)
    with httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(200, json={'id': A, 'role': 'service_role', 'is_anonymous': False}))) as client:
        with pytest.raises(PersistenceError): verify_user(client, CONFIG, 'Bearer ' + TOKEN)


def test_profile_reads_forward_user_jwt_and_enforce_owner_filter(configured):
    def respond(request):
        return auth_reply(request) if request.url.path.startswith('/auth/') else httpx.Response(200, json=[profile()])
    _, calls = transport(respond)
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/profile', headers={'Authorization': 'Bearer ' + TOKEN})
    assert result.status_code == 200 and result.json()['profile']['user_id'] == A
    assert calls[1].url.params['user_id'] == 'eq.' + A
    assert calls[1].headers['apikey'] == KEY and calls[1].headers['authorization'] == 'Bearer ' + TOKEN


def test_foreign_rows_are_rejected_even_if_database_returns_them(configured):
    transport(lambda request: auth_reply(request) if request.url.path.startswith('/auth/') else httpx.Response(200, json=[profile(B)]))
    with TestClient(app) as client:
        result = client.get('/api/v2/memory/profile', headers={'Authorization': 'Bearer ' + TOKEN})
    assert result.status_code == 503 and B not in result.text


def test_profile_create_only_and_compare_and_swap_conflict():
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(201 if request.method == 'POST' else 200, json=[profile()] if request.method == 'POST' else [])
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        repo = SupabaseMemoryRepository(client, CONFIG, UserIdentity(UUID(A), True, TOKEN))
        result = repo.save_profile(TasteBackupWrite(document=document(), expected_revision=None))
        assert result.revision == 1
        assert 'user_id' not in json.loads(requests[0].content)
        assert requests[0].headers['prefer'] == 'return=representation'  # Never merge-duplicates/upsert.
        with pytest.raises(PersistenceError) as error: repo.save_profile(TasteBackupWrite(document=document(), expected_revision=1))
        assert error.value.status == 409 and requests[1].url.params['revision'] == 'eq.1'


def test_frontend_cannot_supply_ownership_or_extra_profile_fields(configured):
    transport(auth_reply)
    with TestClient(app) as client:
        result = client.post('/api/v2/memory/profile', headers={'Authorization': 'Bearer ' + TOKEN},
            json={'document': document().model_dump(mode='json'), 'expected_revision': None, 'user_id': B})
    assert result.status_code == 422 and B not in result.text


def test_oversized_private_payload_is_blocked_before_network(configured):
    _, calls = transport(auth_reply)
    with TestClient(app) as client:
        result = client.post('/api/v2/memory/profile', content='x'*131073, headers={'Authorization': 'Bearer ' + TOKEN})
    assert result.status_code == 413 and not calls


def test_record_schemas_reuse_provenance_and_keep_legacy_feedback_unknowns():
    event = dict(id=ROW, event_type='ordered', restaurant_id='casa-sol', menu_version='v1', dish_id='taco', occurred_at=NOW, recommendation_id=None)
    assert DiningEventWrite(**event).event_type == 'ordered'
    for changes in ({'event_type':'imagined'}, {'user_id':A}, {'menu_version':None}, {'occurred_at':'not-a-date'}):
        with pytest.raises(ValidationError): DiningEventWrite(**(event | changes))
    feedback = dict(id='legacy-note', restaurant_name='Casa Sol', restaurant_id=None, menu_version=None, dish_id='taco', dish_name='Taco', liked=True, note='Remembered', date=NOW)
    value = DishFeedbackWrite(id=ROW, event_id=None, feedback=feedback, rating=5, tags=['great_texture'])
    assert value.feedback.menu_version is None and value.feedback.restaurant_id is None
    with pytest.raises(ValidationError): DishFeedbackWrite(id=ROW, event_id=None, feedback=feedback, rating=6, tags=[])
    item = dict(id='taco', name='Taco', category_id='main', price={'amount_minor':1800, 'status':'listed'})
    with pytest.raises(ValidationError): RecommendationHistoryWrite(id=ROW, session_id='s', restaurant_id='casa-sol', menu_version='v1', dishes=[item,item], reported_provider='demo')


def test_linked_records_require_matching_owner_restaurant_menu_and_dish():
    parent = dict(id=ROW, user_id=A, session_id='s', restaurant_id='other-branch', menu_version='v1', dishes=[], reported_provider='demo',
        source='user_reported', created_at=NOW, updated_at=NOW)
    calls = []
    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=[parent])
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        repo = SupabaseMemoryRepository(client, CONFIG, UserIdentity(UUID(A), True, TOKEN))
        with pytest.raises(PersistenceError, match='provenance'):
            repo.add_event(DiningEventWrite(id=UUID(B), event_type='selected', restaurant_id='casa-sol', menu_version='v1', dish_id='taco', occurred_at=NOW, recommendation_id=UUID(ROW)))
    assert len(calls) == 1 and calls[0].method == 'GET'


@pytest.mark.parametrize('resource,write', [
    ('events', dict(id=ROW, event_type='saved', restaurant_id='casa-sol', menu_version='v1', dish_id='taco', occurred_at=NOW, recommendation_id=None)),
    ('feedback', dict(id=ROW, event_id=None, rating=4, tags=['great_texture'], feedback=dict(id='rating', restaurant_id='casa-sol', restaurant_name='Casa Sol',
        menu_version='v1', dish_id='taco', dish_name='Taco', liked=True, note='Crisp', date=NOW))),
    ('history', dict(id=ROW, session_id='session', restaurant_id='casa-sol', menu_version='v1', dishes=[], reported_provider='demo')),
])
def test_typed_history_routes_save_and_list_only_verified_user_records(configured, resource, write):
    row = dict(**write, user_id=A, created_at=NOW, updated_at=NOW, source='user_reported')
    def respond(request):
        if request.url.path.startswith('/auth/'):
            return auth_reply(request)
        if request.method != 'POST': assert request.url.params['user_id'] == 'eq.' + A
        assert request.headers['authorization'] == 'Bearer ' + TOKEN
        if request.method == 'POST': assert 'user_id' not in json.loads(request.content)
        return httpx.Response(201 if request.method == 'POST' else 200, json=[row])
    transport(respond)
    with TestClient(app) as client:
        saved = client.post('/api/v2/memory/' + resource, json=write, headers={'Authorization': 'Bearer ' + TOKEN})
        assert saved.status_code == 201 and saved.json()['user_id'] == A
        listed = client.get('/api/v2/memory/' + resource + '?offset=0&user_id=' + B, headers={'Authorization': 'Bearer ' + TOKEN})
        assert listed.status_code == 200 and len(listed.json()['records']) == 1
        assert listed.json()['records'][0]['user_id'] == A
